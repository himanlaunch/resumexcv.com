import type { JobResult } from "@/lib/api";

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
}

export function updateCampaignStatus(userId: string | undefined | null, id: string, status: CampaignStatus) {
  if (!userId) return [];
  const updated = loadCampaigns(userId).map(record =>
    record.id === id ? { ...record, status, updatedAt: Date.now() } : record
  );
  persistCampaigns(userId, updated);
  return updated;
}

export function updateCampaignName(userId: string | undefined | null, id: string, name: string) {
  if (!userId) return [];
  const cleanName = name.trim();
  const updated = loadCampaigns(userId).map(record =>
    record.id === id ? { ...record, name: cleanName || `${record.company} - ${record.jobTitle}`, updatedAt: Date.now() } : record
  );
  persistCampaigns(userId, updated);
  return updated;
}
