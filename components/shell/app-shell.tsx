"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import {
  Home,
  BookOpen,
  Video,
  BarChart3,
  Users,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { cn, getInitials } from "@/lib/utils";
import { roleFromClaims, type Role } from "@/lib/roles";
import { signInAction } from "@/app/actions/auth";

const learnerNav = [
  { href: "/", label: "Home", icon: Home },
  { href: "/courses", label: "Courses", icon: BookOpen },
];

const adminNav = [
  { href: "/admin", label: "Home", icon: Home },
  { href: "/admin/content", label: "Content Authoring", icon: BookOpen },
  { href: "/admin/videos", label: "Video Library", icon: Video },
  { href: "/admin/reports", label: "Reports", icon: BarChart3 },
  { href: "/admin/org", label: "Org Admin", icon: Users },
];

function homeFor(role: Role) {
  return role === "Admin" ? "/admin" : "/";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [testRole, setTestRole] = useState<Role | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { data: session, status } = useSession();
  const { resolvedTheme } = useTheme();
  const isAuthenticated = status === "authenticated";
  const real = isAuthenticated ? roleFromClaims(session?.user?.roles) : null;
  const canOverrideRole = real?.role === "Admin";
  // Even a stale localStorage value from before a role change can't self-escalate a non-admin.
  const effectiveTestRole = canOverrideRole ? testRole : null;
  const role: Role = effectiveTestRole ?? real?.role ?? "Learner";
  const roleLabel = effectiveTestRole ?? real?.label ?? "Learner";
  const isTestOverride = effectiveTestRole !== null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- server has no localStorage; first client render must match SSR output, then update post-hydration
    setMounted(true);
    const storedCollapsed = localStorage.getItem("sidebar-collapsed");
    if (storedCollapsed) setCollapsed(storedCollapsed === "true");
    const storedTestRole = localStorage.getItem("test-role");
    if (storedTestRole === "Learner" || storedTestRole === "Admin") {
      setTestRole(storedTestRole);
    }
  }, []);

  const updateTestRole = (next: Role | null) => {
    setTestRole(next);
    if (next) {
      localStorage.setItem("test-role", next);
    } else {
      localStorage.removeItem("test-role");
    }
    router.push(homeFor(next ?? real?.role ?? "Learner"));
  };

  useEffect(() => {
    // Landing on "/" as a real Admin (e.g. right after signing in) would otherwise show the
    // Learner home page under the Admin nav — send them to their own home instead.
    if (pathname === "/" && role === "Admin") {
      router.replace("/admin");
    }
  }, [pathname, role, router]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  };

  const navItems = role === "Learner" ? learnerNav : adminNav;
  const displayName = session?.user?.name ?? currentUser.name;
  const avatarInitials = session?.user?.name
    ? getInitials(session.user.name)
    : currentUser.avatarInitials;

  return (
    <div className="flex min-h-screen w-full">
      <aside
        className={cn(
          "hidden shrink-0 flex-col overflow-hidden border-r bg-muted/30 transition-[width] duration-200 md:flex",
          collapsed ? "w-0 border-r-0" : "w-64"
        )}
      >
        <div className="flex h-full w-64 flex-col">
        <div className="flex items-center px-5 py-5">
          <Link href={homeFor(role)} className="w-full">
            <Image
              src={
                mounted && resolvedTheme === "dark"
                  ? "/logo-horizontal-white.png"
                  : "/logo-horizontal-blue.png"
              }
              alt="Sterling Seacrest Pritchard"
              width={200}
              height={26}
              priority
              className="h-auto w-full"
            />
          </Link>
        </div>
        <Separator />
        <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
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
        <Separator />
        <div className="px-3 py-4">
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname === "/settings"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleCollapsed}
              className="hidden md:inline-flex"
              aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </Button>
            {canOverrideRole ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<button type="button" className="flex items-center gap-1.5 hover:text-foreground" />}
                >
                  Viewing as <span className="font-medium text-foreground">{roleLabel}</span>
                  {isTestOverride && (
                    <Badge variant="outline" className="text-[10px]">
                      test view
                    </Badge>
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => updateTestRole("Learner")}>
                    Learner
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => updateTestRole("Admin")}>
                    Admin
                  </DropdownMenuItem>
                  {isTestOverride && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => updateTestRole(null)}>
                        Use real role ({real?.label})
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span>
                Viewing as <span className="font-medium text-foreground">{roleLabel}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {!isAuthenticated && (
              <Button variant="outline" size="sm" onClick={() => signInAction()}>
                Sign in with Microsoft
              </Button>
            )}
            <Avatar>
              {session?.user?.image && <AvatarImage src={session.user.image} alt={displayName} />}
              <AvatarFallback>{avatarInitials}</AvatarFallback>
            </Avatar>
          </div>
        </header>
        <main className="flex-1 bg-background p-6">{children}</main>
      </div>
    </div>
  );
}
