"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NotificationRow } from "@/lib/notifications/queries";
import { formatDate } from "@/lib/format-date";

export function NotificationBell() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  async function loadNotifications() {
    try {
      const response = await fetch("/api/notifications?limit=10");
      if (!response.ok) return;
      const body = await response.json();
      setNotifications(body.notifications ?? []);
      setUnreadCount(body.unreadCount ?? 0);
    } catch {
      // Leave the bell showing whatever it last had rather than erroring the header.
    }
  }

  useEffect(() => {
    loadNotifications();
  }, []);

  async function handleItemClick(notification: NotificationRow) {
    const wasUnread = !notification.readAt;
    try {
      await fetch(`/api/notifications/${notification.id}/read`, { method: "PATCH" });
    } catch {
      // Navigate regardless - a failed read-receipt shouldn't block the user.
    }
    if (wasUnread) {
      setUnreadCount((count) => Math.max(0, count - 1));
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n))
      );
    }
    if (notification.linkHref) {
      router.push(notification.linkHref);
    }
  }

  async function handleMarkAllRead() {
    try {
      await fetch("/api/notifications/read-all", { method: "PATCH" });
    } catch {
      return;
    }
    setUnreadCount(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Notifications" className="relative">
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <Badge
                variant="destructive"
                className="absolute -right-1 -top-1 h-4 min-w-4 justify-center px-1 text-[10px]"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </Badge>
            )}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-80">
        {notifications.length === 0 ? (
          <div className="px-2 py-4 text-center text-sm text-muted-foreground">
            No notifications yet
          </div>
        ) : (
          notifications.map((notification) => (
            <DropdownMenuItem
              key={notification.id}
              onClick={() => handleItemClick(notification)}
              className="flex flex-col items-start gap-0.5 whitespace-normal py-2"
            >
              <div className="flex w-full items-center gap-2">
                {!notification.readAt && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                )}
                <span className="text-sm font-medium leading-snug">{notification.title}</span>
              </div>
              <span className="text-xs text-muted-foreground">{notification.body}</span>
              <span className="text-xs text-muted-foreground">
                {formatDate(notification.createdAt)}
              </span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleMarkAllRead} disabled={unreadCount === 0}>
          Mark all read
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
