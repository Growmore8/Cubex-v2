import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/guard";
import { listGroups, createGroup } from "@/services/group.service";

export async function GET() {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const groups = await listGroups(s.tenantId!);
  return NextResponse.json({ ok: true, groups: groups.map((g) => ({ id: g.id, name: g.name, spread: Number(g.spread) })) });
}

const schema = z.object({ name: z.string().min(1), spread: z.number().optional() });

export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const input = schema.parse(await req.json());
    const g = await createGroup(s.tenantId!, input);
    return NextResponse.json({ ok: true, group: { id: g.id, name: g.name, spread: Number(g.spread) } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
