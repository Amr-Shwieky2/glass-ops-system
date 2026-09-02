"use client";

import * as React from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  markNotificationReadAction,
  markAllNotificationsReadAction,
  type Notification,
} from "@/server/notifications";

const relativeFmt = new Intl.RelativeTimeFormat("ar", { numeric: "auto" });

/** "منذ 5 دقائق" / "أمس" / ... for a notification's createdAt. */
function relativeTime(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60000);
  if (Math.abs(diffMin) < 1) return "الآن";
  if (Math.abs(diffMin) < 60) return relativeFmt.format(diffMin, "minute");
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return relativeFmt.format(diffHour, "hour");
  const diffDay = Math.round(diffHour / 24);
  return relativeFmt.format(diffDay, "day");
}

/**
 * Header notification bell (section 63): shows the initial unread count
 * (passed down from src/app/(app)/layout.tsx), and on open fetches the
 * recent list from GET /api/notifications (mirrors the calendar's fetch
 * of /api/appointments — the established route-handler precedent for a
 * client component pulling fresh server data). Clicking a notification
 * marks it read and, when it points at a job, navigates there. This is
 * purely an inbox — no approve/reject controls here, those already live
 * on each entity's own page.
 */
export function NotificationBell({ initialUnreadCount }: { initialUnreadCount: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState<Notification[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [unreadCount, setUnreadCount] = React.useState(initialUnreadCount);
  const [, startTransition] = useTransition();

  async function loadNotifications() {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data: { notifications: Notification[] } = await res.json();
      setNotifications(data.notifications);
      setUnreadCount(data.notifications.filter((n) => !n.isRead).length);
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) void loadNotifications();
  }

  function handleNotificationClick(n: Notification) {
    if (!n.isRead) {
      setNotifications((prev) =>
        prev ? prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)) : prev,
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      startTransition(() => {
        void markNotificationReadAction(n.id, {}, new FormData());
      });
    }
    if (n.relatedEntityType === "job" && n.relatedEntityId) {
      setOpen(false);
      router.push(`/jobs/${n.relatedEntityId}`);
    }
  }

  function handleMarkAllRead() {
    setNotifications((prev) => (prev ? prev.map((x) => ({ ...x, isRead: true })) : prev));
    setUnreadCount(0);
    startTransition(() => {
      void markAllNotificationsReadAction({}, new FormData());
    });
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="الإشعارات">
          <Bell className="size-5" />
          {unreadCount > 0 && (
            <span className="absolute -end-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b p-3">
          <span className="text-sm font-medium text-foreground">الإشعارات</span>
          {notifications && notifications.some((n) => !n.isRead) && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="text-xs font-medium text-primary hover:underline"
            >
              تعليم الكل كمقروء
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {loading && !notifications ? (
            <p className="p-4 text-center text-sm text-muted-foreground">جارٍ التحميل...</p>
          ) : !notifications || notifications.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">لا توجد إشعارات</p>
          ) : (
            <ul>
              {notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleNotificationClick(n)}
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 border-b p-3 text-start last:border-0 hover:bg-accent",
                      !n.isRead && "bg-primary/5",
                    )}
                  >
                    <div className="flex w-full items-center gap-2">
                      {!n.isRead && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                      <span
                        className={cn(
                          "flex-1 truncate text-sm",
                          !n.isRead ? "font-medium text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {n.title}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {relativeTime(new Date(n.createdAt))}
                      </span>
                    </div>
                    {n.body && (
                      <p className="w-full truncate text-xs text-muted-foreground">{n.body}</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
