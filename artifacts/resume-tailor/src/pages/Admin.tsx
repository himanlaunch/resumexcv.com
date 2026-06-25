import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { Search, Users, FileText, Briefcase, TrendingUp, ChevronDown, ChevronUp, Phone, Mail, MapPin, User, RefreshCw, Zap } from "lucide-react";

const API_BASE = "/api";

function authHeaders(token: string | null): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface AdminUser {
  user_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  summary: string | null;
  file_name: string | null;
  updated_at: string;
  credits: number;
  total_purchased: number;
  free_used: number;
  upload_count: number;
  generated_count: number;
}

interface Stats {
  total_users: number;
  total_uploads: number;
  total_generated: number;
  users_with_credits: number;
  total_credits_sold: number;
  total_purchases: number;
}

interface UserDetail {
  profile: any;
  resumeVersions: any[];
  generatedResumes: any[];
  credits: any;
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="rounded-xl p-4 flex items-center gap-3" style={{ backgroundColor: "#1A1A1A", border: "1px solid #2A2A2A" }}>
      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#00F0A020" }}>
        <span style={{ color: "#00F0A0" }}>{icon}</span>
      </div>
      <div>
        <div className="text-2xl font-bold" style={{ color: "#FFFFFF" }}>{value}</div>
        <div className="text-xs" style={{ color: "#888" }}>{label}</div>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
      className="ml-1 text-xs px-1.5 py-0.5 rounded transition-colors"
      style={{ backgroundColor: copied ? "#00F0A020" : "#2A2A2A", color: copied ? "#00F0A0" : "#AAA" }}
    >
      {copied ? "✓" : "copy"}
    </button>
  );
}

