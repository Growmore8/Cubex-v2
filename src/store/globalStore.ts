import { create } from "zustand";
import type { Role } from "@/config/roles";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenantId: string | null;
}

interface GlobalState {
  user: AuthUser | null;
  setUser: (u: AuthUser | null) => void;
}

export const useGlobalStore = create<GlobalState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}));
