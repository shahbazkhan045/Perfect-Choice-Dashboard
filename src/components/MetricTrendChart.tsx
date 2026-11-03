'use client';

import { useId, useMemo, useState } from 'react';
import { formatDmy } from '@/lib/parse';
import type { CompanyDayPoint } from '@/lib/stats';

/**
 * One chart box for the whole Overview, with a metric switcher where the
 * legend used to sit. Only one series is ever drawn, so each metric gets its
 * own axis, its own unit and its own colour without ever sharing a scale —
 * the thing that makes a two-measure chart misleading.
 */

export type TrendMetricId = 'absent' | 'cancellations' | 'onTime';

interface MetricSpec {
  id: TrendMetricId;
  label: string;
  /** CSS custom property holding this metric's colour. */
  colorVar: string;
  /** Pulls this metric's value out of a day, or null when the day has none. */
  value: (d: CompanyDayPoint) => number | null;
  format: (v: number) => string;
  /** Axis tick label — shorter than the tooltip's format. */
  tick: (v: number) => string;
  /** A target to draw as a dashed threshold, where the team has one. */
  target?: { value: number; label: string };
  /** Lower is better for the counts; higher is better for on time. */
  lowerIsBetter: boolean;
  /** Shown under the switcher so nobody reads a count as a rate. */
  unitNote: string;
}

const METRICS: MetricSpec[] = [
  {
    id: 'absent',
    label: 'Absent BD',
    colorVar: '--viz-absent',
    value: (d) => d.absentCount,
    format: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)),
    tick: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)),
    lowerIsBetter: true,
    unitNote: 'Absent business days recorded each day.',
  },
  {
    id: 'cancellations',
    label: 'Cancellations',
    colorVar: '--viz-canx',
    value: (d) => d.cancellationCount,
    format: (v) => String(v),
    tick: (v) => String(v),
    lowerIsBetter: true,
    unitNote: 'Cancellations and releases recorded each day.',
  },
  {
    id: 'onTime',
    label: 'On Time %',
    colorVar: '--viz-ontime',
    value: (d) => d.onTimePct,
    format: (v) => `${v.toFixed(2)}%`,
    tick: (v) => `${Math.round(v)}%`,
    target: { value: 90, label: 'Target 90%' },
    lowerIsBetter: false,
    unitNote: 'On time arrivals as a share of that day’s exclusive bookings.',
  },
];

const W = 760;
const H = 240;
const PAD = { top: 18, right: 18, bottom: 32, left: 54 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

/** Rounds an axis step up to a 1 / 2 / 5 x 10^n value so ticks read cleanly. */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  if (norm <= 1) return mag;
  if (norm <= 2) return 2 * mag;
  if (norm <= 5) return 5 * mag;
  return 10 * mag;
}

/**
 * The value axis for one metric.
 *
 * A count starts at zero, because the height of the mark IS the quantity.
 * A percentage does not: on a 0-100 axis an on-time rate that only ever
 * moves between 83% and 91% draws as a flat band and the month's trend
 * disappears. So a percentage gets a window around its own range, padded and
 * widened to include the target, and the axis labels say where it starts.
 */
