import {
  BadgePercent,
  Banknote,
  BarChart3,
  Bell,
  Boxes,
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
 * Maps a nav item's icon name to its component.
 *
 * This lives in a client module because the resolved components are only ever
 * rendered on the client. The server layout passes icon *names* across the RSC
 * boundary; the lookup happens here, at render time.
 */
export const NAV_ICONS: Record<NavIconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  pos: ScanBarcode,
  sales: Receipt,
  salesOwn: ShoppingCart,
  returns: Undo2,
  shift: Wallet,
  product: Package,
  category: Tags,
  stock: Boxes,
  opname: ClipboardList,
  batch: CalendarClock,
  movement: FileClock,
  purchase: ShoppingCart,
  supplier: Truck,
  customer: Users,
  loyalty: Coins,
  promotion: BadgePercent,
  expense: Banknote,
  cashflow: Wallet,
  reportSales: BarChart3,
  reportProduct: Package,
  reportStock: Boxes,
  reportPurchase: Truck,
  reportProfit: Coins,
  users: UserCog,
  audit: ShieldAlert,
  notification: Bell,
  settings: Settings,
};

/**
 * Sidebar navigation.
 *
 * Each item declares the permission it requires. `getNavGroupsForRole` filters
 * items by role so the menu matches what the user can actually do — but this is
 * presentation only. Every linked page re-checks the same permission on the
 * server via `requirePermission`, so hiding an item is never the enforcement.
 *
 * Icons are referenced by NAME, not by component. The nav config is built in a
 * Server Component (the dashboard layout) and handed to the client shell; a
 * component function cannot cross that boundary, so the client resolves the
 * name through `NAV_ICONS` at render time.
 */

/** Icon identifiers usable in nav items. */
export const NAV_ICON_NAMES = [
  "dashboard",
  "pos",
  "sales",
  "salesOwn",
  "returns",
  "shift",
  "product",
  "category",
  "stock",
  "opname",
  "batch",
  "movement",
  "purchase",
  "supplier",
  "customer",
  "loyalty",
  "promotion",
  "expense",
  "cashflow",
  "reportSales",
  "reportProduct",
  "reportStock",
  "reportPurchase",
  "reportProfit",
  "users",
  "audit",
  "notification",
  "settings",
] as const;

export type NavIconName = (typeof NAV_ICON_NAMES)[number];

export interface NavItem {
  title: string;
  href: string;
  /** Resolved to a component by `NAV_ICONS` inside the client shell. */
  icon: NavIconName;
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
        icon: "dashboard",
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
        icon: "pos",
        permission: "pos:use",
        description: "Transaksi penjualan",
      },
      {
        title: "Penjualan",
        href: "/sales",
        icon: "sales",
        permission: "sales:view",
      },
      {
        title: "Riwayat Penjualan Saya",
        href: "/sales/my",
        icon: "salesOwn",
        permission: "sales:view-own",
      },
      {
        title: "Retur Penjualan",
        href: "/sales/returns",
        icon: "returns",
        permission: "sales:refund",
      },
      {
        title: "Shift Kasir",
        href: "/shifts",
        icon: "shift",
        permission: "shifts:view-own",
        badgeKey: "unclosedShift",
      },
    ],
  },
  {
    label: "Inventori",
    items: [
      { title: "Produk", href: "/products", icon: "product", permission: "products:view" },
      { title: "Kategori", href: "/categories", icon: "category", permission: "categories:view" },
      { title: "Stok", href: "/inventory", icon: "stock", permission: "stock:view", badgeKey: "lowStock" },
      { title: "Stock Opname", href: "/inventory/opname", icon: "opname", permission: "stock:opname" },
      { title: "Batch & Expiry", href: "/inventory/batches", icon: "batch", permission: "stock:batches" },
      { title: "Pergerakan Stok", href: "/inventory/movements", icon: "movement", permission: "stock:view" },
    ],
  },
  {
    label: "Pembelian",
    items: [
      { title: "Pembelian", href: "/purchases", icon: "purchase", permission: "purchases:view" },
      { title: "Supplier", href: "/suppliers", icon: "supplier", permission: "suppliers:view" },
    ],
  },
  {
    label: "Pelanggan",
    items: [
      { title: "Pelanggan", href: "/customers", icon: "customer", permission: "customers:view" },
      { title: "Member & Loyalty", href: "/customers/loyalty", icon: "loyalty", permission: "customers:view" },
    ],
  },
  {
    label: "Pemasaran",
    items: [
      { title: "Promo", href: "/promotions", icon: "promotion", permission: "promotions:view" },
    ],
  },
  {
    label: "Keuangan",
    items: [
      { title: "Pengeluaran", href: "/expenses", icon: "expense", permission: "expenses:view" },
      { title: "Arus Kas", href: "/cashflow", icon: "cashflow", permission: "reports:cashflow" },
    ],
  },
  {
    label: "Laporan",
    items: [
      { title: "Laporan Penjualan", href: "/reports/sales", icon: "reportSales", permission: "reports:sales" },
      { title: "Laporan Produk", href: "/reports/products", icon: "reportProduct", permission: "reports:products" },
      { title: "Laporan Stok", href: "/reports/inventory", icon: "reportStock", permission: "reports:inventory" },
      { title: "Laporan Pembelian", href: "/reports/purchases", icon: "reportPurchase", permission: "reports:purchases" },
      { title: "Laporan Profit", href: "/reports/profit", icon: "reportProfit", permission: "reports:profit" },
    ],
  },
  {
    label: "Sistem",
    items: [
      { title: "Pengguna", href: "/users", icon: "users", permission: "users:view" },
      { title: "Audit Log", href: "/audit-log", icon: "audit", permission: "audit-log:view" },
      { title: "Notifikasi", href: "/notifications", icon: "notification", permission: "notifications:view", badgeKey: "unreadNotifications" },
      { title: "Pengaturan", href: "/settings", icon: "settings", permission: "settings:view" },
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