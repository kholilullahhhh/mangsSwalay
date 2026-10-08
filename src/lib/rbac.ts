/**
 * Role-Based Access Control for Swalayaku.
 *
 * Authorisation is enforced on the server. The sidebar and any client-side
 * conditional rendering only ever *mirror* what these permissions allow —
 * hiding a menu item is a UX affordance, never the security boundary. Every
 * Server Action and Route Handler calls `requirePermission` (or
 * `requireRole`) before touching the database.
 */

/** Every discrete capability in the system. */
export const PERMISSIONS = [
  // Dashboard
  "dashboard:view",
  "dashboard:cashier-performance",

  // Point of sale
  "pos:use",
  "pos:hold-transaction",
  "pos:apply-discount",

  // Sales
  "sales:view",
  "sales:view-own",
  "sales:create",
  "sales:void",
  "sales:refund",

  // Products & catalogue
  "products:view",
  "products:create",
  "products:update",
  "products:delete",
  "products:import",
  "products:export",

  "categories:view",
  "categories:manage",

  // Inventory
  "stock:view",
  "stock:adjust",
  "stock:opname",
  "stock:opname-approve",
  "stock:batches",

  // Purchasing
  "purchases:view",
  "purchases:create",
  "purchases:update",
  "purchases:receive",
  "purchases:cancel",

  "suppliers:view",
  "suppliers:manage",

  // Customers & loyalty
  "customers:view",
  "customers:manage",

  // Marketing
  "promotions:view",
  "promotions:manage",

  // Finance
  "expenses:view",
  "expenses:manage",
  "shifts:view-own",
  "shifts:view-all",
  "shifts:open",
  "shifts:close",

  // Reports
  "reports:sales",
  "reports:products",
  "reports:inventory",
  "reports:purchases",
  "reports:profit",
  "reports:cashflow",

  // System
  "users:view",
  "users:manage",
  "audit-log:view",
  "notifications:view",
  "notifications:manage",
  "settings:view",
  "settings:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Roles, mirroring the `Role` enum in the Prisma schema. */
export const ROLES = [
  "SUPER_ADMIN",
  "ADMIN",
  "MANAGER",
  "CASHIER",
  "STOCK_OPERATOR",
] as const;

export type RoleName = (typeof ROLES)[number];

const ALL_PERMISSIONS = new Set<string>(PERMISSIONS);

/**
 * Permission grants per role.
 *
 * SUPER_ADMIN is handled separately as a wildcard so that new permissions are
 * never accidentally withheld from it.
 */
const ROLE_PERMISSIONS: Record<RoleName, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,

  ADMIN: [
    "dashboard:view",
    "dashboard:cashier-performance",
    "pos:use",
    "pos:hold-transaction",
    "pos:apply-discount",
    "sales:view",
    "sales:create",
    "sales:void",
    "sales:refund",
    "products:view",
    "products:create",
    "products:update",
    "products:delete",
    "products:import",
    "products:export",
    "categories:view",
    "categories:manage",
    "stock:view",
    "stock:adjust",
    "stock:opname",
    "stock:opname-approve",
    "stock:batches",
    "purchases:view",
    "purchases:create",
    "purchases:update",
    "purchases:receive",
    "purchases:cancel",
    "suppliers:view",
    "suppliers:manage",
    "customers:view",
    "customers:manage",
    "promotions:view",
    "promotions:manage",
    "expenses:view",
    "expenses:manage",
    "shifts:view-own",
    "shifts:view-all",
    "shifts:open",
    "shifts:close",
    "reports:sales",
    "reports:products",
    "reports:inventory",
    "reports:purchases",
"reports:profit",
    "reports:cashflow",
    "notifications:view",
    "notifications:manage",
    "settings:view",
    "audit-log:view",
    // Note: ADMIN deliberately cannot manage users/roles or system settings.
  ],

  MANAGER: [
    "dashboard:view",
    "dashboard:cashier-performance",
    "sales:view",
    "sales:void",
    "sales:refund",
    "products:view",
    "products:export",
    "categories:view",
    "stock:view",
    "stock:opname-approve",
    "stock:batches",
    "purchases:view",
    "purchases:create",
    "purchases:update",
    "purchases:receive",
    "suppliers:view",
    "suppliers:manage",
    "customers:view",
    "promotions:view",
"expenses:view",
    "expenses:manage",
    "shifts:view-all",
    // A manager who supervises the till still has their own drawer, and the
    // "your open shift" panel is part of that screen. Without this the page 403s
    // outright, because it gates on `shifts:view-own` before looking at
    // `shifts:view-all`.
    "shifts:view-own",
    "reports:sales",
    "reports:products",
    "reports:inventory",
    "reports:purchases",
"reports:profit",
    "reports:cashflow",
    "notifications:view",
    "notifications:manage",
  ],

  // A cashier can only transact. Note `sales:view-own` instead of
  // `sales:view` so the server filters sales queries to their own records.
  CASHIER: [
    "dashboard:view",
    "pos:use",
    "pos:hold-transaction",
    "sales:view-own",
    "sales:create",
    "customers:view",
    "customers:manage",
    "products:view",
    "stock:view",
    "shifts:view-own",
    "shifts:open",
    "shifts:close",
"promotions:view",
    // The topbar notification bell is rendered for every signed-in user, so
    // every role needs to be able to open the target. Stock and expiry alerts
    // are a shop-floor concern, not an office one.
    "notifications:view",
  ],

  STOCK_OPERATOR: [
    "dashboard:view",
    "products:view",
    "products:create",
    "products:update",
    "products:import",
    "categories:view",
    "stock:view",
    "stock:adjust",
    "stock:opname",
    "stock:batches",
    "purchases:view",
    "purchases:create",
    "purchases:receive",
    "suppliers:view",
    "suppliers:manage",
    "expenses:view",
    "notifications:view",
  ],
};

/** All permissions granted to a role. */
export function permissionsForRole(role: RoleName): readonly Permission[] {
  if (role === "SUPER_ADMIN") {
    return PERMISSIONS;
  }
  return ROLE_PERMISSIONS[role] ?? [];
}

/** Whether a role holds a specific permission. */
export function roleHasPermission(
  role: RoleName,
  permission: Permission,
): boolean {
  return permissionsForRole(role).includes(permission);
}

/** Whether a role holds every one of the given permissions. */
export function roleHasAll(
  role: RoleName,
  permissions: readonly Permission[],
): boolean {
  return permissions.every((p) => roleHasPermission(role, p));
}

/**
 * Whether the role holds at least one of the given permissions.
 * Useful for pages that several roles may reach by different routes.
 */
export function roleHasAny(
  role: RoleName,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((p) => roleHasPermission(role, p));
}

/** Every permission name, for validation and admin tooling. */
export const ALL_PERMISSION_NAMES: readonly string[] = [...ALL_PERMISSIONS];

export const ROLE_LABELS: Record<RoleName, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  MANAGER: "Manager",
  CASHIER: "Kasir",
  STOCK_OPERATOR: "Operator Gudang",
};

export const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  SUPER_ADMIN: "Akses penuh ke seluruh sistem, termasuk pengguna dan pengaturan.",
  ADMIN: "Mengelola operasional toko: produk, stok, pembelian, dan laporan.",
  MANAGER: "Memantau kinerja, laporan, stok, dan aktivitas kasir.",
  CASHIER: "Melayani transaksi penjualan dan mencetak struk.",
  STOCK_OPERATOR: "Mengelola stok, produk, penerimaan barang, dan stock adjustment.",
};
