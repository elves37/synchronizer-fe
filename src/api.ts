export type SourceDb = {
  dbKey: string;
  name: string;
  jdbcUrl: string;
  username: string;
  driverClassName: string;
  enabled: boolean;
};

export type SyncSourceConfig = {
  id: number;
  sourceDbKey: string;
  name: string;
  incrementalSql: string;
  fetchOneSql?: string;
  keyAlias: string;
  updatedAtAlias: string;
  upsertSql: string;
  chunkSize: number;
  fetchSize: number;
  safetyLagSeconds: number;
  overlapSeconds: number;
  enabled: boolean;
  scheduleEnabled: boolean;
  scheduleIntervalMinutes: number;
  nextRunAt?: string;
  lastScheduledAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CreateSyncSourceRequest = {
  sourceDbKey: string;
  name: string;
  incrementalSql: string;
  fetchOneSql?: string;
  keyAlias: string;
  updatedAtAlias: string;
  upsertSql: string;
  chunkSize: number;
  fetchSize: number;
  safetyLagSeconds: number;
  overlapSeconds: number;
  enabled: boolean;
  scheduleEnabled: boolean;
  scheduleIntervalMinutes: number;
};

export type SchedulerStatus = {
  enabled: boolean;
  dispatchDelayMs: number;
  batchSize: number;
  poolSize: number;
};

export type SyncRunSummary = {
  runId: number;
  sourceId: number;
  status: string;
  totalCount: number;
  upsertedCount: number;
  unchangedCount: number;
  skippedExcludedCount: number;
  failedCount: number;
};

export type SyncRunView = {
  id: number;
  sourceId: number;
  sourceName: string;
  sourceDbKey: string;
  sourceDbName: string;
  sourceTotalCount: number;
  sourceDbTotalCount: number;
  triggerType: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  totalCount: number;
  upsertedCount: number;
  unchangedCount: number;
  skippedExcludedCount: number;
  failedCount: number;
  errorMessage?: string;
};

export type TargetUser = {
  accountKey: string;
  loginId?: string;
  name?: string;
  email?: string;
  phone?: string;
  addressText?: string;
  organizationName?: string;
  extraPayload?: string;
  status?: string;
  sourceUpdatedAt?: string;
  syncMode: 'SYNC' | 'MANUAL';
  lastSyncedAt?: string;
  manualUpdatedAt?: string;
  manualUpdatedBy?: string;
};

const API_BASE = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {})
    },
    ...options
  });

  if (!res.ok) {
    const text = await res.text();
    let message = text || `API error ${res.status}`;
    if (text) {
      try {
        const errorBody = JSON.parse(text) as { message?: string };
        message = errorBody.message || message;
      } catch {
        // Keep the plain response text when the server did not return JSON.
      }
    }
    throw new Error(message);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

export function getSourceDbs() {
  return request<SourceDb[]>('/source-dbs');
}

export function getSyncSources() {
  return request<SyncSourceConfig[]>('/sync-sources');
}

export function createSyncSource(payload: CreateSyncSourceRequest) {
  return request<SyncSourceConfig>('/sync-sources', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function getSchedulerStatus() {
  return request<SchedulerStatus>('/sync-sources/scheduler-status');
}

export function updateSyncSchedule(id: number, enabled: boolean, intervalMinutes: number) {
  return request<SyncSourceConfig>(`/sync-sources/${id}/schedule`, {
    method: 'PUT',
    body: JSON.stringify({ enabled, intervalMinutes })
  });
}

export function runSyncSource(id: number) {
  return request<SyncRunSummary>(`/sync-sources/${id}/run`, { method: 'POST' });
}

export function getSyncRuns(sourceDbKey?: string, sourceId?: number) {
  const q = new URLSearchParams();
  if (sourceDbKey) q.set('sourceDbKey', sourceDbKey);
  if (sourceId) q.set('sourceId', String(sourceId));
  return request<SyncRunView[]>(`/sync-runs?${q.toString()}`);
}

export function getTargetUsers(keyword: string, syncMode: string) {
  const q = new URLSearchParams();
  if (keyword) q.set('keyword', keyword);
  if (syncMode) q.set('syncMode', syncMode);
  return request<TargetUser[]>(`/target-users?${q.toString()}`);
}

export function updateManualAccount(accountKey: string, patch: Record<string, unknown>, reason: string, userId: string) {
  return request<{ accountKey: string; status: string }>(`/manual-accounts/${accountKey}`, {
    method: 'PUT',
    body: JSON.stringify({ patch, reason, userId })
  });
}

export function excludeAccount(accountKey: string, reason: string, userId: string) {
  return request<{ accountKey: string; status: string }>(`/manual-accounts/${accountKey}/exclude`, {
    method: 'POST',
    body: JSON.stringify({ reason, userId })
  });
}

export function reincludeAccount(accountKey: string, sourceId?: number) {
  return request<{ accountKey: string; status: string }>(`/manual-accounts/${accountKey}/reinclude`, {
    method: 'POST',
    body: JSON.stringify({ sourceId, userId: 'admin' })
  });
}
