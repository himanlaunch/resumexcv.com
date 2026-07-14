import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
  Upload, Search, CheckSquare, ArrowRight,
  Shield, Zap, Target, ChevronRight,
  Check, X, Sparkles, FileText, Layers, ListChecks
} from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { createCheckout } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
  { label: "Blog", href: "/blog" },
];

const STATS = [
  { value: "100", label: "Job links per batch" },
  { value: "100", label: "Custom resumes" },
  { value: "Parallel", label: "Generation flow" },
  { value: "You", label: "Approve every change" },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    icon: <Upload className="w-6 h-6" />,
    title: "Upload once",
    desc: "Drop in your existing resume. We parse it into structured, reusable career data - personal info, achievements, roles - so nothing has to be retyped.",
  },
  {
    step: "02",
    icon: <Search className="w-6 h-6" />,
    title: "Add your targets",
    desc: "Paste job URLs directly, or search live openings by title and location. Select as many as you want - 10, 50, 100.",
  },
  {
    step: "03",
    icon: <CheckSquare className="w-6 h-6" />,
    title: "Generate, review, download",
    desc: "Every resume is tailored independently in parallel. Accept, tweak, or reject each AI suggestion line by line. Export polished, ATS-ready DOCX or PDF for every job.",
  },
];

const FEATURES = [
  {
    icon: <Layers className="w-5 h-5" />,
    title: "Built for real application volume",
    desc: "Most AI resume tools tailor one job at a time and call it a workflow. ResumeX100 is built for the 50+ applications a serious job search actually requires.",
  },
  {
    icon: <Target className="w-5 h-5" />,
    title: "Every resume is independently analyzed",
    desc: "Each job gets its own rewrite: different emphasis, different keywords pulled forward, and different framing of the same true experience.",
  },
  {
    icon: <Zap className="w-5 h-5" />,
    title: "Parallel generation in minutes",
    desc: "Paste your jobs and start the batch. The app generates tailored resumes in parallel instead of making you wait through one resume at a time.",
  },
  {
    icon: <Shield className="w-5 h-5" />,
    title: "You approve every change",
    desc: "Every AI-suggested edit is shown individually. Accept it, edit it, or reject it before anything becomes final.",
  },
  {
    icon: <FileText className="w-5 h-5" />,
    title: "ATS-ready outputs",
    desc: "Export clean DOCX or PDF files designed for common applicant tracking systems, without fragile layouts that can break parsing.",
  },
  {
    icon: <ListChecks className="w-5 h-5" />,
    title: "Job discovery when you need it",
    desc: "Paste your own links or let the job search flow find live postings by title and location, then tailor against the actual role text.",
  },
];

const TESTIMONIALS = [
  {
    quote: "I'd been applying for 6 weeks with zero callbacks. I uploaded my resume, added 20 job links, and ran my first batch on a Sunday night. By Thursday I had 4 interview requests. I genuinely don't know why I didn't do this sooner.",
    name: "Priya S.",
    title: "Software Engineer",
    highlight: "4 interviews in one week",
  },
  {
    quote: "Landed a $140k offer at a fintech company after two months of rejections. The difference was having a resume that actually spoke to each job's priorities instead of a generic one I'd been recycling. ResumeX100 made tailoring 50 applications actually feasible.",
    name: "Marcus T.",
    title: "Product Manager",
    highlight: "Landed a $140k role",
  },
  {
    quote: "My resume went from 0 callbacks to 4 in a single month. I was applying to senior marketing roles and kept getting ghosted. Once I started sending tailored versions that mirrored the job description language, something clicked. The ATS score improvement alone was worth it.",
    name: "Jordan L.",
    title: "Senior Marketing Manager",
    highlight: "0 to 4 callbacks in one month",
  },
  {
    quote: "As someone switching from academia to industry, I had no idea how to translate my research experience for different roles. ResumeX100 helped me generate versions that emphasized the right things depending on whether I was applying to a data science role vs. a research scientist role. Got 3 offers in 6 weeks.",
    name: "Aisha R.",
    title: "Data Scientist (Career Changer)",
    highlight: "3 offers in 6 weeks",
  },
];

