// API client — all calls go to /api (the api-server artifact)
const API_BASE = "/api";
let apiAccessToken: string | null = null;

export function setApiAccessToken(token: string | null) {
  apiAccessToken = token;
}

function authHeaders(headers: HeadersInit = {}): HeadersInit {
  return apiAccessToken
    ? { ...headers, Authorization: `Bearer ${apiAccessToken}` }
    : headers;
}

export interface JobResult {
  id: string;
  title: string;
  company: string;
  location: string;
  via: string;
  description: string;
  highlights: { title: string; items: string[] }[];
  postedAt: string;
  salary: string | null;
  remote: boolean;
  scheduleType: string;
  applyLink: string | null;
  source?: "search" | "custom";
}

export interface ResumeData {
  contact?: { name?: string; phone?: string; email?: string; location?: string; linkedin?: string; github?: string };
  summary?: string;
  skills?: string[];
  experience?: { title: string; company: string; location?: string; period: string; bullets?: string[] }[];
  education?: { degree: string; school: string; location?: string; year: string; notes?: string }[];
  certifications?: string[];
  achievements?: string[];
  projects?: { name: string; period?: string; bullets?: string[] }[];
}

export interface JobData {
  id?: string;
  title: string;
  company: string;
  location?: string;
  description?: string;
  highlights?: { title: string; items: string[] }[];
}

export interface DiffChange {
  id: string;
  section: string;
  original: string;
  jobReq: string;
  proposed: string;
  status: "rewritten" | "kept" | "confirm";
  gapType?: null | "keyword" | "evidence" | "true_gap";
  gapNote?: string;
  // UI state (not from server)
  confirmed?: boolean;
  retrying?: boolean;
  editMode?: boolean;
  customText?: string;
}

export interface TailoringResult {
  matchScore: number;
  seniorityMatch: string;
  changes: DiffChange[];
  skillGaps: { keyword: string[]; evidence: string[]; trueGap: string[] };
  senioritySignals: string[];
  atsChecks?: ATSCheck[];
}

export interface ATSCheck {
  ok: boolean;
  category: string;
  label: string;
  detail: string;
}

export interface PricingPlan {
  id: string | null;
  credits: number;
  price: string;
  label: string;
  popular: boolean;
  savings?: string;
}

export interface CreditBalance {
  userId: string;
  balance: number;
  freeCredits: number;
  freeUsed: number;
  freeRemaining: number;
  totalPurchased: number;
}

export interface SavedResumeProfile {
  resume: ResumeData;
  recommendations: {
    titles: { title: string; reason: string }[];
    locations: { label: string; icon: string }[];
  };
  fileName: string | null;
  updatedAt?: string;
}

export interface GeneratedResumeRecord {
  id: string;
  name: string;
  resume: ResumeData;
  job?: JobResult | JobData;
  jobTitle: string;
  jobCompany: string;
  diffChanges?: DiffChange[];
  sourceJobId?: string | null;
  savedAt: number;
}

export async function getBillingPrices(): Promise<{ source: "fallback" | "stripe"; prices: PricingPlan[] }> {
  const res = await fetch(`${API_BASE}/billing/prices`);
  if (!res.ok) throw new Error("Pricing unavailable");
  return res.json();
}

export async function getCreditBalance(): Promise<CreditBalance> {
  const res = await fetch(`${API_BASE}/billing/credits`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Could not load resume credits");
  }
  return res.json();
}

export async function createCheckout(priceId: string): Promise<{ url: string }> {
  const res = await fetch(`${API_BASE}/billing/checkout`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ priceId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Could not start checkout");
  }
  return res.json();
}

export async function getSavedProfile(): Promise<SavedResumeProfile | null> {
  const res = await fetch(`${API_BASE}/profile/vault`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Could not load saved profile");
  }
  return res.json();
}

export async function saveProfile(data: SavedResumeProfile): Promise<void> {
  const res = await fetch(`${API_BASE}/profile/vault`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Could not save profile");
  }
}

export async function clearSavedProfile(): Promise<void> {
  const res = await fetch(`${API_BASE}/profile/vault`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Could not clear profile");
  }
}