function UserRow({ user, token, onCreditsGranted }: { user: AdminUser; token: string | null; onCreditsGranted: (userId: string, newBalance: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [grantAmount, setGrantAmount] = useState("1000");
  const [granting, setGranting] = useState(false);
  const [grantMsg, setGrantMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadDetail = async () => {
    if (detail) { setExpanded(e => !e); return; }
    setExpanded(true);
    setLoadingDetail(true);
    try {
      const r = await fetch(`${API_BASE}/admin/users/${user.user_id}`, { headers: authHeaders(token) });
      if (r.ok) setDetail(await r.json());
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleGrantCredits = async () => {
    const amount = parseInt(grantAmount, 10);
    if (!amount || amount <= 0) return;
    setGranting(true);
    setGrantMsg(null);
    try {
      const r = await fetch(`${API_BASE}/admin/users/${user.user_id}/credits`, {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const data = await r.json();
      if (r.ok) {
        setGrantMsg({ ok: true, text: `Granted! New balance: ${data.balance}` });
        onCreditsGranted(user.user_id, data.balance);
      } else {
        setGrantMsg({ ok: false, text: data.error ?? "Failed to grant credits." });
      }
    } catch {
      setGrantMsg({ ok: false, text: "Network error." });
    } finally {
      setGranting(false);
    }
  };

  return (
    <>
      <tr
        className="cursor-pointer transition-colors"
        style={{ borderBottom: "1px solid #2A2A2A" }}
        onClick={loadDetail}
      >
        <td className="px-4 py-3">
          <div className="font-medium text-sm" style={{ color: "#E0E0E0" }}>{user.name ?? <span style={{ color: "#666" }}>—</span>}</div>
          <div className="text-xs mt-0.5" style={{ color: "#888" }}>{user.file_name ?? ""}</div>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            <span className="text-sm" style={{ color: "#A0A0A0" }}>{user.email ?? "—"}</span>
            {user.email && <CopyButton text={user.email} />}
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            <span className="text-sm" style={{ color: "#A0A0A0" }}>{user.phone ?? "—"}</span>
            {user.phone && <CopyButton text={user.phone} />}
          </div>
        </td>
        <td className="px-4 py-3 text-sm" style={{ color: "#A0A0A0" }}>{user.location ?? "—"}</td>
        <td className="px-4 py-3 text-center">
          <span className="text-sm font-semibold" style={{ color: user.credits > 0 ? "#00F0A0" : "#666" }}>{user.credits}</span>
        </td>
        <td className="px-4 py-3 text-center text-sm" style={{ color: "#A0A0A0" }}>{user.upload_count}</td>
        <td className="px-4 py-3 text-center text-sm" style={{ color: "#A0A0A0" }}>{user.generated_count}</td>
        <td className="px-4 py-3 text-xs" style={{ color: "#666" }}>
          {new Date(user.updated_at).toLocaleDateString()}
        </td>
        <td className="px-4 py-3 text-center" style={{ color: "#666" }}>
          {expanded ? <ChevronUp className="w-4 h-4 inline" /> : <ChevronDown className="w-4 h-4 inline" />}
        </td>
      </tr>
      {expanded && (
        <tr style={{ backgroundColor: "#111" }}>
          <td colSpan={9} className="px-6 py-4">
            {loadingDetail ? (
              <div className="text-sm" style={{ color: "#666" }}>Loading…</div>
            ) : detail ? (
              <div className="space-y-4">
                {/* Contact block */}
                <div className="flex flex-wrap gap-4 text-sm">
                  {detail.profile?.resume?.email && (
                    <div className="flex items-center gap-1.5" style={{ color: "#CCC" }}>
                      <Mail className="w-3.5 h-3.5" style={{ color: "#00F0A0" }} />
                      {detail.profile.resume.email}
                      <CopyButton text={detail.profile.resume.email} />
                    </div>
                  )}
                  {detail.profile?.resume?.phone && (
                    <div className="flex items-center gap-1.5" style={{ color: "#CCC" }}>
                      <Phone className="w-3.5 h-3.5" style={{ color: "#00F0A0" }} />
                      {detail.profile.resume.phone}
                      <CopyButton text={detail.profile.resume.phone} />
                    </div>
                  )}
                  {detail.profile?.resume?.location && (
                    <div className="flex items-center gap-1.5" style={{ color: "#CCC" }}>
                      <MapPin className="w-3.5 h-3.5" style={{ color: "#00F0A0" }} />
                      {detail.profile.resume.location}
                    </div>
                  )}
                </div>

                {/* Summary */}
                {detail.profile?.resume?.summary && (
                  <p className="text-xs leading-relaxed" style={{ color: "#999", maxWidth: 700 }}>
                    {detail.profile.resume.summary}
                  </p>
                )}

                {/* Upload history */}
                {detail.resumeVersions.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold mb-1.5" style={{ color: "#666", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Upload history ({detail.resumeVersions.length})
                    </div>
                    <div className="space-y-1">
                      {detail.resumeVersions.map((v) => (
                        <div key={v.id} className="flex items-center gap-3 text-xs" style={{ color: "#888" }}>
                          <FileText className="w-3 h-3 flex-shrink-0" style={{ color: "#555" }} />
                          <span style={{ color: "#CCC" }}>{v.file_name ?? "unnamed"}</span>
                          <span>{new Date(v.uploaded_at).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Generated resumes */}
                {detail.generatedResumes.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold mb-1.5" style={{ color: "#666", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Generated resumes ({detail.generatedResumes.length})
                    </div>
                    <div className="space-y-1">
                      {detail.generatedResumes.map((g) => (
                        <div key={g.id} className="flex items-center gap-3 text-xs" style={{ color: "#888" }}>
                          <Briefcase className="w-3 h-3 flex-shrink-0" style={{ color: "#555" }} />
                          <span style={{ color: "#CCC" }}>{g.job_title} @ {g.job_company}</span>
                          <span>{new Date(g.saved_at).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Grant Credits */}
                <div className="flex items-center gap-2 pt-2" style={{ borderTop: "1px solid #2A2A2A" }}>
                  <Zap className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#00F0A0" }} />
                  <span className="text-xs font-semibold" style={{ color: "#888" }}>Grant credits</span>
                  <input
                    type="number"
                    min={1}
                    value={grantAmount}
                    onChange={e => setGrantAmount(e.target.value)}
                    className="w-20 text-xs px-2 py-1 rounded"
                    style={{ backgroundColor: "#1A1A1A", border: "1px solid #3A3A3A", color: "#E0E0E0" }}
                    onClick={e => e.stopPropagation()}
                  />
                  <button
                    onClick={e => { e.stopPropagation(); void handleGrantCredits(); }}
                    disabled={granting}
                    className="text-xs font-semibold px-3 py-1 rounded transition-opacity"
                    style={{ backgroundColor: "#00F0A0", color: "#0A0A0A", opacity: granting ? 0.6 : 1 }}
                  >
                    {granting ? "Granting…" : "Grant"}
                  </button>
                  {grantMsg && (
                    <span className="text-xs" style={{ color: grantMsg.ok ? "#00F0A0" : "#EF4444" }}>
                      {grantMsg.text}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-sm" style={{ color: "#666" }}>Failed to load details.</div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function Admin() {
  const { user, session, loading: authLoading } = useAuth();
  const token = session?.access_token ?? null;
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const load = useCallback(async (q: string) => {
    setForbidden(false);
    setLoadError(null);
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200", ...(q ? { search: q } : {}) });
      const [uRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/admin/users?${params}`, { headers: authHeaders(token) }),
        fetch(`${API_BASE}/admin/stats`, { headers: authHeaders(token) }),
      ]);
      if (uRes.status === 403 || uRes.status === 401) { setForbidden(true); return; }
      if (uRes.ok) {
        const d = await uRes.json();
        setUsers(d.users);
        setTotal(d.total);
      } else {
        const err = await uRes.json().catch(() => ({}));
        setLoadError(`Users API error ${uRes.status}: ${(err as any).error ?? "unknown"}`);
      }
      if (sRes.ok) setStats(await sRes.json());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (authLoading || !user) return;
    const t = setTimeout(() => { void load(search); }, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [search, load, authLoading, user]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#0A0A0A", color: "#888" }}>
        Sign in to access the admin panel.
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#0A0A0A", color: "#888" }}>
        <div className="text-center">
          <div className="text-4xl mb-3">🚫</div>
          <div className="font-semibold" style={{ color: "#CCC" }}>Admin access only</div>
          <div className="text-sm mt-1">Your account doesn't have admin permissions.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0A0A0A", color: "#E0E0E0" }}>
      {/* Header */}
      <div className="px-6 py-5 flex items-center justify-between" style={{ borderBottom: "1px solid #1E1E1E" }}>
        <div>
          <h1 className="text-xl font-bold" style={{ color: "#FFFFFF" }}>Admin Panel</h1>
          <p className="text-xs mt-0.5" style={{ color: "#666" }}>ResumeX100 — user data & activity</p>
        </div>
        <button
          onClick={() => void load(search)}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors"
          style={{ backgroundColor: "#1A1A1A", color: "#888", border: "1px solid #2A2A2A" }}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      <div className="px-6 py-6 space-y-6">
        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard icon={<Users className="w-5 h-5" />} label="Total Users" value={stats.total_users} />
            <StatCard icon={<FileText className="w-5 h-5" />} label="Uploads" value={stats.total_uploads} />
            <StatCard icon={<Briefcase className="w-5 h-5" />} label="Resumes Generated" value={stats.total_generated} />
            <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Credits Sold" value={stats.total_credits_sold} />
            <StatCard icon={<User className="w-5 h-5" />} label="Purchases" value={stats.total_purchases} />
            <StatCard icon={<User className="w-5 h-5" />} label="Active (w/ credits)" value={stats.users_with_credits} />
          </div>
        )}

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#555" }} />
          <input
            type="text"
            placeholder="Search by name, email, or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg text-sm outline-none"
            style={{ backgroundColor: "#1A1A1A", border: "1px solid #2A2A2A", color: "#E0E0E0" }}
          />
        </div>

        {/* Table */}
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #2A2A2A" }}>
          {loading ? (
            <div className="p-10 text-center text-sm" style={{ color: "#555" }}>Loading users…</div>
          ) : loadError ? (
            <div className="p-10 text-center text-sm" style={{ color: "#EF4444" }}>{loadError}</div>
          ) : users.length === 0 ? (
            <div className="p-10 text-center text-sm" style={{ color: "#555" }}>
              {search ? "No users match your search." : "No users yet."}
            </div>
          ) : (
            <table className="w-full text-left">
              <thead style={{ backgroundColor: "#141414", borderBottom: "1px solid #2A2A2A" }}>
                <tr>
                  {["Name / File", "Email", "Phone", "Location", "Credits", "Uploads", "Generated", "Last Active", ""].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-xs font-semibold" style={{ color: "#555", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <UserRow key={u.user_id} user={u} token={token} onCreditsGranted={(id, bal) => setUsers(prev => prev.map(x => x.user_id === id ? { ...x, credits: bal } : x))} />
                ))}
              </tbody>
            </table>
          )}
        </div>
        {total > users.length && (
          <p className="text-xs text-center" style={{ color: "#555" }}>
            Showing {users.length} of {total} users
          </p>
        )}
      </div>
    </div>
  );
}
