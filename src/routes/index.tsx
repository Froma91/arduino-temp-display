import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Arduino Temperature Monitor" },
      {
        name: "description",
        content:
          "Live dashboard that reads temperature from an Arduino sensor via Web Serial API, with history every 10 seconds.",
      },
      { property: "og:title", content: "Arduino Temperature Monitor" },
      {
        property: "og:description",
        content: "Real-time reading from your Arduino connected via USB.",
      },
    ],
  }),
  component: Index,
});

type SerialPortLike = {
  open: (opts: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
};

type Sample = { t: number; value: number; label: string };

const SAMPLE_INTERVAL_MS = 10_000;
const MAX_SAMPLES = 60; // 10 min de histórico
const MIN_TEMP = 20;
const MAX_TEMP = 30;

function hasWebSerial(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

function Index() {
  const [supported, setSupported] = useState(true);
  const [connected, setConnected] = useState(false);
  const [temp, setTemp] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baudRate, setBaudRate] = useState(9600);
  const [history, setHistory] = useState<Sample[]>([]);

  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const keepReadingRef = useRef(false);
  const latestTempRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setSupported(hasWebSerial());
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const startSampling = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      const v = latestTempRef.current;
      if (v === null) return;
      const now = new Date();
      setHistory((prev) => {
        const next = [
          ...prev,
          {
            t: now.getTime(),
            value: v,
            label: now.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
          },
        ];
        return next.length > MAX_SAMPLES ? next.slice(-MAX_SAMPLES) : next;
      });
    }, SAMPLE_INTERVAL_MS);
  };

  const stopSampling = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const disconnect = async () => {
    keepReadingRef.current = false;
    stopSampling();
    try {
      await readerRef.current?.cancel();
    } catch {}
    try {
      readerRef.current?.releaseLock();
    } catch {}
    try {
      await portRef.current?.close();
    } catch {}
    readerRef.current = null;
    portRef.current = null;
    setConnected(false);
  };

  const connect = async () => {
    setError(null);
    try {
      // @ts-expect-error – Web Serial API no está en los tipos por defecto
      const port: SerialPortLike = await navigator.serial.requestPort();
      await port.open({ baudRate });
      portRef.current = port;
      setConnected(true);
      keepReadingRef.current = true;
      startSampling();
      readLoop(port);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo abrir el puerto";
      setError(msg);
    }
  };

  const readLoop = async (port: SerialPortLike) => {
    if (!port.readable) return;
    const decoder = new TextDecoder();
    let buffer = "";
    const reader = port.readable.getReader();
    readerRef.current = reader;
    try {
      while (keepReadingRef.current) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        buffer += decoder.decode(value, { stream: true });
        let nlIdx;
        while ((nlIdx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nlIdx).trim();
          buffer = buffer.slice(nlIdx + 1);
          if (!line) continue;
          const match = line.match(/-?\d+(\.\d+)?/);
          if (match) {
            const value = parseFloat(match[0]);
            if (!Number.isNaN(value)) {
              latestTempRef.current = value;
              setTemp(value);
              setLastUpdate(new Date());
            }
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Lectura interrumpida";
      setError(msg);
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }
  };

  const clearHistory = () => setHistory([]);

  const values = history.map((h) => h.value);
  const minV = values.length ? Math.min(...values) : null;
  const maxV = values.length ? Math.max(...values) : null;
  const avgV =
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

  const tempState: "cold" | "comfortable" | "hot" | null =
    temp === null
      ? null
      : temp < MIN_TEMP
      ? "cold"
      : temp > MAX_TEMP
      ? "hot"
      : "comfortable";

  const getTempImage = (state: typeof tempState) => {
    if (state === "cold") return "/assets/temp-cold.png";
    if (state === "hot") return "/assets/temp-hot.png";
    return "/assets/temp-comfortable.png";
  };

  const tempColorClass =
    tempState === "cold"
      ? "text-chart-3"
      : tempState === "hot"
      ? "text-destructive"
      : "text-primary";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-primary shadow-[0_0_12px_var(--color-primary)]" />
            <h1 className="text-sm font-medium tracking-widest text-muted-foreground uppercase">
              Arduino · Sensor de Temperatura
            </h1>
          </div>
          <span
            className={
              "rounded-full border px-3 py-1 text-xs font-medium " +
              (connected
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground")
            }
          >
            {connected ? "● En vivo" : "○ Desconectado"}
          </span>
        </header>

        <section className="mt-10 grid gap-8 lg:grid-cols-2 lg:items-center">
          <div className="flex flex-col items-center justify-center text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Temperatura actual
            </p>
            {tempState && (
              <img
                src={getTempImage(tempState)}
                alt={
                  tempState === "cold"
                    ? "Muy frío"
                    : tempState === "hot"
                    ? "Muy caliente"
                    : "Agradable"
                }
                className="mt-3 h-20 w-20 object-contain sm:h-24 sm:w-24"
                width={512}
                height={512}
                loading="lazy"
              />
            )}
            <div className="mt-2 flex items-start font-mono">
              <span
                className={`text-[8rem] leading-none font-bold tabular-nums tracking-tighter sm:text-[11rem] ${tempColorClass}`}
              >
                {temp === null ? "--.-" : temp.toFixed(1)}
              </span>
              <span className="mt-4 ml-2 text-2xl font-light text-muted-foreground sm:mt-6 sm:text-4xl">
                °C
              </span>
            </div>
            {tempState && (
              <span
                className={`mt-2 inline-block rounded-full border px-3 py-1 text-xs font-medium ${
                  tempState === "cold"
                    ? "border-chart-3/40 bg-chart-3/10 text-chart-3"
                    : tempState === "hot"
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-primary/40 bg-primary/10 text-primary"
                }`}
              >
                {tempState === "cold"
                  ? "Muy frío"
                  : tempState === "hot"
                  ? "Muy caliente"
                  : "Agradable"}
              </span>
            )}
            <p className="mt-3 text-sm text-muted-foreground">
              {lastUpdate
                ? `Actualizado: ${lastUpdate.toLocaleTimeString()}`
                : "Esperando primera lectura…"}
            </p>

            <div className="mt-6 grid w-full max-w-sm grid-cols-3 gap-3">
              {[
                { label: "Mín", value: minV },
                { label: "Prom", value: avgV },
                { label: "Máx", value: maxV },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-lg border border-border bg-card px-3 py-2"
                >
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {s.label}
                  </p>
                  <p className="font-mono text-lg tabular-nums">
                    {s.value === null ? "—" : s.value.toFixed(1)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Histórico
                </p>
                <p className="text-xs text-muted-foreground/70">
                  1 muestra cada 10 s · últimas {MAX_SAMPLES}
                </p>
              </div>
              <button
                onClick={clearHistory}
                disabled={!history.length}
                className="rounded-md border border-border bg-background px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-40"
              >
                Limpiar
              </button>
            </div>
            <div className="h-64 w-full">
              {history.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  {connected
                    ? "Recopilando datos…"
                    : "Conecta el Arduino para comenzar."}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={history}
                    margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="tempFill" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor="var(--color-primary)"
                          stopOpacity={0.5}
                        />
                        <stop
                          offset="100%"
                          stopColor="var(--color-primary)"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--color-border)"
                    />
                    <XAxis
                      dataKey="label"
                      stroke="var(--color-muted-foreground)"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      stroke="var(--color-muted-foreground)"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      domain={["auto", "auto"]}
                      width={36}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v: number) => [`${v.toFixed(1)} °C`, "Temp"]}
                      labelStyle={{ color: "var(--color-muted-foreground)" }}
                    />
                    <ReferenceLine
                      y={MIN_TEMP}
                      stroke="var(--color-chart-3)"
                      strokeDasharray="4 4"
                      label={{
                        value: "Mín 20 °C",
                        position: "insideBottomRight",
                        fontSize: 10,
                        fill: "var(--color-chart-3)",
                      }}
                    />
                    <ReferenceLine
                      y={MAX_TEMP}
                      stroke="var(--color-chart-1)"
                      strokeDasharray="4 4"
                      label={{
                        value: "Máx 30 °C",
                        position: "insideTopRight",
                        fontSize: 10,
                        fill: "var(--color-chart-1)",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="var(--color-primary)"
                      strokeWidth={2}
                      fill="url(#tempFill)"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </section>

        <footer className="mt-10 space-y-4 rounded-2xl border border-border bg-card p-6">
          {!supported ? (
            <p className="text-sm text-destructive">
              Tu navegador no soporta Web Serial API. Usa Chrome o Edge en
              escritorio.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="flex flex-col text-xs uppercase tracking-wider text-muted-foreground">
                  Baudios
                  <select
                    value={baudRate}
                    onChange={(e) => setBaudRate(Number(e.target.value))}
                    disabled={connected}
                    className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground disabled:opacity-50"
                  >
                    {[9600, 19200, 38400, 57600, 115200].map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex-1" />
                {connected ? (
                  <button
                    onClick={disconnect}
                    className="rounded-md border border-border bg-background px-5 py-2.5 text-sm font-medium hover:bg-accent"
                  >
                    Desconectar
                  </button>
                ) : (
                  <button
                    onClick={connect}
                    className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    Conectar Arduino
                  </button>
                )}
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground">
                  Cómo programar el Arduino
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed">{`void setup() {
  Serial.begin(9600);
}

void loop() {
  float t = readSensor(); // tu sensor (LM35, DHT11, DS18B20...)
  Serial.println(t);      // una lectura por línea
  delay(1000);            // la web muestrea cada 10 s automáticamente
}`}</pre>
              </details>
            </>
          )}
        </footer>
      </div>
    </main>
  );
}
