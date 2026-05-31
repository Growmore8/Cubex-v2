export function contractFor(category: string, symbol: string): number {
  if (symbol === "XAGUSD") return 5000;
  if (category === "metals") return 100;
  if (category === "crypto") return 1;
  if (category === "stocks" || category === "indices") return 1;
  return 100000;
}