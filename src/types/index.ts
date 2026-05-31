import type { Role } from "@/config/roles";

export interface SessionPayload {
  sub: string;
  role: Role;
  tenantId: string | null;
  email: string;
  name: string;
}