function axisFor(values: number[], spec: MetricSpec): { lo: number; hi: number; ticks: number[] } {
  const peak = Math.max(1, ...values);

  if (spec.id !== 'onTime') {
    const step = niceStep(peak / 4);
    const hi = Math.ceil(peak / step) * step;
    const ticks: number[] = [];
    for (let v = 0; v <= hi + 1e-9; v += step) ticks.push(v);
    return { lo: 0, hi, ticks };
  }

  const min = Math.min(...values);
  const withTarget = spec.target ? [min, peak, spec.target.value] : [min, peak];
  const lo = Math.max(0, Math.floor((Math.min(...withTarget) - 2) / 2) * 2);
  const hi = Math.min(100, Math.ceil((Math.max(...withTarget) + 2) / 2) * 2);
  const step = niceStep((hi - lo) / 4);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

export default function MetricTrendChart({
  title,
  subtitle,
  data,
  emptyLabel,
}: {
  title: string;
  subtitle: string;
  data: CompanyDayPoint[];
  emptyLabel: string;
}) {
  const [metricId, setMetricId] = useState<TrendMetricId>('onTime');
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = useId();
  const glowId = useId();

  const spec = METRICS.find((m) => m.id === metricId) ?? METRICS[0];

  // Days the selected metric actually has a figure for. On Time is null on a
  // day with no exclusive bookings, and a gap is the honest way to draw that.
  const points = useMemo(
    () =>
      data
        .map((d, i) => ({ day: d.date, index: i, value: spec.value(d) }))
        .filter((p): p is { day: string; index: number; value: number } => p.value != null),
    [data, spec],
  );

  const axis = useMemo(
    () => axisFor(points.map((p) => p.value), spec),
    [points, spec],
  );

  const switcher = (
    <div className="metric-switch" role="tablist" aria-label="Choose a metric">
      {METRICS.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={m.id === metricId}
          className={`metric-tab${m.id === metricId ? ' is-active' : ''}`}
          style={{ ['--metric-color' as string]: `var(${m.colorVar})` }}
          onClick={() => {
            setMetricId(m.id);
            setHover(null);
          }}
        >
          <span className="metric-dot" aria-hidden="true" />
          {m.label}
        </button>
      ))}
    </div>
  );

  if (!points.length) {
    return (
      <section className="card chart-card">
        <div className="chart-head">
          <h2>{title}</h2>
          <span className="chart-sub">{subtitle}</span>
        </div>
        {switcher}
        <p className="chart-empty">{emptyLabel}</p>
      </section>
    );
  }

  const slotW = PLOT_W / Math.max(1, data.length);
  const x = (index: number) => PAD.left + slotW * index + slotW / 2;
  const y = (value: number) =>
    PAD.top + PLOT_H - ((value - axis.lo) / (axis.hi - axis.lo)) * PLOT_H;

  const line = points
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.index).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(' ');
  const areaPath =
    `${line} L${x(points[points.length - 1].index).toFixed(1)},${PAD.top + PLOT_H}` +
    ` L${x(points[0].index).toFixed(1)},${PAD.top + PLOT_H} Z`;

  // The one point worth calling out: the worst day for this metric.
  const worst = points.reduce((acc, p) =>
    (spec.lowerIsBetter ? p.value > acc.value : p.value < acc.value) ? p : acc,
  );
  const hovered = hover == null ? null : points.find((p) => p.index === hover) ?? null;
  const color = `var(${spec.colorVar})`;

  return (
    <section className="card chart-card">
      <div className="chart-head">
        <h2>{title}</h2>
        <span className="chart-sub">{subtitle}</span>
      </div>

      {switcher}
      <p className="muted metric-note">{spec.unitNote}</p>

      <div className="chart-wrap">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="chart-svg"
          role="img"
          aria-label={`${spec.label} per day. ${subtitle}. Values are also listed in the tables below.`}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.32" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
            <filter id={glowId} x="-20%" y="-60%" width="140%" height="260%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {axis.ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                className="chart-grid"
              />
              <text x={PAD.left - 10} y={y(t) + 4} className="chart-tick chart-tick-y">
                {spec.tick(t)}
              </text>
            </g>
          ))}

          {spec.target && spec.target.value >= axis.lo && spec.target.value <= axis.hi ? (
            <g>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(spec.target.value)}
                y2={y(spec.target.value)}
                className="chart-reference"
              />
              <text
                x={W - PAD.right}
                y={y(spec.target.value) - 7}
                className="chart-tick chart-reference-label"
              >
                {spec.target.label}
              </text>
            </g>
          ) : null}

          <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
          <path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            filter={`url(#${glowId})`}
            className="chart-trend"
          />

          <circle
            cx={x(worst.index)}
            cy={y(worst.value)}
            r="4.5"
            fill={color}
            stroke="var(--surface)"
            strokeWidth="2"
          />
          <text
            x={x(worst.index) - 8}
            y={y(worst.value) + 4}
            className="chart-tick chart-worst"
            textAnchor="end"
          >
            {spec.format(worst.value)}
          </text>

          {data.map((d, i) => (
            <text key={d.date} x={x(i)} y={H - 11} className="chart-tick chart-tick-x">
              {Number(d.date.slice(8, 10)) % 3 === 0 || d.date.slice(8, 10) === '01'
                ? Number(d.date.slice(8, 10))
                : ''}
            </text>
          ))}

          {hovered ? (
            <line
              x1={x(hovered.index)}
              x2={x(hovered.index)}
              y1={PAD.top}
              y2={PAD.top + PLOT_H}
              className="chart-crosshair"
            />
          ) : null}

          {/* Hit target is the whole column slot, not the line. */}
          {data.map((d, i) => (
            <rect
              key={d.date}
              x={PAD.left + slotW * i}
              y={PAD.top}
              width={slotW}
              height={PLOT_H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>

        {hovered ? (
          <div
            className="chart-tip"
            style={{ left: `${(x(hovered.index) / W) * 100}%` }}
            role="tooltip"
          >
            <strong>{formatDmy(hovered.day)}</strong>
            <span>
              <i className="swatch" style={{ background: color }} aria-hidden="true" />
              {spec.label}
              <b>{spec.format(hovered.value)}</b>
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
