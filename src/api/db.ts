import type { AppProfile } from "../yandex/profile";
import type { ProjectListItem } from "../project/projects";
import type { ProjectSettings } from "../project/settings";

export type IntegrationProvider = "metrika" | "webmaster" | "direct";

export type IntegrationRecord = {
  provider: IntegrationProvider;
  status: "connected" | "error" | "empty" | "dev" | "disconnected";
  error?: string | null;
  meta?: unknown;
  lastSyncAt?: string;
};

function headers(userId: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Yandex-User-Id": userId,
  };
}

type AppFetchInit = RequestInit & { timeoutMs?: number };

export function isDbUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|MariaDB|таймаут|503|Can't connect|connect E|Failed to fetch|NetworkError|API не отвечает|unavailable/i.test(
    msg,
  );
}

async function appFetch<T>(
  path: string,
  userId: string,
  init?: AppFetchInit,
): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? 8000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  init?.signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(`/api/app${path}`, {
      method: init?.method,
      body: init?.body,
      credentials: init?.credentials,
      headers: {
        ...headers(userId),
        ...(init?.headers ?? {}),
      },
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text };
    }
    if (!res.ok) {
      const err =
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `API ${res.status}`;
      throw new Error(err);
    }
    return data as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("MariaDB недоступна (таймаут)");
    }
    if (e instanceof TypeError) {
      throw new Error("MariaDB недоступна (API не отвечает)");
    }
    throw e;
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", onAbort);
  }
}

