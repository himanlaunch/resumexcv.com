import type { DiffChange, ResumeData } from "@/lib/api";

const UNSAFE_RESUME_NOTE_PATTERNS = [
  /\bdo not\b/i,
  /\bdon[‘’]t\b/i,
  /\bunless\b/i,
  /\bwithout confirmation\b/i,
  /\bif accurate\b/i,
  /\bif applicable\b/i,
  /\bif confirmed\b/i,
  /\bcandidate has\b/i,
  /\bthe candidate\b/i,
  /\bnot in resume\b/i,
  /\btrue_gap\b/i,
  /\bgap type\b/i,
  /\bgaptype\b/i,
  /\bgap note\b/i,
  /\bgapnote\b/i,
  /\bjob requirement\b/i,
  /\bprevious suggestion\b/i,
  /\bproposed rewrite\b/i,
  /\bresume content\b/i,
  /\bresume-ready\b/i,
  /\bretain\b.{0,80}\blanguage\b/i,
  /\badd\b.{0,80}\bskills?\b/i,
  /\binclude\b.{0,80}\bbullet\b/i,
  /\bclaim\b.{0,80}\bownership\b/i,
  /\bflag\b.{0,80}\bgap\b/i,
];

function normalizeText(value: string): string {
  return value
    // Replace em dashes (common AI writing pattern) with a comma or semicolon
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    // Clean up any double commas left by the em dash replacement
    .replace(/,\s*,/g, ",")
    .trim();
}

const LOCATION_ONLY_COUNTRIES = new Set([
  "india",
  "ireland",
  "united states",
  "usa",
  "us",
  "united kingdom",
  "uk",
  "canada",
  "australia",
  "germany",
  "france",
  "netherlands",
  "singapore",
  "remote",
]);

const LOCATION_ONLY_CITIES = new Set([
  "remote",
  "dublin",
  "london",
  "toronto",
  "berlin",
  "amsterdam",
  "singapore",
  "sydney",
  "paris",
  "new york",
  "san francisco",
  "seattle",
  "austin",
  "boston",
  "chicago",
  "los angeles",
  "atlanta",
  "dallas",
  "miami",
  "denver",
  "washington",
]);

export function isLocationOnlyBullet(value: string | null | undefined): boolean {
  const text = normalizeText(value ?? "")
    .replace(/^[•\-–—]\s*/, "")
    .replace(/[.;]\s*$/, "");
  if (!text || text.length > 48) return false;
  if (/\d/.test(text)) return false;
  if (/\b(led|built|created|managed|improved|reduced|increased|automated|partnered|developed|implemented|owned|shipped|analyzed|designed|supported|wrote|promoted)\b/i.test(text)) return false;

  const lower = text.toLowerCase();
  if (LOCATION_ONLY_COUNTRIES.has(lower)) return true;

  const parts = lower.split(",").map(part => part.trim()).filter(Boolean);
  if (parts.length === 2) {
    const [city, countryOrState] = parts;
    return (
      LOCATION_ONLY_CITIES.has(city)
    ) && (
      LOCATION_ONLY_COUNTRIES.has(countryOrState) ||
      /^[a-z]{2}$/.test(countryOrState)
    );
  }

  return false;
}

export function isUnsafeResumeNote(value: string): boolean {
  const text = normalizeText(value);
  if (!text) return false;
  return UNSAFE_RESUME_NOTE_PATTERNS.some((pattern) => pattern.test(text));
}

function safePrefixBeforeUnsafeNote(text: string): string {
  const indexes = UNSAFE_RESUME_NOTE_PATTERNS
    .map((pattern) => text.search(pattern))
    .filter((index) => index > 0);
  if (indexes.length === 0) return "";
  return normalizeText(text.slice(0, Math.min(...indexes)).replace(/[,;:.]\s*$/, ""));
}

export function sanitizeResumeText(value: string | null | undefined): string {
  const text = normalizeText(value ?? "");
  if (!text) return "";

  if (!isUnsafeResumeNote(text)) return text;
  const prefix = safePrefixBeforeUnsafeNote(text);
  if (prefix && !isUnsafeResumeNote(prefix)) return prefix;

  const parts = text
    .split(/(?:\s*[;•]\s*|\n+|(?<=[.!?])\s+)/)
    .map(normalizeText)
    .filter(Boolean)
    .filter((part) => !isUnsafeResumeNote(part));

  return normalizeText(parts.join(" "));
}

export function sanitizeResumeSkillText(value: string | null | undefined): string[] {
  const text = normalizeText(value ?? "");
  if (!text) return [];

  return text
    .split(/\s*(?:,|;|•|\n)\s*/)
    .map(sanitizeResumeText)
    .map(normalizeText)
    .filter(Boolean)
    .filter((part) => !isUnsafeResumeNote(part))
    .filter((part) => part.length <= 80 || !/[.!?]/.test(part));
}

export function sanitizeDiffChange(change: DiffChange): DiffChange {
  const proposed = change.section.toLowerCase().includes("skill")
    ? sanitizeResumeSkillText(change.proposed).join(", ")
    : sanitizeResumeText(change.proposed);
  const customText = change.customText
    ? change.section.toLowerCase().includes("skill")
      ? sanitizeResumeSkillText(change.customText).join(", ")
      : sanitizeResumeText(change.customText)
    : change.customText;

  return {
    ...change,
    proposed,
    customText,
  };
}

export function sanitizeResumeForExport(resume: ResumeData): ResumeData {
  return {
    contact: {
      name: sanitizeResumeText(resume.contact?.name),
      email: sanitizeResumeText(resume.contact?.email),
      location: sanitizeResumeText(resume.contact?.location),
      linkedin: sanitizeResumeText(resume.contact?.linkedin),
      github: sanitizeResumeText(resume.contact?.github),
    },
    summary: sanitizeResumeText(resume.summary),
    skills: (resume.skills ?? []).flatMap(sanitizeResumeSkillText),
    experience: (resume.experience ?? []).map((exp) => ({
      title: sanitizeResumeText(exp.title),
      company: sanitizeResumeText(exp.company),
      period: sanitizeResumeText(exp.period),
      bullets: (exp.bullets ?? [])
        .map(sanitizeResumeText)
        .filter((bullet) => !isLocationOnlyBullet(bullet))
        .filter(Boolean),
    })),
    education: (resume.education ?? []).map((edu) => ({
      degree: sanitizeResumeText(edu.degree),
      school: sanitizeResumeText(edu.school),
      year: sanitizeResumeText(edu.year),
    })),
    certifications: (resume.certifications ?? [])
      .map(sanitizeResumeText)
      .filter(Boolean),
  };
}