const COMPARISON = [
  { label: "Designed for 10, 50, or 100 jobs", others: false, us: true },
  { label: "Tailors every resume independently", others: false, us: true },
  { label: "Generates batches in parallel", others: false, us: true },
  { label: "Shows each suggested change for approval", others: false, us: true },
  { label: "Uses the actual job posting text", others: false, us: true },
  { label: "Forces one job at a time", others: true, us: false },
];

interface PricingPlan {
  id: string | null;
  credits: number;
  price: string;
  label: string;
  popular: boolean;
  savings?: string;
}

const PRICING: PricingPlan[] = [
  { id: null, credits: 10, price: "Free", label: "First 10 Resumes Free", popular: false },
  { id: null, credits: 30, price: "$9.99", label: "30 resume credits", popular: true },
  { id: null, credits: 100, price: "$19.99", label: "100 resume credits", popular: false },
];

function normalizePricingPlans(prices?: PricingPlan[]) {
  const paidPlans = prices?.filter((plan) => plan.credits === 30 || plan.credits === 100)
    .sort((a, b) => a.credits - b.credits) ?? [];
  const thirtyCreditPlan = paidPlans.find((plan) => plan.credits === 30);
  const hundredCreditPlan = paidPlans.find((plan) => plan.credits === 100);

  return [
    PRICING[0],
    {
      ...PRICING[1],
      id: thirtyCreditPlan?.id ?? PRICING[1].id,
      price: thirtyCreditPlan?.price && thirtyCreditPlan.price !== "Batch" ? thirtyCreditPlan.price : PRICING[1].price,
      label: thirtyCreditPlan?.label ?? PRICING[1].label,
      popular: thirtyCreditPlan?.popular ?? PRICING[1].popular,
      savings: thirtyCreditPlan?.savings,
    },
    {
      ...PRICING[2],
      id: hundredCreditPlan?.id ?? PRICING[2].id,
      price: hundredCreditPlan?.price && hundredCreditPlan.price !== "Batch" ? hundredCreditPlan.price : PRICING[2].price,
      label: hundredCreditPlan?.label ?? PRICING[2].label,
      popular: hundredCreditPlan?.popular ?? PRICING[2].popular,
      savings: hundredCreditPlan?.savings,
    },
  ];
}

