// @ts-nocheck
import { pool } from "@workspace/db";

export const FREE_CREDITS = 10;

let ensured = false;

export class InsufficientCreditsError extends Error {
  code = "INSUFFICIENT_CREDITS";
  status = 402;

  constructor(balance: number) {
    super("No resume credits remaining. Buy credits to continue tailoring.");
    this.balance = balance;
  }
}

function isTransientDbError(err: unknown) {
  const code = err?.code ?? err?.cause?.code;
  const message = String(err?.message ?? err ?? "").toLowerCase();
  return [
    "40001", // serialization_failure
    "40P01", // deadlock_detected
    "53300", // too_many_connections
    "57P01", // admin_shutdown
    "57P03", // cannot_connect_now
    "08000",
    "08003",
    "08006",
  ].includes(code) || /timeout|terminated|connection|econnreset|lock/i.test(message);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureBillingTables() {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_credits (
      user_id text PRIMARY KEY,
      balance integer NOT NULL DEFAULT 0,
      free_granted boolean NOT NULL DEFAULT false,
      free_used integer NOT NULL DEFAULT 0,
      total_purchased integer NOT NULL DEFAULT 0,
      updated_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS credit_events (
      id serial PRIMARY KEY,
      user_id text NOT NULL,
      delta integer NOT NULL,
      reason text NOT NULL,
      source_id text,
      metadata jsonb,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS stripe_checkout_sessions (
      session_id text PRIMARY KEY,
      user_id text NOT NULL,
      price_id text NOT NULL,
      credits integer NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      fulfilled_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    );

    ALTER TABLE user_credits ADD COLUMN IF NOT EXISTS balance integer NOT NULL DEFAULT 0;
    ALTER TABLE user_credits ADD COLUMN IF NOT EXISTS free_granted boolean NOT NULL DEFAULT false;
    ALTER TABLE user_credits ADD COLUMN IF NOT EXISTS free_used integer NOT NULL DEFAULT 0;
    ALTER TABLE user_credits ADD COLUMN IF NOT EXISTS total_purchased integer NOT NULL DEFAULT 0;
    ALTER TABLE user_credits ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();

    ALTER TABLE credit_events ADD COLUMN IF NOT EXISTS user_id text;
    ALTER TABLE credit_events ADD COLUMN IF NOT EXISTS delta integer NOT NULL DEFAULT 0;
    ALTER TABLE credit_events ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT 'unknown';
    ALTER TABLE credit_events ADD COLUMN IF NOT EXISTS source_id text;
    ALTER TABLE credit_events ADD COLUMN IF NOT EXISTS metadata jsonb;
    ALTER TABLE credit_events ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now();

    ALTER TABLE stripe_checkout_sessions ADD COLUMN IF NOT EXISTS user_id text;
    ALTER TABLE stripe_checkout_sessions ADD COLUMN IF NOT EXISTS price_id text;
    ALTER TABLE stripe_checkout_sessions ADD COLUMN IF NOT EXISTS credits integer NOT NULL DEFAULT 0;
    ALTER TABLE stripe_checkout_sessions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
    ALTER TABLE stripe_checkout_sessions ADD COLUMN IF NOT EXISTS fulfilled_at timestamp;
    ALTER TABLE stripe_checkout_sessions ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now();
  `);
  ensured = true;
}

async function grantFreeCreditsIfNeeded(client, userId: string) {
  const inserted = await client.query(
    `INSERT INTO user_credits (user_id, balance, free_granted, free_used, total_purchased, updated_at)
     VALUES ($1, $2, true, 0, 0, now())
     ON CONFLICT (user_id) DO UPDATE
     SET balance = user_credits.balance + $2,
         free_granted = true,
         updated_at = now()
     WHERE user_credits.free_granted = false
     RETURNING user_id`,
    [userId, FREE_CREDITS],
  );
  if (inserted.rowCount > 0) {
    await client.query(
      `INSERT INTO credit_events (user_id, delta, reason, source_id, metadata)
       VALUES ($1, $2, 'free_grant', 'free_grant', $3::jsonb)`,
      [userId, FREE_CREDITS, JSON.stringify({ freeCredits: FREE_CREDITS })],
    );
  }

  const repaired = await client.query(
    `UPDATE user_credits
     SET balance = $2,
         free_granted = true,
         updated_at = now()
     WHERE user_id = $1
       AND free_granted = true
       AND free_used = 0
       AND total_purchased = 0
       AND balance < $2
     RETURNING user_id`,
    [userId, FREE_CREDITS],
  );
  if (repaired.rowCount > 0 && inserted.rowCount === 0) {
    await client.query(
      `INSERT INTO credit_events (user_id, delta, reason, source_id, metadata)
       VALUES ($1, $2, 'free_grant_repair', 'free_grant_repair', $3::jsonb)`,
      [userId, FREE_CREDITS, JSON.stringify({ freeCredits: FREE_CREDITS })],
    );
  }
}

export async function getCredits(userId: string) {
  await ensureBillingTables();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await grantFreeCreditsIfNeeded(client, userId);
    const result = await client.query(
      `SELECT user_id, balance, free_granted, free_used, total_purchased, updated_at
       FROM user_credits WHERE user_id = $1`,
      [userId],
    );
    await client.query("COMMIT");
    const row = result.rows[0];
    const balance = Number(row?.balance ?? 0);
    const freeUsed = Number(row?.free_used ?? 0);
    return {
      userId,
      balance,
      freeCredits: FREE_CREDITS,
      freeUsed,
      freeRemaining: Math.max(0, FREE_CREDITS - freeUsed),
      totalPurchased: Number(row?.total_purchased ?? 0),
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function consumeResumeCredit(userId: string, sourceId: string, metadata: object = {}) {
  await ensureBillingTables();
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await consumeResumeCreditOnce(userId, sourceId, metadata);
    } catch (err) {
      lastErr = err;
      if (err instanceof InsufficientCreditsError || err?.code === "INSUFFICIENT_CREDITS" || !isTransientDbError(err) || attempt === 2) {
        throw err;
      }
      await sleep(150 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function consumeResumeCreditOnce(userId: string, sourceId: string, metadata: object = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await grantFreeCreditsIfNeeded(client, userId);
    const consumed = await client.query(
      `WITH locked_credit AS (
         SELECT user_id, free_used
         FROM user_credits
         WHERE user_id = $1 AND balance > 0
         FOR UPDATE
       ),
       updated_credit AS (
         UPDATE user_credits AS u
         SET balance = u.balance - 1,
             free_used = u.free_used + CASE WHEN u.free_used < $2 THEN 1 ELSE 0 END,
             updated_at = now()
         FROM locked_credit AS locked
         WHERE u.user_id = locked.user_id
         RETURNING locked.free_used < $2 AS consumed_free
       )
       SELECT consumed_free FROM updated_credit`,
      [userId, FREE_CREDITS],
    );
    const row = consumed.rows[0];
    if (!row) {
      const balanceResult = await client.query(
        `SELECT balance FROM user_credits WHERE user_id = $1`,
        [userId],
      );
      const balance = Number(balanceResult.rows[0]?.balance ?? 0);
      await client.query("ROLLBACK");
      throw new InsufficientCreditsError(balance);
    }
    const consumedFree = row.consumed_free === true || row.consumed_free === "t";
    await client.query(
      `INSERT INTO credit_events (user_id, delta, reason, source_id, metadata)
       VALUES ($1, -1, 'resume_tailor', $2, $3::jsonb)`,
      [userId, sourceId, JSON.stringify({ ...metadata, consumedFree })],
    );
    await client.query("COMMIT");
    return { consumedFree };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function refundResumeCredit(userId: string, sourceId: string, consumedFree: boolean, metadata: object = {}) {
  await ensureBillingTables();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE user_credits
       SET balance = balance + 1,
           free_used = greatest(0, free_used - $2),
           updated_at = now()
       WHERE user_id = $1`,
      [userId, consumedFree ? 1 : 0],
    );
    await client.query(
      `INSERT INTO credit_events (user_id, delta, reason, source_id, metadata)
       VALUES ($1, 1, 'resume_tailor_refund', $2, $3::jsonb)`,
      [userId, sourceId, JSON.stringify({ ...metadata, consumedFree })],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function recordPendingCheckout(sessionId: string, userId: string, priceId: string, credits: number) {
  await ensureBillingTables();
  await pool.query(
    `INSERT INTO stripe_checkout_sessions (session_id, user_id, price_id, credits, status)
     VALUES ($1, $2, $3, $4, 'pending')
     ON CONFLICT (session_id) DO NOTHING`,
    [sessionId, userId, priceId, credits],
  );
}

export async function fulfillCheckout(sessionId: string, userId: string, priceId: string, credits: number) {
  await ensureBillingTables();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await grantFreeCreditsIfNeeded(client, userId);
    const existing = await client.query(
      `SELECT status FROM stripe_checkout_sessions WHERE session_id = $1 FOR UPDATE`,
      [sessionId],
    );
    if (existing.rows[0]?.status === "fulfilled") {
      await client.query("COMMIT");
      return { fulfilled: false };
    }
    await client.query(
      `INSERT INTO stripe_checkout_sessions (session_id, user_id, price_id, credits, status)
       VALUES ($1, $2, $3, $4, 'fulfilled')
       ON CONFLICT (session_id) DO UPDATE
       SET status = 'fulfilled', fulfilled_at = now()`,
      [sessionId, userId, priceId, credits],
    );
    await client.query(
      `UPDATE user_credits
       SET balance = balance + $2,
           total_purchased = total_purchased + $2,
           updated_at = now()
       WHERE user_id = $1`,
      [userId, credits],
    );
    await client.query(
      `INSERT INTO credit_events (user_id, delta, reason, source_id, metadata)
       VALUES ($1, $2, 'stripe_purchase', $3, $4::jsonb)`,
      [userId, credits, sessionId, JSON.stringify({ priceId, credits })],
    );
    await client.query("COMMIT");
    return { fulfilled: true };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
