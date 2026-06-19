// @ts-nocheck
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { getSupabaseUser } from "../lib/auth.js";
import { logger } from "../lib/logger.js";

const router = Router();

let ensured = false;

async function ensureProfileTables() {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_resume_profiles (
      user_id text PRIMARY KEY,
      resume jsonb NOT NULL,
      recommendations jsonb NOT NULL,
      file_name text,
      updated_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS user_generated_resumes (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      name text NOT NULL,
      resume jsonb NOT NULL,
      job jsonb NOT NULL,
      job_title text NOT NULL,
      job_company text NOT NULL,
      diff_changes jsonb,
      source_job_id text,
      saved_at timestamp NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS user_generated_resumes_user_saved_idx
      ON user_generated_resumes (user_id, saved_at DESC);
  `);
  ensured = true;
}

async function requireUser(req, res) {
  const user = await getSupabaseUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to save your profile data." });
    return null;
  }
  return user;
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

function normalizeResumeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
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

function isLocationOnlyBullet(value) {
  const text = normalizeResumeText(value)
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

function isUnsafeResumeNote(value) {
  const text = normalizeResumeText(value);
  return !!text && UNSAFE_RESUME_NOTE_PATTERNS.some((pattern) => pattern.test(text));
}

function safePrefixBeforeUnsafeNote(text) {
  const indexes = UNSAFE_RESUME_NOTE_PATTERNS
    .map((pattern) => text.search(pattern))
    .filter((index) => index > 0);
  if (indexes.length === 0) return "";
  return normalizeResumeText(text.slice(0, Math.min(...indexes)).replace(/[,;:.]\s*$/, ""));
}

function sanitizeResumeText(value) {
  const text = normalizeResumeText(value);
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

function sanitizeResumeSkillText(value) {
  return (value ?? "")
    .split(/\s*(?:,|;|•|\n)\s*/)
    .map(sanitizeResumeText)
    .map(normalizeResumeText)
    .filter(Boolean)
    .filter((part) => !isUnsafeResumeNote(part))
    .filter((part) => part.length <= 80 || !/[.!?]/.test(part));
}

function sanitizeResumeRecord(resume = {}) {
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

router.get("/vault", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    await ensureProfileTables();
    const result = await pool.query(
      `SELECT resume, recommendations, file_name, updated_at
       FROM user_resume_profiles
       WHERE user_id = $1`,
      [user.id],
    );
    if (!result.rows[0]) return res.json(null);
    const row = result.rows[0];
    return res.json({
      resume: sanitizeResumeRecord(row.resume),
      recommendations: row.recommendations,
      fileName: row.file_name,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    logger.error({ err, userId: user.id }, "Load user resume profile failed");
    return res.status(500).json({ error: "Could not load your saved profile." });
  }
});

router.put("/vault", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const { resume, recommendations, fileName = null } = req.body ?? {};
  if (!resume || !recommendations) {
    return res.status(400).json({ error: "resume and recommendations are required" });
  }

  try {
    await ensureProfileTables();
    await pool.query(
      `INSERT INTO user_resume_profiles (user_id, resume, recommendations, file_name, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, now())
       ON CONFLICT (user_id) DO UPDATE
      SET resume = EXCLUDED.resume,
           recommendations = EXCLUDED.recommendations,
           file_name = EXCLUDED.file_name,
           updated_at = now()`,
      [user.id, JSON.stringify(sanitizeResumeRecord(resume)), JSON.stringify(recommendations), fileName],
    );
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userId: user.id }, "Save user resume profile failed");
    return res.status(500).json({ error: "Could not save your profile." });
  }
});

router.delete("/vault", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    await ensureProfileTables();
    await pool.query(`DELETE FROM user_resume_profiles WHERE user_id = $1`, [user.id]);
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userId: user.id }, "Delete user resume profile failed");
    return res.status(500).json({ error: "Could not clear your profile." });
  }
});

router.get("/generated-resumes", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    await ensureProfileTables();
    const result = await pool.query(
      `SELECT id, name, resume, job, job_title, job_company, diff_changes, source_job_id, saved_at
       FROM user_generated_resumes
       WHERE user_id = $1
       ORDER BY saved_at DESC`,
      [user.id],
    );
    return res.json({
      resumes: result.rows.map(row => ({
        id: row.id,
        name: row.name,
        resume: sanitizeResumeRecord(row.resume),
        job: row.job,
        jobTitle: row.job_title,
        jobCompany: row.job_company,
        diffChanges: row.diff_changes ?? [],
        sourceJobId: row.source_job_id,
        savedAt: new Date(row.saved_at).getTime(),
      })),
    });
  } catch (err) {
    logger.error({ err, userId: user.id }, "Load generated resumes failed");
    return res.status(500).json({ error: "Could not load saved resumes." });
  }
});

router.post("/generated-resumes", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const {
    id = randomUUID(),
    name,
    resume,
    job,
    jobTitle = job?.title,
    jobCompany = job?.company,
    diffChanges = [],
    sourceJobId = job?.id ?? null,
    savedAt,
  } = req.body ?? {};

  if (!name || !resume || !jobTitle || !jobCompany) {
    return res.status(400).json({ error: "name, resume, jobTitle, and jobCompany are required" });
  }

  const savedDate = savedAt ? new Date(savedAt) : new Date();

  try {
    await ensureProfileTables();
    const result = await pool.query(
      `INSERT INTO user_generated_resumes
         (id, user_id, name, resume, job, job_title, job_company, diff_changes, source_job_id, saved_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8::jsonb, $9, $10)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           resume = EXCLUDED.resume,
           job = EXCLUDED.job,
           job_title = EXCLUDED.job_title,
           job_company = EXCLUDED.job_company,
           diff_changes = EXCLUDED.diff_changes,
           source_job_id = EXCLUDED.source_job_id,
           saved_at = EXCLUDED.saved_at
       WHERE user_generated_resumes.user_id = EXCLUDED.user_id
       RETURNING id`,
      [
        id,
        user.id,
        name,
        JSON.stringify(sanitizeResumeRecord(resume)),
        JSON.stringify(job ?? {}),
        jobTitle,
        jobCompany,
        JSON.stringify(diffChanges),
        sourceJobId,
        savedDate,
      ],
    );
    if (result.rowCount === 0) {
      return res.status(403).json({ error: "This saved resume does not belong to the signed-in user." });
    }
    return res.json({ ok: true, id });
  } catch (err) {
    logger.error({ err, userId: user.id }, "Save generated resume failed");
    return res.status(500).json({ error: "Could not save generated resume." });
  }
});

router.delete("/generated-resumes/:id", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    await ensureProfileTables();
    await pool.query(
      `DELETE FROM user_generated_resumes WHERE user_id = $1 AND id = $2`,
      [user.id, req.params.id],
    );
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userId: user.id, id: req.params.id }, "Delete generated resume failed");
    return res.status(500).json({ error: "Could not delete saved resume." });
  }
});

export default router;
