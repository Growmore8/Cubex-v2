import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { reloadCatalog } from "@/lib/realtime";

interface MvTicker {
  symbol: string;
  display: string;
  name: string;
  category: string;
  digits: number;
  feed?: string;   // Finnhub override e.g. "BSE:RELIANCE", "NSE:TCS"
  exchange?: string; // UI label e.g. "BSE", "NSE", "NYSE", "NASDAQ"
}

// ── Comprehensive forex pair list (Massive C.* channel covers all of these) ──
const FOREX_PAIRS: [string, string, string, number][] = [
  // Major pairs
  ["EURUSD","EUR/USD","Euro / US Dollar",5],
  ["GBPUSD","GBP/USD","British Pound / US Dollar",5],
  ["AUDUSD","AUD/USD","Australian Dollar / US Dollar",5],
  ["NZDUSD","NZD/USD","New Zealand Dollar / US Dollar",5],
  ["USDCAD","USD/CAD","US Dollar / Canadian Dollar",5],
  ["USDCHF","USD/CHF","US Dollar / Swiss Franc",5],
  ["USDJPY","USD/JPY","US Dollar / Japanese Yen",3],
  // Minor pairs
  ["EURGBP","EUR/GBP","Euro / British Pound",5],
  ["EURJPY","EUR/JPY","Euro / Japanese Yen",3],
  ["EURCAD","EUR/CAD","Euro / Canadian Dollar",5],
  ["EURCHF","EUR/CHF","Euro / Swiss Franc",5],
  ["EURAUD","EUR/AUD","Euro / Australian Dollar",5],
  ["EURNZD","EUR/NZD","Euro / New Zealand Dollar",5],
  ["GBPJPY","GBP/JPY","British Pound / Japanese Yen",3],
  ["GBPCHF","GBP/CHF","British Pound / Swiss Franc",5],
  ["GBPCAD","GBP/CAD","British Pound / Canadian Dollar",5],
  ["GBPAUD","GBP/AUD","British Pound / Australian Dollar",5],
  ["GBPNZD","GBP/NZD","British Pound / New Zealand Dollar",5],
  ["AUDJPY","AUD/JPY","Australian Dollar / Japanese Yen",3],
  ["AUDNZD","AUD/NZD","Australian Dollar / New Zealand Dollar",5],
  ["AUDCAD","AUD/CAD","Australian Dollar / Canadian Dollar",5],
  ["AUDCHF","AUD/CHF","Australian Dollar / Swiss Franc",5],
  ["NZDJPY","NZD/JPY","New Zealand Dollar / Japanese Yen",3],
  ["NZDCAD","NZD/CAD","New Zealand Dollar / Canadian Dollar",5],
  ["NZDCHF","NZD/CHF","New Zealand Dollar / Swiss Franc",5],
  ["CADJPY","CAD/JPY","Canadian Dollar / Japanese Yen",3],
  ["CADCHF","CAD/CHF","Canadian Dollar / Swiss Franc",5],
  ["CHFJPY","CHF/JPY","Swiss Franc / Japanese Yen",3],
  // Exotic pairs
  ["USDHKD","USD/HKD","US Dollar / Hong Kong Dollar",5],
  ["USDSGD","USD/SGD","US Dollar / Singapore Dollar",5],
  ["USDTRY","USD/TRY","US Dollar / Turkish Lira",4],
  ["USDMXN","USD/MXN","US Dollar / Mexican Peso",4],
  ["USDZAR","USD/ZAR","US Dollar / South African Rand",4],
  ["USDSEK","USD/SEK","US Dollar / Swedish Krona",4],
  ["USDNOK","USD/NOK","US Dollar / Norwegian Krone",4],
  ["USDDKK","USD/DKK","US Dollar / Danish Krone",4],
  ["USDPLN","USD/PLN","US Dollar / Polish Zloty",4],
  ["USDCZK","USD/CZK","US Dollar / Czech Koruna",4],
  ["USDHUF","USD/HUF","US Dollar / Hungarian Forint",3],
  ["USDRON","USD/RON","US Dollar / Romanian Leu",4],
  ["USDILS","USD/ILS","US Dollar / Israeli Shekel",4],
  ["USDTHB","USD/THB","US Dollar / Thai Baht",4],
  ["USDMYR","USD/MYR","US Dollar / Malaysian Ringgit",4],
  ["USDIDR","USD/IDR","US Dollar / Indonesian Rupiah",2],
  ["USDPHP","USD/PHP","US Dollar / Philippine Peso",4],
  ["USDKRW","USD/KRW","US Dollar / South Korean Won",2],
  ["USDTWD","USD/TWD","US Dollar / Taiwan Dollar",4],
  ["USDCNH","USD/CNH","US Dollar / Chinese Yuan (Offshore)",4],
  ["USDINR","USD/INR","US Dollar / Indian Rupee",4],
  ["USDPKR","USD/PKR","US Dollar / Pakistani Rupee",2],
  ["USDBDT","USD/BDT","US Dollar / Bangladeshi Taka",3],
  ["USDVND","USD/VND","US Dollar / Vietnamese Dong",2],
  ["USDNGN","USD/NGN","US Dollar / Nigerian Naira",2],
  ["USDEGP","USD/EGP","US Dollar / Egyptian Pound",4],
  ["USDARS","USD/ARS","US Dollar / Argentine Peso",4],
  ["USDBRL","USD/BRL","US Dollar / Brazilian Real",4],
  ["USDCLP","USD/CLP","US Dollar / Chilean Peso",2],
  ["USDCOP","USD/COP","US Dollar / Colombian Peso",2],
  ["USDPEN","USD/PEN","US Dollar / Peruvian Sol",4],
  ["USDRUB","USD/RUB","US Dollar / Russian Ruble",4],
  ["USDKZT","USD/KZT","US Dollar / Kazakhstani Tenge",3],
  ["USDUA","USD/UAH","US Dollar / Ukrainian Hryvnia",4],
  ["USDAED","USD/AED","US Dollar / UAE Dirham",4],
  ["USDSAR","USD/SAR","US Dollar / Saudi Riyal",4],
  ["USDQAR","USD/QAR","US Dollar / Qatari Riyal",4],
  ["USDKWD","USD/KWD","US Dollar / Kuwaiti Dinar",5],
  ["USDBHD","USD/BHD","US Dollar / Bahraini Dinar",5],
  ["USDMAD","USD/MAD","US Dollar / Moroccan Dirham",4],
  ["USDTZS","USD/TZS","US Dollar / Tanzanian Shilling",2],
  ["USDKES","USD/KES","US Dollar / Kenyan Shilling",3],
  ["USDGHS","USD/GHS","US Dollar / Ghanaian Cedi",4],
  ["USDZMW","USD/ZMW","US Dollar / Zambian Kwacha",4],
  ["EURPLN","EUR/PLN","Euro / Polish Zloty",4],
  ["EURTRY","EUR/TRY","Euro / Turkish Lira",4],
  ["EURSEK","EUR/SEK","Euro / Swedish Krona",4],
  ["EURNOK","EUR/NOK","Euro / Norwegian Krone",4],
  ["EURDKK","EUR/DKK","Euro / Danish Krone",4],
  ["EURCZK","EUR/CZK","Euro / Czech Koruna",4],
  ["EURHUF","EUR/HUF","Euro / Hungarian Forint",3],
  ["EURRON","EUR/RON","Euro / Romanian Leu",4],
  ["EURRUB","EUR/RUB","Euro / Russian Ruble",4],
  ["EURHKD","EUR/HKD","Euro / Hong Kong Dollar",5],
  ["EURSGD","EUR/SGD","Euro / Singapore Dollar",5],
  ["EURMXN","EUR/MXN","Euro / Mexican Peso",4],
  ["EURZAR","EUR/ZAR","Euro / South African Rand",4],
  ["GBPSEK","GBP/SEK","British Pound / Swedish Krona",4],
  ["GBPNOK","GBP/NOK","British Pound / Norwegian Krone",4],
  ["GBPDKK","GBP/DKK","British Pound / Danish Krone",4],
  ["GBPPLN","GBP/PLN","British Pound / Polish Zloty",4],
  ["GBPTRY","GBP/TRY","British Pound / Turkish Lira",4],
  ["GBPSGD","GBP/SGD","British Pound / Singapore Dollar",5],
  ["GBPHKD","GBP/HKD","British Pound / Hong Kong Dollar",5],
  ["GBPZAR","GBP/ZAR","British Pound / South African Rand",4],
  ["AUDSGD","AUD/SGD","Australian Dollar / Singapore Dollar",5],
  ["NZDSGD","NZD/SGD","New Zealand Dollar / Singapore Dollar",5],
  ["SGDJPY","SGD/JPY","Singapore Dollar / Japanese Yen",3],
  ["HKDJPY","HKD/JPY","Hong Kong Dollar / Japanese Yen",4],
  // Metals (come via C.* forex channel on Massive)
  ["XAUUSD","XAU/USD","Gold / US Dollar",2],
  ["XAGUSD","XAG/USD","Silver / US Dollar",4],
  ["XPTUSD","XPT/USD","Platinum / US Dollar",2],
  ["XPDUSD","XPD/USD","Palladium / US Dollar",2],
  ["XAUEUR","XAU/EUR","Gold / Euro",2],
  ["XAUGBP","XAU/GBP","Gold / British Pound",2],
  ["XAUJPY","XAU/JPY","Gold / Japanese Yen",0],
  ["XAUAUD","XAU/AUD","Gold / Australian Dollar",2],
  ["XAUCHF","XAU/CHF","Gold / Swiss Franc",2],
];

