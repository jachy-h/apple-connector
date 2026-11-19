import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { formatDate, readLanguagePreference, saveLanguagePreference, translations, type Language } from '../../src/web/i18n.js';
import { usageGuide } from '../../src/web/docs.js';
import { buildAgentPrompt } from '../../src/web/agent-prompt.js';
import { auditHeatmapWindow, type AuditLaneRef } from '../../src/web/audit-chart.js';
import type { AuditEvent } from '../../src/audit/schema.js';
import {
  agentBinding, buildAuthorizationGrants, buildContainerNameIndex, containerDisplayName, defaultContainerPermission,
  defaultExpiry, permissionSettingsUrl, permissionState, profileActions, profileGrant,
  type AgentBinding, type ContainerPermission, type ProfileGrant,
} from '../../src/web/management-view.js';
import { readHiddenAuditLanes, saveHiddenAuditLanes, toggleHiddenAuditLane } from '../../src/web/audit-preferences.js';
import { AuditChart } from './AuditChart.js';
import './style.css';

type Bootstrap = { csrf: string; expiresAt: number; remainingSeconds: number };
type Container = { id: string; name: string };
type Client = { id: string; name: string; revoked: boolean; policyVersion: number; lastUsedAt: number | null; agentName: string | null; verifiedAt: number | null; grants: unknown[] };
type Permissions = Partial<Record<'calendar' | 'reminders', unknown>>;
type Page = 'setup' | 'audit' | 'docs';
type Provider = 'calendar' | 'reminders';

const AUDIT_PAGE_SIZE = 200;
const AUDIT_MAX_ROWS = 2000;

async function loadAuditEvents(csrf: string, from: number, to: number): Promise<{ items: AuditEvent[]; total: number }> {
  const items: AuditEvent[] = [];
  let total = 0;
  let offset = 0;
  while (offset < AUDIT_MAX_ROWS) {
    const page = await api<{ items: AuditEvent[]; total: number }>(csrf, 'audit.query', { from, to, offset, limit: AUDIT_PAGE_SIZE });
    total = page.total;
    items.push(...page.items);
    if (page.items.length < AUDIT_PAGE_SIZE || items.length >= Math.min(total, AUDIT_MAX_ROWS)) break;
    offset += AUDIT_PAGE_SIZE;
  }
  return { items: items.slice(0, AUDIT_MAX_ROWS), total };
}

async function api<T>(csrf: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch('/api/rpc', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ method, params }) });
  const payload = await response.json() as { ok: boolean; result?: T; error?: { message: string } };
  if (!payload.ok) throw new Error(payload.error?.message ?? 'Management request failed.');
  return payload.result as T;
}
const initialPage = (): Page => {
  const value = new URLSearchParams(location.search).get('section');
  return value === 'audit' || value === 'docs' ? value : 'setup';
};
const clock = (seconds: number) => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

type StepNumber = 1 | 2 | 3 | 4;
type StepTone = 'done' | 'todo' | 'waiting' | 'locked';

interface StepProps {
  title: string;
  body: string;
  state: string;
  tone: StepTone;
  children: React.ReactNode;
}

function SetupStep({ title, body, state, tone, children }: StepProps) {
  return <article className={`setup-step ${tone}`}>
    <div className="step-content">
      <header className="step-heading">
        <div><h3>{title}</h3><p>{body}</p></div>
        <span className={`step-state ${tone}`}>{state}</span>
      </header>
      {children}
    </div>
  </article>;
}

function BindingBadge({ binding, language, labels }: {
  binding: AgentBinding; language: Language;
  labels: { bound: string; used: string; never: string; unknown: string };
}) {
  const label = binding.tone === 'bound'
    ? `${labels.bound} · ${binding.agentName ?? labels.unknown}`
    : binding.tone === 'used' ? labels.used : labels.never;
  return <span className={`binding-badge ${binding.tone}`}>
    <span className="binding-dot" aria-hidden="true" />
    {label}
    {binding.at !== null && <small>{formatDate(binding.at, language)}</small>}
  </span>;
}

