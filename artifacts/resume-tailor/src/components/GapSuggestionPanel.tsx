import { useState, useEffect, useCallback } from "react";
import { AlertCircle, Check, X, RotateCcw, Loader2, Clock } from "lucide-react";
import { type ResumeData, type GapSuggestion, suggestGapExperience } from "@/lib/api";

interface DetectedGap {
  gapStart: string;
  gapEnd: string;
  durationMonths: number;
  label: string;
}

type GapStatus = "idle" | "loading" | "ready" | "error" | "accepted" | "dismissed";

interface GapState {
  gap: DetectedGap;
  status: GapStatus;
  suggestion: GapSuggestion | null;
  error: string | null;
}

// ── Date parsing ──────────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function parseDate(token: string): Date | null {
  const t = token.trim().toLowerCase();
  if (t === "present" || t === "current" || t === "now" || t === "today") {
    return new Date();
  }
  // "Jan 2020" or "January 2020"
  const monthYear = t.match(/^([a-z]+)\s+(\d{4})$/);
  if (monthYear) {
    const month = MONTH_MAP[monthYear[1]];
    const year = parseInt(monthYear[2], 10);
    if (month !== undefined && !isNaN(year)) return new Date(year, month, 1);
  }
  // "2020"
  const yearOnly = t.match(/^(\d{4})$/);
  if (yearOnly) return new Date(parseInt(yearOnly[1], 10), 0, 1);
  // "2020-01" or "01/2020"
  const isoMonth = t.match(/^(\d{4})-(\d{2})$/);
  if (isoMonth) return new Date(parseInt(isoMonth[1], 10), parseInt(isoMonth[2], 10) - 1, 1);
  const slashMonth = t.match(/^(\d{2})\/(\d{4})$/);
  if (slashMonth) return new Date(parseInt(slashMonth[2], 10), parseInt(slashMonth[1], 10) - 1, 1);
  return null;
}

function parsePeriod(period: string): { start: Date | null; end: Date | null } {
  // Split on em-dash, en-dash, hyphen surrounded by spaces, or " to "
  const parts = period.split(/\s*[–—]\s*|\s+to\s+/i);
  if (parts.length >= 2) {
    return { start: parseDate(parts[0]), end: parseDate(parts[parts.length - 1]) };
  }
  // Single token — treat as start, end unknown
  return { start: parseDate(period.trim()), end: null };
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function formatMonthYear(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// ── Gap detection ─────────────────────────────────────────────────────────────

function detectGaps(experience: ResumeData["experience"]): DetectedGap[] {
  if (!experience || experience.length === 0) return [];

  const parsed = experience
    .map(e => {
      const { start, end } = parsePeriod(e.period ?? "");
      return { start, end };
    })
    .filter(e => e.start !== null) as { start: Date; end: Date | null }[];

  if (parsed.length === 0) return [];

  // Sort by start date descending (most recent first), then scan chronologically
  parsed.sort((a, b) => b.start.getTime() - a.start.getTime());

  const gaps: DetectedGap[] = [];
  const now = new Date();

  for (let i = 0; i < parsed.length - 1; i++) {
    // parsed[i] is more recent, parsed[i+1] is earlier (sorted descending)
    // The gap is between the END of parsed[i+1] and the START of parsed[i]
    const gapStart = parsed[i + 1].end ?? parsed[i + 1].start;
    const gapEnd = parsed[i].start;

    // Only count if gapEnd is actually after gapStart and the gap is >3 months
    if (gapEnd > gapStart) {
      const months = monthsBetween(gapStart, gapEnd);
      if (months > 3) {
        const gapStartStr = formatMonthYear(gapStart);
        const gapEndStr = formatMonthYear(gapEnd);
        // Avoid duplicate gaps
        if (!gaps.find(g => g.gapStart === gapStartStr && g.gapEnd === gapEndStr)) {
          gaps.push({
            gapStart: gapStartStr,
            gapEnd: gapEndStr,
            durationMonths: months,
            label: `${months}-month gap (${gapStartStr} – ${gapEndStr})`,
          });
        }
      }
    }
  }

  return gaps;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  resume: ResumeData;
  onAddExperience: (entry: { title: string; company: string; period: string; bullets: string[] }) => void;
}

export function GapSuggestionPanel({ resume, onAddExperience }: Props) {
  const [gapStates, setGapStates] = useState<GapState[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const gaps = detectGaps(resume.experience);
    if (gaps.length === 0) {
      setInitialized(true);
      return;
    }
    setGapStates(gaps.map(gap => ({ gap, status: "idle", suggestion: null, error: null })));
    setInitialized(true);
  }, []); // run once on mount

  const fetchSuggestion = useCallback(async (index: number) => {
    let gap: DetectedGap | undefined;
    setGapStates(prev => {
      gap = prev[index]?.gap;
      return prev.map((s, i) => i === index ? { ...s, status: "loading", error: null } : s);
    });
    // Fallback: re-detect if state hasn't hydrated yet
    if (!gap) gap = detectGaps(resume.experience)[index];
    if (!gap) return;
    const capturedGap = gap;
    try {
      const suggestion = await suggestGapExperience(
        resume, capturedGap.gapStart, capturedGap.gapEnd, capturedGap.durationMonths
      );
      setGapStates(prev =>
        prev.map((s, i) => i === index ? { ...s, status: "ready", suggestion } : s)
      );
    } catch (err) {
      setGapStates(prev =>
        prev.map((s, i) =>
          i === index
            ? { ...s, status: "error", error: err instanceof Error ? err.message : "Failed to generate suggestion" }
            : s
        )
      );
    }
  }, [resume]);

  if (!initialized || gapStates.length === 0) return null;

  const visible = gapStates.filter(s => s.status !== "accepted" && s.status !== "dismissed");
  if (visible.length === 0) return null;

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4" style={{ color: "#F59E0B" }} />
        <h3 className="font-heading font-bold text-sm" style={{ color: "#0A0A0A" }}>
          Resume Gap{visible.length > 1 ? "s" : ""} Detected
        </h3>
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: "#FEF3C7", color: "#92400E" }}
        >
          {visible.length}
        </span>
      </div>
      <p className="text-xs" style={{ color: "#666" }}>
        We noticed periods with no listed experience. We can suggest activities you may have forgotten — review and accept, retry, or dismiss each.
      </p>

      {gapStates.map((state, index) => {
        if (state.status === "accepted" || state.status === "dismissed") return null;
        return (
          <GapCard
            key={state.gap.label}
            state={state}
            onFetch={() => fetchSuggestion(index)}
            onAccept={() => {
              if (state.suggestion) {
                onAddExperience(state.suggestion);
                setGapStates(prev =>
                  prev.map((s, i) => i === index ? { ...s, status: "accepted" } : s)
                );
              }
            }}
            onRetry={() => fetchSuggestion(index)}
            onDismiss={() =>
              setGapStates(prev =>
                prev.map((s, i) => i === index ? { ...s, status: "dismissed" } : s)
              )
            }
          />
        );
      })}
    </div>
  );
}

