"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function DeskRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/admin/platform"); }, [router]);
  return null;
}
