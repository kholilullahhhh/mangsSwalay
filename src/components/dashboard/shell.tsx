"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { Store } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";

import { isNavItemActive, type NavGroup } from "./nav-config";
import { DashboardTopbar } from "./topbar";

export interface DashboardShellProps {
  user: {
    id: string;
    name: string;
    username: string;
    role: import("@/lib/rbac").RoleName;
  };
  navGroups: NavGroup[];
  unreadCount: number;
  openShift: { id: string; number: string; openedAt: Date } | null;
  children: React.ReactNode;
}

/**
 * Application shell: collapsible sidebar + sticky topbar + content area.
 *
 * Wrapped in TooltipProvider so sidebar tooltips work; sidebar and topbar are
 * client components, while page content below stays a Server Component tree.
 */
export function DashboardShell({
  user,
  navGroups,
  unreadCount,
  openShift,
  children,
}: DashboardShellProps) {
  return (
    <SidebarProvider>
      <TooltipProvider>
        <AppSidebar
          navGroups={navGroups}
          user={user}
          unreadCount={unreadCount}
          hasOpenShift={Boolean(openShift)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <DashboardTopbar
            user={user}
            unreadCount={unreadCount}
            openShift={openShift}
          />
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </TooltipProvider>
    </SidebarProvider>
  );
}



function AppSidebar({
  navGroups,
  user,
  unreadCount,
  hasOpenShift,
}: {
  navGroups: NavGroup[];
  user: { name: string; role: string };
  unreadCount: number;
  hasOpenShift: boolean;
}) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Store className="size-4" aria-hidden />
          </span>
          <span className="truncate font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            Swalayaku
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {navGroups.map((group, index) => (
          <SidebarGroup key={group.label || `group-${index}`}>
            {group.label ? (
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            ) : null}

            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isNavItemActive(pathname, item.href);

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.title}
                        onClick={() => {
                          // On mobile the sidebar is an overlay drawer; close it
                          // after navigating so the user sees the new page.
                          if (isMobile) {
                            setOpenMobile(false);
                          }
                        }}
                      >
                        <Link href={item.href}>
                          <item.icon aria-hidden />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>

                      {item.badgeKey === "unreadNotifications" && unreadCount > 0 ? (
                        <SidebarMenuBadge>{unreadCount}</SidebarMenuBadge>
                      ) : null}

                      {item.badgeKey === "unclosedShift" && hasOpenShift ? (
                        <SidebarMenuBadge className="bg-stock-low text-white">
                          Aktif
                        </SidebarMenuBadge>
                      ) : null}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <div className="px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          <p className="truncate font-medium text-foreground">{user.name}</p>
          <p className="truncate">{user.role}</p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}