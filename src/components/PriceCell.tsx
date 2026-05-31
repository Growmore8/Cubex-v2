"use client";
export default function PriceCell({ value, dir }: { value: string; dir: number }) {
  return (
    <span className="tabular-nums" style={{ position: "relative", alignSelf: "stretch", display: "flex", alignItems: "center", justifyContent: "flex-end", overflow: "hidden", padding: "0 8px" }}>
      <span style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, transparent, rgba(22,199,132,0.5))", opacity: dir > 0 ? 1 : 0, transition: "opacity 0.7s ease", pointerEvents: "none" }} />
      <span style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, transparent, rgba(224,82,96,0.5))", opacity: dir < 0 ? 1 : 0, transition: "opacity 0.7s ease", pointerEvents: "none" }} />
      <span style={{ position: "relative", color: dir > 0 ? "#16c784" : dir < 0 ? "#e05260" : "var(--text)", transition: "color 0.7s ease" }}>{value}</span>
    </span>
  );
}