// ── Comprehensive crypto pair list (Massive XQ.* channel) ──
const CRYPTO_PAIRS: [string, string, string, number?][] = [
  ["BTCUSD","BTC/USD","Bitcoin / US Dollar"],
  ["ETHUSD","ETH/USD","Ethereum / US Dollar"],
  ["SOLUSD","SOL/USD","Solana / US Dollar"],
  ["XRPUSD","XRP/USD","Ripple / US Dollar"],
  ["ADAUSD","ADA/USD","Cardano / US Dollar"],
  ["DOTUSD","DOT/USD","Polkadot / US Dollar"],
  ["LINKUSD","LINK/USD","Chainlink / US Dollar"],
  ["AVAXUSD","AVAX/USD","Avalanche / US Dollar"],
  ["LTCUSD","LTC/USD","Litecoin / US Dollar"],
  ["DOGEUSD","DOGE/USD","Dogecoin / US Dollar"],
  ["MATICUSD","MATIC/USD","Polygon / US Dollar"],
  ["UNIUSD","UNI/USD","Uniswap / US Dollar"],
  ["AAVEUSD","AAVE/USD","Aave / US Dollar"],
  ["ATOMUSD","ATOM/USD","Cosmos / US Dollar"],
  ["ALGOUSD","ALGO/USD","Algorand / US Dollar"],
  ["NEARUSD","NEAR/USD","NEAR Protocol / US Dollar"],
  ["FTMUSD","FTM/USD","Fantom / US Dollar"],
  ["SANDUSD","SAND/USD","The Sandbox / US Dollar"],
  ["MANAUSD","MANA/USD","Decentraland / US Dollar"],
  ["AXSUSD","AXS/USD","Axie Infinity / US Dollar"],
  ["THETAUSD","THETA/USD","Theta / US Dollar"],
  ["XLMUSD","XLM/USD","Stellar / US Dollar"],
  ["VETUSD","VET/USD","VeChain / US Dollar"],
  ["BNBUSD","BNB/USD","Binance Coin / US Dollar"],
  ["TRXUSD","TRX/USD","TRON / US Dollar"],
  ["EOSUSD","EOS/USD","EOS / US Dollar"],
  ["ZECUSD","ZEC/USD","Zcash / US Dollar"],
  ["XMRUSD","XMR/USD","Monero / US Dollar"],
  ["DASHUSD","DASH/USD","Dash / US Dollar"],
  ["BATUSD","BAT/USD","Basic Attention Token / US Dollar"],
  ["MKRUSD","MKR/USD","Maker / US Dollar"],
  ["COMPUSD","COMP/USD","Compound / US Dollar"],
  ["SNXUSD","SNX/USD","Synthetix / US Dollar"],
  ["YFIUSD","YFI/USD","yearn.finance / US Dollar"],
  ["CROUSD","CRO/USD","Crypto.com Coin / US Dollar"],
  ["SUSHIUSD","SUSHI/USD","SushiSwap / US Dollar"],
  ["1INCHUSD","1INCH/USD","1inch / US Dollar"],
  ["ENJUSD","ENJ/USD","Enjin Coin / US Dollar"],
  ["GRTUSD","GRT/USD","The Graph / US Dollar"],
  ["RUNEUSD","RUNE/USD","THORChain / US Dollar"],
  ["ICPUSD","ICP/USD","Internet Computer / US Dollar"],
  ["FILUSD","FIL/USD","Filecoin / US Dollar"],
  ["HBARUSD","HBAR/USD","Hedera / US Dollar"],
  ["EGLDID","EGLD/USD","Elrond / US Dollar"],
  ["FLOWUSD","FLOW/USD","Flow / US Dollar"],
  ["KLAYUSD","KLAY/USD","Klaytn / US Dollar"],
  ["ZILIUSD","ZIL/USD","Zilliqa / US Dollar"],
  ["ONEUSD","ONE/USD","Harmony / US Dollar"],
  ["IOTAUSD","IOTA/USD","IOTA / US Dollar"],
  ["NEOUSD","NEO/USD","NEO / US Dollar"],
  ["WAVUSD","WAVES/USD","Waves / US Dollar"],
  ["KSMUSD","KSM/USD","Kusama / US Dollar"],
  ["ANKRUSD","ANKR/USD","Ankr / US Dollar"],
  ["STXUSD","STX/USD","Stacks / US Dollar"],
  ["ROSEUSD","ROSE/USD","Oasis Network / US Dollar"],
  ["CELRUSD","CELR/USD","Celer Network / US Dollar"],
  ["CRVUSD","CRV/USD","Curve DAO / US Dollar"],
  ["GALAUSD","GALA/USD","Gala / US Dollar"],
  ["APEUSD","APE/USD","ApeCoin / US Dollar"],
  ["GMTUSD","GMT/USD","STEPN / US Dollar"],
  ["OPUSD","OP/USD","Optimism / US Dollar"],
  ["ARBUSD","ARB/USD","Arbitrum / US Dollar"],
  ["WLDUSD","WLD/USD","Worldcoin / US Dollar"],
  ["PENDLEUSD","PENDLE/USD","Pendle / US Dollar"],
  ["ENAUSD","ENA/USD","Ethena / US Dollar"],
  ["JUPUSD","JUP/USD","Jupiter / US Dollar"],
  ["BONKUSD","BONK/USD","Bonk / US Dollar"],
  ["PEPEUSD","PEPE/USD","Pepe / US Dollar"],
  ["SHIBUSD","SHIB/USD","Shiba Inu / US Dollar"],
  ["DOTUSD","DOT/USD","Polkadot / US Dollar"],
  ["SUIUSD","SUI/USD","Sui / US Dollar"],
  ["APTUSD","APT/USD","Aptos / US Dollar"],
  ["INJUSD","INJ/USD","Injective / US Dollar"],
  ["TIAUSD","TIA/USD","Celestia / US Dollar"],
  ["SEIJPY","SEI/USD","Sei / US Dollar"],
  ["DYMUSD","DYM/USD","Dymension / US Dollar"],
  ["STRKUSD","STRK/USD","Starknet / US Dollar"],
  ["PYTHUSD","PYTH/USD","Pyth Network / US Dollar"],
  ["JUPUSD","JUP/USD","Jupiter / US Dollar"],
  ["JTOUSD","JTO/USD","Jito / US Dollar"],
  ["WIFUSD","WIF/USD","dogwifhat / US Dollar"],
  ["MEWUSD","MEW/USD","cat in a dogs world / US Dollar"],
  ["ZKUSD","ZK/USD","ZKsync / US Dollar"],
  ["BNXUSD","BNX/USD","BinaryX / US Dollar"],
  // USDT variants (if state has them)
  ["BTCUSDT","BTC/USDT","Bitcoin / Tether",2],
  ["ETHUSDT","ETH/USDT","Ethereum / Tether",2],
  ["SOLUSDT","SOL/USDT","Solana / Tether",3],
  ["XRPUSDT","XRP/USDT","Ripple / Tether",5],
  ["ADAUSDT","ADA/USDT","Cardano / Tether",5],
  ["BNBUSDT","BNB/USDT","Binance Coin / Tether",3],
  ["DOGEUSDT","DOGE/USDT","Dogecoin / Tether",6],
  ["DOTUSDT","DOT/USDT","Polkadot / Tether",4],
  ["MATICUSDT","MATIC/USDT","Polygon / Tether",5],
  ["LTCUSDT","LTC/USDT","Litecoin / Tether",3],
  ["LINKUSDT","LINK/USDT","Chainlink / Tether",4],
  ["AVAXUSDT","AVAX/USDT","Avalanche / Tether",3],
  ["UNIUSDT","UNI/USDT","Uniswap / Tether",4],
  ["ATOMUSDT","ATOM/USDT","Cosmos / Tether",4],
  ["XLMUSDT","XLM/USDT","Stellar / Tether",6],
  ["SHIBUSDT","SHIB/USDT","Shiba Inu / Tether",8],
];

