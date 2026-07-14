// @ts-nocheck
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pinoHttpModule from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const pinoHttp = pinoHttpModule as unknown as (options: {
  logger: typeof logger;
  serializers: {
    req: (req: { id?: string; method?: string; url?: string }) => object;
    res: (res: { statusCode?: number }) => object;
  };
}) => express.RequestHandler;

const app = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// ── CORS ──────────────────────────────────────────────────────────────────────
// Allow only our production domain + localhost for dev. Configurable via
// ALLOWED_ORIGINS env var (comma-separated) for staging/preview environments.
const ALLOWED_ORIGINS: (string | RegExp)[] = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["https://resumex100.com", "https://www.resumex100.com"];

app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin / no-origin requests (server-to-server, mobile)
      if (!origin) return callback(null, true);
      // Allow localhost in any form for local dev
      if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin "${origin}" not allowed`));
    },
    credentials: true,
  }),
);

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Key by bearer token prefix (user-scoped) when present, else by IP.
function rateLimitKey(req: express.Request): string {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ") && auth.length > 10) {
    // Use first 32 chars of token as a stable per-user key
    return `user:${auth.slice(7, 39)}`;
  }
  return req.ip ?? "unknown";
}

const rateLimitResponse = (code: string) => ({
  error: "Too many requests — please wait a moment and try again.",
  code,
});

// /api/resume/tailor — AI call + credit charge: 15 per minute per user
const tailorLimiter = rateLimit({
  windowMs: 60_000,
  max: 15,
  keyGenerator: rateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse("RATE_LIMITED_TAILOR"),
  skip: () => false,
});

// /api/resume/parse — PDF upload: 30 per minute per IP
const parseLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse("RATE_LIMITED_PARSE"),
});

// /api/jobs/search — calls SerpAPI: 20 per minute per user
const jobsLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  keyGenerator: rateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse("RATE_LIMITED_JOBS"),
});

// /api/resume/cover-letter — AI call: 10 per minute per user
const coverLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyGenerator: rateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse("RATE_LIMITED_COVER"),
});

// /api/resume/retry-change — AI retry: 30 per minute per user
const retryLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyGenerator: rateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse("RATE_LIMITED_RETRY"),
});

// /api/resume/suggest-gap-experience — AI call: 20 per minute per user
const gapSuggestLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  keyGenerator: rateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse("RATE_LIMITED_GAP"),
});

// /api/jobs/scrape and /api/jobs/from-url — outbound fetch: 30 per minute per user
const jobFetchLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyGenerator: rateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse("RATE_LIMITED_SCRAPE"),
});

app.use(express.json({
  limit: "50kb",
  verify(req, _res, buf) {
    if (req.originalUrl === "/api/billing/webhook") {
      req.rawBody = Buffer.from(buf);
    }
  },
}));
app.use(express.urlencoded({ extended: true }));

// Apply rate limiters before the router so they run on every matching request
app.use("/api/resume/tailor", tailorLimiter);
app.use("/api/resume/parse", parseLimiter);
app.use("/api/resume/cover-letter", coverLimiter);
app.use("/api/resume/retry-change", retryLimiter);
app.use("/api/resume/suggest-gap-experience", gapSuggestLimiter);
app.use("/api/jobs/search", jobsLimiter);
app.use("/api/jobs/scrape", jobFetchLimiter);
app.use("/api/jobs/from-url", jobFetchLimiter);

app.use("/api", router);

export default app;
