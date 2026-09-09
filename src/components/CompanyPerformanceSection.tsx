'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import type { DashboardData } from '@/lib/types';
import {
  cleanerMonthlyHistory,
  cleanerWeeklyHistory,
  companyCleanerRollup,
  companyKpis,
  companyMonthOptions,
  defaultersList,
  defaultersListForMonth,
  distinctCleanerNames,
  distinctCompanies,
  distinctVanNames,
  formatMonthLabel,
  monthRange,
  vanCleanerBreakdown,
  weekBuckets,
  type DefaulterGroupBy,
  type DefaulterMetric,
} from '@/lib/stats';
import { formatDmy } from '@/lib/parse';
import { downloadCsv, toCsv } from '@/lib/csv';
import { Kpi } from '@/components/ui';

function pctLabel(pct: number | null): string {
  return pct != null ? `${pct.toFixed(2)}%` : '—';
}

function numLabel(n: number | null): string {
  return n != null ? String(n) : '—';
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

  const kpis = useMemo(
    () => (selectedCompany ? companyKpis(data.companyMonthly, selectedCompany, month) : null),
    [data.companyMonthly, selectedCompany, month],
  );

  const selectedWeek = weeks.find((w) => w.key === weekKey);

  const defaulters = useMemo(() => {
    if (defaulterView === 'monthly') {
      return month
        ? defaultersListForMonth(data.companyPerf, data.canx, month, defaulterGroupBy, defaulterMetric)
        : [];
    }
    return selectedWeek
      ? defaultersList(
          data.companyPerf,
          data.canx,
          { from: selectedWeek.start, to: selectedWeek.end },
          defaulterGroupBy,
          defaulterMetric,
        )
      : [];
  }, [defaulterView, data.companyPerf, data.canx, month, selectedWeek, defaulterGroupBy, defaulterMetric]);

  const defaulterScopeLabel =
    defaulterView === 'monthly' ? formatMonthLabel(month) : (selectedWeek?.label ?? '');

  // History always reflects whichever grouping produced the row that was
  // expanded — collapse it whenever that grouping (or the view) changes,
  // since a cleaner's history and a van's history are different questions.
  useEffect(() => {
    setExpandedKey(null);
  }, [defaulterView, defaulterGroupBy]);

  const expandedEntry = defaulters.find((d) => d.key === expandedKey);

  const historyPoints = useMemo(() => {
    if (!expandedEntry) return [];
    if (defaulterView === 'monthly') {
      return month
        ? cleanerMonthlyHistory(data.companyPerf, data.canx, expandedEntry.name, defaulterGroupBy, month)
        : [];
    }
    return selectedWeek
      ? cleanerWeeklyHistory(data.companyPerf, data.canx, expandedEntry.name, defaulterGroupBy, selectedWeek.key)
      : [];
  }, [expandedEntry, defaulterView, month, selectedWeek, defaulterGroupBy, data.companyPerf, data.canx]);

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
      ? vanCleanerBreakdown(data.companyPerf, data.canx, expandedEntry.name, range, defaulterMetric)
      : [];
  }, [expandedEntry, defaulterGroupBy, defaulterView, month, selectedWeek, defaulterMetric, data.companyPerf, data.canx]);

  function downloadDefaulters() {
    const nameHeader = defaulterGroupBy === 'cleaner' ? 'Cleaner' : 'Van';
    const secondaryHeader = defaulterGroupBy === 'cleaner' ? 'Van' : 'Company';
    const csv = toCsv(
      [nameHeader, secondaryHeader, 'Absent BD', 'Cancellations'],
      defaulters.map((d) => [d.name, d.secondary, d.absentCount, d.cancellationCount]),
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
          })
        : [],
    [data.companyPerf, data.canx, month, rawCompanyFilter, dateFrom, dateTo, cleanerFilter, vanFilter],
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
      ['Cleaner ID', 'Cleaner name', 'Company', 'Van', 'Absent BD', 'Absent BD % (share)', 'Cancellations', 'Last activity'],
      rollup.map((r) => [
        r.cleanerId,
        r.cleanerName,
        r.company,
        r.van,
        r.absentCount,
        `${r.absentShare.toFixed(2)}%`,
        r.cancellationCount,
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
              ⬇ Download
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
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rollup.length ? (
                rollup.map((r) => (
                  <tr key={`${r.cleanerId || r.cleanerName}`}>
                    <td className="mono">{r.cleanerId || <span className="muted">—</span>}</td>
                    <td className="strong">{r.cleanerName}</td>
                    <td>{r.company || <span className="muted">—</span>}</td>
                    <td className="van" title={r.van}>
                      {r.van || <span className="muted">—</span>}
                    </td>
                    <td className="num">{r.absentCount}</td>
                    <td className="num">{r.absentShare.toFixed(2)}%</td>
                    <td className="num">{r.cancellationCount}</td>
                    <td>{formatDmy(r.lastDate)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="table-msg">
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
              onClick={() => setSelectedCompany(c)}
            >
              {c}
            </button>
          ))}
        </div>

        {kpis ? (
          <div className="kpi-row kpi-row-4">
            <Kpi label="Absent BD" value={numLabel(kpis.absentCount)} />
            <Kpi
              label="Absent BD %"
              value={pctLabel(kpis.absentPct)}
              unit={kpis.absentPct == null ? 'not set in sheet' : undefined}
              tone={kpis.absentPct != null ? 'warn' : 'plain'}
            />
            <Kpi
              label="Total cancellations"
              value={numLabel(kpis.cancellationCount)}
              unit={kpis.cancellationCount == null ? 'not set in sheet' : undefined}
            />
            <Kpi
              label="Cancellation %"
              value={pctLabel(kpis.cancellationPct)}
              unit={kpis.cancellationPct == null ? 'not set in sheet' : undefined}
              tone={kpis.cancellationPct != null ? 'warn' : 'plain'}
            />
          </div>
        ) : (
          <p className="muted cp-empty-hint">Select a company above to see its numbers.</p>
        )}
      </div>

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
            </div>
            <button
              type="button"
              className="btn"
              onClick={downloadDefaulters}
              disabled={!defaulters.length}
            >
              ⬇ Download
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
                </tr>
              </thead>
              <tbody>
                {defaulters.map((d, i) => {
                  const expanded = d.key === expandedKey;
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
                          {d.name}
                          <span className="month-arrow" aria-hidden="true">
                            {expanded ? '▾' : '▸'}
                          </span>
                        </td>
                        <td className="van" title={d.secondary}>
                          {d.secondary || <span className="muted">—</span>}
                        </td>
                        <td className={`num${d.absentCount > 3 ? ' cell-warn' : ''}`}>
                          {d.absentCount || <span className="muted">0</span>}
                        </td>
                        <td className={`num${d.cancellationCount > 2 ? ' cell-warn' : ''}`}>
                          {d.cancellationCount || <span className="muted">0</span>}
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="history-row">
                          <td colSpan={5}>
                            <div className="history-panels">
                              <div className="history-panel">
                                <table className="history-inline-table">
                                  <thead>
                                    <tr>
                                      <th>Period</th>
                                      <th className="num">Absent BD</th>
                                      <th className="num">Cancellations</th>
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
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {vanCleaners.map((c, ci) => (
                                        <tr
                                          key={c.cleanerId || c.cleanerName}
                                          className={ci === 0 ? 'history-current' : undefined}
                                        >
                                          <td>{c.cleanerName}</td>
                                          <td className={`num${ci === 0 ? ' cell-warn' : ''}`}>{c.absentCount}</td>
                                          <td className={`num${ci === 0 ? ' cell-warn' : ''}`}>
                                            {c.cancellationCount}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  <p className="muted cp-history-hint">
                                    Highest {defaulterMetric === 'absent' ? 'Absent BD' : 'Cancellations'} on this
                                    van for {defaulterScopeLabel}, highlighted.
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
