"use client";
import { memo } from "react";

// MT5-style quote cell: flashes a green/red background on each tick and colours
// the text. Background fades back to transparent as `dir` resets to 0 (~650ms).
// Memoized so during a tick burst only cells whose value/dir actually changed
// re-render — the heavy desk market watch then updates as smoothly as the client.
function PriceCell({ value, dir }: { value: string; dir: number }) {
  const up = dir > 0, down = dir < 0;
  const col = up ? "#16c784" : down ? "#e05260" : "var(--text)";
  const bg = up ? "rgba(22,199,132,0.13)" : down ? "rgba(224,82,96,0.13)" : "transparent";
  return (
    <span className="tabular-nums" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 6px", borderRadius: 3, background: bg, transition: "background 0.55s ease-out" }}>
      <span style={{ color: col, transition: "color 0.12s ease-out", display: "inline-flex", alignItems: "center", gap: 3 }}>
        {value}
        <i className={"fa-solid " + (up ? "fa-caret-up" : down ? "fa-caret-down" : "fa-minus")} style={{ fontSize: 8, opacity: up || down ? 0.95 : 0.2 }} />
      </span>
    </span>
  );
}
export default memo(PriceCell);
