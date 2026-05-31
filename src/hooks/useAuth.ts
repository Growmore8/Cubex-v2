"use client";
import { useEffect } from "react";
import { useGlobalStore } from "@/store/globalStore";

export function useAuth() {
  const { user, setUser } = useGlobalStore();
  useEffect(() => {
    let active = true;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => { if (active) setUser(d.ok ? d.user : null); })
      .catch(() => {});
    return () => { active = false; };
  }, [setUser]);
  return user;
}
