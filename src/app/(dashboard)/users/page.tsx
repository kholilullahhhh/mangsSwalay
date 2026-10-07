import type { Metadata } from "next";

import { hasPermission, requirePagePermission } from "@/lib/auth/session";
import { listUsers } from "@/lib/queries/catalog";
import { ROLES, ROLE_LABELS } from "@/lib/rbac";
import { UserTable } from "./user-table";

export const metadata: Metadata = {
  title: "Pengguna",
};

/**
 * Staff accounts and their roles.
 *
 * Roles are assigned here rather than at signup because a role grants
 * permissions across every screen, which makes it a management decision. Users
 * are deactivated rather than deleted: sales and shifts reference the cashier
 * who made them, so removing the row would break the audit trail.
 */
export default async function UsersPage() {
  await requirePagePermission("users:view");

  const [users, canManage] = await Promise.all([
    listUsers(),
    hasPermission("users:manage"),
  ]);

  const active = users.filter((user) => user.isActive).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Pengguna</h1>
        <p className="text-sm text-muted-foreground">
          {active} akun aktif dari {users.length}. Peran menentukan bagian toko
          yang bisa diakses.
        </p>
      </div>

      <UserTable
        users={users.map((user) => ({
          id: user.id,
          name: user.name,
          username: user.username,
          email: user.email,
          phone: user.phone,
          role: user.role,
          isActive: user.isActive,
          lastLoginAt: user.lastLoginAt,
          createdAt: user.createdAt,
          salesCount: user._count.sales,
        }))}
        canManage={canManage}
        roles={ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
      />
    </div>
  );
}