// ── Popular US & Global stocks (Finnhub WebSocket) ──
const STOCK_LIST: [string, string][] = [
  // Big Tech / NASDAQ
  ["AAPL","Apple Inc."],["MSFT","Microsoft Corp."],["NVDA","NVIDIA Corp."],
  ["AMZN","Amazon.com Inc."],["GOOGL","Alphabet Inc. (A)"],["GOOG","Alphabet Inc. (C)"],
  ["META","Meta Platforms Inc."],["TSLA","Tesla Inc."],["AMD","Advanced Micro Devices"],
  ["INTC","Intel Corp."],["AVGO","Broadcom Inc."],["QCOM","Qualcomm Inc."],
  ["TXN","Texas Instruments"],["MU","Micron Technology"],["AMAT","Applied Materials"],
  ["CSCO","Cisco Systems"],["ORCL","Oracle Corp."],["CRM","Salesforce Inc."],
  ["ADBE","Adobe Inc."],["NFLX","Netflix Inc."],["PYPL","PayPal Holdings"],
  ["UBER","Uber Technologies"],["ABNB","Airbnb Inc."],["COIN","Coinbase Global"],
  ["NOW","ServiceNow Inc."],["SNOW","Snowflake Inc."],["PLTR","Palantir Technologies"],
  // Finance
  ["JPM","JPMorgan Chase"],["BAC","Bank of America"],["WFC","Wells Fargo"],
  ["GS","Goldman Sachs"],["MS","Morgan Stanley"],["V","Visa Inc."],
  ["MA","Mastercard Inc."],["AXP","American Express"],["BLK","BlackRock Inc."],
  ["SCHW","Charles Schwab"],["C","Citigroup Inc."],
  // Healthcare
  ["UNH","UnitedHealth Group"],["JNJ","Johnson & Johnson"],["PFE","Pfizer Inc."],
  ["LLY","Eli Lilly & Co."],["ABBV","AbbVie Inc."],["MRK","Merck & Co."],
  ["AMGN","Amgen Inc."],["BMY","Bristol-Myers Squibb"],["CVS","CVS Health"],
  // Consumer
  ["WMT","Walmart Inc."],["COST","Costco Wholesale"],["HD","Home Depot"],
  ["MCD","McDonald's Corp."],["SBUX","Starbucks Corp."],["NKE","Nike Inc."],
  ["PG","Procter & Gamble"],["KO","Coca-Cola Co."],["PEP","PepsiCo Inc."],
  ["DIS","Walt Disney Co."],["NFLX","Netflix Inc."],["TGT","Target Corp."],
  // Energy
  ["XOM","Exxon Mobil Corp."],["CVX","Chevron Corp."],["COP","ConocoPhillips"],
  ["SLB","SLB (Schlumberger)"],
  // Industrial / Other
  ["BA","Boeing Co."],["CAT","Caterpillar Inc."],["GE","GE Aerospace"],
  ["HON","Honeywell International"],["MMM","3M Company"],["DE","Deere & Company"],
  ["LMT","Lockheed Martin"],["RTX","RTX Corp."],
  // Telecom
  ["T","AT&T Inc."],["VZ","Verizon Communications"],["TMUS","T-Mobile US"],
  ["CMCSA","Comcast Corp."],
  // Global stocks
  ["TSM","Taiwan Semiconductor"],["ASML","ASML Holding"],["TM","Toyota Motor"],
  ["SONY","Sony Group Corp."],["BABA","Alibaba Group"],["NIO","NIO Inc."],
  ["BIDU","Baidu Inc."],["JD","JD.com Inc."],
  // ETFs
  ["SPY","S&P 500 ETF"],["QQQ","Nasdaq 100 ETF"],["IWM","Russell 2000 ETF"],
  ["GLD","Gold ETF"],["SLV","Silver ETF"],
];

