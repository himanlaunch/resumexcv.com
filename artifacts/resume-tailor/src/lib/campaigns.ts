import type { JobResult } from "@/lib/api";

const API_BASE = "/api";
let _token: string | null = null;

export function setCampaignAuthToken(token: string | null) {
  _token = token;
}

function authHeaders(): HeadersInit {
  return _token ? { Authorization: `Bearer ${_token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

export type CampaignStatus = "Not Applied" | "Applied" | "Waiting" | "Interview" | "Offer" | "Rejected";

export interface CampaignRecord {
  id: string;
  userId: string;
  name: string;
  jobTitle: string;
  company: string;
  version: string;
  exportedDate: string;
  updatedAt: number;
  status: CampaignStatus;
  location: string;
  salary: string;
  applyLink: string | null;
}

const CAMPAIGNS_KEY_PREFIX = "resumex100_campaigns_v1";

function storageKey(userId: string) {
  return `${CAMPAIGNS_KEY_PREFIX}:${userId}`;
}

function todayLabel() {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date());
}

export function loadCampaigns(userId?: string | null): CampaignRecord[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CampaignRecord[];
    return parsed.filter(record => record.userId === userId);
  } catch {
    return [];
  }
}

export function persistCampaigns(userId: string, campaigns: CampaignRecord[]) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(campaigns.filter(record => record.userId === userId)));
  } catch {
    // localStorage can be unavailable in private/locked-down browsers.
  }
}

// Fetch campaigns from server and merge with localStorage (server wins on conflict).
export async function syncCampaignsFromServer(userId: string): Promise<CampaignRecord[]> {
  if (!_token) return loadCampaigns(userId);
  try {
    const res = await fetch(`${API_BASE}/profile/campaigns`, { headers: authHeaders() });
    if (!res.ok) return loadCampaigns(userId);
    const data = await res.json() as { campaigns: CampaignRecord[] };
    const serverCampaigns = data.campaigns ?? [];
    // Merge: server records take priority, then local-only records (not yet synced)
    const serverIds = new Set(serverCampaigns.map(c => c.id));
    const localOnly = loadCampaigns(userId).filter(c => !serverIds.has(c.id));
    const merged = [...serverCampaigns, ...localOnly];
    persistCampaigns(userId, merged);
    // Push any local-only records to server
    for (const c of localOnly) {
      void syncCampaignToServer(c);
    }
    return merged;
  } catch {
    return loadCampaigns(userId);
  }
}

async function syncCampaignToServer(campaign: CampaignRecord) {
  if (!_token) return;
  try {
    await fetch(`${API_BASE}/profile/campaigns/${encodeURIComponent(campaign.id)}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({
        name: campaign.name,
        jobTitle: campaign.jobTitle,
        company: campaign.company,
        version: campaign.version,
        exportedDate: campaign.exportedDate,
        status: campaign.status,
        location: campaign.location,
        salary: campaign.salary,
        applyLink: campaign.applyLink,
      }),
    });
  } catch {
    // best-effort; localStorage copy is the fallback
  }
}

export function upsertCampaignFromJob(userId: string | undefined | null, job: JobResult) {
  if (!userId) return;
  const existing = loadCampaigns(userId);
  const previous = existing.find(record => record.id === job.id);
  const next: CampaignRecord = {
    id: job.id,
    userId,
    name: previous?.name ?? `${job.company} - ${job.title}`,
    jobTitle: job.title,
    company: job.company,
    version: previous?.version ?? "v1",
    exportedDate: previous?.exportedDate ?? todayLabel(),
    updatedAt: Date.now(),
    status: previous?.status ?? "Not Applied",
    location: job.location || "Not specified",
    salary: job.salary || "Not specified",
    applyLink: job.applyLink,
  };
  persistCampaigns(userId, [next, ...existing.filter(record => record.id !== job.id)]);
  void syncCampaignToServer(next);
}

export function updateCampaignStatus(userId: string | undefined | null, id: string, status: CampaignStatus) {
  if (!userId) return [];
  const updated = loadCampaigns(userId).map(record =>
    record.id === id ? { ...record, status, updatedAt: Date.now() } : record
  );
  persistCampaigns(userId, updated);
  const changed = updated.find(r => r.id === id);
  if (changed) void syncCampaignToServer(changed);
  return updated;
}

export function updateCampaignName(userId: string | undefined | null, id: string, name: string) {
  if (!userId) return [];
  const cleanName = name.trim();
  const updated = loadCampaigns(userId).map(record =>
    record.id === id ? { ...record, name: cleanName || `${record.company} - ${record.jobTitle}`, updatedAt: Date.now() } : record
  );
  persistCampaigns(userId, updated);
  const changed = updated.find(r => r.id === id);
  if (changed) void syncCampaignToServer(changed);
  return updated;
}
