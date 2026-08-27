"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useSession } from "next-auth/react";
import {
  LayoutDashboard,
  BookOpen,
  Video,
  BarChart3,
  Users,
  GraduationCap,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { currentUser } from "@/lib/mock-data/courses";
import { cn } from "@/lib/utils";
import { signInAction, signOutAction } from "@/app/actions/auth";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

type Role = "Learner" | "Admin";

const learnerNav = [
  { href: "/", label: "My Courses", icon: LayoutDashboard },
];

const adminNav = [
  { href: "/admin", label: "Content Authoring", icon: BookOpen },
  { href: "/admin/videos", label: "Video Library", icon: Video },
  { href: "/admin/reports", label: "Reports", icon: BarChart3 },
  { href: "/admin/org", label: "Org Admin", icon: Users },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [role, setRole] = useState<Role>("Learner");
  const { data: session, status } = useSession();

  const navItems = role === "Learner" ? learnerNav : adminNav;
  const displayName = session?.user?.name ?? currentUser.name;
  const avatarInitials = session?.user?.name
    ? initials(session.user.name)
    : currentUser.avatarInitials;

  return (
    <div className="flex min-h-screen w-full">
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-muted/30 md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <GraduationCap className="h-6 w-6 text-primary" />
          <span className="text-lg font-semibold">SSP LMS</span>
          <Badge variant="secondary" className="ml-auto">
            demo
          </Badge>
        </div>
        <Separator />
        <nav className="flex flex-col gap-1 px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <div className="text-sm text-muted-foreground">
            Viewing as <span className="font-medium text-foreground">{role}</span>
            {status === "authenticated" && (
              <span className="ml-2 text-xs">(signed in as {displayName})</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                Switch role: {role}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setRole("Learner")}>
                  Learner
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setRole("Admin")}>
                  Admin
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {status === "authenticated" ? (
                  <DropdownMenuItem onClick={() => signOutAction()}>
                    Sign out
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => signInAction()}>
                    Sign in with Microsoft
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Avatar>
              <AvatarFallback>{avatarInitials}</AvatarFallback>
            </Avatar>
          </div>
        </header>
        <main className="flex-1 bg-background p-6">{children}</main>
      </div>
    </div>
  );
}
