"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function OutsourceRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/superadmin/tenants"); }, [router]);
  return null;
}
