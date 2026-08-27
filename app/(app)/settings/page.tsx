"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useSession } from "next-auth/react";
import { Sun, Moon, Monitor } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { currentUser } from "@/lib/mock-data/courses";
import { signOutAction } from "@/app/actions/auth";
import { cn, getInitials } from "@/lib/utils";

const themeOptions = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

const notificationDefaults = [
  { id: "due-reminders", label: "Course due date reminders", description: "Email a few days before a compliance course is due", checked: true },
  { id: "new-assignment", label: "New course assigned", description: "Email when a department assigns you a new course", checked: true },
  { id: "weekly-digest", label: "Weekly progress digest", description: "Summary of your in-progress courses every Monday", checked: false },
  { id: "quiz-results", label: "Quiz results", description: "Email your score right after finishing a quiz", checked: true },
];

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { data: session } = useSession();
  const [mounted, setMounted] = useState(false);
  const [notifications, setNotifications] = useState(notificationDefaults);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- server doesn't know the theme; first client render must match SSR output, then update post-hydration
    setMounted(true);
  }, []);

  const displayName = session?.user?.name ?? currentUser.name;
  const displayEmail = session?.user?.email ?? currentUser.email;
  const initials = getInitials(displayName);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Appearance, notifications, and account preferences.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2">
            {themeOptions.map((option) => {
              const Icon = option.icon;
              const active = mounted && theme === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTheme(option.value)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border px-3 py-4 text-sm transition-colors",
                    active
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {option.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notifications</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {notifications.map((item, index) => (
            <div key={item.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div>
                <Label htmlFor={item.id} className="text-sm font-medium">
                  {item.label}
                </Label>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
              <Switch
                id={item.id}
                checked={item.checked}
                onCheckedChange={(checked) =>
                  setNotifications((prev) =>
                    prev.map((n, i) => (i === index ? { ...n, checked } : n))
                  )
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Avatar size="lg">
              {session?.user?.image && (
                <AvatarImage src={session.user.image} alt={displayName} />
              )}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium">{displayName}</p>
              <p className="text-xs text-muted-foreground">{displayEmail}</p>
            </div>
          </div>
          <Separator />
          {session ? (
            <Button variant="outline" onClick={() => signOutAction()} className="self-start">
              Sign out
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Not signed in — showing demo account. Sign in from the header to see real account settings.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
