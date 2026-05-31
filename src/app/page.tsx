import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ROLE_HOME } from "@/config/roles";

export default async function Home() {
  const s = await getSession();
  if (!s) redirect("/login");
  redirect(ROLE_HOME[s.role]);
}
