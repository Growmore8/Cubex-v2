import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

const ROOT = path.join(process.cwd(), "uploads");
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

// Verify the actual file content matches its claimed type — never trust the
// browser-supplied Content-Type alone (attackers can upload any file with image/jpeg).
function detectMime(buf: Buffer): string | null {
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return "image/webp"; // RIFF....WEBP
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "application/pdf"; // %PDF
  return null;
}

export async function saveUpload(file: File, subdir: string) {
  if (!file) throw new Error("No file");
  if (!ALLOWED.includes(file.type)) throw new Error("Only JPG, PNG, WEBP or PDF allowed");
  const buf = Buffer.from(await file.arrayBuffer());
  const actual = detectMime(buf);
  if (!actual || !ALLOWED.includes(actual)) throw new Error("File content does not match its type. Only JPG, PNG, WEBP or PDF allowed");
  if (buf.length > 10 * 1024 * 1024) throw new Error("Max file size is 10MB");
  const dir = path.join(ROOT, subdir);
  await fs.mkdir(dir, { recursive: true });
  const safe = (file.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = subdir + "/" + randomUUID() + "_" + safe;
  await fs.writeFile(path.join(ROOT, key), buf);
  return key;
}

export async function readUpload(key: string) {
  const full = path.join(ROOT, key);
  if (!full.startsWith(ROOT)) throw new Error("Invalid path");
  return fs.readFile(full);
}

export function contentType(key: string) {
  const ext = key.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}
