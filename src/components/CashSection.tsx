'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CashRow } from '@/lib/types';
import {
  applyFilter,
  ageInDays,
  cashKpis,
  cashMonthSummaries,
  financeCommentsRows,
  type CashMonthSummary,
  type FilterKey,
} from '@/lib/stats';
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
  financeComments: 'Finance comments',
};

const FINANCE_TAB = { key: 'financeComments' as const, label: 'Finance comments' };

const FINANCE_RESPONSE_PLACEHOLDER =
  'If collected, write yes; if not, then write the reason for not being collected';

interface Props extends SectionProps {
  canEdit: boolean;
  canRemind: boolean;
  onRefresh: () => void;
  onRemind: () => void;
}

export default function CashSection({
  data,
  filter,
  setFilter,
  search,
  setSearch,
  savingKeys,
  onPatch,
  money,
  canEdit,
  canRemind,
  onRefresh,
  onRemind,
}: Props) {
  const isFinanceTab = filter === 'financeComments';
  const isMtdTab = filter === 'mtd';

  // "Month to date" opens on a month-by-month archive; clicking a month
  // drills into that month's full row-level view (same table every other
  // tab uses). Leaving the tab always resets back to the archive list, so
  // switching away and back never leaves you stranded inside an old month.
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  useEffect(() => {
    if (!isMtdTab) setExpandedMonth(null);
  }, [isMtdTab]);

  const result = useMemo(
    () => applyFilter(data.cash, filter, data.today, data.yesterday),
    [data.cash, data.today, data.yesterday, filter],
  );

  const financeAll = useMemo(() => financeCommentsRows(data.cash), [data.cash]);

  // Every calendar month present in the sheet — nothing is archived by a
  // separate action, a month's rows simply group under its own key the
  // moment they exist. This is what makes last month's data "arrive" in
  // the archive automatically once the new month's rows start appearing.
  const monthSummaries = useMemo(() => cashMonthSummaries(data.cash), [data.cash]);

  const monthRows = useMemo(
    () => (expandedMonth ? data.cash.filter((r) => r.date.startsWith(expandedMonth)) : []),
    [data.cash, expandedMonth],
  );

  const counts = useMemo(
    () =>
      ({
        yesterday: applyFilter(data.cash, 'yesterday', data.today, data.yesterday).rows.length,
        pending: applyFilter(data.cash, 'pending', data.today, data.yesterday).rows.length,
        updated: applyFilter(data.cash, 'updated', data.today, data.yesterday).rows.length,
        mtd: monthSummaries.length,
        financeComments: financeAll.length,
      }) as Record<FilterKey, number>,
    [data.cash, data.today, data.yesterday, financeAll, monthSummaries],
  );

  const term = search.trim().toLowerCase();

  const rows = useMemo(() => {
    const base = isMtdTab ? monthRows : result.rows;
    return term
      ? base.filter(
          (r) =>
            r.ref.toLowerCase().includes(term) ||
            r.reason.toLowerCase().includes(term) ||
            formatDmy(r.date).includes(term),
        )
      : base;
  }, [isMtdTab, monthRows, result.rows, term]);

  const financeRows = useMemo(
    () =>
      term
        ? financeAll.filter(
            (r) =>
              r.ref.toLowerCase().includes(term) ||
              r.financeComment.toLowerCase().includes(term) ||
              r.financeResponse.toLowerCase().includes(term) ||
              formatDmy(r.date).includes(term),
          )
        : financeAll,
    [financeAll, term],
  );

  const visibleMonths = useMemo(
    () => (term ? monthSummaries.filter((m) => m.label.toLowerCase().includes(term)) : monthSummaries),
    [monthSummaries, term],
  );

  const kpis = useMemo(() => cashKpis(rows), [rows]);
  const scope = isMtdTab && expandedMonth
    ? monthSummaries.find((m) => m.key === expandedMonth)?.label || expandedMonth
    : FILTER_TITLES[filter];

  const chartData: DayDatum[] = useMemo(() => {
    if (!isMtdTab || !expandedMonth) return [];
    const byDay = new Map<string, DayDatum>();
    for (const r of rows) {
      if (!r.date) continue;
      if (!byDay.has(r.date)) {
        byDay.set(r.date, { date: r.date, values: { collected: 0, notCollected: 0, awaiting: 0 } });
      }
      const d = byDay.get(r.date)!;
      if (r.status === 'Collected') d.values.collected += r.amount;
      else if (r.status === 'Not collected') d.values.notCollected += r.amount;
      else d.values.awaiting += r.amount;
    }
    return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [rows, isMtdTab, expandedMonth]);

  const pct = (n: number) => (kpis.totalCount ? (n / kpis.totalCount) * 100 : 0);
  const isMonthList = isMtdTab && !expandedMonth;

  function download() {
    if (isFinanceTab) {
      const csv = toCsv(
        ['Start date', 'Reference code', 'Finance comments', 'Perfect Choice response'],
        financeRows.map((r) => [formatDmy(r.date), r.ref, r.financeComment, r.financeResponse]),
      );
      downloadCsv(`finance-comments-${data.today}.csv`, csv);
      return;
    }
    if (isMonthList) {
      const csv = toCsv(
        ['Month', 'Total cash', 'Confirmed collected', 'Not collected'],
        visibleMonths.map((m) => [m.label, m.total.toFixed(2), m.collected.toFixed(2), m.notCollected.toFixed(2)]),
      );
      downloadCsv(`cash-collection-monthly-summary-${data.today}.csv`, csv);
      return;
    }
    const csv = toCsv(
      ['Start date', 'Reference code', 'Total amount', 'Status', 'Ticket raised?', 'Reason', 'Updated by', 'Updated at'],
      rows.map((r) => [
        formatDmy(r.date),
        r.ref,
        r.amount.toFixed(2),
        r.status || 'Pending',
        r.ticket || '',
        r.reason,
        r.updatedBy,
        r.updatedAt,
      ]),
    );
    downloadCsv(`cash-collection-${isMtdTab ? expandedMonth : filter}-${data.today}.csv`, csv);
  }

  return (
    <section aria-label="Cash collection">
      {isFinanceTab ? (
        <div className="kpi-row kpi-row-4">
          <Kpi
            label="Awaiting Perfect Choice response"
            value={String(financeRows.length)}
            unit="rows"
            tone={financeRows.length ? 'warn' : 'plain'}
          />
        </div>
      ) : isMonthList ? null : (
        <>
          {isMtdTab ? (
            <button type="button" className="btn back-to-months" onClick={() => setExpandedMonth(null)}>
              ← Back to months
            </button>
          ) : null}

          <div className="kpi-row">
            <Kpi label={`Total cash · ${scope}`} value={money(kpis.total)} />
            <Kpi label="Confirmed collected" value={money(kpis.collected)} tone="good" />
            <Kpi label="Not collected" value={money(kpis.notCollected)} tone="bad" />
            <Kpi
              label="Pending confirmation"
              value={String(kpis.pendingCount)}
              unit="entries"
              tone="warn"
            />
            <Kpi
              label="No ticket raised"
              value={String(kpis.noTicketCount)}
              unit="entries"
              tone={kpis.noTicketCount ? 'bad' : 'plain'}
            />
          </div>

          <div className="card progress-card">
            <div className="progress-head">
              <span>Confirmation progress</span>
              <span className="progress-count">
                {kpis.answeredCount} of {kpis.totalCount} entries confirmed
              </span>
            </div>
            <div
              className="progress-bar"
              role="img"
              aria-label={`${kpis.collectedCount} collected, ${kpis.notCollectedCount} not collected, ${kpis.pendingCount} awaiting the partner`}
            >
              <span className="seg seg-collected" style={{ width: `${pct(kpis.collectedCount)}%` }} />
              <span
                className="seg seg-notcollected"
                style={{ width: `${pct(kpis.notCollectedCount)}%` }}
              />
            </div>
            <ul className="progress-legend">
              <li>
                <i className="dot dot-collected" />
                Collected <b>{kpis.collectedCount}</b>
              </li>
              <li>
                <i className="dot dot-notcollected" />
                Not collected <b>{kpis.notCollectedCount}</b>
              </li>
              <li>
                <i className="dot dot-awaiting" />
                Awaiting partner <b>{kpis.pendingCount}</b>
              </li>
            </ul>
          </div>
        </>
      )}

      <div className="toolbar">
        <Filters value={filter} counts={counts} onChange={setFilter} extraTabs={[FINANCE_TAB]} />
        <div className="toolbar-actions">
          <input
            type="search"
            className="table-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              isFinanceTab
                ? 'Search reference or comment…'
                : isMonthList
                  ? 'Search month…'
                  : 'Search reference or reason…'
            }
            aria-label="Search cash entries"
          />
          <button type="button" className="btn" onClick={onRefresh}>
            Refresh
          </button>
          <button
            type="button"
            className="btn"
            onClick={download}
            disabled={isFinanceTab ? !financeRows.length : isMonthList ? !visibleMonths.length : !rows.length}
          >
            ⬇ Download
          </button>
          {canRemind ? (
            <button type="button" className="btn btn-primary" onClick={onRemind}>
              ✉ Send reminder
            </button>
          ) : null}
        </div>
      </div>

      {isFinanceTab ? (
        <>
          {!financeRows.length ? (
            <EmptyBanner>
              🎉 Nothing awaiting a response — every finance comment has been closed out or
              answered.
            </EmptyBanner>
          ) : null}

          <div className="card table-card">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Start date</th>
                    <th>Reference code</th>
                    <th className="col-reason">Finance comments</th>
                    <th className="col-reason">Perfect Choice response</th>
                  </tr>
                </thead>
                <tbody>
                  {financeRows.length ? (
                    financeRows.map((row) => (
                      <FinanceRow
                        key={row.key}
                        row={row}
                        today={data.today}
                        canEdit={canEdit}
                        saving={savingKeys.has(row.key)}
                        onPatch={onPatch}
                      />
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="table-msg">
                        {term ? 'No entries match your search.' : 'Nothing here right now.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : isMonthList ? (
        <div className="card table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Total cash</th>
                  <th className="num">Confirmed collected</th>
                  <th className="num">Not collected</th>
                </tr>
              </thead>
              <tbody>
                {visibleMonths.length ? (
                  visibleMonths.map((m) => (
                    <MonthRow key={m.key} month={m} money={money} onSelect={setExpandedMonth} />
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="table-msg">
                      {term ? 'No months match your search.' : 'No cash data yet.'}
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
            <EmptyBanner>🎉 Nothing pending — every cash entry has been confirmed.</EmptyBanner>
          ) : null}

          {filter === 'yesterday' && !result.rows.length ? (
            <EmptyBanner>
              🎉 All caught up — every entry for {formatDmy(result.shownDate || data.yesterday)}{' '}
              has been confirmed.
            </EmptyBanner>
          ) : null}

          {isMtdTab && chartData.length ? (
            <DayBarChart
              title="Daily cash by confirmation status"
              subtitle={scope}
              series={[
                { id: 'collected', label: 'Collected', colorVar: '--viz-collected' },
                { id: 'notCollected', label: 'Not collected', colorVar: '--viz-notcollected' },
                { id: 'awaiting', label: 'Awaiting partner', colorVar: '--viz-awaiting' },
              ]}
              data={chartData}
              format={(n) => money(n)}
              emptyLabel="No cash entries this month."
            />
          ) : null}

          <div className="card table-card">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Start date</th>
                    <th>Reference code</th>
                    <th className="num">Total amount</th>
                    <th>Status</th>
                    <th>Ticket raised?</th>
                    <th className="col-reason">Reason</th>
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
                        money={money}
                        onPatch={onPatch}
                      />
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="table-msg">
                        {term ? 'No entries match your search.' : 'No cash entries for this view.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function MonthRow({
  month,
  money,
  onSelect,
}: {
  month: CashMonthSummary;
  money: (n: number) => string;
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
      <td className="num strong">{money(month.total)}</td>
      <td className="num tone-good">{money(month.collected)}</td>
      <td className="num tone-bad">{money(month.notCollected)}</td>
    </tr>
  );
}

function Row({
  row,
  today,
  canEdit,
  saving,
  money,
  onPatch,
}: {
  row: CashRow;
  today: string;
  canEdit: boolean;
  saving: boolean;
  money: (n: number) => string;
  onPatch: SectionProps['onPatch'];
}) {
  // Ticket and reason only apply to cash that did not come back.
  const explains = row.status === 'Not collected';
  const age = ageInDays(row, today);

  return (
    <tr className={saving ? 'is-saving' : undefined}>
      <td title={row.dateRaw ? `As written in the sheet: ${row.dateRaw}` : undefined}>
        {formatDmy(row.date)}
        <AgeBadge days={age} />
      </td>
      <td className="mono">{row.ref}</td>
      <td className="num strong">{money(row.amount)}</td>

      <td>
        <select
          className="cell-select"
          value={row.status}
          disabled={!canEdit || saving}
          aria-label={`Collection status for ${row.ref}`}
          onChange={(e) => onPatch('CASH', row.key, { status: e.target.value })}
        >
          <option value="">Pending</option>
          <option value="Collected">Collected</option>
          <option value="Not collected">Not collected</option>
        </select>
      </td>

      <td>
        <select
          className="cell-select"
          value={row.ticket}
          disabled={!canEdit || saving || !explains}
          aria-label={`Ticket raised for ${row.ref}`}
          title={explains ? undefined : 'Only applies when cash was not collected'}
          onChange={(e) => onPatch('CASH', row.key, { ticket: e.target.value })}
        >
          <option value="">—</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </select>
        {explains && row.ticket === 'No' ? <span className="flag">No ticket</span> : null}
      </td>

      <td className="col-reason">
        <ReasonField
          value={row.reason}
          placeholder={explains ? 'Why was it not collected?' : 'Only needed if not collected'}
          disabled={!canEdit || saving || !explains}
          onSave={(next) => onPatch('CASH', row.key, { reason: next })}
        />
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

function FinanceRow({
  row,
  today,
  canEdit,
  saving,
  onPatch,
}: {
  row: CashRow;
  today: string;
  canEdit: boolean;
  saving: boolean;
  onPatch: SectionProps['onPatch'];
}) {
  const age = ageInDays(row, today);
  const [showFull, setShowFull] = useState(false);
  const long = row.financeComment.length > 160;
  const shown = long && !showFull ? `${row.financeComment.slice(0, 160)}…` : row.financeComment;

  return (
    <tr className={saving ? 'is-saving' : undefined}>
      <td title={row.dateRaw ? `As written in the sheet: ${row.dateRaw}` : undefined}>
        {formatDmy(row.date)}
        <AgeBadge days={age} />
      </td>
      <td className="mono">{row.ref}</td>

      <td className="col-reason">
        {row.financeComment ? (
          <>
            <p className="finance-comment">{shown}</p>
            {long ? (
              <button
                type="button"
                className="linkish"
                onClick={() => setShowFull((v) => !v)}
              >
                {showFull ? 'Show less' : 'Show more'}
              </button>
            ) : null}
          </>
        ) : (
          <span className="muted">—</span>
        )}
      </td>

      <td className="col-reason">
        <ReasonField
          value={row.financeResponse}
          placeholder={FINANCE_RESPONSE_PLACEHOLDER}
          disabled={!canEdit || saving}
          onSave={(next) => onPatch('CASH', row.key, { financeResponse: next })}
        />
      </td>
    </tr>
  );
}
