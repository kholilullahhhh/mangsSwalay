import {
  BadgePercent,
  Banknote,
  BarChart3,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardList,
  Coins,
  FileClock,
  LayoutDashboard,
  Package,
  Receipt,
  ScanBarcode,
  Settings,
  ShieldAlert,
  ShoppingCart,
  Tags,
  Truck,
  Undo2,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import {
  roleHasPermission,
  type Permission,
  type RoleName,
} from "@/lib/rbac";

/**
 * Sidebar navigation.
 *
 * Each item declares the permission it requires. `getNavGroupsForRole` filters
 * items by role so the menu matches what the user can actually do — but this is
 * presentation only. Every linked page re-checks the same permission on the
 * server via `requirePermission`, so hiding an item is never the enforcement.
 */

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  permission: Permission;
  /** Renders a count badge from a live query. */
  badgeKey?: "unreadNotifications" | "lowStock" | "unclosedShift";
  description?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "",
    items: [
      {
        title: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        permission: "dashboard:view",
        description: "Ringkasan bisnis hari ini",
      },
    ],
  },
  {
    label: "Operasional",
    items: [
      {
        title: "POS / Kasir",
        href: "/pos",
        icon: ScanBarcode,
        permission: "pos:use",
        description: "Transaksi penjualan",
      },
      {
        title: "Penjualan",
        href: "/sales",
        icon: Receipt,
        permission: "sales:view",
      },
      {
        title: "Riwayat Penjualan Saya",
        href: "/sales/my",
        icon: ShoppingCart,
        permission: "sales:view-own",
      },
      {
        title: "Retur Penjualan",
        href: "/sales/returns",
        icon: Undo2,
        permission: "sales:refund",
      },
      {
        title: "Shift Kasir",
        href: "/shifts",
        icon: Wallet,
        permission: "shifts:view-own",
        badgeKey: "unclosedShift",
      },
    ],
  },
  {
    label: "Inventori",
    items: [
      {
        title: "Produk",
        href: "/products",
        icon: Package,
        permission: "products:view",
      },
      {
        title: "Kategori",
        href: "/categories",
        icon: Tags,
        permission: "categories:view",
      },
      {
        title: "Stok",
        href: "/inventory",
        icon: Boxes,
        permission: "stock:view",
        badgeKey: "lowStock",
      },
      {
        title: "Stock Opname",
        href: "/inventory/opname",
        icon: ClipboardList,
        permission: "stock:opname",
      },
      {
        title: "Batch & Expiry",
        href: "/inventory/batches",
        icon: CalendarClock,
        permission: "stock:batches",
      },
      {
        title: "Pergerakan Stok",
        href: "/inventory/movements",
        icon: FileClock,
        permission: "stock:view",
      },
    ],
  },
  {
    label: "Pembelian",
    items: [
      {
        title: "Pembelian",
        href: "/purchases",
        icon: ShoppingCart,
        permission: "purchases:view",
      },
      {
        title: "Supplier",
        href: "/suppliers",
        icon: Truck,
        permission: "suppliers:view",
      },
    ],
  },
  {
    label: "Pelanggan",
    items: [
      {
        title: "Pelanggan",
        href: "/customers",
        icon: Users,
        permission: "customers:view",
      },
      {
        title: "Member & Loyalty",
        href: "/customers/loyalty",
        icon: Coins,
        permission: "customers:view",
      },
    ],
  },
  {
    label: "Pemasaran",
    items: [
      {
        title: "Promo",
        href: "/promotions",
        icon: BadgePercent,
        permission: "promotions:view",
      },
    ],
  },
  {
    label: "Keuangan",
    items: [
      {
        title: "Pengeluaran",
        href: "/expenses",
        icon: Banknote,
        permission: "expenses:view",
      },
      {
        title: "Arus Kas",
        href: "/cashflow",
        icon: Wallet,
        permission: "reports:sales",
      },
    ],
  },
  {
    label: "Laporan",
    items: [
      {
        title: "Laporan Penjualan",
        href: "/reports/sales",
        icon: BarChart3,
        permission: "reports:sales",
      },
      {
        title: "Laporan Produk",
        href: "/reports/products",
        icon: Package,
        permission: "reports:products",
      },
      {
        title: "Laporan Stok",
        href: "/reports/inventory",
        icon: Boxes,
        permission: "reports:inventory",
      },
      {
        title: "Laporan Pembelian",
        href: "/reports/purchases",
        icon: Truck,
        permission: "reports:purchases",
      },
      {
        title: "Laporan Profit",
        href: "/reports/profit",
        icon: Coins,
        permission: "reports:profit",
      },
    ],
  },
  {
    label: "Sistem",
    items: [
      {
        title: "Pengguna",
        href: "/users",
        icon: UserCog,
        permission: "users:view",
      },
      {
        title: "Audit Log",
        href: "/audit-log",
        icon: ShieldAlert,
        permission: "audit-log:view",
      },
      {
        title: "Notifikasi",
        href: "/notifications",
        icon: Building2,
        permission: "notifications:view",
        badgeKey: "unreadNotifications",
      },
      {
        title: "Pengaturan",
        href: "/settings",
        icon: Settings,
        permission: "settings:view",
      },
    ],
  },
];

/**
 * Filters the nav down to the items a role may see.
 *
 * Also collapses any group left with no visible items, so a cashier doesn't see
 * an empty "Laporan" heading.
 */
export function getNavGroupsForRole(role: RoleName): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      roleHasPermission(role, item.permission),
    ),
  })).filter((group) => group.items.length > 0);
}

/**
 * The five most important destinations for a role, used for the mobile bottom
 * navigation where screen space is scarce.
 */
export const MOBILE_NAV_PRIORITY: Record<RoleName, string[]> = {
  CASHIER: ["/pos", "/sales/my", "/shifts", "/customers", "/dashboard"],
  STOCK_OPERATOR: [
    "/inventory",
    "/products",
    "/purchases",
    "/inventory/opname",
    "/dashboard",
  ],
  MANAGER: [
    "/dashboard",
    "/reports/sales",
    "/inventory",
    "/sales",
    "/shifts",
  ],
  ADMIN: [
    "/dashboard",
    "/pos",
    "/products",
    "/purchases",
    "/reports/sales",
  ],
  SUPER_ADMIN: [
    "/dashboard",
    "/pos",
    "/products",
    "/reports/profit",
    "/users",
  ],
};

/**
 * Finds a nav item by href, for rendering the active state.
 */
export function findNavItem(href: string): NavItem | undefined {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (item.href === href) {
        return item;
      }
    }
  }
  return undefined;
}

/** Whether `pathname` is inside the nav item's section. */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}