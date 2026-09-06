import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Capability = { provider: string; backend: string; status: string; operations: string[]; limitations: string[] };
type Client = { id: string; name: string; revoked: boolean; policyVersion: number; grants: unknown[] };
type Operation = { id: string; provider: string; state: string; createdAt: number; expiresAt: number; clientId: string };
type Audit = { at: number; provider?: string; action: string; outcome: string; count: number; clientId?: string; errorCode?: string };
type AuditSummary = { count: number; bytes: number };
type Bootstrap = { csrf: string; capabilities: Capability[] };

async function api<T>(csrf: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch('/api/rpc', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ method, params }) });
  const payload = await response.json() as { ok: boolean; result?: T; error?: { message: string } };
  if (!payload.ok) throw new Error(payload.error?.message ?? 'Management request failed.');
  return payload.result as T;
}
function date(value: number): string { return new Date(value).toLocaleString(); }

function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap>();
  const [page, setPage] = useState<'connections' | 'sources' | 'records' | 'pending'>('connections');
  const [clients, setClients] = useState<Client[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [auditSummary, setAuditSummary] = useState<AuditSummary>({ count: 0, bytes: 0 });
  const [error, setError] = useState('');
  const [createdToken, setCreatedToken] = useState('');
  const [name, setName] = useState('');
  const [grant, setGrant] = useState('{"provider":"reminders","containerIds":[],"actions":["read"],"fields":"full","approval":"automatic","expiresAt":0}');
  const refresh = async (csrf = bootstrap?.csrf) => {
    if (!csrf) return;
    try {
      const [nextClients, nextOperations, nextAudit, nextSummary] = await Promise.all([api<Client[]>(csrf, 'clients.list'), api<Operation[]>(csrf, 'operations.list'), api<Audit[]>(csrf, 'audit.list'), api<AuditSummary>(csrf, 'audit.summary')]);
      setClients(nextClients); setOperations(nextOperations); setAudit(nextAudit); setAuditSummary(nextSummary); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not refresh management data.'); }
  };
  useEffect(() => { void (async () => {
    try { const next = await (await fetch('/api/bootstrap', { credentials: 'same-origin' })).json() as Bootstrap; setBootstrap(next); await refresh(next.csrf); }
    catch { setError('Management session expired. Re-open the local management link.'); }
  })(); }, []);
  if (!bootstrap) return <main className="loading">Opening secure management session… {error && <p>{error}</p>}</main>;
  const createClient = async (event: React.FormEvent) => {
    event.preventDefault(); setCreatedToken('');
    try {
      const parsed = JSON.parse(grant) as unknown;
      const created = await api<{ client: Client; token: string }>(bootstrap.csrf, 'clients.create', { name, grants: [parsed] });
      setCreatedToken(created.token); setName(''); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Client creation failed.'); }
  };
  const revoke = async (id: string) => { try { await api(bootstrap.csrf, 'clients.revoke', { id }); await refresh(); } catch (cause) { setError(String(cause)); } };
  const approve = async (id: string) => { try { await api(bootstrap.csrf, 'operations.approve', { id }); await refresh(); } catch (cause) { setError(String(cause)); } };
  const exportAudit = () => {
    const blob = new Blob([JSON.stringify(audit, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `apple-connector-audit-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url);
  };
  const clearAudit = async () => { if (!window.confirm('Clear all local audit records? This cannot be undone.')) return; try { await api(bootstrap.csrf, 'audit.clear'); await refresh(); } catch (cause) { setError(String(cause)); } };
  return <main>
    <header><div><h1>Apple Connector</h1><p>Local-only management console</p></div><button onClick={() => void refresh()}>Refresh</button></header>
    <nav>{([['connections', 'Connections & access'], ['sources', 'Data sources'], ['records', 'Operation records'], ['pending', 'Awaiting approval']] as const).map(([key, label]) => <button className={page === key ? 'active' : ''} onClick={() => setPage(key)} key={key}>{label}</button>)}</nav>
    {error && <p className="error" role="alert">{error}</p>}
    {page === 'connections' && <section><h2>Clients</h2><p>Each client receives a separate credential. Revoke immediately when access is no longer needed.</p>
      <table><thead><tr><th>Name</th><th>State</th><th>Policy</th><th>Action</th></tr></thead><tbody>{clients.map((client) => <tr key={client.id}><td><code>{client.name}</code><small>{client.id}</small></td><td>{client.revoked ? 'Revoked' : 'Active'}</td><td>v{client.policyVersion}</td><td>{!client.revoked && <button className="danger" onClick={() => void revoke(client.id)}>Revoke</button>}</td></tr>)}</tbody></table>
      <h3>Pair a client</h3><form onSubmit={createClient}><label>Name<input required value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></label><label>One grant (JSON)<textarea value={grant} onChange={(event) => setGrant(event.target.value)} rows={5} /></label><button type="submit">Create client</button></form>
      {createdToken && <aside className="secret"><strong>Copy this token now — it will not be shown again.</strong><code>{createdToken}</code></aside>}</section>}
    {page === 'sources' && <section><h2>System and connector capabilities</h2>{bootstrap.capabilities.map((source) => <article className="card" key={source.provider}><h3>{source.provider} <span className={`status ${source.status}`}>{source.status}</span></h3><p>Backend: {source.backend}; advertised operations: {source.operations.length ? source.operations.join(', ') : 'none'}.</p><ul>{source.limitations.map((limit) => <li key={limit}>{limit}</li>)}</ul></article>)}</section>}
    {page === 'records' && <section><h2>Operations</h2><table><thead><tr><th>Provider</th><th>State</th><th>Created</th><th>Expires</th></tr></thead><tbody>{operations.map((item) => <tr key={item.id}><td>{item.provider}<small>{item.id}</small></td><td>{item.state}</td><td>{date(item.createdAt)}</td><td>{date(item.expiresAt)}</td></tr>)}</tbody></table><h2>Audit (metadata only)</h2><p>{auditSummary.count.toLocaleString()} records using {auditSummary.bytes.toLocaleString()} logical bytes. Export contains only the records displayed here; titles, note bodies and tokens are never retained.</p><p><button onClick={exportAudit}>Export displayed audit JSON</button> <button className="danger" onClick={() => void clearAudit()}>Clear audit</button></p><table><thead><tr><th>Time</th><th>Action</th><th>Result</th><th>Items</th></tr></thead><tbody>{audit.map((item, index) => <tr key={`${item.at}-${index}`}><td>{date(item.at)}</td><td>{item.provider ? `${item.provider}: ` : ''}{item.action}</td><td>{item.outcome}{item.errorCode ? ` (${item.errorCode})` : ''}</td><td>{item.count}</td></tr>)}</tbody></table></section>}
    {page === 'pending' && <section><h2>Awaiting approval</h2><p>Approving grants permission to commit the existing immutable plan only; it does not alter its content.</p><table><thead><tr><th>Provider</th><th>Plan</th><th>Expires</th><th>Action</th></tr></thead><tbody>{operations.filter((item) => item.state === 'prepared').map((item) => <tr key={item.id}><td>{item.provider}</td><td><code>{item.id}</code></td><td>{date(item.expiresAt)}</td><td><button onClick={() => void approve(item.id)}>Approve</button></td></tr>)}</tbody></table></section>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
