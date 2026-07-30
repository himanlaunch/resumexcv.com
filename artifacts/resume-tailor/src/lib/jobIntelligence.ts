import type { ATSCheck, DiffChange, JobResult, ResumeData } from "@/lib/api";

export type AtsVendor = "Workday" | "Greenhouse" | "Lever" | "Taleo" | "iCIMS" | "SmartRecruiters" | "Ashby" | "Unknown";
export type ResumeConvention = "US" | "UK" | "EU" | "Canada" | "Australia";
export type EvidenceLevel = "verified" | "transferable" | "missing";

const STOP_WORDS = new Set([
  "about", "after", "also", "and", "are", "been", "being", "but", "can", "company", "for", "from",
  "have", "into", "job", "more", "our", "role", "that", "the", "their", "this", "through", "using",
  "will", "with", "work", "you", "your", "years", "required", "preferred", "responsibilities",
]);

const HARD_SKILLS = [
  "javascript", "typescript", "python", "java", "go", "golang", "ruby", "php", "c++", "c#",
  "react", "angular", "vue", "node.js", "node", "next.js", "sql", "postgresql", "mysql", "mongodb",
  "redis", "kafka", "spark", "snowflake", "tableau", "power bi", "excel", "aws", "azure", "gcp",
  "docker", "kubernetes", "terraform", "git", "graphql", "rest", "machine learning", "ai", "llm",
  "pytorch", "tensorflow", "pandas", "salesforce", "sap", "workday", "jira", "figma",
];

const SOFT_SKILLS = [
  "communication", "collaboration", "leadership", "mentoring", "stakeholder management", "problem solving",
  "critical thinking", "cross-functional", "ownership", "adaptability", "presentation", "negotiation",
  "project management", "time management", "customer focus", "strategic thinking",
];

