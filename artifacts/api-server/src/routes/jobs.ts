// @ts-nocheck
import { Router } from "express";
import crypto from "crypto";
import { logger } from "../lib/logger.js";
import { pool } from "@workspace/db";
import OpenAI from "openai";

// SSRF guard — blocks requests to private/loopback IP ranges and non-http(s) schemes
function isSafePublicUrl(rawUrl: string): boolean {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return false; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "0.0.0.0") return false;
  // Block IPv6 loopback / link-local
  if (host === "::1" || host.startsWith("fe80:")) return false;
  // Block RFC-1918 and link-local for IPv4
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (a === 10) return false;
    if (a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  return true;
}

const DEPLOYMENT = process.env.DIGITALOCEAN_MODEL;
const openai = new OpenAI({
  apiKey: process.env.DIGITALOCEAN_TOKEN ?? "missing-api-key",
  baseURL: "https://inference.do-ai.run/v1",
});

const router = Router();

const SERPAPI_KEY = process.env.SERPAPI_KEY ?? process.env.SERPAPI_API_KEY;

interface SerpJob {
  title: string;
  company_name: string;
  location: string;
  via: string;
  description: string;
  job_highlights?: { title: string; items: string[] }[];
  detected_extensions?: {
    posted_at?: string;
    salary?: string;
    work_from_home?: boolean;
    schedule_type?: string;
  };
  job_id?: string;
  apply_options?: { link: string }[];
  thumbnail?: string;
}

// SerpAPI Google Jobs returns up to 10 results per page.
// Google Jobs pagination uses `next_page_token`; `start` is retained only as
// client bookkeeping for the UI.
const SERPAPI_PAGE_SIZE = 10;
const SERPAPI_PAGES_PER_BATCH = 10;
const SERPAPI_MAX_PAGES_PER_BATCH = 25;

// Valid date-posted chips supported by SerpAPI google_jobs engine
const DATE_CHIPS: Record<string, string> = {
  today: "date_posted:today",
  "3days": "date_posted:3days",
  week: "date_posted:week",
  month: "date_posted:month",
};

type SerpResponse = {
  jobs_results?: SerpJob[];
  error?: string;
  serpapi_pagination?: { next?: string; next_page_token?: string };
};

const SERPAPI_NO_RESULTS_RE = /hasn't returned any results|no results/i;

// ── Job search cache ──────────────────────────────────────────────────────────
// Results are cached per (title, city, dateFilter) so any two users searching
// the same title+city combination share a single SerpAPI call.

type MappedJob = ReturnType<typeof mapJob>;

