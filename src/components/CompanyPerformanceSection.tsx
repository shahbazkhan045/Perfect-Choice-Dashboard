'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import type { DashboardData } from '@/lib/types';
import {
  cleanerMonthlyHistory,
  cleanerWeeklyHistory,
  companyCleanerRollup,
  companyKpis,
  companyMonthOptions,
  companyDailySeries,
  companyOnTime,
  repeatOffenders,
  shiftMonth,
  shortMonthLabel,
  thresholdFlags,
  defaultersList,
  defaultersListForMonth,
  distinctCleanerNames,
  distinctCompanies,
  distinctVanNames,
  formatMonthLabel,
  monthRange,
  vanCleanerBreakdown,
  weekBuckets,
  ON_TIME_WARN_PCT,
  type DefaulterGroupBy,
  type DefaulterMetric,
  type OnTimeData,
} from '@/lib/stats';
import { formatDmy, shortCleanerName, shortVanName } from '@/lib/parse';
import {
  ABSENT_BD_PCT_TARGET,
  CANX_PCT_TARGET,
  ON_TIME_PCT_TARGET,
  RATING_TARGET,
  targetLabel,
  targetTone,
} from '@/lib/targets';
import { downloadCsv, toCsv } from '@/lib/csv';
import { Kpi, type KpiDelta } from '@/components/ui';
import DayBarChart, { type DayDatum } from '@/components/DayBarChart';
import { DownloadIcon } from '@/components/icons';

function pctLabel(pct: number | null): string {
  return pct != null ? `${pct.toFixed(2)}%` : '—';
}

function numLabel(n: number | null): string {
  return n != null ? String(n) : '—';
}

/**
 * On Time % is only known where the denominator is complete — see the
 * on-time section of lib/stats.ts. Everywhere else it has to read as "—"
 * rather than as a number, so nobody mistakes an unknown for a bad score.
 */
const UNKNOWN_ON_TIME = "On time is only measured for exclusive bookings, and only for months the sheet's MTD table covers.";

/** targetTone() speaks in statuses; the Kpi tile speaks in tones. */
function toneFor(value: number | null, target: number, higherIsBetter: boolean) {
  return targetTone(value, target, higherIsBetter) ?? 'plain';
}

/**
 * A cleaner or van cell: the shortened name, the full one in the tooltip.
 * Downloads keep the full name — see downloadDefaulters() and download().
 */
function NameCell({ full, kind }: { full: string; kind: 'cleaner' | 'van' }) {
  if (!full) return <span className="muted">—</span>;
  if (kind === 'van') {
    return <span title={full}>{shortVanName(full)}</span>;
  }
  const { name, van } = shortCleanerName(full);
  return (
    <span title={full}>
      <span className="name-main">{name}</span>
      {van ? <span className="name-sub">{van}</span> : null}
    </span>
  );
}

function OnTimeCell({ pct }: { pct: number | null }) {
  if (pct == null) {
    return (
      <td className="num muted" title={UNKNOWN_ON_TIME}>
        —
      </td>
    );
  }
  return <td className={`num${pct < ON_TIME_WARN_PCT ? ' cell-warn' : ''}`}>{pct.toFixed(2)}%</td>;
}

/** Which company this browser last looked at — a convenience, never required. */
const COMPANY_KEY = 'pcd-company';

/**
 * One tile of the month summary strip: the figure, how it scores against
 * its target, and how it moved since last month. Deliberately smaller and
 * flatter than a Kpi — this strip is a recap of numbers already shown
 * above, not a second set of headline figures competing with them.
 */
function SummaryTile({
  label,
  value,
  tone,
  target,
  delta,
}: {
  label: string;
  value: string;
  tone: 'plain' | 'good' | 'warn' | 'bad';
  target?: string;
  delta?: KpiDelta | null;
}) {
  return (
    <div className="summary-tile">
      <span className="summary-label">{label}</span>
      <span className={`summary-value tone-${tone}`}>{value}</span>
      {delta ? (
        <span
          className={`summary-delta summary-delta-${
            Math.abs(delta.change) < Math.pow(10, -(delta.decimals ?? 0)) / 2
              ? 'flat'
              : (delta.lowerIsBetter ? delta.change < 0 : delta.change > 0)
                ? 'good'
                : 'bad'
          }`}
        >
          <span aria-hidden="true">{delta.change > 0 ? '▲' : delta.change < 0 ? '▼' : '→'}</span>{' '}
          {Math.abs(delta.change).toFixed(delta.decimals ?? 0)}
          {delta.suffix ? ` ${delta.suffix}` : ''} vs {delta.vs}
        </span>
      ) : null}
      {target ? <span className="summary-target">{target}</span> : null}
    </div>
  );
}

