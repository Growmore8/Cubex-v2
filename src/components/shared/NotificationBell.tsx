"use client";
import { useEffect, useState } from "react";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);

  async function load() {
    const d = await fetch("/api/notifications").then((r) => r.json());
    if (d.ok) { setItems(d.items); setUnread(d.unread); }
  }
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);

  async function openAndRead() {
    setOpen((v) => !v);
    if (!open && unread > 0) { await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); setUnread(0); }
  }

  return (
    <div className="relative">
      <button onClick={openAndRead} className="relative rounded-md border px-2 py-1 text-sm">
        Bell
        {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-xs text-white">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 max-h-80 w-72 overflow-auto rounded-lg border bg-white shadow-lg">
          {items.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-500">No notifications.</div>
          ) : items.map((n) => (
            <div key={n.id} className="border-b px-3 py-2 text-sm last:border-0">
              <div className="font-medium">{n.title}</div>
              {n.body && <div className="text-gray-600">{n.body}</div>}
              <div className="text-xs text-gray-400">{new Date(n.createdAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