let cacheTableReady = false;
async function ensureJobCacheTable() {
  if (cacheTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cached_job_searches (
      cache_key     TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      location      TEXT NOT NULL,
      date_filter   TEXT NOT NULL DEFAULT '',
      jobs          JSONB NOT NULL DEFAULT '[]',
      has_more      BOOLEAN NOT NULL DEFAULT false,
      next_cursor   TEXT,
      hit_count     INTEGER NOT NULL DEFAULT 1,
      fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at    TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cached_job_searches_expires
      ON cached_job_searches(expires_at);
  `);
  cacheTableReady = true;
}

function jobCacheKey(title: string, city: string, dateFilter: string): string {
  const input = `${title.trim().toLowerCase()}::${city.trim().toLowerCase()}::${dateFilter}`;
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 40);
}

function cacheTtlSeconds(dateFilter: string): number {
  switch (dateFilter) {
    case "today":  return 30 * 60;      // 30 min — fresh listings matter
    case "3days":  return 60 * 60;      // 1 h
    case "week":   return 2 * 60 * 60;  // 2 h
    case "month":  return 8 * 60 * 60;  // 8 h
    default:       return 4 * 60 * 60;  // 4 h for unfiltered searches
  }
}

async function getJobCache(
  title: string,
  city: string,
  dateFilter: string,
): Promise<MappedJob[] | null> {
  try {
    await ensureJobCacheTable();
    const key = jobCacheKey(title, city, dateFilter);
    const { rows } = await pool.query(
      `UPDATE cached_job_searches
          SET hit_count = hit_count + 1
        WHERE cache_key = $1 AND expires_at > NOW()
       RETURNING jobs`,
      [key],
    );
    if (!rows.length) return null;
    return rows[0].jobs as MappedJob[];
  } catch {
    return null; // cache miss on DB error — fall through to live fetch
  }
}

async function setJobCache(
  title: string,
  city: string,
  dateFilter: string,
  jobs: MappedJob[],
): Promise<void> {
  try {
    await ensureJobCacheTable();
    const key = jobCacheKey(title, city, dateFilter);
    const ttl = cacheTtlSeconds(dateFilter);
    await pool.query(
      `INSERT INTO cached_job_searches
         (cache_key, title, location, date_filter, jobs, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + ($6 * INTERVAL '1 second'))
       ON CONFLICT (cache_key) DO UPDATE
         SET jobs       = EXCLUDED.jobs,
             fetched_at = NOW(),
             expires_at = NOW() + ($6 * INTERVAL '1 second'),
             hit_count  = cached_job_searches.hit_count + 1`,
      [key, title, city, dateFilter, JSON.stringify(jobs), ttl],
    );
  } catch (err) {
    logger.warn({ err }, "Job cache write failed — non-fatal");
  }
}

function normalizeJobText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function jobDedupKey(j: SerpJob) {
  return [
    "job",
    normalizeJobText(j.title),
    normalizeJobText(j.company_name),
    normalizeJobText(j.location),
    normalizeJobText(j.via),
  ].join(":");
}

function encodeCursor(tokens: Record<string, string>) {
  const json = JSON.stringify(tokens);
  return Buffer.from(json, "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): Record<string, string> {
  if (!cursor) return {};
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function mapJob(j: SerpJob, fallbackId: string) {
  return {
    id: j.job_id ?? fallbackId,
    title: j.title,
    company: j.company_name,
    location: j.location,
    via: j.via,
    description: j.description?.slice(0, 800) ?? "",
    highlights: j.job_highlights ?? [],
    postedAt: j.detected_extensions?.posted_at ?? "Recently",
    salary: j.detected_extensions?.salary ?? null,
    remote:
      j.detected_extensions?.work_from_home ??
      j.location?.toLowerCase().includes("remote") ??
      false,
    scheduleType: j.detected_extensions?.schedule_type ?? "Full-time",
    applyLink: j.apply_options?.[0]?.link ?? null,
  };
}

// GET /api/jobs/search?titles=Staff+Engineer&location=Remote+US,New+York+NY&start=0&dateFilter=week
// `location` accepts a pipe-separated list of locations for multi-location search
// (max 3 unique city locations searched in parallel to protect quota).
// Each title is searched individually and results are merged — Google Jobs does not
// support OR operators reliably, so per-title parallel calls yield far better results.
router.get("/search", async (req, res) => {
  if (!SERPAPI_KEY) {
    return res.status(500).json({ error: "SERPAPI_KEY not configured" });
  }

  const titlesParam = (req.query.titles as string) || "";
  const locationParam = (req.query.location as string) || "United States";
  const start = Math.max(0, Number(req.query.start) || 0);
  const cursor = (req.query.cursor as string) || "";
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 10), 30);
  // Cap pages at 3 per title to stay within SerpAPI quota
  const pageBatchSize = Math.min(
    Math.max(1, Number(req.query.pages) || 3),
    3
  );
  const dateFilter = (req.query.dateFilter as string) || "";

  const titles = titlesParam
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5); // max 5 titles

  if (titles.length === 0) {
    return res.status(400).json({ error: "At least one job title required" });
  }

  // Parse pipe-separated locations (pipe is used to avoid breaking "City, State" values)
  const locationTokens = locationParam
    .split("|")
    .map((l) => l.trim())
    .filter(Boolean);

  // Detect if any selected location is remote/hybrid
  const hasRemote = locationTokens.some((l) => /^remote|^hybrid/i.test(l));

  // Non-remote city locations (strip parenthetical notes for SerpAPI)
  const cityTokens = locationTokens
    .filter((l) => !/^remote|^hybrid/i.test(l))
    .map((l) => l.replace(/\(.*?\)/g, "").trim())
    .filter(Boolean)
    .slice(0, 3); // max 3 city searches

  // If only remote options were selected, use "United States" as geographic base
  const searchCities = cityTokens.length > 0 ? cityTokens : ["United States"];

  const chipsValue = DATE_CHIPS[dateFilter] ?? "";

  const buildParams = (query: string, city: string, nextPageToken?: string) =>
    new URLSearchParams({
      engine: "google_jobs",
      q: query,
      location: city,
      hl: "en",
      api_key: SERPAPI_KEY!,
      num: String(Math.min(limit, SERPAPI_PAGE_SIZE)),
      ...(nextPageToken ? { next_page_token: nextPageToken } : {}),
      ...(hasRemote ? { ltype: "1" } : {}),
      ...(chipsValue ? { chips: chipsValue } : {}),
    });

  try {
    const cursorTokens = decodeCursor(cursor);

    const fetchPage = async (query: string, city: string, nextPageToken?: string): Promise<SerpResponse> => {
      const r = await fetch(`https://serpapi.com/search?${buildParams(query, city, nextPageToken)}`);
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        if (r.status === 429) {
          logger.warn({ city }, "SerpAPI rate limit hit");
          throw Object.assign(new Error("SerpAPI rate limit"), { status: 429, retryAfter: r.headers.get("retry-after") ?? "60" });
        }
        if (r.status === 401 || r.status === 403) {
          logger.error({ city, status: r.status }, "SerpAPI auth/quota error");
          throw Object.assign(new Error("SerpAPI quota exceeded"), { status: r.status });
        }
        logger.warn({ city, status: r.status, text }, "SerpAPI page error");
        return { jobs_results: [], serpapi_pagination: undefined, error: undefined };
      }
      return r.json() as Promise<SerpResponse>;
    };

    const indeedFromage = chipsValue === "date_posted:today" ? "1"
      : chipsValue === "date_posted:3days" ? "3"
      : chipsValue === "date_posted:week" ? "7"
      : chipsValue === "date_posted:month" ? "30"
      : "";

    // Search each title individually per city — Google Jobs does not reliably support
    // OR operators, so per-title calls yield significantly more results.
    // For fresh searches (no cursor) we check the shared job cache first; cache hits
    // skip the SerpAPI call entirely, saving credits and returning instantly.
    const searchCombinations: { title: string; city: string; cursorKey: string }[] = [];
    for (const title of titles) {
      for (const city of searchCities) {
        searchCombinations.push({ title, city, cursorKey: `${title}::${city}` });
      }
    }

    const isFreshSearch = !cursor; // only use cache on first-page searches

    const [titleCityResults, indeedJobs] = await Promise.all([
      // Google Jobs — cache-first, then SerpAPI per (title × city)
      Promise.all(
        searchCombinations.map(async ({ title, city, cursorKey }, comboIdx) => {
          // ── Cache check ──────────────────────────────────────────────────────
          if (isFreshSearch) {
            const cached = await getJobCache(title, city, dateFilter);
            if (cached) {
              logger.debug({ title, city, count: cached.length }, "Job search cache hit");
              return { cursorKey, mappedJobs: cached, nextPageToken: undefined, fromCache: true };
            }
          }

          // ── Live SerpAPI fetch ───────────────────────────────────────────────
          const responses: SerpResponse[] = [];
          let nextPageToken = cursorTokens[cursorKey];
          for (let page = 0; page < pageBatchSize; page++) {
            const data = await fetchPage(title, city, nextPageToken);
            responses.push(data);
            if (data.error && SERPAPI_NO_RESULTS_RE.test(data.error)) {
              logger.debug({ title, city }, "SerpAPI: no results for this title/city");
              break;
            }
            const nextToken = data.serpapi_pagination?.next_page_token;
            if (!nextToken) { nextPageToken = undefined; break; }
            nextPageToken = nextToken;
          }

          // Map SerpAPI results → standard job shape
          const mappedJobs: MappedJob[] = [];
          const localSeen = new Set<string>();
          for (let ri = 0; ri < responses.length; ri++) {
            for (let ji = 0; ji < (responses[ri].jobs_results ?? []).length; ji++) {
              const j = responses[ri].jobs_results![ji];
              const key = jobDedupKey(j);
              if (localSeen.has(key)) continue;
              localSeen.add(key);
              mappedJobs.push(mapJob(j, `job-${comboIdx}-${ri}-${ji}-${start}`));
            }
          }

          // Write to cache (fire-and-forget) for fresh searches with results
          if (isFreshSearch && mappedJobs.length > 0) {
            void setJobCache(title, city, dateFilter, mappedJobs);
          }

          // Check for fatal errors (not "no results")
          const hasFatal = responses.every(d => d.error && !SERPAPI_NO_RESULTS_RE.test(d.error ?? ""));
          if (hasFatal) {
            const err = responses[0]?.error;
            logger.error({ title, city, err }, "SerpAPI fatal error");
          }

          return { cursorKey, mappedJobs, nextPageToken, fromCache: false };
        })
      ),
      // Indeed — one page per (title × city), best-effort supplement (skip for cached combos)
      Promise.all(
        searchCombinations.slice(0, 3).map(async ({ title, city }, ci) => {
          if (isFreshSearch) {
            const cached = await getJobCache(`indeed::${title}`, city, dateFilter);
            if (cached) return cached;
          }
          try {
            const p = new URLSearchParams({
              engine: "indeed_jobs",
              q: hasRemote ? `${title} remote` : title,
              l: city === "United States" ? "" : city,
              api_key: SERPAPI_KEY!,
              ...(indeedFromage ? { fromage: indeedFromage } : {}),
            });
            const r = await fetch(`https://serpapi.com/search?${p}`);
            if (!r.ok) return [];
            const d = await r.json() as { jobs_results?: any[] };
            const indeedMapped = (d.jobs_results ?? []).map((j: any, idx: number) => ({
              id: j.job_id ?? j.id ?? `indeed-${ci}-${start}-${idx}`,
              title: j.title ?? "",
              company: j.company_name ?? "",
              location: j.location ?? "",
              via: "Indeed",
              description: (j.description ?? "").slice(0, 800),
              highlights: [],
              postedAt: j.date ?? "Recently",
              salary: j.salary ?? null,
              remote: /remote/i.test(j.location ?? ""),
              scheduleType: j.job_type ?? "Full-time",
              applyLink: j.link ?? null,
            }));
            if (isFreshSearch && indeedMapped.length > 0) {
              void setJobCache(`indeed::${title}`, city, dateFilter, indeedMapped);
            }
            return indeedMapped;
          } catch {
            return [];
          }
        })
      ).then((rs) => rs.flat()),
    ]);

    // Merge all per-(title × city) results with global dedup
    const seenIds = new Set<string>();
    const seenKeys = new Set<string>();
    const jobs: MappedJob[] = [];
    for (const { mappedJobs } of titleCityResults) {
      for (const j of mappedJobs) {
        const key = ["job", normalizeJobText(j.title), normalizeJobText(j.company), normalizeJobText(j.location), normalizeJobText(j.via)].join(":");
        if ((j.id && seenIds.has(j.id)) || seenKeys.has(key)) continue;
        if (j.id) seenIds.add(j.id);
        seenKeys.add(key);
        jobs.push(j);
      }
    }

    // Check if every combination had a fatal SerpAPI error (not just empty results)
    const allFatal = titleCityResults.every(r => !r.fromCache && r.mappedJobs.length === 0);
    if (allFatal && jobs.length === 0) {
      logger.error({ titles, searchCities }, "All SerpAPI title/city combinations returned fatal errors or zero results");
    }

    // Append Indeed jobs not already in Google Jobs results
    for (const ij of indeedJobs) {
      const key = ["job", normalizeJobText(ij.title), normalizeJobText(ij.company), normalizeJobText(ij.location), normalizeJobText(ij.via)].join(":");
      if (!seenIds.has(ij.id) && !seenKeys.has(key)) {
        if (ij.id) seenIds.add(ij.id);
        seenKeys.add(key);
        jobs.push(ij);
      }
    }

    const cacheHits = titleCityResults.filter(r => r.fromCache).length;
    logger.info({ titles, searchCities, totalJobs: jobs.length, cacheHits, pageBatchSize }, "Job search complete");

    const nextTokens = Object.fromEntries(
      titleCityResults
        .filter((r) => r.nextPageToken)
        .map((r) => [r.cursorKey, r.nextPageToken!])
    );
    const hasMore = Object.keys(nextTokens).length > 0;
    const pagesFetched = Math.max(0, ...titleCityResults.map((r) => r.mappedJobs.length > 0 ? 1 : 0));
    const nextStart = start + pagesFetched * SERPAPI_PAGE_SIZE;
    const nextCursor = hasMore ? encodeCursor(nextTokens) : null;

    return res.json({
      jobs,
      query: titles.join(" | "),
      locations: searchCities,
      count: jobs.length,
      hasMore,
      start,
      nextStart,
      nextCursor,
      pagesFetched,
      pageSize: SERPAPI_PAGE_SIZE,
    });
  } catch (err: any) {
    if (err?.status === 429) {
      logger.warn({ retryAfter: err.retryAfter }, "SerpAPI rate limit — returning 429 to client");
      res.setHeader("Retry-After", err.retryAfter ?? "60");
      return res.status(429).json({
        error: "Job search is temporarily rate-limited. Please wait a moment and try again.",
        code: "SERPAPI_RATE_LIMITED",
        retryAfter: Number(err.retryAfter ?? 60),
      });
    }
    if (err?.status === 401 || err?.status === 403) {
      logger.error({ status: err.status }, "SerpAPI quota exhausted");
      return res.status(503).json({
        error: "Job search is temporarily unavailable. Please try again later.",
        code: "SERPAPI_QUOTA_EXCEEDED",
      });
    }
    logger.error({ err }, "Job search error");
    return res.status(500).json({ error: "Internal error during job search" });
  }
});

