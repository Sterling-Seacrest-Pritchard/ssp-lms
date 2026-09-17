// Run with: npx tsx scripts/seed-real-courses.ts
//
// One-time content migration: replaces the five hardcoded mock courses in
// lib/mock-data/courses.ts with real, modifiable/deletable DB rows, per the
// user's instruction to "create them as actual courses inside the database
// ... Make them real so we have real testing data." Idempotent by course
// `code` - re-running after a partial failure skips any course that already
// exists rather than creating duplicates.
//
// Per the user's approved mix ("do a mix of the first 2 options, some being
// SCORM and the others courses with just quizzes and whatever else"):
//   - AML and Underwriting: their two video modules become one real SCORM
//     package each (never a faked Mux video asset).
//   - Harassment, Cybersecurity, and Claims: video is dropped; only the
//     modules that convert cleanly (quiz, text) are kept.
// Every mock "reading" module becomes a real Text module with real written
// content, per the user's answer: "Add a 'Text' module that allows them to
// upload a large text body."
import { eq } from "drizzle-orm";
import AdmZip from "adm-zip";
import { db } from "../lib/db/client";
import { courses, departments, modules, moduleVersions, scormModuleVersions } from "../lib/db/schema";
import { createDraftCourse, updateCourseDetails, publishCourse } from "../lib/db/course-authoring";
import { createTextModule } from "../lib/db/text-authoring";
import { createQuizModule, addQuestion } from "../lib/db/quiz-authoring";
import { uploadScormPackage, readScormManifest, assertLaunchFileExists } from "../lib/scorm/extract-package";
import { parseManifest } from "../lib/scorm/parse-manifest";

interface QuizQuestionSeed {
  prompt: string;
  choices: { choiceText: string; isCorrect: boolean }[];
}

interface CourseSeed {
  code: string;
  title: string;
  departmentName: string;
  compliance: boolean;
  dueDate?: string;
  scorm?: { moduleTitle: string; sections: { heading: string; body: string }[] };
  text?: { moduleTitle: string; body: string };
  quiz?: { moduleTitle: string; questions: QuizQuestionSeed[] };
}

