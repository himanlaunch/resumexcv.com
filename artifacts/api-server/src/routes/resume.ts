// @ts-nocheck
import { Router } from "express";
import { createHash } from "crypto";
import OpenAI from "openai";
import { logger } from "../lib/logger.js";
import multer from "multer";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";
import { pool } from "@workspace/db";
import { getSupabaseUser } from "../lib/auth.js";
import { consumeResumeCredit, InsufficientCreditsError, refundResumeCredit } from "../lib/credits.js";

const router = Router();

const DEPLOYMENT = process.env.DIGITALOCEAN_MODEL;

const openai = new OpenAI({
  apiKey: process.env.DIGITALOCEAN_TOKEN ?? "missing-api-key",
  baseURL: "https://inference.do-ai.run/v1",
});

// ── Shared system prompt ──────────────────────────────────────────────────────
const SYSTEM_TAILORING = `You are an expert resume writer and ATS specialist.
Your job is to tailor a candidate's resume for a specific job posting.

STRICT RULES — you must follow these without exception:
1. NEVER fabricate specific companies, clients, job titles, or dates the candidate has not provided.
2. Every change must be grounded in the candidate's actual resume content or plausible adjacent skills.
3. If a job requirement has NO match in the resume, flag it as "true_gap" AND still write a concise, resume-ready "proposed" bullet the candidate can review, edit, and accept or reject. Base it on their background and transferable skills — write it as if they did adjacent work.
4. For "evidence" gaps (skill claimed but no example), always generate a concrete, specific "proposed" bullet showing that skill in action — ground it in their existing experience bullets.
5. Use strong action verbs and quantify impact where evidence already exists in the resume.
6. Optimize keyword density for ATS without keyword stuffing.
7. The "proposed" field must contain FINAL RESUME TEXT ONLY — one or two polished bullet-point sentences ready to paste into a resume. Never include reasoning, caveats, instructions, validation notes, "do not", "unless confirmed", "if accurate", or any meta-commentary in proposed text. Put explanations only in "gapNote".
8. Output ONLY valid JSON — no markdown fences, no commentary outside JSON.
9. NEVER copy job description sentences verbatim into proposed bullets. Always rephrase in the candidate's voice, grounded in their actual experience.
10. BANNED PHRASES — never use these AI-filler/buzzword phrases in any proposed text: "results-driven", "results driven", "passionate about", "seasoned professional", "spearheaded", "orchestrated", "leveraged synergies", "dynamic team player", "thought leader", "game-changer", "game changer", "detail-oriented", "detail oriented", "go-getter", "go getter", "proactive", "innovative", "synergize", "synergized", "circle back", "bandwidth", "paradigm shift", "move the needle", "deep dive", "best-in-class", "best in class", "world-class", "world class". Use specific, concrete language instead.`;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const MAX_RESUME_PARSE_CHARS = 24000;

function cleanJsonText(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJsonObject<T>(text: string): T {
  return JSON.parse(cleanJsonText(text)) as T;
}

const UNSAFE_RESUME_NOTE_PATTERNS = [
  /\bdo not\b/i,
  /\bdon['’]t\b/i,
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
  /\bconfirmation\b/i,
  /\bconfirmed\b/i,
  /\bretain\b.{0,80}\blanguage\b/i,
  /\badd\b.{0,80}\bskills?\b/i,
  /\binclude\b.{0,80}\bbullet\b/i,
  /\bclaim\b.{0,80}\bownership\b/i,
  /\bflag\b.{0,80}\bgap\b/i,
];

function normalizeResumeText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

// Regex-based contact field extraction — used as fallback when AI misses a field.
// PDF text extraction sometimes reorders header lines; this catches the raw value directly.
const PHONE_RE = /(?<!\d)(\+?1[\s.-]?)?(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})(?!\d)/;
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
const LINKEDIN_RE = /(?:linkedin\.com\/in\/|linkedin\.com\/pub\/)([a-zA-Z0-9\-_%]+)/i;

function extractContactFromText(text: string): { phone?: string; email?: string; linkedin?: string } {
  const phoneMatch = PHONE_RE.exec(text);
  const emailMatch = EMAIL_RE.exec(text);
  const linkedinMatch = LINKEDIN_RE.exec(text);
  return {
    phone: phoneMatch ? phoneMatch[0].trim() : undefined,
    email: emailMatch ? emailMatch[0].trim() : undefined,
    linkedin: linkedinMatch ? `linkedin.com/in/${linkedinMatch[1]}` : undefined,
  };
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

function isLocationOnlyBullet(value: string | null | undefined): boolean {
  const text = normalizeResumeText(value ?? "")
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
      LOCATION_ONLY_CITIES.has(city) ||
      /^[a-z\s]+$/.test(city)
    ) && (
      LOCATION_ONLY_COUNTRIES.has(countryOrState) ||
      /^[a-z]{2}$/.test(countryOrState) ||
      /^[a-z\s]+$/.test(countryOrState)
    );
  }

  return false;
}

function isUnsafeResumeNote(value: string): boolean {
  const text = normalizeResumeText(value);
  return !!text && UNSAFE_RESUME_NOTE_PATTERNS.some((pattern) => pattern.test(text));
}

function safePrefixBeforeUnsafeNote(text: string): string {
  const indexes = UNSAFE_RESUME_NOTE_PATTERNS
    .map((pattern) => text.search(pattern))
    .filter((index) => index > 0);
  if (indexes.length === 0) return "";
  return normalizeResumeText(text.slice(0, Math.min(...indexes)).replace(/[,;:.]\s*$/, ""));
}

function sanitizeResumeText(value: string | null | undefined): string {
  const text = normalizeResumeText(value ?? "");
  if (!text || !isUnsafeResumeNote(text)) return text;
  const prefix = safePrefixBeforeUnsafeNote(text);
  if (prefix && !isUnsafeResumeNote(prefix)) return prefix;
  return text
    .split(/(?:\s*[;•]\s*|\n+|(?<=[.!?])\s+)/)
    .map(normalizeResumeText)
    .filter(Boolean)
    .filter((part) => !isUnsafeResumeNote(part))
    .join(" ")
    .trim();
}

