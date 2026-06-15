"use client";
import { useState, useRef, useEffect, type CSSProperties } from "react";
import { COUNTRIES, flagUrl, codeForCountry } from "@/config/countries";

// Country picker with flag images and search. Stores the country name as value.
export default function CountrySelect({ value, onChange, className = "", style, placeholder = "Select country" }: {
  value?: string; onChange: (name: string) => void; className?: string; style?: CSSProperties; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const code = codeForCountry(value);
  const list = COUNTRIES.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div ref={ref} className={"relative" + (open ? " z-[300]" : "")}>
      <button type="button" onClick={() => setOpen((o) => !o)} className={className + " flex w-full items-center gap-2 text-left"} style={style}>
        {code && <img src={flagUrl(code)} alt="" className="h-[14px] w-[19px] shrink-0 rounded-sm object-cover" />}
        <span className={value ? "truncate" : "truncate text-gray-400"}>{value || placeholder}</span>
        <i className="fa-solid fa-chevron-down ml-auto text-[10px] opacity-60" />
      </button>
      {open && (
        <div className="ui-pop absolute z-[300] mt-1 max-h-64 w-full min-w-[200px] overflow-auto rounded-xl border bg-white shadow-lg" style={{ borderColor: "#e2e8f0" }}>
          <div className="sticky top-0 bg-white p-1.5">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="ui-input w-full px-2 py-1 text-sm text-gray-800" />
          </div>
          {list.map((c) => (
            <button key={c.code} type="button" onClick={() => { onChange(c.name); setOpen(false); setQ(""); }} className="ui-row flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm text-gray-800">
              <img src={flagUrl(c.code)} alt="" className="h-[14px] w-[19px] shrink-0 rounded-sm object-cover" />
              {c.name}
            </button>
          ))}
          {list.length === 0 && <div className="px-2.5 py-2 text-sm text-gray-400">No match</div>}
        </div>
      )}
    </div>
  );
}
