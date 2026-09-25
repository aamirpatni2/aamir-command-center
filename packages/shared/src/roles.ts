export const ROLES = ["owner", "admin", "operator", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Single source of truth for authorization. The API enforces it; the web UI
 * only uses it to hide controls.
 */
export const PERMISSIONS = {
  "users:read": ["owner", "admin"],
  "users:manage": ["owner"],
  "audit:read": ["owner", "admin"],
  "leads:read": ["owner", "admin", "operator", "viewer"],
  "leads:write": ["owner", "admin", "operator"],
  "leads:delete": ["owner", "admin"],
  "students:read": ["owner", "admin", "operator", "viewer"],
  "students:write": ["owner", "admin", "operator"],
  "courses:read": ["owner", "admin", "operator", "viewer"],
  "courses:write": ["owner", "admin"],
  "content:read": ["owner", "admin", "operator", "viewer"],
  "content:write": ["owner", "admin", "operator"],
  "campaigns:read": ["owner", "admin", "operator", "viewer"],
  "campaigns:write": ["owner", "admin"],
  "tasks:read": ["owner", "admin", "operator", "viewer"],
  "tasks:create": ["owner", "admin", "operator"],
  "tasks:cancel": ["owner", "admin", "operator"],
  "approvals:read": ["owner", "admin", "operator", "viewer"],
  "approvals:decide": ["owner", "admin"],
  "approvals:decide_financial": ["owner"],
  "knowledge:read": ["owner", "admin", "operator", "viewer"],
  "knowledge:write": ["owner", "admin", "operator"],
  "knowledge:approve": ["owner", "admin"],
  "automations:read": ["owner", "admin", "operator", "viewer"],
  "automations:manage": ["owner"],
  "mcp:read": ["owner", "admin"],
  "mcp:manage": ["owner"],
  "analytics:read": ["owner", "admin", "operator", "viewer"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => hasPermission(role, p));
}
