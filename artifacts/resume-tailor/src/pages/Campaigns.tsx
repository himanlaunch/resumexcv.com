import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Plus, TrendingUp, FileText, Clock, Award, ExternalLink, Filter, MapPin, DollarSign, CalendarDays, ShieldCheck, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { BrandLogo } from "@/components/BrandLogo";
import { loadCampaigns, syncCampaignsFromServer, updateCampaignName, updateCampaignStatus, type CampaignRecord, type CampaignStatus } from "@/lib/campaigns";

const STATUS_STYLES: Record<CampaignStatus, { bg: string; text: string; dot: string }> = {
  "Not Applied": { bg: "#F3F4F6", text: "#374151", dot: "#9CA3AF" },
  "Applied": { bg: "#DBEAFE", text: "#1E40AF", dot: "#3B82F6" },
  "Waiting": { bg: "#FEF3C7", text: "#92400E", dot: "#F59E0B" },
  "Interview": { bg: "#D1FAE5", text: "#065F46", dot: "#10B981" },
  "Offer": { bg: "#ECFFE0", text: "#005A3D", dot: "#00F0A0" },
  "Rejected": { bg: "#FEE2E2", text: "#991B1B", dot: "#EF4444" },
};

const ALL_STATUSES: CampaignStatus[] = ["Not Applied", "Applied", "Waiting", "Interview", "Offer", "Rejected"];

function companyInitial(company: string) {
  return (company.trim()[0] || "?").toUpperCase();
}