export async function getGeneratedResumes(): Promise<GeneratedResumeRecord[]> {
  const res = await fetch(`${API_BASE}/profile/generated-resumes`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Could not load saved resumes");
  }
  const data = await res.json() as { resumes?: GeneratedResumeRecord[] };
  return data.resumes ?? [];
}

export async function saveGeneratedResume(record: GeneratedResumeRecord): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/profile/generated-resumes`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Could not save generated resume");
  }
  return res.json();
}

export async function deleteGeneratedResume(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/profile/generated-resumes/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Could not delete generated resume");
  }
}

// ── Resume Parse ──────────────────────────────────────────────────────────────

export interface ParsedResumeResult {
  resume: ResumeData;
  recommendations: {
    titles: { title: string; reason: string }[];
    locations: { label: string; icon: string }[];
  };
}

export async function parseResume(file: File): Promise<ParsedResumeResult> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/resume/parse`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Resume parsing failed");
  }
  const raw = await res.json() as Partial<ParsedResumeResult>;
  return {
    resume: {
      contact: raw.resume?.contact ?? {},
      summary: raw.resume?.summary ?? "",
      skills: raw.resume?.skills ?? [],
      experience: raw.resume?.experience ?? [],
      education: raw.resume?.education ?? [],
      certifications: raw.resume?.certifications ?? [],
      achievements: raw.resume?.achievements ?? [],
    },
    recommendations: {
      titles: raw.recommendations?.titles ?? [],
      locations: raw.recommendations?.locations ?? [{ label: "Remote (US)", icon: "🌐" }],
    },
  };
}

// ── Autocomplete ─────────────────────────────────────────────────────────────

