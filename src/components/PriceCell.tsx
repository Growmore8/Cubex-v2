"use client";

// MT5-style quote cell: tints the background and shows an up/down caret on every
// price change (driven by `dir`: 1 = up, -1 = down, 0 = unchanged).
export default function PriceCell({ value, dir }: { value: string; dir: number }) {
  const up = dir > 0, down = dir < 0;
  const col = up ? "#16c784" : down ? "#e05260" : "var(--text)";
  return (
    <span className="tabular-nums" style={{ position: "relative", alignSelf: "stretch", display: "flex", alignItems: "center", justifyContent: "flex-end", overflow: "hidden", padding: "0 6px" }}>
      <span style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, transparent, rgba(22,199,132,0.55))", opacity: up ? 1 : 0, transition: "opacity 0.12s ease-out", pointerEvents: "none" }} />
      <span style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, transparent, rgba(224,82,96,0.55))", opacity: down ? 1 : 0, transition: "opacity 0.12s ease-out", pointerEvents: "none" }} />
      <span style={{ position: "relative", color: col, transition: "color 0.1s ease-out", display: "inline-flex", alignItems: "center", gap: 3 }}>
        {value}
        <i className={"fa-solid " + (up ? "fa-caret-up" : down ? "fa-caret-down" : "fa-minus")} style={{ fontSize: 8, opacity: up || down ? 0.95 : 0.2 }} />
      </span>
    </span>
  );
}