type DefaulterView = 'monthly' | 'weekly';
type CpView = 'overview' | 'rawdata';

export default function CompanyPerformanceSection({ data }: { data: DashboardData }) {
  const companies = useMemo(() => distinctCompanies(data.companyPerf), [data.companyPerf]);
  const months = useMemo(
    () => companyMonthOptions(data.companyPerf, data.canx, data.companyMonthly),
    [data.companyPerf, data.canx, data.companyMonthly],
  );
  const weeks = useMemo(() => weekBuckets(data.today), [data.today]);

  const [month, setMonth] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  // Overview = Company performance + Defaulters; Raw data is its own view
  // now rather than a third card stacked under those two.
  const [view, setView] = useState<CpView>('overview');

  const [defaulterView, setDefaulterView] = useState<DefaulterView>('monthly');
  const [weekKey, setWeekKey] = useState('');
  const [defaulterGroupBy, setDefaulterGroupBy] = useState<DefaulterGroupBy>('cleaner');
  const [defaulterMetric, setDefaulterMetric] = useState<DefaulterMetric>('absent');
  // Which defaulter row is expanded inline (its `key`) — at most one at a
  // time, shown as an extra row right below it rather than a popup, so the
  // history table has the full table width to lay out in instead of a
  // cramped box that needs its own horizontal scroll.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const [rawCompanyFilter, setRawCompanyFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [cleanerFilter, setCleanerFilter] = useState('');
  const [vanFilter, setVanFilter] = useState('');

  // Default to the most recent month / week once the data (and therefore
  // the option lists) is actually available — an empty string beforehand
  // would otherwise render as a blank, valid-looking selection.
  useEffect(() => {
    if (!month && months.length) setMonth(months[0]);
  }, [month, months]);
  useEffect(() => {
    if (!weekKey && weeks.length) setWeekKey(weeks[0].key);
  }, [weekKey, weeks]);

  // Remember which company this browser was last looking at, so the tab
  // opens where you left it rather than on whichever one sorts first.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(COMPANY_KEY);
      if (saved) setSelectedCompany(saved);
    } catch {
      /* storage can be blocked; the auto-select below still picks one */
    }
  }, []);

  function chooseCompany(company: string) {
    setSelectedCompany(company);
    try {
      localStorage.setItem(COMPANY_KEY, company);
    } catch {
      /* ignore */
    }
  }

  // Land on a company that actually has numbers for the selected month —
  // "select a company above" on first open, or a remembered company that
  // happens to be blank this month, is a dead end.
  useEffect(() => {
    if (!month || !companies.length) return;
    const hasData = (c: string) =>
      data.companyMonthly.some((m) => m.company === c && m.month === month) ||
      data.companyPerf.some((r) => r.company === c && r.date.slice(0, 7) === month);
    if (selectedCompany && hasData(selectedCompany)) return;
    const next = companies.find(hasData) ?? companies[0];
    if (next && next !== selectedCompany) setSelectedCompany(next);
  }, [month, companies, selectedCompany, data.companyMonthly, data.companyPerf]);

  const kpis = useMemo(
    () => (selectedCompany ? companyKpis(data.companyMonthly, selectedCompany, month) : null),
    [data.companyMonthly, selectedCompany, month],
  );

  const onTime: OnTimeData = useMemo(
    () => ({
      vanDaily: data.onTimeVanDaily,
      cleanerDaily: data.onTimeCleanerDaily,
      monthly: data.onTimeMonthly,
    }),
    [data.onTimeVanDaily, data.onTimeCleanerDaily, data.onTimeMonthly],
  );

  // Summed from the Daily - Van block rather than read off the MTD TOTAL row:
  // that block is complete and append-only, so it covers the whole month.
  const companyOnTimeKpi = useMemo(
    () => (selectedCompany ? companyOnTime(data.onTimeVanDaily, selectedCompany, month) : null),
    [data.onTimeVanDaily, selectedCompany, month],
  );

  // Every KPI below is also shown as a move since the month before, which
  // is read from exactly the same sources as the current month's figure.
  const previousMonth = month ? shiftMonth(month, -1) : '';
  const previousKpis = useMemo(
    () =>
      selectedCompany && previousMonth
        ? companyKpis(data.companyMonthly, selectedCompany, previousMonth)
        : null,
    [data.companyMonthly, selectedCompany, previousMonth],
  );
  const previousOnTime = useMemo(
    () =>
      selectedCompany && previousMonth
        ? companyOnTime(data.onTimeVanDaily, selectedCompany, previousMonth)
        : null,
    [data.onTimeVanDaily, selectedCompany, previousMonth],
  );

  /** null whenever either side is missing — an absent month is not a change of zero. */
  function delta(
    now: number | null | undefined,
    before: number | null | undefined,
    lowerIsBetter: boolean,
    suffix?: string,
    decimals = 0,
  ): KpiDelta | null {
    if (now == null || before == null || !previousMonth) return null;
    return {
      change: now - before,
      vs: shortMonthLabel(previousMonth),
      lowerIsBetter,
      suffix,
      decimals,
    };
  }

  const selectedWeek = weeks.find((w) => w.key === weekKey);

  const defaulters = useMemo(() => {
    if (defaulterView === 'monthly') {
      return month
        ? defaultersListForMonth(
            data.companyPerf,
            data.canx,
            month,
            defaulterGroupBy,
            defaulterMetric,
            onTime,
          )
        : [];
    }
    return selectedWeek
      ? defaultersList(
          data.companyPerf,
          data.canx,
          { from: selectedWeek.start, to: selectedWeek.end },
          defaulterGroupBy,
          defaulterMetric,
          onTime,
        )
      : [];
  }, [defaulterView, data.companyPerf, data.canx, month, selectedWeek, defaulterGroupBy, defaulterMetric, onTime]);

  const defaulterScopeLabel =
    defaulterView === 'monthly' ? formatMonthLabel(month) : (selectedWeek?.label ?? '');

  // History always reflects whichever grouping produced the row that was
  // expanded — collapse it whenever that grouping (or the view) changes,
  // since a cleaner's history and a van's history are different questions.
  useEffect(() => {
    setExpandedKey(null);
  }, [defaulterView, defaulterGroupBy]);

  // One point per elapsed day of the selected month, for the trend charts
  // under the summary strip. Counts and a percentage are deliberately NOT
  // put on one axis — see the note at the top of DayBarChart.
  const dailySeries = useMemo(
    () =>
      selectedCompany
        ? companyDailySeries(
            data.companyPerf,
            data.canx,
            onTime,
            selectedCompany,
            month,
            data.today,
          )
        : [],
    [data.companyPerf, data.canx, onTime, selectedCompany, month, data.today],
  );

  const eventsChart: DayDatum[] = useMemo(
    () =>
      dailySeries
        .filter((d) => d.absentCount > 0 || d.cancellationCount > 0)
        .map((d) => ({
          date: d.date,
          values: { absent: d.absentCount, cancellations: d.cancellationCount },
        })),
    [dailySeries],
  );

  const onTimeChart: DayDatum[] = useMemo(
    () =>
      dailySeries
        .filter((d) => d.onTimePct != null)
        .map((d) => ({ date: d.date, values: { onTime: d.onTimePct as number } })),
    [dailySeries],
  );

  const chartSubtitle = `${formatMonthLabel(month)} \u00b7 ${selectedCompany ?? ''}`;
  const pctAxis = (v: number) => Math.round(v) + '%';
  const countAxis = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  // Who was over threshold last month too. Weekly has no "previous month"
  // to compare against, so the tag only appears on the Monthly tab.
  const repeats = useMemo(
    () =>
      defaulterView === 'monthly' && month
        ? repeatOffenders(data.companyPerf, data.canx, month, defaulterGroupBy, onTime)
        : new Set<string>(),
    [defaulterView, month, data.companyPerf, data.canx, defaulterGroupBy, onTime],
  );

  const expandedEntry = defaulters.find((d) => d.key === expandedKey);

  const historyPoints = useMemo(() => {
    if (!expandedEntry) return [];
    if (defaulterView === 'monthly') {
      return month
        ? cleanerMonthlyHistory(
            data.companyPerf,
            data.canx,
            expandedEntry.name,
            defaulterGroupBy,
            month,
            undefined,
            onTime,
          )
        : [];
    }
    return selectedWeek
      ? cleanerWeeklyHistory(
          data.companyPerf,
          data.canx,
          expandedEntry.name,
          defaulterGroupBy,
          selectedWeek.key,
          undefined,
          onTime,
        )
      : [];
  }, [expandedEntry, defaulterView, month, selectedWeek, defaulterGroupBy, data.companyPerf, data.canx, onTime]);

  // Which cleaners actually make up an expanded van's current-period
  // number — only meaningful when grouped by van, and scoped to the same
  // period the row itself is showing (not the multi-month/week history).
  const vanCleaners = useMemo(() => {
    if (!expandedEntry || defaulterGroupBy !== 'van') return [];
    const range =
      defaulterView === 'monthly'
        ? month
          ? monthRange(month)
          : null
        : selectedWeek
          ? { from: selectedWeek.start, to: selectedWeek.end }
          : null;
    return range
      ? vanCleanerBreakdown(
          data.companyPerf,
          data.canx,
          expandedEntry.name,
          range,
          defaulterMetric,
          onTime,
        )
      : [];
  }, [expandedEntry, defaulterGroupBy, defaulterView, month, selectedWeek, defaulterMetric, data.companyPerf, data.canx, onTime]);

  function downloadDefaulters() {
    const nameHeader = defaulterGroupBy === 'cleaner' ? 'Cleaner' : 'Van';
    const secondaryHeader = defaulterGroupBy === 'cleaner' ? 'Van' : 'Company';
    const csv = toCsv(
      [nameHeader, secondaryHeader, 'Absent BD', 'Cancellations', 'Late arrivals', 'On Time %'],
      defaulters.map((d) => [
        d.name,
        d.secondary,
        d.absentCount,
        d.cancellationCount,
        d.lateCount,
        d.onTimePct != null ? `${d.onTimePct.toFixed(2)}%` : '',
      ]),
    );
    const scopeKey = defaulterView === 'monthly' ? month : weekKey;
    downloadCsv(`defaulters-${defaulterGroupBy}-${defaulterView}-${scopeKey}.csv`, csv);
  }

  const cleanerOptions = useMemo(
    () => distinctCleanerNames(data.companyPerf, rawCompanyFilter || undefined),
    [data.companyPerf, rawCompanyFilter],
  );
  const vanOptions = useMemo(
    () => distinctVanNames(data.companyPerf, rawCompanyFilter || undefined),
    [data.companyPerf, rawCompanyFilter],
  );

  const rollup = useMemo(
    () =>
      month
        ? companyCleanerRollup(data.companyPerf, data.canx, month, {
            company: rawCompanyFilter || undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            cleanerName: cleanerFilter || undefined,
            van: vanFilter || undefined,
          }, onTime)
        : [],
    [data.companyPerf, data.canx, month, rawCompanyFilter, dateFrom, dateTo, cleanerFilter, vanFilter, onTime],
  );

  const hasFilters = Boolean(rawCompanyFilter || dateFrom || dateTo || cleanerFilter || vanFilter);

  function clearFilters() {
    setRawCompanyFilter('');
    setDateFrom('');
    setDateTo('');
    setCleanerFilter('');
    setVanFilter('');
  }

  function download() {
    const csv = toCsv(
      [
        'Cleaner ID',
        'Cleaner name',
        'Company',
        'Van',
        'Absent BD',
        'Absent BD % (share)',
        'Cancellations',
        'Late arrivals',
        'On Time %',
        'Last activity',
      ],
      rollup.map((r) => [
        r.cleanerId,
        r.cleanerName,
        r.company,
        r.van,
        r.absentCount,
        `${r.absentShare.toFixed(2)}%`,
        r.cancellationCount,
        r.lateCount,
        r.onTimePct != null ? `${r.onTimePct.toFixed(2)}%` : '',
        formatDmy(r.lastDate),
      ]),
    );
    downloadCsv(`company-performance-${rawCompanyFilter || 'all'}-${month}.csv`, csv);
  }

  if (!data.companyPerf.length) {
    return (
      <section aria-label="Company performance">
        <div className="card cp-empty-card">
          <p className="muted">
            No data yet in the &ldquo;Company Performance&rdquo; sheet tab — once rows are added
            there, this tab fills in automatically.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Company performance">
      <div className="toolbar">
        <div className="cp-month">
          <label htmlFor="cp-month-select">Month</label>
          <select id="cp-month-select" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonthLabel(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="company-tabs" role="tablist" aria-label="Company performance view">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'overview'}
            className={`company-tab${view === 'overview' ? ' is-active' : ''}`}
            onClick={() => setView('overview')}
          >
            Overview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'rawdata'}
            className={`company-tab${view === 'rawdata' ? ' is-active' : ''}`}
            onClick={() => setView('rawdata')}
          >
            Raw Performance Data
          </button>
        </div>
      </div>

      {view === 'rawdata' ? (
        <div className="card cp-rawdata">
          <div className="cp-card-head">Raw data</div>
        <div className="toolbar cp-rawdata-toolbar">
          <div className="cp-filters">
            <select
              className="cp-company-select"
              value={rawCompanyFilter}
              onChange={(e) => setRawCompanyFilter(e.target.value)}
              aria-label="Filter by company"
            >
              <option value="">All companies</option>
              {companies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span className="cp-range">
              <input
                type="date"
                className="cp-date-input"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label="From date"
              />
              <span className="cp-range-sep">to</span>
              <input
                type="date"
                className="cp-date-input"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label="To date"
              />
            </span>
            <input
              type="text"
              className="table-search"
              list="cp-cleaner-options"
              value={cleanerFilter}
              onChange={(e) => setCleanerFilter(e.target.value)}
              placeholder="Cleaner name…"
              aria-label="Filter by cleaner name"
            />
            <datalist id="cp-cleaner-options">
              {cleanerOptions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <input
              type="text"
              className="table-search"
              list="cp-van-options"
              value={vanFilter}
              onChange={(e) => setVanFilter(e.target.value)}
              placeholder="Van name…"
              aria-label="Filter by van name"
            />
            <datalist id="cp-van-options">
              {vanOptions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            {hasFilters ? (
              <button type="button" className="btn" onClick={clearFilters}>
                Clear filters
              </button>
            ) : null}
          </div>
          <div className="toolbar-actions">
            <button type="button" className="btn" onClick={download} disabled={!rollup.length}>
              <DownloadIcon /> Download
            </button>
          </div>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Cleaner ID</th>
                <th>Cleaner name</th>
                <th>Company</th>
                <th>Van</th>
                <th className="num">Absent BD</th>
                <th className="num">Absent BD % (share)</th>
                <th className="num">Cancellations</th>
                <th className="num">Late arrivals</th>
                <th className="num">On Time %</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rollup.length ? (
                rollup.map((r) => (
                  <tr key={`${r.cleanerId || r.cleanerName}`}>
                    <td className="mono">{r.cleanerId || <span className="muted">—</span>}</td>
                    <td className="strong">
                      <NameCell full={r.cleanerName} kind="cleaner" />
                    </td>
                    <td>{r.company || <span className="muted">—</span>}</td>
                    <td className="van">
                      <NameCell full={r.van} kind="van" />
                    </td>
                    <td className="num">{r.absentCount}</td>
                    <td className="num">{r.absentShare.toFixed(2)}%</td>
                    <td className="num">{r.cancellationCount}</td>
                    <td className="num">{r.lateCount}</td>
                    <OnTimeCell pct={r.onTimePct} />
                    <td>{formatDmy(r.lastDate)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="table-msg">
                    {hasFilters ? 'No rows match your filters.' : 'No data for this view.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </div>
      ) : (
        <>
      <div className="card cp-companies">
        <div className="cp-card-head">Company performance</div>
        <div className="company-tabs" role="tablist" aria-label="Choose a company">
          {companies.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={selectedCompany === c}
              className={`company-tab${selectedCompany === c ? ' is-active' : ''}`}
              onClick={() => chooseCompany(c)}
            >
              {c}
            </button>
          ))}
        </div>

        {kpis ? (
          <div className="kpi-row">
            <Kpi
              label="Absent BD"
              value={numLabel(kpis.absentCount)}
              delta={delta(kpis.absentCount, previousKpis?.absentCount, true, undefined, 1)}
            />
            <Kpi
              label="Absent BD %"
              value={pctLabel(kpis.absentPct)}
              unit={kpis.absentPct == null ? 'not set in sheet' : undefined}
              tone={toneFor(kpis.absentPct, ABSENT_BD_PCT_TARGET, false)}
              footnote={targetLabel(ABSENT_BD_PCT_TARGET)}
              delta={delta(kpis.absentPct, previousKpis?.absentPct, true, 'pts', 2)}
            />
            <Kpi
              label="Total cancellations"
              value={numLabel(kpis.cancellationCount)}
              unit={kpis.cancellationCount == null ? 'not set in sheet' : undefined}
              delta={delta(kpis.cancellationCount, previousKpis?.cancellationCount, true)}
            />
            <Kpi
              label="Cancellation %"
              value={pctLabel(kpis.cancellationPct)}
              unit={kpis.cancellationPct == null ? 'not set in sheet' : undefined}
              tone={toneFor(kpis.cancellationPct, CANX_PCT_TARGET, false)}
              footnote={targetLabel(CANX_PCT_TARGET)}
              delta={delta(kpis.cancellationPct, previousKpis?.cancellationPct, true, 'pts', 2)}
            />
            <Kpi
              label="On Time %"
              value={companyOnTimeKpi ? `${companyOnTimeKpi.pct.toFixed(2)}%` : 'Not tracked'}
              unit={
                companyOnTimeKpi
                  ? `on time ${companyOnTimeKpi.onTime.toLocaleString()} / ${companyOnTimeKpi.exclusiveBookings.toLocaleString()} bookings`
                  : undefined
              }
              tone={
                companyOnTimeKpi ? toneFor(companyOnTimeKpi.pct, ON_TIME_PCT_TARGET, true) : 'plain'
              }
              footnote={companyOnTimeKpi ? targetLabel(ON_TIME_PCT_TARGET) : undefined}
              delta={delta(
                companyOnTimeKpi?.pct ?? null,
                previousOnTime?.pct ?? null,
                false,
                'pts',
                2,
              )}
              title={
                companyOnTimeKpi
                  ? undefined
                  : 'On time is only measured for exclusive bookings, and this company has none.'
              }
            />
            <Kpi
              label="Avg rating"
              value={kpis.avgRating != null ? kpis.avgRating.toFixed(2) : '—'}
              unit={kpis.avgRating == null ? 'not set in sheet' : '★'}
              tone={toneFor(kpis.avgRating, RATING_TARGET, true)}
              footnote={kpis.avgRating != null ? targetLabel(RATING_TARGET, '') : undefined}
              delta={delta(kpis.avgRating, previousKpis?.avgRating, false, undefined, 2)}
            />
          </div>
        ) : (
          <p className="muted cp-empty-hint">Select a company above to see its numbers.</p>
        )}
      </div>

      {selectedCompany ? (
        <>
          <div className="card cp-summary">
            <div className="cp-card-head">
              <span>{formatMonthLabel(month)} at a glance</span>
              <span className="muted">{selectedCompany}</span>
            </div>
            <div className="summary-strip">
              <SummaryTile
                label="C&amp;R %"
                value={pctLabel(kpis?.cancellationPct ?? null)}
                tone={toneFor(kpis?.cancellationPct ?? null, CANX_PCT_TARGET, false)}
                target={targetLabel(CANX_PCT_TARGET)}
                delta={delta(kpis?.cancellationPct, previousKpis?.cancellationPct, true, 'pts', 2)}
              />
              <SummaryTile
                label="Absent BD %"
                value={pctLabel(kpis?.absentPct ?? null)}
                tone={toneFor(kpis?.absentPct ?? null, ABSENT_BD_PCT_TARGET, false)}
                target={targetLabel(ABSENT_BD_PCT_TARGET)}
                delta={delta(kpis?.absentPct, previousKpis?.absentPct, true, 'pts', 2)}
              />
              <SummaryTile
                label="On Time %"
                value={companyOnTimeKpi ? pctLabel(companyOnTimeKpi.pct) : 'Not tracked'}
                tone={
                  companyOnTimeKpi
                    ? toneFor(companyOnTimeKpi.pct, ON_TIME_PCT_TARGET, true)
                    : 'plain'
                }
                target={companyOnTimeKpi ? targetLabel(ON_TIME_PCT_TARGET) : undefined}
                delta={delta(
                  companyOnTimeKpi?.pct ?? null,
                  previousOnTime?.pct ?? null,
                  false,
                  'pts',
                  2,
                )}
              />
              <SummaryTile
                label="Avg rating"
                value={kpis?.avgRating != null ? kpis.avgRating.toFixed(2) : '—'}
                tone={toneFor(kpis?.avgRating ?? null, RATING_TARGET, true)}
                target={kpis?.avgRating != null ? targetLabel(RATING_TARGET, '') : undefined}
                delta={delta(kpis?.avgRating, previousKpis?.avgRating, false, undefined, 2)}
              />
            </div>
          </div>

          {eventsChart.length ? (
            <DayBarChart
              title="Absences and cancellations per day"
              subtitle={chartSubtitle}
              series={[
                { id: 'absent', label: 'Absent BD', colorVar: '--viz-notcollected' },
                { id: 'cancellations', label: 'Cancellations', colorVar: '--viz-awaiting' },
              ]}
              data={eventsChart}
              format={countAxis}
              emptyLabel="Nothing recorded this month."
            />
          ) : null}

          {onTimeChart.length ? (
            <DayBarChart
              title="On time % per day"
              subtitle={chartSubtitle}
              series={[{ id: 'onTime', label: 'On time', colorVar: '--viz-collected' }]}
              data={onTimeChart}
              format={pctAxis}
              emptyLabel="No exclusive bookings this month."
              reference={{ value: ON_TIME_PCT_TARGET, label: targetLabel(ON_TIME_PCT_TARGET) }}
            />
          ) : null}
        </>
      ) : null}

      <div className="card cp-defaulters">
        <div className="cp-card-head">
          <span>Defaulters</span>
          <div className="cp-defaulter-controls">
            <div className="seg-toggle" role="tablist" aria-label="Monthly or weekly">
              <button
                type="button"
                role="tab"
                aria-selected={defaulterView === 'monthly'}
                className={`seg-toggle-btn${defaulterView === 'monthly' ? ' is-active' : ''}`}
                onClick={() => setDefaulterView('monthly')}
              >
                Monthly
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={defaulterView === 'weekly'}
                className={`seg-toggle-btn${defaulterView === 'weekly' ? ' is-active' : ''}`}
                onClick={() => setDefaulterView('weekly')}
              >
                Weekly
              </button>
            </div>

            {defaulterView === 'weekly' ? (
              <select
                className="cp-week-select"
                value={weekKey}
                onChange={(e) => setWeekKey(e.target.value)}
                aria-label="Select week"
              >
                {weeks.map((w) => (
                  <option key={w.key} value={w.key}>
                    {w.label}
                  </option>
                ))}
              </select>
            ) : null}

            <div className="seg-toggle" role="tablist" aria-label="Group by">
              <button
                type="button"
                role="tab"
                aria-selected={defaulterGroupBy === 'cleaner'}
                className={`seg-toggle-btn${defaulterGroupBy === 'cleaner' ? ' is-active' : ''}`}
                onClick={() => setDefaulterGroupBy('cleaner')}
              >
                By cleaner
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={defaulterGroupBy === 'van'}
                className={`seg-toggle-btn${defaulterGroupBy === 'van' ? ' is-active' : ''}`}
                onClick={() => setDefaulterGroupBy('van')}
              >
                By van
              </button>
            </div>
            <div className="seg-toggle" role="tablist" aria-label="Rank by">
              <button
                type="button"
                role="tab"
                aria-selected={defaulterMetric === 'absent'}
                className={`seg-toggle-btn${defaulterMetric === 'absent' ? ' is-active' : ''}`}
                onClick={() => setDefaulterMetric('absent')}
              >
                Rank by Absent BD
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={defaulterMetric === 'cancellations'}
                className={`seg-toggle-btn${defaulterMetric === 'cancellations' ? ' is-active' : ''}`}
                onClick={() => setDefaulterMetric('cancellations')}
              >
                Rank by Cancellations
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={defaulterMetric === 'late'}
                className={`seg-toggle-btn${defaulterMetric === 'late' ? ' is-active' : ''}`}
                onClick={() => setDefaulterMetric('late')}
              >
                Rank by Late arrivals
              </button>
            </div>
            <button
              type="button"
              className="btn"
              onClick={downloadDefaulters}
              disabled={!defaulters.length}
            >
              <DownloadIcon /> Download
            </button>
          </div>
        </div>

        <p className="muted cp-defaulters-scope">
          {defaulterScopeLabel} · click a row to expand its recent history
        </p>

        {defaulters.length ? (
          <div className="table-scroll cp-defaulters-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{defaulterGroupBy === 'cleaner' ? 'Cleaner' : 'Van'}</th>
                  <th>{defaulterGroupBy === 'cleaner' ? 'Van' : 'Company'}</th>
                  <th className="num">Absent BD</th>
                  <th className="num">Cancellations</th>
                  <th className="num">Late arrivals</th>
                  <th className="num">On Time %</th>
                </tr>
              </thead>
              <tbody>
                {defaulters.map((d, i) => {
                  const expanded = d.key === expandedKey;
                  const flags = thresholdFlags(d, defaulterView);
                  return (
                    <Fragment key={d.key}>
                      <tr
                        className="row-clickable"
                        tabIndex={0}
                        role="button"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Hide' : 'Show'} history for ${d.name}`}
                        onClick={() => setExpandedKey(expanded ? null : d.key)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setExpandedKey(expanded ? null : d.key);
                          }
                        }}
                      >
                        <td className="muted">{i + 1}</td>
                        <td className="strong">
                          <NameCell
                            full={d.name}
                            kind={defaulterGroupBy === 'cleaner' ? 'cleaner' : 'van'}
                          />
                          {repeats.has(d.key) ? (
                            <span
                              className="tag-repeat"
                              title="Was over threshold last month too."
                            >
                              Repeat
                            </span>
                          ) : null}
                          <span className="month-arrow" aria-hidden="true">
                            {expanded ? '▾' : '▸'}
                          </span>
                        </td>
                        <td className="van">
                          {defaulterGroupBy === 'cleaner' ? (
                            <NameCell full={d.secondary} kind="van" />
                          ) : (
                            <span title={d.secondary}>
                              {d.secondary || <span className="muted">—</span>}
                            </span>
                          )}
                        </td>
                        <td className={`num${flags.absent ? ' cell-warn' : ''}`}>
                          {d.absentCount || <span className="muted">0</span>}
                        </td>
                        <td className={`num${flags.cancellations ? ' cell-warn' : ''}`}>
                          {d.cancellationCount || <span className="muted">0</span>}
                        </td>
                        <td className="num">{d.lateCount || <span className="muted">0</span>}</td>
                        <OnTimeCell pct={d.onTimePct} />
                      </tr>
                      {expanded ? (
                        <tr className="history-row">
                          <td colSpan={7}>
                            <div className="history-panels">
                              <div className="history-panel">
                                <table className="history-inline-table">
                                  <thead>
                                    <tr>
                                      <th>Period</th>
                                      <th className="num">Absent BD</th>
                                      <th className="num">Cancellations</th>
                                      <th className="num">Late arrivals</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {historyPoints.map((h, hi) => (
                                      <tr key={h.label} className={hi === 0 ? 'history-current' : undefined}>
                                        <td>{h.label}</td>
                                        <td className={`num${h.absentCount > 3 ? ' cell-warn' : ''}`}>
                                          {h.absentCount}
                                        </td>
                                        <td className={`num${h.cancellationCount > 2 ? ' cell-warn' : ''}`}>
                                          {h.cancellationCount}
                                        </td>
                                        <td className="num">{h.lateCount}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                <p className="muted cp-history-hint">
                                  Top row is the currently selected {defaulterView === 'monthly' ? 'month' : 'week'}{' '}
                                  — the rest is recent history, so you can tell a one-off from a repeat offender.
                                </p>
                              </div>

                              {defaulterGroupBy === 'van' && vanCleaners.length ? (
                                <div className="history-panel">
                                  <table className="history-inline-table">
                                    <thead>
                                      <tr>
                                        <th>Cleaner on this van</th>
                                        <th className="num">Absent BD</th>
                                        <th className="num">Cancellations</th>
                                        <th className="num">Late arrivals</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {vanCleaners.map((c, ci) => (
                                        <tr
                                          key={c.cleanerId || c.cleanerName}
                                          className={ci === 0 ? 'history-current' : undefined}
                                        >
                                          <td>
                                            <NameCell full={c.cleanerName} kind="cleaner" />
                                          </td>
                                          <td className={`num${ci === 0 ? ' cell-warn' : ''}`}>{c.absentCount}</td>
                                          <td className={`num${ci === 0 ? ' cell-warn' : ''}`}>
                                            {c.cancellationCount}
                                          </td>
                                          <td className={`num${ci === 0 ? ' cell-warn' : ''}`}>
                                            {c.lateCount}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  <p className="muted cp-history-hint">
                                    Highest{' '}
                                    {defaulterMetric === 'absent'
                                      ? 'Absent BD'
                                      : defaulterMetric === 'cancellations'
                                        ? 'Cancellations'
                                        : 'Late arrivals'}{' '}
                                    on this van for {defaulterScopeLabel}, highlighted. Late arrivals here add
                                    up to the van&rsquo;s own Not On Time # for the same period.
                                  </p>
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted cp-empty-hint">No data for this {defaulterView === 'monthly' ? 'month' : 'week'} yet.</p>
        )}
      </div>
        </>
      )}
    </section>
  );
}