function normalize(value: string | undefined | null) {
  return String(value ?? "").toLowerCase().replace(/[^\p{L}\p{N}+#.]+/gu, " ").replace(/\s+/g, " ").trim();
}

function resumeText(resume: ResumeData) {
  return [
    resume.contact?.name, resume.contact?.email, resume.contact?.phone, resume.contact?.location,
    resume.summary, ...(resume.skills ?? []),
    ...(resume.skillGroups ?? []).flatMap(group => [group.category, ...group.skills]),
    ...(resume.experience ?? []).flatMap(item => [item.title, item.company, ...(item.bullets ?? [])]),
    ...(resume.education ?? []).flatMap(item => [item.degree, item.school, item.notes]),
    ...(resume.certifications ?? []), ...(resume.achievements ?? []),
    ...(resume.projects ?? []).flatMap(item => [item.name, ...(item.bullets ?? [])]),
  ].filter(Boolean).join(" ");
}

export function detectAts(url?: string | null): AtsVendor {
  const value = normalize(url);
  if (/myworkdayjobs|workday/.test(value)) return "Workday";
  if (/greenhouse|boards\.greenhouse/.test(value)) return "Greenhouse";
  if (/lever\.co|jobs\.lever/.test(value)) return "Lever";
  if (/taleo|oraclecloud.*recruit|careersection/.test(value)) return "Taleo";
  if (/icims/.test(value)) return "iCIMS";
  if (/smartrecruiters/.test(value)) return "SmartRecruiters";
  if (/ashbyhq/.test(value)) return "Ashby";
  return "Unknown";
}

export function atsGuidance(vendor: AtsVendor, convention: ResumeConvention = "US") {
  const base = {
    format: "Use a single-column DOCX or text-based PDF with standard headings.",
    headings: "Use Summary, Skills, Experience, Education, and Certifications.",
    plain: "Simple sections make it easier for the employer's software to read your resume correctly.",
  };
  const specific: Record<AtsVendor, typeof base> = {
    Workday: {
      format: "Prefer DOCX, one column, no tables, icons, headers, or footers.",
      headings: "Use Work Experience, Education, Skills, and Certifications.",
      plain: "Workday often asks you to verify parsed fields, so conventional headings reduce manual corrections.",
    },
    Greenhouse: {
      format: "DOCX or a text-based PDF is safe; keep dates and employers on plain text lines.",
      headings: "Use Summary, Experience, Skills, Education, and Certifications.",
      plain: "Greenhouse usually parses clean documents well, but decorative layouts can still scramble dates and titles.",
    },
    Lever: {
      format: "Use a text-based PDF or DOCX with one column and selectable text.",
      headings: "Use standard headings and place contact details in the document body.",
      plain: "Lever reads the document text directly, so selectable text and clear headings matter most.",
    },
    Taleo: {
      format: "Prefer DOCX and avoid tables, columns, graphics, and unusual bullets.",
      headings: "Use Work Experience, Education, Skills, and Certifications.",
      plain: "Older Taleo installations can misread complex formatting, so a plain Word document is the safest choice.",
    },
    iCIMS: {
      format: "Use DOCX or text-based PDF; avoid text boxes and multi-column templates.",
      headings: "Use standard, explicit section headings.",
      plain: "iCIMS can parse both formats, but text boxes may cause details to appear out of order.",
    },
    SmartRecruiters: {
      format: "Use DOCX or text-based PDF with a simple one-column structure.",
      headings: "Use Summary, Experience, Skills, and Education.",
      plain: "A simple reading order helps SmartRecruiters populate your profile accurately.",
    },
    Ashby: {
      format: "Use a selectable-text PDF or DOCX with standard sections.",
      headings: "Use Summary, Experience, Skills, Education, and Projects when relevant.",
      plain: "Ashby handles modern files well, but plain text order still produces the most reliable candidate profile.",
    },
    Unknown: base,
  };
  const regional = convention === "US"
    ? "For US resumes, omit photo, date of birth, marital status, and nationality."
    : convention === "UK"
      ? "For UK CVs, omit photo and protected personal details; two pages is commonly acceptable."
      : convention === "EU"
        ? "For EU applications, follow the posting's local convention; include a photo only where explicitly customary."
        : convention === "Canada"
          ? "For Canadian resumes, omit photo and protected personal details and use a concise one-to-two page format."
          : "For Australian resumes, omit photo and protected personal details; two to three pages may be acceptable for experienced candidates.";
  return { vendor, ...specific[vendor], regional };
}

export function evidenceLevel(change: DiffChange): EvidenceLevel {
  if (change.evidenceLevel) return change.evidenceLevel;
  if (change.gapType === "true_gap") return "missing";
  if (change.gapType === "evidence") return "transferable";
  // Only explicit keyword-only changes are safe for one-click acceptance.
  // Unlabelled rewrites still need individual review because a model can omit gap metadata.
  if (change.gapType === "keyword") return "verified";
  return "transferable";
}

export function normalizeChangeForReview(change: DiffChange): DiffChange {
  const clean = { ...change, evidenceLevel: evidenceLevel(change) };
  if (clean.status === "kept") return { ...clean, confirmed: true };
  return { ...clean, status: "confirm", confirmed: false };
}

export function acceptedRows(rows: DiffChange[]) {
  return rows.filter(row => row.status === "rewritten" && row.confirmed === true);
}

export function changeAtsImpact(change: DiffChange, job: JobResult | undefined) {
  const proposed = normalize(change.customText ?? change.proposed);
  const original = normalize(change.original);
  const jobText = normalize([job?.title, job?.description, ...(job?.highlights ?? []).flatMap(h => h.items)].join(" "));
  const added = [...new Set(proposed.split(" "))]
    .filter(term => term.length > 2 && !original.includes(term) && jobText.includes(term) && !STOP_WORDS.has(term));
  const level = evidenceLevel(change);
  if (change.status === "kept") return { delta: 0, keywords: [], explanation: "No score change because the original wording is kept." };
  if (level === "missing") return {
    delta: 0,
    keywords: added.slice(0, 5),
    explanation: "Not counted until you verify this experience; accepting an unsupported claim can harm trust.",
  };
  const delta = Math.min(6, Math.max(1, added.length));
  return {
    delta,
    keywords: added.slice(0, 5),
    explanation: added.length
      ? `May improve matching by aligning ${added.length} job keyword${added.length === 1 ? "" : "s"} with evidence already in your resume.`
      : "Improves clarity or evidence quality, with little direct keyword-score effect.",
  };
}

function findTerms(text: string, list: string[]) {
  const normalized = normalize(text);
  return list.filter(term => normalized.includes(normalize(term)));
}

function tokenKeywords(text: string) {
  const terms = normalize(text).split(" ").filter(term => term.length > 3 && !STOP_WORDS.has(term) && !/^\d+$/.test(term));
  const counts = new Map<string, number>();
  for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function yearsOfExperience(text: string) {
  const values = [...text.matchAll(/\b(\d{1,2})\+?\s*(?:years?|yrs?)\b/gi)].map(match => Number(match[1]));
  return values.length ? Math.max(...values) : 0;
}

export interface ResumeAnalysis {
  score: number;
  hardSkillMatch: number;
  softSkillMatch: number;
  checks: ATSCheck[];
  matchedHardSkills: string[];
  missingHardSkills: string[];
  ats: ReturnType<typeof atsGuidance>;
}

export function analyzeResume(resume: ResumeData, job: Pick<JobResult, "title" | "description" | "highlights" | "applyLink">, convention: ResumeConvention = "US"): ResumeAnalysis {
  const rText = resumeText(resume);
  const jText = [job.title, job.description, ...(job.highlights ?? []).flatMap(h => h.items)].join(" ");
  const jobHard = findTerms(jText, HARD_SKILLS);
  const resumeHard = findTerms(rText, HARD_SKILLS);
  const matchedHard = jobHard.filter(skill => resumeHard.includes(skill));
  const missingHard = jobHard.filter(skill => !resumeHard.includes(skill));
  const jobSoft = findTerms(jText, SOFT_SKILLS);
  const resumeSoft = findTerms(rText, SOFT_SKILLS);
  const matchedSoft = jobSoft.filter(skill => resumeSoft.includes(skill));
  const hardScore = jobHard.length ? Math.round(matchedHard.length / jobHard.length * 100) : 100;
  const softScore = jobSoft.length ? Math.round(matchedSoft.length / jobSoft.length * 100) : 100;

  const resumeYears = yearsOfExperience(rText);
  const requiredYears = yearsOfExperience(jText);
  const seniorityAligned = requiredYears === 0 || resumeYears >= Math.max(0, requiredYears - 1);
  const bullets = (resume.experience ?? []).flatMap(exp => exp.bullets ?? []);
  const measurable = bullets.filter(bullet => /\b\d+(?:[.,]\d+)?\s*(?:%|\+|k|m|million|billion|x|hours?|days?|users?|customers?|revenue|events?)?\b/i.test(bullet)).length;
  const measurablePct = bullets.length ? Math.round(measurable / bullets.length * 100) : 0;
  const words = normalize(rText).split(" ").filter(Boolean);
  const duplicateBullets = bullets.length - new Set(bullets.map(normalize)).size;
  const repetitive = tokenKeywords(bullets.join(" ")).filter(([, count]) => count >= Math.max(4, Math.ceil(bullets.length / 2))).slice(0, 5);
  const contact = resume.contact ?? {};
  const contactOk = Boolean(contact.email && contact.name && (contact.phone || contact.linkedin));
  const lengthOk = words.length >= 250 && words.length <= 1100;
  const ats = atsGuidance(detectAts(job.applyLink), convention);
  const topKeywords = tokenKeywords(jText).slice(0, 20).map(([term]) => term);
  const keywordHits = topKeywords.filter(term => normalize(rText).includes(term));
  const keywordScore = topKeywords.length ? Math.round(keywordHits.length / topKeywords.length * 100) : 100;

  const check = (
    ok: boolean,
    category: string,
    label: string,
    detail: string,
    explanation: string,
    score: number,
  ): ATSCheck => ({ ok, category, label, detail, explanation, score, severity: ok ? "pass" : score >= 50 ? "warning" : "fail" });

  const checks: ATSCheck[] = [
    check(hardScore >= 70, "Skills", "Hard-skill match", `${hardScore}% matched${missingHard.length ? ` · Missing: ${missingHard.slice(0, 6).join(", ")}` : ""}`, "These are tools, technologies, and job-specific capabilities named in the posting.", hardScore),
    check(softScore >= 60, "Skills", "Soft-skill match", `${softScore}% matched`, "These phrases help recruiters see leadership and collaboration fit when supported by examples.", softScore),
    check(seniorityAligned, "Alignment", "Education and seniority alignment", requiredYears ? `${resumeYears || "No"} years visible vs ${requiredYears} requested` : "No strict years requirement detected", "This checks whether the experience level shown on the resume is close to the posting.", seniorityAligned ? 100 : 35),
    check(true, "ATS format", `${ats.vendor} format guidance`, ats.format, ats.plain, ats.vendor === "Unknown" ? 80 : 100),
    check(keywordScore >= 55, "Keywords", "Keyword frequency", `${keywordScore}% of the posting's leading terms appear naturally`, "Important phrases should appear where they truthfully describe your work, without keyword stuffing.", keywordScore),
    check(measurablePct >= 35, "Impact", "Measurable achievements", `${measurable} of ${bullets.length} experience bullets include measurable evidence`, "Numbers make scope and outcomes easier for recruiters to evaluate.", measurablePct),
    check(lengthOk, "Readability", "Resume length", `${words.length} words`, "A focused resume is easier to scan; most experienced candidates fit comfortably within one or two pages.", lengthOk ? 100 : words.length < 250 ? 45 : 65),
    check(contactOk, "Parsing", "Contact information parsing", contactOk ? "Name, email, and a direct contact method detected" : "Add name, email, and phone or LinkedIn", "Recruiters need contact details in the main document body, not in a header or image.", contactOk ? 100 : 25),
    check(duplicateBullets === 0 && repetitive.length === 0, "Writing", "Duplicate and repetitive wording", duplicateBullets || repetitive.length ? `${duplicateBullets} duplicate bullets; repeated terms: ${repetitive.map(([term]) => term).join(", ") || "none"}` : "No obvious repetition detected", "Varied, specific verbs make achievements easier to distinguish.", duplicateBullets === 0 && repetitive.length === 0 ? 100 : 55),
    check(bullets.every(bullet => bullet.length <= 240), "Readability", "Formatting readability", "Single-column structure and concise bullet checks", "Short, direct bullets and a predictable reading order are safer for both ATS parsing and human review.", bullets.every(bullet => bullet.length <= 240) ? 100 : 70),
  ];
  const score = Math.round(
    hardScore * 0.35 + softScore * 0.1 + keywordScore * 0.25 +
    (seniorityAligned ? 100 : 35) * 0.15 + Math.min(100, measurablePct + 30) * 0.15,
  );
  return { score, hardSkillMatch: hardScore, softSkillMatch: softScore, checks, matchedHardSkills: matchedHard, missingHardSkills: missingHard, ats };
}

export function extractJobMetadata(job: JobResult) {
  const text = `${job.description ?? ""} ${(job.highlights ?? []).flatMap(h => h.items).join(" ")}`;
  const visa = /\b(no|not)\s+(?:visa\s+)?sponsor/i.test(text)
    ? "No sponsorship"
    : /\b(?:visa|immigration)\s+sponsor|sponsorship available/i.test(text)
      ? "Sponsorship mentioned"
      : /\b(?:authorized|eligible)\s+to\s+work|work authorization/i.test(text)
        ? "Authorization required"
        : "Not stated";
  const deadlineMatch = text.match(/\b(?:apply by|deadline|closes?(?: on)?)\s*:?\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,\s+\d{4})?|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  return {
    visaRequirement: visa,
    applicationDeadline: deadlineMatch?.[1] ?? "Not stated",
    atsVendor: detectAts(job.applyLink),
  };
}

export function nextRequiredAction(status: string) {
  if (status === "Not Applied") return "Apply today";
  if (status === "Applied") return "Schedule a follow-up";
  if (status === "Waiting") return "Prepare interview stories";
  if (status === "Interview") return "Practice for the interview";
  if (status === "Offer") return "Review and compare the offer";
  return "Archive and note what you learned";
}

