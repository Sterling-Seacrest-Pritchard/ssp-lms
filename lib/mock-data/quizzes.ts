export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
}

export interface Quiz {
  courseId: string;
  moduleId: string;
  passThreshold: number;
  questions: QuizQuestion[];
}

export const quizzes: Quiz[] = [
  {
    courseId: "aml-2026",
    moduleId: "m4",
    passThreshold: 80,
    questions: [
      {
        id: "q1",
        question: "What is the primary purpose of a Suspicious Activity Report (SAR)?",
        options: [
          "To document customer complaints",
          "To report transactions that may indicate money laundering or fraud",
          "To track marketing campaign performance",
          "To approve new loan applications",
        ],
        correctIndex: 1,
      },
      {
        id: "q2",
        question: "Which of the following is a common AML red flag?",
        options: [
          "A customer making regular deposits matching their salary",
          "A customer structuring deposits just under the reporting threshold",
          "A customer using online banking",
          "A customer updating their mailing address",
        ],
        correctIndex: 1,
      },
      {
        id: "q3",
        question: "Under BSA requirements, how long must most AML records typically be retained?",
        options: ["6 months", "1 year", "5 years", "Indefinitely"],
        correctIndex: 2,
      },
    ],
  },
  {
    courseId: "harassment-2026",
    moduleId: "m3",
    passThreshold: 80,
    questions: [
      {
        id: "q1",
        question: "If an employee witnesses workplace harassment, what should they do first?",
        options: [
          "Ignore it — it's not their concern",
          "Report it through the designated reporting channel",
          "Confront the alleged harasser directly and publicly",
          "Post about it on social media",
        ],
        correctIndex: 1,
      },
      {
        id: "q2",
        question: "Retaliation against someone who reports harassment in good faith is:",
        options: [
          "Allowed if the report turns out to be false",
          "Prohibited under company policy",
          "Only prohibited for managers",
          "Acceptable if done privately",
        ],
        correctIndex: 1,
      },
      {
        id: "q3",
        question: "Which best describes a hostile work environment?",
        options: [
          "Any disagreement between coworkers",
          "Unwelcome conduct severe or pervasive enough to create an abusive environment",
          "A loud or busy office",
          "Any joke made at work",
        ],
        correctIndex: 1,
      },
    ],
  },
  {
    courseId: "underwriting-101",
    moduleId: "m4",
    passThreshold: 70,
    questions: [
      {
        id: "q1",
        question: "What is the main goal of the underwriting process?",
        options: [
          "To assess and price risk appropriately",
          "To deny as many applications as possible",
          "To handle customer service calls",
          "To process claims payments",
        ],
        correctIndex: 0,
      },
      {
        id: "q2",
        question: "Which factor would generally increase a risk's premium?",
        options: [
          "A strong loss history with no prior claims",
          "A high-risk industry with a history of frequent claims",
          "Located in a low-crime area",
          "Long-standing customer relationship",
        ],
        correctIndex: 1,
      },
      {
        id: "q3",
        question: "A \"pricing model\" in underwriting is best described as:",
        options: [
          "A framework for calculating premiums based on risk factors",
          "A fixed price applied to all policies regardless of risk",
          "A marketing brochure",
          "A claims-processing checklist",
        ],
        correctIndex: 0,
      },
    ],
  },
  {
    courseId: "cyber-hygiene",
    moduleId: "m4",
    passThreshold: 80,
    questions: [
      {
        id: "q1",
        question: "What's the best way to identify a phishing email?",
        options: [
          "It always comes from a completely unknown sender",
          "Urgent language, suspicious links, or requests for credentials",
          "It's always poorly formatted",
          "It only targets executives",
        ],
        correctIndex: 1,
      },
      {
        id: "q2",
        question: "What should you do if you suspect a phishing attempt?",
        options: [
          "Click the link to investigate",
          "Reply asking if it's legitimate",
          "Report it through the incident reporting channel",
          "Forward it to coworkers without reporting it",
        ],
        correctIndex: 2,
      },
      {
        id: "q3",
        question: "Which is a strong password hygiene practice?",
        options: [
          "Reusing the same password across multiple sites",
          "Using a unique, complex password per account, ideally via a password manager",
          "Writing passwords on a sticky note at your desk",
          "Sharing passwords with trusted coworkers",
        ],
        correctIndex: 1,
      },
    ],
  },
];

export function getQuiz(courseId: string, moduleId: string) {
  return quizzes.find((q) => q.courseId === courseId && q.moduleId === moduleId);
}