const COURSES: CourseSeed[] = [
  {
    code: "AML-2026",
    title: "Anti-Money Laundering Fundamentals",
    departmentName: "Compliance",
    compliance: true,
    dueDate: "2026-12-15",
    scorm: {
      moduleTitle: "AML Fundamentals",
      sections: [
        {
          heading: "Introduction to AML",
          body:
            "Money laundering is the process of disguising the proceeds of criminal activity so they appear to come from a legitimate source. It typically happens in three stages: placement (introducing illicit cash into the financial system), layering (moving funds through multiple transactions or accounts to obscure their origin), and integration (reintroducing the now “cleaned” funds into the economy as if they were legitimate). Our AML program exists to detect and disrupt this process at every stage, and every employee who touches customer transactions plays a role in it.",
        },
        {
          heading: "Identifying Red Flags",
          body:
            "Common red flags include: transactions structured just under reporting thresholds; a customer whose activity doesn't match their stated occupation or business; large cash deposits followed quickly by wire transfers out with no clear business purpose; reluctance to provide identifying information; and use of multiple accounts or third parties to move funds with no apparent legitimate reason. No single red flag proves wrongdoing on its own, but a pattern of them — or even one significant one — should be escalated through the compliance reporting channel rather than dismissed.",
        },
      ],
    },
    text: {
      moduleTitle: "Reporting Obligations",
      body:
        "Financial institutions are required to identify and report certain types of suspicious activity to regulators under the Bank Secrecy Act (BSA) and related anti-money laundering (AML) rules. The primary reporting mechanism is the Suspicious Activity Report (SAR), which must generally be filed within 30 calendar days of detecting a transaction or pattern of transactions that appears to have no legitimate business purpose, is designed to evade reporting requirements, or otherwise suggests potential money laundering, fraud, or other criminal activity.\n\nIn addition to SARs, transactions involving currency in amounts over $10,000 typically trigger a Currency Transaction Report (CTR), regardless of whether the transaction itself appears suspicious. Structuring a transaction — deliberately breaking it into smaller amounts to stay under this threshold — is itself a violation and a common red flag that should be reported.\n\nEvery employee who identifies a potential red flag has a responsibility to escalate it through the designated internal reporting channel rather than deciding independently whether it warrants a SAR. Compliance and legal teams are responsible for making the final filing determination, and employees who file reports or raise concerns in good faith are protected from retaliation under both company policy and federal law. Delayed or unreported red flags can expose the company to regulatory penalties and reputational harm, so when in doubt, always report it.",
    },
    quiz: {
      moduleTitle: "Knowledge Check",
      questions: [
        {
          prompt: "What is the primary purpose of a Suspicious Activity Report (SAR)?",
          choices: [
            { choiceText: "To document customer complaints", isCorrect: false },
            { choiceText: "To report transactions that may indicate money laundering or fraud", isCorrect: true },
            { choiceText: "To track marketing campaign performance", isCorrect: false },
            { choiceText: "To approve new loan applications", isCorrect: false },
          ],
        },
        {
          prompt: "Which of the following is a common AML red flag?",
          choices: [
            { choiceText: "A customer making regular deposits matching their salary", isCorrect: false },
            { choiceText: "A customer structuring deposits just under the reporting threshold", isCorrect: true },
            { choiceText: "A customer using online banking", isCorrect: false },
            { choiceText: "A customer updating their mailing address", isCorrect: false },
          ],
        },
        {
          prompt: "Under BSA requirements, how long must most AML records typically be retained?",
          choices: [
            { choiceText: "6 months", isCorrect: false },
            { choiceText: "1 year", isCorrect: false },
            { choiceText: "5 years", isCorrect: true },
            { choiceText: "Indefinitely", isCorrect: false },
          ],
        },
      ],
    },
  },
  {
    code: "HARASSMENT-2026",
    title: "Workplace Harassment Prevention",
    departmentName: "HR",
    compliance: true,
    dueDate: "2026-12-01",
    quiz: {
      moduleTitle: "Final Assessment",
      questions: [
        {
          prompt: "If an employee witnesses workplace harassment, what should they do first?",
          choices: [
            { choiceText: "Ignore it — it's not their concern", isCorrect: false },
            { choiceText: "Report it through the designated reporting channel", isCorrect: true },
            { choiceText: "Confront the alleged harasser directly and publicly", isCorrect: false },
            { choiceText: "Post about it on social media", isCorrect: false },
          ],
        },
        {
          prompt: "Retaliation against someone who reports harassment in good faith is:",
          choices: [
            { choiceText: "Allowed if the report turns out to be false", isCorrect: false },
            { choiceText: "Prohibited under company policy", isCorrect: true },
            { choiceText: "Only prohibited for managers", isCorrect: false },
            { choiceText: "Acceptable if done privately", isCorrect: false },
          ],
        },
        {
          prompt: "Which best describes a hostile work environment?",
          choices: [
            { choiceText: "Any disagreement between coworkers", isCorrect: false },
            { choiceText: "Unwelcome conduct severe or pervasive enough to create an abusive environment", isCorrect: true },
            { choiceText: "A loud or busy office", isCorrect: false },
            { choiceText: "Any joke made at work", isCorrect: false },
          ],
        },
      ],
    },
  },
  {
    code: "UNDERWRITING-101",
    title: "Underwriting Fundamentals",
    departmentName: "Underwriting",
    compliance: false,
    scorm: {
      moduleTitle: "Underwriting Fundamentals",
      sections: [
        {
          heading: "Risk Assessment Basics",
          body:
            "Risk assessment is the process of gathering and evaluating information about an applicant to estimate the likelihood and potential severity of a future loss. Underwriters look at objective factors — industry, location, claims history, safety practices — and weigh them against the company's risk appetite and pricing model to decide whether to accept a risk, decline it, or accept it with modified terms.",
        },
        {
          heading: "Case Study Workshop",
          body:
            "Consider a mid-sized manufacturer applying for general liability coverage with two lost-time injuries in the past three years, both tied to a specific piece of equipment that has since been retrofitted with new safety guards. A purely mechanical read of the loss history might suggest a rate increase; a more complete risk assessment credits the corrective action taken and treats the retrofit as evidence of improved risk going forward. This is the kind of judgment call underwriters are expected to document clearly, showing not just what the loss history says but how mitigating factors were weighed.",
        },
      ],
    },
    text: {
      moduleTitle: "Pricing Models",
      body:
        "A pricing model is the framework underwriters use to translate an assessment of risk into a specific premium. Rather than applying a single flat rate to every applicant, insurers group risks by measurable characteristics — such as industry classification, loss history, geographic location, and coverage limits — and apply rating factors that adjust the base rate up or down for each characteristic.\n\nLoss history is one of the most heavily weighted inputs: an applicant with a pattern of frequent or severe prior claims is priced higher because past claims are one of the strongest available predictors of future claims. Conversely, a long claims-free history, strong risk-management practices, or operation in a lower-hazard industry typically earns a more favorable rate.\n\nPricing models also have to balance competitiveness against adequacy — a rate that's too low may win business in the short term but fail to cover the eventual cost of claims, while a rate that's too high prices the company out of otherwise profitable business. Underwriters are expected to apply the pricing model consistently, document any manual rating adjustments with a clear rationale, and escalate risks that fall outside the model's normal parameters rather than forcing them into a standard rate.",
    },
    quiz: {
      moduleTitle: "Module Quiz",
      questions: [
        {
          prompt: "What is the main goal of the underwriting process?",
          choices: [
            { choiceText: "To assess and price risk appropriately", isCorrect: true },
            { choiceText: "To deny as many applications as possible", isCorrect: false },
            { choiceText: "To handle customer service calls", isCorrect: false },
            { choiceText: "To process claims payments", isCorrect: false },
          ],
        },
        {
          prompt: "Which factor would generally increase a risk's premium?",
          choices: [
            { choiceText: "A strong loss history with no prior claims", isCorrect: false },
            { choiceText: "A high-risk industry with a history of frequent claims", isCorrect: true },
            { choiceText: "Located in a low-crime area", isCorrect: false },
            { choiceText: "Long-standing customer relationship", isCorrect: false },
          ],
        },
        {
          prompt: "A “pricing model” in underwriting is best described as:",
          choices: [
            { choiceText: "A framework for calculating premiums based on risk factors", isCorrect: true },
            { choiceText: "A fixed price applied to all policies regardless of risk", isCorrect: false },
            { choiceText: "A marketing brochure", isCorrect: false },
            { choiceText: "A claims-processing checklist", isCorrect: false },
          ],
        },
      ],
    },
  },
  {
    code: "CYBER-HYGIENE",
    title: "Cybersecurity Hygiene",
    departmentName: "IT",
    compliance: true,
    dueDate: "2026-10-01",
    text: {
      moduleTitle: "Incident Reporting",
      body:
        "Reporting a suspected security incident quickly is one of the most effective controls we have — the earlier IT and Security are aware of a phishing email, a lost device, or unusual account activity, the more damage can be contained before it spreads.\n\nIf you receive a suspicious email, do not click any links or open any attachments. Do not reply to the sender, even to ask if the message is legitimate — this confirms your address is active and invites further attempts. Instead, use the incident reporting channel (or the “Report Phishing” button in your email client) to forward it to IT immediately.\n\nThe same urgency applies to a lost or stolen device, a suspected malware infection, or any account activity you didn't initiate, such as an unexpected password reset or MFA prompt. Report it right away, even if you're not certain it's actually malicious — a false alarm costs IT a few minutes to check, while a real incident reported late can cost far more. You will never be penalized for reporting something in good faith that turns out to be nothing.",
    },
    quiz: {
      moduleTitle: "Assessment",
      questions: [
        {
          prompt: "What's the best way to identify a phishing email?",
          choices: [
            { choiceText: "It always comes from a completely unknown sender", isCorrect: false },
            { choiceText: "Urgent language, suspicious links, or requests for credentials", isCorrect: true },
            { choiceText: "It's always poorly formatted", isCorrect: false },
            { choiceText: "It only targets executives", isCorrect: false },
          ],
        },
        {
          prompt: "What should you do if you suspect a phishing attempt?",
          choices: [
            { choiceText: "Click the link to investigate", isCorrect: false },
            { choiceText: "Reply asking if it's legitimate", isCorrect: false },
            { choiceText: "Report it through the incident reporting channel", isCorrect: true },
            { choiceText: "Forward it to coworkers without reporting it", isCorrect: false },
          ],
        },
        {
          prompt: "Which is a strong password hygiene practice?",
          choices: [
            { choiceText: "Reusing the same password across multiple sites", isCorrect: false },
            { choiceText: "Using a unique, complex password per account, ideally via a password manager", isCorrect: true },
            { choiceText: "Writing passwords on a sticky note at your desk", isCorrect: false },
            { choiceText: "Sharing passwords with trusted coworkers", isCorrect: false },
          ],
        },
      ],
    },
  },
  {
    code: "CLAIMS-HANDLING",
    title: "Claims Handling Best Practices",
    departmentName: "Claims",
    compliance: false,
    text: {
      moduleTitle: "Documentation Standards",
      body:
        "Complete, accurate documentation is the backbone of a defensible claims file. Every material step of a claim — the initial notice of loss, all coverage determinations, communications with the policyholder, and the reasoning behind the final settlement or denial — should be recorded in the claims system in enough detail that another adjuster could pick up the file and understand exactly what happened and why.\n\nDocumentation should be factual and objective. Record what was said, observed, and decided, not personal opinions about the claimant or speculation that isn't supported by evidence in the file. Photos, estimates, police reports, medical records, and any other supporting materials should be attached to the claim file as soon as they're received, not summarized from memory later.\n\nTimeliness matters as much as completeness: notes should be entered as close to the event as possible, since a documentation gap discovered during an audit or a coverage dispute — well after the details have faded — is far harder to fix than one caught the same day. A well-documented file protects the company in litigation, supports consistent and fair claims handling, and gives the next adjuster everything they need to keep the file moving without re-asking the customer for information already provided.",
    },
  },
];

