import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import WebSocket from "ws";

const TIMEOUT_MS = 6000;

function testWS(url: string, onOpen?: (ws: WebSocket) => void, validate?: (data: string) => boolean, wsOptions?: object): Promise<{ ok: boolean; latency?: number; error?: string }> {
  return new Promise((resolve) => {
    const start = Date.now();
    let done = false;
    const finish = (result: { ok: boolean; latency?: number; error?: string }) => {
      if (done) return; done = true;
      clearTimeout(timer);
      try { ws.removeAllListeners(); ws.terminate(); } catch {}
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: "Timeout — no data received in 6s" }), TIMEOUT_MS);
    const ws = new WebSocket(url, wsOptions as any);
    ws.on("open", () => { if (onOpen) onOpen(ws); });
    ws.on("message", (data: Buffer) => {
      const str = data.toString();
      if (!validate || validate(str)) finish({ ok: true, latency: Date.now() - start });
    });
    ws.on("error", (e: Error) => finish({ ok: false, error: e.message }));
    ws.on("close", () => finish({ ok: false, error: "Connection closed before data received" }));
  });
}

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const { provider, apiKey } = await req.json();

  try {
    if (provider === "BN") {
      const result = await testWS("wss://stream.binance.com:9443/ws/btcusdt@bookTicker");
      return NextResponse.json(result);
    }

    if (provider === "KR") {
      const result = await testWS(
        "wss://ws.kraken.com",
        (ws) => ws.send(JSON.stringify({ event: "subscribe", pair: ["EUR/USD"], subscription: { name: "spread" } })),
        (data) => { try { const m = JSON.parse(data); return Array.isArray(m) && m[2] === "spread"; } catch { return false; } }
      );
      return NextResponse.json(result);
    }

    if (provider === "TD") {
      if (!apiKey) return NextResponse.json({ ok: false, error: "No API key provided" });
      const result = await testWS(
        `wss://ws.twelvedata.com/v1/quotes/price?apikey=${apiKey}`,
        (ws) => ws.send(JSON.stringify({ action: "subscribe", params: { symbols: "EUR/USD" } })),
        (data) => { try { const m = JSON.parse(data); return m.status === "ok" || m.event === "heartbeat" || m.event === "price"; } catch { return false; } },
      );
      return NextResponse.json(result);
    }

    if (provider === "FH") {
      if (!apiKey) return NextResponse.json({ ok: false, error: "No API key provided" });
      const result = await testWS(
        `wss://ws.finnhub.io?token=${apiKey}`,
        (ws) => ws.send(JSON.stringify({ type: "subscribe", symbol: "OANDA:EUR_USD" })),
        // Accept trade data OR ping (heartbeat) — ping alone proves connection + valid key
        (data) => { try { const m = JSON.parse(data); return m.type === "trade" || m.type === "ping" || m.type === "connected"; } catch { return false; } }
      );
      return NextResponse.json(result);
    }

    if (provider === "MV") {
      if (!apiKey) return NextResponse.json({ ok: false, error: "No API key provided" });
      // Multi-step: connect → auth → subscribe → wait for C event
      const result = await new Promise<{ ok: boolean; latency?: number; error?: string }>((resolve) => {
        const start = Date.now();
        let done = false;
        const finish = (r: { ok: boolean; latency?: number; error?: string }) => {
          if (done) return; done = true;
          clearTimeout(timer);
          try { ws.removeAllListeners(); ws.terminate(); } catch {}
          resolve(r);
        };
        const timer = setTimeout(() => finish({ ok: false, error: "Timeout — no data in 8s (check key and plan)" }), 8000);
        const ws = new WebSocket("wss://socket.massive.com/forex");
        ws.on("open", () => ws.send(JSON.stringify({ action: "auth", params: apiKey })));
        ws.on("message", (data: Buffer) => {
          try {
            const arr = JSON.parse(data.toString());
            for (const x of (Array.isArray(arr) ? arr : [arr])) {
              if (x.ev === "status" && x.status === "auth_failed") { finish({ ok: false, error: "Auth failed — check API key" }); return; }
              if (x.ev === "status" && (x.status === "auth_success" || x.message === "authenticated")) {
                ws.send(JSON.stringify({ action: "subscribe", params: "C.*" }));
              }
              if (x.ev === "C") { finish({ ok: true, latency: Date.now() - start }); return; }
            }
          } catch {}
        });
        ws.on("error", (e: Error) => finish({ ok: false, error: e.message }));
        ws.on("close", () => finish({ ok: false, error: "Connection closed before data received" }));
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ ok: false, error: "Unknown provider" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}
