import type { Role } from "@/config/roles";

export interface SessionPayload {
  sub: string;
  role: Role;
  tenantId: string | null;
  email: string;
  name: string;
  sid?: string; // active-session id for single-device enforcement (staff roles)
}
