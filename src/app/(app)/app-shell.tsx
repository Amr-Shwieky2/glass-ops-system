"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu, X, LogOut } from "lucide-react";
import { NAV_ITEMS, type NavItem } from "@/config/nav";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { logoutAction } from "./actions";
import { GlobalSearchBox } from "./global-search-box";
import { NotificationBell } from "./notification-bell";

interface AppShellProps {
  userName: string;
  userPhone: string;
  allowedHrefs: string[];
  initialUnreadCount: number;
  children: React.ReactNode;
}

function initials(name: string): string {
  return name.trim().slice(0, 2);
}

function NavLinks({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1 p-3">
      {items.map((item) => {
        const Icon = item.icon;
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="size-5 shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function UserFooter({
  userName,
  userPhone,
}: {
  userName: string;
  userPhone: string;
}) {
  return (
    <div className="flex items-center gap-3 border-t p-3">
      <Avatar>
        <AvatarFallback>{initials(userName)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {userName}
        </p>
        <p className="truncate text-xs text-muted-foreground" dir="ltr">
          {userPhone}
        </p>
      </div>
      <form action={logoutAction}>
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          aria-label="تسجيل الخروج"
          title="تسجيل الخروج"
        >
          <LogOut className="size-4" />
        </Button>
      </form>
    </div>
  );
}

export function AppShell({
  userName,
  userPhone,
  allowedHrefs,
  initialUnreadCount,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const allowed = new Set(allowedHrefs);
  const items = NAV_ITEMS.filter((item) => allowed.has(item.href));

  return (
    <div className="flex min-h-svh w-full">
      {/* Desktop sidebar (permanent, md and up) */}
      <aside className="hidden w-64 shrink-0 flex-col border-e bg-card md:flex">
        <div className="flex h-16 items-center gap-2 border-b px-4">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">
            ز
          </div>
          <span className="truncate font-semibold text-foreground">
            إدارة عمليات الزجاج
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <NavLinks items={items} pathname={pathname} />
        </div>
        <UserFooter userName={userName} userPhone={userPhone} />
      </aside>

      {/* Mobile drawer (below md) */}
      <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className={cn(
              "fixed inset-0 z-50 bg-black/50 md:hidden",
              "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            )}
          />
          <DialogPrimitive.Content
            className={cn(
              "fixed inset-y-0 start-0 z-50 flex w-72 max-w-[80vw] flex-col border-e bg-card shadow-lg outline-none md:hidden",
              "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
            )}
          >
            <DialogPrimitive.Title className="sr-only">
              القائمة الرئيسية
            </DialogPrimitive.Title>
            <div className="flex h-16 items-center justify-between border-b px-4">
              <span className="truncate font-semibold text-foreground">
                إدارة عمليات الزجاج
              </span>
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" aria-label="إغلاق القائمة">
                  <X className="size-5" />
                </Button>
              </DialogPrimitive.Close>
            </div>
            <div className="flex-1 overflow-y-auto">
              <NavLinks
                items={items}
                pathname={pathname}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
            <UserFooter userName={userName} userPhone={userPhone} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="flex min-h-svh flex-1 flex-col">
        <header className="flex h-16 items-center gap-3 border-b bg-card px-4 md:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="فتح القائمة"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-5" />
          </Button>
          <GlobalSearchBox />
          <div className="flex-1" />
          <NotificationBell initialUnreadCount={initialUnreadCount} />
        </header>
        <main className="flex-1 bg-background p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
