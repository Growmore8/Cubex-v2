import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { saveUpload } from "@/lib/upload";

// Upload a tenant logo image. Returns a public URL to store as tenant.logoUrl.
export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file || file.size === 0) throw new Error("No image selected");
    const key = await saveUpload(file, "logos"); // -> "logos/<uuid>_<name>"
    const name = key.slice("logos/".length);
    return NextResponse.json({ ok: true, url: "/api/files/logo/" + encodeURIComponent(name) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Upload failed" }, { status: 400 });
  }
}
