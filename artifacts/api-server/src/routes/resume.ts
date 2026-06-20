// @ts-nocheck
import { Router } from "express";
import OpenAI from "openai";
import { logger } from "../lib/logger.js";
import multer from "multer";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";
import { pool } from "@workspace/db";
import { getSupabaseUser } from "../lib/auth.js";
import { consumeResumeCredit, InsufficientCreditsError, refundResumeCredit } from "../lib/credits.js";

const router = Router();

const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-5.5";

// Azure Cognitive Services OpenAI-compatible endpoint (/openai/v1/) uses the
// standard OpenAI client with the endpoint as baseURL + API key from Azure.
// AZURE_OPENAI_KEY is used directly (env var, not secret) to bypass session caching.
const openai = new OpenAI({
  apiKey:
    process.env.AZURE_OPENAI_KEY ??
    process.env.AZURE_OPENAI_API_KEY ??
    process.env.OPENAI_API_KEY ??
    "missing-api-key",
  baseURL: process.env.AZURE_OPENAI_ENDPOINT,
});

// ── Shared system prompt ──────────────────────────────────────────────────────
const SYSTEM_TAILORING = `You are an expert resume writer and ATS specialist.
Your job is to tailor a candidate's resume for a specific job posting.

STRICT RULES — you must follow these without exception:
1. NEVER fabricate experience, skills, companies, dates, or metrics the candidate has not provided.
2. Every change must be grounded in the candidate's actual resume content.
3. If a job requirement has NO match in the resume, flag it as a "true_gap" — do NOT add it silently.
4. Use strong action verbs and quantify impact where evidence already exists in the resume.
5. Optimize keyword density for ATS without keyword stuffing.
6. The "proposed" field must contain FINAL RESUME TEXT ONLY. Never include reasoning, caveats, instructions, validation notes, "do not", "unless confirmed", "if accurate", or other meta-commentary in proposed text.
7. Output ONLY valid JSON — no markdown fences, no commentary outside JSON.
8. WRITING STYLE — proposed text must read as human-written, not AI-generated:
   - Do NOT use em dashes (—). Use commas, semicolons, or start a new clause instead.
   - Avoid overused AI buzzwords: "leveraged", "spearheaded", "orchestrated", "championed", "utilized", "synergized", "facilitated", "streamlined" unless the original resume already uses them.
   - Prefer plain, direct language: "used" over "utilized", "led" over "spearheaded", "helped" over "facilitated".
   - Do NOT add parenthetical phrases like "(e.g., ...)" or "(resulting in ...)" unless they were in the original.`;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const MAX_RESUME_PARSE_CHARS = 24000;
const MAX_TAILORING_TOKENS = 12000;

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
  return normalizeResumeText(
    (value ?? "")
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
        return { ...change, proposed };
      })
      .filter((change) => change.proposed || change.status !== "rewritten"),
  };
}

