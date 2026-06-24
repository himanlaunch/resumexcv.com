import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "wouter";
import {
  Upload, Search, CheckSquare, Download, Shield, Check, X,
  AlertCircle, FileText, Plus, MapPin, DollarSign,
  Clock, Briefcase, ArrowRight, ExternalLink, Zap, Copy,
  Mail, Sparkles, Pen, RotateCcw, Loader2, ThumbsUp, ThumbsDown,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Eye, EyeOff, TrendingUp, Share2, Columns2,
  BookmarkCheck, Bookmark, Trash2, Link2
} from "lucide-react";
import {
  type JobResult, type ResumeData, type JobData, type DiffChange,
  type TailoringResult, type ATSCheck,
  searchJobs, tailorResume, retryChange, generateCoverLetter, parseResume,
  shareResume, fetchJobFromUrl, scrapeJobDescription,
  getBillingPrices, getCreditBalance, createCheckout, fulfillCheckoutSession,
  getSavedProfile, saveProfile, clearSavedProfile,
  getGeneratedResumes, saveGeneratedResume, deleteGeneratedResume,
  autocompleteRole, autocompleteLocation,
  type ParsedResumeResult, type CreditBalance, type PricingPlan,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BrandLogo } from "@/components/BrandLogo";
import { GapSuggestionPanel } from "@/components/GapSuggestionPanel";
import { upsertCampaignFromJob, updateCampaignStatus, loadCampaigns, type CampaignStatus } from "@/lib/campaigns";
import { sanitizeDiffChange, sanitizeResumeForExport, sanitizeResumeSkillText, sanitizeResumeText } from "@/lib/resumeSafety";

type Step = 1 | 3 | 4 | 5;

// ── localStorage persistence ───────────────────────────────────────────────────

const STORAGE_KEY = "resume_tailor_saved_v2";
const ANONYMOUS_STORAGE_SCOPE = "anonymous";

function storageKey(base: string, scope = ANONYMOUS_STORAGE_SCOPE) {
  return `${base}:${scope}`;
}

interface SavedResumeData {
  resume: ResumeData;
  recommendations: typeof RESUME_RECOMMENDATIONS;
  fileName: string | null;
}

function loadSaved(scope = ANONYMOUS_STORAGE_SCOPE): SavedResumeData | null {
  try {
    const raw = localStorage.getItem(storageKey(STORAGE_KEY, scope));
    if (!raw) return null;
    return JSON.parse(raw) as SavedResumeData;
  } catch {
    return null;
  }
}

function persistResume(data: SavedResumeData, scope = ANONYMOUS_STORAGE_SCOPE) {
  try { localStorage.setItem(storageKey(STORAGE_KEY, scope), JSON.stringify(data)); } catch {}
}

function clearPersistedResume(scope = ANONYMOUS_STORAGE_SCOPE) {
  try { localStorage.removeItem(storageKey(STORAGE_KEY, scope)); } catch {}
}

// ── Saved versions persistence ─────────────────────────────────────────────────

const VERSIONS_KEY = "resume_tailor_versions_v1";