function App() {
  const [language, setLanguage] = useState<Language>(() => readLanguagePreference(window.localStorage));
  const t = translations[language];
  const [bootstrap, setBootstrap] = useState<Bootstrap>();
  const [page, setPage] = useState<Page>(initialPage);
  const [activeStep, setActiveStep] = useState<StepNumber>(1);
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditTo, setAuditTo] = useState(() => Date.now());
  const [auditReload, setAuditReload] = useState(0);
  const [auditError, setAuditError] = useState('');
  const [hiddenLanes, setHiddenLanes] = useState<string[]>(() => readHiddenAuditLanes(window.localStorage));
  const [calendarContainers, setCalendarContainers] = useState<Container[]>([]);
  const [reminderContainers, setReminderContainers] = useState<Container[]>([]);
  const [calendarSettings, setCalendarSettings] = useState<Record<string, ContainerPermission>>({});
  const [reminderSettings, setReminderSettings] = useState<Record<string, ContainerPermission>>({});
  const [expiresAt, setExpiresAt] = useState(defaultExpiry);
  const [containerNames, setContainerNames] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<{ token: string; client: Client }>();
  const [permissions, setPermissions] = useState<Permissions>();
  const [permissionsCheckedAt, setPermissionsCheckedAt] = useState<number>();
  const [permissionsError, setPermissionsError] = useState('');

  const load = async (csrf: string) => {
    setClients(await api<Client[]>(csrf, 'clients.list'));
  };
  const refreshClients = async (csrf: string) => {
    try { setClients(await api<Client[]>(csrf, 'clients.list')); }
    catch { /* A transient refresh failure must not replace the last known binding state. */ }
  };
  const refreshPermissions = async (csrf: string) => {
    try {
      const summary = await api<{ systemPermissions: Permissions }>(csrf, 'diagnostics.summary');
      setPermissions(summary.systemPermissions);
      setPermissionsCheckedAt(Date.now());
      setPermissionsError('');
    } catch (error) {
      setPermissions(undefined);
      setPermissionsCheckedAt(Date.now());
      setPermissionsError(error instanceof Error ? error.message : t.unavailable);
    }
  };
  const chooseLanguage = (next: Language) => { saveLanguagePreference(window.localStorage, next); setLanguage(next); };

  useEffect(() => {
    void fetch('/api/bootstrap', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Management session required.');
        return response.json() as Promise<Bootstrap>;
      })
      .then(async (value) => {
        setBootstrap(value);
        setSeconds(Math.max(0, Math.ceil((value.expiresAt - Date.now()) / 1000)));
        await Promise.all([load(value.csrf), refreshPermissions(value.csrf)]);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : t.couldNotOpen));
  }, []);
  useEffect(() => {
    if (!bootstrap) return;
    const timer = window.setInterval(() => setSeconds(Math.max(0, Math.ceil((bootstrap.expiresAt - Date.now()) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [bootstrap]);
  useEffect(() => {
    if (!bootstrap || page !== 'setup') return;
    let cancelled = false;
    void Promise.all((['calendar', 'reminders'] as const).map(async (provider) => {
      try { return { provider, items: await api<Container[]>(bootstrap.csrf, 'web.list_containers', { provider }) }; }
      catch { return { provider, items: [] as Container[] }; }
    })).then((results) => {
      if (cancelled) return;
      const calendar = results.find((result) => result.provider === 'calendar')?.items ?? [];
      const reminders = results.find((result) => result.provider === 'reminders')?.items ?? [];
      setCalendarContainers(calendar);
      setReminderContainers(reminders);
      setContainerNames(buildContainerNameIndex({ calendar, reminders }));
    });
    return () => { cancelled = true; };
  }, [bootstrap, page, permissions]);
  useEffect(() => {
    if (!bootstrap || page !== 'setup') return;
    const refresh = () => { if (document.visibilityState === 'visible') void refreshPermissions(bootstrap.csrf); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [bootstrap, page, language]);
  useEffect(() => {
    if (!bootstrap || page !== 'setup') return;
    // Binding is written by an Agent process. Poll the authorization list so the page shows a
    // completed verification without requiring a manual refresh.
    const refresh = () => { if (document.visibilityState === 'visible') void refreshClients(bootstrap.csrf); };
    const timer = window.setInterval(refresh, 3000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [bootstrap, page]);

  useEffect(() => {
    if (!bootstrap || page !== 'audit') return;
    let cancelled = false;
    const window = auditHeatmapWindow(Date.now());
    setAuditTo(window.to);
    setAuditLoading(true);
    setAuditError('');
    const containersFor = async (provider: Provider) => {
      try { return await api<Container[]>(bootstrap.csrf, 'web.list_containers', { provider }); }
      catch { return [] as Container[]; }
    };
    void Promise.all([loadAuditEvents(bootstrap.csrf, window.from, window.to), containersFor('calendar'), containersFor('reminders')])
      .then(([audit, calendar, reminders]) => {
        if (cancelled) return;
        setAuditEvents(audit.items);
        setAuditTotal(audit.total);
        setContainerNames(buildContainerNameIndex({ calendar, reminders }));
      })
      .catch((error) => { if (!cancelled) setAuditError(error instanceof Error ? error.message : t.unavailable); })
      .finally(() => { if (!cancelled) setAuditLoading(false); });
    return () => { cancelled = true; };
  }, [bootstrap, page, auditReload]);

  const hideLane = (key: string) => setHiddenLanes((current) => {
    const next = toggleHiddenAuditLane(current, key);
    saveHiddenAuditLanes(window.localStorage, next);
    return next;
  });
  const restoreLane = (key: string) => setHiddenLanes((current) => {
    const next = current.filter((item) => item !== key);
    saveHiddenAuditLanes(window.localStorage, next);
    return next;
  });
  const restoreAllLanes = () => {
    setHiddenLanes([]);
    saveHiddenAuditLanes(window.localStorage, []);
  };
  const deleteAuditLane = async (ref: AuditLaneRef) => {
    try {
      const result = await api<{ deleted: number }>(bootstrap.csrf, 'audit.delete_lane', ref);
      setMessage(t.auditLaneDeleted(result.deleted));
      setAuditReload((value) => value + 1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.couldNotDelete);
    }
  };
  if (!bootstrap) return <main className="loading-shell"><div className="loading-mark">▲</div><h1>Apple Connector</h1><p>{message || t.loadingSession}</p></main>;

  const expired = seconds === 0;
  const disabled = expired;
  const requestPermission = async (selected: Provider) => {
    try {
      const status = await api<Permissions>(bootstrap.csrf, 'diagnostics.permissions.request', { provider: selected });
      setPermissions(status);
      setPermissionsCheckedAt(Date.now());
      setPermissionsError('');
    } catch (error) {
      setPermissionsCheckedAt(Date.now());
      setPermissionsError(error instanceof Error ? error.message : t.unavailable);
    }
  };
  const settingFor = (settings: Record<string, ContainerPermission>, id: string) => settings[id] ?? defaultContainerPermission();
  const updateSetting = (setter: React.Dispatch<React.SetStateAction<Record<string, ContainerPermission>>>, id: string, patch: Partial<ContainerPermission>) => setter((current) => ({ ...current, [id]: { ...(current[id] ?? defaultContainerPermission()), ...patch } }));
  const toggleAction = (settings: Record<string, ContainerPermission>, setter: React.Dispatch<React.SetStateAction<Record<string, ContainerPermission>>>, id: string, action: ContainerPermission['actions'][number]) => {
    const current = settingFor(settings, id);
    updateSetting(setter, id, { actions: current.actions.includes(action) ? current.actions.filter((item) => item !== action) : [...current.actions, action] });
  };
  const selections = (containers: Container[], settings: Record<string, ContainerPermission>) => containers.flatMap((container) => {
    const setting = settingFor(settings, container.id);
    return setting.selected ? [{ containerId: container.id, actions: setting.actions }] : [];
  });
  const createAuthorization = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const calendar = selections(calendarContainers, calendarSettings);
    const reminders = selections(reminderContainers, reminderSettings);
    if (!calendar.length && !reminders.length) { setMessage(t.selectAtLeastOneContainer); return; }
    if ([...calendar, ...reminders].some((selection) => selection.actions.length === 0)) { setMessage(t.selectAtLeastOneAction); return; }
    try {
      const grants = buildAuthorizationGrants({ calendar, reminders }, new Date(expiresAt).getTime());
      const name = String(form.get('name') ?? '').trim() || t.defaultProfileName;
      const result = await api<{ client: Client; token: string; credentialKey: string }>(bootstrap.csrf, 'clients.create', { name, grants });
      setCreated({ token: result.token, client: result.client });
      setActiveStep(3);
      setMessage('');
      setCalendarSettings({});
      setReminderSettings({});
      setExpiresAt(defaultExpiry());
      formElement.reset();
      await load(bootstrap.csrf);
    } catch (error) { setMessage(error instanceof Error ? error.message : t.couldNotCreate); }
  };
  const deleteAuthorization = async (client: Client) => {
    if (!window.confirm(t.deleteProfileConfirm(client.name))) return;
    try {
      await api(bootstrap.csrf, 'clients.delete', { id: client.id });
      if (created?.client.id === client.id) { setCreated(undefined); setActiveStep(2); }
      await load(bootstrap.csrf);
    } catch (error) { setMessage(error instanceof Error ? error.message : t.couldNotDelete); }
  };
  const copyText = async (text: string, success: string) => {
    try { await navigator.clipboard.writeText(text); setMessage(success); }
    catch { setMessage(t.copyFailed); }
  };
  const copyToken = () => created ? copyText(created.token, t.copied) : undefined;
  const pages: Array<[Page, string]> = [['setup', t.setup], ['audit', t.audit], ['docs', t.docs]];
  const actionLabels = { read: t.read, create: t.create, update: t.update, complete: t.complete, delete: t.delete };
  const providerName = (value: Provider) => value === 'calendar' ? t.calendar : t.reminders;
  const guide = usageGuide[language];
  const providerSettings = (provider: Provider) => provider === 'calendar' ? calendarSettings : reminderSettings;
  const providerSetter = (provider: Provider) => provider === 'calendar' ? setCalendarSettings : setReminderSettings;
  const renderContainer = (provider: Provider, container: Container) => {
    const settings = providerSettings(provider);
    const setting = settingFor(settings, container.id);
    return <div className={`container-grant${setting.selected ? ' selected' : ''}`} key={`${provider}-${container.id}`}>
      <label className="check container-select">
        <input type="checkbox" checked={setting.selected} onChange={(event) => updateSetting(providerSetter(provider), container.id, { selected: event.target.checked })} />
        <span>{container.name}<small>{container.id}</small></span>
      </label>
      {setting.selected && <div className="container-controls">
        <div className="control-group">
          <span className="control-label">{t.allowedActions}</span>
          <div className="check-row">{profileActions(provider).map((action) => <label className="check" key={action}>
            <input type="checkbox" checked={setting.actions.includes(action)} onChange={() => toggleAction(settings, providerSetter(provider), container.id, action)} />
            {actionLabels[action]}
          </label>)}</div>
        </div>
      </div>}
    </div>;
  };
  const expiredNotice = expired && <p className="notice error">{t.sessionExpired} <code>apple-connector open</code>。</p>;

  const bindingLabels = { bound: t.agentBound, used: t.agentUsedUnverified, never: t.agentNotBound, unknown: t.unknownAgent };
  const fullAccess = (['calendar', 'reminders'] as const).some((key) => permissionState(permissions?.[key]).raw === 'full_access');
  const permissionKnown = permissions !== undefined || Boolean(permissionsError);
  const authorizationLocked = permissionKnown && !fullAccess;
  const activeClients = clients.filter((client) => !client.revoked);
  const createdClient = created ? clients.find((client) => client.id === created.client.id) ?? created.client : undefined;
  const createdBinding = createdClient ? agentBinding(createdClient) : undefined;
  const anyBound = activeClients.some((client) => agentBinding(client).tone === 'bound');
  const stepState = (done: boolean, tone: 'todo' | 'waiting' | 'locked' = 'todo') => done ? t.stepDone : tone === 'waiting' ? t.stepWaiting : tone === 'locked' ? t.stepLocked : t.stepTodo;
  const stepTone = (done: boolean, fallback: 'todo' | 'waiting' | 'locked' = 'todo'): StepTone => done ? 'done' : fallback;
  const authorizationTone = stepTone(activeClients.length > 0, authorizationLocked && activeClients.length === 0 ? 'locked' : 'todo');
  const authorizationState = stepState(activeClients.length > 0, authorizationLocked && activeClients.length === 0 ? 'locked' : 'todo');
  const verifyDone = Boolean(createdBinding && createdBinding.tone === 'bound') || (!created && anyBound);
  const verifyTone = stepTone(verifyDone, created ? 'waiting' : 'todo');
  const steps: Array<{ index: StepNumber; title: string; state: string; tone: StepTone }> = [
    { index: 1, title: t.stepSystemTitle, state: stepState(fullAccess), tone: stepTone(fullAccess) },
    { index: 2, title: t.stepAuthorizationTitle, state: authorizationState, tone: authorizationTone },
    { index: 3, title: t.stepPromptTitle, state: stepState(activeClients.length > 0), tone: stepTone(activeClients.length > 0) },
    { index: 4, title: t.stepVerifyTitle, state: stepState(verifyDone, created ? 'waiting' : 'todo'), tone: verifyTone },
  ];
  const selectStep = (step: StepNumber) => setActiveStep(step);
  const handleStepKey = (event: React.KeyboardEvent<HTMLButtonElement>, index: StepNumber) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 1 : event.key === 'End' ? 4 : ((index - 1 + (event.key === 'ArrowRight' ? 1 : -1) + 4) % 4) + 1;
    const step = next as StepNumber;
    setActiveStep(step);
    document.getElementById(`setup-tab-${step}`)?.focus();
  };

  return <main className={expired ? 'app-shell expired' : 'app-shell'}>
    <header className="topbar">
      <a className="brand" href="/?section=setup" aria-label="Apple Connector"><span>▲</span><strong>Apple Connector</strong></a>
      <nav aria-label="Management sections">{pages.map(([key, label]) => <button key={key} disabled={disabled} className={page === key ? 'active' : ''} onClick={() => { setPage(key); if (key !== 'setup') { setCreated(undefined); setActiveStep(1); } }}>{label}</button>)}</nav>
      <div className="topbar-right">
        <div className="language-switcher" role="group" aria-label={t.languageSelector}>
          <button className={language === 'zh-CN' ? 'active' : ''} aria-pressed={language === 'zh-CN'} onClick={() => chooseLanguage('zh-CN')}>中文</button>
          <button className={language === 'en-US' ? 'active' : ''} aria-pressed={language === 'en-US'} onClick={() => chooseLanguage('en-US')}>EN</button>
        </div>
        <div className="session"><span>{t.managementSession} · {clock(seconds)}</span><small>{formatDate(bootstrap.expiresAt, language)}</small></div>
      </div>
    </header>
    <div className="hero"><div><p className="eyebrow">APPLE CONNECTOR / LOCAL</p><h1>{pages.find(([key]) => key === page)?.[1]}</h1><p>{t.localManagement}</p></div><div className="hero-mesh" aria-hidden="true" /></div>
    <p className="notice distribution-notice">{t.distributionNotice}</p>
    {expiredNotice}{message && <p className="notice">{message}</p>}

    {page === 'setup' && <section className="panel setup-panel">
      <div className="section-heading"><p className="eyebrow">AUTHORIZE &amp; CONNECT</p><h2>{t.setup}</h2><p>{t.setupDescription}</p></div>
      <p className="eyebrow step-progress-label">{t.stepProgressLabel}</p>
      <nav className="setup-stepper" role="tablist" aria-label={t.stepProgressLabel}>
        {steps.map((step) => <button
          key={step.index}
          id={`setup-tab-${step.index}`}
          type="button"
          role="tab"
          aria-selected={activeStep === step.index}
          aria-controls="setup-panel"
          tabIndex={activeStep === step.index ? 0 : -1}
          className={`setup-tab ${step.tone}${activeStep === step.index ? ' active' : ''}`}
          onClick={() => selectStep(step.index)}
          onKeyDown={(event) => handleStepKey(event, step.index)}
        >
          <span className="step-index" aria-hidden="true">{step.tone === 'done' ? '✓' : step.index}</span>
          <span className="setup-tab-text"><strong>{step.title}</strong><small>{step.state}</small></span>
        </button>)}
      </nav>
      <div className="setup-step-panel" role="tabpanel" id="setup-panel" aria-labelledby={`setup-tab-${activeStep}`}>
        {activeStep === 1 && <SetupStep title={t.stepSystemTitle} body={t.stepSystemBody} state={stepState(fullAccess)} tone={stepTone(fullAccess)}>
          <div className="permission-grid">{(['calendar', 'reminders'] as const).map((key) => {
            const state = permissionState(permissions?.[key]);
            return <article className={`permission-card ${state.tone}`} key={key}>
              <div className="card-top"><span className="provider-icon">{key === 'calendar' ? '◫' : '✓'}</span><span className={`status-dot ${state.tone}`} aria-hidden="true" /></div>
              <h3>{providerName(key)}</h3>
              <p className="status-label">{permissions ? t[state.statusKey] : permissionsError ? t.unavailable : t.checking}</p>
              <p className="status-meta">{permissionsCheckedAt ? `${t.lastChecked} · ${formatDate(permissionsCheckedAt, language)}` : t.checking}</p>
              <div className="permission-actions">
                <button disabled={disabled} onClick={() => void requestPermission(key)}>{key === 'calendar' ? t.requestCalendar : t.requestReminders}</button>
                <a className="button secondary" href={permissionSettingsUrl(key)} onClick={() => setMessage(t.permissionSettingsOpened)}>{state.raw === 'full_access' || state.raw === 'write_only' ? t.closePermission : t.openPermissionSettings}</a>
                <button className="secondary" disabled={disabled} onClick={() => void refreshPermissions(bootstrap.csrf)}>{t.recheckPermissions}</button>
              </div>
            </article>;
          })}</div>
          {permissionsError && <p className="permission-error">{permissionsError}</p>}
          {!fullAccess && permissionKnown && <p className="permission-flow-hint">{t.permissionNotReady} · {t.permissionFlowHint}</p>}
          <p className="permission-help">{t.permissionsHelp}</p>
        </SetupStep>}

        {activeStep === 2 && <SetupStep title={t.stepAuthorizationTitle} body={t.stepAuthorizationBody} state={authorizationState} tone={authorizationTone}>
          {authorizationLocked && <p className="step-lock-note">{t.step2LockedHint}</p>}
          <div className="agents-layout">
            <div className="profile-form">
              <div className="section-heading"><p className="eyebrow">NEW AUTHORIZATION</p><h3>{t.createAgentProfile}</h3><p>{t.profileDescription}</p></div>
              <form onSubmit={createAuthorization}>
                <fieldset className="plain-fieldset" disabled={disabled || authorizationLocked}>
                  <label>{t.name}<input name="name" maxLength={120} placeholder={t.defaultProfileName} /></label>
                  <fieldset><legend>{t.calendarContainers}</legend>
                    {calendarContainers.length ? <div className="container-list">{calendarContainers.map((container) => renderContainer('calendar', container))}</div> : <p>{t.noContainers}</p>}
                  </fieldset>
                  <fieldset><legend>{t.reminderContainers}</legend>
                    {reminderContainers.length ? <div className="container-list">{reminderContainers.map((container) => renderContainer('reminders', container))}</div> : <p>{t.noContainers}</p>}
                  </fieldset>
                  <label>{t.expiresAt}<input name="expiresAt" type="datetime-local" required value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
                  <button disabled={disabled || authorizationLocked || (!calendarContainers.length && !reminderContainers.length)} type="submit">{t.createProfile}</button>
                </fieldset>
              </form>
            </div>
            <div className="profiles">
              <div className="section-heading"><p className="eyebrow">AUTHORIZATIONS</p><h3>{t.existingAgentProfiles}</h3><p>{t.profilesGroupedByName}</p></div>
              {clients.length ? <div className="profile-list">{clients.map((client) => {
                const grants = client.grants.map(profileGrant).filter((grant): grant is ProfileGrant => Boolean(grant));
                const binding = agentBinding(client);
                return <article className="panel profile-card" key={client.id}>
                  <div className="profile-title"><div><p className="eyebrow">{t.authorizationImmutable}</p><h3>{client.name}</h3></div><span className={`profile-state ${client.revoked ? 'revoked' : 'active'}`}>{client.revoked ? t.revoked : t.active}</span></div>
                  <div className="profile-meta">
                    <BindingBadge binding={binding} language={language} labels={bindingLabels} />
                    <span className="profile-usage">{client.lastUsedAt !== null ? `${t.lastUsed} · ${formatDate(client.lastUsedAt, language)}` : t.neverUsed}</span>
                  </div>
                  <p className="policy">{t.expiresAt} · {grants.length ? formatDate(Math.min(...grants.map((grant) => grant.expiresAt)), language) : '—'}</p>
                  <details className="grant-details"><summary>{t.viewDetails}</summary>
                    <p className="policy">{t.authorizationKey} · <code>{client.id}</code></p>
                    <div className="grant-list">{grants.map((grant, index) => <div className="grant" key={`${grant.provider}-${index}`}>
                      <div><strong>{t.grant} {index + 1}</strong><span>{providerName(grant.provider)}</span></div>
                      <dl>
                        <dt>{t.scope}</dt><dd>{grant.containerIds.map((id) => <span className="container-name" key={id} title={id}>{id === '*' ? t.allContainers : containerDisplayName(grant.provider, id, containerNames)}</span>)}</dd>
                        <dt>{t.allowedActions}</dt><dd>{grant.actions.map((action) => <span className="chip" key={action}>{actionLabels[action]}</span>)}</dd>
                        <dt>{t.expiresAt}</dt><dd>{formatDate(grant.expiresAt, language)}</dd>
                      </dl>
                    </div>)}</div>
                  </details>
                  <button className="secondary danger" disabled={disabled} onClick={() => void deleteAuthorization(client)}>{t.deleteProfile}</button>
                </article>;
              })}</div> : <div className="panel empty-state">{t.noProfiles}</div>}
            </div>
          </div>
        </SetupStep>}

        {activeStep === 3 && <SetupStep title={t.stepPromptTitle} body={t.stepPromptBody} state={stepState(activeClients.length > 0)} tone={stepTone(activeClients.length > 0)}>
          {activeClients.length ? <div className="prompt-list">
            <div className="section-heading"><p className="eyebrow">{t.promptListTitle}</p><h3>{t.agentPromptTitle}</h3><p>{t.promptListHint}</p></div>
            {activeClients.map((client) => {
              const isCreated = created?.client.id === client.id;
              const binding = agentBinding(client);
              const grants = client.grants.map(profileGrant).filter((grant): grant is ProfileGrant => Boolean(grant));
              const prompt = buildAgentPrompt({ language, token: '', credentialKey: client.id, includeToken: false });
              const promptWithToken = isCreated && created
                ? buildAgentPrompt({ language, token: created.token, credentialKey: client.id, includeToken: true })
                : '';
              return <article className={`prompt-card${isCreated ? ' fresh' : ''}`} key={client.id}>
                <header className="prompt-card-heading">
                  <div><p className="eyebrow">{isCreated ? t.justCreated : t.agentPromptTitle}</p><h3>{client.name}</h3></div>
                  <div className="prompt-card-meta">
                    <BindingBadge binding={binding} language={language} labels={bindingLabels} />
                    <span className="profile-usage">{t.expiresAt} · {grants.length ? formatDate(Math.min(...grants.map((grant) => grant.expiresAt)), language) : '—'}</span>
                  </div>
                </header>
                {isCreated && created && <>
                  <p className="eyebrow">{t.authorizationIdOnce}</p>
                  <div className="authorization-id"><code>{created.token}</code><button type="button" onClick={() => void copyToken()}>{t.copy}</button></div>
                  <p className="permission-warning">{t.authorizationIdWarning}</p>
                </>}
                <pre className="agent-prompt">{prompt}</pre>
                <div className="agent-prompt-actions">
                  <button type="button" onClick={() => void copyText(prompt, t.promptCopiedFor(client.name))}>{t.copyAgentPrompt}</button>
                  {isCreated && <button type="button" className="secondary" onClick={() => void copyText(promptWithToken, t.promptCopiedWithToken)}>{t.copyAgentPromptWithToken}</button>}
                </div>
                {isCreated && <p className="permission-warning">{t.agentPromptTokenWarning}</p>}
              </article>;
            })}
            <p>{t.authorizationAgentHint}</p>
            <p className="note">{t.authorizationImmutable}</p>
          </div> : <p className="step-placeholder">{t.promptPlaceholder}</p>}
        </SetupStep>}

        {activeStep === 4 && <SetupStep title={t.stepVerifyTitle} body={t.stepVerifyBody} state={stepState(verifyDone, created ? 'waiting' : 'todo')} tone={verifyTone}>
          {created && createdBinding ? (createdBinding.tone === 'bound'
            ? <div className="verification-card bound">
              <p className="eyebrow">{t.verifyBoundTitle}</p>
              <h3>{createdBinding.agentName ?? t.unknownAgent}</h3>
              <p>{t.verifyBoundBody}</p>
              {createdBinding.at !== null && <p className="policy">{t.verifiedAtLabel} · {formatDate(createdBinding.at, language)}</p>}
            </div>
            : <div className="verification-card waiting">
              <p className="eyebrow">{t.verifyWaitingTitle}</p>
              <p>{t.verifyWaitingBody}</p>
              <code>apple-connector auth verify --agent &lt;name&gt; --auth-key &lt;key&gt; --json</code>
            </div>)
            : <p className="step-placeholder">{t.verifyPlaceholder}</p>}
          <div className="binding-summary">
            <p className="eyebrow">{t.bindingSummaryTitle}</p>
            {activeClients.length ? <div className="binding-list">{activeClients.map((client) => {
              const binding = agentBinding(client);
              return <div className="binding-row" key={client.id}>
                <strong>{client.name}</strong>
                <BindingBadge binding={binding} language={language} labels={bindingLabels} />
              </div>;
            })}</div> : <p className="step-placeholder">{t.bindingEmpty}</p>}
          </div>
        </SetupStep>}
      </div>
    </section>}

    {page === 'audit' && <section className="panel audit-panel">
      <div className="section-heading"><p className="eyebrow">ACTIVITY LOG</p><h2>{t.audit}</h2><p>{t.auditDescription}</p></div>
      {auditError && <p className="notice error">{auditError}</p>}
      <AuditChart
        events={auditEvents}
        clients={clients}
        hidden={hiddenLanes}
        language={language}
        now={auditTo}
        loading={auditLoading}
        truncated={auditTotal > auditEvents.length ? auditTotal : 0}
        onHide={hideLane}
        onRestore={restoreLane}
        onRestoreAll={restoreAllLanes}
        onDeleteLane={(ref) => void deleteAuditLane(ref)}
      />
      <details className="audit-table-details">
        <summary>{t.auditTableTitle(auditTotal)}</summary>
        {auditEvents.length ? <div className="audit-table-wrap"><table>
          <thead><tr><th>{t.auditTime}</th><th>{t.auditAgent}</th><th>{t.action}</th><th>{t.auditOutcome}</th><th>{t.auditContainer}</th><th>{t.auditCount}</th></tr></thead>
          <tbody>{[...auditEvents].sort((left, right) => right.at - left.at).slice(0, 200).map((item, index) => {
            const agent = item.source === 'web'
              ? t.auditWebLane
              : item.clientName ?? clients.find((client) => client.id === item.clientId)?.name
                ?? (item.clientId ? `${t.auditDeletedLane} · ${item.clientId.slice(0, 8)}` : '—');
            const container = item.target
              ? (item.provider ? containerNames[`${item.provider}:${item.target}`] : undefined) ?? item.target
              : '—';
            const outcomeLabels: Record<AuditEvent['outcome'], string> = {
              allowed: t.outcomeAllowed, denied: t.outcomeDenied, succeeded: t.outcomeSucceeded,
              failed: t.outcomeFailed, outcome_unknown: t.outcomeUnknown,
            };
            return <tr key={`${item.at}-${index}`}>
              <td>{formatDate(item.at, language)}</td>
              <td>{agent}</td>
              <td>{item.provider ? `${item.provider === 'calendar' ? t.calendar : item.provider === 'reminders' ? t.reminders : item.provider}: ` : ''}{actionLabels[item.action as keyof typeof actionLabels] ?? item.action}</td>
              <td>{outcomeLabels[item.outcome]}{item.errorCode ? ` (${item.errorCode})` : ''}</td>
              <td>{container}</td>
              <td>{item.count}</td>
            </tr>;
          })}</tbody>
        </table></div> : <div className="empty-state">{t.auditTableEmpty}</div>}
      </details>
    </section>}

    {page === 'docs' && <section className="panel usage-panel">
      <div className="section-heading"><p className="eyebrow">GETTING STARTED</p><h2>{t.docs}</h2><p>{guide.intro}</p></div>
      <div className="usage-commands"><span>{t.usageCommandsTitle}</span>{guide.quickCommands.map((command) => <code key={command}>{command}</code>)}</div>
      <div className="guide-layout">
        <nav className="guide-toc" aria-label={t.docsToc}><strong>{t.docsToc}</strong>{guide.sections.map((section, index) => <a key={section.id} href={`#docs-${section.id}`}>{index + 1}. {section.title}</a>)}</nav>
        <div className="guide-content">{guide.sections.map((section) => <article className="guide-section" id={`docs-${section.id}`} key={section.id}>
          <h3>{section.title}</h3><p className="guide-summary">{section.summary}</p>
          {section.body && <ul>{section.body.map((item) => <li key={item}>{item}</li>)}</ul>}
          {section.commands && <div className="guide-commands">{section.commands.map((command) => <div className="guide-command" key={`${section.id}-${command.syntax}`}><code>{command.syntax}</code><span>{command.description}</span></div>)}</div>}
          {section.table && <div className="guide-table"><table><thead><tr>{section.table.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{section.table.rows.map((row, rowIndex) => <tr key={`${section.id}-row-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`${section.id}-${rowIndex}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div>}
          {section.notes && <div className="guide-notes">{section.notes.map((note) => <p key={note}>{note}</p>)}</div>}
        </article>)}</div>
      </div>
    </section>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
