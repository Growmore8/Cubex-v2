const FEEDS = [
  { url: "https://www.fxstreet.com/rss/news", source: "FXStreet" },
  { url: "https://www.forexlive.com/feed/news", source: "ForexLive" },
  { url: "https://www.investing.com/rss/news_285.rss", source: "Investing.com" },
];

function parseDate(str: string | null): number {
  if (!str) return 0;
  const d = new Date(str);
  return isNaN(d.getTime()) ? 0 : Math.floor(d.getTime() / 1000);
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  if (!m) return "";
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function parseItems(xml: string, source: string): any[] {
  const items: any[] = [];
  const itemRx = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRx.exec(xml)) !== null) {
    const block = m[1];
    const headline = tag(block, "title");
    const url = tag(block, "link") || tag(block, "guid");
    const summary = tag(block, "description");
    const datetime = parseDate(tag(block, "pubDate"));
    if (!headline || !url) continue;
    items.push({ id: url, headline, summary: summary.slice(0, 200), url, source, datetime, image: null });
  }
  return items;
}

async function fetchFeed(feed: { url: string; source: string }): Promise<any[]> {
  try {
    const r = await fetch(feed.url, { next: { revalidate: 300 }, headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return [];
    const xml = await r.text();
    return parseItems(xml, feed.source);
  } catch {
    return [];
  }
}

export async function fetchForexNews(): Promise<any[]> {
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const all: any[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
  }
  // deduplicate by url, sort newest first
  const seen = new Set<string>();
  return all
    .filter((n) => { if (seen.has(n.url)) return false; seen.add(n.url); return true; })
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, 50);
}
