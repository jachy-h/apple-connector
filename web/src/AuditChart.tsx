import { useEffect, useMemo, useRef, useState } from 'react';
import type { AuditEvent } from '../../src/audit/schema.js';
import { translations, type Language } from '../../src/web/i18n.js';
import {
  AUDIT_ACTIONS, AUDIT_HEAT_COLORS, auditHeatLevel, buildAuditHeatmaps,
  type AuditHeatCell, type AuditHeatmap, type AuditHeatmapDay, type AuditLaneRef,
} from '../../src/web/audit-chart.js';
import { FloatingPopover, type PopoverAnchor } from './FloatingPopover.js';

export interface AuditChartProps {
  events: AuditEvent[];
  clients: Array<{ id: string; name: string; revoked: boolean }>;
  language: Language;
  now: number;
  loading: boolean;
  truncated: number;
  hidden: string[];
  onHide(key: string): void;
  onRestore(key: string): void;
  onRestoreAll(): void;
  onDeleteLane(ref: AuditLaneRef): void;
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const PAD = (value: number) => String(value).padStart(2, '0');

interface HoveredCell {
  laneKey: string;
  laneName: string;
  dayAt: number;
  hour: number;
  cell: AuditHeatCell;
  anchor: PopoverAnchor;
}

export function AuditChart({
  events, clients, language, now, loading, truncated, hidden,
  onHide, onRestore, onRestoreAll, onDeleteLane,
}: AuditChartProps) {
  const t = translations[language];
  const [showInactive, setShowInactive] = useState(false);
  const [hovered, setHovered] = useState<HoveredCell | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);
  const heatmaps = useMemo(() => buildAuditHeatmaps(events, clients, now), [events, clients, now]);
  const visible = heatmaps.filter((lane) => !hidden.includes(lane.key) && (lane.total > 0 || showInactive));
  const hiddenLanes = heatmaps.filter((lane) => hidden.includes(lane.key));
  useEffect(() => {
    if (hovered && !visible.some((lane) => lane.key === hovered.laneKey)) setHovered(null);
  }, [hovered, visible]);
  const dayFormat = useMemo(() => new Intl.DateTimeFormat(language, { month: 'numeric', day: 'numeric' }), [language]);
  const weekdayFormat = useMemo(() => new Intl.DateTimeFormat(language, { weekday: 'short' }), [language]);

  const laneTitle = (lane: AuditHeatmap): string => {
    if (lane.ref.kind === 'web') return t.auditWebLane;
    const base = lane.name || lane.ref.clientId.slice(0, 8);
    const name = lane.name && lane.disambiguate ? `${base} · ${lane.ref.clientId.slice(0, 8)}` : base;
    return lane.deleted ? `${t.auditDeletedLane} · ${name}` : name;
  };

  const showCell = (event: React.MouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>, lane: AuditHeatmap, day: AuditHeatmapDay, cell: AuditHeatCell) => {
    if (cell.count <= 0) return;
    window.clearTimeout(hideTimer.current);
    const rect = event.currentTarget.getBoundingClientRect();
    setHovered({
      laneKey: lane.key,
      laneName: laneTitle(lane),
      dayAt: day.at,
      hour: cell.hour,
      cell,
      anchor: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
    });
  };