export async function autocompleteRole(q: string): Promise<string[]> {
  if (!q || q.length < 2) return [];
  try {
    const res = await fetch(`${API_BASE}/jobs/autocomplete?type=role&q=${encodeURIComponent(q)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return [];
    const data = await res.json() as { suggestions?: string[] };
    return data.suggestions ?? [];
  } catch {
    return [];
  }
}

export async function autocompleteLocation(q: string): Promise<string[]> {
  if (!q || q.length < 2) return [];
  try {
    const res = await fetch(`${API_BASE}/jobs/autocomplete?type=location&q=${encodeURIComponent(q)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return [];
    const data = await res.json() as { suggestions?: string[] };
    return data.suggestions ?? [];
  } catch {
    return [];
  }
}

// ── Job Search ────────────────────────────────────────────────────────────────

export interface SearchJobsOptions {
  limit?: number;
  pages?: number;
  start?: number;
  cursor?: string | null;
  dateFilter?: string; // "today" | "3days" | "week" | "month"
  platforms?: string[]; // client-side filter on `via` field (case-insensitive contains)
}

export interface SearchJobsResult {
  jobs: JobResult[];
  hasMore: boolean;
  nextStart?: number;
  nextCursor?: string | null;
  pagesFetched?: number;
}

export async function searchJobs(
  titles: string[],
  location: string,
  opts: SearchJobsOptions = {},
  onJob?: (job: JobResult) => void
): Promise<SearchJobsResult> {
  const { start = 0, cursor, dateFilter, platforms, limit = 10, pages = 10 } = opts;
  const params = new URLSearchParams({
    titles: titles.join(","),
    location,
    start: String(start),
    limit: String(Math.min(Math.max(1, limit), 30)),
    pages: String(Math.min(Math.max(1, pages), 25)),
    ...(cursor ? { cursor } : {}),
    ...(dateFilter ? { dateFilter } : {}),
  });

  const res = await fetch(`${API_BASE}/jobs/search?${params}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Job search failed");
  }

  const raw = await res.json() as { jobs: JobResult[]; hasMore: boolean; nextStart?: number; nextCursor?: string | null; pagesFetched?: number };

  // Apply platform filter client-side if requested
  const jobs = platforms && platforms.length > 0
    ? raw.jobs.filter(j => platforms.some(p => j.via.toLowerCase().includes(p.toLowerCase())))
    : raw.jobs;

  // Emit jobs one by one with small delay for a streaming-feel UX
  if (onJob) {
    for (const job of jobs) {
      onJob(job);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  return { jobs, hasMore: raw.hasMore ?? false, nextStart: raw.nextStart, nextCursor: raw.nextCursor, pagesFetched: raw.pagesFetched };
}

// ── Resume Tailoring (SSE streaming) ─────────────────────────────────────────

export interface TailorCallbacks {
  onStatus?: (msg: string) => void;
  onResult?: (result: TailoringResult) => void;
  onError?: (msg: string, code?: string) => void;
}

export async function tailorResume(
  resume: ResumeData,
  job: JobData,
  callbacks: TailorCallbacks
): Promise<void> {
  const res = await fetch(`${API_BASE}/resume/tailor`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ resume, job }),
  });

  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    callbacks.onError?.(err.error ?? "Tailor request failed");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const event = JSON.parse(line.slice(6)) as {
          type: string;
          message?: string;
          data?: TailoringResult;
          error?: string;
          code?: string;
        };
        if (event.type === "status" && event.message) callbacks.onStatus?.(event.message);
        if (event.type === "result" && event.data) callbacks.onResult?.(event.data);
        if (event.type === "error") callbacks.onError?.(event.error ?? event.message ?? "Unknown error", event.code);
      } catch {
        // partial JSON chunk — skip
      }
    }
  }
}

// ── Retry a single change ─────────────────────────────────────────────────────

export async function retryChange(
  resume: ResumeData,
  job: JobData,
  change: DiffChange
): Promise<{ proposed: string; rationale: string }> {
  const res = await fetch(`${API_BASE}/resume/retry-change`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ resume, job, change }),
  });
  if (!res.ok) throw new Error("Retry failed");
  return res.json();
}

// ── Share Resume ──────────────────────────────────────────────────────────────

export async function shareResume(
  resume: ResumeData,
  jobTitle: string,
  jobCompany: string
): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/resume/share`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ resume, jobTitle, jobCompany }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Failed to create share link");
  }
  return res.json();
}

export async function getSharedResume(id: string): Promise<{ resume: ResumeData; jobTitle: string; jobCompany: string }> {
  const res = await fetch(`${API_BASE}/resume/r/${id}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Resume not found");
  }
  return res.json();
}

// ── Fetch job from direct URL ─────────────────────────────────────────────────

export async function fetchJobFromUrl(url: string): Promise<JobResult> {
  const res = await fetch(`${API_BASE}/jobs/from-url`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Could not fetch job from URL");
  }
  return res.json();
}

// ── Scrape full job description from a posting page ───────────────────────────

export async function scrapeJobDescription(
  applyLink: string | null,
  jobId?: string
): Promise<string | null> {
  if (!applyLink && !jobId) return null;
  const params = new URLSearchParams();
  if (applyLink) params.set("url", applyLink);
  if (jobId) params.set("job_id", jobId);
  try {
    const res = await fetch(`${API_BASE}/jobs/scrape?${params}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    const data = await res.json() as { description?: string };
    return data.description ?? null;
  } catch {
    return null;
  }
}

// ── Gap Experience Suggestion ─────────────────────────────────────────────────

export interface GapSuggestion {
  title: string;
  company: string;
  period: string;
  bullets: string[];
}

export async function suggestGapExperience(
  resume: ResumeData,
  gapStart: string,
  gapEnd: string,
  durationMonths: number
): Promise<GapSuggestion> {
  const res = await fetch(`${API_BASE}/resume/suggest-gap-experience`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ resume, gapStart, gapEnd, durationMonths }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Failed to generate gap suggestion");
  }
  const data = await res.json() as { suggestion: GapSuggestion };
  return data.suggestion;
}

// ── Cover letter (SSE streaming) ──────────────────────────────────────────────

export async function generateCoverLetter(
  resume: ResumeData,
  job: JobData,
  onChunk: (text: string) => void,
  onDone: () => void
): Promise<void> {
  const res = await fetch(`${API_BASE}/resume/cover-letter`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ resume, job }),
  });

  if (!res.ok || !res.body) throw new Error("Cover letter request failed");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const ev = JSON.parse(line.slice(6)) as { content?: string; done?: boolean };
        if (ev.content) onChunk(ev.content);
        if (ev.done) onDone();
      } catch { /* skip */ }
    }
  }
}
