import Link from "next/link";
import { BookOpen, Video, BarChart3, Users, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { orgStats } from "@/lib/mock-data/reporting";
import { currentUser } from "@/lib/mock-data/courses";

const statCards = [
  { label: "Total Employees", value: orgStats.totalEmployees },
  { label: "Active Learners", value: orgStats.activeLearners },
  { label: "Compliance Rate", value: `${orgStats.complianceRate}%` },
  { label: "Overdue Training", value: orgStats.overdueTraining },
];

const quickLinks = [
  { href: "/admin/content", label: "Content Authoring", description: "Manage courses, modules, and quizzes", icon: BookOpen },
  { href: "/admin/videos", label: "Video Library", description: "Uploaded and processing video assets", icon: Video },
  { href: "/admin/reports", label: "Reports", description: "Org-wide completion metrics", icon: BarChart3 },
  { href: "/admin/org", label: "Org Admin", description: "Department and role management", icon: Users },
];

export default function AdminHomePage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back, {currentUser.name.split(" ")[0]}
        </h1>
        <p className="text-sm text-muted-foreground">Admin overview — {currentUser.department}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="py-5">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="text-2xl font-semibold">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="mb-4 text-lg font-medium">Quick Links</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {quickLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link key={link.href} href={link.href}>
                <Card className="h-full transition-shadow hover:shadow-md">
                  <CardContent className="flex items-center gap-3 py-5">
                    <Icon className="h-5 w-5 shrink-0 text-primary" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{link.label}</p>
                      <p className="text-xs text-muted-foreground">{link.description}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
