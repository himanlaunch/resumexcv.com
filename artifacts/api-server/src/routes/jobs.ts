// @ts-nocheck
import { Router } from "express";
import { logger } from "../lib/logger.js";
import OpenAI from "openai";

const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-5.5";
const openai = new OpenAI({
  apiKey:
    process.env.AZURE_OPENAI_KEY ??
    process.env.AZURE_OPENAI_API_KEY ??
    process.env.OPENAI_API_KEY ??
    "missing-api-key",
  baseURL: process.env.AZURE_OPENAI_ENDPOINT,
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
// `location` accepts a comma-separated list of locations for multi-location search
// (max 2 unique city locations searched in parallel to protect quota).
router.get("/search", async (req, res) => {
  if (!SERPAPI_KEY) {
    return res.status(500).json({ error: "SERPAPI_KEY not configured" });
  }

  const titlesParam = (req.query.titles as string) || "";
  const locationParam = (req.query.location as string) || "United States";
  const start = Math.max(0, Number(req.query.start) || 0);
  const cursor = (req.query.cursor as string) || "";
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 10), 30);
  const pageBatchSize = Math.min(
    Math.max(1, Number(req.query.pages) || SERPAPI_PAGES_PER_BATCH),
    SERPAPI_MAX_PAGES_PER_BATCH
  );
  const dateFilter = (req.query.dateFilter as string) || "";

  const titles = titlesParam
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 4);

  if (titles.length === 0) {
    return res.status(400).json({ error: "At least one job title required" });
  }

  // Parse comma-separated locations
  const locationTokens = locationParam
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);

  // Detect if any selected location is remote/hybrid
  const hasRemote = locationTokens.some((l) => /^remote|^hybrid/i.test(l));

  // Non-remote city locations (strip parenthetical notes for SerpAPI)
  const cityTokens = locationTokens
    .filter((l) => !/^remote|^hybrid/i.test(l))
    .map((l) => l.replace(/\(.*?\)/g, "").trim())
    .filter(Boolean)
    .slice(0, 2); // max 2 city searches to protect SerpAPI quota

  // If only remote options were selected, use "United States" as geographic base
  const searchCities = cityTokens.length > 0 ? cityTokens : ["United States"];

  const query = titles.join(" OR ");
  const chipsValue = DATE_CHIPS[dateFilter] ?? "";

  const buildParams = (city: string, nextPageToken?: string) =>
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

    const fetchPage = async (city: string, nextPageToken?: string): Promise<SerpResponse> => {
      const r = await fetch(`https://serpapi.com/search?${buildParams(city, nextPageToken)}`);
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

    const cityResults = await Promise.all(
      searchCities.map(async (city) => {
        const responses: SerpResponse[] = [];
        let nextPageToken = cursorTokens[city];

        for (let page = 0; page < pageBatchSize; page++) {
          const data = await fetchPage(city, nextPageToken);
          responses.push(data);

          const nextToken = data.serpapi_pagination?.next_page_token;
          if (!nextToken) {
            nextPageToken = undefined;
            break;
          }
          nextPageToken = nextToken;
        }

        return { city, responses, nextPageToken };
      })
    );
    const responses = cityResults.flatMap((r) => r.responses);

    // SerpAPI reports no Google Jobs matches as an `error`; treat that as
    // a successful empty search so the UI can show a normal zero-result state.
    const fatalResponses = responses.filter((d) => d.error && !SERPAPI_NO_RESULTS_RE.test(d.error));
    const firstError = fatalResponses[0]?.error;
    if (firstError && fatalResponses.length === responses.length) {
      return res.status(502).json({ error: firstError });
    }

    // Merge results — deduplicate by SerpAPI id and stable listing fields,
    // preserving insertion order. Google Jobs can repeat the same listing across
    // pages with different opaque ids.
    const seenIds = new Set<string>();
    const seenKeys = new Set<string>();
    const jobs = responses.flatMap((data, responseIdx) =>
      (data.jobs_results ?? [])
        .filter((j) => {
          const id = j.job_id;
          const key = jobDedupKey(j);
          if ((id && seenIds.has(id)) || seenKeys.has(key)) return false;
          if (id) seenIds.add(id);
          seenKeys.add(key);
          return true;
        })
        .map((j, idx) => mapJob(j, `job-${responseIdx}-${start}-${idx}`))
    );

    const nextTokens = Object.fromEntries(
      cityResults
        .filter((r) => r.nextPageToken)
        .map((r) => [r.city, r.nextPageToken!])
    );
    const hasMore = Object.keys(nextTokens).length > 0;
    const pagesFetched = Math.max(0, ...cityResults.map((r) => r.responses.length));
    const nextStart = start + pagesFetched * SERPAPI_PAGE_SIZE;
    const nextCursor = hasMore ? encodeCursor(nextTokens) : null;

    return res.json({
      jobs,
      query,
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

// GET /api/jobs/scrape?url=<job_url>
// Scrapes a job posting page for full description
router.get("/scrape", async (req, res) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).json({ error: "url param required" });

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

// POST /api/jobs/from-url
// Body: { url: string }
// Fetches a public job posting, strips HTML, uses LLM to extract structured job data.
router.post("/from-url", async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "A valid URL starting with http:// or https:// is required" });
  }

  try {
    const pageResp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ResumeX100/1.0; +https://resumex100.com)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!pageResp.ok) {
      return res.status(502).json({ error: `The page returned ${pageResp.status}. It may require a login or block automated access.` });
    }

    const html = await pageResp.text();

    // Extract <title> as a hint for the LLM
    const pageTitle = (/<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1] ?? "").trim();

    // Strip scripts, styles, and tags
    const pageText = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 5000);

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
    const extracted = JSON.parse(raw) as { title?: string; company?: string; location?: string; description?: string };

    if (!extracted.title && !extracted.company) {
      return res.status(422).json({ error: "Could not extract job information from this page. Make sure it is a public job posting and not a login wall." });
    }

    const hostname = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } })();
    const jobId = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    return res.json({
      id: jobId,
      title: extracted.title || "Unknown Title",
      company: extracted.company || "Unknown Company",
      location: extracted.location || "Not specified",
      via: hostname,
      description: extracted.description || pageText.slice(0, 800),
      highlights: [],
      postedAt: "Recently",
      salary: null,
      remote: /remote/i.test(extracted.location ?? ""),
      scheduleType: "Full-time",
      applyLink: url,
      source: "custom" as const,
    });
  } catch (err) {
    logger.error({ err }, "from-url error");
    return res.status(500).json({ error: "Could not process that URL. The page may be blocking automated access." });
  }
});

export default router;