// ── BSE / NSE Indian stocks (Finnhub: NSE:SYMBOL or BSE:SYMBOL) ──
// [symbol, displayName, finnhubFeed, exchange]
const BSE_STOCKS: [string, string, string, string][] = [
  // Nifty 50 — Large Cap
  ["RELIANCE","Reliance Industries","NSE:RELIANCE","NSE"],
  ["TCS","Tata Consultancy Services","NSE:TCS","NSE"],
  ["HDFCBANK","HDFC Bank","NSE:HDFCBANK","NSE"],
  ["INFY","Infosys","NSE:INFY","NSE"],
  ["ICICIBANK","ICICI Bank","NSE:ICICIBANK","NSE"],
  ["HINDUNILVR","Hindustan Unilever","NSE:HINDUNILVR","NSE"],
  ["ITC","ITC Ltd","NSE:ITC","NSE"],
  ["SBIN","State Bank of India","NSE:SBIN","NSE"],
  ["BHARTIARTL","Bharti Airtel","NSE:BHARTIARTL","NSE"],
  ["KOTAKBANK","Kotak Mahindra Bank","NSE:KOTAKBANK","NSE"],
  ["LT","Larsen & Toubro","NSE:LT","NSE"],
  ["ASIANPAINT","Asian Paints","NSE:ASIANPAINT","NSE"],
  ["MARUTI","Maruti Suzuki","NSE:MARUTI","NSE"],
  ["BAJFINANCE","Bajaj Finance","NSE:BAJFINANCE","NSE"],
  ["WIPRO","Wipro Ltd","NSE:WIPRO","NSE"],
  ["HCLTECH","HCL Technologies","NSE:HCLTECH","NSE"],
  ["SUNPHARMA","Sun Pharmaceutical","NSE:SUNPHARMA","NSE"],
  ["TATAMOTORS","Tata Motors","NSE:TATAMOTORS","NSE"],
  ["AXISBANK","Axis Bank","NSE:AXISBANK","NSE"],
  ["TECHM","Tech Mahindra","NSE:TECHM","NSE"],
  ["ULTRACEMCO","Ultratech Cement","NSE:ULTRACEMCO","NSE"],
  ["NESTLEIND","Nestle India","NSE:NESTLEIND","NSE"],
  ["POWERGRID","Power Grid Corp","NSE:POWERGRID","NSE"],
  ["NTPC","NTPC Ltd","NSE:NTPC","NSE"],
  ["TATASTEEL","Tata Steel","NSE:TATASTEEL","NSE"],
  ["JSWSTEEL","JSW Steel","NSE:JSWSTEEL","NSE"],
  ["ONGC","ONGC Ltd","NSE:ONGC","NSE"],
  ["COALINDIA","Coal India","NSE:COALINDIA","NSE"],
  ["GRASIM","Grasim Industries","NSE:GRASIM","NSE"],
  ["HEROMOTOCO","Hero MotoCorp","NSE:HEROMOTOCO","NSE"],
  ["BAJAJFINSV","Bajaj Finserv","NSE:BAJAJFINSV","NSE"],
  ["TITAN","Titan Company","NSE:TITAN","NSE"],
  ["ADANIENT","Adani Enterprises","NSE:ADANIENT","NSE"],
  ["ADANIPORTS","Adani Ports","NSE:ADANIPORTS","NSE"],
  ["DIVISLAB","Divi's Laboratories","NSE:DIVISLAB","NSE"],
  ["CIPLA","Cipla Ltd","NSE:CIPLA","NSE"],
  ["DRREDDY","Dr. Reddy's Labs","NSE:DRREDDY","NSE"],
  ["EICHERMOT","Eicher Motors","NSE:EICHERMOT","NSE"],
  ["BPCL","Bharat Petroleum","NSE:BPCL","NSE"],
  ["INDUSINDBK","IndusInd Bank","NSE:INDUSINDBK","NSE"],
  ["M&M","Mahindra & Mahindra","NSE:M&M","NSE"],
  ["APOLLOHOSP","Apollo Hospitals","NSE:APOLLOHOSP","NSE"],
  ["TATACONSUM","Tata Consumer Products","NSE:TATACONSUM","NSE"],
  ["HINDALCO","Hindalco Industries","NSE:HINDALCO","NSE"],
  ["VEDL","Vedanta Ltd","NSE:VEDL","NSE"],
  ["ZOMATO","Zomato Ltd","NSE:ZOMATO","NSE"],
  ["PAYTM","One97 Communications (Paytm)","NSE:PAYTM","NSE"],
  ["NYKAA","FSN E-Commerce (Nykaa)","NSE:NYKAA","NSE"],
  ["POLICYBZR","PB Fintech (PolicyBazaar)","NSE:POLICYBZR","NSE"],
  ["IRCTC","IRCTC Ltd","NSE:IRCTC","NSE"],
];

