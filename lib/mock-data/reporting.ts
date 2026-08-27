export interface DepartmentCompletion {
  department: string;
  completed: number;
  inProgress: number;
  notStarted: number;
}

export const departmentCompletion: DepartmentCompletion[] = [
  { department: "Compliance", completed: 82, inProgress: 12, notStarted: 6 },
  { department: "HR", completed: 91, inProgress: 5, notStarted: 4 },
  { department: "Underwriting", completed: 64, inProgress: 24, notStarted: 12 },
  { department: "Claims", completed: 77, inProgress: 15, notStarted: 8 },
  { department: "IT", completed: 55, inProgress: 20, notStarted: 25 },
  { department: "Engineering", completed: 48, inProgress: 30, notStarted: 22 },
];

export interface MonthlyCompletion {
  month: string;
  completions: number;
}

export const monthlyCompletions: MonthlyCompletion[] = [
  { month: "Mar", completions: 120 },
  { month: "Apr", completions: 145 },
  { month: "May", completions: 132 },
  { month: "Jun", completions: 168 },
  { month: "Jul", completions: 190 },
  { month: "Aug", completions: 210 },
];

export const orgStats = {
  totalEmployees: 640,
  activeLearners: 512,
  complianceRate: 87,
  overdueTraining: 34,
};
