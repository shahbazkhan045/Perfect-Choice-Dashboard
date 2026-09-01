'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CanxRow } from '@/lib/types';
import {
  applyFilter,
  ageInDays,
  canxKpis,
  canxMonthSummaries,
  isCanxAnswered,
  type CanxMonthSummary,
  type FilterKey,
} from '@/lib/stats';
import { formatDmy } from '@/lib/parse';
import { downloadCsv, toCsv } from '@/lib/csv';
import {
  AgeBadge,
  EmptyBanner,
  FallbackBanner,
  Filters,
  Kpi,
  Modal,
  ReasonField,
} from '@/components/ui';
import DayBarChart, { type DayDatum } from '@/components/DayBarChart';
import type { SectionProps } from '@/components/Dashboard';

/** PDFs open in a new tab; everything else previews inline in a modal. */
function isLikelyImage(url: string): boolean {
  return /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(url);
}

const FILTER_TITLES: Record<FilterKey, string> = {
  yesterday: 'Yesterday',
  pending: 'All pending',
  updated: 'Already updated',
  mtd: 'Month to date',
  // Cash-only tab — CanxSection never sets `filter` to this, but FilterKey is
  // shared, so every Record<FilterKey, …> here needs a value for it too.
  financeComments: 'Finance comments',
};

function pctLabel(pct: number | null): string {
  return pct != null ? `${pct.toFixed(2)}%` : '—';
}

interface Props extends SectionProps {
  canEdit: boolean;
  onRefresh: () => void;
}

