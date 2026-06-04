export const ROLES = {
  SUPERADMIN: "SUPERADMIN",
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  CLIENT: "CLIENT",
} as const;

export type Role = keyof typeof ROLES;

export const ROLE_HOME: Record<Role, string> = {
  SUPERADMIN: "/superadmin",
  ADMIN: "/admin/platform",
  MANAGER: "/manager",
  CLIENT: "/client",
};

export const ROLE_RANK: Record<Role, number> = {
  SUPERADMIN: 4,
  ADMIN: 3,
  MANAGER: 2,
  CLIENT: 1,
};

export function canAccess(userRole: Role, required: Role) {
  return ROLE_RANK[userRole] >= ROLE_RANK[required];
}