function buildScormPackage(sections: { heading: string; body: string }[]): Buffer {
  const identifier = `com.ssplms.${Date.now()}`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${identifier}" version="1" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2">
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Lesson</title>
      <item identifier="ITEM-1" identifierref="RES-1"><title>Lesson</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="index.html" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>`;

  const sectionsHtml = sections
    .map((s) => `<section><h2>${s.heading}</h2><p>${s.body}</p></section>`)
    .join("\n");

  const indexHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Lesson</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 700px; margin: 2rem auto; line-height: 1.6; padding: 0 1rem; }
  section { margin-bottom: 2rem; }
  button { font-size: 1rem; padding: 0.5rem 1.25rem; cursor: pointer; }
  #status { margin-top: 1rem; font-weight: 600; }
</style>
</head>
<body>
${sectionsHtml}
<button id="complete-btn" type="button">Mark as Complete</button>
<p id="status"></p>
<script>
  function findAPI(win) {
    var attempts = 0;
    while (win && !win.API && win.parent && win.parent !== win && attempts < 10) {
      win = win.parent;
      attempts++;
    }
    return win ? win.API : null;
  }
  var api = findAPI(window);
  if (api) {
    api.LMSInitialize("");
  }
  document.getElementById("complete-btn").addEventListener("click", function () {
    if (api) {
      api.LMSSetValue("cmi.core.lesson_status", "completed");
      api.LMSCommit("");
      document.getElementById("status").textContent = "Marked complete.";
    } else {
      document.getElementById("status").textContent = "SCORM API not found.";
    }
  });
  window.addEventListener("beforeunload", function () {
    if (api) api.LMSFinish("");
  });
</script>
</body>
</html>`;

  const zip = new AdmZip();
  zip.addFile("imsmanifest.xml", Buffer.from(manifest));
  zip.addFile("index.html", Buffer.from(indexHtml));
  return zip.toBuffer();
}

