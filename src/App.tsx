import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  createSyncSource,
  CreateSyncSourceRequest,
  getSchedulerStatus,
  getSourceDbs,
  getSyncRuns,
  getSyncSources,
  getTargetUsers,
  reincludeAccount,
  runSyncSource,
  SchedulerStatus,
  SourceDb,
  SyncRunView,
  SyncSourceConfig,
  TargetUser,
  updateManualAccount,
  updateSyncSchedule
} from './api';

type Tab = 'sources' | 'source-create' | 'users' | 'runs';

export default function App() {
  const [tab, setTab] = useState<Tab>('sources');

  return (
    <div className="flex min-h-full text-gray-900">
      <aside className="w-64 border-r bg-white p-5">
        <div className="mb-8">
          <div className="text-xl font-bold">User Sync</div>
          <div className="mt-1 text-sm text-gray-500">Query + Cursor 기반 동기화</div>
        </div>
        <nav className="space-y-2">
          <NavButton active={tab === 'sources'} onClick={() => setTab('sources')}>자동 동기화</NavButton>
          <NavButton active={tab === 'source-create'} onClick={() => setTab('source-create')}>동기화 소스 추가</NavButton>
          <NavButton active={tab === 'users'} onClick={() => setTab('users')}>타겟 사용자</NavButton>
          <NavButton active={tab === 'runs'} onClick={() => setTab('runs')}>실행 이력</NavButton>
        </nav>
      </aside>
      <main className="min-w-0 flex-1 p-8">
        {tab === 'sources' && <SyncSourcePage onCreate={() => setTab('source-create')} />}
        {tab === 'source-create' && (
          <SyncSourceCreatePage
            onCreated={() => setTab('sources')}
            onCancel={() => setTab('sources')}
          />
        )}
        {tab === 'users' && <TargetUserPage />}
        {tab === 'runs' && <SyncRunPage />}
      </main>
    </div>
  );
}

function NavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl px-4 py-3 text-left text-sm font-medium ${
        active ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );
}

