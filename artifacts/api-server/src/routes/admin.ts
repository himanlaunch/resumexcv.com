// @ts-nocheck
import { Router } from "express";
import { pool } from "@workspace/db";
import { getSupabaseUser } from "../lib/auth.js";
import { logger } from "../lib/logger.js";

const router = Router();

const ADMIN_EMAILS = [
  "info@3llms.com",
  "welcome@1teraton.com",
  ...(process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
];

async function requireAdmin(req, res) {
  const user = await getSupabaseUser(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required." });
    return null;
  }
  if (!ADMIN_EMAILS.includes((user.email ?? "").toLowerCase())) {
    res.status(403).json({ error: "Admin access required." });
    return null;
  }
  return user;
}

// GET /api/admin/users?search=<term>&limit=100&offset=0
// Returns all users with contact details, credit balance, and activity counts.
router.get("/users", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const search = ((req.query.search as string) ?? "").trim();
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 100), 500);
  const offset = Math.max(0, Number(req.query.offset) || 0);

  try {
    // Main query: $1=limit, $2=offset, $3=search (if present)
    const searchClause = search
      ? `AND (
           urp.resume->>'name' ILIKE $3
        OR urp.resume->>'email' ILIKE $3
        OR urp.resume->>'phone' ILIKE $3
       )`
      : "";

    // Count query: $1=search (if present)
    const countSearchClause = search
      ? `AND (
           urp.resume->>'name' ILIKE $1
        OR urp.resume->>'email' ILIKE $1
        OR urp.resume->>'phone' ILIKE $1
       )`
      : "";

    const params: any[] = [limit, offset];
    if (search) params.push(`%${search}%`);

    const result = await pool.query(
      `SELECT
         urp.user_id,
         urp.resume->>'name'     AS name,
         urp.resume->>'email'    AS email,
         urp.resume->>'phone'    AS phone,
         urp.resume->>'location' AS location,
         urp.resume->>'summary'  AS summary,
         urp.file_name,
         urp.updated_at,
         COALESCE(uc.balance, 0)          AS credits,
         COALESCE(uc.total_purchased, 0)  AS total_purchased,
         COALESCE(uc.free_used, 0)        AS free_used,
         (SELECT COUNT(*)::int FROM user_resume_versions urv WHERE urv.user_id = urp.user_id)    AS upload_count,
         (SELECT COUNT(*)::int FROM user_generated_resumes ugr WHERE ugr.user_id = urp.user_id) AS generated_count
       FROM user_resume_profiles urp
       LEFT JOIN user_credits uc ON uc.user_id = urp.user_id
       WHERE 1=1 ${searchClause}
       ORDER BY urp.updated_at DESC
       LIMIT $1 OFFSET $2`,
      params,
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM user_resume_profiles urp
       WHERE 1=1 ${countSearchClause}`,
      search ? [`%${search}%`] : [],
    );

    return res.json({
      users: result.rows,
      total: countResult.rows[0]?.total ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    logger.error({ err }, "Admin users query failed");
    return res.status(500).json({ error: "Could not fetch users." });
  }
});

// GET /api/admin/users/:userId — full detail for one user
router.get("/users/:userId", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { userId } = req.params;

  try {
    const [profile, versions, generated, credits] = await Promise.all([
      pool.query(`SELECT * FROM user_resume_profiles WHERE user_id = $1`, [userId]),
      pool.query(
        `SELECT id, file_name, uploaded_at,
                resume->>'name' AS name, resume->>'email' AS email,
                resume->>'phone' AS phone, resume->>'location' AS location,
                resume
         FROM user_resume_versions WHERE user_id = $1 ORDER BY uploaded_at DESC`,
        [userId],
      ),
      pool.query(
        `SELECT id, name, job_title, job_company, saved_at
         FROM user_generated_resumes WHERE user_id = $1 ORDER BY saved_at DESC`,
        [userId],
      ),
      pool.query(`SELECT * FROM user_credits WHERE user_id = $1`, [userId]),
    ]);

    return res.json({
      profile: profile.rows[0] ?? null,
      resumeVersions: versions.rows,
      generatedResumes: generated.rows,
      credits: credits.rows[0] ?? null,
    });
  } catch (err) {
    logger.error({ err, userId }, "Admin user detail query failed");
    return res.status(500).json({ error: "Could not fetch user detail." });
  }
});

// GET /api/admin/stats — platform-wide summary
router.get("/stats", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM user_resume_profiles)      AS total_users,
        (SELECT COUNT(*)::int FROM user_resume_versions)      AS total_uploads,
        (SELECT COUNT(*)::int FROM user_generated_resumes)    AS total_generated,
        (SELECT COUNT(*)::int FROM user_credits WHERE balance > 0) AS users_with_credits,
        (SELECT COALESCE(SUM(total_purchased), 0)::int FROM user_credits) AS total_credits_sold,
        (SELECT COUNT(*)::int FROM stripe_checkout_sessions WHERE status = 'fulfilled') AS total_purchases
    `);
    return res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, "Admin stats query failed");
    return res.status(500).json({ error: "Could not fetch stats." });
  }
});

// POST /api/admin/users/:userId/credits — grant credits to a user
router.post("/users/:userId/credits", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { userId } = req.params;
  const amount = Number(req.body?.amount);
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: "amount must be a positive integer" });
  }

  try {
    await pool.query(
      `INSERT INTO user_credits (user_id, balance, total_purchased, free_used)
       VALUES ($1, $2, $2, 0)
       ON CONFLICT (user_id) DO UPDATE
       SET balance = user_credits.balance + $2,
           total_purchased = user_credits.total_purchased + $2,
           updated_at = now()`,
      [userId, amount],
    );
    await pool.query(
      `INSERT INTO credit_events (user_id, delta, reason, source_id, metadata)
       VALUES ($1, $2, 'admin_grant', $3, $4::jsonb)`,
      [userId, amount, `admin:${admin.id}`, JSON.stringify({ grantedBy: admin.email, amount })],
    );
    const result = await pool.query(`SELECT balance FROM user_credits WHERE user_id = $1`, [userId]);
    return res.json({ success: true, balance: result.rows[0]?.balance ?? amount });
  } catch (err) {
    logger.error({ err, userId }, "Admin grant credits failed");
    return res.status(500).json({ error: "Could not grant credits." });
  }
});

export default router;