function sanitizeResumeSkillText(value: string | null | undefined): string {
  let text = normalizeResumeText(value ?? "");
  if (!text) return "";
  // Split on ". CategoryName:" patterns — AI sometimes uses periods to separate skill category blocks
  text = text.replace(/\.\s+(?=[A-Z][a-zA-Z& ]{2,39}:)/g, "\n");
  return normalizeResumeText(
    text
      .split(/\s*(?:,|;|•|\n)\s*/)
      .map(sanitizeResumeText)
      .map(normalizeResumeText)
      .filter(Boolean)
      .filter((part) => !isUnsafeResumeNote(part))
      .filter((part) => part.length <= 80 || !/[.!?]/.test(part))
      .join(", ")
  );
}

function sanitizeTailoringResult(result: TailoringResult): TailoringResult {
  return {
    ...result,
    changes: (result.changes ?? [])
      .map((change) => {
        const proposed = change.section?.toLowerCase().includes("skill")
          ? sanitizeResumeSkillText(change.proposed)
          : sanitizeResumeText(change.proposed);
        // Gap rows must always be "confirm" so the user can Accept/Retry/Reject them.
        // Exception: Summary is always a narrative rewrite from existing experience — never block it.
        const isSummary = change.section?.toLowerCase() === "summary";
        const hasGap = !isSummary && change.gapType != null && change.gapType !== "null" && change.gapType !== "";
        const status = hasGap && change.status !== "confirm" ? "confirm" : change.status;
        return { ...change, proposed, status };
      })
      .filter((change) => change.proposed || change.status !== "rewritten"),
  };
}

// Strip leading bullet/dash markers that PDF extractors often inject into bullet text
function stripBulletPrefix(text: string): string {
  return text.replace(/^[•\-–—]\s+/, "").trim();
}

function sanitizeResumeRecord(resume: ResumeRecord): ResumeRecord {
  return {
    contact: {
      name: sanitizeResumeText(resume.contact?.name),
      phone: sanitizeResumeText(resume.contact?.phone),
      email: sanitizeResumeText(resume.contact?.email),
      location: sanitizeResumeText(resume.contact?.location),
      linkedin: sanitizeResumeText(resume.contact?.linkedin),
      github: sanitizeResumeText(resume.contact?.github),
    },
    summary: sanitizeResumeText(resume.summary),
    skills: (resume.skills ?? [])
      .flatMap((skill) => sanitizeResumeSkillText(skill).split(/\s*,\s*/))
      .map(normalizeResumeText)
      .filter(Boolean),
    skillGroups: (resume.skillGroups ?? [])
      .filter(g => g.category && Array.isArray(g.skills))
      .map(g => ({
        category: sanitizeResumeText(g.category),
        skills: g.skills
          .flatMap(s => sanitizeResumeSkillText(s).split(/\s*,\s*/))
          .map(normalizeResumeText)
          .filter(Boolean),
      }))
      .filter(g => g.category && g.skills.length > 0),
    experience: (resume.experience ?? []).map((exp) => ({
      title: sanitizeResumeText(exp.title),
      company: sanitizeResumeText(exp.company),
      location: sanitizeResumeText(exp.location),
      period: sanitizeResumeText(exp.period),
      bullets: (exp.bullets ?? [])
        .map(stripBulletPrefix)
        .map(sanitizeResumeText)
        .filter((bullet) => !isLocationOnlyBullet(bullet))
        .filter(Boolean),
    })),
    education: (resume.education ?? []).map((edu) => ({
      degree: sanitizeResumeText(edu.degree),
      school: sanitizeResumeText(edu.school),
      location: sanitizeResumeText(edu.location),
      year: sanitizeResumeText(edu.year),
      notes: sanitizeResumeText(edu.notes),
    })),
    projects: (resume.projects ?? []).map((proj) => ({
      name: sanitizeResumeText(proj.name),
      period: sanitizeResumeText(proj.period),
      bullets: (proj.bullets ?? []).map(stripBulletPrefix).map(sanitizeResumeText).filter(Boolean),
    })).filter(p => p.name),
    ...classifyAndSanitize(resume),
  };
}

// Normalize a string for dedup comparison: lowercase, strip punctuation/year suffixes
function dedupNorm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*\(.*?\)/g, "") // strip parenthetical notes like "(BMC)" or "(All India Rank-4, 2012)"
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Patterns that indicate an item is an achievement/award, NOT a certification
const ACHIEVEMENT_PATTERNS = [
  /scholarship/i,
  /rank[\s-]?\d/i,
  /merit[\s-]based/i,
  /honour|honor/i,
  /award/i,
  /prize/i,
  /\btopper\b/i,
  /\branked\b/i,
  /\ball india\b/i,
  /\bnational rank\b/i,
  /\bgold medal\b/i,
  /\bsilver medal\b/i,
];

function isAchievementItem(s: string): boolean {
  return ACHIEVEMENT_PATTERNS.some(re => re.test(s));
}

// Deduplicate a list, keeping the longer (more specific) version when two are near-duplicates
function deduplicateList(items: string[]): string[] {
  const kept: string[] = [];
  for (const item of items) {
    const norm = dedupNorm(item);
    // Check if this item is already represented by a kept item (substring match either way)
    const isDup = kept.some(k => {
      const kNorm = dedupNorm(k);
      return norm === kNorm || norm.includes(kNorm) || kNorm.includes(norm);
    });
    if (!isDup) {
      // Replace any existing kept item that is a prefix of this one (keep the more specific)
      const idxToReplace = kept.findIndex(k => {
        const kNorm = dedupNorm(k);
        return norm.includes(kNorm) && item.length > k.length;
      });
      if (idxToReplace >= 0) {
        kept[idxToReplace] = item;
      } else {
        kept.push(item);
      }
    }
  }
  return kept;
}