  const hideCell = () => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHovered(null), 80);
  };

  const cellTitle = (lane: AuditHeatmap, dayAt: number, hour: number, cell: AuditHeatmap['cells'][number][number]): string => {
    const actions = AUDIT_ACTIONS.filter((action) => cell.actions[action] > 0).map((action) => `${t[action]} ${cell.actions[action]}`).join(' / ');
    const issues = [
      cell.outcomes.denied > 0 ? `${t.outcomeDenied} ${cell.outcomes.denied}` : '',
      cell.outcomes.failed > 0 ? `${t.outcomeFailed} ${cell.outcomes.failed}` : '',
      cell.outcomes.outcome_unknown > 0 ? `${t.outcomeUnknown} ${cell.outcomes.outcome_unknown}` : '',
    ].filter(Boolean).join(' / ');
    return [
      dayFormat.format(dayAt), `${PAD(hour)}:00`, t.auditOperationCount(cell.count),
      actions, issues, laneTitle(lane),
    ].filter(Boolean).join(' · ');
  };

  const requestDelete = (lane: AuditHeatmap) => {
    const message = lane.ref.kind === 'web' ? t.auditDeleteWebConfirm : t.auditDeleteLaneConfirm(laneTitle(lane));
    if (window.confirm(message)) onDeleteLane(lane.ref);
  };

  return <div className="audit-chart" role="group" aria-label={t.auditChartAria}>
    <div className="audit-toolbar">
      <span className="audit-heat-hint">{t.auditHeatHint}</span>
      <label className="check audit-show-inactive"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />{t.auditShowInactive}</label>
    </div>

    {loading && <p className="audit-status">{t.auditLoading}</p>}
    {truncated > 0 && <p className="audit-status">{t.auditTruncated(events.length, truncated)}</p>}
    {!loading && !visible.length ? <div className="empty-state">{t.auditEmptyWindow}</div> : null}

    <div className="audit-heatmaps">
      {visible.map((lane) => <section className="audit-heatmap" key={lane.key}>
        <header className="audit-heatmap-header">
          <div className="audit-heatmap-title">
            <strong>{laneTitle(lane)}</strong>
            <span>{t.auditOperationCount(lane.total)}</span>
          </div>
          <div className="audit-lane-actions">
            <button type="button" className="secondary" onClick={() => onHide(lane.key)}>{t.auditHideLane}</button>
            <button type="button" className="secondary danger" onClick={() => requestDelete(lane)}>{t.auditDeleteLane}</button>
          </div>
        </header>
        {lane.total > 0 && <p className="audit-heatmap-summary">{AUDIT_ACTIONS.filter((action) => lane.actionTotals[action] > 0).map((action) => `${t[action]} ${lane.actionTotals[action]}`).join(' · ')}</p>}
        <div className="audit-heatmap-scroll">
          <div className="audit-heat-axis" aria-hidden="true">
            <span className="audit-heat-spacer" />
            {HOURS.map((hour) => <span className="audit-heat-hour" key={hour}>{PAD(hour)}</span>)}
          </div>
          {lane.days.map((day, dayIndex) => <div className="audit-heat-row" key={day.key}>
            <span className="audit-heat-day">{dayFormat.format(day.at)} {weekdayFormat.format(day.at)}</span>
            {lane.cells[dayIndex]!.map((cell) => {
              const level = auditHeatLevel(cell.count);
              const issues = cell.outcomes.denied + cell.outcomes.failed + cell.outcomes.outcome_unknown;
              return <span
                className={`audit-heat-cell heat-level-${level}`}
                key={cell.hour}
                data-issues={issues > 0 ? 'true' : undefined}
                data-day={day.key}
                data-hour={cell.hour}
                role={cell.count > 0 ? 'img' : undefined}
                tabIndex={cell.count > 0 ? 0 : undefined}
                aria-label={cell.count > 0 ? cellTitle(lane, day.at, cell.hour, cell) : undefined}
                aria-hidden={cell.count > 0 ? undefined : 'true'}
                onMouseEnter={(event) => showCell(event, lane, day, cell)}
                onMouseLeave={hideCell}
                onFocus={(event) => showCell(event, lane, day, cell)}
                onBlur={hideCell}
              />;
            })}
          </div>)}
        </div>
      </section>)}
    </div>

    {visible.length > 0 && <div className="audit-heat-legend">
      <span>{t.auditHeatLess}</span>
      {AUDIT_HEAT_COLORS.map((_, level) => <i className={`audit-heat-cell heat-level-${level}`} key={level} aria-hidden="true" />)}
      <span>{t.auditHeatMore}</span>
      <span className="audit-heat-issue-hint"><i className="audit-issue-dot" aria-hidden="true" />{t.auditHeatIssueHint}</span>
    </div>}

    {hiddenLanes.length > 0 && <div className="audit-hidden-lanes">
      <span>{t.auditHiddenLanes}</span>
      {hiddenLanes.map((lane) => <button type="button" key={lane.key} className="secondary" onClick={() => onRestore(lane.key)}>{laneTitle(lane)} · {t.auditRestore}</button>)}
      <button type="button" className="secondary" onClick={onRestoreAll}>{t.auditRestoreAll}</button>
    </div>}

    <FloatingPopover
      key={hovered ? `${hovered.laneKey}:${hovered.dayAt}:${hovered.hour}` : 'empty'}
      anchor={hovered?.anchor ?? null}
      onClose={() => setHovered(null)}
    >
      {hovered && <div className="audit-cell-popover">
        <div className="audit-cell-popover-head">
          <strong>{hovered.laneName}</strong>
          <span>{dayFormat.format(hovered.dayAt)} {weekdayFormat.format(hovered.dayAt)} · {PAD(hovered.hour)}:00</span>
        </div>
        <div className="audit-cell-popover-total">{hovered.cell.count}<small>{t.auditHeatUnit}</small></div>
        <div className="audit-cell-popover-actions">
          {AUDIT_ACTIONS.filter((action) => hovered.cell.actions[action] > 0).map((action) => <div className="audit-cell-popover-action" key={action}>
            <span>{t[action]}</span><strong>{hovered.cell.actions[action]}</strong>
          </div>)}
        </div>
        {(() => {
          const issues = [
            hovered.cell.outcomes.denied > 0 ? `${t.outcomeDenied} ${hovered.cell.outcomes.denied}` : '',
            hovered.cell.outcomes.failed > 0 ? `${t.outcomeFailed} ${hovered.cell.outcomes.failed}` : '',
            hovered.cell.outcomes.outcome_unknown > 0 ? `${t.outcomeUnknown} ${hovered.cell.outcomes.outcome_unknown}` : '',
          ].filter(Boolean);
          return issues.length > 0 ? <div className="audit-cell-popover-issue"><i className="audit-issue-dot" aria-hidden="true" />{issues.join(' · ')}</div> : null;
        })()}
      </div>}
    </FloatingPopover>
  </div>;
}