function buildTickerList(): MvTicker[] {
  const tickers: MvTicker[] = [];

  for (const [symbol, display, name, digits] of FOREX_PAIRS) {
    const isMetal = /^(XAU|XAG|XPT|XPD)/.test(symbol);
    tickers.push({ symbol, display, name, category: isMetal ? "commodities" : "forex", digits: digits ?? 5 });
  }

  for (const item of CRYPTO_PAIRS) {
    const [symbol, display, name] = item;
    tickers.push({ symbol, display, name, category: "crypto", digits: 2 });
  }

  for (const [symbol, name] of STOCK_LIST) {
    tickers.push({ symbol, display: symbol, name, category: "stocks", digits: 2, exchange: "NYSE/NASDAQ" });
  }

  for (const [symbol, name, feed, exchange] of BSE_STOCKS) {
    tickers.push({ symbol, display: symbol, name, category: "stocks", digits: 2, feed, exchange });
  }

  return tickers;
}

// Cached ticker list — rebuilt on first request after server start
let cache: MvTicker[] | null = null;

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  if (!cache) cache = buildTickerList();

  const existing = await prisma.globalSymbol.findMany({ select: { symbol: true } });
  const existingSet = new Set(existing.map((e) => e.symbol));

  return NextResponse.json({ ok: true, tickers: cache, existing: [...existingSet] });
}

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const { tickers }: { tickers: MvTicker[] } = await req.json();
    if (!Array.isArray(tickers) || !tickers.length) return NextResponse.json({ ok: false, error: "No tickers provided" });

    let added = 0, skipped = 0;
    for (const t of tickers) {
      if (!t.symbol) { skipped++; continue; }
      const existing = await prisma.globalSymbol.findFirst({ where: { symbol: t.symbol } });
      if (existing) { skipped++; continue; }
      await prisma.globalSymbol.create({
        data: { symbol: t.symbol, display: t.display, category: t.category, digits: t.digits, enabled: true, ...(t.feed ? { feed: t.feed } : {}) },
      });
      added++;
    }
    if (added > 0) reloadCatalog();
    return NextResponse.json({ ok: true, added, skipped });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 500 });
  }
}
