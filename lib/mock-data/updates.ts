export type UpdateType = "new-assignment" | "due-soon" | "completed" | "reminder";

export interface Update {
  id: string;
  type: UpdateType;
  title: string;
  description: string;
  date: string;
  courseId?: string;
}

export const updates: Update[] = [
  {
    id: "u1",
    type: "due-soon",
    title: "AML Fundamentals due in 3 weeks",
    description: "Finish the remaining 2 modules before the compliance deadline.",
    date: "2026-08-25",
    courseId: "aml-2026",
  },
  {
    id: "u2",
    type: "new-assignment",
    title: "New course assigned: Cybersecurity Hygiene",
    description: "IT assigned this to all staff, due 2026-10-01.",
    date: "2026-08-24",
    courseId: "cyber-hygiene",
  },
  {
    id: "u3",
    type: "completed",
    title: "Completed: Claims Handling Best Practices",
    description: "Nice work — all 3 modules finished.",
    date: "2026-08-20",
    courseId: "claims-handling",
  },
  {
    id: "u4",
    type: "reminder",
    title: "Underwriting Fundamentals is 30% done",
    description: "Pick back up where you left off on Pricing Models.",
    date: "2026-08-18",
    courseId: "underwriting-101",
  },
];