export default function CanxSection({
  data,
  filter,
  setFilter,
  search,
  setSearch,
  savingKeys,
  onPatch,
  onUpload,
  canEdit,
  onRefresh,
}: Props) {
  const [viewingUrl, setViewingUrl] = useState<string | null>(null);
  const isMtdTab = filter === 'mtd';

  // Same archive-with-drill-down pattern as Cash collection's Month to
  // date tab — see CashSection.tsx for the full rationale.
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  useEffect(() => {
    if (!isMtdTab) setExpandedMonth(null);
  }, [isMtdTab]);

  const result = useMemo(
    () => applyFilter(data.canx, filter, data.today, data.yesterday),
    [data.canx, data.today, data.yesterday, filter],
  );

  const monthSummaries = useMemo(
    () => canxMonthSummaries(data.canx, data.canxMonthlyPct),
    [data.canx, data.canxMonthlyPct],
  );

  const monthRows = useMemo(
    () => (expandedMonth ? data.canx.filter((r) => r.date.startsWith(expandedMonth)) : []),
    [data.canx, expandedMonth],
  );

  const counts = useMemo(
    () =>
      ({
        yesterday: applyFilter(data.canx, 'yesterday', data.today, data.yesterday).rows.length,
        pending: applyFilter(data.canx, 'pending', data.today, data.yesterday).rows.length,
        updated: applyFilter(data.canx, 'updated', data.today, data.yesterday).rows.length,
        mtd: monthSummaries.length,
      }) as Record<FilterKey, number>,
    [data.canx, data.today, data.yesterday, monthSummaries],
  );

  const term = search.trim().toLowerCase();

  const rows = useMemo(() => {
    const base = isMtdTab ? monthRows : result.rows;
    return term
      ? base.filter(
          (r) =>
            r.code.toLowerCase().includes(term) ||
            r.cleaner.toLowerCase().includes(term) ||
            r.van.toLowerCase().includes(term) ||
            r.reason.toLowerCase().includes(term),
        )
      : base;
  }, [isMtdTab, monthRows, result.rows, term]);

  const visibleMonths = useMemo(
    () => (term ? monthSummaries.filter((m) => m.label.toLowerCase().includes(term)) : monthSummaries),
    [monthSummaries, term],
  );

  const kpis = useMemo(() => canxKpis(rows), [rows]);
  const expandedSummary = isMtdTab && expandedMonth
    ? monthSummaries.find((m) => m.key === expandedMonth)
    : undefined;
  const scope = expandedSummary ? expandedSummary.label : FILTER_TITLES[filter];
  const totalRatePct = expandedSummary ? expandedSummary.pct : data.canxTotalPct;
  const isMonthList = isMtdTab && !expandedMonth;

  const chartData: DayDatum[] = useMemo(() => {
    if (!isMtdTab || !expandedMonth) return [];
    const byDay = new Map<string, DayDatum>();
    for (const r of rows) {
      if (!r.date) continue;
      if (!byDay.has(r.date)) {
        byDay.set(r.date, { date: r.date, values: { explained: 0, awaiting: 0 } });
      }
      const d = byDay.get(r.date)!;
      if (isCanxAnswered(r)) d.values.explained += r.count || 1;
      else d.values.awaiting += r.count || 1;
    }
    return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [rows, isMtdTab, expandedMonth]);

  function download() {
    if (isMonthList) {
      const csv = toCsv(
        ['Month', 'Total number of cancellations', 'Total cancellation %'],
        visibleMonths.map((m) => [m.label, m.totalCancellations, m.pct != null ? `${m.pct.toFixed(2)}%` : '']),
      );
      downloadCsv(`cancellations-monthly-summary-${data.today}.csv`, csv);
      return;
    }
    const csv = toCsv(
      ['Master date', 'Appointment', 'Cleaner', 'Van', 'Count', '%', 'Reason', 'Screenshot', 'Updated by', 'Updated at'],
      rows.map((r) => [
        formatDmy(r.date),
        r.code,
        r.cleaner,
        r.van,
        r.count,
        `${r.pct.toFixed(2)}%`,
        r.reason,
        r.screenshot,
        r.updatedBy,
        r.updatedAt,
      ]),
    );
    downloadCsv(`cancellations-${isMtdTab ? expandedMonth : filter}-${data.today}.csv`, csv);
  }

  return (
    <section aria-label="Cancellations and releases">
      {isMonthList ? null : (
        <>
          {isMtdTab ? (
            <button type="button" className="btn back-to-months" onClick={() => setExpandedMonth(null)}>
              ← Back to months
            </button>
          ) : null}

          <div className="kpi-row kpi-row-4">
            <Kpi label={`Cancellations & releases · ${scope}`} value={String(kpis.total)} />
            <Kpi
              label={`Total cancellation rate${expandedSummary ? ` · ${scope}` : ''}`}
              value={pctLabel(totalRatePct)}
              unit={totalRatePct == null ? 'not set in sheet' : undefined}
              tone={totalRatePct != null ? 'warn' : 'plain'}
            />
            <Kpi
              label="Awaiting a reason"
              value={String(kpis.awaiting)}
              unit="rows"
              tone={kpis.awaiting ? 'warn' : 'plain'}
            />
            <Kpi label="Reasons provided" value={String(kpis.provided)} unit="rows" tone="good" />
          </div>
        </>
      )}

      <div className="toolbar">
        <Filters value={filter} counts={counts} onChange={setFilter} />
        <div className="toolbar-actions">
          <input
            type="search"
            className="table-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isMonthList ? 'Search month…' : 'Search cleaner, van, code…'}
            aria-label="Search cancellations"
          />
          <button type="button" className="btn" onClick={onRefresh}>
            Refresh
          </button>
          <button
            type="button"
            className="btn"
            onClick={download}
            disabled={isMonthList ? !visibleMonths.length : !rows.length}
          >
            ⬇ Download
          </button>
        </div>
      </div>

      {isMonthList ? (
        <div className="card table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Total number of cancellations</th>
                  <th className="num">Total cancellation %</th>
                </tr>
              </thead>
              <tbody>
                {visibleMonths.length ? (
                  visibleMonths.map((m) => (
                    <CanxMonthRow key={m.key} month={m} onSelect={setExpandedMonth} />
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="table-msg">
                      {term ? 'No months match your search.' : 'No cancellation data yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          {result.fallbackFrom && result.fallbackTo ? (
            <FallbackBanner from={result.fallbackFrom} to={result.fallbackTo} />
          ) : null}

          {filter === 'pending' && !result.rows.length ? (
            <EmptyBanner>🎉 Nothing pending — every cancellation has a reason.</EmptyBanner>
          ) : null}

          {filter === 'yesterday' && !result.rows.length ? (
            <EmptyBanner>
              🎉 All caught up — every cancellation for {formatDmy(result.shownDate || data.yesterday)}{' '}
              has a reason.
            </EmptyBanner>
          ) : null}

          {isMtdTab && chartData.length ? (
            <DayBarChart
              title="Daily cancellations & releases"
              subtitle={scope}
              series={[
                { id: 'explained', label: 'Reason provided', colorVar: '--viz-collected' },
                { id: 'awaiting', label: 'Awaiting a reason', colorVar: '--viz-awaiting' },
              ]}
              data={chartData}
              format={(n) => String(Math.round(n))}
              emptyLabel="No cancellations this month."
            />
          ) : null}

          <div className="card table-card">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Master date</th>
                    <th>Appointment</th>
                    <th>Cleaner</th>
                    <th>Van</th>
                    <th className="num">Count</th>
                    <th className="num">%</th>
                    <th className="col-reason">Reason &amp; screenshot</th>
                    <th>Last update</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length ? (
                    rows.map((row) => (
                      <Row
                        key={row.key}
                        row={row}
                        today={data.today}
                        canEdit={canEdit}
                        saving={savingKeys.has(row.key)}
                        onPatch={onPatch}
                        onUpload={onUpload}
                        onView={setViewingUrl}
                      />
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="table-msg">
                        {term ? 'No rows match your search.' : 'No cancellations for this view.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {viewingUrl ? (
        <Modal title="Screenshot" onClose={() => setViewingUrl(null)}>
          <img src={viewingUrl} alt="Uploaded screenshot" className="screenshot-preview" />
          <p className="screenshot-open-link">
            <a href={viewingUrl} target="_blank" rel="noreferrer noopener">
              Open original in a new tab ↗
            </a>
          </p>
        </Modal>
      ) : null}
    </section>
  );
}

function CanxMonthRow({
  month,
  onSelect,
}: {
  month: CanxMonthSummary;
  onSelect: (key: string) => void;
}) {
  return (
    <tr
      className="month-row"
      tabIndex={0}
      role="button"
      aria-label={`Open ${month.label}`}
      onClick={() => onSelect(month.key)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(month.key);
        }
      }}
    >
      <td className="strong">
        {month.label}
        <span className="month-arrow" aria-hidden="true">→</span>
      </td>
      <td className="num strong">{month.totalCancellations}</td>
      <td className="num" title={month.pct == null ? 'Not recorded for this month' : undefined}>
        {pctLabel(month.pct)}
      </td>
    </tr>
  );
}

function Row({
  row,
  today,
  canEdit,
  saving,
  onPatch,
  onUpload,
  onView,
}: {
  row: CanxRow;
  today: string;
  canEdit: boolean;
  saving: boolean;
  onPatch: SectionProps['onPatch'];
  onUpload: SectionProps['onUpload'];
  onView: (url: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const answered = isCanxAnswered(row);
  const age = ageInDays(row, today);

  return (
    <tr className={saving ? 'is-saving' : undefined}>
      <td title={row.dateRaw ? `As written in the sheet: ${row.dateRaw}` : undefined}>
        {formatDmy(row.date)}
        <AgeBadge days={age} />
      </td>
      <td className="mono">{row.code}</td>
      <td>{row.cleaner || <span className="muted">—</span>}</td>
      <td className="van" title={row.van}>
        {row.van || <span className="muted">—</span>}
      </td>
      <td className="num">{row.count}</td>
      <td className="num">{row.pct ? `${row.pct.toFixed(2)}%` : '—'}</td>

      <td className="col-reason">
        <ReasonField
          value={row.reason}
          placeholder="Explain the cancellation or release…"
          disabled={!canEdit || saving}
          onSave={(next) => onPatch('CANX', row.key, { reason: next })}
        />

        <div className="reason-foot">
          <span className={`pill ${answered ? 'pill-ok' : 'pill-wait'}`}>
            {answered ? 'Reason provided' : 'Awaiting reason'}
          </span>

          {row.screenshot ? (
            isLikelyImage(row.screenshot) ? (
              <button
                type="button"
                className="pill pill-link"
                onClick={() => onView(row.screenshot)}
              >
                👁 View screenshot
              </button>
            ) : (
              <a
                className="pill pill-link"
                href={row.screenshot}
                target="_blank"
                rel="noreferrer noopener"
              >
                👁 View screenshot
              </a>
            )
          ) : null}

          {canEdit ? (
            <>
              <button
                type="button"
                className="pill pill-action"
                disabled={saving}
                onClick={() => fileRef.current?.click()}
              >
                📎 {row.screenshot ? 'Replace' : 'Add screenshot'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUpload('CANX', row.key, file);
                  e.target.value = '';
                }}
              />
            </>
          ) : null}
        </div>
      </td>

      <td className="meta">
        {row.updatedAt ? (
          <>
            <span>{row.updatedAt}</span>
            <span className="meta-by">{row.updatedBy}</span>
          </>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
    </tr>
  );
}
