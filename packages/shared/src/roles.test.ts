import { describe, expect, it } from "vitest";
import { hasPermission, permissionsFor, PERMISSIONS, ROLES } from "./roles.js";

describe("RBAC", () => {
  it("owner has every permission", () => {
    expect(permissionsFor("owner")).toHaveLength(Object.keys(PERMISSIONS).length);
  });
  it("only owner can approve financial actions", () => {
    expect(ROLES.filter((r) => hasPermission(r, "approvals:decide_financial"))).toEqual(["owner"]);
  });
  it("operator can request tasks but cannot decide approvals", () => {
    expect(hasPermission("operator", "tasks:create")).toBe(true);
    expect(hasPermission("operator", "approvals:decide")).toBe(false);
  });
  it("viewer has no write permissions", () => {
    const writes = permissionsFor("viewer").filter((p) => !p.endsWith(":read"));
    expect(writes).toEqual([]);
  });
});