function sanitizeResumeRecord(resume: ResumeRecord): ResumeRecord {
  return {
    contact: {
      name: sanitizeResumeText(resume.contact?.name),
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
    experience: (resume.experience ?? []).map((exp) => ({
      title: sanitizeResumeText(exp.title),
      company: sanitizeResumeText(exp.company),
      period: sanitizeResumeText(exp.period),
      bullets: (exp.bullets ?? []).map(sanitizeResumeText).filter((bullet) => !isLocationOnlyBullet(bullet)).filter(Boolean),
    })),
    education: (resume.education ?? []).map((edu) => ({
      degree: sanitizeResumeText(edu.degree),
      school: sanitizeResumeText(edu.school),
      year: sanitizeResumeText(edu.year),
    })),
    certifications: (resume.certifications ?? []).map(sanitizeResumeText).filter(Boolean),
  };
}

async function repairTailoringJson(malformedJson: string, parseError: unknown): Promise<TailoringResult> {
  const completion = await openai.chat.completions.create({
    model: DEPLOYMENT,
    max_completion_tokens: MAX_TAILORING_TOKENS,
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

  try {
    const completion = await openai.chat.completions.create({
      model: DEPLOYMENT,
      max_completion_tokens: 8192,
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
    "contact": { "name": "...", "email": "...", "location": "...", "linkedin": "...", "github": "..." },
    "summary": "...",
    "skills": ["..."],
    "experience": [{ "title": "...", "company": "...", "period": "...", "bullets": ["..."] }],
    "education": [{ "degree": "...", "school": "...", "year": "..." }],
    "certifications": ["..."]
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
- Preserve every work experience role that appears in the resume text, including older roles, internships, projects listed as experience, and contract roles.
- Preserve all meaningful bullet details, metrics, technologies, scope, domains, tools, and outcomes from each role.
- Do not truncate bullets or collapse multiple roles together.
- If the resume does not have an explicit summary, write a concise professional summary grounded only in the resume text.

RESUME TEXT:
${text.slice(0, MAX_RESUME_PARSE_CHARS)}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    return res.json(parsed);
  } catch (aiErr) {
    logger.error({ aiErr }, "AI resume parsing failed");
    return res.status(500).json({ error: "AI parsing failed. Please try again." });
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

    const stream = await openai.chat.completions.create({
      model: DEPLOYMENT,
      max_completion_tokens: MAX_TAILORING_TOKENS,
      messages: [
        { role: "system", content: SYSTEM_TAILORING },
        { role: "user", content: prompt },
      ],
      stream: true,
      response_format: { type: "json_object" },
    });

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
    const atsResult = await runATSCheck(resume, parsed.changes ?? []);
    parsed.atsChecks = atsResult;

    sendEvent({ type: "result", data: parsed });
    sendEvent({ type: "done" });
  } catch (err) {
    if (creditHold) {
      await refundResumeCredit(user.id, creditSourceId, creditHold.consumedFree, {
        jobId: job.id,
        jobTitle: job.title,
        jobCompany: job.company,
        reason: err instanceof Error ? err.message : String(err),
      }).catch(refundErr => logger.error({ refundErr, userId: user.id }, "Credit refund failed"));
    }
    logger.error({ err }, "Resume tailor error");
    const message = err instanceof SyntaxError
      ? "Resume generation returned incomplete data. Please retry this job."
      : err instanceof Error
        ? err.message
        : String(err);
    sendEvent({ type: "error", error: message });
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
    const checks = await runATSCheck(resume, changes ?? []);
    return res.json({ checks });
  } catch (err) {
    logger.error({ err }, "ATS check error");
    return res.status(500).json({ error: "ATS check failed" });
  }
});

// POST /api/resume/suggest-gap-experience
// Body: { resume: ResumeRecord, gapStart: string, gapEnd: string, durationMonths: number }
router.post("/suggest-gap-experience", async (req, res) => {
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
      messages: [
        {
          role: "system",
          content: `You are an expert cover letter writer. Write a concise, honest, 3-paragraph cover letter.
Do NOT fabricate any experience. Only use information from the provided resume.
Write in first person, professional tone. No fluff. No "I am writing to express my interest" openers.
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
  "matchScore": <number 0-100>,
  "seniorityMatch": <"perfect" | "stretch" | "overqualified">,
  "changes": [
    {
      "id": "<unique string>",
      "section": "<section name>",
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

RESUME:
Name: ${resume.contact?.name ?? ""}
Location: ${resume.contact?.location ?? ""}
Summary: ${resume.summary ?? ""}
Skills: ${resume.skills?.join(", ") ?? ""}
Experience:
${resume.experience?.map((e) => `- ${e.title} at ${e.company} (${e.period})\n  ${e.bullets?.join("\n  ") ?? ""}`).join("\n") ?? ""}
Education: ${resume.education?.map((e) => `${e.degree} from ${e.school} (${e.year})`).join("; ") ?? ""}
Certifications: ${resume.certifications?.join(", ") ?? ""}

JOB:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location ?? ""}
Description: ${job.description ?? ""}
${job.highlights?.length ? `Highlights:\n${job.highlights.map((h) => `${h.title}:\n${h.items?.join("\n")}`).join("\n")}` : ""}

Critical output rule: "proposed" is inserted into the user's resume if accepted. It must read exactly like resume content. Never put comments such as "do not add", "if accurate", "unless confirmed", "retain language", or any analysis into "proposed"; put gap explanations only in "gapNote".

Produce ONLY the JSON object. No markdown fences. No extra commentary.`;
}

async function runATSCheck(resume: ResumeRecord, changes: DiffChange[]): Promise<ATSCheck[]> {
  const completion = await openai.chat.completions.create({
    model: DEPLOYMENT,
    max_completion_tokens: 800,
    messages: [
      {
        role: "system",
        content: `You are an ATS (Applicant Tracking System) formatting expert.
Analyse the resume structure and return ONLY a JSON array of check objects.
Each check: { "ok": boolean, "category": string, "label": string, "detail": string }
Focus on REAL formatting issues — no fake ATS scores.`,
      },
      {
        role: "user",
        content: `Check this resume for ATS compliance:

Name: ${resume.contact?.name ?? ""}
Has email: ${!!resume.contact?.email}
Has location: ${!!resume.contact?.location}
Has LinkedIn: ${!!resume.contact?.linkedin}
Section headers present: Summary, Skills, Experience, Education, Certifications
Number of experience roles: ${resume.experience?.length ?? 0}
Uses bullet points: ${resume.experience?.some((e) => e.bullets?.length) ?? false}
Has certifications: ${!!resume.certifications?.length}
Changes applied: ${changes.length} tailoring changes

Return JSON array. Cover: single-column layout warning, contact info placement, standard headers, date formats, keyword presence, file format recommendation, bullet point usage, section order.`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const text = completion.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(text) as { checks?: ATSCheck[] } | ATSCheck[];
    return Array.isArray(parsed) ? parsed : parsed.checks ?? [];
  } catch {
    return [];
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ResumeRecord {
  contact?: { name?: string; email?: string; location?: string; linkedin?: string; github?: string };
  summary?: string;
  skills?: string[];
  experience?: { title: string; company: string; period: string; bullets?: string[] }[];
  education?: { degree: string; school: string; year: string }[];
  certifications?: string[];
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
