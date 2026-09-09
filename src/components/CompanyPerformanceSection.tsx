'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DashboardData } from '@/lib/types';
import {
  companyCleanerRollup,
  companyKpis,
  companyMonthOptions,
  defaultersList,
  defaultersListForMonth,
  distinctCleanerNames,
  distinctCompanies,
  distinctVanNames,
  formatMonthLabel,
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

export default function CompanyPerformanceSection({ data }: { data: DashboardData }) {
  const companies = useMemo(() => distinctCompanies(data.companyPerf), [data.companyPerf]);
  const months = useMemo(
    () => companyMonthOptions(data.companyPerf, data.canx, data.companyMonthly),
    [data.companyPerf, data.canx, data.companyMonthly],
  );
  const weeks = useMemo(() => weekBuckets(data.today), [data.today]);

  const [month, setMonth] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  const [defaulterView, setDefaulterView] = useState<DefaulterView>('monthly');
  const [weekKey, setWeekKey] = useState('');
  const [defaulterGroupBy, setDefaulterGroupBy] = useState<DefaulterGroupBy>('cleaner');
  const [defaulterMetric, setDefaulterMetric] = useState<DefaulterMetric>('absent');

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
      </div>

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

        <p className="muted cp-defaulters-scope">{defaulterScopeLabel}</p>

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
                {defaulters.map((d, i) => (
                  <tr key={d.key}>
                    <td className="muted">{i + 1}</td>
                    <td className="strong">{d.name}</td>
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
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted cp-empty-hint">No data for this {defaulterView === 'monthly' ? 'month' : 'week'} yet.</p>
        )}
      </div>

      <div className="toolbar">
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

      <div className="card table-card">
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
    </section>
  );
}
