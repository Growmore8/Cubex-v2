import { prisma } from "@/lib/prisma";

export interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  datetime: number; // Unix seconds
  image?: string;
}

async function getFinnhubKey(): Promise<string> {
  try {
    const rec = await prisma.setting.findUnique({ where: { key: "feeds" } });
    const v: any = (rec && rec.value) || {};
    if (typeof v.finnhubKey === "string" && v.finnhubKey.trim()) return v.finnhubKey.trim();
  } catch {}
  return process.env.FINNHUB_KEY || "";
}

export async function fetchForexNews(category = "forex"): Promise<NewsItem[]> {
  const token = await getFinnhubKey();

  if (token) {
    try {
      const r = await fetch(
        `https://finnhub.io/api/v1/news?category=${category}&token=${token}`,
        { next: { revalidate: 1800 } },
      );
      if (r.ok) {
        const data: any[] = await r.json();
        return data.slice(0, 30).map((item) => ({
          id: String(item.id ?? Math.random()),
          headline: String(item.headline || ""),
          summary: String(item.summary || ""),
          source: String(item.source || ""),
          url: String(item.url || ""),
          datetime: Number(item.datetime) || 0,
          image: item.image || undefined,
        }));
      }
    } catch {}
  }

  // Fallback: free public RSS feeds when no Finnhub key is configured
  return fetchRssFallback();
}

async function fetchRssFallback(): Promise<NewsItem[]> {
  const feeds = [
    "https://www.forexlive.com/feed/news/",
    "https://www.fxstreet.com/rss/news",
  ];

  for (const feedUrl of feeds) {
    try {
      const r = await fetch(feedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CubeX/1.0)" },
        next: { revalidate: 1800 },
      });
      if (!r.ok) continue;
      const xml = await r.text();
      const items = parseRssXml(xml, new URL(feedUrl).hostname.replace(/^www\./, ""));
      if (items.length) return items;
    } catch {}
  }
  return [];
}

function parseRssXml(xml: string, defaultSource: string): NewsItem[] {
  const items: NewsItem[] = [];
  let counter = 0;
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const block of blocks) {
    const headline = stripCdata(extractTag(block, "title"));
    const url = stripCdata(extractTag(block, "link") || extractTag(block, "guid"));
    const source = stripCdata(extractTag(block, "dc:creator") || extractTag(block, "source") || defaultSource);
    const pubDate = extractTag(block, "pubDate");
    const summary = stripCdata(extractTag(block, "description")).replace(/<[^>]+>/g, "").trim();
    const datetime = pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : Math.floor(Date.now() / 1000);
    if (headline && url) {
      items.push({ id: `rss-${++counter}`, headline, summary, source, url, datetime });
    }
    if (items.length >= 20) break;
  }
  return items;
}

function extractTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\s\S]*?)<\/${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function stripCdata(s: string): string {
  return s.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}