function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-200"
      style={{
        backgroundColor: scrolled ? "rgba(242,244,245,0.95)" : "transparent",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        borderBottom: scrolled ? "1px solid #E5E8EA" : "none",
      }}
    >
      <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 h-14 md:h-16 flex items-center justify-between gap-3">
        <Link href="/" className="flex min-w-0 items-center">
          <BrandLogo className="max-w-[142px] sm:max-w-[180px] md:max-w-none overflow-hidden" imageClassName="h-8 sm:h-9 md:h-10" />
        </Link>
        <div className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((l) => (
            <a key={l.label} href={l.href} className="text-sm font-medium transition-colors" style={{ color: "#444" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#0A0A0A")}
              onMouseLeave={e => (e.currentTarget.style.color = "#444")}
            >{l.label}</a>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2 md:gap-3">
          <Link
            href="/signin"
            className="hidden md:flex items-center justify-center rounded-full border border-black px-5 text-sm font-semibold transition-colors hover:bg-black hover:text-white"
            style={{ minHeight: 44 }}
          >
            Sign In
          </Link>
          <Link href="/app" className="btn-mint text-xs sm:text-sm" style={{ padding: "0.45rem 0.75rem", minHeight: 40 }}>Start Free</Link>
        </div>
      </div>
    </nav>
  );
}

function HeroSection() {
  return (
    <section className="pt-20 sm:pt-24 md:pt-28 pb-14 md:pb-20 px-4 md:px-6 relative overflow-hidden" style={{ backgroundColor: "#F2F4F5" }}>
      <div className="absolute inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(0,240,160,0.12) 0%, transparent 70%)"
      }} />
      <div className="max-w-6xl mx-auto w-full">
        <div className="grid md:grid-cols-2 gap-8 md:gap-12 items-center">
          <div className="animate-slide-up min-w-0">
            <div className="chip-mint inline-flex max-w-full flex-wrap mb-5">
              <Sparkles className="w-3 h-3" style={{ color: "#00F0A0" }} />
              Parallel resume tailoring for real job searches
            </div>
            <h1 className="font-heading font-bold leading-tight mb-5 sm:mb-6" style={{ fontSize: "clamp(2.05rem, 8.5vw, 3.6rem)", color: "#0A0A0A", overflowWrap: "break-word" }}>
              100X your job search.<br />
              <span style={{ color: "#00B879" }}>One click. Get up to 100 tailored resumes.</span>
            </h1>
            <p className="text-base sm:text-lg leading-relaxed mb-7 sm:mb-8" style={{ color: "#444", maxWidth: 480 }}>
              Paste your job links - or let us find them. ResumeX100 generates a uniquely tailored,
              ATS-optimized resume for every single role, in parallel, in minutes. Not a keyword swap.
              A real rewrite, every time.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mb-8">
              <Link href="/app" className="btn-mint w-full sm:w-auto justify-center text-center" style={{ fontSize: "1rem", padding: "0.75rem 1.25rem" }}>
                Tailor My First 10 Resumes Free <ArrowRight className="w-4 h-4" />
              </Link>
              <a href="#how-it-works" className="btn-outline-dark w-full sm:w-auto justify-center text-center" style={{ fontSize: "1rem", padding: "0.75rem 1.25rem" }}>
                See how it works
              </a>
            </div>
            <p className="text-sm" style={{ color: "#888" }}>Tailor up to 10 resumes free. No card required.</p>
          </div>

          <div className="relative animate-fade-in min-w-0 w-full">
            <div className="card-base p-4 sm:p-5 w-full max-w-full overflow-hidden" style={{ borderRadius: 16 }}>
              <div className="flex min-w-0 items-center gap-2 mb-4 pb-3" style={{ borderBottom: "1px solid #F0F0F0" }}>
                <div className="flex gap-1.5">
                  {["#FF5F57","#FEBC2E","#28C840"].map(c => (
                    <div key={c} className="w-3 h-3 rounded-full" style={{ backgroundColor: c }} />
                  ))}
                </div>
                <span className="min-w-0 truncate text-xs font-medium" style={{ color: "#999" }}>ResumeX100 - Batch Workspace</span>
              </div>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg" style={{ backgroundColor: "#F8F9FA" }}>
                  <div className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: "#00c447" }}>10</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">10 tailored resumes generating</div>
                    <div className="truncate text-xs" style={{ color: "#888" }}>LinkedIn, Greenhouse, Lever, Indeed</div>
                  </div>
                  <div className="chip-mint shrink-0">Parallel</div>
                </div>
                {[
                  { label: "Product Data Analyst @ Acme", status: "Ready", cls: "chip-green" },
                  { label: "AI Engineer @ Northstar", status: "Review", cls: "chip-blue" },
                  { label: "Analytics Engineer @ Bright", status: "Generating", cls: "chip-amber" },
                ].map((r, i) => (
                  <div key={i} className="flex min-w-0 items-center justify-between gap-2 p-3 rounded-lg" style={{ backgroundColor: i === 2 ? "#FFFBEB" : "#FAFAFA", border: i === 2 ? "1px solid #FDE68A" : "1px solid #F0F0F0" }}>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: "#444" }}>{r.label}</span>
                    <span className={`${r.cls} shrink-0`} style={{ fontSize: "0.68rem" }}>{r.status}</span>
                  </div>
                ))}
                <div className="mt-3 p-3 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1" style={{ backgroundColor: "#ECFFE0", border: "1px solid rgba(0,240,160,0.3)" }}>
                  <span className="text-xs font-semibold" style={{ color: "#065F46" }}>Every role gets its own rewrite</span>
                  <span className="text-xs font-bold" style={{ color: "#00c447" }}>You approve the final text</span>
                </div>
              </div>
            </div>
            <div className="hidden sm:flex absolute -bottom-3 -right-3 card-base px-3 py-2 items-center gap-2" style={{ borderRadius: 10 }}>
              <Shield className="w-4 h-4" style={{ color: "#00c447" }} />
              <span className="text-xs font-semibold">ATS-ready DOCX and PDF</span>
            </div>
          </div>
        </div>

        <div className="mt-12 md:mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
          {STATS.map((s) => (
            <div key={s.value} className="text-center">
              <div className="font-heading font-bold text-3xl mb-1" style={{ color: "#0A0A0A" }}>{s.value}</div>
              <div className="text-sm" style={{ color: "#777" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProblemShiftSection() {
  return (
    <section className="py-16 md:py-20 px-4 md:px-6" style={{ backgroundColor: "#fff" }}>
      <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-8">
        <div className="p-8 md:p-10 rounded-2xl" style={{ backgroundColor: "#0A0A0A", color: "#fff" }}>
          <div className="chip-mint inline-flex mb-5">The problem</div>
          <h2 className="font-heading font-bold text-4xl md:text-5xl mb-5">
            One resume. A hundred rejections.
          </h2>
          <p className="text-base md:text-lg leading-relaxed" style={{ color: "#D1D5DB" }}>
            You're not under-qualified. You're under-tailored. Recruiters and ATS systems are trained to spot generic.
            Hand-tailoring one resume per job takes 20-30 minutes. Multiply that by the 50+ applications a real
            job search requires, and most people quit tailoring by application #4.
          </p>
        </div>
        <div className="p-8 md:p-10 rounded-2xl" style={{ backgroundColor: "#ECFFE0", border: "1px solid rgba(0,240,160,0.35)" }}>
          <div className="chip-mint inline-flex mb-5">The shift</div>
          <h2 className="font-heading font-bold text-4xl md:text-5xl mb-5" style={{ color: "#0A0A0A" }}>
            What if tailoring wasn't the bottleneck?
          </h2>
          <p className="text-base md:text-lg leading-relaxed" style={{ color: "#374151" }}>
            ResumeX100 doesn't make you choose between fast and good. Drop in your existing resume once, then add
            your target jobs. Every resume is independently analyzed against that specific job description:
            different emphasis, different keywords, different framing of the same true experience.
          </p>
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-16 md:py-20 px-4 md:px-6" style={{ backgroundColor: "#F2F4F5" }}>
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-14">
          <div className="chip-mint inline-flex mb-4">How it works</div>
          <h2 className="font-heading font-bold text-4xl md:text-5xl mb-4" style={{ color: "#0A0A0A" }}>
            Upload, target, generate.
          </h2>
          <p className="text-lg" style={{ color: "#666", maxWidth: 520, margin: "0 auto" }}>
            The workflow mirrors a real job search: one resume in, many tailored resumes out.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {HOW_IT_WORKS.map((step, i) => (
            <div key={i} className="card-base p-6 relative" style={{ borderRadius: 14 }}>
              <div
                className="font-heading font-bold text-5xl mb-4"
                style={{
                  color: "#047857",
                  lineHeight: 1,
                  textShadow: "0 1px 0 rgba(255,255,255,0.75)",
                }}
              >
                {step.step}
              </div>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ backgroundColor: "#ECFFE0", color: "#0A0A0A" }}>
                {step.icon}
              </div>
              <h3 className="font-heading font-bold text-lg mb-2" style={{ color: "#0A0A0A" }}>{step.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: "#666" }}>{step.desc}</p>
              {i < HOW_IT_WORKS.length - 1 && (
                <div className="hidden lg:block absolute top-10 -right-3 z-10">
                  <ChevronRight className="w-6 h-6" style={{ color: "#00F0A0" }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section id="features" className="py-16 md:py-20 px-4 md:px-6" style={{ backgroundColor: "#0A0A0A" }}>
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-14">
          <div className="chip-mint inline-flex mb-4">Why it is different</div>
          <h2 className="font-heading font-bold text-4xl md:text-5xl mb-4" style={{ color: "#fff" }}>
            Built for volume without losing depth.
          </h2>
          <p className="text-lg" style={{ color: "#999", maxWidth: 520, margin: "0 auto" }}>
            Most AI resume tools tailor one job at a time and call it a workflow. We built for the scale
            a real job search actually requires.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => (
            <div key={i} className="p-6 rounded-2xl" style={{ backgroundColor: "#161616", border: "1px solid #222" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ backgroundColor: "rgba(0,240,160,0.1)", color: "#00F0A0" }}>
                {f.icon}
              </div>
              <h3 className="font-heading font-bold text-base mb-2" style={{ color: "#fff" }}>{f.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: "#888" }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ComparisonSection() {
  return (
    <section className="py-16 md:py-20 px-4 md:px-6" style={{ backgroundColor: "#F2F4F5" }}>
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="font-heading font-bold text-4xl md:text-5xl mb-4" style={{ color: "#0A0A0A" }}>
            Real batch tailoring,<br />not a template spinner.
          </h2>
        </div>
        <div className="card-base overflow-x-auto" style={{ borderRadius: 16, WebkitOverflowScrolling: "touch" }}>
          <div className="min-w-[560px]">
          <div className="grid grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)] text-center py-4 px-4 md:px-6 text-sm font-semibold" style={{ backgroundColor: "#F8F9FA", borderBottom: "1px solid #E5E8EA" }}>
            <div className="text-left" style={{ color: "#888" }}>Feature</div>
            <div style={{ color: "#888" }}>Most tools</div>
            <div style={{ color: "#0A0A0A" }}>ResumeX100</div>
          </div>
          {COMPARISON.map((row, i) => (
            <div key={i} className="grid grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)] items-center py-3.5 px-4 md:px-6 text-sm" style={{ backgroundColor: i % 2 === 0 ? "white" : "#FAFAFA", borderBottom: i < COMPARISON.length - 1 ? "1px solid #F0F0F0" : "none" }}>
              <div className="font-medium" style={{ color: "#333" }}>{row.label}</div>
              <div className="flex justify-center">
                {row.others
                  ? <Check className="w-5 h-5" style={{ color: "#22C55E" }} />
                  : <X className="w-5 h-5" style={{ color: "#EF4444" }} />
                }
              </div>
              <div className="flex justify-center">
                {row.us
                  ? <Check className="w-5 h-5" style={{ color: "#00c447" }} />
                  : <X className="w-5 h-5" style={{ color: "#EF4444" }} />
                }
              </div>
            </div>
          ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TestimonialsSection() {
  return (
    <>
      {/* Social proof: real testimonials */}
      <section className="py-16 md:py-20 px-4 md:px-6" style={{ backgroundColor: "#fff" }}>
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <div className="chip-mint inline-flex mb-4">Real results</div>
            <h2 className="font-heading font-bold text-4xl md:text-5xl mb-4" style={{ color: "#0A0A0A" }}>
              From zero callbacks to multiple offers.
            </h2>
            <p className="text-lg" style={{ color: "#666", maxWidth: 560, margin: "0 auto" }}>
              Job seekers who switched to tailored applications at scale.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className="card-base p-6 md:p-7 rounded-2xl flex flex-col gap-4">
                <div className="inline-flex self-start px-3 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: "#ECFFE0", color: "#047857" }}>
                  {t.highlight}
                </div>
                <blockquote className="text-sm md:text-base leading-relaxed flex-1" style={{ color: "#444" }}>
                  "{t.quote}"
                </blockquote>
                <div className="flex items-center gap-3 pt-2" style={{ borderTop: "1px solid #F0F0F0" }}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0" style={{ backgroundColor: "#00c447" }}>
                    {t.name.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-semibold" style={{ color: "#0A0A0A" }}>{t.name}</div>
                    <div className="text-xs" style={{ color: "#888" }}>{t.title}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust and control */}
      <section className="py-16 md:py-20 px-4 md:px-6" style={{ backgroundColor: "#F2F4F5" }}>
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <div className="chip-mint inline-flex mb-4">Trust and control</div>
            <h2 className="font-heading font-bold text-4xl mb-4" style={{ color: "#0A0A0A" }}>
              You're still in control.
            </h2>
            <p className="text-lg" style={{ color: "#666", maxWidth: 620, margin: "0 auto" }}>
              We tailor faster than a human can. We do not replace your judgment about your own career.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="card-base p-8" style={{ borderRadius: 16 }}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-5" style={{ backgroundColor: "#ECFFE0", color: "#047857" }}>
                <Shield className="w-6 h-6" />
              </div>
              <h3 className="font-heading font-bold text-2xl mb-3" style={{ color: "#0A0A0A" }}>Every change is visible.</h3>
              <p className="text-base leading-relaxed" style={{ color: "#555" }}>
                Every AI-suggested change is shown individually. Accept it, edit it, or reject it.
                ResumeX100 never auto-submits anything you have not reviewed.
              </p>
            </div>
            <div className="card-base p-8" style={{ borderRadius: 16 }}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-5" style={{ backgroundColor: "#ECFFE0", color: "#047857" }}>
                <Sparkles className="w-6 h-6" />
              </div>
              <h3 className="font-heading font-bold text-2xl mb-3" style={{ color: "#0A0A0A" }}>Built on real AI, not templates.</h3>
              <p className="text-base leading-relaxed" style={{ color: "#555" }}>
                Each resume is generated against the actual text of the job posting, not a generic
                "tech resume" or "marketing resume" template.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function PricingSection() {
  const { loading: authLoading, user } = useAuth();
  const [plans, setPlans] = useState<PricingPlan[]>(PRICING);
  const [source, setSource] = useState<"fallback" | "stripe">("fallback");
  const [checkoutPriceId, setCheckoutPriceId] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/billing/prices")
      .then((res) => res.ok ? res.json() : Promise.reject(new Error("Pricing unavailable")))
      .then((data: { source?: "fallback" | "stripe"; prices?: PricingPlan[] }) => {
        if (cancelled) return;
        setPlans(normalizePricingPlans(data.prices));
        setSource(data.source ?? "fallback");
      })
      .catch(() => {
        if (!cancelled) {
          setPlans(PRICING);
          setSource("fallback");
        }
      });
    return () => { cancelled = true; };
  }, []);

  const startCheckout = async (plan: PricingPlan) => {
    if (plan.credits === 5) {
      window.location.href = "/app";
      return;
    }
    if (!plan.id) {
      setCheckoutError("Stripe checkout is not ready yet. Please try again in a moment.");
      return;
    }
    if (authLoading) {
      setCheckoutError("Checking your sign-in status. Please try again in a moment.");
      return;
    }
    if (!user) {
      window.location.href = `/signin?checkoutPriceId=${encodeURIComponent(plan.id)}`;
      return;
    }
    setCheckoutError("");
    setCheckoutPriceId(plan.id);
    try {
      const { url } = await createCheckout(plan.id);
      window.location.href = url;
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : "Could not start checkout.");
    } finally {
      setCheckoutPriceId(null);
    }
  };

  return (
    <section id="pricing" className="py-16 md:py-20 px-4 md:px-6" style={{ backgroundColor: "#0A0A0A" }}>
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <div className="chip-mint inline-flex mb-4">Simple, honest pricing</div>
          <h2 className="font-heading font-bold text-4xl md:text-5xl mb-4" style={{ color: "#fff" }}>
            Pay for outcomes,<br />not seats.
          </h2>
          <p className="text-lg" style={{ color: "#999" }}>
            Start with 10 tailored resumes free, then buy 30 or 100 credits when you need more.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-4 max-w-5xl mx-auto">
          {plans.map((p, i) => {
            const isPaid = p.credits !== 5;
            const isOpeningCheckout = isPaid && checkoutPriceId !== null && checkoutPriceId === p.id;
            const isFree = p.credits === 5;
            return (
              <div key={i} className="relative overflow-hidden rounded-2xl p-5" style={{
                background: isFree
                  ? "linear-gradient(145deg, #45E6A0 0%, #22D887 100%)"
                  : "linear-gradient(145deg, #52F2AA 0%, #22D887 100%)",
                border: "1px solid rgba(255,255,255,0.16)",
                boxShadow: p.popular ? "0 18px 50px rgba(0,240,160,0.22)" : "0 14px 36px rgba(0,0,0,0.18)",
              }}>
                <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: p.popular ? "#0A0A0A" : "rgba(10,10,10,0.18)" }} />
                {p.popular && <div className="absolute top-3 right-3 text-[0.65rem] font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: "#0A0A0A", color: "#00F0A0" }}>Most Popular</div>}
                {p.savings && (
                  <div className="text-xs font-semibold mb-3 px-2 py-1 rounded-full inline-block" style={{ backgroundColor: "rgba(0,0,0,0.12)", color: "#0A0A0A" }}>{p.savings}</div>
                )}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <div className="font-heading font-bold text-4xl md:text-5xl leading-none" style={{ color: "#0A0A0A" }}>{p.price}</div>
                    <div className="text-base font-bold mt-2" style={{ color: "#0A0A0A" }}>{p.label}</div>
                  </div>
                </div>
                <div className="text-sm font-medium mb-4 min-h-[2.5rem]" style={{ color: "#064E3B" }}>
                  {p.credits === 5
                    ? "No card required. Upload your resume and generate your first tailored batch."
                    : `Use credits across one or more batches, up to ${p.credits} tailored resumes.`}
                </div>
                <button
                  type="button"
                  onClick={() => void startCheckout(p)}
                  disabled={isOpeningCheckout}
                  className="btn-dark w-full"
                  style={{ justifyContent: "center", display: "flex", opacity: isOpeningCheckout ? 0.7 : 1, minHeight: 42, padding: "0.55rem 1rem" }}
                >
                  {isOpeningCheckout ? "Opening Stripe..." : p.credits === 5 ? "Start free" : "Buy Now"}
                </button>
              </div>
            );
          })}
        </div>
        {checkoutError && (
          <p className="text-center text-sm mt-5" style={{ color: "#FCA5A5" }}>{checkoutError}</p>
        )}
        <p className="text-center text-sm mt-6" style={{ color: "#666" }}>
          Stripe pricing loads automatically when live prices are configured.
          {source === "stripe" ? " Prices are loaded from Stripe." : ""}
        </p>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="py-16 md:py-20 px-4 md:px-6" style={{ backgroundColor: "#00F0A0" }}>
      <div className="max-w-2xl mx-auto text-center">
        <h2 className="font-heading font-bold text-4xl md:text-5xl mb-5" style={{ color: "#0A0A0A" }}>
          Stop hand-tailoring one resume at a time.
        </h2>
        <p className="text-lg mb-8" style={{ color: "rgba(0,0,0,0.65)" }}>
          Apply at the scale your job search actually needs.
        </p>
        <Link href="/app" className="btn-dark" style={{ fontSize: "1.05rem", padding: "0.85rem 2.5rem" }}>
          Generate My First Batch Free <ArrowRight className="w-5 h-5" />
        </Link>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="py-10 px-6" style={{ backgroundColor: "#0A0A0A", borderTop: "1px solid #1a1a1a" }}>
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center">
          <BrandLogo onDark imageClassName="h-9" />
        </div>
        <div className="flex gap-6 text-sm" style={{ color: "#666" }}>
          <a href="#features" style={{ color: "#666" }} onMouseEnter={e => (e.currentTarget.style.color = "#fff")} onMouseLeave={e => (e.currentTarget.style.color = "#666")}>Features</a>
          <a href="#pricing" style={{ color: "#666" }} onMouseEnter={e => (e.currentTarget.style.color = "#fff")} onMouseLeave={e => (e.currentTarget.style.color = "#666")}>Pricing</a>
          <Link href="/blog" style={{ color: "#666" }}>Blog</Link>
          <Link href="/privacy" style={{ color: "#666" }}>Privacy</Link>
          <Link href="/terms" style={{ color: "#666" }}>Terms</Link>
          <Link href="/signin" style={{ color: "#666" }}>Sign in</Link>
        </div>
        <p className="text-xs" style={{ color: "#444" }}>© 2025 ResumeX100. All rights reserved.</p>
      </div>
    </footer>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen">
      <NavBar />
      <HeroSection />
      <ProblemShiftSection />
      <HowItWorksSection />
      <FeaturesSection />
      <ComparisonSection />
      <TestimonialsSection />
      <PricingSection />
      <CTASection />
      <Footer />
    </div>
  );
}
