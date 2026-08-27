export type CourseStatus = "not-started" | "in-progress" | "completed";

export interface Module {
  id: string;
  title: string;
  type: "video" | "quiz" | "reading";
  durationMinutes: number;
  status: CourseStatus;
}

export interface Course {
  id: string;
  title: string;
  department: string;
  description: string;
  thumbnail: string;
  progress: number;
  status: CourseStatus;
  modules: Module[];
  dueDate?: string;
  compliance: boolean;
}

export const courses: Course[] = [
  {
    id: "aml-2026",
    title: "Anti-Money Laundering Fundamentals",
    department: "Compliance",
    description:
      "Annual AML/BSA refresher covering red flags, reporting obligations, and case studies.",
    thumbnail: "bg-gradient-to-br from-blue-500 to-indigo-600",
    progress: 65,
    status: "in-progress",
    dueDate: "2026-09-15",
    compliance: true,
    modules: [
      { id: "m1", title: "Introduction to AML", type: "video", durationMinutes: 12, status: "completed" },
      { id: "m2", title: "Identifying Red Flags", type: "video", durationMinutes: 18, status: "completed" },
      { id: "m3", title: "Reporting Obligations", type: "reading", durationMinutes: 8, status: "in-progress" },
      { id: "m4", title: "Knowledge Check", type: "quiz", durationMinutes: 10, status: "not-started" },
    ],
  },
  {
    id: "harassment-2026",
    title: "Workplace Harassment Prevention",
    department: "HR",
    description: "Required annual training on harassment prevention and reporting channels.",
    thumbnail: "bg-gradient-to-br from-rose-500 to-orange-500",
    progress: 100,
    status: "completed",
    dueDate: "2026-06-01",
    compliance: true,
    modules: [
      { id: "m1", title: "Recognizing Harassment", type: "video", durationMinutes: 15, status: "completed" },
      { id: "m2", title: "Reporting Process", type: "video", durationMinutes: 10, status: "completed" },
      { id: "m3", title: "Final Assessment", type: "quiz", durationMinutes: 10, status: "completed" },
    ],
  },
  {
    id: "underwriting-101",
    title: "Underwriting Fundamentals",
    department: "Underwriting",
    description: "Core principles of risk assessment and policy pricing for new underwriters.",
    thumbnail: "bg-gradient-to-br from-emerald-500 to-teal-600",
    progress: 30,
    status: "in-progress",
    compliance: false,
    modules: [
      { id: "m1", title: "Risk Assessment Basics", type: "video", durationMinutes: 20, status: "completed" },
      { id: "m2", title: "Pricing Models", type: "reading", durationMinutes: 15, status: "in-progress" },
      { id: "m3", title: "Case Study Workshop", type: "video", durationMinutes: 25, status: "not-started" },
      { id: "m4", title: "Module Quiz", type: "quiz", durationMinutes: 12, status: "not-started" },
    ],
  },
  {
    id: "cyber-hygiene",
    title: "Cybersecurity Hygiene",
    department: "IT",
    description: "Phishing awareness, password hygiene, and incident reporting for all staff.",
    thumbnail: "bg-gradient-to-br from-violet-500 to-purple-600",
    progress: 0,
    status: "not-started",
    dueDate: "2026-10-01",
    compliance: true,
    modules: [
      { id: "m1", title: "Phishing Awareness", type: "video", durationMinutes: 10, status: "not-started" },
      { id: "m2", title: "Password Hygiene", type: "video", durationMinutes: 8, status: "not-started" },
      { id: "m3", title: "Incident Reporting", type: "reading", durationMinutes: 5, status: "not-started" },
      { id: "m4", title: "Assessment", type: "quiz", durationMinutes: 10, status: "not-started" },
    ],
  },
  {
    id: "claims-handling",
    title: "Claims Handling Best Practices",
    department: "Claims",
    description: "End-to-end claims process, documentation standards, and customer communication.",
    thumbnail: "bg-gradient-to-br from-amber-500 to-yellow-500",
    progress: 100,
    status: "completed",
    compliance: false,
    modules: [
      { id: "m1", title: "Intake and Triage", type: "video", durationMinutes: 14, status: "completed" },
      { id: "m2", title: "Documentation Standards", type: "reading", durationMinutes: 9, status: "completed" },
      { id: "m3", title: "Customer Communication", type: "video", durationMinutes: 11, status: "completed" },
    ],
  },
];

export const currentUser = {
  name: "Ian Harrison",
  email: "iharrison@sspins.com",
  department: "Engineering",
  role: "Learner" as "Learner" | "Admin",
  avatarInitials: "IH",
};