function classifyAndSanitize(resume: ResumeRecord): { certifications: string[]; achievements: string[] } {
  const rawCerts = (resume.certifications ?? []).map(sanitizeResumeText).filter(Boolean);
  const rawAch = (resume.achievements ?? []).map(sanitizeResumeText).filter(Boolean);

  // Move any achievement-pattern items that ended up in certifications
  const certs: string[] = [];
  const promoted: string[] = [];
  for (const c of rawCerts) {
    if (isAchievementItem(c)) promoted.push(c);
    else certs.push(c);
  }

  const achievements = deduplicateList([...rawAch, ...promoted]);
  const certifications = deduplicateList(certs);

  return { certifications, achievements };
}

async function repairTailoringJson(malformedJson: string, parseError: unknown): Promise<TailoringResult> {
  const completion = await openai.chat.completions.create({
    model: DEPLOYMENT,
    extra_body: { enable_thinking: false },
    messages: [
      {
        role: "system",
        content: `You repair malformed JSON from a resume tailoring system.
Return ONLY one valid JSON object. No markdown fences. No explanation.
Preserve all complete changes already present. If the input is truncated, close the current object safely and keep only complete, factual changes.`,
      },
      {
        role: "user",
        content: `The previous JSON failed to parse with this error:
${parseError instanceof Error ? parseError.message : String(parseError)}

Repair it into this exact schema:
{
  "matchScore": 0,
  "seniorityMatch": "perfect",
  "changes": [
    {
      "id": "string",
      "section": "string",
      "original": "string",
      "jobReq": "string",
      "proposed": "string",
      "status": "rewritten",
      "gapType": null,
      "gapNote": "string"
    }
  ],
  "skillGaps": { "keyword": [], "evidence": [], "trueGap": [] },
  "senioritySignals": []
}

Malformed JSON:
${malformedJson.slice(0, 50000)}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const repaired = completion.choices[0]?.message?.content ?? "{}";
  return parseJsonObject<TailoringResult>(repaired);
}

// POST /api/resume/parse  (multipart/form-data — field: "file")
router.post("/parse", upload.single("file"), async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) {
    return res.status(401).json({ error: "Sign in to parse your resume." });
  }

  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file uploaded. Send a resume file in the 'file' field." });

  const ext = file.originalname.split(".").pop()?.toLowerCase() ?? "";
  const mime = file.mimetype;
  let text = "";

  try {
    if (mime === "application/pdf" || ext === "pdf") {
      const data = await pdfParse(file.buffer);
      text = data.text;
    } else if (
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      ext === "docx"
    ) {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      text = result.value;
    } else if (mime === "text/plain" || ext === "txt") {
      text = file.buffer.toString("utf-8");
    } else {
      return res.status(400).json({ error: `Unsupported file type ".${ext}". Please upload a PDF, DOCX, or TXT file.` });
    }
  } catch (extractErr) {
    logger.error({ extractErr }, "Text extraction failed");
    return res.status(400).json({ error: "Could not extract text from the file. Make sure it is not a scanned-image PDF." });
  }

  if (!text.trim()) {
    return res.status(400).json({ error: "No text found in the file. Make sure it is not a scanned-image PDF." });
  }

  const fileHash = createHash("sha256").update(file.buffer).digest("hex");

  try {
    await ensureParseCacheTable();
    const cached = await pool.query("SELECT result FROM cached_resume_parses WHERE file_hash = $1", [fileHash]);
    if (cached.rows.length > 0) {
      // Re-apply sanitization on cached results so fixes apply without re-parsing
      const cachedResult = cached.rows[0].result;
      // If cached parse lacks skillGroups, fall through to fresh AI parse so the prompt upgrade takes effect
      if (cachedResult?.resume && (cachedResult.resume.skillGroups ?? []).length === 0 && (cachedResult.resume.skills ?? []).length > 0) {
        // intentional fall-through
      } else {
      if (cachedResult?.resume) {
        cachedResult.resume = sanitizeResumeRecord(cachedResult.resume);
        // Backfill contact fields the AI may have missed using regex on the raw text
        const regexContact = extractContactFromText(text);
        if (!cachedResult.resume.contact.phone && regexContact.phone) cachedResult.resume.contact.phone = regexContact.phone;
        if (!cachedResult.resume.contact.email && regexContact.email) cachedResult.resume.contact.email = regexContact.email;
        if (!cachedResult.resume.contact.linkedin && regexContact.linkedin) cachedResult.resume.contact.linkedin = regexContact.linkedin;
      }
      return res.json(cachedResult);
      }
    }
  } catch {
    // Cache lookup failure is non-fatal — fall through to AI parse
  }

  try {
    const completion = await openai.chat.completions.create({
      model: DEPLOYMENT,
      max_completion_tokens: 3000,
      extra_body: { enable_thinking: false },
      messages: [
        {
          role: "system",
          content: `You are a resume parsing expert. Extract structured information from resume text.
Return ONLY a valid JSON object matching the schema provided. No markdown fences. No commentary outside JSON.
Preserve the candidate's full career history and factual detail. Do not optimize for a one-page resume.`,
        },
        {
          role: "user",
          content: `Parse this resume and return a JSON object with EXACTLY this shape:

{
  "resume": {
    "contact": { "name": "...", "phone": "...", "email": "...", "location": "...", "linkedin": "...", "github": "..." },
    "summary": "...",
    "skills": ["..."],
    "skillGroups": [{ "category": "...", "skills": ["..."] }],
    "experience": [{ "title": "...", "company": "...", "location": "...", "period": "...", "bullets": ["..."] }],
    "education": [{ "degree": "...", "school": "...", "location": "...", "year": "...", "notes": "..." }],
    "certifications": ["..."],
    "achievements": ["..."],
    "projects": [{ "name": "...", "period": "...", "bullets": ["..."] }]
  },
  "recommendations": {
    "titles": [{ "title": "...", "reason": "..." }],
    "locations": [{ "label": "...", "icon": "📍" }]
  }
}

Rules:
- "titles": suggest 4-6 job titles this candidate should search for based on their actual experience and seniority. Brief reason for each.
- "locations": include their current location (icon "📍") and "Remote (US)" (icon "🌐"). Add 1-2 relevant tech hubs if appropriate.
- Use empty strings or empty arrays for missing fields — never null or undefined.
- Preserve every work experience role that appears in the resume text, including older roles, internships, and contract roles.
- Preserve all meaningful bullet details, metrics, technologies, scope, domains, tools, and outcomes from each role.
- Do not truncate bullets or collapse multiple roles together.
- If the resume does not have an explicit summary, write a concise professional summary grounded only in the resume text.
- "contact.phone": extract the candidate's phone number exactly as written.
- "experience[].location": extract the city/country where each role was based (e.g. "Dublin, Ireland", "Remote, USA"). Use empty string if not stated.
- "education[].location": extract the city/country of the school (e.g. "St. Louis, MO"). Use empty string if not stated.
- "education[].notes": capture any sub-details about each education entry such as GPA, grade, distinction, honours, or specific achievements (e.g. "GPA: 3.8", "Distinction"). Use empty string if not stated.
- "projects": capture any Projects, Side Projects, or Personal Projects section. Each entry has a name (project name or URL), optional period, and bullets describing it. Use empty array if no projects section exists.
- "achievements": capture items from any Achievements, Awards, Honours, or Scholarships section — scholarships, national/state rankings, merit awards, medals, promotions. Do NOT put these in certifications.
- "certifications": ONLY professional certifications, technical credentials, and training program completions (e.g. "AWS Certified", "Microsoft SQL Server Training", "Bloomberg Market Concepts"). NOT scholarships, rankings, or awards.
- DEDUPLICATION: If the same certification or achievement appears twice (e.g. once with and once without a year/parenthetical), include it ONLY ONCE — keep the more detailed version.
- Never list the same item in both certifications and achievements.
- IMPORTANT: Do NOT include leading dashes or bullet characters in bullet text — write bullet content as plain text only.
- "skillGroups": group ALL skills from the "skills" array into 3–7 meaningful categories (e.g. "Programming Languages", "Data & Analytics", "Cloud & Infrastructure", "Marketing Platforms", "BI & Visualization", "Project Management", "Soft Skills"). Every skill in "skills" must appear in exactly one group. If skills are already grouped in the resume text, preserve those groups.

RESUME TEXT:
${text.slice(0, MAX_RESUME_PARSE_CHARS)}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    // Sanitize before returning and caching so dedup/classification always applies
    if (parsed?.resume) {
      parsed.resume = sanitizeResumeRecord(parsed.resume);
      // Backfill contact fields the AI may have missed using regex on the raw text
      const regexContact = extractContactFromText(text);
      if (!parsed.resume.contact.phone && regexContact.phone) parsed.resume.contact.phone = regexContact.phone;
      if (!parsed.resume.contact.email && regexContact.email) parsed.resume.contact.email = regexContact.email;
      if (!parsed.resume.contact.linkedin && regexContact.linkedin) parsed.resume.contact.linkedin = regexContact.linkedin;
    }
    pool.query(
      "INSERT INTO cached_resume_parses (file_hash, result) VALUES ($1, $2) ON CONFLICT (file_hash) DO UPDATE SET result = EXCLUDED.result",
      [fileHash, JSON.stringify(parsed)]
    ).catch(() => {});
    return res.json(parsed);
  } catch (aiErr: any) {
    logger.error({
      aiErrStatus: aiErr?.status,
      aiErrMessage: aiErr?.message,
      aiErrBody: typeof aiErr?.error === "object" ? JSON.stringify(aiErr.error) : aiErr?.error,
      model: DEPLOYMENT,
    }, "AI resume parsing failed");
    const userMsg = aiErr?.status === 403
      ? "AI service rejected the request (403). Check that DIGITALOCEAN_MODEL is set to a valid model slug."
      : "AI parsing failed. Please try again.";
    return res.status(500).json({ error: userMsg });
  }
});

// POST /api/resume/tailor  (streaming SSE)
// Body: { resume: ResumeData, job: JobData }
router.post("/tailor", async (req, res) => {
  const { resume, job } = req.body as { resume: ResumeRecord; job: JobRecord };

  if (!resume || !job) {
    return res.status(400).json({ error: "resume and job required" });
  }

  const user = await getSupabaseUser(req);
  if (!user) {
    return res.status(401).json({ error: "Sign in to tailor resumes." });
  }

  const tailorCacheKey = createHash("sha256")
    .update(JSON.stringify(resume) + (job.id ?? job.title) + job.company + (job.description ?? "").slice(0, 500))
    .digest("hex")
    .slice(0, 40);

  try {
    await ensureTailorCacheTable();
    const cached = await pool.query(
      "SELECT result FROM cached_tailoring_results WHERE cache_key = $1 AND expires_at > NOW()",
      [tailorCacheKey]
    );
    if (cached.rows.length > 0) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
      res.write(`data: ${JSON.stringify({ type: "status", message: "Loading cached result…" })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "result", data: cached.rows[0].result })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
      return;
    }
  } catch {
    // Cache lookup failure — proceed with AI call
  }

  let creditHold: { consumedFree: boolean } | null = null;
  const creditSourceId = `${user.id}:${job.id ?? job.title}:${Date.now()}`;
  try {
    creditHold = await consumeResumeCredit(user.id, creditSourceId, {
      jobId: job.id,
      jobTitle: job.title,
      jobCompany: job.company,
    });
  } catch (err) {
    if (err instanceof InsufficientCreditsError || err?.code === "INSUFFICIENT_CREDITS") {
      return res.status(402).json({
        error: err.message,
        code: "INSUFFICIENT_CREDITS",
        balance: err.balance ?? 0,
      });
    }
    logger.error({ err, userId: user.id }, "Credit consume failed");
    return res.status(503).json({
      error: "Resume credits are temporarily unavailable. Please retry this job.",
      code: "CREDIT_RESERVATION_FAILED",
    });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendEvent({ type: "status", message: "Analysing job requirements…" });

    const prompt = buildTailoringPrompt(resume, job);

    sendEvent({ type: "status", message: "Generating tailored changes…" });

    const stream = await openai.chat.completions.create(
      {
        model: DEPLOYMENT,
        messages: [
          { role: "system", content: SYSTEM_TAILORING },
          { role: "user", content: prompt },
        ],
        stream: true,
        extra_body: { enable_thinking: false },
        response_format: { type: "json_object" },
      },
      // Abort the streaming request if the model hasn't finished in 90s
      { signal: AbortSignal.timeout(90_000) },
    );

    let fullText = "";
    let finishReason = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      fullText += delta;
      finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
    }

    // Parse and stream individual diff rows
    let parsed: TailoringResult;
    try {
      parsed = parseJsonObject<TailoringResult>(fullText);
    } catch (parseErr) {
      logger.warn({ parseErr, finishReason, length: fullText.length }, "Tailoring JSON parse failed; attempting repair");
      sendEvent({
        type: "status",
        message: finishReason === "length"
          ? "The model response was truncated. Repairing generated resume…"
          : "Repairing generated resume…",
      });
      parsed = await repairTailoringJson(fullText, parseErr);
    }
    parsed = sanitizeTailoringResult(parsed);

    sendEvent({ type: "status", message: "Checking ATS compliance…" });

    // Enrich with ATS check
    const atsResult = runATSCheck(resume, parsed.changes ?? []);
    parsed.atsChecks = atsResult;

    // Cache the result for 48 hours
    const tailorExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000);
    pool.query(
      "INSERT INTO cached_tailoring_results (cache_key, result, expires_at) VALUES ($1, $2, $3) ON CONFLICT (cache_key) DO UPDATE SET result = $2, expires_at = $3",
      [tailorCacheKey, JSON.stringify(parsed), tailorExpiry]
    ).catch(() => {});

    sendEvent({ type: "result", data: parsed });
    sendEvent({ type: "done" });
  } catch (err: any) {
    if (creditHold) {
      await refundResumeCredit(user.id, creditSourceId, creditHold.consumedFree, {
        jobId: job.id,
        jobTitle: job.title,
        jobCompany: job.company,
        reason: err instanceof Error ? err.message : String(err),
      }).catch(refundErr => logger.error({ refundErr, userId: user.id }, "Credit refund failed"));
    }

    // Azure OpenAI quota / rate-limit errors — surface a friendly message and
    // tell the client how long to wait so it can show a retry countdown.
    const isRateLimit = err?.status === 429 || err?.constructor?.name === "RateLimitError" || /rate.?limit/i.test(err?.message ?? "");
    const isTimeout = err?.name === "TimeoutError" || err?.code === "ETIMEDOUT" || /timeout/i.test(err?.message ?? "");

    if (isRateLimit) {
      logger.warn({ userId: user.id, jobId: job.id }, "Azure OpenAI rate limit on tailor");
      const retryAfter = err?.headers?.["retry-after"] ?? "30";
      sendEvent({
        type: "error",
        error: "The AI service is busy right now. Please wait a moment and retry this job.",
        code: "AI_RATE_LIMITED",
        retryAfter: Number(retryAfter),
      });
    } else if (isTimeout) {
      logger.warn({ userId: user.id }, "Tailor request timed out");
      sendEvent({
        type: "error",
        error: "The request timed out. Please retry this job.",
        code: "AI_TIMEOUT",
      });
    } else {
      logger.error({ err }, "Resume tailor error");
      const message = err instanceof SyntaxError
        ? "Resume generation returned incomplete data. Please retry this job."
        : err instanceof Error
          ? err.message
          : String(err);
      sendEvent({ type: "error", error: message });
    }
  } finally {
    res.end();
  }

  return;
});

