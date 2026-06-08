"use client";
import { memo } from "react";

// MT5-style quote cell: colours the TEXT and shows an up/down caret on every price
// change (driven by `dir`: 1 = up, -1 = down, 0 = unchanged). No background fill.
// Memoized so during a tick burst only cells whose value/dir actually changed
// re-render — the heavy desk market watch then updates as smoothly as the client.
function PriceCell({ value, dir }: { value: string; dir: number }) {
  const up = dir > 0, down = dir < 0;
  const col = up ? "#16c784" : down ? "#e05260" : "var(--text)";
  return (
    <span className="tabular-nums" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 6px" }}>
      <span style={{ color: col, transition: "color 0.1s ease-out", display: "inline-flex", alignItems: "center", gap: 3 }}>
        {value}
        <i className={"fa-solid " + (up ? "fa-caret-up" : down ? "fa-caret-down" : "fa-minus")} style={{ fontSize: 8, opacity: up || down ? 0.95 : 0.2 }} />
      </span>
    </span>
  );
}
export default memo(PriceCell);