async function addScormModule(courseId: string, moduleTitle: string, sections: { heading: string; body: string }[]) {
  const zipBuffer = buildScormPackage(sections);
  const moduleVersionId = crypto.randomUUID();

  const manifestXml = readScormManifest(zipBuffer);
  const { identifier, launchUrl, scormVersion } = parseManifest(manifestXml);
  assertLaunchFileExists(zipBuffer, launchUrl);

  const { prefix } = await uploadScormPackage(zipBuffer, moduleVersionId);

  const [courseModule] = await db
    .insert(modules)
    .values({ courseId, moduleType: "scorm", title: moduleTitle })
    .returning();
  const [version] = await db
    .insert(moduleVersions)
    .values({ id: moduleVersionId, moduleId: courseModule.id, versionNumber: 1, status: "published", publishedAt: new Date() })
    .returning();
  await db.insert(scormModuleVersions).values({
    moduleVersionId: version.id,
    gcsPrefix: prefix,
    manifestIdentifier: identifier,
    scormVersion,
    launchUrl,
    rawManifestXml: manifestXml,
  });
  await db.update(modules).set({ currentVersionId: version.id }).where(eq(modules.id, courseModule.id));
}

async function seedCourse(seed: CourseSeed) {
  const [existing] = await db.select().from(courses).where(eq(courses.code, seed.code));
  if (existing) {
    console.log(`Skipping "${seed.title}" - a course with code ${seed.code} already exists.`);
    return;
  }

  const [department] = await db.select().from(departments).where(eq(departments.name, seed.departmentName));
  if (!department) {
    throw new Error(`No department named "${seed.departmentName}" exists`);
  }

  const { id: courseId } = await createDraftCourse(seed.title);
  await updateCourseDetails(courseId, {
    code: seed.code,
    departmentId: department.id,
    compliance: seed.compliance,
    dueDate: seed.dueDate ?? null,
  });

  if (seed.scorm) {
    await addScormModule(courseId, seed.scorm.moduleTitle, seed.scorm.sections);
  }
  if (seed.text) {
    await createTextModule(courseId, seed.text.moduleTitle, seed.text.body);
  }
  if (seed.quiz) {
    const { moduleVersionId } = await createQuizModule(courseId, seed.quiz.moduleTitle);
    for (const q of seed.quiz.questions) {
      await addQuestion(moduleVersionId, { questionType: "single_choice", prompt: q.prompt, points: 1, choices: q.choices });
    }
  }

  const result = await publishCourse(courseId);
  if ("error" in result) {
    throw new Error(`Failed to publish "${seed.title}": ${result.error}`);
  }
  console.log(`Seeded and published "${seed.title}" (${courseId}).`);
}

async function main() {
  for (const seed of COURSES) {
    await seedCourse(seed);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
