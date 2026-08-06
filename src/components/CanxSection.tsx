'use client';

import { useMemo, useRef } from 'react';
import type { CanxRow } from '@/lib/types';
import { applyFilter, ageInDays, canxKpis, isCanxAnswered, type FilterKey } from '@/lib/stats';
import { formatDmy } from '@/lib/parse';
import { downloadCsv, toCsv } from '@/lib/csv';
import { AgeBadge, EmptyBanner, FallbackBanner, Filters, Kpi, ReasonField } from '@/components/ui';
import DayBarChart, { type DayDatum } from '@/components/DayBarChart';
import type { SectionProps } from '@/components/Dashboard';

const FILTER_TITLES: Record<FilterKey, string> = {
  yesterday: 'Yesterday',
  pending: 'All pending',
  updated: 'Already updated',
  mtd: 'Month to date',
};

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
  const result = useMemo(
    () => applyFilter(data.canx, filter, data.today, data.yesterday),
    [data.canx, data.today, data.yesterday, filter],
  );

  const counts = useMemo(
    () =>
      ({
        yesterday: applyFilter(data.canx, 'yesterday', data.today, data.yesterday).rows.length,
        pending: applyFilter(data.canx, 'pending', data.today, data.yesterday).rows.length,
        updated: applyFilter(data.canx, 'updated', data.today, data.yesterday).rows.length,
        mtd: applyFilter(data.canx, 'mtd', data.today, data.yesterday).rows.length,
      }) as Record<FilterKey, number>,
    [data.canx, data.today, data.yesterday],
  );

  const term = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      term
        ? result.rows.filter(
            (r) =>
              r.code.toLowerCase().includes(term) ||
              r.cleaner.toLowerCase().includes(term) ||
              r.van.toLowerCase().includes(term) ||
              r.reason.toLowerCase().includes(term),
          )
        : result.rows,
    [result.rows, term],
  );

  const kpis = useMemo(() => canxKpis(rows), [rows]);
  const scope = FILTER_TITLES[filter];

  const chartData: DayDatum[] = useMemo(() => {
    if (filter !== 'mtd') return [];
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
  }, [rows, filter]);

  function download() {
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
    downloadCsv(`cancellations-${filter}-${data.today}.csv`, csv);
  }

  return (
    <section aria-label="Cancellations and releases">
      <div className="kpi-row kpi-row-4">
        <Kpi label={`Cancellations & releases · ${scope}`} value={String(kpis.total)} />
        <Kpi
          label={`Cancellation & release · ${scope}`}
          value={`${kpis.pct.toFixed(2)}%`}
          tone="warn"
        />
        <Kpi
          label="Awaiting a reason"
          value={String(kpis.awaiting)}
          unit="rows"
          tone={kpis.awaiting ? 'warn' : 'plain'}
        />
        <Kpi label="Reasons provided" value={String(kpis.provided)} unit="rows" tone="good" />
      </div>

      <div className="toolbar">
        <Filters value={filter} counts={counts} onChange={setFilter} />
        <div className="toolbar-actions">
          <input
            type="search"
            className="table-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search cleaner, van, code…"
            aria-label="Search cancellations"
          />
          <button type="button" className="btn" onClick={onRefresh}>
            Refresh
          </button>
          <button type="button" className="btn" onClick={download} disabled={!rows.length}>
            ⬇ Download
          </button>
        </div>
      </div>

      {result.fallbackFrom && result.fallbackTo ? (
        <FallbackBanner from={result.fallbackFrom} to={result.fallbackTo} />
      ) : null}

      {filter === 'pending' && !result.rows.length ? (
        <EmptyBanner>🎉 Nothing pending — every cancellation has a reason.</EmptyBanner>
      ) : null}

      {filter === 'mtd' && chartData.length ? (
        <DayBarChart
          title="Daily cancellations & releases"
          subtitle="Month to date"
          series={[
            { id: 'explained', label: 'Reason provided', colorVar: '--viz-collected' },
            { id: 'awaiting', label: 'Awaiting a reason', colorVar: '--viz-awaiting' },
          ]}
          data={chartData}
          format={(n) => String(Math.round(n))}
          emptyLabel="No cancellations this month yet."
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
    </section>
  );
}

function Row({
  row,
  today,
  canEdit,
  saving,
  onPatch,
  onUpload,
}: {
  row: CanxRow;
  today: string;
  canEdit: boolean;
  saving: boolean;
  onPatch: SectionProps['onPatch'];
  onUpload: SectionProps['onUpload'];
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
            <a
              className="pill pill-link"
              href={row.screenshot}
              target="_blank"
              rel="noreferrer noopener"
            >
              📎 View screenshot
            </a>
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