function SyncSourcePage({ onCreate }: { onCreate: () => void }) {
  const [sources, setSources] = useState<SyncSourceConfig[]>([]);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [intervalDrafts, setIntervalDrafts] = useState<Record<number, string>>({});
  const [runningId, setRunningId] = useState<number | null>(null);
  const [scheduleLoadingId, setScheduleLoadingId] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  async function load() {
    const [sourceData, statusData] = await Promise.all([
      getSyncSources(),
      getSchedulerStatus()
    ]);
    setSources(sourceData);
    setSchedulerStatus(statusData);
    setIntervalDrafts(
      Object.fromEntries(
        sourceData.map((source) => [source.id, String(source.scheduleIntervalMinutes)])
      )
    );
  }

  async function run(id: number) {
    try {
      setMessage('');
      setRunningId(id);
      const result = await runSyncSource(id);
      setMessage(
        `수동 실행 완료: runId=${result.runId}, 이번 실행 처리=${result.totalCount}, ` +
        `upserted=${result.upsertedCount}, unchanged=${result.unchangedCount}, ` +
        `skipped=${result.skippedExcludedCount}`
      );
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '실행 실패');
    } finally {
      setRunningId(null);
    }
  }

  async function saveSchedule(source: SyncSourceConfig, enabled: boolean) {
    const intervalMinutes = Number(intervalDrafts[source.id] ?? source.scheduleIntervalMinutes);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 10080) {
      setMessage('자동 동기화 주기는 1~10080분 사이의 정수로 입력해야 합니다.');
      return;
    }

    try {
      setMessage('');
      setScheduleLoadingId(source.id);
      const updated = await updateSyncSchedule(source.id, enabled, intervalMinutes);
      setMessage(
        enabled
          ? `${updated.name}: 자동 동기화를 ${updated.scheduleIntervalMinutes}분 주기로 시작했습니다.`
          : source.scheduleEnabled
            ? `${updated.name}: 자동 동기화를 중지했습니다. 수동 실행은 계속 사용할 수 있습니다.`
            : `${updated.name}: ${updated.scheduleIntervalMinutes}분 주기를 저장했습니다. 자동 동기화는 OFF 상태입니다.`
      );
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '자동 동기화 설정 저장 실패');
    } finally {
      setScheduleLoadingId(null);
    }
  }

  useEffect(() => {
    load().catch((e) => setMessage(e instanceof Error ? e.message : '조회 실패'));
  }, []);

  return (
    <section>
      <div className="mb-6 flex items-start justify-between gap-4">
        <PageHeader
          title="자동 동기화 관리"
          description="소스별 실행 주기를 분 단위로 설정하고 자동 실행을 켜거나 끌 수 있습니다."
        />
        <button onClick={onCreate} className="shrink-0 rounded-xl bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-700">
          + 동기화 소스 추가
        </button>
      </div>

      {schedulerStatus && (
        <div className={`mb-4 rounded-xl border px-4 py-3 text-sm shadow-sm ${
          schedulerStatus.enabled
            ? 'border-green-200 bg-green-50 text-green-800'
            : 'border-red-200 bg-red-50 text-red-800'
        }`}>
          <span className="font-semibold">
            전역 스케줄러 {schedulerStatus.enabled ? 'ON' : 'OFF'}
          </span>
          <span className="ml-3">
            감지 주기 {Math.max(1, Math.round(schedulerStatus.dispatchDelayMs / 1000))}초 ·
            작업 스레드 {schedulerStatus.poolSize}개
          </span>
          {!schedulerStatus.enabled && (
            <span className="ml-3 font-medium">
              application.properties의 sync.scheduler.enabled를 true로 변경해야 자동 실행됩니다.
            </span>
          )}
        </div>
      )}

      {message && <Alert>{message}</Alert>}

      <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
        <table className="min-w-[1180px] w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">소스</th>
              <th className="px-4 py-3">사용 상태</th>
              <th className="px-4 py-3">자동 동기화</th>
              <th className="px-4 py-3">실행 시각</th>
              <th className="px-4 py-3">처리 설정</th>
              <th className="px-4 py-3">수동 실행</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => {
              const scheduleBusy = scheduleLoadingId === source.id;
              return (
                <tr key={source.id} className="border-t align-top">
                  <td className="px-4 py-4">{source.id}</td>
                  <td className="px-4 py-4">
                    <div className="font-medium">{source.name}</div>
                    <div className="mt-1 text-xs text-gray-500">DB: {source.sourceDbKey}</div>
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge value={source.enabled ? 'ENABLED' : 'DISABLED'} />
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => saveSchedule(source, !source.scheduleEnabled)}
                        disabled={!source.enabled || scheduleBusy}
                        className={`relative h-7 w-12 rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          source.scheduleEnabled ? 'bg-green-600' : 'bg-gray-300'
                        }`}
                        aria-label={`${source.name} 자동 동기화 ${source.scheduleEnabled ? '끄기' : '켜기'}`}
                      >
                        <span
                          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${
                            source.scheduleEnabled ? 'left-6' : 'left-1'
                          }`}
                        />
                      </button>
                      <StatusBadge value={source.scheduleEnabled ? 'ON' : 'OFF'} />
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={10080}
                        step={1}
                        value={intervalDrafts[source.id] ?? String(source.scheduleIntervalMinutes)}
                        onChange={(e) => setIntervalDrafts({
                          ...intervalDrafts,
                          [source.id]: e.target.value
                        })}
                        disabled={!source.enabled || scheduleBusy}
                        className="w-24 rounded-lg border px-3 py-2 disabled:bg-gray-100"
                      />
                      <span className="whitespace-nowrap text-gray-600">분마다</span>
                      <button
                        type="button"
                        onClick={() => saveSchedule(source, source.scheduleEnabled)}
                        disabled={!source.enabled || scheduleBusy}
                        className="rounded-lg border px-3 py-2 font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {scheduleBusy ? '저장 중' : '적용'}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-xs leading-6 text-gray-600">
                    <div>
                      <span className="font-medium text-gray-800">다음:</span>{' '}
                      {source.scheduleEnabled ? formatDate(source.nextRunAt) || '계산 중' : '-'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-800">최근 예약:</span>{' '}
                      {formatDate(source.lastScheduledAt) || '-'}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-xs leading-6 text-gray-600">
                    <div>Chunk {source.chunkSize}</div>
                    <div>Fetch {source.fetchSize}</div>
                    <div>Lag {source.safetyLagSeconds}s</div>
                    <div>Overlap {source.overlapSeconds}s</div>
                  </td>
                  <td className="px-4 py-4">
                    <button
                      onClick={() => run(source.id)}
                      disabled={!source.enabled || runningId === source.id}
                      className="rounded-lg bg-black px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {runningId === source.id ? '실행 중' : '지금 실행'}
                    </button>
                    <div className="mt-2 max-w-32 text-xs text-gray-500">
                      자동 동기화가 OFF여도 실행할 수 있습니다.
                    </div>
                  </td>
                </tr>
              );
            })}
            {sources.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                  등록된 동기화 소스가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const DEFAULT_INCREMENTAL_SQL = `SELECT
    CAST(u.user_id AS VARCHAR) AS account_key,
    u.updated_at AS sync_updated_at
    -- 필요한 컬럼을 추가하세요.
FROM user_table u
WHERE (
        u.updated_at > :last_updated_at
        OR (
            u.updated_at = :last_updated_at
            AND CAST(u.user_id AS VARCHAR) > :last_account_key
        )
      )
  AND u.updated_at <= :current_cutoff
ORDER BY u.updated_at ASC, CAST(u.user_id AS VARCHAR) ASC
LIMIT :chunk_size`;

const DEFAULT_FETCH_ONE_SQL = `SELECT
    CAST(u.user_id AS VARCHAR) AS account_key,
    u.updated_at AS sync_updated_at
    -- 필요한 컬럼을 추가하세요.
FROM user_table u
WHERE CAST(u.user_id AS VARCHAR) = :account_key`;

const DEFAULT_UPSERT_SQL = `INSERT INTO target_user (
    account_key,
    source_updated_at,
    sync_mode,
    last_synced_at,
    updated_at
)
VALUES (
    :account_key,
    :sync_updated_at,
    'SYNC',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT (account_key)
DO UPDATE SET
    source_updated_at = EXCLUDED.source_updated_at,
    sync_mode = 'SYNC',
    last_synced_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE target_user.sync_mode <> 'MANUAL'`;

function SyncSourceCreatePage({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [sourceDbs, setSourceDbs] = useState<SourceDb[]>([]);
  const [form, setForm] = useState<CreateSyncSourceRequest>({
    sourceDbKey: '',
    name: '',
    incrementalSql: DEFAULT_INCREMENTAL_SQL,
    fetchOneSql: DEFAULT_FETCH_ONE_SQL,
    keyAlias: 'account_key',
    updatedAtAlias: 'sync_updated_at',
    upsertSql: DEFAULT_UPSERT_SQL,
    chunkSize: 500,
    fetchSize: 500,
    safetyLagSeconds: 60,
    overlapSeconds: 300,
    enabled: true,
    scheduleEnabled: false,
    scheduleIntervalMinutes: 5
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    getSourceDbs()
      .then((dbs) => {
        setSourceDbs(dbs);
        const firstEnabled = dbs.find((db) => db.enabled);
        if (firstEnabled) {
          setForm((current) => ({ ...current, sourceDbKey: current.sourceDbKey || firstEnabled.dbKey }));
        }
      })
      .catch((e) => setMessage(e instanceof Error ? e.message : 'Source DB 조회 실패'));
  }, []);

  function update<K extends keyof CreateSyncSourceRequest>(key: K, value: CreateSyncSourceRequest[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    if (!form.sourceDbKey) {
      setMessage('Source DB를 선택하세요.');
      return;
    }
    if (!form.name.trim()) {
      setMessage('동기화 소스명을 입력하세요.');
      return;
    }

    try {
      setSaving(true);
      setMessage('');
      await createSyncSource({
        ...form,
        name: form.name.trim(),
        fetchOneSql: form.fetchOneSql?.trim() || undefined
      });
      onCreated();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '동기화 소스 등록 실패');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <PageHeader
        title="동기화 소스 추가"
        description="등록된 Source DB를 선택하고 증분 조회 SQL과 타겟 UPSERT SQL을 입력합니다."
      />
      {message && <Alert>{message}</Alert>}

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <FormField label="Source DB" required>
            <select
              value={form.sourceDbKey}
              onChange={(e) => update('sourceDbKey', e.target.value)}
              className="w-full rounded-xl border px-3 py-2.5"
            >
              <option value="">선택하세요</option>
              {sourceDbs.map((db) => (
                <option key={db.dbKey} value={db.dbKey} disabled={!db.enabled}>
                  {db.name} ({db.dbKey}){db.enabled ? '' : ' - DISABLED'}
                </option>
              ))}
            </select>
            {form.sourceDbKey && (
              <div className="mt-2 text-xs text-gray-500">
                {sourceDbs.find((db) => db.dbKey === form.sourceDbKey)?.jdbcUrl}
              </div>
            )}
          </FormField>

          <FormField label="동기화 소스명" required>
            <input
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="예: 회원 기본/전화/주소 통합 동기화"
              className="w-full rounded-xl border px-3 py-2.5"
            />
          </FormField>

          <FormField label="Key Alias" required>
            <input
              value={form.keyAlias}
              onChange={(e) => update('keyAlias', e.target.value)}
              className="w-full rounded-xl border px-3 py-2.5"
            />
          </FormField>

          <FormField label="Updated At Alias" required>
            <input
              value={form.updatedAtAlias}
              onChange={(e) => update('updatedAtAlias', e.target.value)}
              className="w-full rounded-xl border px-3 py-2.5"
            />
          </FormField>
        </div>

        <SqlField
          label="증분 조회 SQL"
          required
          value={form.incrementalSql}
          onChange={(value) => update('incrementalSql', value)}
          help=":last_updated_at, :last_account_key, :current_cutoff, :chunk_size 파라미터와 ORDER BY가 필요합니다."
        />

        <SqlField
          label="단건 재조회 SQL"
          value={form.fetchOneSql ?? ''}
          onChange={(value) => update('fetchOneSql', value)}
          help="수동 제외 계정을 재포함할 때 사용합니다. :account_key 파라미터가 필요하며 선택 항목입니다."
        />

        <SqlField
          label="Target UPSERT SQL"
          required
          value={form.upsertSql}
          onChange={(value) => update('upsertSql', value)}
          help="증분 조회 SQL에서 반환한 alias를 :alias 형식의 named parameter로 사용합니다."
        />

        <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
          <NumberField label="Chunk Size" value={form.chunkSize} min={1} onChange={(v) => update('chunkSize', v)} />
          <NumberField label="Fetch Size" value={form.fetchSize} min={1} onChange={(v) => update('fetchSize', v)} />
          <NumberField label="Safety Lag(초)" value={form.safetyLagSeconds} min={0} onChange={(v) => update('safetyLagSeconds', v)} />
          <NumberField label="Overlap(초)" value={form.overlapSeconds} min={0} onChange={(v) => update('overlapSeconds', v)} />
          <NumberField label="자동 실행 주기(분)" value={form.scheduleIntervalMinutes} min={1} max={10080} onChange={(v) => update('scheduleIntervalMinutes', v)} />
        </div>

        <div className="mt-5 flex flex-wrap gap-6 rounded-xl bg-gray-50 px-4 py-3">
          <CheckboxField
            label="동기화 소스 사용"
            checked={form.enabled}
            onChange={(checked) => update('enabled', checked)}
          />
          <CheckboxField
            label="등록 즉시 자동 동기화 ON"
            checked={form.scheduleEnabled}
            onChange={(checked) => update('scheduleEnabled', checked)}
          />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onCancel} disabled={saving} className="rounded-xl border px-5 py-2.5 disabled:opacity-40">
            취소
          </button>
          <button onClick={submit} disabled={saving || sourceDbs.every((db) => !db.enabled)} className="rounded-xl bg-black px-5 py-2.5 text-white disabled:opacity-40">
            {saving ? '등록 중' : '동기화 소스 등록'}
          </button>
        </div>
      </div>
    </section>
  );
}

function TargetUserPage() {
  const [keyword, setKeyword] = useState('');
  const [syncMode, setSyncMode] = useState('');
  const [users, setUsers] = useState<TargetUser[]>([]);
  const [editing, setEditing] = useState<TargetUser | null>(null);
  const [message, setMessage] = useState('');

  async function load() {
    setUsers(await getTargetUsers(keyword, syncMode));
  }

  async function reinclude(user: TargetUser) {
    try {
      await reincludeAccount(user.accountKey, 1);
      setMessage(`${user.accountKey} 계정을 동기화 대상으로 재포함했습니다.`);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '재포함 실패');
    }
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  return (
    <section>
      <PageHeader title="타겟 사용자" description="수동 수정하면 자동으로 동기화 제외 상태가 됩니다." />
      {message && <Alert>{message}</Alert>}
      <div className="mb-4 flex gap-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="account key, 이름, 이메일 검색"
          className="w-80 rounded-xl border bg-white px-4 py-2"
        />
        <select value={syncMode} onChange={(e) => setSyncMode(e.target.value)} className="rounded-xl border bg-white px-4 py-2">
          <option value="">전체</option>
          <option value="SYNC">SYNC</option>
          <option value="MANUAL">MANUAL</option>
        </select>
        <button onClick={load} className="rounded-xl bg-black px-4 py-2 text-white">검색</button>
      </div>
      <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
        <table className="min-w-[1000px] w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-3">Account Key</th>
              <th className="px-4 py-3">Login ID</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Address</th>
              <th className="px-4 py-3">Org</th>
              <th className="px-4 py-3">Mode</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.accountKey} className="border-t">
                <td className="px-4 py-3 font-medium">{user.accountKey}</td>
                <td className="px-4 py-3">{user.loginId}</td>
                <td className="px-4 py-3">{user.name}</td>
                <td className="px-4 py-3">{user.email}</td>
                <td className="px-4 py-3">{user.addressText}</td>
                <td className="px-4 py-3">{user.organizationName}</td>
                <td className="px-4 py-3"><StatusBadge value={user.syncMode} /></td>
                <td className="space-x-2 px-4 py-3">
                  <button onClick={() => setEditing(user)} className="rounded-lg border px-3 py-2">수동 수정</button>
                  {user.syncMode === 'MANUAL' && (
                    <button onClick={() => reinclude(user)} className="rounded-lg bg-blue-600 px-3 py-2 text-white">재포함</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <ManualEditModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setMessage(`${editing.accountKey} 계정을 수동 수정했습니다.`);
            await load();
          }}
        />
      )}
    </section>
  );
}

function ManualEditModal({ user, onClose, onSaved }: { user: TargetUser; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, string>>({
    login_id: user.loginId ?? '',
    name: user.name ?? '',
    email: user.email ?? '',
    phone: user.phone ?? '',
    address_text: user.addressText ?? '',
    organization_name: user.organizationName ?? '',
    status: user.status ?? ''
  });
  const [reason, setReason] = useState('수동 수정');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await updateManualAccount(user.accountKey, form, reason, 'admin');
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4">
          <h2 className="text-xl font-bold">수동 수정</h2>
          <p className="mt-1 text-sm text-gray-500">저장하면 해당 계정은 MANUAL 모드가 됩니다.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(form).map(([key, value]) => (
            <label key={key} className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">{key}</span>
              <input
                value={value}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="w-full rounded-xl border px-3 py-2"
              />
            </label>
          ))}
        </div>
        <label className="mt-3 block text-sm">
          <span className="mb-1 block font-medium text-gray-700">수정 사유</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} className="h-24 w-full rounded-xl border px-3 py-2" />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border px-4 py-2">취소</button>
          <button onClick={save} disabled={saving} className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-40">
            {saving ? '저장 중' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SyncRunPage() {
  const [runs, setRuns] = useState<SyncRunView[]>([]);
  const [sourceDbs, setSourceDbs] = useState<SourceDb[]>([]);
  const [sources, setSources] = useState<SyncSourceConfig[]>([]);
  const [sourceDbKey, setSourceDbKey] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [message, setMessage] = useState('');

  const filteredSources = useMemo(
    () => sources.filter((source) => !sourceDbKey || source.sourceDbKey === sourceDbKey),
    [sources, sourceDbKey]
  );

  const dbSummaries = useMemo(() => {
    const summaries = new Map<string, { name: string; total: number; latest: string }>();
    for (const run of runs) {
      if (!summaries.has(run.sourceDbKey)) {
        summaries.set(run.sourceDbKey, {
          name: run.sourceDbName,
          total: run.sourceDbTotalCount,
          latest: run.startedAt
        });
      }
    }
    return Array.from(summaries.entries());
  }, [runs]);

  async function load(nextDbKey = sourceDbKey, nextSourceId = sourceId) {
    try {
      setMessage('');
      setRuns(await getSyncRuns(nextDbKey || undefined, nextSourceId ? Number(nextSourceId) : undefined));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '실행 이력 조회 실패');
    }
  }

  useEffect(() => {
    Promise.all([getSourceDbs(), getSyncSources(), getSyncRuns()])
      .then(([dbData, sourceData, runData]) => {
        setSourceDbs(dbData);
        setSources(sourceData);
        setRuns(runData);
      })
      .catch((e) => setMessage(e instanceof Error ? e.message : '실행 이력 조회 실패'));
  }, []);

  function changeDb(value: string) {
    setSourceDbKey(value);
    setSourceId('');
  }

  return (
    <section>
      <PageHeader
        title="실행 이력"
        description="Source DB와 동기화 소스별로 실행 이력을 구분합니다. 현재 DB 전체 대상 건수와 이번 실행에서 실제 조회한 건수를 별도로 표시합니다."
      />
      {message && <Alert>{message}</Alert>}

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border bg-white p-4 shadow-sm">
        <FormField label="Source DB">
          <select value={sourceDbKey} onChange={(e) => changeDb(e.target.value)} className="min-w-64 rounded-xl border px-3 py-2">
            <option value="">전체 Source DB</option>
            {sourceDbs.map((db) => (
              <option key={db.dbKey} value={db.dbKey}>{db.name} ({db.dbKey})</option>
            ))}
          </select>
        </FormField>
        <FormField label="동기화 소스">
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="min-w-72 rounded-xl border px-3 py-2">
            <option value="">전체 동기화 소스</option>
            {filteredSources.map((source) => (
              <option key={source.id} value={source.id}>{source.name} (#{source.id})</option>
            ))}
          </select>
        </FormField>
        <button onClick={() => load()} className="rounded-xl bg-black px-4 py-2 text-white">조회</button>
        <button
          onClick={() => {
            setSourceDbKey('');
            setSourceId('');
            load('', '');
          }}
          className="rounded-xl border px-4 py-2"
        >
          필터 초기화
        </button>
      </div>

      {dbSummaries.length > 0 && (
        <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {dbSummaries.map(([key, summary]) => (
            <div key={key} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">{summary.name}</div>
              <div className="mt-1 text-xs text-gray-400">{key}</div>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <div className="text-xs font-medium text-gray-500">현재 DB 전체 동기화 대상</div>
                  <div className="text-3xl font-bold">{summary.total}</div>
                </div>
                <div className="text-right text-xs text-gray-500">
                  최근 실행<br />{formatDate(summary.latest)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        한 Source DB의 데이터가 여러 동기화 소스로 나뉘면 각 실행의 처리 건수는 해당 소스가 조회한 건수만 표시됩니다.
        현재 DB 전체 대상은 같은 Source DB에 속한 모든 동기화 소스의 고유 계정을 합산해 표시합니다.
      </div>

      <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
        <table className="min-w-[1450px] w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-3">Run ID</th>
              <th className="px-4 py-3">Source DB</th>
              <th className="px-4 py-3">동기화 소스</th>
              <th className="px-4 py-3">Trigger</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">현재 DB 전체 대상</th>
              <th className="px-4 py-3">소스 대상</th>
              <th className="px-4 py-3">이번 실행 처리</th>
              <th className="px-4 py-3">Upserted</th>
              <th className="px-4 py-3">Unchanged</th>
              <th className="px-4 py-3">Skipped</th>
              <th className="px-4 py-3">Failed</th>
              <th className="px-4 py-3">Started</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-t align-top">
                <td className="px-4 py-3">{run.id}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{run.sourceDbName}</div>
                  <div className="mt-1 text-xs text-gray-500">{run.sourceDbKey}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">{run.sourceName}</div>
                  <div className="mt-1 text-xs text-gray-500">Source #{run.sourceId}</div>
                </td>
                <td className="px-4 py-3">{run.triggerType}</td>
                <td className="px-4 py-3">
                  <StatusBadge value={run.status} />
                  {run.errorMessage && <div className="mt-2 max-w-64 text-xs text-red-600">{run.errorMessage}</div>}
                </td>
                <td className="px-4 py-3 text-lg font-bold">{run.sourceDbTotalCount}</td>
                <td className="px-4 py-3">{run.sourceTotalCount}</td>
                <td className="px-4 py-3 font-semibold">{run.totalCount}</td>
                <td className="px-4 py-3">{run.upsertedCount}</td>
                <td className="px-4 py-3">{run.unchangedCount}</td>
                <td className="px-4 py-3">{run.skippedExcludedCount}</td>
                <td className="px-4 py-3">{run.failedCount}</td>
                <td className="px-4 py-3">{formatDate(run.startedAt)}</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={13} className="px-4 py-12 text-center text-gray-500">조회된 실행 이력이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-3xl font-bold">{title}</h1>
      <p className="mt-2 text-gray-500">{description}</p>
    </div>
  );
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium text-gray-700">
        {label}{required && <span className="ml-1 text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

function SqlField({
  label,
  required,
  value,
  onChange,
  help
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  help: string;
}) {
  return (
    <div className="mt-5">
      <FormField label={label} required={required}>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="h-64 w-full rounded-xl border bg-gray-950 p-4 font-mono text-sm leading-6 text-gray-100"
        />
        <div className="mt-2 text-xs text-gray-500">{help}</div>
      </FormField>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <FormField label={label} required>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-xl border px-3 py-2.5"
      />
    </FormField>
  );
}

function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
      {label}
    </label>
  );
}

function Alert({ children }: { children: ReactNode }) {
  return <div className="mb-4 whitespace-pre-wrap rounded-xl border bg-white px-4 py-3 text-sm text-gray-700 shadow-sm">{children}</div>;
}

function StatusBadge({ value }: { value: string }) {
  const tone = useMemo(() => {
    if (value === 'SUCCESS' || value === 'SYNC' || value === 'ENABLED' || value === 'ON') return 'bg-green-100 text-green-700';
    if (value === 'FAILED' || value === 'DISABLED' || value === 'OFF') return 'bg-red-100 text-red-700';
    if (value === 'MANUAL' || value === 'SKIPPED_EXCLUDED') return 'bg-orange-100 text-orange-700';
    if (value === 'RUNNING') return 'bg-blue-100 text-blue-700';
    return 'bg-gray-100 text-gray-700';
  }, [value]);
  return <span className={`rounded-full px-2 py-1 text-xs font-semibold ${tone}`}>{value}</span>;
}

function formatDate(value?: string) {
  if (!value) return '';
  return value.replace('T', ' ').slice(0, 19);
}
