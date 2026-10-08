import { type Metadata } from "next";

import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { DashboardShell } from "@/components/dashboard/shell";
import { getNavGroupsForRole, type NavGroup } from "@/components/dashboard/nav-config";

export const metadata: Metadata = {
  title: {
    default: "Dashboard",
    template: "%s — Swalayaku",
  },
};

/**
 * Dashboard shell layout.
 *
 * Auth is verified here *and* re-verified in each page. A layout is not a
 * security boundary: layouts do not re-run on every navigation, and the router
 * renders nested segments regardless of what the layout decides to show. So the
 * layout guards the shell for UX, while `requirePermission` inside every page
 * and Server Action is what actually protects data.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  // Only fetch what the sidebar and topbar render.
  const [unreadCount, openShift] = await Promise.all([
    // Broadcast alerts (`userId: null`) count too. Every stock and expiry
    // notification the system raises is a broadcast, so filtering to this user's
    // own rows left the bell permanently at zero while the notifications page
    // listed alerts — the two screens disagreed about the same data.
    prisma.notification.count({
      where: { isRead: false, OR: [{ userId: user.id }, { userId: null }] },
    }),
    prisma.cashShift.findFirst({
      where: { userId: user.id, status: "OPEN" },
      select: { id: true, number: true, openedAt: true },
    }),
  ]);

  const navGroups: NavGroup[] = getNavGroupsForRole(user.role);

  return (
    <DashboardShell
      user={user}
      navGroups={navGroups}
      unreadCount={unreadCount}
      openShift={openShift}
    >
      {children}
    </DashboardShell>
  );
}

/** The shell renders its children; this exists only for the root index route. */
export function ContentIndex() {
  return null;
}