export interface SavedVersion {
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

function loadVersions(scope = ANONYMOUS_STORAGE_SCOPE): SavedVersion[] {
  try {
    const raw = localStorage.getItem(storageKey(VERSIONS_KEY, scope));
    if (!raw) return [];
    return JSON.parse(raw) as SavedVersion[];
  } catch {
    return [];
  }
}

function persistVersions(versions: SavedVersion[], scope = ANONYMOUS_STORAGE_SCOPE) {
  try { localStorage.setItem(storageKey(VERSIONS_KEY, scope), JSON.stringify(versions)); } catch {}
}

function addVersion(version: SavedVersion, scope = ANONYMOUS_STORAGE_SCOPE): SavedVersion[] {
  const existing = loadVersions(scope).filter(v => v.id !== version.id);
  const updated = [version, ...existing];
  persistVersions(updated, scope);
  return updated;
}

function removeVersion(id: string, scope = ANONYMOUS_STORAGE_SCOPE): SavedVersion[] {
  const updated = loadVersions(scope).filter(v => v.id !== id);
  persistVersions(updated, scope);
  return updated;
}

const STEPS = [
  { num: 1 as Step, icon: <Upload className="w-4 h-4" />, label: "Career Vault" },
  { num: 3 as Step, icon: <Briefcase className="w-4 h-4" />, label: "Job Discovery" },
  { num: 4 as Step, icon: <CheckSquare className="w-4 h-4" />, label: "Review & Confirm" },
  { num: 5 as Step, icon: <Download className="w-4 h-4" />, label: "Export" },
];

// ── Location suggestions for auto-suggest picker ──────────────────────────────

const LOCATION_SUGGESTIONS = [
  // Remote
  { label: "Remote (US)", icon: "🌐" },
  { label: "Remote (Worldwide)", icon: "🌍" },
  { label: "Hybrid (US)", icon: "🏠" },
  // US Cities
  { label: "San Francisco, CA", icon: "🌁" },
  { label: "New York, NY", icon: "🗽" },
  { label: "Seattle, WA", icon: "🌧️" },
  { label: "Austin, TX", icon: "🤠" },
  { label: "Boston, MA", icon: "🦞" },
  { label: "Chicago, IL", icon: "🌬️" },
  { label: "Los Angeles, CA", icon: "🎬" },
  { label: "Denver, CO", icon: "⛰️" },
  { label: "Atlanta, GA", icon: "🍑" },
  { label: "Dallas, TX", icon: "⭐" },
  { label: "Miami, FL", icon: "🌴" },
  { label: "Washington, DC", icon: "🏛️" },
  { label: "San Jose, CA", icon: "💻" },
  { label: "Portland, OR", icon: "🌲" },
  { label: "Minneapolis, MN", icon: "❄️" },
  { label: "Phoenix, AZ", icon: "☀️" },
  { label: "Raleigh, NC", icon: "🌿" },
  { label: "Nashville, TN", icon: "🎸" },
  { label: "Pittsburgh, PA", icon: "🌉" },
  // International
  { label: "London, UK", icon: "🎡" },
  { label: "Toronto, Canada", icon: "🍁" },
  { label: "Berlin, Germany", icon: "🐻" },
  { label: "Amsterdam, Netherlands", icon: "🌷" },
  { label: "Singapore", icon: "🦁" },
  { label: "Sydney, Australia", icon: "🦘" },
  { label: "Paris, France", icon: "🗼" },
  { label: "Dublin, Ireland", icon: "🍀" },
] as const;

const QUICK_LOCATIONS = ["Remote (US)", "New York, NY", "San Francisco, CA", "Seattle, WA", "Austin, TX"];

// Alex's resume — in a real app this comes from file parsing
const ALEX: ResumeData = {
  contact: { name: "Alex Chen", email: "alex.chen@email.com", location: "San Francisco, CA", linkedin: "linkedin.com/in/alexchen", github: "github.com/alexchen" },
  summary: "Senior Software Engineer with 8+ years building distributed systems at scale. Led multi-million dollar infrastructure migrations and built real-time data pipelines. Deeply experienced with microservices, cloud infrastructure (AWS/GCP), and high-throughput systems.",
  skills: ["Python", "Go", "Kubernetes", "AWS", "PostgreSQL", "React", "Redis", "gRPC", "Terraform", "Docker", "TypeScript", "Kafka"],
  experience: [
    { title: "Senior Software Engineer", company: "Stripe", period: "2021–Present", bullets: ["Led migration of payment processing service to microservices architecture, reducing p99 latency by 40%", "Built real-time fraud detection pipeline processing 50k+ events/sec using Go and Kafka", "Mentored 4 junior engineers; established code review standards adopted org-wide"] },
    { title: "Software Engineer", company: "Airbnb", period: "2018–2021", bullets: ["Owned search ranking system serving 150M monthly active users", "Built A/B testing infrastructure supporting 200+ concurrent experiments", "Reduced API response time by 35% through query optimization and caching"] },
    { title: "Software Engineer", company: "Dropbox", period: "2016–2018", bullets: ["Core team on mobile sync engine for iOS and Android", "Reduced battery drain by 30% through background sync optimization", "Shipped delta sync feature reducing bandwidth usage by 60%"] },
  ],
  education: [{ degree: "B.S. Computer Science", school: "UC Berkeley", year: "2016" }],
  certifications: ["AWS Solutions Architect Professional", "Certified Kubernetes Administrator (CKA)"],
};

const RESUME_RECOMMENDATIONS = {
  titles: [
    { title: "Staff Software Engineer", reason: "8+ yrs exp, led large-scale infra at Stripe" },
    { title: "Senior Software Engineer", reason: "Current title — direct lateral search" },
    { title: "Principal Engineer", reason: "Org-wide technical influence, mentorship" },
    { title: "Backend Engineer", reason: "Deep Go, Kafka, gRPC background" },
    { title: "Platform / Infrastructure Engineer", reason: "Kubernetes CKA, Terraform, AWS cert" },
    { title: "Engineering Manager", reason: "Mentored 4 engineers, set team standards" },
  ],
  locations: [
    { label: "Remote (US)", icon: "🌐" },
    { label: "San Francisco, CA", icon: "📍" },
    { label: "New York, NY", icon: "📍" },
    { label: "Seattle, WA", icon: "📍" },
  ],
};

const ROLE_SUGGESTIONS = [
  "AI Engineer",
  "AI Product Manager",
  "Analytics Engineer",
  "Backend Engineer",
  "Business Intelligence Analyst",
  "Data Analyst",
  "Data Engineer",
  "Data Product Analyst",
  "Data Product Manager",
  "Data Scientist",
  "Financial Data Analyst",
  "Full Stack Engineer",
  "Investment Analyst",
  "Machine Learning Engineer",
  "Platform Engineer",
  "Product Analyst",
  "Product Data Analyst",
  "Product Manager",
  "Senior Data Analyst",
  "Senior Software Engineer",
  "Software Engineer",
  "Staff Software Engineer",
] as const;

// Assign a deterministic color per company initial
function companyColor(company: string) {
  const colors = ["#635BFF","#00A3FF","#0ACF83","#C47E4E","#5E6AD2","#FF6B35","#E91E8C","#00BCD4","#FF5722","#4CAF50"];
  let h = 0;
  for (let i = 0; i < company.length; i++) h = (h * 31 + company.charCodeAt(i)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({ step, setStep, completedSteps, resume, credits, onBuyCredits }: { step: Step; setStep: (s: Step) => void; completedSteps: Set<Step>; resume: ResumeData; credits: CreditBalance | null; onBuyCredits: () => void }) {
  const { user, signOut } = useAuth();
  const displayEmail = user?.email ?? "Signed in";
  const metadataName = [user?.user_metadata?.full_name, user?.user_metadata?.name]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?.trim();
  const emailName = user?.email?.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  const displayName = metadataName ?? emailName ?? "Your Profile";
  const initials = displayName.split(/\s+/).map(n => n[0]).slice(0, 2).join("").toUpperCase();

  return (
    <aside className="hidden md:flex fixed left-0 top-0 bottom-0 z-40 w-64 flex-shrink-0 flex-col overflow-y-auto" style={{ backgroundColor: "#0F0F0F" }}>
      <div className="px-5 py-5 border-b" style={{ borderColor: "#1E1E1E" }}>
        <Link href="/" className="flex items-center">
          <BrandLogo onDark imageClassName="h-9" />
        </Link>
      </div>
      <nav className="flex-1 px-3 py-5 space-y-1">
        {STEPS.map((s, index) => {
          const isActive = step === s.num;
          const isDone = completedSteps.has(s.num) && !isActive;
          return (
            <button key={s.num} onClick={() => setStep(s.num)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all"
              style={{ backgroundColor: isActive ? "rgba(0,240,160,0.16)" : "transparent", color: isActive ? "#4DFFBD" : isDone ? "#E5E7EB" : "#B8C0C8" }}
            >
              <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: isActive ? "rgba(0,240,160,0.24)" : isDone ? "rgba(255,255,255,0.11)" : "rgba(255,255,255,0.08)" }}>
                {isDone ? <Check className="w-3.5 h-3.5" style={{ color: "#00F0A0" }} /> : s.icon}
              </div>
              <div>
                <div className="text-xs font-semibold">{s.label}</div>
                <div className="text-xs" style={{ color: isActive ? "#A7F3D0" : "#8B949E", fontFamily: "monospace" }}>Step {index + 1}</div>
              </div>
            </button>
          );
        })}
      </nav>
      <div className="px-4 py-4 border-t" style={{ borderColor: "#1E1E1E" }}>
        <Link href="/campaigns" className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg transition-colors"
          style={{ color: "#B8C0C8" }}
          onMouseEnter={e => { e.currentTarget.style.color = "#00F0A0"; e.currentTarget.style.backgroundColor = "rgba(0,240,160,0.06)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "#B8C0C8"; e.currentTarget.style.backgroundColor = "transparent"; }}
        >
          <Briefcase className="w-4 h-4" />Campaign Tracker
        </Link>

        {!user ? (
          /* ── Promo sign-in block for signed-out users ── */
          <div className="mt-3 rounded-xl p-3" style={{ backgroundColor: "rgba(0,240,160,0.08)", border: "1px solid rgba(0,240,160,0.22)" }}>
            <div className="flex items-center gap-1.5 mb-1">
              <Zap className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#00F0A0" }} />
              <span className="text-xs font-bold" style={{ color: "#00F0A0" }}>10 FREE credits — limited promo</span>
            </div>
            <p className="text-xs mb-2.5" style={{ color: "#8B949E" }}>Sign in to claim 10 free resume tailoring credits. No card required.</p>
            <Link href="/signin"
              className="block w-full text-center text-xs font-bold py-2 rounded-lg transition-opacity hover:opacity-90"
              style={{ backgroundColor: "#00F0A0", color: "#0A0A0A" }}
            >
              Sign in &amp; claim credits
            </Link>
          </div>
        ) : (
          <>
            <button
              onClick={onBuyCredits}
              className="mt-2 w-full flex items-center justify-between gap-2 text-sm px-3 py-2 rounded-lg transition-colors"
              style={{ color: "#B8C0C8", backgroundColor: "rgba(0,240,160,0.06)", border: "1px solid rgba(0,240,160,0.18)" }}
            >
              <span className="flex items-center gap-2"><Zap className="w-4 h-4" />Buy credits</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: "#00F0A0", color: "#0A0A0A" }}>{credits?.balance ?? 0}</span>
            </button>
            <div className="mt-3 flex items-center gap-2 px-3 py-2">
              <div className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs" style={{ backgroundColor: "#333", color: "#ccc" }}>
                {initials || "U"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold truncate" style={{ color: "#ccc" }}>{displayName}</div>
                <div className="text-xs truncate" style={{ color: "#9CA3AF" }}>{displayEmail}</div>
              </div>
            </div>
            <button
              onClick={() => void signOut()}
              className="w-full text-left text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
              style={{ color: "#B8C0C8" }}
              onMouseEnter={e => { e.currentTarget.style.color = "#FCA5A5"; e.currentTarget.style.backgroundColor = "rgba(239,68,68,0.08)"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "#B8C0C8"; e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              Sign out
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

function BuyCreditsModal({ open, onClose, credits, onCreditsUpdated }: { open: boolean; onClose: () => void; credits: CreditBalance | null; onCreditsUpdated: () => Promise<CreditBalance | null> }) {
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingPlans(true);
    getBillingPrices()
      .then(data => {
        if (!cancelled) setPlans(data.prices ?? []);
      })
      .catch(() => {
        if (!cancelled) setPlans([
          { id: null, credits: 30, price: "$9.99", label: "30 resume credits", popular: true },
          { id: null, credits: 100, price: "$19.99", label: "100 resume credits", popular: false },
        ]);
      })
      .finally(() => {
        if (!cancelled) setLoadingPlans(false);
      });
    void onCreditsUpdated();
    return () => { cancelled = true; };
  }, [open, onCreditsUpdated]);

  if (!open) return null;
  const paidPlans = plans
    .filter(plan => plan.credits >= 10)
    .sort((a, b) => a.credits - b.credits)
    .slice(0, 2);
  const displayPlans = paidPlans.length > 0
    ? paidPlans
    : [
        { id: null, credits: 30, price: "$9.99", label: "30 resume credits", popular: true },
        { id: null, credits: 100, price: "$19.99", label: "100 resume credits", popular: false },
      ];

  const handleCheckout = async (plan: PricingPlan) => {
    if (!plan.id) {
      setError("Stripe checkout is not ready yet. Please try again in a moment.");
      return;
    }
    setError("");
    setCheckoutLoading(true);
    try {
      const { url } = await createCheckout(plan.id);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout.");
      setCheckoutLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.45)" }}>
      <div className="w-full max-w-2xl rounded-2xl p-5 md:p-6" style={{ backgroundColor: "#fff", border: "1px solid #E5E8EA", boxShadow: "0 20px 60px rgba(0,0,0,0.22)" }}>
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="font-heading font-bold text-2xl" style={{ color: "#0A0A0A" }}>Buy resume credits</h2>
            <p className="text-sm mt-1" style={{ color: "#666" }}>Each tailored resume uses 1 credit.</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: "#F0F0F0", color: "#555" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-5">
          {[
            ["Balance", credits?.balance ?? 0],
            ["Free used", `${credits?.freeUsed ?? 0}/${credits?.freeCredits ?? 10}`],
            ["Purchased", credits?.totalPurchased ?? 0],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl p-3 text-center" style={{ backgroundColor: "#F8F9FA", border: "1px solid #E5E8EA" }}>
              <div className="font-heading font-bold text-xl" style={{ color: "#0A0A0A" }}>{value}</div>
              <div className="text-xs" style={{ color: "#888" }}>{label}</div>
            </div>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          {displayPlans.map((plan) => (
            <div key={`${plan.credits}-${plan.price}`} className="relative rounded-2xl p-5 overflow-hidden" style={{ backgroundColor: "#00F0A0", color: "#0A0A0A", border: "1px solid rgba(0,0,0,0.1)" }}>
              {plan.popular && (
                <div className="absolute top-3 right-3 text-[0.65rem] font-bold px-2 py-1 rounded-full" style={{ backgroundColor: "#0A0A0A", color: "#00F0A0" }}>
                  Popular
                </div>
              )}
              <div className="font-heading font-bold text-3xl mb-2">{plan.price}</div>
              <div className="font-semibold mb-1">{plan.label}</div>
              <p className="text-sm mb-4" style={{ color: "#005A3D" }}>Generate up to {plan.credits} tailored resumes.</p>
              <button
                onClick={() => void handleCheckout(plan)}
                disabled={checkoutLoading || loadingPlans}
                className="btn-dark w-full"
                style={{ opacity: checkoutLoading || loadingPlans ? 0.7 : 1 }}
              >
                {checkoutLoading ? "Opening Stripe..." : "Buy Now"}
              </button>
            </div>
          ))}
        </div>
        {error && <p className="text-sm" style={{ color: "#DC2626" }}>{error}</p>}
      </div>
    </div>
  );
}

// ── Mobile bottom nav ─────────────────────────────────────────────────────────

function MobileBottomNav({ step, setStep, completedSteps }: { step: Step; setStep: (s: Step) => void; completedSteps: Set<Step> }) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden items-stretch"
      style={{ backgroundColor: "#0F0F0F", borderTop: "1px solid #1E1E1E", height: 60 }}>
      {STEPS.map((s) => {
        const isActive = step === s.num;
        const isDone = completedSteps.has(s.num) && !isActive;
        return (
          <button key={s.num} onClick={() => setStep(s.num)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-all"
            style={{ color: isActive ? "#4DFFBD" : isDone ? "#D1D5DB" : "#9CA3AF" }}>
            <div className="w-5 h-5 flex items-center justify-center">
              {isDone ? <Check className="w-4 h-4" style={{ color: "#00F0A0" }} /> : s.icon}
            </div>
            <span style={{ fontSize: "0.6rem", fontWeight: 600, lineHeight: 1 }}>{s.label.split(" ")[0]}</span>
          </button>
        );
      })}
      <Link href="/campaigns"
        className="flex-1 flex flex-col items-center justify-center gap-0.5"
        style={{ color: "#555" }}>
        <Briefcase className="w-4 h-4" />
        <span style={{ fontSize: "0.6rem", fontWeight: 600, lineHeight: 1 }}>Track</span>
      </Link>
    </nav>
  );
}

// ── No-data guard ────────────────────────────────────────────────────────────

function NoDataGuard({ message, action, onAction }: { message: string; action: string; onAction: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ backgroundColor: "#F0F0F0" }}>
          <Briefcase className="w-8 h-8" style={{ color: "#888" }} />
        </div>
        <h2 className="font-heading font-bold text-xl mb-2" style={{ color: "#0A0A0A" }}>{message}</h2>
        <p className="text-sm mb-6" style={{ color: "#888" }}>Complete the previous steps first to see content here.</p>
        <button className="btn-mint" onClick={onAction}>{action} <ArrowRight className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

// ── LocationPicker: multi-select + auto-suggest ────────────────────────────────

function LocationPicker({
  selected,
  onChange,
  maxLocations = 3,
}: {
  selected: string[];
  onChange: (locs: string[]) => void;
  maxLocations?: number;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [apiSuggestions, setApiSuggestions] = useState<string[]>([]);
  const [apiLoading, setApiLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced SerpAPI autocomplete fetch
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query || query.length < 2) { setApiSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      setApiLoading(true);
      const results = await autocompleteLocation(query);
      setApiSuggestions(results);
      setApiLoading(false);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const staticFiltered = useMemo(() =>
    LOCATION_SUGGESTIONS
      .filter((l) => !selected.includes(l.label) && l.label.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 5),
    [query, selected]
  );

  // Merge static + API results, deduplicate by lower label
  const filtered = useMemo(() => {
    const staticLabels = new Set(staticFiltered.map(l => l.label.toLowerCase()));
    const apiItems = apiSuggestions
      .filter(s => !selected.includes(s) && !staticLabels.has(s.toLowerCase()))
      .slice(0, 5)
      .map(s => ({ label: s, icon: "📍" }));
    return [...staticFiltered, ...apiItems];
  }, [staticFiltered, apiSuggestions, selected]);

  const hasCustomQuery =
    query.trim().length > 0 &&
    !filtered.some((s) => s.label.toLowerCase() === query.trim().toLowerCase()) &&
    !selected.includes(query.trim());

  const add = (label: string) => {
    if (selected.includes(label) || selected.length >= maxLocations) return;
    onChange([...selected, label]);
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  };

  const remove = (label: string) => onChange(selected.filter((l) => l !== label));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && query.trim()) {
      if (filtered.length > 0) add(filtered[0].label);
      else if (hasCustomQuery) add(query.trim());
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && !query && selected.length > 0) {
      remove(selected[selected.length - 1]);
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const quickPicks = QUICK_LOCATIONS
    .map((label) => LOCATION_SUGGESTIONS.find((s) => s.label === label)!)
    .filter((s) => s && !selected.includes(s.label));

  return (
    <div className="space-y-3">
      {/* Selected location chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((loc) => {
            const suggestion = LOCATION_SUGGESTIONS.find((s) => s.label === loc);
            return (
              <span
                key={loc}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full"
                style={{ backgroundColor: "#ECFFE0", border: "1px solid rgba(0,240,160,0.3)", color: "#0A0A0A" }}
              >
                {suggestion?.icon} {loc}
                <button onClick={() => remove(loc)} style={{ color: "#888" }}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Search input */}
      {selected.length < maxLocations && (
        <div className="relative" ref={containerRef}>
          <div
            className="flex items-center gap-2 px-4 py-3 rounded-xl transition-all"
            style={{
              border: open ? "1.5px solid #00F0A0" : "1.5px solid #E0E0E0",
              backgroundColor: "#F8F9FA",
            }}
          >
            <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: "#888" }} />
            <input
              ref={inputRef}
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: "#0A0A0A" }}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder={selected.length === 0 ? "Start typing for location suggestions…" : "Add another location…"}
            />
            {query && (
              <button onClick={() => { setQuery(""); inputRef.current?.focus(); }}>
                <X className="w-4 h-4" style={{ color: "#AAA" }} />
              </button>
            )}
          </div>

          {/* Dropdown */}
          {open && (filtered.length > 0 || hasCustomQuery || apiLoading) && (
            <div
              className="absolute z-20 left-0 right-0 mt-1 rounded-xl shadow-lg overflow-hidden"
              style={{ backgroundColor: "#fff", border: "1px solid #E0E0E0", maxHeight: "40vh", overflowY: "auto" }}
            >
              {filtered.map(({ label, icon }) => (
                <button
                  key={label}
                  onMouseDown={(e) => { e.preventDefault(); add(label); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors"
                  style={{ color: "#0A0A0A" }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#F0FFF8"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; }}
                >
                  <span className="text-base">{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
              {apiLoading && filtered.length === 0 && (
                <div className="flex items-center gap-2 px-4 py-3 text-sm" style={{ color: "#999" }}>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Searching…
                </div>
              )}
              {hasCustomQuery && (
                <button
                  onMouseDown={(e) => { e.preventDefault(); add(query.trim()); }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm"
                  style={{ color: "#00c447", borderTop: filtered.length > 0 ? "1px solid #F0F0F0" : "none" }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#F0FFF8"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; }}
                >
                  <Plus className="w-3.5 h-3.5" /> Add "{query.trim()}"
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Quick-pick buttons */}
      {quickPicks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {quickPicks.map(({ label, icon }) => (
            <button
              key={label}
              onClick={() => add(label)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium transition-all"
              style={{ backgroundColor: "#F0F0F0", color: "#555", border: "1px solid #E0E0E0" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#ECFFE0"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#F0F0F0"; }}
            >
              {icon} {label}
            </button>
          ))}
        </div>
      )}

      {selected.length >= maxLocations && (
        <p className="text-xs" style={{ color: "#888" }}>Max {maxLocations} locations selected</p>
      )}
    </div>
  );
}

// ── Step 1: Career Vault ──────────────────────────────────────────────────────

function DirectJobLinksPanel({ enabled, credits, onBuyCredits, onJobsFetched }: { enabled: boolean; credits: CreditBalance | null; onBuyCredits: () => void; onJobsFetched: (jobs: JobResult[]) => void }) {
  const MAX_CUSTOM_URLS = 50;
  const [urlInput, setUrlInput] = useState("");
  const [urlFetchStates, setUrlFetchStates] = useState<Record<string, { status: "loading" | "done" | "error"; error?: string }>>({});
  const [urlFetching, setUrlFetching] = useState(false);
  const [error, setError] = useState("");
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const urlLines = urlInput
    .split(/[\n,]+/)
    .map(u => u.trim())
    .filter(u => /^https?:\/\//i.test(u))
    .slice(0, MAX_CUSTOM_URLS);

  const handleFetchUrls = async () => {
    if (!enabled) {
      setError("Upload and parse your resume first.");
      return;
    }
    if (urlLines.length === 0 || urlFetching) return;
    setError("");
    setUrlFetching(true);
    const initStates: Record<string, { status: "loading" | "done" | "error"; error?: string }> = {};
    urlLines.forEach(u => { initStates[u] = { status: "loading" }; });
    setUrlFetchStates(initStates);

    const fetchedJobs: JobResult[] = [];
    await Promise.all(urlLines.map(async (url) => {
      try {
        const job = await fetchJobFromUrl(url);
        fetchedJobs.push(job);
        setUrlFetchStates(prev => ({ ...prev, [url]: { status: "done" } }));
      } catch (err) {
        setUrlFetchStates(prev => ({
          ...prev,
          [url]: { status: "error", error: err instanceof Error ? err.message : "Failed to fetch" },
        }));
      }
    }));
    setUrlFetching(false);

    if (fetchedJobs.length === 0) {
      setError("No valid jobs were fetched from those URLs.");
      return;
    }
    if (credits && credits.balance < fetchedJobs.length) {
      setError(`You have ${credits.balance} credit${credits.balance === 1 ? "" : "s"} but pasted ${fetchedJobs.length} job${fetchedJobs.length === 1 ? "" : "s"}. Buy credits to generate this batch.`);
      onBuyCredits();
      return;
    }
    onJobsFetched(fetchedJobs);
  };

  return (
    <div className="card-base rounded-2xl overflow-hidden h-fit">
      <button
        type="button"
        className="w-full px-4 md:px-5 py-4 flex items-center justify-between gap-2 text-left"
        style={{ backgroundColor: "#F8F9FA", borderBottom: mobileExpanded ? "1px solid #F0F0F0" : "none" }}
        onClick={() => setMobileExpanded(e => !e)}
      >
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4" style={{ color: "#00c447" }} />
          <h3 className="font-heading font-bold text-sm" style={{ color: "#0A0A0A" }}>Have job links?</h3>
          <span className="text-xs hidden md:inline" style={{ color: "#888" }}>Paste URLs to skip job search</span>
        </div>
        <ChevronDown
          className="w-4 h-4 md:hidden transition-transform"
          style={{ color: "#888", transform: mobileExpanded ? "rotate(180deg)" : "none" }}
        />
      </button>
      <div className={mobileExpanded ? "block" : "hidden md:block"}>
      <div className="p-4 md:p-5">
        <p className="text-xs mb-3" style={{ color: "#888" }}>
          Paste up to {MAX_CUSTOM_URLS} job posting URLs. We will fetch the descriptions and jump straight to Review & Confirm.
        </p>
        <textarea
          value={urlInput}
          onChange={e => setUrlInput(e.target.value)}
          disabled={!enabled || urlFetching}
          placeholder={"https://linkedin.com/jobs/view/...\nhttps://boards.greenhouse.io/company/jobs/..."}
          rows={4}
          className="w-full rounded-xl p-3 text-sm resize-y outline-none font-mono"
          style={{
            border: "1.5px solid #D0D5DD",
            color: enabled ? "#0A0A0A" : "#999",
            backgroundColor: enabled ? "white" : "#F8F9FA",
            lineHeight: 1.6,
          }}
        />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mt-3 gap-3">
          <p className="text-xs flex-1" style={{ color: "#888" }}>
            {!enabled ? "Upload a resume first" : urlLines.length > 0 ? `${urlLines.length} of ${MAX_CUSTOM_URLS} URLs ready` : "Paste one URL per line"}
          </p>
          <button
            onClick={handleFetchUrls}
            disabled={!enabled || urlLines.length === 0 || urlFetching}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all flex-shrink-0 w-full sm:w-auto"
            style={{
              backgroundColor: !enabled || urlLines.length === 0 || urlFetching ? "#F0F0F0" : "#00F0A0",
              color: !enabled || urlLines.length === 0 || urlFetching ? "#999" : "#0A0A0A",
              cursor: !enabled || urlLines.length === 0 || urlFetching ? "not-allowed" : "pointer",
            }}
          >
            {urlFetching ? <><Loader2 className="w-4 h-4 animate-spin" />Fetching…</> : <><ArrowRight className="w-4 h-4" />Fetch jobs and tailor</>}
          </button>
        </div>
        {error && <p className="text-xs mt-3" style={{ color: "#DC2626" }}>{error}</p>}
        {Object.keys(urlFetchStates).length > 0 && (
          <div className="mt-3 space-y-1.5">
            {Object.entries(urlFetchStates).map(([url, st]) => (
              <div key={url} className="flex items-center gap-2 text-xs">
                {st.status === "loading" && <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" style={{ color: "#00c447" }} />}
                {st.status === "done" && <Check className="w-3 h-3 flex-shrink-0" style={{ color: "#00c447" }} />}
                {st.status === "error" && <AlertCircle className="w-3 h-3 flex-shrink-0" style={{ color: "#EF4444" }} />}
                <span className="truncate min-w-0" style={{ color: st.status === "error" ? "#EF4444" : st.status === "done" ? "#15803D" : "#555" }}>
                  {st.status === "error" ? (st.error ?? "Failed to fetch") : url.replace(/^https?:\/\//, "").slice(0, 70)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

function ParsedResumeReview({ parsed, fileName, onConfirm, onRetry }: {
  parsed: ResumeData;
  fileName: string | null;
  onConfirm: (r: ResumeData) => void;
  onRetry: () => void;
}) {
  const [contact, setContact] = useState({ ...parsed.contact });
  const [summary, setSummary] = useState(parsed.summary ?? "");
  const [skillsText, setSkillsText] = useState((parsed.skills ?? []).join(", "));
  const [experience, setExperience] = useState(
    (parsed.experience ?? []).map(e => ({ ...e, bullets: [...(e.bullets ?? [])] }))
  );
  const [education, setEducation] = useState(
    (parsed.education ?? []).map(e => ({ ...e }))
  );
  const [certifications, setCertifications] = useState<string[]>(parsed.certifications ?? []);
  const [achievements, setAchievements] = useState<string[]>(parsed.achievements ?? []);
  const [projects, setProjects] = useState(
    (parsed.projects ?? []).map(p => ({ ...p, bullets: [...(p.bullets ?? [])] }))
  );

  const handleConfirm = () => {
    const skills = skillsText.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
    onConfirm({
      contact,
      summary: summary.trim(),
      skills,
      experience,
      education,
      certifications: certifications.map(c => c.trim()).filter(Boolean),
      achievements: achievements.map(a => a.trim()).filter(Boolean),
      projects,
    });
  };

  return (
    <div className="flex-1 p-4 md:p-8 overflow-auto">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <div className="chip-mint inline-flex mb-3">Review Parsed Resume</div>
          <h1 className="font-heading font-bold text-2xl mb-1" style={{ color: "#0A0A0A" }}>Confirm your details</h1>
          <p className="text-sm" style={{ color: "#666" }}>
            {fileName ? `Parsed from "${fileName}". ` : ""}Fix anything that looks off, or add missing sections below.
          </p>
        </div>

        <div className="space-y-5">
          {/* Contact */}
          <div className="card-base p-5 rounded-2xl">
            <h3 className="font-semibold text-sm mb-3" style={{ color: "#0A0A0A" }}>Contact Information</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(["name", "phone", "email", "location", "linkedin", "github"] as const).map(field => (
                <div key={field}>
                  <label className="block text-xs font-medium mb-1 capitalize" style={{ color: "#666" }}>{field}</label>
                  <input
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                    style={{ border: "1px solid #E5E8EA", backgroundColor: "#FAFAFA", color: "#0A0A0A" }}
                    value={(contact as any)[field] ?? ""}
                    onChange={e => setContact(prev => ({ ...prev, [field]: e.target.value }))}
                    placeholder={`Your ${field}`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="card-base p-5 rounded-2xl">
            <h3 className="font-semibold text-sm mb-3" style={{ color: "#0A0A0A" }}>Professional Summary</h3>
            <textarea
              className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
              style={{ border: "1px solid #E5E8EA", backgroundColor: "#FAFAFA", color: "#0A0A0A", minHeight: 80 }}
              value={summary}
              onChange={e => setSummary(e.target.value)}
              placeholder="Brief professional summary…"
            />
          </div>

          {/* Skills */}
          <div className="card-base p-5 rounded-2xl">
            <h3 className="font-semibold text-sm mb-1" style={{ color: "#0A0A0A" }}>Skills</h3>
            <p className="text-xs mb-3" style={{ color: "#888" }}>Comma-separated list</p>
            <textarea
              className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none font-mono"
              style={{ border: "1px solid #E5E8EA", backgroundColor: "#FAFAFA", color: "#0A0A0A", minHeight: 64 }}
              value={skillsText}
              onChange={e => setSkillsText(e.target.value)}
            />
          </div>

          {/* Experience */}
          <div className="card-base p-5 rounded-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm" style={{ color: "#0A0A0A" }}>
                Experience {experience.length > 0 ? `(${experience.length} role${experience.length !== 1 ? "s" : ""})` : ""}
              </h3>
              <button
                onClick={() => setExperience(prev => [...prev, { title: "", company: "", period: "", location: "", bullets: [] }])}
                className="text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1"
                style={{ backgroundColor: "#F0FDF4", color: "#00796b", border: "1px solid #A7F3D0" }}
              >
                <Plus className="w-3 h-3" /> Add role
              </button>
            </div>
            {experience.length === 0 && (
              <p className="text-xs py-3 text-center" style={{ color: "#AAA" }}>No experience parsed — add a role above</p>
            )}
            <div className="space-y-4">
              {experience.map((exp, i) => (
                <div key={i} className="p-3 rounded-xl" style={{ backgroundColor: "#F8F9FA", border: "1px solid #EBEBEB" }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium" style={{ color: "#888" }}>Role {i + 1}</span>
                    <button
                      onClick={() => setExperience(prev => prev.filter((_, j) => j !== i))}
                      className="text-xs px-2 py-0.5 rounded"
                      style={{ color: "#EF4444", backgroundColor: "#FEF2F2" }}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                    {([
                      { key: "title", placeholder: "e.g. Senior Software Engineer" },
                      { key: "company", placeholder: "e.g. Google" },
                      { key: "period", placeholder: "e.g. Jan 2022 – Present" },
                      { key: "location", placeholder: "e.g. Remote, USA" },
                    ] as const).map(({ key, placeholder }) => (
                      <div key={key}>
                        <label className="block text-xs font-medium mb-1 capitalize" style={{ color: "#666" }}>{key}</label>
                        <input
                          className="w-full px-2 py-1.5 rounded-lg text-sm outline-none"
                          style={{ border: "1px solid #E5E8EA", backgroundColor: "#fff", color: "#0A0A0A" }}
                          value={(exp as any)[key] ?? ""}
                          placeholder={placeholder}
                          onChange={e => setExperience(prev => prev.map((x, j) => j === i ? { ...x, [key]: e.target.value } : x))}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-2">
                    {exp.bullets && exp.bullets.length > 0 && (
                      <div className="text-xs font-medium mb-1" style={{ color: "#888" }}>{exp.bullets.length} bullet{exp.bullets.length !== 1 ? "s" : ""}</div>
                    )}
                    <ul className="space-y-1">
                      {(exp.bullets ?? []).map((b, bi) => (
                        <li key={bi} className="flex gap-1">
                          <input
                            className="flex-1 px-2 py-1 rounded text-xs outline-none"
                            style={{ border: "1px solid #E5E8EA", backgroundColor: "#fff", color: "#333" }}
                            value={b}
                            onChange={e => setExperience(prev => prev.map((x, j) => j === i
                              ? { ...x, bullets: x.bullets!.map((bx, bj) => bj === bi ? e.target.value : bx) }
                              : x
                            ))}
                          />
                          <button
                            onClick={() => setExperience(prev => prev.map((x, j) => j === i
                              ? { ...x, bullets: x.bullets!.filter((_, bj) => bj !== bi) }
                              : x
                            ))}
                            className="px-1.5 rounded text-xs flex-shrink-0"
                            style={{ color: "#EF4444", backgroundColor: "#FEF2F2" }}
                          >×</button>
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={() => setExperience(prev => prev.map((x, j) => j === i ? { ...x, bullets: [...(x.bullets ?? []), ""] } : x))}
                      className="mt-1.5 text-xs font-medium"
                      style={{ color: "#00796b" }}
                    >
                      + Add bullet
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Education */}
          <div className="card-base p-5 rounded-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm" style={{ color: "#0A0A0A" }}>
                Education {education.length > 0 ? `(${education.length})` : ""}
              </h3>
              <button
                onClick={() => setEducation(prev => [...prev, { degree: "", school: "", year: "", location: "" }])}
                className="text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1"
                style={{ backgroundColor: "#F0FDF4", color: "#00796b", border: "1px solid #A7F3D0" }}
              >
                <Plus className="w-3 h-3" /> Add education
              </button>
            </div>
            {education.length === 0 && (
              <p className="text-xs py-3 text-center" style={{ color: "#AAA" }}>No education parsed — add an entry above</p>
            )}
            <div className="space-y-3">
              {education.map((edu, i) => (
                <div key={i} className="p-3 rounded-xl" style={{ backgroundColor: "#F8F9FA", border: "1px solid #EBEBEB" }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium" style={{ color: "#888" }}>Entry {i + 1}</span>
                    <button
                      onClick={() => setEducation(prev => prev.filter((_, j) => j !== i))}
                      className="text-xs px-2 py-0.5 rounded"
                      style={{ color: "#EF4444", backgroundColor: "#FEF2F2" }}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {([
                      { key: "degree", placeholder: "e.g. B.S. Computer Science" },
                      { key: "school", placeholder: "e.g. Stanford University" },
                      { key: "year", placeholder: "e.g. 2020 or 2018–2022" },
                      { key: "location", placeholder: "e.g. Stanford, CA" },
                    ] as const).map(({ key, placeholder }) => (
                      <div key={key}>
                        <label className="block text-xs font-medium mb-1 capitalize" style={{ color: "#666" }}>{key}</label>
                        <input
                          className="w-full px-2 py-1.5 rounded-lg text-sm outline-none"
                          style={{ border: "1px solid #E5E8EA", backgroundColor: "#fff", color: "#0A0A0A" }}
                          value={(edu as any)[key] ?? ""}
                          placeholder={placeholder}
                          onChange={e => setEducation(prev => prev.map((x, j) => j === i ? { ...x, [key]: e.target.value } : x))}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-2">
                    <label className="block text-xs font-medium mb-1" style={{ color: "#666" }}>Notes (GPA, honours, etc.)</label>
                    <input
                      className="w-full px-2 py-1.5 rounded-lg text-sm outline-none"
                      style={{ border: "1px solid #E5E8EA", backgroundColor: "#fff", color: "#0A0A0A" }}
                      value={edu.notes ?? ""}
                      placeholder="e.g. GPA: 3.8 · Distinction"
                      onChange={e => setEducation(prev => prev.map((x, j) => j === i ? { ...x, notes: e.target.value } : x))}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Certifications */}
          <div className="card-base p-5 rounded-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm" style={{ color: "#0A0A0A" }}>
                Certifications {certifications.length > 0 ? `(${certifications.length})` : ""}
              </h3>
              <button
                onClick={() => setCertifications(prev => [...prev, ""])}
                className="text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1"
                style={{ backgroundColor: "#F0FDF4", color: "#00796b", border: "1px solid #A7F3D0" }}
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            {certifications.length === 0 && (
              <p className="text-xs py-3 text-center" style={{ color: "#AAA" }}>No certifications parsed — add one above</p>
            )}
            <div className="space-y-2">
              {certifications.map((cert, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                    style={{ border: "1px solid #E5E8EA", backgroundColor: "#FAFAFA", color: "#0A0A0A" }}
                    value={cert}
                    placeholder="e.g. AWS Certified Solutions Architect"
                    onChange={e => setCertifications(prev => prev.map((c, j) => j === i ? e.target.value : c))}
                  />
                  <button
                    onClick={() => setCertifications(prev => prev.filter((_, j) => j !== i))}
                    className="px-2.5 rounded-lg text-sm flex-shrink-0"
                    style={{ color: "#EF4444", backgroundColor: "#FEF2F2", border: "1px solid #FECACA" }}
                  >×</button>
                </div>
              ))}
            </div>
          </div>

          {/* Projects */}
          <div className="card-base p-5 rounded-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm" style={{ color: "#0A0A0A" }}>
                Projects {projects.length > 0 ? `(${projects.length})` : ""}
              </h3>
              <button
                onClick={() => setProjects(prev => [...prev, { name: "", period: "", bullets: [] }])}
                className="text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1"
                style={{ backgroundColor: "#F0FDF4", color: "#00796b", border: "1px solid #A7F3D0" }}
              >
                <Plus className="w-3 h-3" /> Add project
              </button>
            </div>
            {projects.length === 0 && (
              <p className="text-xs py-3 text-center" style={{ color: "#AAA" }}>No projects parsed — add one above</p>
            )}
            <div className="space-y-4">
              {projects.map((proj, i) => (
                <div key={i} className="p-3 rounded-xl" style={{ backgroundColor: "#F8F9FA", border: "1px solid #EBEBEB" }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium" style={{ color: "#888" }}>Project {i + 1}</span>
                    <button
                      onClick={() => setProjects(prev => prev.filter((_, j) => j !== i))}
                      className="text-xs px-2 py-0.5 rounded"
                      style={{ color: "#EF4444", backgroundColor: "#FEF2F2" }}
                    >Remove</button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "#666" }}>Name / URL</label>
                      <input
                        className="w-full px-2 py-1.5 rounded-lg text-sm outline-none"
                        style={{ border: "1px solid #E5E8EA", backgroundColor: "#fff", color: "#0A0A0A" }}
                        value={proj.name}
                        placeholder="e.g. thinkinglegends.com"
                        onChange={e => setProjects(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "#666" }}>Period</label>
                      <input
                        className="w-full px-2 py-1.5 rounded-lg text-sm outline-none"
                        style={{ border: "1px solid #E5E8EA", backgroundColor: "#fff", color: "#0A0A0A" }}
                        value={proj.period ?? ""}
                        placeholder="e.g. 2024 – Present"
                        onChange={e => setProjects(prev => prev.map((x, j) => j === i ? { ...x, period: e.target.value } : x))}
                      />
                    </div>
                  </div>
                  <ul className="space-y-1">
                    {(proj.bullets ?? []).map((b, bi) => (
                      <li key={bi} className="flex gap-1">
                        <input
                          className="flex-1 px-2 py-1 rounded text-xs outline-none"
                          style={{ border: "1px solid #E5E8EA", backgroundColor: "#fff", color: "#333" }}
                          value={b}
                          onChange={e => setProjects(prev => prev.map((x, j) => j === i
                            ? { ...x, bullets: x.bullets!.map((bx, bj) => bj === bi ? e.target.value : bx) }
                            : x
                          ))}
                        />
                        <button
                          onClick={() => setProjects(prev => prev.map((x, j) => j === i
                            ? { ...x, bullets: x.bullets!.filter((_, bj) => bj !== bi) }
                            : x
                          ))}
                          className="px-1.5 rounded text-xs flex-shrink-0"
                          style={{ color: "#EF4444", backgroundColor: "#FEF2F2" }}
                        >×</button>
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => setProjects(prev => prev.map((x, j) => j === i ? { ...x, bullets: [...(x.bullets ?? []), ""] } : x))}
                    className="mt-1.5 text-xs font-medium"
                    style={{ color: "#00796b" }}
                  >+ Add bullet</button>
                </div>
              ))}
            </div>
          </div>

          {/* Achievements */}
          <div className="card-base p-5 rounded-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm" style={{ color: "#0A0A0A" }}>
                Achievements {achievements.length > 0 ? `(${achievements.length})` : ""}
              </h3>
              <button
                onClick={() => setAchievements(prev => [...prev, ""])}
                className="text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1"
                style={{ backgroundColor: "#F0FDF4", color: "#00796b", border: "1px solid #A7F3D0" }}
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            {achievements.length === 0 && (
              <p className="text-xs py-3 text-center" style={{ color: "#AAA" }}>No achievements parsed — add one above</p>
            )}
            <div className="space-y-2">
              {achievements.map((ach, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                    style={{ border: "1px solid #E5E8EA", backgroundColor: "#FAFAFA", color: "#0A0A0A" }}
                    value={ach}
                    placeholder="e.g. Led team that increased revenue by 40%"
                    onChange={e => setAchievements(prev => prev.map((a, j) => j === i ? e.target.value : a))}
                  />
                  <button
                    onClick={() => setAchievements(prev => prev.filter((_, j) => j !== i))}
                    className="px-2.5 rounded-lg text-sm flex-shrink-0"
                    style={{ color: "#EF4444", backgroundColor: "#FEF2F2", border: "1px solid #FECACA" }}
                  >×</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button className="btn-dark" onClick={handleConfirm}>
            Looks good — Continue
          </button>
          <button
            className="px-4 py-2 rounded-xl text-sm font-medium"
            style={{ backgroundColor: "#F2F4F5", color: "#555" }}
            onClick={onRetry}
          >
            Re-upload
          </button>
        </div>
      </div>
    </div>
  );
}

function Step1Vault({ resume, savedData, savedVersions, credits, onBuyCredits, onParsed, onClear, onDeleteVersion, onNext, onDirectJobs, onUpdateResume }: {
  resume: ResumeData;
  savedData: SavedResumeData | null;
  savedVersions: SavedVersion[];
  credits: CreditBalance | null;
  onBuyCredits: () => void;
  onParsed: (r: ResumeData, recs: SavedResumeData["recommendations"], fileName: string | null) => void;
  onClear: () => void;
  onDeleteVersion: (id: string) => void;
  onNext: (titles: string[], locations: string[]) => void;
  onDirectJobs: (jobs: JobResult[]) => void;
  onUpdateResume: (r: ResumeData) => void;
}) {
  const [uploaded, setUploaded] = useState(savedData !== null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("Parsing resume…");
  const [dragging, setDragging] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(savedData?.fileName ?? null);
  const [selectedTitles, setSelectedTitles] = useState<Set<string>>(
    new Set((savedData?.recommendations ?? RESUME_RECOMMENDATIONS).titles.slice(0, 3).map(t => t.title))
  );
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [recommendations, setRecommendations] = useState<ParsedResumeResult["recommendations"]>(
    savedData?.recommendations ?? RESUME_RECOMMENDATIONS
  );
  const [customTitleInput, setCustomTitleInput] = useState("");
  const [roleSuggestionsOpen, setRoleSuggestionsOpen] = useState(false);
  const [previewingVersionId, setPreviewingVersionId] = useState<string | null>(null);
  const [deletingVersionId, setDeletingVersionId] = useState<string | null>(null);
  const [downloadingVersion, setDownloadingVersion] = useState<{ id: string; format: "pdf" | "docx" } | null>(null);
  const [reviewing, setReviewing] = useState<{ resume: ResumeData; recommendations: ParsedResumeResult["recommendations"]; fileName: string | null } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["pdf", "docx", "txt"].includes(ext)) {
      setParseError(`Unsupported format ".${ext}". Please use a PDF, DOCX, or TXT file.`);
      return;
    }
    setParseError(null);
    setLoading(true);
    setFileName(file.name);
    setLoadingMsg("Extracting text from your resume…");
    try {
      setLoadingMsg("AI is parsing your resume…");
      const result = await parseResume(file);
      // Show review step before committing to vault
      setReviewing({ resume: result.resume, recommendations: result.recommendations, fileName: file.name });
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Resume parsing failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const confirmParsed = (editedResume: ResumeData) => {
    if (!reviewing) return;
    if (uploaded) {
      // Re-editing an already-confirmed resume — just update the data, preserve title/location selections
      onUpdateResume(editedResume);
      setReviewing(null);
    } else {
      onParsed(editedResume, reviewing.recommendations, reviewing.fileName);
      setRecommendations(reviewing.recommendations);
      setSelectedTitles(new Set(reviewing.recommendations.titles.slice(0, 3).map(t => t.title)));
      setSelectedLocations([]);
      setReviewing(null);
      setUploaded(true);
    }
  };

  const handleClearAndReupload = () => {
    onClear();
    setUploaded(false);
    setFileName(null);
    setParseError(null);
    setRecommendations(RESUME_RECOMMENDATIONS);
    setSelectedTitles(new Set(RESUME_RECOMMENDATIONS.titles.slice(0, 3).map(t => t.title)));
    setSelectedLocations([]);
  };

  const toggleTitle = (t: string) => setSelectedTitles(prev => { const s = new Set(prev); s.has(t) ? s.delete(t) : s.add(t); return s; });
  const addCustomTitle = () => {
    const value = customTitleInput.trim();
    if (!value) return;
    setSelectedTitles(prev => new Set(prev).add(value));
    setCustomTitleInput("");
  };
  const recommendedTitleSet = new Set(recommendations.titles.map(t => t.title));
  const customTitles = Array.from(selectedTitles).filter(title => !recommendedTitleSet.has(title));
  const allRoleSuggestions = useMemo(() => {
    const titles = [
      ...recommendations.titles.map(t => t.title),
      ...ROLE_SUGGESTIONS,
    ];
    return Array.from(new Set(titles));
  }, [recommendations.titles]);
  const [roleApiSuggestions, setRoleApiSuggestions] = useState<string[]>([]);
  const [roleApiLoading, setRoleApiLoading] = useState(false);
  const roleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (roleDebounceRef.current) clearTimeout(roleDebounceRef.current);
    const q = customTitleInput.trim();
    if (!q || q.length < 2) { setRoleApiSuggestions([]); return; }
    roleDebounceRef.current = setTimeout(async () => {
      const localCount = allRoleSuggestions.filter(t => t.toLowerCase().includes(q.toLowerCase())).length;
      if (localCount >= 4) { setRoleApiSuggestions([]); return; }
      setRoleApiLoading(true);
      const results = await autocompleteRole(q);
      setRoleApiSuggestions(results);
      setRoleApiLoading(false);
    }, 400);
    return () => { if (roleDebounceRef.current) clearTimeout(roleDebounceRef.current); };
  }, [customTitleInput, allRoleSuggestions]);

  const roleSuggestions = useMemo(() => {
    const q = customTitleInput.trim().toLowerCase();
    const staticMatches = q
      ? allRoleSuggestions.filter(title => !selectedTitles.has(title) && title.toLowerCase().includes(q)).slice(0, 5)
      : allRoleSuggestions.filter(title => !selectedTitles.has(title)).slice(0, 8);
    if (!q) return staticMatches;
    const staticSet = new Set(staticMatches.map(t => t.toLowerCase()));
    const apiItems = roleApiSuggestions
      .filter(t => !selectedTitles.has(t) && !staticSet.has(t.toLowerCase()))
      .slice(0, 4);
    return [...staticMatches, ...apiItems];
  }, [allRoleSuggestions, customTitleInput, selectedTitles, roleApiSuggestions]);
  const addRoleSuggestion = (title: string) => {
    setSelectedTitles(prev => new Set(prev).add(title));
    setCustomTitleInput("");
    setRoleSuggestionsOpen(false);
  };
  const savedVersionJob = (version: SavedVersion): JobResult => ({
    id: version.sourceJobId ?? version.id,
    title: version.jobTitle,
    company: version.jobCompany,
    location: version.job?.location ?? "",
    via: "Saved resume",
    description: version.job?.description ?? "",
    highlights: version.job?.highlights ?? [],
    postedAt: "",
    salary: null,
    remote: false,
    scheduleType: "",
    applyLink: version.job && "applyLink" in version.job ? version.job.applyLink ?? null : null,
    source: "custom",
  });
  const downloadSavedVersion = async (version: SavedVersion, format: "pdf" | "docx") => {
    setDownloadingVersion({ id: version.id, format });
    try {
      const job = savedVersionJob(version);
      if (format === "pdf") await handlePdfDownload(version.resume, job);
      else await handleDocxDownload(version.resume, job);
    } finally {
      setDownloadingVersion(null);
    }
  };

  if (reviewing) {
    return (
      <ParsedResumeReview
        parsed={reviewing.resume}
        fileName={reviewing.fileName}
        onConfirm={confirmParsed}
        onRetry={() => { setReviewing(null); if (!uploaded) setFileName(null); }}
      />
    );
  }

  return (
    <div className="flex-1 p-3 sm:p-4 md:p-8 overflow-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-5 md:mb-8">
          <div className="chip-mint inline-flex mb-2 md:mb-3">Step 1 of 4</div>
          <h1 className="font-heading font-bold text-xl sm:text-2xl md:text-3xl mb-1 md:mb-2" style={{ color: "#0A0A0A" }}>Career Vault</h1>
          <p className="text-base" style={{ color: "#666" }}>Upload your resume, confirm target roles and locations, then search live postings matched to your experience.</p>
        </div>

        {!uploaded ? (
          <div className="grid sm:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
              <div className="rounded-2xl p-6 md:p-10 flex flex-col items-center justify-center text-center transition-all cursor-pointer"
                style={{ backgroundColor: dragging ? "#ECFFE0" : "#fff", border: `2px dashed ${dragging ? "#00F0A0" : "#D0D5DD"}`, minHeight: 280 }}
                onDragEnter={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
                onClick={() => !loading && fileInputRef.current?.click()}
              >
                {loading ? (
                  <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-10 h-10 animate-spin" style={{ color: "#00F0A0" }} />
                    <div>
                      <p className="font-semibold" style={{ color: "#0A0A0A" }}>{loadingMsg}</p>
                      <p className="text-sm mt-1" style={{ color: "#888" }}>This takes 5–15 seconds</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5" style={{ backgroundColor: "#ECFFE0" }}>
                      <Upload className="w-7 h-7" style={{ color: "#00c447" }} />
                    </div>
                    <p className="font-heading font-bold text-lg mb-2" style={{ color: "#0A0A0A" }}>Drop your existing resume</p>
                    <p className="text-sm mb-5" style={{ color: "#888" }}>or click to browse your files</p>
                    <div className="flex gap-2">
                      {[".pdf", ".docx", ".txt"].map(f => <span key={f} className="text-xs font-mono px-2 py-1 rounded" style={{ backgroundColor: "#F0F0F0", color: "#555" }}>{f}</span>)}
                    </div>
                  </>
                )}
              </div>
              {parseError && (
                <div className="mt-3 p-3 rounded-xl flex items-start gap-2" style={{ backgroundColor: "#FEE2E2", border: "1px solid #FCA5A5" }}>
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#EF4444" }} />
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "#991B1B" }}>{parseError}</p>
                    <button className="text-xs mt-1 underline" style={{ color: "#991B1B" }}
                      onClick={() => { setParseError(null); fileInputRef.current?.click(); }}>Try again</button>
                  </div>
                </div>
              )}
              <div className="mt-4 text-center">
                <button className="text-xs underline" style={{ color: "#888" }}
                  onClick={() => {
                    onParsed(ALEX, RESUME_RECOMMENDATIONS, "demo_resume.pdf");
                    setRecommendations(RESUME_RECOMMENDATIONS);
                    setSelectedTitles(new Set(RESUME_RECOMMENDATIONS.titles.slice(0, 3).map(t => t.title)));
                    setSelectedLocations([]);
                    setUploaded(true);
                    setFileName("demo_resume.pdf");
                  }}>
                  Skip upload — use demo resume
                </button>
              </div>
            </div>
            <DirectJobLinksPanel enabled={uploaded} credits={credits} onBuyCredits={onBuyCredits} onJobsFetched={onDirectJobs} />
          </div>
        ) : (
          <div className="animate-fade-in space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center p-4 rounded-2xl gap-3" style={{ backgroundColor: "#ECFFE0", border: "1px solid rgba(0,240,160,0.3)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#00F0A0" }}>
                <Shield className="w-5 h-5" style={{ color: "#0A0A0A" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm" style={{ color: "#0A0A0A" }}>Career Vault ready — resume parsed</p>
                <p className="text-xs truncate" style={{ color: "#555" }}>{fileName ?? "resume"} · Confirm job targets below, then search for live postings</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 self-start sm:self-auto">
                <button className="text-xs font-semibold underline" style={{ color: "#005A3D" }}
                  onClick={() => setReviewing({ resume, recommendations, fileName })}>Edit details</button>
                <button className="text-xs font-semibold underline" style={{ color: "#555" }}
                  onClick={handleClearAndReupload}>Clear &amp; re-upload</button>
              </div>
            </div>

            <div className="mb-5">
              <DirectJobLinksPanel enabled={uploaded} credits={credits} onBuyCredits={onBuyCredits} onJobsFetched={onDirectJobs} />
            </div>

            <div className="grid md:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.75fr)] gap-3 md:gap-5">
              <div className="card-base rounded-2xl order-2 md:order-1">
                <div className="px-4 md:px-5 py-4 flex flex-wrap items-center gap-2 rounded-t-2xl" style={{ backgroundColor: "#F8F9FA", borderBottom: "1px solid #F0F0F0" }}>
                  <Sparkles className="w-4 h-4" style={{ color: "#00c447" }} />
                  <h3 className="font-heading font-bold text-sm" style={{ color: "#0A0A0A" }}>Recommended job titles</h3>
                  <span className="text-xs md:ml-1" style={{ color: "#888" }}>Inferred from your resume. Select targets.</span>
                </div>
                <div className="p-4 md:p-5 space-y-2">
                  {recommendations.titles.map(({ title, reason }) => {
                    const isSel = selectedTitles.has(title);
                    return (
                      <button key={title} onClick={() => toggleTitle(title)}
                        className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all text-left"
                        style={{ backgroundColor: isSel ? "#ECFFE0" : "#FAFAFA", border: `1.5px solid ${isSel ? "rgba(0,240,160,0.5)" : "#E5E8EA"}` }}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all" style={{ backgroundColor: isSel ? "#00F0A0" : "#E5E8EA" }}>
                            {isSel && <Check className="w-3 h-3" style={{ color: "#0A0A0A" }} />}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold" style={{ color: "#0A0A0A" }}>{title}</p>
                            <p className="text-xs truncate" style={{ color: "#888" }}>{reason}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {customTitles.map(title => (
                    <button key={title} onClick={() => toggleTitle(title)}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all text-left"
                      style={{ backgroundColor: "#ECFFE0", border: "1.5px solid rgba(0,240,160,0.5)" }}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#00F0A0" }}>
                          <Check className="w-3 h-3" style={{ color: "#0A0A0A" }} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold" style={{ color: "#0A0A0A" }}>{title}</p>
                          <p className="text-xs truncate" style={{ color: "#888" }}>Custom target role</p>
                        </div>
                      </div>
                      <X className="w-4 h-4 flex-shrink-0" style={{ color: "#888" }} />
                    </button>
                  ))}
                  <div className="flex flex-row items-center gap-2 pt-2">
                    <div className="relative flex-1">
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ border: roleSuggestionsOpen ? "1.5px solid #00F0A0" : "1.5px dashed #D0D5DD", backgroundColor: "#F8F9FA" }}>
                      <input
                        className="bg-transparent text-sm outline-none flex-1 min-w-0"
                        style={{ color: "#0A0A0A" }}
                        placeholder="Start typing for role suggestions..."
                        value={customTitleInput}
                        onChange={e => { setCustomTitleInput(e.target.value); setRoleSuggestionsOpen(true); }}
                        onFocus={() => setRoleSuggestionsOpen(true)}
                        onBlur={() => window.setTimeout(() => setRoleSuggestionsOpen(false), 120)}
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (roleSuggestions.length > 0) addRoleSuggestion(roleSuggestions[0]);
                            else addCustomTitle();
                          } else if (e.key === "Escape") {
                            setRoleSuggestionsOpen(false);
                          }
                        }}
                      />
                      {roleApiLoading && <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" style={{ color: "#00c447" }} />}
                      </div>
                      {roleSuggestionsOpen && (roleSuggestions.length > 0 || customTitleInput.trim()) && (
                        <div className="absolute z-50 left-0 right-0 mt-1 rounded-xl shadow-lg overflow-hidden" style={{ backgroundColor: "#fff", border: "1px solid #E0E0E0", maxHeight: "40vh", overflowY: "auto" }}>
                          {roleSuggestions.map(title => (
                            <button
                              key={title}
                              type="button"
                              onMouseDown={e => { e.preventDefault(); addRoleSuggestion(title); }}
                              className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-left transition-colors"
                              style={{ color: "#0A0A0A" }}
                              onMouseEnter={e => { e.currentTarget.style.backgroundColor = "#F0FFF8"; }}
                              onMouseLeave={e => { e.currentTarget.style.backgroundColor = ""; }}
                            >
                              <span>{title}</span>
                              {recommendedTitleSet.has(title) && <span className="text-[11px] font-semibold" style={{ color: "#00c447" }}>Recommended</span>}
                            </button>
                          ))}
                          {customTitleInput.trim() && !allRoleSuggestions.some(title => title.toLowerCase() === customTitleInput.trim().toLowerCase()) && (
                            <button
                              type="button"
                              onMouseDown={e => { e.preventDefault(); addCustomTitle(); setRoleSuggestionsOpen(false); }}
                              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm"
                              style={{ color: "#00c447", borderTop: roleSuggestions.length > 0 ? "1px solid #F0F0F0" : "none" }}
                              onMouseEnter={e => { e.currentTarget.style.backgroundColor = "#F0FFF8"; }}
                              onMouseLeave={e => { e.currentTarget.style.backgroundColor = ""; }}
                            >
                              <Plus className="w-3.5 h-3.5" /> Add "{customTitleInput.trim()}"
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={addCustomTitle}
                      disabled={!customTitleInput.trim()}
                      className="flex items-center justify-center gap-1 text-sm font-semibold rounded-xl flex-shrink-0"
                      style={{ backgroundColor: customTitleInput.trim() ? "#0A0A0A" : "#E5E8EA", color: customTitleInput.trim() ? "#fff" : "#999", width: 44, height: 44, border: `1.5px solid ${customTitleInput.trim() ? "transparent" : "#D0D5DD"}` }}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Right column: Preferred locations + Search (appears first on mobile) */}
              <div className="card-base rounded-2xl p-4 md:p-5 flex flex-col gap-4 order-1 md:order-2">
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: "#888" }}>Preferred location(s)</p>
                  <LocationPicker selected={selectedLocations} onChange={setSelectedLocations} maxLocations={3} />
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-xs" style={{ color: "#888" }}>
                    {selectedTitles.size} title{selectedTitles.size !== 1 ? "s" : ""} selected
                    {selectedLocations.length > 0 ? ` · ${selectedLocations.join(", ")}` : ""}
                  </p>
                  <button className="btn-mint text-sm w-full" disabled={selectedTitles.size === 0}
                    onClick={() => onNext(Array.from(selectedTitles), selectedLocations)}
                    style={{ opacity: selectedTitles.size === 0 ? 0.4 : 1 }}
                  ><Search className="w-4 h-4" /> Search live jobs <ArrowRight className="w-4 h-4" /></button>
                </div>
              </div>
            </div>

            <GapSuggestionPanel
              resume={resume}
              onAddExperience={(entry) => {
                const updated = {
                  ...resume,
                  experience: [entry, ...(resume.experience ?? [])],
                };
                onUpdateResume(updated);
              }}
            />
          </div>
        )}

        {savedVersions.length > 0 && (
          <div className="mt-10">
            <div className="flex items-center gap-2 mb-4">
              <BookmarkCheck className="w-5 h-5" style={{ color: "#00c447" }} />
              <h2 className="font-heading font-bold text-lg" style={{ color: "#0A0A0A" }}>My Resumes</h2>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: "#ECFFE0", color: "#005A3D" }}>{savedVersions.length}</span>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {savedVersions.map(version => {
                const isPreviewing = previewingVersionId === version.id;
                const isDeleting = deletingVersionId === version.id;
                const savedDate = new Date(version.savedAt);
                const dateStr = savedDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: savedDate.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
                return (
                  <div key={version.id} className="card-base rounded-2xl overflow-hidden">
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate" style={{ color: "#0A0A0A" }}>{version.name}</p>
                          <p className="text-xs mt-0.5" style={{ color: "#888" }}>{version.jobTitle} @ {version.jobCompany} · {dateStr}</p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => { void downloadSavedVersion(version, "docx"); }}
                            disabled={downloadingVersion?.id === version.id}
                            className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-full transition-all"
                            title="Download DOCX"
                            style={{ backgroundColor: "#ECFFE0", color: "#005A3D", opacity: downloadingVersion?.id === version.id ? 0.55 : 1 }}
                          >
                            {downloadingVersion?.id === version.id && downloadingVersion.format === "docx" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                            DOCX
                          </button>
                          <button
                            onClick={() => { void downloadSavedVersion(version, "pdf"); }}
                            disabled={downloadingVersion?.id === version.id}
                            className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-full transition-all"
                            title="Download PDF"
                            style={{ backgroundColor: "#F0F0F0", color: "#444", opacity: downloadingVersion?.id === version.id ? 0.55 : 1 }}
                          >
                            {downloadingVersion?.id === version.id && downloadingVersion.format === "pdf" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                            PDF
                          </button>
                          <button
                            onClick={() => setPreviewingVersionId(isPreviewing ? null : version.id)}
                            className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-full transition-all"
                            style={{ backgroundColor: isPreviewing ? "#0A0A0A" : "#F0F0F0", color: isPreviewing ? "#fff" : "#444" }}
                          >
                            {isPreviewing ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            {isPreviewing ? "Hide" : "View"}
                          </button>
                          {isDeleting ? (
                            <div className="flex items-center gap-1">
                              <button onClick={() => { onDeleteVersion(version.id); setDeletingVersionId(null); if (isPreviewing) setPreviewingVersionId(null); }}
                                className="text-xs font-semibold px-2 py-1 rounded-full" style={{ backgroundColor: "#FEE2E2", color: "#991B1B" }}>Delete</button>
                              <button onClick={() => setDeletingVersionId(null)} className="text-xs px-2 py-1 rounded-full" style={{ backgroundColor: "#F0F0F0", color: "#555" }}>Cancel</button>
                            </div>
                          ) : (
                            <button onClick={() => setDeletingVersionId(version.id)} className="p-1.5 rounded-full transition-all"
                              style={{ color: "#CCC" }}
                              onMouseEnter={e => { e.currentTarget.style.color = "#EF4444"; e.currentTarget.style.backgroundColor = "#FEE2E2"; }}
                              onMouseLeave={e => { e.currentTarget.style.color = "#CCC"; e.currentTarget.style.backgroundColor = "transparent"; }}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    {isPreviewing && (
                      <div style={{ borderTop: "1px solid #F0F0F0", padding: "0 16px 16px" }}>
                        <div style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.08)", borderRadius: 8, marginTop: 12 }}>
                          <ResumePreview resume={version.resume} jobTitle={version.jobTitle} jobCompany={version.jobCompany} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Step 2: Job Discovery ─────────────────────────────────────────────────────

const TIME_FILTERS = [
  { label: "24 hr",   maxHours: 24 },
  { label: "3 days",  maxHours: 72 },
  { label: "7 days",  maxHours: 168 },
  { label: "14 days", maxHours: 336 },
  { label: "30 days", maxHours: 720 },
] as const;

const FEATURED_PLATFORMS = ["LinkedIn", "Indeed", "Glassdoor", "Monster", "Dice", "ZipRecruiter"] as const;

function normalizePlatformLabel(via: string) {
  let label = (via || "Other")
    .replace(/^via\s+/i, "")
    // Strip "- SomeName" suffix after a domain-looking token
    .replace(/[a-z0-9-]+\.[a-z]{2,}[^\s]*\s*[-–|]\s*/gi, "")
    // Strip bare domain-looking tokens (e.g. "frontendnode-production.up.railway.app")
    .replace(/\b[a-z0-9-]+\.(?:com|app|io|co|net|org|ai|jobs)\b/gi, "")
    // Collapse pipes/dashes left behind
    .replace(/\s*[|–-]+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  // Truncate very long labels
  if (label.length > 24) label = label.slice(0, 22).trim() + "…";
  return label || "Other";
}

function parsePostedAtHours(postedAt: string): number {
  const s = (postedAt ?? "").toLowerCase();
  const m = s.match(/(\d+)\+?\s*(minute|min|hour|hr|day|week|month)/);
  if (!m) return s.includes("recent") ? 0 : Infinity; // "Recently" → treat as brand-new; other unknowns → exclude
  const n = Number(m[1]);
  if (m[2].startsWith("minute") || m[2].startsWith("min")) return n / 60;
  if (m[2].startsWith("hour") || m[2].startsWith("hr"))    return n;
  if (m[2].startsWith("day"))   return n * 24;
  if (m[2].startsWith("week"))  return n * 24 * 7;
  if (m[2].startsWith("month")) return n * 24 * 30;
  return 0;
}

const SEARCH_FETCH_FALLBACK_SIZE = 100;
const JOBS_PER_PAGE = 50;

// Map a time-filter label to the SerpAPI dateFilter value for coarse buckets.
// Returns undefined for fine buckets handled purely client-side via postedAt parsing.
// "10 days" is intentionally client-side only: SerpAPI has no matching chip and
// mapping it to "3days" would exclude 4–10 day postings.
function getServerDateFilter(label: string | null): string | undefined {
  if (!label) return undefined;
  if (label === "3 days") return "3days";
  if (label === "7 days") return "week";
  if (label === "14 days") return "week";
  if (label === "30 days") return "month";
  return undefined; // 24 hr → client-side only
}

// ── Match-score helpers ───────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the","and","for","are","but","not","you","all","any","can","had","her",
  "was","one","our","out","day","get","has","him","his","how","its","let",
  "may","new","now","old","see","two","way","who","did","man","men","end",
  "few","got","too","via","with","that","this","will","have","from","they",
  "been","some","than","then","them","when","your","more","also","into",
  "over","such","both","each","made","well","were","what","said","work",
  "year","team","able","based","build","built","using","must","role","join",
  "help","across","within","about","their","there","would","could","other",
  "these","those","years","looking","strong","great","good","including",
  "required","ability","we","our","com","www","https","http","use","used",
  "high","key","highly","plus","top","at","in","of","to","an","a","is","as",
  "or","be","by","on","up","if","no","so","do","we","me","it","us",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9#+]/g)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t));
}

function computeMatchScore(job: JobResult, resume: ResumeData): number {
  const resumeTokens = new Set<string>();

  resume.skills?.forEach(s => tokenize(s).forEach(t => resumeTokens.add(t)));
  resume.experience?.forEach(e => {
    tokenize(e.title).forEach(t => resumeTokens.add(t));
    e.bullets?.forEach(b => tokenize(b).forEach(t => resumeTokens.add(t)));
  });
  if (resume.summary) tokenize(resume.summary).forEach(t => resumeTokens.add(t));
  resume.certifications?.forEach(c => tokenize(c).forEach(t => resumeTokens.add(t)));

  const jobTokens = new Set<string>();
  tokenize(job.title).forEach(t => jobTokens.add(t));
  tokenize(job.description ?? "").forEach(t => jobTokens.add(t));
  job.highlights.forEach(h => h.items.forEach(item => tokenize(item).forEach(t => jobTokens.add(t))));

  if (jobTokens.size === 0) return 0;

  let matches = 0;
  jobTokens.forEach(t => { if (resumeTokens.has(t)) matches++; });

  return Math.min(99, Math.round((matches / jobTokens.size) * 100));
}

function computeSkillGap(job: JobResult, resume: ResumeData): { matched: string[]; missing: string[] } {
  const resumeTokens = new Set<string>();
  resume.skills?.forEach(s => tokenize(s).forEach(t => resumeTokens.add(t)));
  resume.experience?.forEach(e => {
    tokenize(e.title).forEach(t => resumeTokens.add(t));
    e.bullets?.forEach(b => tokenize(b).forEach(t => resumeTokens.add(t)));
  });
  if (resume.summary) tokenize(resume.summary).forEach(t => resumeTokens.add(t));
  resume.certifications?.forEach(c => tokenize(c).forEach(t => resumeTokens.add(t)));

  const jobTokens = new Set<string>();
  tokenize(job.title).forEach(t => jobTokens.add(t));
  tokenize(job.description ?? "").forEach(t => jobTokens.add(t));
  job.highlights.forEach(h => h.items.forEach(item => tokenize(item).forEach(t => jobTokens.add(t))));

  const matched: string[] = [];
  resume.skills?.forEach(skill => {
    const skillTokens = tokenize(skill);
    if (skillTokens.length > 0 && skillTokens.some(t => jobTokens.has(t))) {
      matched.push(skill);
    }
  });

  const missing: string[] = [];
  jobTokens.forEach(t => {
    if (t.length >= 3 && !resumeTokens.has(t)) {
      missing.push(t.charAt(0).toUpperCase() + t.slice(1));
    }
  });

  return { matched: matched.slice(0, 10), missing: missing.slice(0, 10) };
}

function MatchBadge({ score }: { score: number }) {
  const { color, bg, label } =
    score >= 75 ? { color: "#00c447", bg: "#ECFFE0", label: "Strong" } :
    score >= 55 ? { color: "#D97706", bg: "#FEF3C7", label: "Good" } :
    score >= 35 ? { color: "#EA580C", bg: "#FFF0E5", label: "Fair" } :
                  { color: "#9CA3AF", bg: "#F3F4F6", label: "Weak" };
  return (
    <span
      title={`${score}% keyword match between your resume and this job`}
      className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
      style={{ backgroundColor: bg, color }}
    >
      <TrendingUp className="w-3 h-3" />
      {score}% · {label}
    </span>
  );
}

function Step3Discovery({ titles, location, resume, autoSearchRun, onNext }: { titles: string[]; location: string; resume: ResumeData; autoSearchRun: number; onNext: (jobs: JobResult[]) => void }) {
  const [jobs, setJobs] = useState<JobResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<string | null>(null);
  const [activePlatforms, setActivePlatforms] = useState<Set<string>>(new Set());
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [sortByMatch, setSortByMatch] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const nextStart = useRef(0);
  const nextCursor = useRef<string | null>(null);
  const didFetch = useRef(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Track which dateFilter the current jobs were fetched with, so Load More is consistent
  const activeServerFilter = useRef<string | undefined>(undefined);

  const doFetch = useCallback(async (start: number, append: boolean, dateFilter?: string, platforms?: string[]) => {
    if (!append) {
      // Cancel any in-flight request before starting a fresh search
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      setStatus("loading");
      setLoadMoreError(null);
      nextCursor.current = null;
      if (start === 0) setJobs([]); // fresh search — clear existing results
    }
    try {
      const result = await searchJobs(
        titles,
        location,
        { start, cursor: append ? nextCursor.current : null, dateFilter, limit: 10, pages: append ? 3 : 1, platforms },
        !append ? (job) => setJobs(prev => [...prev, job]) : undefined
      );
      if (append) {
        setJobs(prev => {
          const existing = new Set(prev.map(j => j.id));
          return [...prev, ...result.jobs.filter(j => !existing.has(j.id))];
        });
      }
      // Only advance the cursor on success so retries use the same offset
      nextStart.current = result.nextStart ?? start + SEARCH_FETCH_FALLBACK_SIZE;
      nextCursor.current = result.nextCursor ?? null;
      activeServerFilter.current = dateFilter;
      setHasMore(result.hasMore);
      setLoadMoreError(null);
      setStatus("done");
    } catch (err) {
      if (append) {
        // Load More error — keep existing jobs visible, just show a retry cue
        setLoadMoreError(err instanceof Error ? err.message : String(err));
        setHasMore(true); // allow retry
      } else {
        // Initial / filter-change fetch error — show full error state
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    }
  }, [titles, location]);

  // Re-fetch when time filter changes to/from a coarse bucket (7d+)
  // Fine buckets (1hr–2d) are handled client-side by visibleJobs derivation below
  useEffect(() => {
    if (!didFetch.current) return; // skip until the user explicitly starts a search
    const newServerFilter = getServerDateFilter(timeFilter);
    if (newServerFilter === activeServerFilter.current) return; // no server change needed
    // Server filter changed: reset pagination and fetch fresh
    nextStart.current = 0;
    nextCursor.current = null;
    doFetch(0, false, newServerFilter, [...activePlatforms]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeFilter]); // intentionally exclude doFetch — its stable identity breaks the guard

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || loadingMore || status === "loading") return false;
    setLoadingMore(true);
    setLoadMoreError(null);
    await doFetch(nextStart.current, true, activeServerFilter.current, [...activePlatforms]);
    setLoadingMore(false);
    return true;
  }, [doFetch, hasMore, loadingMore, status, activePlatforms]);

  const handleSearch = async () => {
    didFetch.current = true;
    nextStart.current = 0;
    nextCursor.current = null;
    setSelected(new Set());
    setCurrentPage(1);
    await doFetch(0, false, getServerDateFilter(timeFilter), [...activePlatforms]);
  };

  useEffect(() => {
    if (autoSearchRun <= 0 || status === "loading") return;
    void handleSearch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSearchRun]);

  // Derived: compute match scores for all jobs (memo — only recomputes when jobs or resume changes)
  const scores = useMemo(() => {
    const map = new Map<string, number>();
    jobs.forEach(job => map.set(job.id, computeMatchScore(job, resume)));
    return map;
  }, [jobs, resume]);

  // Derived: apply client-side time, platform, and min-score filters, then optionally sort by match
  const visibleJobs = useMemo(() => {
    const filtered = jobs.filter(job => {
      if (activePlatforms.size > 0) {
        const via = job.via.toLowerCase();
        const matches = [...activePlatforms].some(p => via.includes(p.toLowerCase()));
        if (!matches) return false;
      }
      if (timeFilter !== null) {
        const maxHours = TIME_FILTERS.find(f => f.label === timeFilter)?.maxHours ?? Infinity;
        const hours = parsePostedAtHours(job.postedAt);
        if (hours > maxHours) return false;
      }
      if (minScore > 0) {
        if ((scores.get(job.id) ?? 0) < minScore) return false;
      }
      return true;
    });
    if (sortByMatch) {
      return [...filtered].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
    }
    return filtered;
  }, [jobs, activePlatforms, timeFilter, sortByMatch, minScore, scores]);

  const platformOptions = useMemo(() => {
    const counts = new Map<string, number>();
    jobs.forEach(job => {
      const label = normalizePlatformLabel(job.via);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    });

    const featured = FEATURED_PLATFORMS.map(label => ({
      label,
      count: counts.get(label) ?? 0,
    })).filter(option => jobs.length === 0 || option.count > 0 || activePlatforms.has(option.label));

    const featuredSet = new Set<string>(FEATURED_PLATFORMS);
    const discovered = [...counts.entries()]
      .filter(([label]) => !featuredSet.has(label))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label, count]) => ({ label, count }));

    const activeMissing = [...activePlatforms]
      .filter(label => !counts.has(label) && !featuredSet.has(label))
      .map(label => ({ label, count: 0 }));

    return [...featured, ...discovered, ...activeMissing];
  }, [activePlatforms, jobs]);

  const totalPages = Math.max(1, Math.ceil(visibleJobs.length / JOBS_PER_PAGE));
  const pageStart = (currentPage - 1) * JOBS_PER_PAGE;
  const pageJobs = visibleJobs.slice(pageStart, pageStart + JOBS_PER_PAGE);
  const pageEnd = pageStart + pageJobs.length;

  useEffect(() => {
    setCurrentPage(page => Math.min(Math.max(1, page), totalPages));
  }, [totalPages]);

  useEffect(() => {
    const node = loadMoreSentinelRef.current;
    // Only auto-load when the user is already on the last page of loaded results
    if (!node || status !== "done" || !hasMore || loadingMore || currentPage < totalPages) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void handleLoadMore();
      }
    }, { rootMargin: "200px 0px 0px 0px" });

    observer.observe(node);
    return () => observer.disconnect();
  }, [status, hasMore, loadingMore, handleLoadMore, currentPage, totalPages, visibleJobs.length]);

  const toggle = (id: string) => setSelected(prev => {
    const s = new Set(prev);
    s.has(id) ? s.delete(id) : s.add(id);
    return s;
  });

  const togglePlatform = (p: string) => setActivePlatforms(prev => {
    const s = new Set(prev);
    s.has(p) ? s.delete(p) : s.add(p);
    return s;
  });

  const allVisibleSelected = pageJobs.length > 0 && pageJobs.every(j => selected.has(j.id));
  const toggleAll = () => {
    setSelected(prev => {
      const s = new Set(prev);
      if (allVisibleSelected) {
        pageJobs.forEach(j => s.delete(j.id));
      } else {
        pageJobs.forEach(j => s.add(j.id));
      }
      return s;
    });
  };

  const selectedJobs = jobs.filter(j => selected.has(j.id));
  const handlePreviousPage = () => setCurrentPage(page => Math.max(1, page - 1));
  const handleNextPage = async () => {
    if (currentPage < totalPages) {
      setCurrentPage(page => Math.min(totalPages, page + 1));
      return;
    }
    if (hasMore) {
      const loaded = await handleLoadMore();
      if (loaded) setCurrentPage(page => page + 1);
    }
  };
  const showPagination = visibleJobs.length > JOBS_PER_PAGE || hasMore;
  const paginationLabel = `Page ${currentPage} of ${totalPages}${hasMore && currentPage >= totalPages ? "+" : ""}`;

  // Build summary line: "Showing 18 of 40+ · LinkedIn · Within 7 days"
  const totalStr = hasMore ? `${jobs.length}+` : `${jobs.length}`;
  const filterParts: string[] = [];
  if (activePlatforms.size > 0) filterParts.push([...activePlatforms].join(", "));
  if (timeFilter) filterParts.push(`within ${timeFilter}`);
  if (minScore > 0) filterParts.push(`${minScore}%+ match`);
  const titlesDisplay = titles.length <= 3
    ? titles.join(", ")
    : `${titles.slice(0, 2).join(", ")} +${titles.length - 2} more`;
  const locationDisplay = location.split("|").filter(Boolean).join(", ") || "all locations";
  const summaryLine = status === "idle"
    ? `Ready to search live postings for "${titlesDisplay}" in ${locationDisplay}.`
    : status === "loading" && jobs.length === 0
    ? `Searching ${titles.length} title${titles.length !== 1 ? "s" : ""} in ${locationDisplay}…`
    : status === "error"
    ? "Error fetching jobs"
    : [
        visibleJobs.length > 0
          ? `Showing ${pageStart + 1}-${pageEnd} of ${visibleJobs.length} filtered jobs (${totalStr} loaded)`
          : `Showing 0 of ${totalStr}`,
        ...filterParts,
      ].filter(Boolean).join(" · ");
  const clearFilters = () => {
    setTimeFilter(null);
    setActivePlatforms(new Set());
    setMinScore(0);
  };

  return (
    <div className="flex-1 p-4 md:p-8 overflow-auto">
      <div className="max-w-5xl mx-auto">

        {/* ── Header ── */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div>
            <div className="chip-mint inline-flex mb-3">Step 2 of 4</div>
            <h1 className="font-heading font-bold text-2xl md:text-3xl mb-1" style={{ color: "#0A0A0A" }}>Live Job Discovery</h1>
            <p className="text-sm" style={{ color: "#666" }}>{summaryLine}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <button
              className="btn-outline-dark w-full sm:w-auto"
              onClick={handleSearch}
              disabled={status === "loading"}
            >
              {status === "loading" ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Searching…</>
              ) : (
                <><Search className="w-4 h-4" />Search live jobs</>
              )}
            </button>
            {selected.size > 0 && (
              <button className="btn-mint w-full sm:w-auto" onClick={() => onNext(selectedJobs)}>
                Tailor {selected.size} resume{selected.size > 1 ? "s" : ""} <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* ── Status banners ── */}
        {status === "loading" && jobs.length === 0 && (
          <div className="flex items-center gap-3 mb-5 p-4 rounded-xl" style={{ backgroundColor: "#ECFFE0", border: "1px solid rgba(0,240,160,0.3)" }}>
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: "#00c447" }} />
            <div>
              <span className="text-sm font-medium" style={{ color: "#005A3D" }}>Searching {titles.length} title{titles.length !== 1 ? "s" : ""} in {locationDisplay}</span>
              <p className="text-xs mt-0.5" style={{ color: "#007A50" }}>{titles.join(" · ")}</p>
            </div>
          </div>
        )}
        {status === "error" && (
          <div className="mb-5 p-4 rounded-xl flex items-center gap-3" style={{ backgroundColor: "#FEE2E2", border: "1px solid #FCA5A5" }}>
            <AlertCircle className="w-5 h-5 flex-shrink-0" style={{ color: "#EF4444" }} />
            <p className="text-sm" style={{ color: "#991B1B" }}>{errorMsg}</p>
          </div>
        )}

        {/* ── Filter toolbar (shown once first results arrive) ── */}
        {jobs.length > 0 && (() => {
          const activeFilterCount = (timeFilter ? 1 : 0) + activePlatforms.size + (minScore > 0 ? 1 : 0);
          return (
            <div className="rounded-2xl mb-5 p-4 space-y-3" style={{ backgroundColor: "#F8F8F8", border: "1px solid #EBEBEB" }}>
              {/* Row 1: Posted within + Sort toggle */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold flex-shrink-0" style={{ color: "#555" }}>Posted:</span>
                  <button
                    onClick={() => setTimeFilter(null)}
                    className="text-xs px-3 py-1 rounded-full font-medium transition-all"
                    style={{ backgroundColor: timeFilter === null ? "#00F0A0" : "#fff", color: timeFilter === null ? "#0A0A0A" : "#555", border: timeFilter === null ? "1.5px solid #00F0A0" : "1.5px solid #D0D5DD" }}
                  >
                    Any
                  </button>
                  {TIME_FILTERS.map(f => (
                    <button key={f.label}
                      onClick={() => setTimeFilter(prev => prev === f.label ? null : f.label)}
                      className="text-xs px-3 py-1 rounded-full font-medium transition-all"
                      style={{ backgroundColor: timeFilter === f.label ? "#00F0A0" : "#fff", color: timeFilter === f.label ? "#0A0A0A" : "#555", border: timeFilter === f.label ? "1.5px solid #00F0A0" : "1.5px solid #D0D5DD" }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setSortByMatch(v => !v)}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-all flex-shrink-0"
                  style={{ backgroundColor: sortByMatch ? "#0A0A0A" : "#fff", color: sortByMatch ? "#00F0A0" : "#555", border: sortByMatch ? "1.5px solid #0A0A0A" : "1.5px solid #D0D5DD" }}
                >
                  <TrendingUp className="w-3 h-3" />
                  {sortByMatch ? "Sorted by match" : "Sort by match"}
                </button>
              </div>
              {/* Row 2: Platform */}
              {platformOptions.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold flex-shrink-0" style={{ color: "#555" }}>Platform:</span>
                  <button
                    onClick={() => setActivePlatforms(new Set())}
                    className="text-xs px-3 py-1 rounded-full font-medium transition-all"
                    style={{ backgroundColor: activePlatforms.size === 0 ? "#00F0A0" : "#fff", color: activePlatforms.size === 0 ? "#0A0A0A" : "#555", border: activePlatforms.size === 0 ? "1.5px solid #00F0A0" : "1.5px solid #D0D5DD" }}
                  >
                    All
                  </button>
                  {platformOptions.map(({ label: p, count }) => (
                    <button key={p} onClick={() => togglePlatform(p)}
                      className="text-xs px-3 py-1 rounded-full font-medium transition-all"
                      style={{ backgroundColor: activePlatforms.has(p) ? "#00F0A0" : "#fff", color: activePlatforms.has(p) ? "#0A0A0A" : "#555", border: activePlatforms.has(p) ? "1.5px solid #00F0A0" : "1.5px solid #D0D5DD" }}
                    >
                      {p} <span style={{ opacity: 0.6 }}>{count}</span>
                    </button>
                  ))}
                </div>
              )}
              {/* Row 3: Match score + clear */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold flex-shrink-0" style={{ color: "#555" }}>Match:</span>
                  {[0, 40, 60, 75, 90].map(pct => (
                    <button key={pct} onClick={() => setMinScore(pct)}
                      className="text-xs px-3 py-1 rounded-full font-medium transition-all"
                      style={{ backgroundColor: minScore === pct ? "#00F0A0" : "#fff", color: minScore === pct ? "#0A0A0A" : "#555", border: minScore === pct ? "1.5px solid #00F0A0" : "1.5px solid #D0D5DD" }}
                    >
                      {pct === 0 ? "Any" : `${pct}%+`}
                    </button>
                  ))}
                </div>
                {activeFilterCount > 0 && (
                  <button onClick={clearFilters}
                    className="text-xs font-semibold flex items-center gap-1 flex-shrink-0"
                    style={{ color: "#888" }}
                  >
                    <X className="w-3 h-3" /> Clear {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}
                  </button>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── Select all row ── */}
        {visibleJobs.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 px-1">
            <button
              onClick={toggleAll}
              className="flex items-center gap-2 text-sm font-medium transition-colors"
              style={{ color: "#00c447" }}
            >
              <div
                className="w-4 h-4 rounded flex items-center justify-center transition-all"
                style={{
                  backgroundColor: allVisibleSelected ? "#00F0A0" : "transparent",
                  border: allVisibleSelected ? "none" : "2px solid #D0D5DD",
                }}
              >
                {allVisibleSelected && <Check className="w-3 h-3" style={{ color: "#0A0A0A" }} />}
              </div>
              {allVisibleSelected ? `Deselect all (${pageJobs.length})` : `Select all (${pageJobs.length})`}
            </button>
            <div className="flex items-center gap-3 flex-wrap">
              {selected.size > 0 && (
                <span className="text-xs" style={{ color: "#888" }}>
                  {selected.size} selected total
                </span>
              )}
              {showPagination && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePreviousPage}
                    disabled={currentPage === 1}
                    className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
                    style={{ backgroundColor: currentPage === 1 ? "#F0F0F0" : "#fff", border: "1.5px solid #D0D5DD", color: currentPage === 1 ? "#aaa" : "#0A0A0A" }}
                    aria-label="Previous jobs page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-semibold min-w-[92px] text-center" style={{ color: "#555" }}>
                    {paginationLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleNextPage()}
                    disabled={(currentPage >= totalPages && !hasMore) || (currentPage >= totalPages && loadingMore)}
                    className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
                    style={{ backgroundColor: (currentPage >= totalPages && loadingMore) ? "#F0F0F0" : "#fff", border: "1.5px solid #D0D5DD", color: (currentPage >= totalPages && !hasMore) || (currentPage >= totalPages && loadingMore) ? "#aaa" : "#0A0A0A" }}
                    aria-label="Next jobs page"
                  >
                    {(currentPage >= totalPages && loadingMore) ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Job list ── */}
        <div className="space-y-3 mb-6">
          {pageJobs.map((job) => {
            const isSel = selected.has(job.id);
            const isExp = expanded === job.id;
            const color = companyColor(job.company);
            return (
              <div key={job.id} className={`card-base rounded-2xl overflow-hidden transition-all animate-slide-up ${isSel ? "job-card-selected" : ""}`}>
                <div className="flex items-start gap-3 md:gap-4 p-4 md:p-5 cursor-pointer" onClick={() => toggle(job.id)}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white text-sm flex-shrink-0" style={{ backgroundColor: color }}>
                    {job.company[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm" style={{ color: "#0A0A0A" }}>{job.title}</p>
                          <MatchBadge score={scores.get(job.id) ?? 0} />
                          {job.source === "custom" && (
                            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "#E0F2FE", color: "#0369A1" }}>Direct</span>
                          )}
                        </div>
                        <p className="text-xs" style={{ color: "#888" }}>{job.company} · {job.source === "custom" ? job.via : `via ${job.via}`}</p>
                      </div>
                      <div className="w-5 h-5 rounded-full flex items-center justify-center transition-all flex-shrink-0"
                        style={{ backgroundColor: isSel ? "#00F0A0" : "transparent", border: isSel ? "none" : "2px solid #D0D5DD" }}>
                        {isSel && <Check className="w-3 h-3" style={{ color: "#0A0A0A" }} />}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 md:gap-3 mt-2 text-xs flex-wrap" style={{ color: "#888" }}>
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{job.location}</span>
                      {job.salary && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />{job.salary}</span>}
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{job.postedAt}</span>
                      {job.remote && <span className="chip-mint">Remote</span>}
                      <span className="chip-blue">{job.scheduleType}</span>
                    </div>
                  </div>
                  <button className="flex items-center justify-center gap-1 text-xs font-medium flex-shrink-0 mt-1 min-w-11 min-h-11 sm:min-w-0 sm:min-h-0" style={{ color: "#888" }}
                    onClick={e => { e.stopPropagation(); setExpanded(isExp ? null : job.id); }}>
                    {isExp ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
                {isExp && (
                  <div className="px-4 md:px-5 pb-5 pt-0" style={{ borderTop: "1px solid #F0F0F0" }}>
                    <p className="text-xs leading-relaxed mb-3" style={{ color: "#555" }}>{job.description}</p>
                    {job.highlights.map(h => (
                      <div key={h.title} className="mb-3">
                        <p className="text-xs font-bold mb-1" style={{ color: "#0A0A0A" }}>{h.title}</p>
                        <ul className="space-y-1">
                          {h.items.map((item, i) => (
                            <li key={i} className="text-xs flex items-start gap-2" style={{ color: "#555" }}>
                              <span style={{ color: "#00c447" }}>•</span>{item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {(() => {
                      const { matched, missing } = computeSkillGap(job, resume);
                      if (matched.length === 0 && missing.length === 0) return null;
                      return (
                        <div className="mt-3 pt-3" style={{ borderTop: "1px solid #F0F0F0" }}>
                          <p className="text-xs font-bold mb-2" style={{ color: "#0A0A0A" }}>Skills gap</p>
                          <div className="flex flex-wrap gap-1.5">
                            {matched.map(skill => (
                              <span key={skill} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
                                style={{ backgroundColor: "#ECFFE0", color: "#15803D", border: "1px solid rgba(0,196,71,0.2)" }}>
                                <Check className="w-2.5 h-2.5" />{skill}
                              </span>
                            ))}
                            {missing.map(kw => (
                              <span key={kw} className="text-xs px-2 py-0.5 rounded-full font-medium"
                                style={{ backgroundColor: "#FFF7ED", color: "#C2410C", border: "1px solid rgba(249,115,22,0.2)" }}>
                                {kw}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    {job.applyLink && (
                      <a href={job.applyLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold mt-3 block" style={{ color: "#00c447" }}>
                        Apply directly <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {visibleJobs.length === 0 && jobs.length > 0 && status === "done" && (
            <div className="text-center py-12" style={{ color: "#888" }}>
              <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">No jobs match the current filters</p>
              <p className="text-xs mt-1" style={{ color: "#999" }}>{jobs.length} jobs were fetched from SerpAPI but are hidden by filters.</p>
              <button className="text-xs mt-2 underline" style={{ color: "#00c447" }} onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          )}

          {jobs.length === 0 && status === "idle" && (
            <div className="text-center py-12" style={{ color: "#888" }}>
              <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">Ready to search {titles.length} title{titles.length !== 1 ? "s" : ""} in {locationDisplay}</p>
              <p className="text-xs mt-1" style={{ color: "#999" }}>{titles.join(" · ")}</p>
            </div>
          )}

          {jobs.length === 0 && status === "done" && (
            <div className="text-center py-12 px-4" style={{ color: "#888" }}>
              <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium mb-1">No jobs found for this search</p>
              {location && !location.toLowerCase().includes("remote") && !location.toLowerCase().includes("united states") ? (
                <>
                  <p className="text-xs mb-4" style={{ color: "#999" }}>
                    Google Jobs found 0 results for <strong>{locationDisplay}</strong>. Try broadening your search:
                  </p>
                  <ul className="text-xs space-y-1 mb-5 text-left inline-block" style={{ color: "#666" }}>
                    <li>• Go back to Step 1 and add <strong>Remote (US)</strong> to your locations</li>
                    <li>• Try a nearby larger city (e.g. Chicago, IL or New York, NY)</li>
                    <li>• Remove the location filter to search nationally</li>
                  </ul>
                </>
              ) : (
                <p className="text-xs mb-4" style={{ color: "#999" }}>Try broader job titles or retry the search.</p>
              )}
              <button
                className="text-xs font-semibold px-4 py-2 rounded-full transition-all"
                style={{ backgroundColor: "#fff", color: "#0A0A0A", border: "1.5px solid #D0D5DD" }}
                onClick={() => void handleSearch()}
              >
                Retry search
              </button>
            </div>
          )}
        </div>

        {/* ── Streaming indicator ── */}
        {status === "loading" && jobs.length > 0 && (
          <div className="flex items-center gap-2 text-sm mb-4" style={{ color: "#888" }}>
            <Loader2 className="w-4 h-4 animate-spin" />Streaming more results…
          </div>
        )}

        {status === "done" && visibleJobs.length > 0 && showPagination && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-4 p-3 rounded-2xl" style={{ backgroundColor: "#F8F9FA", border: "1px solid #E5E8EA" }}>
            <span className="text-xs font-semibold" style={{ color: "#555" }}>
              Showing {pageStart + 1}-{pageEnd} of {visibleJobs.length} filtered jobs
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePreviousPage}
                disabled={currentPage === 1}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all"
                style={{ backgroundColor: currentPage === 1 ? "#F0F0F0" : "#fff", border: "1.5px solid #D0D5DD", color: currentPage === 1 ? "#aaa" : "#0A0A0A" }}
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Previous
              </button>
              <span className="text-xs font-semibold min-w-[92px] text-center" style={{ color: "#555" }}>
                {paginationLabel}
              </span>
              <button
                type="button"
                onClick={() => void handleNextPage()}
                disabled={(currentPage >= totalPages && !hasMore) || (currentPage >= totalPages && loadingMore)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all"
                style={{ backgroundColor: (currentPage >= totalPages && loadingMore) ? "#F0F0F0" : "#fff", border: "1.5px solid #D0D5DD", color: (currentPage >= totalPages && !hasMore) || (currentPage >= totalPages && loadingMore) ? "#aaa" : "#0A0A0A" }}
              >
                {(currentPage >= totalPages && loadingMore) ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading</> : <>Next <ChevronRight className="w-3.5 h-3.5" /></>}
              </button>
            </div>
          </div>
        )}

        <div ref={loadMoreSentinelRef} className="h-2" aria-hidden="true" />

        {/* ── Load more / retry ── */}
        {status === "done" && hasMore && currentPage >= totalPages && (
          <div className="flex flex-col items-center gap-2">
            {loadMoreError && (
              <p className="text-xs text-center" style={{ color: "#EF4444" }}>
                Couldn't load more — {loadMoreError}. Try again below.
              </p>
            )}
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all"
              style={{
                backgroundColor: loadingMore ? "#F0F0F0" : loadMoreError ? "#FEF2F2" : "#fff",
                border: loadMoreError ? "1.5px solid #FCA5A5" : "1.5px solid #D0D5DD",
                color: loadingMore ? "#999" : loadMoreError ? "#DC2626" : "#0A0A0A",
              }}
            >
              {loadingMore ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Loading more…</>
              ) : loadMoreError ? (
                <><RotateCcw className="w-4 h-4" />Try again</>
              ) : (
                <>Load more results</>
              )}
            </button>
            {!loadMoreError && (
              <p className="text-xs text-center" style={{ color: "#888" }}>
                More Google Jobs pages load automatically as you scroll.
              </p>
            )}
          </div>
        )}

        {status === "done" && jobs.length > 0 && !hasMore && (
          <p className="text-xs text-center pb-2" style={{ color: "#888" }}>
            All available Google Jobs pages are loaded for this search.
          </p>
        )}

      </div>
    </div>
  );
}

// ── Step 3: Review & Confirm ──────────────────────────────────────────────────

interface JobTailoringState {
  status: "idle" | "loading" | "done" | "error";
  statusMsg: string;
  result: TailoringResult | null;
  rows: DiffChange[];
  error: string;
}

const ATS_EDITABLE_FIELDS: Record<string, { key: string; placeholder: string }> = {
  "Phone number": { key: "phone", placeholder: "e.g. +1 555 123 4567" },
  "LinkedIn URL": { key: "linkedin", placeholder: "e.g. linkedin.com/in/yourname" },
  "Location": { key: "location", placeholder: "e.g. New York, NY" },
};

function ATSChecklistCard({ atsChecks, resume, onUpdateResume }: {
  atsChecks: ATSCheck[];
  resume: ResumeData;
  onUpdateResume: (r: ResumeData) => void;
}) {
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [savedFields, setSavedFields] = useState<Record<string, boolean>>({});

  function handleSave(label: string) {
    const field = ATS_EDITABLE_FIELDS[label];
    if (!field) return;
    const val = (editValues[label] ?? "").trim();
    if (!val) return;
    onUpdateResume({ ...resume, contact: { ...(resume.contact ?? {}), [field.key]: val } });
    setSavedFields(prev => ({ ...prev, [label]: true }));
  }

  return (
    <div className="card-base p-5 rounded-2xl">
      <h3 className="font-heading font-bold text-sm mb-4 flex items-center gap-2" style={{ color: "#0A0A0A" }}>
        <Shield className="w-4 h-4" style={{ color: "#00c447" }} />
        ATS Safety Checklist
        <span className="text-xs font-normal" style={{ color: "#888" }}>— Real checks, no fake scores</span>
      </h3>
      <div className="space-y-3">
        {atsChecks.map((c, i) => {
          const editable = !c.ok && ATS_EDITABLE_FIELDS[c.label];
          const field = editable ? ATS_EDITABLE_FIELDS[c.label] : null;
          const isSaved = savedFields[c.label];
          return (
            <div key={i} className="flex items-start gap-3">
              {(c.ok || isSaved) ? <Check className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#22C55E" }} /> : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#F59E0B" }} />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: (c.ok || isSaved) ? "#333" : "#92400E" }}>{c.label}{isSaved ? " ✓ added" : ""}</p>
                {c.detail && !isSaved && <p className="text-xs mt-0.5" style={{ color: "#888" }}>{c.detail}</p>}
                {editable && field && !isSaved && (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="text"
                      value={editValues[c.label] ?? ""}
                      onChange={e => setEditValues(prev => ({ ...prev, [c.label]: e.target.value }))}
                      onKeyDown={e => { if (e.key === "Enter") handleSave(c.label); }}
                      placeholder={field.placeholder}
                      className="flex-1 text-xs px-3 py-1.5 rounded-lg border outline-none"
                      style={{ borderColor: "#DDD", backgroundColor: "#FFF", color: "#333", minWidth: 0 }}
                    />
                    <button
                      onClick={() => handleSave(c.label)}
                      disabled={!(editValues[c.label] ?? "").trim()}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                      style={{
                        backgroundColor: (editValues[c.label] ?? "").trim() ? "#00c447" : "#E5E7EB",
                        color: (editValues[c.label] ?? "").trim() ? "#fff" : "#9CA3AF",
                        cursor: (editValues[c.label] ?? "").trim() ? "pointer" : "not-allowed",
                      }}
                    >Save</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tailoring result cache (survives tab-switch / iOS background kill) ─────────

const TAILORING_CACHE_KEY = "resume_tailoring_cache_v1";
const TAILORING_CACHE_TTL = 4 * 3600 * 1000; // 4 hours

function saveTailoringCache(jobId: string, state: JobTailoringState) {
  try {
    const raw = localStorage.getItem(TAILORING_CACHE_KEY);
    const cache: Record<string, unknown> = raw ? JSON.parse(raw) : {};
    cache[jobId] = { ...state, savedAt: Date.now() };
    localStorage.setItem(TAILORING_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function loadTailoringCache(jobId: string): JobTailoringState | null {
  try {
    const raw = localStorage.getItem(TAILORING_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as Record<string, JobTailoringState & { savedAt?: number }>;
    const entry = cache[jobId];
    if (!entry?.result) return null;
    if (Date.now() - (entry.savedAt ?? 0) > TAILORING_CACHE_TTL) return null;
    return { status: "done", statusMsg: "", result: entry.result, rows: entry.rows ?? [], error: "" };
  } catch { return null; }
}

function Step4Review({ selectedJobs, resume, creditSkipNotice, onNext, onBuyCredits, onCreditsUpdated, user, onAutoSave, onUpdateResume }: { selectedJobs: JobResult[]; resume: ResumeData; creditSkipNotice: string; onNext: (diffs: Record<string, DiffChange[]>) => void; onBuyCredits: () => void; onCreditsUpdated: () => Promise<CreditBalance | null>; user: { id: string } | null; onAutoSave: (version: SavedVersion) => void; onUpdateResume: (r: ResumeData) => void; }) {
  const [activeJobId, setActiveJobId] = useState<string>(selectedJobs[0]?.id ?? "");
  const [jobStates, setJobStates] = useState<Record<string, JobTailoringState>>(() =>
    Object.fromEntries(selectedJobs.map(j => {
      const cached = loadTailoringCache(j.id);
      return [j.id, cached ?? { status: "idle", statusMsg: "", result: null, rows: [], error: "" }];
    }))
  );
  const tailoringStarted = useRef<Set<string>>(
    new Set(selectedJobs.filter(j => loadTailoringCache(j.id) !== null).map(j => j.id))
  );

  const runTailoring = useCallback(async (job: JobResult) => {
    if (tailoringStarted.current.has(job.id)) return;
    tailoringStarted.current.add(job.id);

    setJobStates(prev => ({ ...prev, [job.id]: { ...prev[job.id], status: "loading", statusMsg: "Fetching full job description…" } }));

    // Scrape the full job description from the posting page before sending to LLM.
    // Custom jobs already have a good description from from-url, so skip job_id scrape for them.
    let enrichedDescription = job.description;
    try {
      const scraped = await scrapeJobDescription(
        job.applyLink,
        job.source === "custom" ? undefined : job.id
      );
      if (scraped && scraped.length > (enrichedDescription?.length ?? 0)) {
        enrichedDescription = scraped;
      }
    } catch {
      // Silently fall back to existing snippet — tailoring continues
    }

    const jobData: JobData = {
      id: job.id, title: job.title, company: job.company, location: job.location,
      description: enrichedDescription, highlights: job.highlights,
    };

    try {
      await tailorResume(resume, jobData, {
        onStatus: (msg) => setJobStates(prev => ({ ...prev, [job.id]: { ...prev[job.id], statusMsg: msg } })),
        onResult: (result) => {
          const cleanChanges = (result.changes ?? []).map(sanitizeDiffChange).filter((change) => change.proposed || change.status !== "rewritten");
          const cleanResult = { ...result, changes: cleanChanges };
          const newState: JobTailoringState = { status: "done", statusMsg: "", result: cleanResult, rows: cleanChanges, error: "" };
          setJobStates(prev => ({ ...prev, [job.id]: newState }));
          saveTailoringCache(job.id, newState);
          void onCreditsUpdated();
          // Auto-save immediately so the record exists even if user never reaches Step 5
          if (user) {
            onAutoSave({
              id: `auto-${job.id}`,
              name: `${job.company} — ${job.title}`,
              resume: applyDiffs(resume, cleanChanges),
              job,
              jobTitle: job.title,
              jobCompany: job.company,
              diffChanges: cleanChanges,
              sourceJobId: job.id,
              savedAt: Date.now(),
            });
          }
        },
        onError: (err, code) => {
          if (code === "INSUFFICIENT_CREDITS" || /credit|buy credits|remaining/i.test(err ?? "")) onBuyCredits();
          setJobStates(prev => ({ ...prev, [job.id]: { ...prev[job.id], status: "error", error: err || "Tailoring failed" } }));
          void onCreditsUpdated();
        },
      });
    } catch (err) {
      setJobStates(prev => ({
        ...prev,
        [job.id]: {
          ...prev[job.id],
          status: "error",
          error: err instanceof Error ? err.message : "Tailoring request failed",
        },
      }));
    }
  }, [resume, onBuyCredits, onCreditsUpdated]);

  // Auto-start tailoring for every selected job in parallel.
  useEffect(() => {
    selectedJobs.forEach((job) => {
      void runTailoring(job);
    });
  }, [selectedJobs, runTailoring]);

  // Keep a ref to latest jobStates for use inside event listeners
  const jobStatesRef = useRef(jobStates);
  useEffect(() => { jobStatesRef.current = jobStates; }, [jobStates]);

  // On tab/app return (visibilitychange), auto-retry any job that errored or was
  // interrupted mid-stream (iOS Safari throws "Load failed" when backgrounded).
  // Only retry "error" — not "loading" — to prevent double credit charges when
  // the user switches tabs while a tailor request is still in-flight.
  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState !== "visible") return;
      selectedJobs.forEach(job => {
        const st = jobStatesRef.current[job.id];
        if (st?.status === "error") {
          tailoringStarted.current.delete(job.id);
          setJobStates(prev => ({
            ...prev,
            [job.id]: { status: "idle", statusMsg: "", result: null, rows: [], error: "" },
          }));
          void runTailoring(job);
        }
      });
    };
    document.addEventListener("visibilitychange", handleVisible);
    return () => document.removeEventListener("visibilitychange", handleVisible);
  }, [selectedJobs, runTailoring]);

  const handleRetryJob = useCallback((jobId: string) => {
    tailoringStarted.current.delete(jobId);
    setJobStates(prev => ({
      ...prev,
      [jobId]: { status: "idle", statusMsg: "", result: null, rows: [], error: "" },
    }));
    const job = selectedJobs.find(j => j.id === jobId);
    if (job) void runTailoring(job);
  }, [selectedJobs, runTailoring]);

  const updateRow = (jobId: string, rowId: string, patch: Partial<DiffChange>) => {
    setJobStates(prev => ({
      ...prev,
      [jobId]: { ...prev[jobId], rows: prev[jobId].rows.map(r => r.id === rowId ? { ...r, ...patch } : r) },
    }));
  };

  const activeState = jobStates[activeJobId];
  const rows = activeState?.rows ?? [];
  const pendingCount = rows.filter(r => r.status === "confirm" && !r.confirmed).length;
  const totalConfirm = rows.filter(r => r.status === "confirm").length;
  const confirmedCount = rows.filter(r => r.status === "confirm" && r.confirmed).length;
  const progress = totalConfirm === 0 ? (activeState?.status === "done" ? 100 : 0) : Math.round((confirmedCount / totalConfirm) * 100);

  // Compute projected match score based on which proposed changes are accepted.
  // Builds a virtual resume with accepted/confirmed proposed text, then re-runs computeMatchScore.
  const activeJob = selectedJobs.find(j => j.id === activeJobId);

  // Baseline = token score of the original resume before any tailoring
  const baselineScore = useMemo(() => {
    if (!activeJob) return null;
    return computeMatchScore(activeJob, resume);
  }, [activeJob, resume]);

  const projectedScore = useMemo(() => {
    if (!activeJob || !activeState?.result) return null;
    // Build a projected resume by applying accepted rows
    const projectedResume: ResumeData = {
      ...resume,
      summary: resume.summary,
      skills: [...(resume.skills ?? [])],
      experience: (resume.experience ?? []).map(e => ({ ...e, bullets: [...(e.bullets ?? [])] })),
    };
    for (const row of rows) {
      const text = row.customText ?? row.proposed ?? "";
      if (!text) continue;
      if (row.status === "kept") continue;
      if (row.status === "confirm" && !row.confirmed) continue;
      if (row.section === "Summary") {
        projectedResume.summary = text;
      } else if (row.section === "Skills") {
        // Inject new skill terms
        const newSkills = text.split(/[,;]/).map(s => s.trim()).filter(Boolean);
        projectedResume.skills = [...new Set([...(projectedResume.skills ?? []), ...newSkills])];
      } else {
        // Experience bullet — use same fuzzy company matching as applyDiffs
        const companyHint = row.section.replace(/^experience\s*[-–—:]\s*/i, "").trim().toLowerCase();
        projectedResume.experience = (projectedResume.experience ?? []).map(e => {
          const eComp = e.company.toLowerCase();
          const matches = companyHint
            ? eComp.includes(companyHint) || companyHint.includes(eComp)
            : false;
          if (!matches) return e;
          const existingIdx = e.bullets?.findIndex(b => b === row.original);
          if (existingIdx !== undefined && existingIdx >= 0) {
            const bullets = [...(e.bullets ?? [])];
            bullets[existingIdx] = text;
            return { ...e, bullets };
          }
          return { ...e, bullets: [...(e.bullets ?? []), text] };
        });
      }
    }
    return computeMatchScore(activeJob, projectedResume);
  }, [activeJob, activeState?.result, rows, resume]);

  // All jobs must be done and have zero pending confirms before export unlocks
  const allJobsDone = selectedJobs.every(j => jobStates[j.id]?.status === "done");
  const totalPendingAllJobs = selectedJobs.reduce((sum, j) => {
    const jRows = jobStates[j.id]?.rows ?? [];
    return sum + jRows.filter(r => r.status === "confirm" && !r.confirmed).length;
  }, 0);
  const allResolved = allJobsDone && totalPendingAllJobs === 0;

  const handleConfirm = (rowId: string, accept: boolean) => {
    const row = rows.find(r => r.id === rowId);
    if (!row) return;
    // Consider proposed safe if the row has any proposed text, or if user clicked Reject (always "kept")
    const hasSafeProposal = !!(row.customText ?? row.proposed ?? "").trim();
    const newStatus: DiffChange["status"] = accept && hasSafeProposal ? "rewritten" : "kept";
    updateRow(activeJobId, rowId, { confirmed: true, status: newStatus });
  };

  const handleConfirmAll = (accept: boolean) => {
    rows
      .filter(r => r.status === "confirm" && !r.confirmed)
      .forEach(r => {
        const hasSafeProposal = !!(r.customText ?? r.proposed ?? "").trim();
        updateRow(activeJobId, r.id, { confirmed: true, status: accept && hasSafeProposal ? "rewritten" : "kept" });
      });
  };

  const handleRetry = async (rowId: string) => {
    const row = rows.find(r => r.id === rowId);
    const job = selectedJobs.find(j => j.id === activeJobId);
    if (!row || !job) return;
    updateRow(activeJobId, rowId, { retrying: true });
    try {
      const jobData: JobData = { id: job.id, title: job.title, company: job.company, location: job.location, description: job.description };
      const res = await retryChange(resume, jobData, row);
      updateRow(activeJobId, rowId, { proposed: sanitizeDiffChange({ ...row, proposed: res.proposed }).proposed, retrying: false, confirmed: false, status: "confirm" });
    } catch {
      updateRow(activeJobId, rowId, { retrying: false });
    }
  };

  const handleCustomText = (rowId: string, text: string) => {
    updateRow(activeJobId, rowId, { customText: text, confirmed: true, status: "rewritten", editMode: false });
  };

  const handleNextToGeneratedResumes = () => {
    onNext(Object.fromEntries(selectedJobs.map(j => [j.id, jobStates[j.id]?.rows ?? []])));
  };

  const atsChecks = activeState?.result?.atsChecks ?? [];
  const skillGaps = activeState?.result?.skillGaps;

  return (
    <div className="flex-1 p-4 md:p-8 overflow-auto">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <div className="chip-mint inline-flex mb-3">Step 3 of 4</div>
          <h1 className="font-heading font-bold text-2xl md:text-3xl mb-2" style={{ color: "#0A0A0A" }}>Review & Confirm</h1>
          <p className="text-base" style={{ color: "#666" }}>Every LLM-proposed change needs your approval. Accept, reject, retry, or write your own text. Export is blocked until all confirmed.</p>
        </div>

        {/* Job tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {selectedJobs.map(j => {
            const st = jobStates[j.id];
            const jPending = st?.rows.filter(r => r.status === "confirm" && !r.confirmed).length ?? 0;
            const color = companyColor(j.company);
            return (
              <button key={j.id} onClick={() => setActiveJobId(j.id)}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all flex-shrink-0"
                style={{ backgroundColor: activeJobId === j.id ? "#0A0A0A" : "white", color: activeJobId === j.id ? "white" : "#444", border: "1px solid", borderColor: activeJobId === j.id ? "#0A0A0A" : "#E0E0E0" }}
              >
                <div className="w-5 h-5 rounded-full text-white text-xs flex items-center justify-center font-bold flex-shrink-0" style={{ backgroundColor: color }}>{j.company[0]}</div>
                <span className="max-w-[120px] truncate">{j.company}</span>
                {st?.status === "loading" && <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "#00c447" }} />}
                {jPending > 0 && <span className="w-4 h-4 rounded-full text-xs flex items-center justify-center font-bold" style={{ backgroundColor: "#FEF3C7", color: "#92400E" }}>{jPending}</span>}
                {st?.status === "done" && jPending === 0 && <Check className="w-3.5 h-3.5" style={{ color: "#00c447" }} />}
              </button>
            );
          })}
        </div>

        {/* Status / loading */}
        {activeState?.status === "loading" && (
          <div className="mb-5 p-4 rounded-xl flex items-center gap-3" style={{ backgroundColor: "#F8F9FA", border: "1px solid #E5E8EA" }}>
            <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" style={{ color: "#00c447" }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: "#0A0A0A" }}>AI is analysing the job and your resume…</p>
              <p className="text-xs mt-0.5" style={{ color: "#888" }}>{activeState.statusMsg}</p>
            </div>
          </div>
        )}
        {activeState?.status === "error" && (
          <div className="mb-5 p-4 rounded-xl flex items-center justify-between gap-3 flex-wrap" style={{ backgroundColor: "#FEE2E2", border: "1px solid #FCA5A5" }}>
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-5 h-5 flex-shrink-0" style={{ color: "#EF4444" }} />
              <p className="text-sm" style={{ color: "#991B1B" }}>{activeState.error}</p>
            </div>
            <button
              onClick={() => handleRetryJob(activeJobId)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: "white", color: "#991B1B", border: "1px solid #FCA5A5" }}
            >
              <RotateCcw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        )}
        {creditSkipNotice && (
          <div className="mb-5 p-4 rounded-xl flex items-center justify-between gap-3 flex-wrap" style={{ backgroundColor: "#FFFBEB", border: "1px solid #FDE68A" }}>
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0" style={{ color: "#D97706" }} />
              <p className="text-sm font-semibold" style={{ color: "#92400E" }}>{creditSkipNotice}</p>
            </div>
            <button className="btn-outline-dark text-sm" onClick={onBuyCredits}>Buy credits</button>
          </div>
        )}
        {(pendingCount > 0 || (allJobsDone && totalPendingAllJobs > 0 && pendingCount === 0)) && activeState?.status === "done" && (() => {
          const otherJobsWithPending = pendingCount === 0
            ? selectedJobs.filter(j => j.id !== activeJobId && (jobStates[j.id]?.rows ?? []).some(r => r.status === "confirm" && !r.confirmed))
            : [];
          return (
            <div className="mb-5 p-4 rounded-xl flex items-center justify-between gap-3 flex-wrap" style={{ backgroundColor: "#FFFBEB", border: "1px solid #FDE68A" }}>
              <div className="flex items-center gap-2 flex-wrap">
                <AlertCircle className="w-5 h-5 flex-shrink-0" style={{ color: "#D97706" }} />
                <span className="text-sm font-semibold" style={{ color: "#92400E" }}>
                  {pendingCount > 0
                    ? `${pendingCount} item${pendingCount > 1 ? "s" : ""} need your review — export blocked`
                    : `${totalPendingAllJobs} item${totalPendingAllJobs > 1 ? "s" : ""} unreviewed in other job${otherJobsWithPending.length > 1 ? "s" : ""} — export blocked`}
                </span>
                {otherJobsWithPending.length > 0 && (
                  <span className="flex items-center gap-1 flex-wrap text-xs" style={{ color: "#92400E" }}>
                    {otherJobsWithPending.map(j => (
                      <button
                        key={j.id}
                        onClick={() => setActiveJobId(j.id)}
                        className="underline font-medium"
                        style={{ color: "#92400E" }}
                      >
                        {j.company}
                      </button>
                    ))}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {pendingCount > 0 && (
                  <>
                    <button
                      onClick={() => handleConfirmAll(true)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
                      style={{ backgroundColor: "#00F0A0", color: "#003D29", border: "1px solid rgba(0,240,160,0.6)" }}
                    >
                      Accept all ({pendingCount})
                    </button>
                    <button
                      onClick={() => handleConfirmAll(false)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
                      style={{ backgroundColor: "white", color: "#92400E", border: "1px solid #FDE68A" }}
                    >
                      Reject all
                    </button>
                  </>
                )}
                {pendingCount > 0 && <span className="text-xs font-medium" style={{ color: "#92400E" }}>{confirmedCount}/{totalConfirm} confirmed here</span>}
              </div>
            </div>
          );
        })()}
        {allResolved && (
          <div className="mb-5 p-4 rounded-xl flex items-center justify-between gap-3 flex-wrap" style={{ backgroundColor: "#ECFFE0", border: "1px solid rgba(0,240,160,0.4)" }}>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5" style={{ color: "#00c447" }} />
              <span className="text-sm font-semibold" style={{ color: "#005A3D" }}>All changes confirmed — resume verified and ATS-safe</span>
            </div>
            <button className="btn-mint text-sm w-full sm:w-auto" onClick={handleNextToGeneratedResumes}>
              Next: Generated Resumes <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Match score + seniority */}
        {activeState?.result && (
          <div className="flex flex-wrap gap-3 mb-5">
            {/* Match score: AI projected (primary) vs original baseline */}
            {activeState.result.matchScore != null && baselineScore !== null && (
              <div className="card-base px-5 py-3 flex items-center gap-3 rounded-xl" style={{ border: activeState.result.matchScore >= 85 ? "1.5px solid #00c447" : undefined }}>
                <div>
                  <div className="text-2xl font-bold font-heading" style={{ color: activeState.result.matchScore >= 85 ? "#00c447" : activeState.result.matchScore >= 70 ? "#D97706" : "#EF4444" }}>
                    {activeState.result.matchScore}%
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: activeState.result.matchScore >= 85 ? "#00c447" : "#888" }}>
                    {activeState.result.matchScore >= 85 ? "★ " : ""}Resume–Job Match
                  </div>
                </div>
                <div className="text-xs pl-3" style={{ borderLeft: "1px solid #E5E8EA", color: "#aaa" }}>
                  Before tailoring<br />
                  <span style={{ color: baselineScore >= 80 ? "#00c447" : baselineScore >= 65 ? "#D97706" : "#EF4444" }}>
                    {baselineScore}%
                  </span>
                </div>
              </div>
            )}
            <div className="card-base px-5 py-3 flex items-center gap-3 rounded-xl">
              <div className="text-sm font-bold capitalize" style={{ color: activeState.result.seniorityMatch === "perfect" ? "#00c447" : activeState.result.seniorityMatch === "stretch" ? "#D97706" : "#6B7280" }}>
                {activeState.result.seniorityMatch}
              </div>
              <div className="text-xs" style={{ color: "#888" }}>Seniority<br />Alignment</div>
            </div>
            {activeState.result.senioritySignals?.length > 0 && (
              <div className="card-base px-5 py-3 flex-1 rounded-xl">
                <p className="text-xs font-semibold mb-1" style={{ color: "#888" }}>Seniority signals to improve:</p>
                <ul className="space-y-0.5">
                  {activeState.result.senioritySignals.slice(0, 2).map((s, i) => <li key={i} className="text-xs" style={{ color: "#555" }}>→ {s}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Progress bar */}
        {activeState?.status === "done" && (
          <div className="mb-3 flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "#E5E8EA" }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, backgroundColor: "#00F0A0" }} />
            </div>
            <span className="text-xs font-semibold" style={{ color: "#888" }}>{progress}% reviewed</span>
          </div>
        )}

        {/* Column headers (desktop only) */}
        {rows.length > 0 && (
          <div className="hidden md:grid grid-cols-3 gap-px text-xs font-semibold py-2 px-4 mb-1" style={{ color: "#888" }}>
            <div>Original</div><div className="text-center">Job Requirement</div><div>Proposed Change</div>
          </div>
        )}

        {/* Diff rows */}
        <div className="space-y-3 mb-8">
          {rows.map(row => (
            <DiffRowCard key={row.id} row={row}
              onConfirm={(id, accept) => handleConfirm(id, accept)}
              onRetry={(id) => handleRetry(id)}
              onCustomText={(id, text) => handleCustomText(id, text)}
            />
          ))}
        </div>

        {/* Skill gaps */}
        {skillGaps && (skillGaps.keyword.length + skillGaps.evidence.length + skillGaps.trueGap.length > 0) && (
          <div className="card-base p-5 rounded-2xl mb-5">
            <h3 className="font-heading font-bold text-sm mb-4 flex items-center gap-2" style={{ color: "#0A0A0A" }}>
              <AlertCircle className="w-4 h-4" style={{ color: "#F59E0B" }} />Skill Gap Analysis
            </h3>
            <div className="grid md:grid-cols-3 gap-3">
              {[
                { key: "keyword", label: "Keyword gaps", items: skillGaps.keyword, color: "#DBEAFE", text: "#1E40AF", note: "You have this skill — different phrasing" },
                { key: "evidence", label: "Evidence gaps", items: skillGaps.evidence, color: "#FEF3C7", text: "#92400E", note: "Skill claimed but no example bullet yet" },
                { key: "trueGap", label: "True gaps", items: skillGaps.trueGap, color: "#FEE2E2", text: "#991B1B", note: "Required skill absent from your resume" },
              ].map(g => g.items.length > 0 && (
                <div key={g.key} className="p-4 rounded-xl" style={{ backgroundColor: g.color }}>
                  <div className="text-xs font-bold mb-1" style={{ color: g.text }}>{g.label}</div>
                  <p className="text-xs mb-2" style={{ color: g.text, opacity: 0.8 }}>{g.note}</p>
                  <ul className="space-y-1">{g.items.map((item, i) => <li key={i} className="text-xs font-medium" style={{ color: g.text }}>· {item}</li>)}</ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ATS checks */}
        {atsChecks.length > 0 && (
          <ATSChecklistCard atsChecks={atsChecks} resume={resume} onUpdateResume={onUpdateResume} />
        )}
      </div>
    </div>
  );
}

function DiffRowCard({ row, onConfirm, onRetry, onCustomText }: {
  row: DiffChange;
  onConfirm: (id: string, accept: boolean) => void;
  onRetry: (id: string) => void;
  onCustomText: (id: string, text: string) => void;
}) {
  const isTrueGap = row.gapType === "true_gap";
  const isEvidenceGap = row.gapType === "evidence";
  const needsFallback = isTrueGap || isEvidenceGap;
  const rawProposed = (row.customText ?? row.proposed ?? "").trim();
  // If the AI returned no proposed text (wiped by sanitizer or left blank), show a Retry prompt
  const proposedText = rawProposed;
  const hasSafeProposal = proposedText.length > 0;
  const isPending = row.status === "confirm" && !row.confirmed;
  const [editText, setEditText] = useState(row.customText ?? row.proposed ?? "");
  const [editMode, setEditMode] = useState(false);
  // Sync editText when a Retry completes and row.proposed changes (but not while user is actively editing)
  useEffect(() => {
    if (!editMode) setEditText(row.customText ?? row.proposed ?? "");
  }, [row.proposed, row.customText, editMode]);
  const gapChip = row.gapType === "true_gap"
    ? <span className="chip-red text-xs">True gap</span>
    : row.gapType === "evidence"
    ? <span className="chip-amber text-xs">Evidence gap</span>
    : row.gapType === "keyword"
    ? <span className="chip-blue text-xs">Keyword gap</span>
    : null;

  return (
    <div className="card-base overflow-hidden rounded-xl">
      <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2" style={{ backgroundColor: "#F8F9FA", borderBottom: "1px solid #F0F0F0" }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold" style={{ color: "#888" }}>{row.section}</span>
          {row.status === "kept" && <span className="chip-green">Kept</span>}
          {row.status === "rewritten" && !row.customText && <span className="chip-blue">Rewritten</span>}
          {isPending && <span className="chip-amber">Needs Confirmation</span>}
          {row.customText && row.confirmed && <span className="chip-mint">Your text</span>}
          {!isPending && row.confirmed && !row.customText && row.status === "rewritten" && <span className="chip-green">Accepted</span>}
          {gapChip}
        </div>
        {row.status !== "kept" && (
          <div className="flex items-center gap-1 flex-wrap">
            <button onClick={() => { setEditMode(true); setEditText(row.customText ?? row.proposed ?? ""); }}
              className="flex items-center gap-1 text-xs font-semibold px-2.5 py-2 rounded-lg transition-all"
              style={{ color: "#555" }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = "#EBEBEB"}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
              title="Edit this suggestion"
            ><Pen className="w-3 h-3" /> Edit</button>
            <button onClick={() => onRetry(row.id)} disabled={row.retrying}
              className="flex items-center gap-1 text-xs font-semibold px-2.5 py-2 rounded-lg transition-all"
              style={{ color: row.retrying ? "#aaa" : "#555" }}
              onMouseEnter={e => { if (!row.retrying) e.currentTarget.style.backgroundColor = "#EBEBEB"; }}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
              title="Get alternative AI suggestion"
            >
              {row.retrying ? <><Loader2 className="w-3 h-3 animate-spin" /> Retrying…</> : <><RotateCcw className="w-3 h-3" /> Retry</>}
            </button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px" style={{ backgroundColor: "#F0F0F0" }}>
        <div className="diff-original p-4 text-sm leading-relaxed" style={{ color: "#444" }}>
          <div className="text-xs font-bold mb-1 uppercase tracking-wide md:hidden" style={{ color: "#888" }}>Original</div>
          {row.original}
        </div>
        <div className="diff-requirement p-4 text-sm leading-relaxed" style={{ color: "#005A3D" }}>
          <div className="text-xs font-bold mb-1 uppercase tracking-wide" style={{ color: "#00c447", opacity: 0.8 }}>Job requires</div>
          "{row.jobReq}"
          {row.gapNote && <p className="text-xs mt-2 italic" style={{ color: "#888" }}>{row.gapNote}</p>}
        </div>
        <div className="diff-proposed p-4 text-sm leading-relaxed" style={{ color: "#0A0A0A" }}>
          <div className="text-xs font-bold mb-1 uppercase tracking-wide md:hidden" style={{ color: "#888" }}>Proposed Change</div>
          {row.retrying ? (
            <div className="flex items-center gap-2" style={{ color: "#888" }}>
              <Loader2 className="w-3 h-3 animate-spin" /><span className="text-xs">Generating alternative…</span>
            </div>
          ) : editMode ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold mb-1" style={{ color: "#888" }}>Write your own version:</p>
              <textarea className="w-full text-sm rounded-lg px-3 py-2 outline-none resize-none"
                style={{ border: "1.5px solid #00F0A0", backgroundColor: "#FAFFF8", color: "#0A0A0A", minHeight: 80 }}
                value={editText} onChange={e => setEditText(e.target.value)} autoFocus />
              <div className="flex flex-col sm:flex-row gap-2">
                <button onClick={() => { onCustomText(row.id, editText); setEditMode(false); }}
                  className="flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full"
                  style={{ backgroundColor: "#00F0A0", color: "#0A0A0A", border: "1px solid #0A0A0A" }}
                ><Check className="w-3 h-3" /> Use this text</button>
                <button onClick={() => setEditMode(false)} className="flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full"
                  style={{ backgroundColor: "#F0F0F0", color: "#555" }}><X className="w-3 h-3" /> Cancel</button>
              </div>
            </div>
          ) : (
            <>
              {hasSafeProposal ? (
                <>
                  <span style={{ color: row.customText ? "#005A3D" : "#0A0A0A" }}>{proposedText}</span>
                  {isPending && (
                    <div className="flex flex-col sm:flex-row gap-2 mt-3">
                      <button onClick={() => onConfirm(row.id, true)}
                        className="flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full"
                        style={{ backgroundColor: "#00F0A0", color: "#0A0A0A", border: "1px solid #0A0A0A" }}
                      ><ThumbsUp className="w-3.5 h-3.5" /> Accept</button>
                      <button onClick={() => onConfirm(row.id, false)}
                        className="flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full"
                        style={{ backgroundColor: "#FEE2E2", color: "#991B1B", border: "1px solid #FCA5A5" }}
                      ><ThumbsDown className="w-3.5 h-3.5" /> Reject</button>
                    </div>
                  )}
                </>
              ) : needsFallback ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs" style={{ color: "#888" }}>
                    No suggestion generated. Click <strong>Retry</strong> to get an AI-drafted bullet, or <strong>Edit</strong> to write your own.
                  </p>
                  {isPending && (
                    <button onClick={() => onConfirm(row.id, false)}
                      className="flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full w-fit"
                      style={{ backgroundColor: "#FEE2E2", color: "#991B1B", border: "1px solid #FCA5A5" }}
                    ><ThumbsDown className="w-3.5 h-3.5" /> Reject</button>
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step 4: Export ────────────────────────────────────────────────────────────

function sortByDateDesc<T extends { period?: string; year?: string }>(items: T[]): T[] {
  const MONTHS: Record<string, number> = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  function parseStart(s: string | undefined): number {
    if (!s) return 0;
    const m = s.match(/([A-Za-z]{3,})\s+(\d{4})|(\d{4})/);
    if (!m) return 0;
    const year = parseInt(m[2] || m[3], 10);
    const mon = m[1] ? (MONTHS[m[1].toLowerCase().slice(0, 3)] ?? 0) : 0;
    return year * 12 + mon;
  }
  return [...items].sort((a, b) => parseStart(b.period ?? b.year) - parseStart(a.period ?? a.year));
}

// Returns structured skill groups: prefers explicit skillGroups, falls back to parsing
// "Category: skill1, skill2" patterns from the flat skills array.
function resolveSkillGroups(resume: ResumeData): { category: string; skills: string[] }[] {
  const explicit = (resume.skillGroups ?? []).filter(g => g.category && g.skills.length > 0);
  const flat = resume.skills ?? [];

  if (explicit.length > 0) {
    // Use explicit groups, but also surface any flat skills added by tailoring that aren't in any group
    const covered = new Set(explicit.flatMap(g => g.skills.map(s => s.toLowerCase())));
    const tailoredExtra = flat.filter(s => !covered.has(s.toLowerCase()) && !s.match(/^[A-Za-z][^:]{2,39}:/));
    if (tailoredExtra.length === 0) return explicit;
    return [...explicit, { category: "Additional Skills", skills: tailoredExtra }];
  }

  // No explicit groups — try to parse "Category: skill1, skill2" patterns from flat list
  const catRe = /^([A-Za-z][^:]{2,39}):\s*(.+)$/;
  const derived: { category: string; skills: string[] }[] = [];
  let cur: { category: string; skills: string[] } | null = null;
  const preItems: string[] = [];
  for (const item of flat) {
    const m = item.match(catRe);
    if (m) {
      if (cur) derived.push(cur);
      cur = { category: m[1].trim(), skills: m[2].split(/\s*,\s*/).filter(Boolean) };
    } else if (cur) {
      cur.skills.push(item.trim());
    } else {
      preItems.push(item.trim());
    }
  }
  if (cur) derived.push(cur);
  if (derived.length === 0) return [];
  const covered = new Set(derived.flatMap(g => g.skills.map(s => s.toLowerCase())));
  const uncovered = preItems.filter(s => !covered.has(s.toLowerCase()));
  if (uncovered.length > 0) derived.push({ category: "Additional Skills", skills: uncovered });
  return derived;
}

function buildPlainTextResume(a: ResumeData): string {
  a = sanitizeResumeForExport(a);
  const lines: string[] = [];
  lines.push(a.contact?.name ?? "");
  lines.push([a.contact?.phone, a.contact?.email, a.contact?.location, a.contact?.linkedin].filter(Boolean).join(" | "));
  lines.push("");
  lines.push("SUMMARY");
  lines.push(a.summary ?? "");
  lines.push("");
  lines.push("SKILLS");
  const ptGroups = resolveSkillGroups(a);
  if (ptGroups.length > 0) {
    for (const grp of ptGroups) lines.push(`${grp.category}: ${grp.skills.join(", ")}`);
  } else {
    lines.push(a.skills?.join(", ") ?? "");
  }
  lines.push("");
  lines.push("EXPERIENCE");
  for (const e of a.experience ?? []) {
    lines.push(`${e.title} — ${e.company} (${e.period})`);
    for (const b of e.bullets ?? []) lines.push(`  • ${b}`);
    lines.push("");
  }
  lines.push("EDUCATION");
  for (const e of a.education ?? []) {
    lines.push(`${e.degree}, ${e.school}, ${e.year}`);
    if (e.notes) lines.push(`  • ${e.notes}`);
  }
  if (a.projects && a.projects.length > 0) {
    lines.push("");
    lines.push("PROJECTS");
    for (const p of a.projects) {
      lines.push(`${p.name}${p.period ? ` (${p.period})` : ""}`);
      for (const b of p.bullets ?? []) lines.push(`  • ${b}`);
    }
  }
  lines.push("");
  lines.push("CERTIFICATIONS");
  for (const c of a.certifications ?? []) lines.push(`• ${c}`);
  if (a.achievements && a.achievements.length > 0) {
    lines.push("");
    lines.push("ACHIEVEMENTS");
    for (const ac of a.achievements) lines.push(`• ${ac}`);
  }
  return lines.join("\n");
}

function applyDiffs(base: ResumeData, rows: DiffChange[]): ResumeData {
  const result: ResumeData = {
    contact: { ...base.contact },
    summary: base.summary,
    skills: [...(base.skills ?? [])],
    skillGroups: (base.skillGroups ?? []).map(g => ({ ...g, skills: [...g.skills] })),
    experience: (base.experience ?? []).map(e => ({ ...e, bullets: [...(e.bullets ?? [])] })),
    education: (base.education ?? []).map(e => ({ ...e })),
    certifications: [...(base.certifications ?? [])],
    achievements: [...(base.achievements ?? [])],
    projects: (base.projects ?? []).map(p => ({ ...p, bullets: [...(p.bullets ?? [])] })),
  };

  for (const row of rows) {
    // Apply all rewritten rows: AI auto-rewrites (confirmed=undefined) and user-accepted confirm rows (confirmed=true).
    // Rejected rows become status="kept" and are correctly skipped. Unreviewed confirm rows remain status="confirm".
    if (row.status !== "rewritten") continue;
    const rawText = (row.customText ?? row.proposed).trim();
    const finalText = sanitizeResumeText(rawText);
    if (!finalText) continue;
    const sec = row.section.toLowerCase();
    const isInsertion = !row.original || row.original === "[Not in resume]";

    if (sec.includes("summary")) {
      result.summary = finalText;

    } else if (sec.includes("skill")) {
      const finalSkills = sanitizeResumeSkillText(rawText);
      if (finalSkills.length === 0) continue;
      const normalOrig = (row.original ?? "").trim().toLowerCase();
      if (isInsertion) {
        for (const skill of finalSkills) {
          if (!result.skills!.some(s => s.trim().toLowerCase() === skill.trim().toLowerCase())) {
            result.skills!.push(skill);
          }
        }
      } else {
        const idx = result.skills!.findIndex(s => s.trim().toLowerCase() === normalOrig);
        if (idx >= 0) {
          result.skills!.splice(idx, 1, ...finalSkills);
        } else {
          for (const skill of finalSkills) {
            if (!result.skills!.some(s => s.trim().toLowerCase() === skill.trim().toLowerCase())) {
              result.skills!.push(skill);
            }
          }
        }
      }

    } else if (sec.includes("certification")) {
      // Split multi-cert proposals — AI sometimes joins all certs with semicolons
      const certItems = rawText.split(/\s*;\s*/).map(c => sanitizeResumeText(c)).filter(Boolean);
      const normalOrig = (row.original ?? "").trim().toLowerCase();
      if (isInsertion) {
        for (const cert of certItems) {
          if (!result.certifications!.some(c => c.trim().toLowerCase() === cert.trim().toLowerCase())) {
            result.certifications!.push(cert);
          }
        }
      } else {
        const idx = result.certifications!.findIndex(c => c.trim().toLowerCase() === normalOrig);
        if (idx >= 0 && certItems.length === 1) {
          result.certifications![idx] = certItems[0];
        } else {
          for (const cert of certItems) {
            if (!result.certifications!.some(c => c.trim().toLowerCase() === cert.trim().toLowerCase())) {
              result.certifications!.push(cert);
            }
          }
        }
      }

    } else if (sec.includes("education")) {
      if (isInsertion) {
        result.education!.push({ degree: finalText, school: "", year: "" });
      } else {
        const normalOrig = (row.original ?? "").trim().toLowerCase();
        for (const edu of result.education ?? []) {
          const candidates = [
            edu.degree,
            edu.school,
            `${edu.degree}, ${edu.school}`,
            `${edu.degree} from ${edu.school}`,
            `${edu.degree} from ${edu.school} (${edu.year})`,
          ].map(s => (s ?? "").trim().toLowerCase());
          if (candidates.some(c => c === normalOrig)) {
            // Update the field that best matches the original
            const degreeMatch = (edu.degree ?? "").trim().toLowerCase() === normalOrig;
            const schoolMatch = (edu.school ?? "").trim().toLowerCase() === normalOrig;
            if (schoolMatch) edu.school = finalText;
            else if (degreeMatch) edu.degree = finalText;
            else edu.degree = finalText; // fallback
            break;
          }
        }
        // No-match: skip silently — inserting a ghost entry is worse than missing an update
      }

    } else {
      if (isInsertion) {
        const companyHint = sec.replace(/^experience\s*[-–—:]\s*/i, "").trim().toLowerCase();
        const target = companyHint
          ? (result.experience ?? []).find(e => e.company.toLowerCase().includes(companyHint) || companyHint.includes(e.company.toLowerCase())) ?? result.experience?.[0]
          : result.experience?.[0];
        if (target) target.bullets = [...(target.bullets ?? []), finalText];
      } else {
        const normalOrig = (row.original ?? "").trim().toLowerCase();
        for (const exp of result.experience ?? []) {
          const bulletIdx = exp.bullets?.findIndex(b => b.trim().toLowerCase() === normalOrig);
          if (bulletIdx !== undefined && bulletIdx >= 0) {
            exp.bullets![bulletIdx] = finalText;
            break;
          }
        }
      }
    }
  }

  return sanitizeResumeForExport(result);
}

function ResumePreview({ resume, jobTitle, jobCompany }: { resume: ResumeData; jobTitle?: string; jobCompany?: string }) {
  resume = sanitizeResumeForExport(resume);
  const name = resume.contact?.name ?? "Resume";
  const contactParts = [resume.contact?.phone, resume.contact?.email, resume.contact?.location, resume.contact?.linkedin, resume.contact?.github].filter(Boolean);
  const sectionStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#555", borderBottom: "1px solid #DDD", paddingBottom: 4, marginBottom: 10, marginTop: 18 };

  return (
    <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 13, lineHeight: 1.6, color: "#222", padding: "28px 32px", background: "white", borderRadius: 8, border: "1px solid #E5E7EB" }}>
      {jobTitle && jobCompany && (
        <div style={{ fontSize: 11, color: "#00796b", marginBottom: 16, padding: "5px 10px", background: "#E8F5E9", borderRadius: 4, textAlign: "center" }}>
          Tailored for: <strong>{jobTitle}</strong> at <strong>{jobCompany}</strong>
        </div>
      )}
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#0A0A0A", letterSpacing: "-0.3px", marginBottom: 4 }}>{name}</div>
        {contactParts.length > 0 && <div style={{ fontSize: 12, color: "#555" }}>{contactParts.join(" | ")}</div>}
      </div>

      {resume.summary && (
        <>
          <div style={sectionStyle}>Summary</div>
          <p style={{ fontSize: 13, color: "#222", margin: 0 }}>{resume.summary}</p>
        </>
      )}

      {(() => {
        const previewGroups = resolveSkillGroups(resume);
        return (previewGroups.length > 0 || (resume.skills ?? []).length > 0) && (
          <>
            <div style={sectionStyle}>Skills</div>
            {previewGroups.length > 0
              ? previewGroups.map((grp, i) => (
                  <p key={i} style={{ fontSize: 12.5, color: "#333", margin: "0 0 3px 0" }}>
                    <strong style={{ color: "#111" }}>{grp.category}:</strong>{" "}{grp.skills.join(", ")}
                  </p>
                ))
              : <p style={{ fontSize: 12.5, color: "#333", margin: 0 }}>{resume.skills!.join(" · ")}</p>
            }
          </>
        );
      })()}

      {(resume.experience ?? []).length > 0 && (
        <>
          <div style={sectionStyle}>Experience</div>
          {sortByDateDesc(resume.experience!).map((exp, i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 13.5, color: "#111" }}>
                  <strong>{exp.title}</strong>
                  <strong> at {exp.company}</strong>
                  {exp.location && <span style={{ fontWeight: "normal", color: "#555" }}>, {exp.location}</span>}
                </span>
                <span style={{ fontSize: 12, color: "#666", whiteSpace: "nowrap" }}>{exp.period}</span>
              </div>
              <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>
                {(exp.bullets ?? []).map((b, bi) => (
                  <li key={bi} style={{ fontSize: 13, color: "#222", marginBottom: 3 }}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      {(resume.education ?? []).length > 0 && (
        <>
          <div style={sectionStyle}>Education</div>
          {sortByDateDesc(resume.education!).map((e, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 13, color: "#111" }}>
                  <strong>{[e.degree, e.school].filter(Boolean).join(", ")}</strong>
                  {e.location && <span style={{ fontWeight: "normal", color: "#666" }}>, {e.location}</span>}
                </span>
                <span style={{ fontSize: 12, color: "#666", whiteSpace: "nowrap" }}>{e.year}</span>
              </div>
              {e.notes && <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>• {e.notes}</div>}
            </div>
          ))}
        </>
      )}

      {(resume.projects ?? []).length > 0 && (
        <>
          <div style={sectionStyle}>Projects</div>
          {resume.projects!.map((proj, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <strong style={{ fontSize: 13, color: "#111" }}>{proj.name}</strong>
                {proj.period && <span style={{ fontSize: 12, color: "#666" }}>{proj.period}</span>}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {(proj.bullets ?? []).map((b, bi) => (
                  <li key={bi} style={{ fontSize: 13, color: "#222", marginBottom: 3 }}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      {(resume.certifications ?? []).length > 0 && (
        <>
          <div style={sectionStyle}>Certifications</div>
          {resume.certifications!.map((c, i) => (
            <div key={i} style={{ fontSize: 13, color: "#222", marginBottom: 3 }}>• {c}</div>
          ))}
        </>
      )}

      {(resume.achievements ?? []).length > 0 && (
        <>
          <div style={sectionStyle}>Achievements</div>
          {resume.achievements!.map((a, i) => (
            <div key={i} style={{ fontSize: 13, color: "#222", marginBottom: 3 }}>• {a}</div>
          ))}
        </>
      )}
    </div>
  );
}

// Replace Unicode chars that jsPDF's built-in Helvetica (Latin-1) can't encode
function pdfSafeText(text: string): string {
  return text
    .replace(/→/g, "->").replace(/←/g, "<-").replace(/↑/g, "^").replace(/↓/g, "v")
    .replace(/[""]/g, '"').replace(/['']/g, "'")
    .replace(/…/g, "...").replace(/•/g, "*")
    .replace(/[^\x00-\xFF]/g, "");
}

async function handlePdfDownload(resume: ResumeData, job: JobResult) {
  try {
  const { jsPDF } = await import("jspdf");
  resume = sanitizeResumeForExport(resume);

  // Letter-size, text-based PDF — fully readable by ATS parsers
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const mL = 19.05; // 0.75 in margins
  const mR = 19.05;
  const mT = 19.05;
  const mB = 19.05;
  const textW = pageW - mL - mR;
  let y = mT;

  const bp = (need = 5) => {
    if (y + need > pageH - mB) { pdf.addPage(); y = mT; }
  };

  const setColor = (r: number, g: number, b: number) => pdf.setTextColor(r, g, b);

  // ── Name ──
  const personName = pdfSafeText(resume.contact?.name ?? "");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(20);
  setColor(10, 10, 10);
  pdf.text(personName, pageW / 2, y, { align: "center" });
  y += 7;

  // ── Contact line (auto-wraps if too wide) ──
  const contactParts = [
    resume.contact?.phone,
    resume.contact?.email,
    resume.contact?.location,
    resume.contact?.linkedin,
    resume.contact?.github,
  ].filter(Boolean).map(pdfSafeText);
  if (contactParts.length) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    setColor(70, 70, 70);
    const contactLine = contactParts.join("  |  ");
    const lineW = pdf.getTextWidth(contactLine);
    if (lineW <= textW) {
      pdf.text(contactLine, pageW / 2, y, { align: "center" });
      y += 5.5;
    } else {
      // Split into two balanced lines
      const mid = Math.ceil(contactParts.length / 2);
      const line1 = contactParts.slice(0, mid).join("  |  ");
      const line2 = contactParts.slice(mid).join("  |  ");
      pdf.text(line1, pageW / 2, y, { align: "center" });
      y += 4.5;
      pdf.text(line2, pageW / 2, y, { align: "center" });
      y += 5.5;
    }
  }

  const sectionHead = (title: string) => {
    bp(14);
    y += 2;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9.5);
    setColor(50, 50, 50);
    pdf.text(title.toUpperCase(), mL, y);
    y += 1.5;
    pdf.setDrawColor(170, 170, 170);
    pdf.setLineWidth(0.3);
    pdf.line(mL, y, pageW - mR, y);
    y += 4.5;
  };

  // ── Summary ──
  if (resume.summary) {
    sectionHead("Summary");
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    setColor(20, 20, 20);
    const wrapped = pdf.splitTextToSize(pdfSafeText(resume.summary), textW);
    for (const line of wrapped) { bp(5); pdf.text(line, mL, y); y += 4.8; }
    y += 1;
  }

  // ── Skills ──
  const pdfSkillGroups = resolveSkillGroups(resume);
  const hasSkillGroups = pdfSkillGroups.length > 0;
  if (hasSkillGroups || (resume.skills ?? []).length > 0) {
    sectionHead("Skills");
    pdf.setFontSize(10);
    setColor(20, 20, 20);
    if (hasSkillGroups) {
      for (const grp of pdfSkillGroups) {
        bp(10);
        const label = pdfSafeText(grp.category) + ": ";
        const skillsText = pdfSafeText(grp.skills.join(", "));
        // Print category label in bold then skills inline
        pdf.setFont("helvetica", "bold");
        const labelW = pdf.getTextWidth(label);
        pdf.text(label, mL, y);
        pdf.setFont("helvetica", "normal");
        const remaining = textW - labelW;
        if (pdf.getTextWidth(skillsText) <= remaining) {
          pdf.text(skillsText, mL + labelW, y);
          y += 5;
        } else {
          // Wrap skills onto following lines
          const wrapped = pdf.splitTextToSize(skillsText, textW - labelW);
          pdf.text(wrapped[0], mL + labelW, y);
          y += 5;
          for (let i = 1; i < wrapped.length; i++) {
            bp(5);
            pdf.text(wrapped[i], mL + labelW, y);
            y += 4.8;
          }
        }
      }
    } else {
      // No groups — fill each bullet line by width (never overflow margin)
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      setColor(20, 20, 20);
      const bulletIndent = 5;
      const maxSkillW = textW - bulletIndent;
      const skillQueue = [...(resume.skills ?? [])];
      while (skillQueue.length > 0) {
        const lineSkills: string[] = [];
        while (skillQueue.length > 0) {
          const candidate = [...lineSkills, skillQueue[0]].join(", ");
          if (lineSkills.length > 0 && pdf.getTextWidth(pdfSafeText(candidate)) > maxSkillW) break;
          lineSkills.push(skillQueue.shift()!);
        }
        const lineText = pdfSafeText(lineSkills.join(", "));
        // If a single skill is still too wide, wrap it
        const wrapped = pdf.splitTextToSize(lineText, maxSkillW);
        for (let wi = 0; wi < wrapped.length; wi++) {
          bp(4.8);
          if (wi === 0) pdf.text("•", mL + 0.5, y);
          pdf.text(wrapped[wi], mL + bulletIndent, y);
          y += 4.8;
        }
      }
    }
    y += 1;
  }

  // ── Experience ──
  if ((resume.experience ?? []).length > 0) {
    sectionHead("Experience");
    for (const exp of sortByDateDesc(resume.experience!)) {
      bp(16);
      // "Title at Company, Location" on left | Period on right
      const periodText = pdfSafeText(exp.period ?? "");
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9.5);
      setColor(90, 90, 90);
      const periodW = pdf.getTextWidth(periodText);
      pdf.text(periodText, pageW - mR, y, { align: "right" });

      const titleCompanyStr = `${pdfSafeText(exp.title)} at ${pdfSafeText(exp.company)}`;
      const locStr = exp.location ? pdfSafeText(exp.location) : "";
      const maxLineW = textW - periodW - 4;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10.5);
      setColor(10, 10, 10);

      if (pdf.getTextWidth(titleCompanyStr + (locStr ? `, ${locStr}` : "")) <= maxLineW) {
        // Everything fits on one line
        pdf.text(titleCompanyStr, mL, y);
        if (locStr) {
          const tcW = pdf.getTextWidth(titleCompanyStr);
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(10);
          setColor(70, 70, 70);
          pdf.text(`, ${locStr}`, mL + tcW, y);
        }
        y += 5;
      } else {
        // Title+company on line 1 (with period), location on its own line in smaller gray
        const tcWrapped = pdf.splitTextToSize(titleCompanyStr, maxLineW);
        pdf.text(tcWrapped[0], mL, y);
        y += 5;
        for (let i = 1; i < tcWrapped.length; i++) {
          bp(5);
          pdf.text(tcWrapped[i], mL, y);
          y += 4.8;
        }
        if (locStr) {
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(9.5);
          setColor(90, 90, 90);
          pdf.text(locStr, mL, y);
          y += 4.5;
        }
      }

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      setColor(20, 20, 20);
      for (const bullet of exp.bullets ?? []) {
        const lines = pdf.splitTextToSize(pdfSafeText(bullet), textW - 5);
        const bulletH = lines.length * 4.8;
        if (y + bulletH > pageH - mB && bulletH <= pageH - mT - mB) {
          pdf.addPage(); y = mT;
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(10);
          setColor(20, 20, 20);
        }
        for (let i = 0; i < lines.length; i++) {
          if (y + 4.8 > pageH - mB) { pdf.addPage(); y = mT; }
          if (i === 0) {
            pdf.text("\u2022", mL + 0.5, y);
            pdf.text(lines[i], mL + 5, y);
          } else {
            pdf.text(lines[i], mL + 5, y);
          }
          y += 4.8;
        }
      }
      y += 3;
    }
  }

  // ── Education ──
  if ((resume.education ?? []).length > 0) {
    sectionHead("Education");
    for (const edu of sortByDateDesc(resume.education!)) {
      bp(12);
      // Degree, School bold | Location gray (same pattern as experience)
      const yearText = pdfSafeText(edu.year ?? "");
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9.5);
      setColor(90, 90, 90);
      pdf.text(yearText, pageW - mR, y, { align: "right" });
      const yearW = pdf.getTextWidth(yearText);

      const degSchoolStr = pdfSafeText([edu.degree, edu.school].filter(Boolean).join(", "));
      const eduLocStr = edu.location ? pdfSafeText(edu.location) : "";
      const maxEduW = textW - yearW - 4;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10.5);
      setColor(10, 10, 10);

      if (pdf.getTextWidth(degSchoolStr + (eduLocStr ? `, ${eduLocStr}` : "")) <= maxEduW) {
        // Fits on one line — degree+school bold, location gray inline
        pdf.text(degSchoolStr, mL, y);
        if (eduLocStr) {
          const dsW = pdf.getTextWidth(degSchoolStr);
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(10);
          setColor(70, 70, 70);
          pdf.text(`, ${eduLocStr}`, mL + dsW, y);
        }
        y += 4.8;
      } else {
        // Degree+school on line 1 (bold), location on its own gray line
        const eduWrapped = pdf.splitTextToSize(degSchoolStr, maxEduW);
        pdf.text(eduWrapped[0], mL, y);
        y += 4.8;
        for (let i = 1; i < eduWrapped.length; i++) {
          bp(4.8);
          pdf.text(eduWrapped[i], mL, y);
          y += 4.8;
        }
        if (eduLocStr) {
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(9.5);
          setColor(90, 90, 90);
          pdf.text(eduLocStr, mL, y);
          y += 4.5;
        }
      }

      if (edu.notes) {
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9.5);
        setColor(80, 80, 80);
        const notesWrapped = pdf.splitTextToSize(pdfSafeText(`• ${edu.notes}`), textW - 3);
        for (const nl of notesWrapped) {
          bp(4.5);
          pdf.text(nl, mL + 3, y);
          y += 4.5;
        }
      }
      y += 2;
    }
  }

  // ── Projects ──
  if ((resume.projects ?? []).length > 0) {
    sectionHead("Projects");
    for (const proj of resume.projects!) {
      bp(14);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10.5);
      setColor(10, 10, 10);
      pdf.text(proj.name, mL, y);
      if (proj.period) {
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9.5);
        setColor(90, 90, 90);
        pdf.text(proj.period, pageW - mR, y, { align: "right" });
      }
      y += 4.8;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      setColor(20, 20, 20);
      for (const bullet of proj.bullets ?? []) {
        const lines = pdf.splitTextToSize(bullet, textW - 5);
        for (let i = 0; i < lines.length; i++) {
          bp(5);
          if (i === 0) { pdf.text("•", mL + 0.5, y); pdf.text(lines[i], mL + 5, y); }
          else { pdf.text(lines[i], mL + 5, y); }
          y += 4.8;
        }
      }
      y += 2;
    }
  }

  // ── Certifications ──
  if ((resume.certifications ?? []).length > 0) {
    sectionHead("Certifications");
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    setColor(20, 20, 20);
    for (const cert of resume.certifications!) {
      const lines = pdf.splitTextToSize(cert, textW - 5);
      for (let i = 0; i < lines.length; i++) {
        bp(5);
        if (i === 0) {
          pdf.text("\u2022", mL + 0.5, y);
          pdf.text(lines[i], mL + 5, y);
        } else {
          pdf.text(lines[i], mL + 5, y);
        }
        y += 4.8;
      }
    }
  }

  // ── Achievements ──
  if ((resume.achievements ?? []).length > 0) {
    sectionHead("Achievements");
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    setColor(20, 20, 20);
    for (const ach of resume.achievements!) {
      const lines = pdf.splitTextToSize(ach, textW - 5);
      for (let i = 0; i < lines.length; i++) {
        bp(5);
        if (i === 0) {
          pdf.text("•", mL + 0.5, y);
          pdf.text(lines[i], mL + 5, y);
        } else {
          pdf.text(lines[i], mL + 5, y);
        }
        y += 4.8;
      }
    }
  }

  pdf.save(`${personName.replace(/\s+/g, "_")}_${job.company.replace(/\s+/g, "_")}.pdf`);
  } catch (err) {
    console.error("PDF generation failed", err);
    alert("Could not generate PDF. Please try downloading as DOCX instead.");
  }
}

async function buildDocxBlob(resume: ResumeData, job: JobResult): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, AlignmentType, TabStopType } = await import("docx");
  resume = sanitizeResumeForExport(resume);

  // ATS-safe section heading: bold, ALL CAPS, bottom border, no color gimmicks
  const sectionHeading = (text: string) =>
    new Paragraph({
      children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 20, font: "Calibri", color: "333333" })],
      border: { bottom: { color: "AAAAAA", space: 1, style: "single", size: 4 } },
      spacing: { before: 200, after: 80 },
    });

  const children: InstanceType<typeof Paragraph>[] = [];

  // ── Name ──
  children.push(new Paragraph({
    children: [new TextRun({ text: resume.contact?.name ?? "", bold: true, size: 40, font: "Calibri", color: "0A0A0A" })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 40 },
  }));

  // ── Contact line ──
  const contactParts = [
    resume.contact?.phone,
    resume.contact?.email,
    resume.contact?.location,
    resume.contact?.linkedin,
    resume.contact?.github,
  ].filter(Boolean) as string[];
  if (contactParts.length) {
    children.push(new Paragraph({
      children: [new TextRun({ text: contactParts.join("  |  "), size: 18, font: "Calibri", color: "444444" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
    }));
  }

  // ── Summary ──
  if (resume.summary) {
    children.push(sectionHeading("Summary"));
    children.push(new Paragraph({
      children: [new TextRun({ text: resume.summary, size: 22, font: "Calibri", color: "111111" })],
      spacing: { after: 80 },
    }));
  }

  // ── Skills ── grouped if available, flat fallback
  const docxSkillGroups = resolveSkillGroups(resume);
  const hasDocxGroups = docxSkillGroups.length > 0;
  if (hasDocxGroups || (resume.skills ?? []).length > 0) {
    children.push(sectionHeading("Skills"));
    if (hasDocxGroups) {
      for (const grp of docxSkillGroups) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `${grp.category}: `, size: 22, font: "Calibri", bold: true, color: "111111" }),
            new TextRun({ text: grp.skills.join(", "), size: 22, font: "Calibri", color: "111111" }),
          ],
          spacing: { after: 60 },
        }));
      }
    } else {
      // No groups — show as bullet-per-chunk-of-5 instead of one long paragraph
      const allSkills = resume.skills ?? [];
      const CHUNK = 5;
      for (let i = 0; i < allSkills.length; i += CHUNK) {
        children.push(new Paragraph({
          children: [new TextRun({ text: allSkills.slice(i, i + CHUNK).join(", "), size: 22, font: "Calibri", color: "111111" })],
          bullet: { level: 0 },
          spacing: { after: 40 },
        }));
      }
    }
  }

  // ── Experience ──
  if ((resume.experience ?? []).length > 0) {
    children.push(sectionHeading("Experience"));
    for (const exp of sortByDateDesc(resume.experience!)) {
      // "Title at Company, Location" (left) | Period (right)
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${exp.title} at ${exp.company}`, bold: true, size: 24, font: "Calibri", color: "0A0A0A" }),
          ...(exp.location ? [new TextRun({ text: `, ${exp.location}`, size: 22, font: "Calibri", color: "444444" })] : []),
          new TextRun({ text: "\t" }),
          new TextRun({ text: exp.period ?? "", size: 20, font: "Calibri", color: "555555" }),
        ],
        tabStops: [{ type: TabStopType.RIGHT, position: 9026 }],
        spacing: { before: 100, after: 60 },
      }));
      // Bullets
      for (const bullet of exp.bullets ?? []) {
        children.push(new Paragraph({
          children: [new TextRun({ text: bullet, size: 22, font: "Calibri", color: "111111" })],
          bullet: { level: 0 },
          spacing: { after: 30 },
        }));
      }
    }
  }

  // ── Education ──
  if ((resume.education ?? []).length > 0) {
    children.push(sectionHeading("Education"));
    for (const edu of sortByDateDesc(resume.education!)) {
      // Degree, School bold | Location gray | Year right
      const degSchoolDocx = [edu.degree, edu.school].filter(Boolean).join(", ");
      const eduLocDocx = edu.location ?? "";
      children.push(new Paragraph({
        children: [
          new TextRun({ text: degSchoolDocx, bold: true, size: 22, font: "Calibri", color: "0A0A0A" }),
          ...(eduLocDocx ? [new TextRun({ text: `, ${eduLocDocx}`, size: 22, font: "Calibri", color: "444444" })] : []),
          new TextRun({ text: "\t" }),
          new TextRun({ text: edu.year ?? "", size: 20, font: "Calibri", color: "555555" }),
        ],
        tabStops: [{ type: TabStopType.RIGHT, position: 9026 }],
        spacing: { before: 80, after: edu.notes ? 20 : 60 },
      }));
      if (edu.notes) {
        children.push(new Paragraph({
          children: [new TextRun({ text: edu.notes, size: 20, font: "Calibri", color: "555555" })],
          spacing: { after: 50 },
        }));
      }
    }
  }

  // ── Projects ──
  if ((resume.projects ?? []).length > 0) {
    children.push(sectionHeading("Projects"));
    for (const proj of resume.projects!) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: proj.name, bold: true, size: 22, font: "Calibri", color: "0A0A0A" }),
          ...(proj.period ? [new TextRun({ text: "\t" }), new TextRun({ text: proj.period, size: 20, font: "Calibri", color: "555555" })] : []),
        ],
        tabStops: [{ type: TabStopType.RIGHT, position: 9026 }],
        spacing: { before: 60, after: 30 },
      }));
      for (const bullet of proj.bullets ?? []) {
        children.push(new Paragraph({
          children: [new TextRun({ text: bullet, size: 22, font: "Calibri", color: "111111" })],
          bullet: { level: 0 },
          spacing: { after: 20 },
        }));
      }
    }
  }

  // ── Certifications ──
  if ((resume.certifications ?? []).length > 0) {
    children.push(sectionHeading("Certifications"));
    for (const cert of resume.certifications!) {
      children.push(new Paragraph({
        children: [new TextRun({ text: cert, size: 22, font: "Calibri", color: "111111" })],
        bullet: { level: 0 },
        spacing: { after: 30 },
      }));
    }
  }

  // ── Achievements ──
  if ((resume.achievements ?? []).length > 0) {
    children.push(sectionHeading("Achievements"));
    for (const ach of resume.achievements!) {
      children.push(new Paragraph({
        children: [new TextRun({ text: ach, size: 22, font: "Calibri", color: "111111" })],
        bullet: { level: 0 },
        spacing: { after: 30 },
      }));
    }
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 }, // 0.75 in = 1080 twips
        },
      },
      children,
    }],
  });

  return Packer.toBlob(doc);
}

async function handleDocxDownload(resume: ResumeData, job: JobResult) {
  const blob = await buildDocxBlob(resume, job);
  resume = sanitizeResumeForExport(resume);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(resume.contact?.name ?? "resume").replace(/\s+/g, "_")}_${job.company.replace(/\s+/g, "_")}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

async function handleDownloadAllDocx(jobs: JobResult[], tailoredResumes: Record<string, ResumeData>, baseResume: ResumeData) {
  const { zipSync } = await import("fflate");
  const files: Record<string, Uint8Array> = {};
  await Promise.all(
    jobs.map(async (job) => {
      const r = tailoredResumes[job.id] ?? baseResume;
      const blob = await buildDocxBlob(r, job);
      const arr = new Uint8Array(await blob.arrayBuffer());
      const sanitized = sanitizeResumeForExport(r);
      const name = `${(sanitized.contact?.name ?? "resume").replace(/\s+/g, "_")}_${job.company.replace(/[^a-zA-Z0-9]/g, "_")}.docx`;
      files[name] = arr;
    })
  );
  const zipped = zipSync(files);
  const blob = new Blob([zipped], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tailored_resumes.zip";
  a.click();
  URL.revokeObjectURL(url);
}

function ResumeDiffView({ original, tailored, rows }: { original: ResumeData; tailored: ResumeData; rows: DiffChange[] }) {
  const rewrittenRows = rows.filter(r => r.status === "rewritten");

  // Build Sets of every string that styleFn() will be called with so highlights work
  // across all section types (bullets, skills, certs, education "degree, school")
  const changedOriginals = new Set<string>();
  const changedNewTexts = new Set<string>();
  for (const r of rewrittenRows) {
    if (r.original && r.original !== "[Not in resume]") {
      const orig = r.original.trim();
      changedOriginals.add(orig);
      // Education originals arrive as "degree from school (year)" — also add "degree, school" format
      // so styleFn(`${e.degree}, ${e.school}`) matches
      if (r.section === "Education") {
        const fromMatch = orig.match(/^(.+?) from (.+?)(?:\s*\(\d{4}\))?\s*$/);
        if (fromMatch) {
          const deg = fromMatch[1].trim();
          const sch = fromMatch[2].trim();
          changedOriginals.add(`${deg}, ${sch}`);
          changedOriginals.add(deg);
        }
      }
    }
    const proposed = (r.customText ?? r.proposed ?? "").trim();
    // Skills and certs can be semicolon/comma-joined — add each token individually
    for (const tok of proposed.split(/\s*[,;]\s*/).map(t => t.trim()).filter(Boolean)) {
      changedNewTexts.add(tok);
    }
    changedNewTexts.add(proposed);
  }
  const changedCount = rewrittenRows.length;

  const sectionHdr = (title: string) => (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase" as const, color: "#555", borderBottom: "1px solid #DDD", paddingBottom: 4, marginBottom: 10, marginTop: 18 }}>
      {title}
    </div>
  );

  const leftStyle = (text: string): React.CSSProperties =>
    changedOriginals.has(text)
      ? { backgroundColor: "#FEE2E2", textDecoration: "line-through", color: "#991B1B", borderRadius: 3, padding: "1px 3px" }
      : {};

  const rightStyle = (text: string): React.CSSProperties =>
    changedNewTexts.has(text)
      ? { backgroundColor: "#DCFCE7", color: "#166534", borderRadius: 3, padding: "1px 3px" }
      : {};

  const panel = (res: ResumeData, side: "left" | "right") => {
    const styleFn = side === "left" ? leftStyle : rightStyle;
    const contactParts = [res.contact?.phone, res.contact?.email, res.contact?.location, res.contact?.linkedin, res.contact?.github].filter(Boolean);
    return (
      <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 12, lineHeight: 1.55, color: "#222", padding: "20px 22px", background: "white", flex: 1, minWidth: 0 }}>
        <div style={{ textAlign: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#0A0A0A", marginBottom: 2 }}>{res.contact?.name}</div>
          {contactParts.length > 0 && <div style={{ fontSize: 11, color: "#555" }}>{contactParts.join(" | ")}</div>}
        </div>

        {res.summary && (
          <>
            {sectionHdr("Summary")}
            <p style={{ fontSize: 12, color: "#222", margin: 0, ...styleFn(res.summary) }}>{res.summary}</p>
          </>
        )}

        {(res.skills ?? []).length > 0 && (
          <>
            {sectionHdr("Skills")}
            <div style={{ fontSize: 11.5, color: "#333", lineHeight: 1.7 }}>
              {res.skills!.map((s, i) => (
                <span key={i} style={{ marginRight: 4, display: "inline-block", ...styleFn(s) }}>
                  {s}{i < res.skills!.length - 1 ? " ·" : ""}
                </span>
              ))}
            </div>
          </>
        )}

        {(res.experience ?? []).length > 0 && (
          <>
            {sectionHdr("Experience")}
            {res.experience!.map((exp, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <strong style={{ fontSize: 12.5, color: "#111" }}>{exp.company}</strong>
                  <span style={{ fontSize: 11, color: "#666" }}>{exp.period}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
                  <em style={{ fontSize: 11.5, color: "#444" }}>{exp.title}</em>
                  {exp.location && <span style={{ fontSize: 11, color: "#888" }}>{exp.location}</span>}
                </div>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {(exp.bullets ?? []).map((b, bi) => (
                    <li key={bi} style={{ fontSize: 12, color: "#222", marginBottom: 2, ...styleFn(b) }}>{b}</li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}

        {(res.education ?? []).length > 0 && (
          <>
            {sectionHdr("Education")}
            {res.education!.map((e, i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <strong style={{ fontSize: 12, color: "#111", ...styleFn(`${e.degree}, ${e.school}`) }}>{e.school}</strong>
                  <span style={{ fontSize: 11, color: "#666" }}>{e.year}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <em style={{ fontSize: 11.5, color: "#444" }}>{e.degree}</em>
                  {e.location && <span style={{ fontSize: 11, color: "#888" }}>{e.location}</span>}
                </div>
                {e.notes && <div style={{ fontSize: 11, color: "#666", marginTop: 1 }}>• {e.notes}</div>}
              </div>
            ))}
          </>
        )}

        {(res.projects ?? []).length > 0 && (
          <>
            {sectionHdr("Projects")}
            {res.projects!.map((proj, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <strong style={{ fontSize: 12.5, color: "#111" }}>{proj.name}</strong>
                  {proj.period && <span style={{ fontSize: 11, color: "#666" }}>{proj.period}</span>}
                </div>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {(proj.bullets ?? []).map((b, bi) => (
                    <li key={bi} style={{ fontSize: 12, color: "#222", marginBottom: 2 }}>{b}</li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}

        {(res.certifications ?? []).length > 0 && (
          <>
            {sectionHdr("Certifications")}
            {res.certifications!.map((c, i) => (
              <div key={i} style={{ fontSize: 12, color: "#222", marginBottom: 2, ...styleFn(c) }}>• {c}</div>
            ))}
          </>
        )}

        {(res.achievements ?? []).length > 0 && (
          <>
            {sectionHdr("Achievements")}
            {res.achievements!.map((a, i) => (
              <div key={i} style={{ fontSize: 12, color: "#222", marginBottom: 2, ...styleFn(a) }}>• {a}</div>
            ))}
          </>
        )}
      </div>
    );
  };

  if (changedCount === 0) {
    return (
      <div className="p-6 text-center rounded-xl" style={{ backgroundColor: "#F8F9FA", border: "1px solid #E5E7EB" }}>
        <p className="text-sm" style={{ color: "#888" }}>No changes were applied — original and tailored resumes are identical.</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 10, padding: "8px 12px", background: "#F8F9FA", borderRadius: 6, border: "1px solid #E5E7EB", flexWrap: "wrap" as const }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#555" }}>
          <span style={{ background: "#FEE2E2", color: "#991B1B", textDecoration: "line-through", padding: "1px 7px", borderRadius: 3, fontSize: 11 }}>removed</span>
          Replaced text
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#555" }}>
          <span style={{ background: "#DCFCE7", color: "#166534", padding: "1px 7px", borderRadius: 3, fontSize: 11 }}>added</span>
          New or updated text
        </div>
        <div style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "#555" }}>
          {changedCount} change{changedCount !== 1 ? "s" : ""} applied
        </div>
      </div>
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" as const }}>
      <div style={{ display: "flex", gap: 0, border: "1px solid #E5E7EB", borderRadius: 8, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.08)", minWidth: 720 }}>
        <div style={{ flex: 1, minWidth: 0, borderRight: "2px solid #E5E7EB" }}>
          <div style={{ padding: "7px 16px", background: "#FEF2F2", borderBottom: "1px solid #FECACA", textAlign: "center" as const }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#991B1B", textTransform: "uppercase" as const, letterSpacing: "0.8px" }}>Original</span>
          </div>
          {panel(original, "left")}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ padding: "7px 16px", background: "#F0FDF4", borderBottom: "1px solid #BBF7D0", textAlign: "center" as const }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#166534", textTransform: "uppercase" as const, letterSpacing: "0.8px" }}>Tailored</span>
          </div>
          {panel(tailored, "right")}
        </div>
      </div>
      </div>
    </div>
  );
}

function Step5Export({ selectedJobs, resume, jobDiffs, savedVersionIds, onSaveVersion }: { selectedJobs: JobResult[]; resume: ResumeData; jobDiffs: Record<string, DiffChange[]>; savedVersionIds: Set<string>; onSaveVersion: (version: SavedVersion) => void | Promise<void> }) {
  const { user } = useAuth();
  const [exported, setExported] = useState<Set<string>>(new Set());
  const [coverLetters, setCoverLetters] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<Set<string>>(new Set());
  const [previewing, setPreviewing] = useState<Set<string>>(new Set());
  const [diffViewing, setDiffViewing] = useState<Set<string>>(new Set());
  const [downloadingDocx, setDownloadingDocx] = useState<Set<string>>(new Set());
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [shareLinks, setShareLinks] = useState<Record<string, string>>({});
  const [sharing, setSharing] = useState<Set<string>>(new Set());
  const [linkCopied, setLinkCopied] = useState<Set<string>>(new Set());
  const [savingJob, setSavingJob] = useState<string | null>(null);
  const [saveNames, setSaveNames] = useState<Record<string, string>>({});
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(new Set(savedVersionIds));
  const autoSavedJobIds = useRef<Set<string>>(new Set(savedVersionIds));
  const [campaignStatuses, setCampaignStatuses] = useState<Record<string, string>>(() => {
    if (!user?.id) return {};
    const campaigns = loadCampaigns(user.id);
    return Object.fromEntries(campaigns.map(c => [c.id, c.status ?? "Not Applied"]));
  });

  const tailoredResumes = useMemo(() => {
    const out: Record<string, ResumeData> = {};
    for (const job of selectedJobs) {
      out[job.id] = applyDiffs(resume, jobDiffs[job.id] ?? []);
    }
    return out;
  }, [resume, selectedJobs, jobDiffs]);

  useEffect(() => {
    selectedJobs.forEach(job => upsertCampaignFromJob(user?.id, job));
  }, [selectedJobs, user?.id]);

  useEffect(() => {
    selectedJobs.forEach(job => {
      const changes = jobDiffs[job.id] ?? [];
      if (changes.length === 0) return;
      // Only auto-save once all pending confirm rows have been reviewed
      const pendingCount = changes.filter(r => r.status === "confirm" && !r.confirmed).length;
      if (pendingCount > 0) return;
      if (autoSavedJobIds.current.has(job.id)) return;
      autoSavedJobIds.current.add(job.id);
      const version: SavedVersion = {
        id: `generated-${job.id}-${Date.now()}`,
        name: `${job.company} — ${job.title}`,
        resume: tailoredResumes[job.id] ?? resume,
        job,
        jobTitle: job.title,
        jobCompany: job.company,
        diffChanges: changes,
        sourceJobId: job.id,
        savedAt: Date.now(),
      };
      void Promise.resolve(onSaveVersion(version)).then(() => {
        setSavedJobIds(prev => new Set(prev).add(job.id));
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJobs, jobDiffs, resume, onSaveVersion]);

  const handleCopy = async (jobId: string) => {
    try {
      await navigator.clipboard.writeText(buildPlainTextResume(tailoredResumes[jobId] ?? resume));
      setCopied(prev => new Set(prev).add(jobId));
      setTimeout(() => setCopied(prev => { const s = new Set(prev); s.delete(jobId); return s; }), 2000);
    } catch { /* clipboard blocked in some iframes */ }
  };

  const handleCoverLetter = async (job: JobResult) => {
    if (generating.has(job.id) || coverLetters[job.id]) return;
    setGenerating(prev => new Set(prev).add(job.id));
    setCoverLetters(prev => ({ ...prev, [job.id]: "" }));

    const jobData: JobData = { id: job.id, title: job.title, company: job.company, location: job.location, description: job.description };
    await generateCoverLetter(tailoredResumes[job.id] ?? resume, jobData,
      (chunk) => setCoverLetters(prev => ({ ...prev, [job.id]: (prev[job.id] ?? "") + chunk })),
      () => setGenerating(prev => { const s = new Set(prev); s.delete(job.id); return s; })
    );
  };

  const togglePreview = (jobId: string) => {
    setDiffViewing(prev => { const s = new Set(prev); s.delete(jobId); return s; });
    setPreviewing(prev => {
      const s = new Set(prev);
      if (s.has(jobId)) s.delete(jobId); else s.add(jobId);
      return s;
    });
  };

  const toggleDiffView = (jobId: string) => {
    setPreviewing(prev => { const s = new Set(prev); s.delete(jobId); return s; });
    setDiffViewing(prev => {
      const s = new Set(prev);
      if (s.has(jobId)) s.delete(jobId); else s.add(jobId);
      return s;
    });
  };

  const handleDocx = async (job: JobResult) => {
    setDownloadingDocx(prev => new Set(prev).add(job.id));
    try {
      await handleDocxDownload(tailoredResumes[job.id] ?? resume, job);
      setExported(prev => new Set(prev).add(job.id));
    } finally {
      setDownloadingDocx(prev => { const s = new Set(prev); s.delete(job.id); return s; });
    }
  };

  const handleSaveVersion = (job: JobResult) => {
    const name = (saveNames[job.id] ?? "").trim() || `${job.company} — ${job.title}`;
    const version: SavedVersion = {
      id: `${job.id}-${Date.now()}`,
      name,
      resume: tailoredResumes[job.id] ?? resume,
      job,
      jobTitle: job.title,
      jobCompany: job.company,
      diffChanges: jobDiffs[job.id] ?? [],
      sourceJobId: job.id,
      savedAt: Date.now(),
    };
    void Promise.resolve(onSaveVersion(version));
    setSavedJobIds(prev => new Set(prev).add(job.id));
    setSavingJob(null);
  };

  const handleShare = async (job: JobResult) => {
    if (sharing.has(job.id)) return;
    if (shareLinks[job.id]) {
      const copied = await navigator.clipboard.writeText(shareLinks[job.id]).then(() => true).catch(() => false);
      if (copied) {
        setLinkCopied(prev => new Set(prev).add(job.id));
        setTimeout(() => setLinkCopied(prev => { const s = new Set(prev); s.delete(job.id); return s; }), 2000);
      }
      return;
    }
    setSharing(prev => new Set(prev).add(job.id));
    try {
      const { id } = await shareResume(tailoredResumes[job.id] ?? resume, job.title, job.company);
      const base = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "");
      const url = `${base}/r/${id}`;
      setShareLinks(prev => ({ ...prev, [job.id]: url }));
      const copied = await navigator.clipboard.writeText(url).then(() => true).catch(() => false);
      if (copied) setLinkCopied(prev => new Set(prev).add(job.id));
      setTimeout(() => setLinkCopied(prev => { const s = new Set(prev); s.delete(job.id); return s; }), 2000);
    } catch {
      // ignore
    } finally {
      setSharing(prev => { const s = new Set(prev); s.delete(job.id); return s; });
    }
  };

  return (
    <div className="flex-1 p-4 md:p-8 overflow-auto">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <div className="chip-mint inline-flex mb-3">Step 4 of 4</div>
          <h1 className="font-heading font-bold text-2xl md:text-3xl mb-2" style={{ color: "#0A0A0A" }}>Export</h1>
          <p className="text-base" style={{ color: "#666" }}>
            Preview your tailored resume before downloading. All confirmed changes are applied.
          </p>
        </div>

        <div className="mb-5 p-4 rounded-2xl flex items-start sm:items-center gap-3" style={{ backgroundColor: "#ECFFE0", border: "1px solid rgba(0,240,160,0.3)" }}>
          <Shield className="w-5 h-5 flex-shrink-0" style={{ color: "#00c447" }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: "#005A3D" }}>ATS-compliant output guaranteed</p>
            <p className="text-xs mt-0.5" style={{ color: "#00c447" }}>Single-column · Standard headers · No images · Keyword-optimised · Parseable by Workday, Greenhouse, Lever, iCIMS</p>
          </div>
        </div>

        <div className="space-y-6 mb-8">
          {selectedJobs.map(job => {
            const isExported = exported.has(job.id);
            const coverText = coverLetters[job.id];
            const isGenerating = generating.has(job.id);
            const isPreviewing = previewing.has(job.id);
            const isDiffViewing = diffViewing.has(job.id);
            const isDownloadingDocx = downloadingDocx.has(job.id);
            const color = companyColor(job.company);
            const tailored = tailoredResumes[job.id];
            const rows = jobDiffs[job.id] ?? [];
            const changedCount = rows.filter(r => r.status === "rewritten").length;
            return (
              <div key={job.id} className="card-base rounded-2xl overflow-hidden">
                <div className="p-4 md:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white" style={{ backgroundColor: color }}>{job.company[0]}</div>
                      <div className="min-w-0">
                        <p className="font-semibold" style={{ color: "#0A0A0A" }}>{job.title}</p>
                        <p className="text-sm" style={{ color: "#888" }}>{job.company} · {job.location}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {changedCount > 0 && (
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: "#DBEAFE", color: "#1E40AF" }}>
                          {changedCount} change{changedCount !== 1 ? "s" : ""} applied
                        </span>
                      )}
                      <span className="chip-green">Ready</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2 mb-3 [&>button]:min-h-[44px]">
                    <button
                      onClick={() => togglePreview(job.id)}
                      className="flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2 rounded-full transition-all"
                      style={{ backgroundColor: isPreviewing ? "#0A0A0A" : "#F0F0F0", color: isPreviewing ? "#fff" : "#444" }}
                    >
                      {isPreviewing ? <><EyeOff className="w-4 h-4" /> Hide preview</> : <><Eye className="w-4 h-4" /> Preview</>}
                    </button>
                    {changedCount > 0 && (
                      <button
                        onClick={() => toggleDiffView(job.id)}
                        className="flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2 rounded-full transition-all"
                        style={{ backgroundColor: isDiffViewing ? "#1E40AF" : "#DBEAFE", color: isDiffViewing ? "#fff" : "#1E40AF" }}
                      >
                        <Columns2 className="w-4 h-4" />
                        {isDiffViewing ? "Hide changes" : "Show changes"}
                      </button>
                    )}
                    <button
                      onClick={() => handleDocx(job)}
                      disabled={isDownloadingDocx}
                      className="flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2 rounded-full transition-all"
                      style={{ backgroundColor: isExported ? "#D1FAE5" : "#0A0A0A", color: isExported ? "#065F46" : "#fff", border: isExported ? "1px solid #6EE7B7" : "none" }}
                    >
                      {isDownloadingDocx ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</> : isExported ? <><Check className="w-4 h-4" /> Downloaded .docx</> : <><Download className="w-4 h-4" /> Download .docx</>}
                    </button>
                    <button
                      onClick={() => handlePdfDownload(tailored, job)}
                      className="flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2 rounded-full"
                      style={{ backgroundColor: "#F0F0F0", color: "#444" }}
                    >
                      <FileText className="w-4 h-4" /> Download PDF
                    </button>
                    <button onClick={() => handleCopy(job.id)}
                      className="flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2 rounded-full transition-all"
                      style={{ backgroundColor: copied.has(job.id) ? "#D1FAE5" : "#F0F0F0", color: copied.has(job.id) ? "#065F46" : "#444" }}>
                      {copied.has(job.id) ? <><Check className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy text</>}
                    </button>
                    <button onClick={() => handleCoverLetter(job)}
                      className="flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2 rounded-full transition-all"
                      style={{ backgroundColor: coverText ? "#DBEAFE" : "#ECFFE0", color: coverText ? "#1E40AF" : "#005A3D", border: coverText ? "1px solid #BFDBFE" : "1px solid rgba(0,240,160,0.3)" }}
                    >
                      {isGenerating ? <><Loader2 className="w-4 h-4 animate-spin" /> Drafting…</> : coverText ? <><Mail className="w-4 h-4" /> Cover Letter Ready</> : <><Mail className="w-4 h-4" /> Generate Cover Letter</>}
                    </button>
                    <button onClick={() => handleShare(job)}
                      disabled={sharing.has(job.id)}
                      className="flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2 rounded-full transition-all"
                      style={{ backgroundColor: linkCopied.has(job.id) ? "#D1FAE5" : shareLinks[job.id] ? "#ECFFE0" : "#F0F0F0", color: linkCopied.has(job.id) ? "#065F46" : shareLinks[job.id] ? "#005A3D" : "#444", border: shareLinks[job.id] ? "1px solid rgba(0,240,160,0.4)" : "none" }}
                    >
                      {sharing.has(job.id) ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating link…</> : linkCopied.has(job.id) ? <><Check className="w-4 h-4" /> Link copied!</> : shareLinks[job.id] ? <><Share2 className="w-4 h-4" /> Copy link</> : <><Share2 className="w-4 h-4" /> Share resume</>}
                    </button>
                    {savedJobIds.has(job.id) ? (
                      <button className="flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2 rounded-full"
                        style={{ backgroundColor: "#ECFFE0", color: "#005A3D", border: "1px solid rgba(0,240,160,0.4)" }}
                        onClick={() => { setSavedJobIds(prev => { const s = new Set(prev); s.delete(job.id); return s; }); setSavingJob(job.id); setSaveNames(prev => ({ ...prev, [job.id]: `${job.company} — ${job.title}` })); }}
                      >
                        <BookmarkCheck className="w-4 h-4" /> Saved
                      </button>
                    ) : savingJob === job.id ? null : (
                      <button className="flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2 rounded-full transition-all"
                        style={{ backgroundColor: "#F0F0F0", color: "#444" }}
                        onClick={() => { setSavingJob(job.id); setSaveNames(prev => ({ ...prev, [job.id]: `${job.company} — ${job.title}` })); }}
                      >
                        <Bookmark className="w-4 h-4" /> Save version
                      </button>
                    )}
                  </div>

                  {savingJob === job.id && (
                    <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2.5 rounded-xl" style={{ backgroundColor: "#F8F9FA", border: "1.5px solid rgba(0,240,160,0.5)" }}>
                      <BookmarkCheck className="w-4 h-4 flex-shrink-0" style={{ color: "#00c447" }} />
                      <input
                        autoFocus
                        className="flex-1 bg-transparent text-sm outline-none font-medium"
                        style={{ color: "#0A0A0A" }}
                        placeholder={`${job.company} — ${job.title}`}
                        value={saveNames[job.id] ?? `${job.company} — ${job.title}`}
                        onChange={e => setSaveNames(prev => ({ ...prev, [job.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === "Enter") handleSaveVersion(job); if (e.key === "Escape") setSavingJob(null); }}
                      />
                      <button onClick={() => handleSaveVersion(job)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: "#00F0A0", color: "#0A0A0A" }}>Save</button>
                      <button onClick={() => setSavingJob(null)}
                        className="text-xs px-2 py-1.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: "#F0F0F0", color: "#555" }}><X className="w-3.5 h-3.5" /></button>
                    </div>
                  )}

                  {shareLinks[job.id] && (
                    <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg min-w-0" style={{ backgroundColor: "#F8F9FA", border: "1px solid #E5E8EA" }}>
                      <Share2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#888" }} />
                      <span className="text-xs truncate flex-1 font-mono" style={{ color: "#555" }}>{shareLinks[job.id]}</span>
                      <button onClick={() => handleShare(job)} className="text-xs font-semibold flex-shrink-0 px-2 py-1 rounded" style={{ backgroundColor: "#ECFFE0", color: "#005A3D" }}>
                        {linkCopied.has(job.id) ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  )}
                </div>

                {isPreviewing && (
                  <div style={{ borderTop: "1px solid #F0F0F0", padding: "0 16px 16px" }}>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 pt-4">
                      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#888" }}>Resume Preview — with your confirmed changes applied</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handlePdfDownload(tailored, job)}
                          className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full"
                          style={{ backgroundColor: "#F0F0F0", color: "#444" }}
                        ><Download className="w-3 h-3" /> Download PDF</button>
                      </div>
                    </div>
                    <div style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.08)", borderRadius: 8, overflowX: "auto", WebkitOverflowScrolling: "touch" as const }}>
                      <div style={{ minWidth: 640 }}>
                        <ResumePreview resume={tailored} jobTitle={job.title} jobCompany={job.company} />
                      </div>
                    </div>
                  </div>
                )}

                {isDiffViewing && (
                  <div style={{ borderTop: "1px solid #F0F0F0", padding: "0 16px 16px" }}>
                    <div className="flex items-center justify-between mb-3 pt-4">
                      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#888" }}>Changes — original vs tailored</p>
                    </div>
                    <ResumeDiffView original={resume} tailored={tailored} rows={rows} />
                  </div>
                )}

                {coverText && (
                  <div className="mx-4 md:mx-5 mb-5 p-4 rounded-xl text-sm leading-relaxed whitespace-pre-wrap" style={{ backgroundColor: "#F8F9FF", border: "1px solid #BFDBFE", color: "#1E40AF" }}>
                    {coverText}
                    {isGenerating && <span className="inline-block w-1.5 h-4 ml-1 animate-pulse" style={{ backgroundColor: "#3B82F6" }} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {selectedJobs.length > 1 && (
          <div className="mb-8 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ backgroundColor: "#ECFFE0", border: "1px solid rgba(0,240,160,0.3)" }}>
            <div>
              <p className="font-semibold text-sm" style={{ color: "#005A3D" }}>Download all {selectedJobs.length} resumes</p>
              <p className="text-xs" style={{ color: "#00c447" }}>Packaged as a single .zip file</p>
            </div>
            <button
              className="btn-dark text-sm w-full sm:w-auto flex items-center justify-center gap-2"
              disabled={downloadingAll}
              onClick={async () => {
                setDownloadingAll(true);
                try {
                  await handleDownloadAllDocx(selectedJobs, tailoredResumes, resume);
                  setExported(new Set(selectedJobs.map(j => j.id)));
                } finally {
                  setDownloadingAll(false);
                }
              }}
            >
              {downloadingAll
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Packaging…</>
                : <><Download className="w-4 h-4" /> Download All (.zip)</>}
            </button>
          </div>
        )}

        <div className="card-base p-5 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-heading font-bold text-sm flex items-center gap-2" style={{ color: "#0A0A0A" }}>
              <Briefcase className="w-4 h-4" />Campaign Tracker
            </h3>
            <Link href="/campaigns" className="text-xs font-semibold flex items-center gap-1" style={{ color: "#00c447" }}>
              View all <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {selectedJobs.map(job => (
              <div key={job.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2 px-3 rounded-xl" style={{ backgroundColor: "#F8F9FA" }}>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: companyColor(job.company) }}>{job.company[0]}</div>
                  <span className="text-sm font-medium truncate max-w-[200px]" style={{ color: "#0A0A0A" }}>{job.title} @ {job.company}</span>
                </div>
                <select
                  className="text-xs font-semibold rounded-full px-2.5 py-1 border-0 outline-none cursor-pointer"
                  style={{ backgroundColor: "#F0F0F0", color: "#555" }}
                  value={campaignStatuses[job.id] ?? "Not Applied"}
                  onChange={e => {
                    const status = e.target.value;
                    setCampaignStatuses(prev => ({ ...prev, [job.id]: status }));
                    updateCampaignStatus(user?.id, job.id, status as CampaignStatus);
                  }}
                >
                  <option>Not Applied</option><option>Applied</option><option>Waiting</option>
                  <option>Interview</option><option>Offer</option><option>Rejected</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function AppWorkspace() {
  const { user, loading: authLoading } = useAuth();
  const storageScope = user?.id ?? ANONYMOUS_STORAGE_SCOPE;
  const [savedData, setSavedData] = useState<SavedResumeData | null>(() => loadSaved());
  const [step, setStep] = useState<Step>(1);
  const [completedSteps, setCompletedSteps] = useState<Set<Step>>(new Set());
  const [searchTitles, setSearchTitles] = useState<string[]>(["Staff Software Engineer", "Senior Software Engineer", "Backend Engineer"]);
  const [searchLocations, setSearchLocations] = useState<string[]>(["Remote (US)"]);
  const [selectedJobs, setSelectedJobs] = useState<JobResult[]>([]);
  const [resume, setResume] = useState<ResumeData>(savedData?.resume ?? ALEX);
  const [jobDiffs, setJobDiffs] = useState<Record<string, DiffChange[]>>({});
  const [savedVersions, setSavedVersions] = useState<SavedVersion[]>(() => loadVersions());
  const [creditBalance, setCreditBalance] = useState<CreditBalance | null>(null);
  const [buyCreditsOpen, setBuyCreditsOpen] = useState(false);
  const [discoverySearchRun, setDiscoverySearchRun] = useState(0);
  const [creditSkipNotice, setCreditSkipNotice] = useState("");

  const refreshCredits = useCallback(async () => {
    if (!user) {
      setCreditBalance(null);
      return null;
    }
    try {
      const next = await getCreditBalance();
      setCreditBalance(next);
      return next;
    } catch {
      return null;
    }
  }, [user]);

  useEffect(() => {
    void refreshCredits();
  }, [refreshCredits]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const localProfile = loadSaved();
      setSavedData(localProfile);
      setResume(localProfile?.resume ?? ALEX);
      setSavedVersions(loadVersions());
      return;
    }

    let cancelled = false;
    setSavedData(null);
    setResume(ALEX);
    setSavedVersions([]);
    setSelectedJobs([]);
    setJobDiffs({});
    (async () => {
      try {
        const [profile, generated] = await Promise.all([
          getSavedProfile(),
          getGeneratedResumes(),
        ]);
        if (cancelled) return;
        if (profile) {
          const nextProfile: SavedResumeData = {
            resume: profile.resume,
            recommendations: profile.recommendations,
            fileName: profile.fileName,
          };
          setSavedData(nextProfile);
          setResume(profile.resume);
          persistResume(nextProfile, user.id);
        } else {
          clearPersistedResume(user.id);
        }
        const versions = generated.map(record => ({
          id: record.id,
          name: record.name,
          resume: record.resume,
          job: record.job,
          jobTitle: record.jobTitle,
          jobCompany: record.jobCompany,
          diffChanges: record.diffChanges,
          sourceJobId: record.sourceJobId,
          savedAt: record.savedAt,
        }));
        setSavedVersions(versions);
        persistVersions(versions, user.id);
      } catch {
        if (cancelled) return;
        const scopedProfile = loadSaved(user.id);
        setSavedData(scopedProfile);
        setResume(scopedProfile?.resume ?? ALEX);
        setSavedVersions(loadVersions(user.id));
      }
    })();
    return () => { cancelled = true; };
  }, [authLoading, user?.id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      window.history.replaceState({}, "", window.location.pathname);
      const sessionId = params.get("session_id") ?? "";
      if (sessionId.startsWith("cs_")) {
        // Fulfill directly via Stripe API — doesn't depend on webhook timing
        fulfillCheckoutSession(sessionId)
          .catch(() => {})
          .finally(() => { void refreshCredits(); });
      } else {
        void refreshCredits();
      }
    }
  }, [refreshCredits]);

  const goTo = (n: Step) => {
    setCompletedSteps(prev => { const s = new Set(prev); s.add(step); return s; });
    setStep(n);
  };

  const handleJobsReady = useCallback(async (jobs: JobResult[]) => {
    setCreditSkipNotice("");
    const latest = await refreshCredits();
    if (latest && latest.balance <= 0) {
      setSelectedJobs([]);
      setBuyCreditsOpen(true);
      return;
    }
    const runnableJobs = latest ? jobs.slice(0, Math.min(jobs.length, latest.balance)) : jobs;
    const skippedCount = jobs.length - runnableJobs.length;
    if (skippedCount > 0) {
      setCreditSkipNotice(
        `${runnableJobs.length} resume${runnableJobs.length === 1 ? "" : "s"} will generate now. ${skippedCount} selected job${skippedCount === 1 ? "" : "s"} skipped because you have ${latest?.balance ?? 0} credit${latest?.balance === 1 ? "" : "s"} available.`
      );
    }
    setSelectedJobs(runnableJobs);
    goTo(4);
  }, [refreshCredits, step]);

  const handleParsed = (r: ResumeData, recs: SavedResumeData["recommendations"], fileName: string | null) => {
    const data = { resume: r, recommendations: recs, fileName };
    setResume(r);
    setSavedData(data);
    persistResume(data, storageScope);
    if (user) void saveProfile(data).catch(() => {});
  };

  const handleUpdateResume = (r: ResumeData) => {
    setResume(r);
    if (savedData) {
      const data = { ...savedData, resume: r };
      setSavedData(data);
      persistResume(data, storageScope);
      if (user) void saveProfile(data).catch(() => {});
    }
  };

  const handleClear = () => {
    clearPersistedResume(storageScope);
    setSavedData(null);
    setResume(ALEX);
    if (user) void clearSavedProfile().catch(() => {});
  };

  const handleSaveVersion = async (version: SavedVersion) => {
    const updated = addVersion(version, storageScope);
    setSavedVersions(updated);
    if (user) {
      await saveGeneratedResume({
        id: version.id,
        name: version.name,
        resume: version.resume,
        job: version.job,
        jobTitle: version.jobTitle,
        jobCompany: version.jobCompany,
        diffChanges: version.diffChanges,
        sourceJobId: version.sourceJobId,
        savedAt: version.savedAt,
      }).catch(() => {});
    }
  };

  const handleDeleteVersion = (id: string) => {
    const updated = removeVersion(id, storageScope);
    setSavedVersions(updated);
    if (user) void deleteGeneratedResume(id).catch(() => {});
  };

  const savedVersionIds = new Set(
    savedVersions
      .map(v => selectedJobs.find(j => v.jobTitle === j.title && v.jobCompany === j.company)?.id)
      .filter(Boolean) as string[]
  );

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#F2F4F5", color: "#0A0A0A" }}>
        <div className="flex items-center gap-3 text-sm font-semibold">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading your workspace...
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: "#F2F4F5" }}>
      <Sidebar step={step} setStep={setStep} completedSteps={completedSteps} resume={resume} credits={creditBalance} onBuyCredits={() => setBuyCreditsOpen(true)} />
      <main className="flex-1 min-h-screen overflow-hidden flex flex-col pb-16 md:pb-0 md:ml-64">
        {/* Promo banner for signed-out users */}
        {!user && !authLoading && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5"
            style={{ backgroundColor: "#052e16", borderBottom: "1px solid rgba(0,240,160,0.2)" }}>
            <div className="flex items-center gap-2 min-w-0">
              <Zap className="w-4 h-4 flex-shrink-0" style={{ color: "#00F0A0" }} />
              <span className="text-sm font-semibold" style={{ color: "#A7F3D0" }}>
                Limited promo: Sign in to get <strong style={{ color: "#00F0A0" }}>10 free resume credits</strong> — no card required.
              </span>
            </div>
            <Link href="/signin"
              className="flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-90"
              style={{ backgroundColor: "#00F0A0", color: "#0A0A0A" }}
            >
              Sign in free
            </Link>
          </div>
        )}
        {step === 1 && (
          <Step1Vault key={savedData?.fileName ?? user?.id ?? "local-vault"} resume={resume} savedData={savedData} savedVersions={savedVersions} credits={creditBalance} onBuyCredits={() => setBuyCreditsOpen(true)} onParsed={handleParsed} onClear={handleClear} onDeleteVersion={handleDeleteVersion} onDirectJobs={(jobs) => { void handleJobsReady(jobs); }} onUpdateResume={handleUpdateResume} onNext={(titles, locations) => {
            setSearchTitles(titles);
            setSearchLocations(locations);
            setDiscoverySearchRun(n => n + 1);
            goTo(3);
          }} />
        )}
        {step === 3 && (
          <Step3Discovery titles={searchTitles} location={searchLocations.join("|")} resume={resume} autoSearchRun={discoverySearchRun}
            onNext={(jobs) => { void handleJobsReady(jobs); }} />
        )}
        {step === 4 && (
          !user
            ? (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center max-w-sm">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ backgroundColor: "#ECFFE0" }}>
                    <Zap className="w-8 h-8" style={{ color: "#00c447" }} />
                  </div>
                  <h2 className="font-heading font-bold text-xl mb-2" style={{ color: "#0A0A0A" }}>Sign in to tailor your resume</h2>
                  <p className="text-sm mb-1" style={{ color: "#666" }}>
                    Create a free account and get <strong>10 resume credits</strong> — enough to tailor 10 jobs.
                  </p>
                  <p className="text-xs mb-6" style={{ color: "#9CA3AF" }}>No credit card required. Limited promo offer.</p>
                  <Link href="/signin" className="btn-mint inline-flex items-center gap-2">
                    Sign in &amp; claim 10 free credits <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            )
            : selectedJobs.length === 0
              ? <NoDataGuard message="No jobs selected yet." action="Go to Job Discovery" onAction={() => setStep(3)} />
              : <Step4Review selectedJobs={selectedJobs} resume={resume} creditSkipNotice={creditSkipNotice} onBuyCredits={() => setBuyCreditsOpen(true)} onCreditsUpdated={refreshCredits} onNext={(diffs) => { setJobDiffs(diffs); goTo(5); }} user={user} onAutoSave={handleSaveVersion} onUpdateResume={handleUpdateResume} />
        )}
        {step === 5 && (
          selectedJobs.length === 0
            ? <NoDataGuard message="No tailored resumes yet." action="Start from Job Discovery" onAction={() => setStep(3)} />
            : <Step5Export selectedJobs={selectedJobs} resume={resume} jobDiffs={jobDiffs} savedVersionIds={savedVersionIds} onSaveVersion={handleSaveVersion} />
        )}
      </main>
      <MobileBottomNav step={step} setStep={setStep} completedSteps={completedSteps} />
      <BuyCreditsModal open={buyCreditsOpen} onClose={() => setBuyCreditsOpen(false)} credits={creditBalance} onCreditsUpdated={refreshCredits} />
    </div>
  );
}
