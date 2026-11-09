export const STAFF_PERMISSIONS = [
  "users", "vendors", "products", "orders", "wallets", "support",
  "categories", "logs", "mirrors", "broadcast", "system",
] as const;

export const MODERATOR_PERMISSIONS = ["products", "orders", "support"] as const;

export type StaffPermission = typeof STAFF_PERMISSIONS[number];

export function hasStaffPermission(
  account: { role: string; isBanned: boolean; staffPermissions: string[] } | null,
  permission: StaffPermission,
): boolean {
  return !!account && !account.isBanned && (
    account.role === "ADMIN" || (account.role === "STAFF" && MODERATOR_PERMISSIONS.some((item) => item === permission) && account.staffPermissions.includes(permission))
  );
}
