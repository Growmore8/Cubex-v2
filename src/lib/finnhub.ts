const KEY = process.env.FINNHUB_KEY || "";
const BASE = "https://finnhub.io/api/v1";

async function fh(path: string): Promise<any> {
  const url = BASE + path + (path.includes("?") ? "&" : "?") + "token=" + KEY;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Finnhub " + r.status + " - " + (await r.text()).slice(0, 120));
  return r.json();
}

function clean(s: string) { return (s || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase(); }

export async function listFinnhub(category: string): Promise<any[]> {
  if (category === "crypto") {
    const d = await fh("/crypto/symbol?exchange=binance");
    return d.map((x: any) => { const disp = x.displaySymbol || x.symbol; const c = clean(disp); return { feed: x.symbol, symbol: c, display: disp, category: "crypto", digits: 2 }; })
      .filter((x: any) => x.symbol.endsWith("USDT")).slice(0, 400);
  }
  if (category === "stocks") {
    const d = await fh("/stock/symbol?exchange=US");
    return d.filter((x: any) => x.type === "Common Stock").map((x: any) => ({ feed: x.symbol, symbol: clean(x.symbol), display: x.description || x.symbol, category: "stocks", digits: 2 })).slice(0, 600);
  }
  // forex + metals both come from the OANDA forex list
  const d = await fh("/forex/symbol?exchange=oanda");
  const mapped = d.map((x: any) => {
    const disp = x.displaySymbol || x.symbol; const c = clean(disp);
    const metal = /^(XAU|XAG|XPT|XPD)/.test(c);
    const digits = c.includes("JPY") ? 3 : (metal ? 2 : 5);
    return { feed: x.symbol, symbol: c, display: disp, category: metal ? "metals" : "forex", digits };
  });
  return category === "metals" ? mapped.filter((m: any) => m.category === "metals") : mapped.filter((m: any) => m.category === "forex");
}