function companyColor(company: string) {
  const colors = ["#635BFF", "#00A3FF", "#0ACF83", "#C47E4E", "#5E6AD2", "#FF6B35", "#E91E8C", "#00BCD4", "#FF5722", "#4CAF50"];
  let h = 0;
  for (let i = 0; i < company.length; i++) h = (h * 31 + company.charCodeAt(i)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
}

function postingAgeHours(value?: string) {
  const text = (value ?? "").toLowerCase();
  const match = text.match(/(\d+)\+?\s*(minute|min|hour|hr|day|week|month)/);
  if (!match) return text.includes("today") || text.includes("recent") ? 0 : 720;
  const amount = Number(match[1]);
  if (match[2].startsWith("min")) return amount / 60;
  if (match[2].startsWith("hour") || match[2].startsWith("hr")) return amount;
  if (match[2].startsWith("day")) return amount * 24;
  if (match[2].startsWith("week")) return amount * 168;
  return amount * 720;
}

function priorityScore(record: CampaignRecord) {
  const match = record.matchQuality ?? 50;
  const freshness = Math.max(0, 100 - postingAgeHours(record.postedAt) / 7.2);
  const ready = record.status === "Not Applied" ? 15 : 0;
  const remote = record.remote ? 5 : 0;
  return match * 0.65 + freshness * 0.2 + ready + remote;
}

export default function Campaigns() {
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const [filterStatus, setFilterStatus] = useState<CampaignStatus | "All">("All");

  useEffect(() => {
    if (!user?.id) return;
    // Show local data immediately, then refresh from server
    setCampaigns(loadCampaigns(user.id));
    void syncCampaignsFromServer(user.id).then(setCampaigns);
  }, [user?.id]);

  const updateStatus = (id: string, status: CampaignStatus) => {
    setCampaigns(updateCampaignStatus(user?.id, id, status));
  };

  const updateName = (id: string, name: string) => {
    setCampaigns(updateCampaignName(user?.id, id, name));
  };

  const filtered = filterStatus === "All" ? campaigns : campaigns.filter(c => c.status === filterStatus);
  const bestToday = useMemo(
    () => [...campaigns].filter(c => c.status === "Not Applied").sort((a, b) => priorityScore(b) - priorityScore(a)).slice(0, 3),
    [campaigns],
  );
  const summaryStats = useMemo(() => {
    const applicationsSent = campaigns.filter(c => c.status !== "Not Applied").length;
    const interviews = campaigns.filter(c => c.status === "Interview" || c.status === "Offer").length;
    const responses = campaigns.filter(c => c.status === "Interview" || c.status === "Offer" || c.status === "Rejected").length;
    const responseRate = applicationsSent === 0 ? "0%" : `${Math.round((responses / applicationsSent) * 100)}%`;
    return [
      { icon: <FileText className="w-5 h-5" />, label: "Resumes tailored", value: String(campaigns.length) },
      { icon: <TrendingUp className="w-5 h-5" />, label: "Applications sent", value: String(applicationsSent) },
      { icon: <Award className="w-5 h-5" />, label: "Interviews", value: String(interviews) },
      { icon: <Clock className="w-5 h-5" />, label: "Response rate", value: responseRate },
    ];
  }, [campaigns]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F2F4F5" }}>
      <header className="bg-white border-b px-4 md:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4" style={{ borderColor: "#E5E8EA" }}>
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          <Link href="/app" className="flex items-center gap-2 text-sm font-medium flex-shrink-0" style={{ color: "#666" }}>
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          <div className="hidden sm:block w-px h-5" style={{ backgroundColor: "#E0E0E0" }} />
          <div className="flex items-center gap-3 min-w-0">
            <BrandLogo imageClassName="h-9" />
            <span className="font-heading font-bold text-base truncate" style={{ color: "#0A0A0A" }}>Application Command Center</span>
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-3 flex-wrap sm:flex-nowrap">
          <Link href="/app" className="btn-mint text-sm">
            <Plus className="w-4 h-4" />
            New Campaign
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8">
        <div className="mb-6 md:mb-8">
          <h1 className="font-heading font-bold text-2xl md:text-3xl mb-1" style={{ color: "#0A0A0A" }}>What should you do today?</h1>
          <p className="text-sm" style={{ color: "#888" }}>Prioritized jobs, application readiness, and the next action for every opportunity.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
          {summaryStats.map((s, i) => (
            <div key={i} className="card-base p-4 md:p-5 flex items-center gap-3 md:gap-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#ECFFE0", color: "#00c447" }}>
                {s.icon}
              </div>
              <div>
                <div className="font-heading font-bold text-2xl" style={{ color: "#0A0A0A" }}>{s.value}</div>
                <div className="text-xs" style={{ color: "#888" }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        <section className="mb-8" aria-labelledby="best-jobs-heading">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h2 id="best-jobs-heading" className="font-heading font-bold text-lg" style={{ color: "#0A0A0A" }}>Best jobs to apply to today</h2>
              <p className="text-xs" style={{ color: "#888" }}>Ranked by match quality, posting age, and application readiness.</p>
            </div>
          </div>
          {bestToday.length > 0 ? (
            <div className="grid lg:grid-cols-3 gap-3">
              {bestToday.map((c, index) => (
                <article key={c.id} className="card-base rounded-2xl p-5" style={{ border: index === 0 ? "1.5px solid #00c447" : undefined }}>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <div className="text-xs font-bold mb-1" style={{ color: "#00a86b" }}>#{index + 1} priority</div>
                      <h3 className="font-heading font-bold truncate">{c.jobTitle}</h3>
                      <p className="text-sm truncate" style={{ color: "#666" }}>{c.company}</p>
                    </div>
                    <div className="w-12 h-12 rounded-full flex items-center justify-center font-heading font-bold" style={{ backgroundColor: "#ECFFE0", color: "#005A3D" }}>
                      {c.matchQuality ?? "—"}{c.matchQuality != null ? "%" : ""}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs mb-4">
                    <div className="p-2 rounded-lg" style={{ backgroundColor: "#F8F9FA" }}><Clock className="w-3 h-3 inline mr-1" />{c.postedAt || "Age unknown"}</div>
                    <div className="p-2 rounded-lg" style={{ backgroundColor: "#F8F9FA" }}><DollarSign className="w-3 h-3 inline mr-1" />{c.salary || "Not stated"}</div>
                    <div className="p-2 rounded-lg" style={{ backgroundColor: "#F8F9FA" }}><MapPin className="w-3 h-3 inline mr-1" />{c.remote ? "Remote fit" : c.location}</div>
                    <div className="p-2 rounded-lg" style={{ backgroundColor: "#F8F9FA" }}><ShieldCheck className="w-3 h-3 inline mr-1" />{c.visaRequirement || "Visa not stated"}</div>
                    <div className="p-2 rounded-lg" style={{ backgroundColor: "#F8F9FA" }}><CalendarDays className="w-3 h-3 inline mr-1" />{c.applicationDeadline || "No deadline"}</div>
                    <div className="p-2 rounded-lg" style={{ backgroundColor: "#F8F9FA" }}><FileText className="w-3 h-3 inline mr-1" />{c.resumeVersion || c.version}</div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-3" style={{ borderTop: "1px solid #F0F0F0" }}>
                    <div>
                      <div className="text-[10px] uppercase font-bold" style={{ color: "#888" }}>Next action</div>
                      <div className="text-sm font-semibold">{c.nextAction || "Apply today"}</div>
                    </div>
                    {c.applyLink && <a href={c.applyLink} target="_blank" rel="noopener noreferrer" className="btn-mint text-xs">Open <ArrowRight className="w-3 h-3" /></a>}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="card-base rounded-2xl p-6 text-sm" style={{ color: "#666" }}>Tailor a resume for a job and it will be prioritized here.</div>
          )}
        </section>

        <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: "touch" }}>
          <Filter className="w-4 h-4 flex-shrink-0" style={{ color: "#888" }} />
          {(["All", ...ALL_STATUSES] as (CampaignStatus | "All")[]).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className="text-xs font-semibold px-3 rounded-full transition-all flex-shrink-0"
              style={{
                backgroundColor: filterStatus === s ? "#0A0A0A" : "white",
                color: filterStatus === s ? "white" : "#666",
                border: "1px solid",
                borderColor: filterStatus === s ? "#0A0A0A" : "#E0E0E0",
                minHeight: 44,
                whiteSpace: "nowrap",
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block card-base overflow-hidden" style={{ borderRadius: 14 }}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ backgroundColor: "#F8F9FA", borderBottom: "1px solid #E5E8EA" }}>
                  {["Name", "Job", "Match", "Posted", "ATS / authorization", "Next action", "Status", ""].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "#888" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => {
                  const st = STATUS_STYLES[c.status];
                  return (
                    <tr key={c.id} style={{ borderBottom: i < filtered.length - 1 ? "1px solid #F0F0F0" : "none" }}
                      className="transition-colors" onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#FAFAFA")}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <td className="px-5 py-4">
                        <input
                          value={c.name ?? `${c.company} - ${c.jobTitle}`}
                          onChange={e => updateName(c.id, e.target.value)}
                          className="w-full rounded-lg px-3 py-2 text-sm font-semibold outline-none"
                          style={{ border: "1px solid #E5E8EA", backgroundColor: "#fff", color: "#0A0A0A", minWidth: 190 }}
                          placeholder="Campaign name"
                        />
                      </td>
                      <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm text-white flex-shrink-0" style={{ backgroundColor: companyColor(c.company) }}>
                            {companyInitial(c.company)}
                          </div>
                          <div>
                            <div className="font-semibold text-sm" style={{ color: "#0A0A0A" }}>{c.jobTitle}</div>
                            <div className="text-xs" style={{ color: "#888" }}>{c.company}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-sm font-bold" style={{ color: (c.matchQuality ?? 0) >= 80 ? "#00a86b" : "#555" }}>{c.matchQuality != null ? `${c.matchQuality}%` : "—"}</span>
                      </td>
                      <td className="px-5 py-4 text-xs" style={{ color: "#666" }}>{c.postedAt || "Unknown"}<div>{c.applicationDeadline && c.applicationDeadline !== "Not stated" ? `Due ${c.applicationDeadline}` : ""}</div></td>
                      <td className="px-5 py-4 text-xs" style={{ color: "#666" }}><strong>{c.atsVendor || "Unknown ATS"}</strong><div>{c.visaRequirement || "Not stated"}</div></td>
                      <td className="px-5 py-4 text-xs font-semibold" style={{ color: "#333" }}>{c.nextAction || "Apply today"}<div style={{ color: "#888" }}>{c.resumeVersion || c.version}</div></td>
                      <td className="px-5 py-4">
                        <select
                          value={c.status}
                          onChange={e => updateStatus(c.id, e.target.value as CampaignStatus)}
                          className="text-xs font-semibold rounded-full px-3 py-1.5 border-0 outline-none cursor-pointer"
                          style={{ backgroundColor: st.bg, color: st.text }}
                        >
                          {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="px-5 py-4">
                        {c.applyLink ? (
                          <a
                            href={c.applyLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open ${c.jobTitle} posting`}
                            className="inline-flex p-1.5 rounded-lg transition-colors"
                            style={{ color: "#999" }}
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        ) : (
                          <button className="p-1.5 rounded-lg transition-colors" style={{ color: "#999" }}
                          onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#F0F0F0")}
                          onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                          >
                            <ExternalLink className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-5 py-12 text-center text-sm" style={{ color: "#888" }}>
                    {campaigns.length === 0 ? "No real campaign data yet. Generate resumes from the app and they will appear here." : "No campaigns found for this filter."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-3">
          {filtered.map((c) => {
            const st = STATUS_STYLES[c.status];
            return (
              <div key={c.id} className="card-base p-4 rounded-2xl">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm text-white flex-shrink-0" style={{ backgroundColor: companyColor(c.company) }}>
                      {companyInitial(c.company)}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate" style={{ color: "#0A0A0A" }}>{c.jobTitle}</div>
                      <div className="text-xs truncate" style={{ color: "#888" }}>{c.company} · {c.location}</div>
                    </div>
                  </div>
                  <button className="flex items-center justify-center rounded-lg flex-shrink-0" style={{ color: "#bbb", minWidth: 44, minHeight: 44 }}>
                    <ExternalLink className="w-4 h-4" />
                  </button>
                </div>
                <label className="block mb-3">
                  <span className="text-xs font-semibold mb-1.5 block" style={{ color: "#888" }}>Campaign name</span>
                  <input
                    value={c.name ?? `${c.company} - ${c.jobTitle}`}
                    onChange={e => updateName(c.id, e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold outline-none"
                    style={{ border: "1px solid #E5E8EA", backgroundColor: "#fff", color: "#0A0A0A" }}
                    placeholder="Campaign name"
                  />
                </label>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold" style={{ color: "#555" }}>{c.salary}</span>
                    <span className="text-xs font-mono font-bold px-2 py-0.5 rounded" style={{ backgroundColor: "#F0F0F0", color: "#555" }}>{c.version}</span>
                    <span className="text-xs" style={{ color: "#aaa" }}>{c.exportedDate}</span>
                  </div>
                  <select
                    value={c.status}
                    onChange={e => updateStatus(c.id, e.target.value as CampaignStatus)}
                    className="text-xs font-semibold rounded-full px-3 border-0 outline-none cursor-pointer"
                    style={{ backgroundColor: st.bg, color: st.text, minHeight: 44 }}
                  >
                    {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="card-base p-8 text-center text-sm rounded-2xl" style={{ color: "#888" }}>
              {campaigns.length === 0 ? "No real campaign data yet. Generate resumes from the app and they will appear here." : "No campaigns found for this filter."}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
