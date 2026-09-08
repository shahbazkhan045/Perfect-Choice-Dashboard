'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DashboardData } from '@/lib/types';
import {
  companyCleanerRollup,
  companyKpis,
  companyMonthOptions,
  defaultersList,
  distinctCleanerNames,
  distinctCompanies,
  distinctVanNames,
  formatMonthLabel,
  type DefaulterGroupBy,
  type DefaulterMetric,
} from '@/lib/stats';
import { formatDmy } from '@/lib/parse';
import { downloadCsv, toCsv } from '@/lib/csv';
import { Kpi } from '@/components/ui';

function pctLabel(pct: number | null): string {
  return pct != null ? `${pct.toFixed(2)}%` : '—';
}

export default function CompanyPerformanceSection({ data }: { data: DashboardData }) {
  const companies = useMemo(() => distinctCompanies(data.companyPerf), [data.companyPerf]);
  const months = useMemo(
    () => companyMonthOptions(data.companyPerf, data.canx),
    [data.companyPerf, data.canx],
  );

  const [month, setMonth] = useState<string>('');
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [defaulterGroupBy, setDefaulterGroupBy] = useState<DefaulterGroupBy>('cleaner');
  const [defaulterMetric, setDefaulterMetric] = useState<DefaulterMetric>('absent');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [cleanerFilter, setCleanerFilter] = useState('');
  const [vanFilter, setVanFilter] = useState('');

  // Default to the most recent month once the data (and therefore the
  // option list) is actually available — an empty string beforehand would
  // otherwise render as a blank, valid-looking dropdown selection.
  useEffect(() => {
    if (!month && months.length) setMonth(months[0]);
  }, [month, months]);

  const kpis = useMemo(
    () =>
      selectedCompany
        ? companyKpis(
            data.companyPerf,
            data.canx,
            data.companyAbsentDaily,
            data.canxMonthlyPct,
            selectedCompany,
            month,
          )
        : null,
    [data.companyPerf, data.canx, data.companyAbsentDaily, data.canxMonthlyPct, selectedCompany, month],
  );

  const defaulters = useMemo(
    () =>
      month
        ? defaultersList(data.companyPerf, data.canx, month, defaulterGroupBy, defaulterMetric)
        : [],
    [data.companyPerf, data.canx, month, defaulterGroupBy, defaulterMetric],
  );

  const cleanerOptions = useMemo(
    () => (selectedCompany ? distinctCleanerNames(data.companyPerf, selectedCompany) : []),
    [data.companyPerf, selectedCompany],
  );
  const vanOptions = useMemo(
    () => (selectedCompany ? distinctVanNames(data.companyPerf, selectedCompany) : []),
    [data.companyPerf, selectedCompany],
  );

  const rollup = useMemo(
    () =>
      selectedCompany && month
        ? companyCleanerRollup(data.companyPerf, data.canx, selectedCompany, month, {
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            cleanerName: cleanerFilter || undefined,
            van: vanFilter || undefined,
          })
        : [],
    [data.companyPerf, data.canx, selectedCompany, month, dateFrom, dateTo, cleanerFilter, vanFilter],
  );

  const hasFilters = Boolean(dateFrom || dateTo || cleanerFilter || vanFilter);

  function clearFilters() {
    setDateFrom('');
    setDateTo('');
    setCleanerFilter('');
    setVanFilter('');
  }

  function download() {
    if (!selectedCompany) return;
    const csv = toCsv(
      ['Cleaner ID', 'Cleaner name', 'Van', 'Absent BD', 'Absent BD % (share of company)', 'Cancellations', 'Last activity'],
      rollup.map((r) => [
        r.cleanerId,
        r.cleanerName,
        r.van,
        r.absentCount,
        `${r.absentShare.toFixed(2)}%`,
        r.cancellationCount,
        formatDmy(r.lastDate),
      ]),
    );
    downloadCsv(`company-performance-${selectedCompany}-${month}.csv`, csv);
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

      <div className="card cp-defaulters">
        <div className="cp-card-head">
          <span>Defaulters</span>
          <div className="cp-defaulter-controls">
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
          </div>
        </div>

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
                  <tr key={d.key} className={i === 0 ? 'defaulter-top' : undefined}>
                    <td className="muted">{i + 1}</td>
                    <td className="strong">{d.name}</td>
                    <td className="van" title={d.secondary}>
                      {d.secondary || <span className="muted">—</span>}
                    </td>
                    <td className="num">{d.absentCount || <span className="muted">0</span>}</td>
                    <td className="num">{d.cancellationCount || <span className="muted">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted cp-empty-hint">No data for this month yet.</p>
        )}
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
            <Kpi label="Absent BD" value={String(kpis.absentCount)} />
            <Kpi
              label="Absent BD %"
              value={pctLabel(kpis.absentPct)}
              unit={kpis.absentPct == null ? 'not set in sheet' : undefined}
              tone={kpis.absentPct != null ? 'warn' : 'plain'}
            />
            <Kpi label="Total cancellations" value={String(kpis.cancellationCount)} />
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

      {!selectedCompany ? (
        <div className="card cp-empty-card">
          <p className="muted">Select a company above to see its vans and cleaners.</p>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <div className="cp-filters">
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
                      <td colSpan={7} className="table-msg">
                        {hasFilters ? 'No rows match your filters.' : 'No data for this view.'}
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
