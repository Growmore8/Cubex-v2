import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/guard";
import { deleteOpen } from "@/services/desk.service";
import { assertCan } from "@/lib/perms";

// Delete an open position (single). Bulk delete is done client-side by calling
// this per id, mirroring how "Close Selected" loops the close endpoint.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireStaff();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertCan(s, "deleteTrades");
    await deleteOpen(s, id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Delete failed" }, { status: 400 });
  }
}