export async function checkDbHealth(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/app/health", {
      signal: AbortSignal.timeout(3000),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `API ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveProfileToDb(profile: AppProfile): Promise<void> {
  await appFetch("/profile", profile.id, {
    method: "PUT",
    body: JSON.stringify(profile),
  });
}

export async function loadProfileFromDb(
  userId: string,
): Promise<AppProfile | null> {
  const data = await appFetch<{ profile: AppProfile | null }>(
    "/profile",
    userId,
  );
  return data.profile;
}

export async function saveIntegrationsToDb(
  userId: string,
  integrations: IntegrationRecord[],
): Promise<void> {
  await appFetch("/integrations", userId, {
    method: "PUT",
    body: JSON.stringify({ integrations }),
  });
}

export async function loadIntegrationsFromDb(
  userId: string,
): Promise<IntegrationRecord[]> {
  const data = await appFetch<{ integrations: IntegrationRecord[] }>(
    "/integrations",
    userId,
  );
  return data.integrations ?? [];
}

export async function saveProjectSettingsToDb(
  userId: string,
  settings: ProjectSettings,
  projectId = "default",
): Promise<void> {
  await appFetch("/project-settings", userId, {
    method: "PUT",
    body: JSON.stringify({ ...settings, projectId }),
  });
}

export async function loadProjectSettingsFromDb(
  userId: string,
  projectId = "default",
): Promise<ProjectSettings | null> {
  const data = await appFetch<{ settings: ProjectSettings | null }>(
    `/project-settings?projectId=${encodeURIComponent(projectId)}`,
    userId,
  );
  return data.settings;
}

export async function saveProjectsToDb(
  userId: string,
  projects: ProjectListItem[],
): Promise<void> {
  await appFetch("/projects", userId, {
    method: "PUT",
    body: JSON.stringify({ projects }),
  });
}

export async function loadProjectsFromDb(
  userId: string,
): Promise<ProjectListItem[]> {
  const data = await appFetch<{ projects: ProjectListItem[] }>(
    "/projects",
    userId,
  );
  return data.projects ?? [];
}

export type PlanId = "start" | "pro" | "agency";

export type SubscriptionStatus =
  | "trial"
  | "active"
  | "past_due"
  | "cancelled"
  | "expired";

export type InvoiceStatus =
  | "draft"
  | "pending"
  | "paid"
  | "overdue"
  | "cancelled"
  | "refunded";

export type TrialInfo = {
  startedAt: string;
  endsAt: string;
  resetAt: string;
  trialDays: number;
  usedDays: number;
  leftDays: number;
  expired: boolean;
  activeUntilLabel: string;
  resetAtLabel: string;
};

export type Subscription = {
  userId: string;
  plan: PlanId;
  planLabel: string;
  status: SubscriptionStatus;
  billingCycle: "month" | "year";
  priceByn: number;
  trialStartedAt: string;
  trialDays: number;
  trialEndsAt: string;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  trial: TrialInfo;
  updatedAt?: string;
};

export type Invoice = {
  id: string;
  number: string;
  plan: PlanId;
  planLabel: string;
  amountByn: number;
  currency: string;
  status: InvoiceStatus;
  kind: "trial" | "subscription" | "upgrade" | "one_off";
  issuedAt: string;
  dueAt?: string | null;
  paidAt?: string | null;
  periodLabel?: string | null;
  description?: string | null;
};

export type BillingSnapshot = {
  subscription: Subscription;
  invoices: Invoice[];
};

export async function loadBillingFromDb(
  userId: string,
): Promise<BillingSnapshot> {
  return appFetch<BillingSnapshot>("/billing", userId);
}

export async function createInvoiceInDb(
  userId: string,
  body: Partial<Invoice> & { amountByn?: number; periodLabel?: string },
): Promise<Invoice> {
  const data = await appFetch<{ invoice: Invoice }>("/billing/invoices", userId, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return data.invoice;
}

export async function updateInvoiceStatusInDb(
  userId: string,
  invoiceId: string,
  status: InvoiceStatus,
): Promise<BillingSnapshot & { invoice: Invoice; ok: boolean }> {
  return appFetch(`/billing/invoices/${encodeURIComponent(invoiceId)}`, userId, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

/** Сохранить OAuth-токен на API (для суточного sync). */
export async function saveOAuthTokenToDb(
  userId: string,
  accessToken: string,
  expiresIn?: number,
): Promise<void> {
  await appFetch("/oauth-token", userId, {
    method: "PUT",
    body: JSON.stringify({ accessToken, expiresIn }),
  });
}

export async function clearOAuthTokenInDb(userId: string): Promise<void> {
  await appFetch("/oauth-token", userId, { method: "DELETE" });
}

export type SyncStatus = {
  job: {
    phase: string;
    backfillFrom?: string;
    backfillTo?: string;
    backfillCursor?: string;
    lastDailyDay?: string | null;
    lastRunAt?: string | null;
    error?: string | null;
    progressPct?: number;
    updatedAt?: string;
  } | null;
  stats: { rows: number; minDay: string | null; maxDay: string | null };
};

export async function loadSyncStatus(userId: string): Promise<SyncStatus> {
  return appFetch("/sync-status", userId);
}

export async function startStatsSync(userId: string): Promise<void> {
  await appFetch("/sync/start", userId, { method: "POST" });
}

export type DbStatsDay = {
  date: string;
  impressions: number;
  clicks: number;
  conversions: number;
  visits: number;
  users: number;
  pageviews: number;
  ecommerce: number;
  bounceRate: number;
  shows: number;
  spend: number;
  trafficFromMetrika: boolean;
};

export type DbStatsCoverage = {
  date: string;
  source: "metrika" | "webmaster" | string;
  entityKey: string;
  updatedAt: string;
};

export type DbStatsResponse = {
  from: string;
  to: string;
  days: DbStatsDay[];
  totals: {
    impressions: number;
    clicks: number;
    conversions: number;
    visits: number;
    users: number;
    pageviews: number;
    ecommerce: number;
    bounceRate: number;
    spend: number;
  };
  coverage?: DbStatsCoverage[];
  hasData: boolean;
  sync: {
    phase: string;
    progressPct: number;
    error?: string | null;
    lastDailyDay?: string | null;
  } | null;
};

export async function loadStatsFromDb(
  userId: string,
  from: string,
  to: string,
  sites: string[] = [],
): Promise<DbStatsResponse> {
  const q = new URLSearchParams({ from, to });
  if (sites.length) q.set("sites", sites.join(","));
  return appFetch(`/stats?${q}`, userId, { timeoutMs: 4000 });
}

export async function saveMetrikaDailyToDb(
  userId: string,
  entityKey: string,
  siteHost: string,
  points: {
    date: string;
    visits: number;
    users: number;
    pageviews: number;
    goalReaches?: number;
    conversions?: number;
    ecommercePurchases?: number;
    ecommerce?: number;
    bounceRate?: number;
  }[],
): Promise<{ ok: boolean; saved: number }> {
  return appFetch("/stats", userId, {
    method: "POST",
    body: JSON.stringify({ entityKey, siteHost, points }),
  });
}

export type ReportStatus =
  | "draft"
  | "queued"
  | "collecting"
  | "analyzing"
  | "rendering"
  | "ready"
  | "error"
  | "cancelled";

export type ReportConfiguration = {
  projectId: string;
  siteHost: string;
  reportType:
    | "full"
    | "express"
    | "direct-weekly"
    | "webmaster-audit"
    | "monthly";
  title?: string;
  period: {
    from: string;
    to: string;
    compareFrom?: string | null;
    compareTo?: string | null;
  };
  comparison: boolean;
  sources: string[];
  goals: string[];
  directives: string[];
  outputs: string[];
};

export type GeneratedReport = {
  id: string;
  projectId?: string;
  siteHost?: string;
  reportType?: string;
  title?: string;
  status: ReportStatus;
  progressPct: number;
  phaseLabel: string | null;
  period?: {
    from: string;
    to: string;
    compareFrom: string | null;
    compareTo: string | null;
  };
  config?: Partial<ReportConfiguration>;
  result?: unknown;
  error?: string | null;
  createdAt?: string;
  completedAt?: string | null;
};

export async function createReportInDb(
  userId: string,
  configuration: ReportConfiguration,
): Promise<GeneratedReport> {
  const data = await appFetch<{ report: GeneratedReport }>("/reports", userId, {
    method: "POST",
    body: JSON.stringify(configuration),
    timeoutMs: 12000,
  });
  return data.report;
}

export async function loadReportFromDb(
  userId: string,
  reportId: string,
): Promise<GeneratedReport> {
  const data = await appFetch<{ report: GeneratedReport }>(
    `/reports/${encodeURIComponent(reportId)}`,
    userId,
  );
  return data.report;
}

export async function loadReportsFromDb(
  userId: string,
): Promise<GeneratedReport[]> {
  const data = await appFetch<{ reports: GeneratedReport[] }>("/reports", userId);
  return data.reports ?? [];
}

export async function saveReportTemplateToDb(
  userId: string,
  projectId: string,
  name: string,
  config: Omit<ReportConfiguration, "projectId">,
): Promise<{ id: string; name: string }> {
  const data = await appFetch<{ template: { id: string; name: string } }>(
    "/report-templates",
    userId,
    {
      method: "POST",
      body: JSON.stringify({ projectId, name, config }),
    },
  );
  return data.template;
}