// GET /api/jobs/autocomplete?q=<query>&type=role|location
// Returns SerpAPI Google Autocomplete suggestions for job roles or locations.
const LOCATION_NOISE_RE = /\b(weather|news|times|restaurant|hotel|map|directions|schedule|score|wiki|population|zip|area code|airport|dmv|nfl|nba|mlb|traffic|crime|covid|economy)\b/i;
const JOB_SUFFIX_RE = /\s+(jobs?|openings?|careers?|salary|listings?|positions?|hiring|near me|description|resume|interview|requirements?).*$/i;

router.get("/autocomplete", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const type = String(req.query.type ?? "role"); // "role" | "location"

  if (!q || q.length < 2) return res.json({ suggestions: [] });
  if (!SERPAPI_KEY) return res.json({ suggestions: [] });

  try {
    // For locations, append "jobs" as context so Google returns job-location style completions
    const searchQuery = type === "location" ? `jobs in ${q}` : q;
    const params = new URLSearchParams({
      engine: "google_autocomplete",
      q: searchQuery,
      gl: "us",
      hl: "en",
      api_key: SERPAPI_KEY,
    });

    const r = await fetch(`https://serpapi.com/search?${params}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return res.json({ suggestions: [] });

    const data = (await r.json()) as { suggestions?: { value: string; type?: string }[] };
    const raw = data.suggestions ?? [];

    let suggestions: string[];
    if (type === "location") {
      suggestions = raw
        .map(s => s.value
          // Strip the "jobs in " prefix we added, and any trailing job-noise
          .replace(/^jobs\s+in\s+/i, "")
          .replace(JOB_SUFFIX_RE, "")
          .trim()
        )
        .filter(s =>
          s.length > 1 &&
          s.length < 60 &&
          !LOCATION_NOISE_RE.test(s) &&
          // Must start with the user's query (ensures relevance)
          s.toLowerCase().startsWith(q.toLowerCase().slice(0, Math.max(2, q.length - 2)))
        )
        .filter((s, i, arr) => arr.indexOf(s) === i)
        .slice(0, 6);
    } else {
      suggestions = raw
        .map(s => s.value.replace(JOB_SUFFIX_RE, "").trim())
        .filter(s => s.length > 2 && s.length < 80 && !LOCATION_NOISE_RE.test(s))
        .filter((s, i, arr) => arr.indexOf(s) === i)
        .slice(0, 8);
    }

    return res.json({ suggestions });
  } catch (err) {
    logger.error({ err }, "Autocomplete error");
    return res.json({ suggestions: [] });
  }
});

// GET /api/jobs/scrape?url=<job_url>
// Scrapes a job posting page for full description
router.get("/scrape", async (req, res) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).json({ error: "url param required" });
  if (!isSafePublicUrl(url)) return res.status(400).json({ error: "Invalid or disallowed URL" });

  try {
    // Use SerpAPI job details if we have a job_id
    const jobId = req.query.job_id as string;
    if (jobId && SERPAPI_KEY) {
      const params = new URLSearchParams({
        engine: "google_jobs_listing",
        q: jobId,
        api_key: SERPAPI_KEY,
      });
      const r = await fetch(`https://serpapi.com/search?${params}`);
      if (r.ok) {
        const d = (await r.json()) as { apply_options?: { title: string; link: string }[]; description?: string };
        return res.json({
          description: d.description ?? "",
          applyLinks: d.apply_options ?? [],
        });
      }
    }

    // Fallback: direct fetch + basic text extraction
    const pageResp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ResumeX100/1.0; +https://resumex100.com)",
      },
      signal: AbortSignal.timeout(8000),
    });

    const html = await pageResp.text();
    // Strip tags, collapse whitespace — lightweight extraction without cheerio
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .slice(0, 4000);

    return res.json({ description: text, applyLinks: [] });
  } catch (err) {
    logger.error({ err }, "Scrape error");
    return res.status(500).json({ error: "Could not fetch job page" });
  }
});

