import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Monitor de Temperatura Arduino" },
      {
        name: "description",
        content:
          "Dashboard en vivo que lee la temperatura de un sensor Arduino vía Web Serial API.",
      },
      { property: "og:title", content: "Monitor de Temperatura Arduino" },
      {
        property: "og:description",
        content: "Lectura en tiempo real desde tu Arduino conectado por USB.",
      },
    ],
  }),
  component: Index,
});

// Detección mínima de Web Serial API
type SerialPortLike = {
  open: (opts: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
};

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

  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const keepReadingRef = useRef(false);

  useEffect(() => {
    setSupported(hasWebSerial());
  }, []);

  const disconnect = async () => {
    keepReadingRef.current = false;
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
          // Acepta "23.4", "T:23.4", "temp=23.4 C", etc.
          const match = line.match(/-?\d+(\.\d+)?/);
          if (match) {
            const value = parseFloat(match[0]);
            if (!Number.isNaN(value)) {
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

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-10">
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

        <section className="my-auto flex flex-col items-center justify-center py-16">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
            Temperatura actual
          </p>
          <div className="mt-6 flex items-start font-mono">
            <span className="text-[12rem] leading-none font-bold tabular-nums tracking-tighter sm:text-[16rem]">
              {temp === null ? "--.-" : temp.toFixed(1)}
            </span>
            <span className="mt-6 ml-2 text-3xl font-light text-muted-foreground sm:mt-10 sm:text-5xl">
              °C
            </span>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            {lastUpdate
              ? `Actualizado: ${lastUpdate.toLocaleTimeString()}`
              : "Esperando primera lectura…"}
          </p>
        </section>

        <footer className="mt-auto space-y-4 rounded-2xl border border-border bg-card p-6">
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
              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}
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
  delay(1000);
}`}</pre>
              </details>
            </>
          )}
        </footer>
      </div>
    </main>
  );
}