// POST /api/resume/ats-check
// Body: { resume: ResumeData, changes: DiffRow[] }
router.post("/ats-check", async (req, res) => {
  const { resume, changes } = req.body as { resume: ResumeRecord; changes: DiffChange[] };

  if (!resume) return res.status(400).json({ error: "resume required" });

  try {
    const checks = runATSCheck(resume, changes ?? []);
    return res.json({ checks });
  } catch (err) {
    logger.error({ err }, "ATS check error");
    return res.status(500).json({ error: "ATS check failed" });
  }
});

// POST /api/resume/suggest-gap-experience
// Body: { resume: ResumeRecord, gapStart: string, gapEnd: string, durationMonths: number }
router.post("/suggest-gap-experience", async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Sign in to use this feature." });

  const { resume, gapStart, gapEnd, durationMonths } = req.body as {
    resume: ResumeRecord;
    gapStart: string;
    gapEnd: string;
    durationMonths: number;
  };

  if (!resume || !gapStart || !gapEnd) {
    return res.status(400).json({ error: "resume, gapStart, and gapEnd are required" });
  }

  const careerContext = [
    resume.summary ? `Summary: ${resume.summary.slice(0, 300)}` : "",
    `Roles: ${(resume.experience ?? []).slice(0, 3).map(e => `${e.title} at ${e.company} (${e.period})`).join("; ")}`,
    `Skills: ${(resume.skills ?? []).slice(0, 15).join(", ")}`,
  ].filter(Boolean).join("\n");

  try {
    const completion = await openai.chat.completions.create({
      model: DEPLOYMENT,
      max_completion_tokens: 512,
      extra_body: { enable_thinking: false },
      messages: [
        {
          role: "system",
          content: `You help professionals recall activities they may have forgotten to include on their resume.
Given a gap period, suggest plausible activities this person might have done (freelance work, online courses, certifications, open-source projects, caregiving, side business, travel, etc.).
The user will review these proposals and confirm or reject them — they are memory prompts, not fabrications.
Return ONLY valid JSON. No markdown fences. No commentary.`,
        },
        {
          role: "user",
          content: `This professional has a ${durationMonths}-month gap in their resume from ${gapStart} to ${gapEnd}.

Career context:
${careerContext}

Suggest 2–3 plausible activities they may have done during this gap.
Return JSON with exactly this shape:
{
  "title": "<honest label e.g. 'Freelance Consulting' or 'Independent Projects & Learning'>",
  "company": "<context e.g. 'Self-Employed' or 'Independent'>",
  "period": "${gapStart} – ${gapEnd}",
  "bullets": ["<plausible activity 1>", "<plausible activity 2>", "<plausible activity 3>"]
}

Rules:
- Bullets must be plausible for someone with their background but general enough to be honest
- Do NOT claim specific companies, clients, or metrics not in the resume
- Use action verbs; keep bullets concise and resume-ready
- Title should be neutral and honest (e.g. "Career Development", "Freelance Projects", "Independent Consulting")`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const text = completion.choices[0]?.message?.content ?? "{}";
    const raw = JSON.parse(text) as { title?: string; company?: string; period?: string; bullets?: string[] };
    return res.json({
      suggestion: {
        title: sanitizeResumeText(raw.title ?? "Independent Work"),
        company: sanitizeResumeText(raw.company ?? "Self-Employed"),
        period: sanitizeResumeText(raw.period ?? `${gapStart} – ${gapEnd}`),
        bullets: (raw.bullets ?? []).map(sanitizeResumeText).filter(Boolean),
      },
    });
  } catch (err) {
    logger.error({ err }, "Suggest gap experience error");
    return res.status(500).json({ error: "Failed to generate gap suggestion" });
  }
});

// POST /api/resume/retry-change
// Body: { resume: ResumeData, job: JobData, change: DiffRow }
router.post("/retry-change", async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Sign in to use this feature." });

  const { resume, job, change } = req.body as {
    resume: ResumeRecord;
    job: JobRecord;
    change: DiffChange;
  };

  if (!resume || !job || !change) {
    return res.status(400).json({ error: "resume, job, change required" });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: DEPLOYMENT,
      max_completion_tokens: 512,
      extra_body: { enable_thinking: false },
      messages: [
        { role: "system", content: SYSTEM_TAILORING },
        {
          role: "user",
          content: `You previously suggested this change for section "${change.section}":

ORIGINAL: ${change.original}
JOB REQUIREMENT: ${change.jobReq}
PREVIOUS SUGGESTION: ${change.proposed}

The user rejected this. Generate ONE alternative suggestion that:
- Is more conservative (relies strictly on existing resume content)
- Does NOT add any skill or experience not in the original
- Finds a different angle to address the requirement
- Is final resume text only, with no caveats, instructions, analysis, or "do not" notes

Return JSON: { "proposed": "...", "rationale": "..." }`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const text = completion.choices[0]?.message?.content ?? "{}";
    const result = JSON.parse(text) as { proposed: string; rationale: string };
    return res.json({ ...result, proposed: sanitizeResumeText(result.proposed) });
  } catch (err) {
    logger.error({ err }, "Retry change error");
    return res.status(500).json({ error: "Retry failed" });
  }
});

// POST /api/resume/cover-letter  (streaming SSE)
// Body: { resume: ResumeData, job: JobData }
router.post("/cover-letter", async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Sign in to generate a cover letter." });

  const { resume, job } = req.body as { resume: ResumeRecord; job: JobRecord };

  if (!resume || !job) return res.status(400).json({ error: "resume and job required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const stream = await openai.chat.completions.create({
      model: DEPLOYMENT,
      max_completion_tokens: 1024,
      extra_body: { enable_thinking: false },
      messages: [
        {
          role: "system",
          content: `You are an expert cover letter writer. Write a concise, honest, 3-paragraph cover letter.
Do NOT fabricate any experience. Only use information from the provided resume.
Write in first person, professional tone.
BANNED OPENERS AND PHRASES — never use: "I am writing to", "I am excited to", "I am passionate about", "I would be a great fit", "dynamic team", "I am a passionate", "seasoned professional", "results-driven", "spearheaded", "orchestrated", "leveraged", "synergized", "thought leader", "innovative", "proactive", "game-changer", "detail-oriented", "go-getter".
Open with a concrete accomplishment or direct statement of what you bring, not a generic interest statement.
Output plain text only — no JSON, no markdown.`,
        },
        {
          role: "user",
          content: `Write a cover letter for:

CANDIDATE: ${resume.contact?.name ?? "The candidate"}
JOB: ${job.title} at ${job.company}
JOB DESCRIPTION: ${job.description?.slice(0, 1200) ?? ""}

RESUME SUMMARY: ${resume.summary ?? ""}
TOP EXPERIENCE: ${resume.experience?.slice(0, 2).map((e) => `${e.title} at ${e.company}: ${e.bullets?.slice(0, 2).join("; ")}`).join("\n") ?? ""}
SKILLS: ${resume.skills?.join(", ") ?? ""}`,
        },
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content ?? "";
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    logger.error({ err }, "Cover letter error");
    res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
  } finally {
    res.end();
  }

  return;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildTailoringPrompt(resume: ResumeRecord, job: JobRecord): string {
  return `Tailor this resume for the job below. Return a JSON object with this exact shape:

{
  "matchScore": <number 0-100 — the PROJECTED keyword match AFTER the user accepts all your proposed changes. Aim for 85-95. This is not the current score; it is the score the resume will have once all rewrites are applied.>,
  "seniorityMatch": <"perfect" | "stretch" | "overqualified">,
  "changes": [
    {
      "id": "<unique string>",
      "section": "<section name — use exact format: 'Summary', 'Skills', 'Education', 'Certifications', 'Projects - <Project Name>', or 'Experience - <Company Name>' for bullets>",
      "original": "<original text from resume or '[Not in resume]'>",
      "jobReq": "<specific requirement from job description this addresses>",
      "proposed": "<final resume-ready rewrite only; no notes, reasoning, caveats, or instructions>",
      "status": <"rewritten" | "kept" | "confirm">,
      "gapType": <null | "keyword" | "evidence" | "true_gap">,
      "gapNote": "<explanation if gapType is not null>"
    }
  ],
  "skillGaps": {
    "keyword": ["<skill in resume but phrased differently>"],
    "evidence": ["<skill claimed but no example bullet>"],
    "trueGap": ["<required skill completely absent from resume>"]
  },
  "senioritySignals": ["<list of seniority-tone suggestions, e.g. change 'I built' to 'Led team to build'>"]
}

TAILORING RULES — follow all of these:
1. Coverage target: your proposed changes must collectively inject at least 85% of the job's important keywords into the resume. Review the job description carefully and identify every significant keyword, skill, tool, methodology, and requirement. Rewrite bullets and the summary to naturally incorporate them.
2. Rewrite every experience bullet that can be made more relevant — do not leave relevant bullets unchanged when they could be keyword-enriched.
3. Rewrite the summary as 2–3 complete narrative sentences that communicate the candidate's value proposition, years of experience, key domains, and top 2–3 job requirements. Write as prose — do NOT use comma-separated skill lists inside the summary (e.g. avoid "Skilled in X, Y, Z, A, B, C" patterns).
4. Add or rewrite Skills entries to match the job's technology/tool requirements that the candidate demonstrably has. For Skills changes, "original" must be the exact individual skill text as it appears in the resume (one skill per change row). Do NOT combine multiple skills or categories into a single "proposed" value.
5. Every job requirement should map to at least one "proposed" change. If no existing bullet covers a requirement, create a new "confirm" bullet the candidate can accept or edit.
6. matchScore MUST reflect the score AFTER all changes are accepted — not the current score. Calculate it by estimating what percentage of the job's key requirements your proposed text covers.

RESUME:
Name: ${resume.contact?.name ?? ""}
Phone: ${resume.contact?.phone ?? ""}
Location: ${resume.contact?.location ?? ""}
Summary: ${resume.summary ?? ""}
Skills: ${(() => {
  const groups = (resume.skillGroups ?? []).filter((g: { category: string; skills: string[] }) => g.category && g.skills?.length > 0);
  if (groups.length > 0) return groups.map((g: { category: string; skills: string[] }) => `${g.category}: ${g.skills.join(", ")}`).join(" | ");
  return resume.skills?.join(", ") ?? "";
})()}
Experience:
${resume.experience?.map((e) => `- ${e.title} at ${e.company}${e.location ? ` (${e.location})` : ""} (${e.period})\n  ${e.bullets?.join("\n  ") ?? ""}`).join("\n") ?? ""}
${(resume.projects ?? []).length > 0 ? `Projects:\n${(resume.projects ?? []).map((p) => `- ${p.name}${p.period ? ` (${p.period})` : ""}\n  ${(p.bullets ?? []).join("\n  ")}`).join("\n")}` : ""}
Education: ${resume.education?.map((e) => `${e.degree} from ${e.school}${e.location ? `, ${e.location}` : ""} (${e.year})`).join("; ") ?? ""}
Certifications: ${resume.certifications?.join(", ") ?? ""}
Achievements: ${resume.achievements?.join(" | ") ?? ""}

JOB:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location ?? ""}
Description: ${job.description ?? ""}
${job.highlights?.length ? `Highlights:\n${job.highlights.map((h) => `${h.title}:\n${h.items?.join("\n")}`).join("\n")}` : ""}

Critical output rule: "proposed" is inserted into the user's resume if accepted. It must read exactly like resume content. Never put comments such as "do not add", "if accurate", "unless confirmed", "retain language", or any analysis into "proposed"; put gap explanations only in "gapNote".

Produce ONLY the JSON object. No markdown fences. No extra commentary.`;
}

function runATSCheck(resume: ResumeRecord, changes: DiffChange[]): ATSCheck[] {
  const checks: ATSCheck[] = [];

  // Contact completeness
  const hasName = !!resume.contact?.name?.trim();
  const hasEmail = !!resume.contact?.email?.trim();
  const hasLocation = !!resume.contact?.location?.trim();
  const hasLinkedIn = !!resume.contact?.linkedin?.trim();
  const hasPhone = !!resume.contact?.phone?.trim();
  checks.push({ ok: hasName && hasEmail, category: "Contact", label: "Name & Email", detail: hasName && hasEmail ? "Name and email are present." : `Missing: ${!hasName ? "name" : ""}${!hasName && !hasEmail ? ", " : ""}${!hasEmail ? "email" : ""}.` });
  checks.push({ ok: hasPhone, category: "Contact", label: "Phone number", detail: hasPhone ? "Phone number present." : "Phone number missing — many ATS systems require it." });
  checks.push({ ok: hasLocation, category: "Contact", label: "Location", detail: hasLocation ? `Location: ${resume.contact!.location}` : "Location missing. ATS often filters by location." });
  checks.push({ ok: hasLinkedIn, category: "Contact", label: "LinkedIn URL", detail: hasLinkedIn ? "LinkedIn URL present." : "No LinkedIn URL detected." });

  // Summary
  const hasSummary = !!resume.summary?.trim();
  const summaryWordCount = resume.summary?.trim().split(/\s+/).length ?? 0;
  checks.push({ ok: hasSummary && summaryWordCount >= 20, category: "Content", label: "Professional summary", detail: hasSummary ? (summaryWordCount < 20 ? "Summary is very short — aim for 30–60 words." : "Summary is present and adequate.") : "No summary section detected. A keyword-rich summary boosts ATS ranking." });

  // Skills
  const skillCount = resume.skills?.length ?? 0;
  checks.push({ ok: skillCount >= 5, category: "Content", label: "Skills list", detail: skillCount >= 5 ? `${skillCount} skills listed.` : skillCount === 0 ? "No skills section found. ATS scans for skill keywords." : `Only ${skillCount} skills listed — aim for at least 8–12 relevant skills.` });

  // Experience bullets
  const allRoles = resume.experience ?? [];
  const rolesWithBullets = allRoles.filter(e => (e.bullets?.length ?? 0) > 0).length;
  checks.push({ ok: allRoles.length > 0, category: "Experience", label: "Work experience", detail: allRoles.length > 0 ? `${allRoles.length} role(s) found.` : "No experience section detected." });
  checks.push({ ok: rolesWithBullets === allRoles.length && allRoles.length > 0, category: "Experience", label: "Bullet points in all roles", detail: rolesWithBullets === allRoles.length ? "All roles have bullet points." : `${allRoles.length - rolesWithBullets} role(s) have no bullets — ATS needs content to parse.` });

  // Quantified bullets
  const allBullets = allRoles.flatMap(e => e.bullets ?? []);
  const quantifiedCount = allBullets.filter(b => /\d/.test(b)).length;
  const quantifiedRatio = allBullets.length > 0 ? quantifiedCount / allBullets.length : 0;
  checks.push({ ok: quantifiedRatio >= 0.3, category: "Experience", label: "Quantified achievements", detail: allBullets.length === 0 ? "No bullets to check." : quantifiedRatio >= 0.3 ? `${quantifiedCount} of ${allBullets.length} bullets contain numbers/metrics.` : `Only ${quantifiedCount} of ${allBullets.length} bullets have numbers — aim for at least 30% quantified.` });

  // Date format consistency
  const periods = allRoles.map(e => e.period ?? "").filter(Boolean);
  const isoCount = periods.filter(p => /\d{4}/.test(p)).length;
  checks.push({ ok: periods.length === 0 || isoCount === periods.length, category: "Formatting", label: "Date format consistency", detail: periods.length === 0 ? "No date periods found." : isoCount === periods.length ? "Dates include years — consistent format detected." : "Some roles have inconsistent or missing year formats." });

  // Education
  const hasEdu = (resume.education?.length ?? 0) > 0;
  checks.push({ ok: hasEdu, category: "Education", label: "Education section", detail: hasEdu ? `${resume.education!.length} education record(s).` : "No education section found." });

  // Tailoring changes applied
  checks.push({ ok: changes.length > 0, category: "Tailoring", label: "Tailoring applied", detail: changes.length > 0 ? `${changes.length} tailoring change(s) applied for this job.` : "No tailoring changes — consider tailoring your resume to this job." });

  return checks;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ResumeRecord {
  contact?: { name?: string; phone?: string; email?: string; location?: string; linkedin?: string; github?: string };
  summary?: string;
  skills?: string[];
  skillGroups?: { category: string; skills: string[] }[];
  experience?: { title: string; company: string; location?: string; period: string; bullets?: string[] }[];
  education?: { degree: string; school: string; location?: string; year: string; notes?: string }[];
  certifications?: string[];
  achievements?: string[];
  projects?: { name: string; period?: string; bullets?: string[] }[];
}

interface JobRecord {
  id?: string;
  title: string;
  company: string;
  location?: string;
  description?: string;
  highlights?: { title: string; items: string[] }[];
}

interface DiffChange {
  id: string;
  section: string;
  original: string;
  jobReq: string;
  proposed: string;
  status: "rewritten" | "kept" | "confirm";
  gapType?: null | "keyword" | "evidence" | "true_gap";
  gapNote?: string;
}

interface TailoringResult {
  matchScore: number;
  seniorityMatch: string;
  changes: DiffChange[];
  skillGaps: { keyword: string[]; evidence: string[]; trueGap: string[] };
  senioritySignals: string[];
  atsChecks?: ATSCheck[];
}

interface ATSCheck {
  ok: boolean;
  category: string;
  label: string;
  detail: string;
}

// ── Shared Resume Storage ─────────────────────────────────────────────────────

let tableReady = false;
let parseCacheTableReady = false;
async function ensureParseCacheTable() {
  if (parseCacheTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cached_resume_parses (
      file_hash TEXT PRIMARY KEY,
      result    JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  parseCacheTableReady = true;
}

let tailorCacheTableReady = false;
async function ensureTailorCacheTable() {
  if (tailorCacheTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cached_tailoring_results (
      cache_key  TEXT PRIMARY KEY,
      result     JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
  tailorCacheTableReady = true;
}

async function ensureShareTable() {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shared_resumes (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      resume JSONB NOT NULL,
      job_title TEXT NOT NULL,
      job_company TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
  await pool.query(`ALTER TABLE shared_resumes ADD COLUMN IF NOT EXISTS user_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS shared_resumes_user_id_idx ON shared_resumes (user_id)`);
  tableReady = true;
}

// POST /api/resume/share
// Body: { resume: ResumeData, jobTitle: string, jobCompany: string }
router.post("/share", async (req, res) => {
  const { resume, jobTitle, jobCompany } = req.body as {
    resume: ResumeRecord;
    jobTitle: string;
    jobCompany: string;
  };

  if (!resume || !jobTitle || !jobCompany) {
    return res.status(400).json({ error: "resume, jobTitle, and jobCompany are required" });
  }

  try {
    await ensureShareTable();
    const user = await getSupabaseUser(req);

    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO shared_resumes (id, user_id, resume, job_title, job_company, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, user?.id ?? null, JSON.stringify(sanitizeResumeRecord(resume)), jobTitle, jobCompany, expiresAt]
    );

    return res.json({ id });
  } catch (err) {
    logger.error({ err }, "Share resume error");
    return res.status(500).json({ error: "Failed to create shareable link" });
  }
});

// GET /api/resume/r/:id
router.get("/r/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await ensureShareTable();

    const result = await pool.query(
      `SELECT resume, job_title, job_company, expires_at FROM shared_resumes WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Resume not found or link has expired" });
    }

    const row = result.rows[0];
    if (new Date(row.expires_at) < new Date()) {
      return res.status(410).json({ error: "This share link has expired (links are valid for 7 days)" });
    }

    return res.json({
      resume: sanitizeResumeRecord(row.resume),
      jobTitle: row.job_title,
      jobCompany: row.job_company,
    });
  } catch (err) {
    logger.error({ err }, "Get shared resume error");
    return res.status(500).json({ error: "Failed to load shared resume" });
  }
});

export default router;