function GapCard({
  state,
  onFetch,
  onAccept,
  onRetry,
  onDismiss,
}: {
  state: GapState;
  onFetch: () => void;
  onAccept: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { gap, status, suggestion, error } = state;

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ borderColor: "#E5E7EB", backgroundColor: "#fff" }}
    >
      {/* Gap banner */}
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ backgroundColor: "#FFFBEB", borderBottom: "1px solid #FDE68A" }}
      >
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#D97706" }} />
          <span className="text-xs font-semibold" style={{ color: "#92400E" }}>
            {gap.label}
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="text-xs flex items-center gap-1 hover:opacity-70 transition-opacity px-2 py-2 rounded-lg"
          style={{ color: "#9CA3AF" }}
          aria-label="Dismiss this gap"
        >
          <X className="w-3 h-3" />
          Dismiss
        </button>
      </div>

      <div className="p-5">
        {status === "idle" && (
          <div className="flex flex-col items-center gap-3 py-2">
            <p className="text-sm text-center" style={{ color: "#555" }}>
              Would you like a suggestion for what you may have done during this period?
            </p>
            <button
              onClick={onFetch}
              className="px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ backgroundColor: "#00F0A0", color: "#0A0A0A" }}
            >
              Suggest Experience
            </button>
          </div>
        )}

        {status === "loading" && (
          <div className="flex items-center justify-center gap-2 py-4">
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#00c447" }} />
            <span className="text-sm" style={{ color: "#555" }}>Generating suggestion…</span>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4" style={{ color: "#EF4444" }} />
              <p className="text-sm" style={{ color: "#EF4444" }}>{error}</p>
            </div>
            <button
              onClick={onRetry}
              className="px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity flex items-center gap-1.5"
              style={{ backgroundColor: "#F3F4F6", color: "#374151" }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Try Again
            </button>
          </div>
        )}

        {status === "ready" && suggestion && (
          <div className="space-y-3">
            <div>
              <p className="font-semibold text-sm" style={{ color: "#0A0A0A" }}>{suggestion.title}</p>
              <p className="text-xs" style={{ color: "#888" }}>{suggestion.company} · {suggestion.period}</p>
            </div>
            {suggestion.bullets.length > 0 && (
              <ul className="space-y-1">
                {suggestion.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm" style={{ color: "#444" }}>
                    <span className="mt-1.5 w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: "#00c447" }} />
                    {b}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs italic" style={{ color: "#9CA3AF" }}>
              These are memory prompts — review before accepting to ensure they reflect your actual experience.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={onAccept}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity min-h-[44px]"
                style={{ backgroundColor: "#00F0A0", color: "#0A0A0A" }}
              >
                <Check className="w-3.5 h-3.5" />
                Accept
              </button>
              <button
                onClick={onRetry}
                className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity min-h-[44px]"
                style={{ backgroundColor: "#F3F4F6", color: "#374151" }}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Retry
              </button>
              <button
                onClick={onDismiss}
                className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity min-h-[44px]"
                style={{ backgroundColor: "#FEE2E2", color: "#B91C1C" }}
              >
                <X className="w-3.5 h-3.5" />
                Reject
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
