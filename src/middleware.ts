import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/jwt";
import { ROLE_RANK, type Role } from "@/config/roles";

const PROTECTED: { prefix: string; role: Role }[] = [
  { prefix: "/superadmin", role: "SUPERADMIN" },
  // Admin + Manager share the /admin platform (manager rank 2). Finer limits
  // are enforced per-API (requireAdmin / assertCan) and in the UI.
  { prefix: "/admin", role: "MANAGER" },
  { prefix: "/manager", role: "MANAGER" },
  { prefix: "/client", role: "CLIENT" },
];

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const host = (req.headers.get("host") || "").split(":")[0].toLowerCase();
  const root = (process.env.ROOT_DOMAIN || "localhost:3000").split(":")[0].toLowerCase();

  let sub = "";
  if (host && host !== "localhost" && host !== "127.0.0.1" && host !== root) {
    if (host.endsWith("." + root)) sub = host.slice(0, -(root.length + 1));
    else if (host.endsWith(".localhost")) sub = host.slice(0, -(".localhost".length));
  }
  if (sub) res.headers.set("x-tenant-subdomain", sub);

  const path = req.nextUrl.pathname;
  const rule = PROTECTED.find((r) => path === r.prefix || path.startsWith(r.prefix + "/"));
  if (rule) {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const session = token ? await verifySession(token) : null;
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", path);
      return NextResponse.redirect(url);
    }
    if (ROLE_RANK[session.role] < ROLE_RANK[rule.role]) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
