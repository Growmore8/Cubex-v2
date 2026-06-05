import { readUpload, contentType } from "@/lib/upload";

// Public: tenant logos are shown on login/register pages before auth.
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  try {
    const key = "logos/" + decodeURIComponent(name).replace(/[\\/]/g, ""); // prevent path traversal
    const buf = await readUpload(key);
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": contentType(key), "Cache-Control": "public, max-age=86400" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