// ── URL slug fallback for JS-rendered job sites ───────────────────────────────
// Many enterprise career sites (Deloitte, Workday, Taleo, etc.) are SPAs that
// return empty HTML when fetched server-side. We extract title/company/location
// from the URL path as a reliable fallback.

const SLUG_MINOR_WORDS = new Set(["and", "or", "the", "of", "in", "at", "for", "to", "a", "an", "with", "by", "on", "as"]);
const SLUG_UPPER_WORDS = new Set(["ii", "iii", "iv", "vi", "vii", "ai", "ml", "ui", "ux", "api", "sql", "gcp", "aws", "crm", "erp", "hr", "it", "qa", "sr", "jr", "vp", "svp", "evp"]);

function toTitleCaseSlug(s: string): string {
  return s
    .split(/\s+/)
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (SLUG_UPPER_WORDS.has(lower)) return w.toUpperCase();
      if (i > 0 && SLUG_MINOR_WORDS.has(lower)) return lower;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

// Well-known company domains → display name
const DOMAIN_COMPANY: Record<string, string> = {
  "deloitte.com": "Deloitte",
  "amazon.jobs": "Amazon",
  "amazon.com": "Amazon",
  "microsoft.com": "Microsoft",
  "google.com": "Google",
  "apple.com": "Apple",
  "meta.com": "Meta",
  "netflix.com": "Netflix",
  "salesforce.com": "Salesforce",
  "ibm.com": "IBM",
  "oracle.com": "Oracle",
  "accenture.com": "Accenture",
  "mckinsey.com": "McKinsey",
  "bain.com": "Bain & Company",
  "bcg.com": "BCG",
  "pwc.com": "PwC",
  "kpmg.com": "KPMG",
  "ey.com": "EY",
};

function extractFromUrlSlug(urlStr: string): { title: string; company: string; location: string } {
  let hostname = "";
  let pathname = "";
  try {
    const u = new URL(urlStr);
    hostname = u.hostname.replace(/^www\./, "").toLowerCase();
    pathname = u.pathname;
  } catch {
    return { title: "", company: "", location: "" };
  }

  // Resolve company from known domains first
  let company = "";
  for (const [domain, name] of Object.entries(DOMAIN_COMPANY)) {
    if (hostname.includes(domain)) { company = name; break; }
  }

  // Greenhouse: boards.greenhouse.io/COMPANY/jobs/ID
  if (!company && hostname.includes("greenhouse.io")) {
    const parts = pathname.split("/").filter(Boolean);
    company = toTitleCaseSlug(parts[0]?.replace(/-/g, " ") ?? "");
  }
  // Lever: COMPANY.lever.co
  if (!company && hostname.includes("lever.co")) {
    company = toTitleCaseSlug(hostname.split(".")[0] ?? "");
  }
  // Ashby: jobs.ashbyhq.com/COMPANY
  if (!company && hostname.includes("ashbyhq.com")) {
    const parts = pathname.split("/").filter(Boolean);
    company = toTitleCaseSlug(parts[0]?.replace(/-/g, " ") ?? "");
  }
  // Generic: prefer second-level domain (e.g. "jobsus.deloitte.com" already matched above;
  // for "careers.stripe.com" → "stripe")
  if (!company) {
    const parts = hostname.split(".");
    const idx = parts.length >= 3 ? parts.length - 2 : 0;
    company = toTitleCaseSlug(parts[idx] ?? "");
  }

  // Split path into clean segments (remove UUIDs, pure-numeric IDs, and noise words)
  const NOISE_SLUGS = new Set(["job", "jobs", "apply", "careers", "career", "posting", "details", "view", "position", "opening", "requisition", "req"]);
  const UUID_RE = /^[a-f0-9]{8,}$/i;
  const segments = pathname
    .split("/")
    .map(s => s.trim().toLowerCase())
    .filter(s => s && !UUID_RE.test(s) && !/^\d+$/.test(s) && !NOISE_SLUGS.has(s));

  // Detect US location segments like "chicago-il", "new-york-ny"
  const US_LOCATION_RE = /^[a-z]+(?:-[a-z]+)*-[a-z]{2}$/;
  const locationSlug = segments.find(s => US_LOCATION_RE.test(s) && s.split("-").length >= 2);
  let location = "";
  if (locationSlug) {
    const parts = locationSlug.split("-");
    const state = parts.pop()!.toUpperCase();
    const city = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
    location = `${city}, ${state}`;
  }

  // Title: longest remaining segment (most likely to be the job title slug)
  const titleSlug = segments
    .filter(s => s !== locationSlug && s.length > 4)
    .sort((a, b) => b.length - a.length)[0] ?? "";
  const title = titleSlug ? toTitleCaseSlug(titleSlug.replace(/-/g, " ")) : "";

  return { title, company, location };
}

// POST /api/jobs/from-url
// Body: { url: string }
// Fetches a public job posting, strips HTML, uses LLM to extract structured job data.
// Falls back to URL slug parsing for JS-rendered SPA career sites.
router.post("/from-url", async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url || !isSafePublicUrl(url)) {
    return res.status(400).json({ error: "A valid public URL starting with http:// or https:// is required" });
  }

  const hostname = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } })();
  const jobId = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const slugFallback = extractFromUrlSlug(url);

  let pageText = "";
  let pageTitle = "";

  try {
    const pageResp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (pageResp.ok) {
      const html = await pageResp.text();
      pageTitle = (/<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1] ?? "").trim();
      pageText = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim()
        .slice(0, 5000);
    }
  } catch {
    // Network error — fall through to slug-only path
  }

  // If page text is too thin (SPA shell / login wall / network error), skip AI and use slug
  const pageHasContent = pageText.length > 300;

  let extracted: { title?: string; company?: string; location?: string; description?: string } = {};

  if (pageHasContent) {
    try {
      const completion = await openai.chat.completions.create({
        model: DEPLOYMENT,
        max_completion_tokens: 900,
        messages: [
          {
            role: "system",
            content: `You are a job posting parser. Extract structured job information from page text.
Return ONLY valid JSON — no markdown fences, no extra commentary.`,
          },
          {
            role: "user",
            content: `Page title: "${pageTitle}"

Page text (up to 5000 chars):
${pageText}

Extract and return JSON with exactly these fields:
{
  "title": "<job title — e.g. 'Senior Software Engineer'>",
  "company": "<company name>",
  "location": "<location string, e.g. 'San Francisco, CA' or 'Remote'>",
  "description": "<the actual job description: responsibilities, qualifications, requirements — up to 3000 chars>"
}

Rules:
- Use empty string "" if a field cannot be determined confidently.
- The description must be the job's real content — not navigation text, cookie banners, or boilerplate.`,
          },
        ],
        response_format: { type: "json_object" },
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      extracted = JSON.parse(raw);
    } catch (aiErr) {
      logger.warn({ aiErr }, "from-url AI extraction failed — using slug fallback");
    }
  }

  // Merge: prefer AI-extracted fields, fall back to slug-parsed values
  const title = extracted.title || slugFallback.title;
  const company = extracted.company || slugFallback.company;
  const location = extracted.location || slugFallback.location;
  const description = extracted.description || pageText.slice(0, 800) || "";

  if (!title && !company) {
    return res.status(422).json({ error: "Could not extract job information from this page. Make sure it is a public job posting URL." });
  }

  return res.json({
    id: jobId,
    title: title || "Unknown Title",
    company: company || "Unknown Company",
    location: location || "Not specified",
    via: hostname,
    description,
    highlights: [],
    postedAt: "Recently",
    salary: null,
    remote: /remote/i.test(location ?? ""),
    scheduleType: "Full-time",
    applyLink: url,
    source: "custom" as const,
  });
});

export default router;
