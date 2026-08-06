'use client';

import { useMemo, useState } from 'react';
import { formatDmy } from '@/lib/parse';

export interface ChartSeries {
  id: string;
  label: string;
  /** CSS custom property name holding the colour, e.g. '--viz-collected'. */
  colorVar: string;
}

export interface DayDatum {
  date: string; // yyyy-MM-dd
  values: Record<string, number>;
}

interface Props {
  title: string;
  subtitle: string;
  series: ChartSeries[];
  data: DayDatum[];
  /** Formats a stack total / tooltip figure. */
  format: (n: number) => string;
  emptyLabel: string;
}

const W = 760;
const H = 230;
const PAD = { top: 16, right: 14, bottom: 34, left: 66 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const SEG_GAP = 2; // surface-coloured gap between stacked segments
const CORNER = 4;

/**
 * Stacked daily columns on a single value axis.
 *
 * Deliberately one axis only: mixing a second measure on a second scale is the
 * classic way to make two unrelated shapes look correlated. Cash and
 * cancellations therefore get their own chart rather than sharing one.
 */
export default function DayBarChart({
  title,
  subtitle,
  series,
  data,
  format,
  emptyLabel,
}: Props) {
  const [hover, setHover] = useState<{ index: number; x: number } | null>(null);

  const { max, ticks } = useMemo(() => {
    const totals = data.map((d) => series.reduce((s, se) => s + (d.values[se.id] || 0), 0));
    const peak = Math.max(1, ...totals);
    const step = niceStep(peak / 4);
    const top = Math.ceil(peak / step) * step;
    const t: number[] = [];
    for (let v = 0; v <= top + 1e-9; v += step) t.push(v);
    return { max: top, ticks: t };
  }, [data, series]);

  if (!data.length) {
    return (
      <section className="card chart-card">
        <ChartHead title={title} subtitle={subtitle} />
        <p className="chart-empty">{emptyLabel}</p>
      </section>
    );
  }

  const slotW = PLOT_W / data.length;
  const barW = Math.min(38, Math.max(8, slotW * 0.56));

  const hovered = hover ? data[hover.index] : null;
  const hoveredTotal = hovered
    ? series.reduce((s, se) => s + (hovered.values[se.id] || 0), 0)
    : 0;

  return (
    <section className="card chart-card">
      <ChartHead title={title} subtitle={subtitle} />

      <ul className="chart-legend">
        {series.map((s) => (
          <li key={s.id}>
            <i className="swatch" style={{ background: `var(${s.colorVar})` }} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>

      <div className="chart-wrap">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="chart-svg"
          role="img"
          aria-label={`${title}. ${subtitle}. Values are also listed in the table below.`}
          onMouseLeave={() => setHover(null)}
        >
          {/* gridlines + value axis */}
          {ticks.map((t) => {
            const y = PAD.top + PLOT_H - (t / max) * PLOT_H;
            return (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} className="chart-grid" />
                <text x={PAD.left - 10} y={y + 4} className="chart-tick chart-tick-y">
                  {format(t)}
                </text>
              </g>
            );
          })}

          {data.map((d, i) => {
            const cx = PAD.left + slotW * i + slotW / 2;
            let cursorY = PAD.top + PLOT_H;

            // Top-most non-empty segment gets the rounded data-end.
            const lastFilled = [...series]
              .map((s, si) => ({ si, v: d.values[s.id] || 0 }))
              .filter((x) => x.v > 0)
              .pop()?.si;

            return (
              <g key={d.date}>
                {series.map((s, si) => {
                  const v = d.values[s.id] || 0;
                  if (v <= 0) return null;
                  const rawH = (v / max) * PLOT_H;
                  const h = Math.max(2, rawH - SEG_GAP);
                  const y = cursorY - rawH;
                  cursorY -= rawH;
                  const rounded = si === lastFilled;
                  return (
                    <rect
                      key={s.id}
                      x={cx - barW / 2}
                      y={y}
                      width={barW}
                      height={h}
                      rx={rounded ? CORNER : 0}
                      fill={`var(${s.colorVar})`}
                      className="chart-bar"
                    />
                  );
                })}

                <text x={cx} y={H - 12} className="chart-tick chart-tick-x">
                  {Number(d.date.slice(8, 10))}
                </text>

                {/* Hit target is the whole column slot, not the bar. */}
                <rect
                  x={PAD.left + slotW * i}
                  y={PAD.top}
                  width={slotW}
                  height={PLOT_H}
                  fill="transparent"
                  onMouseEnter={() => setHover({ index: i, x: cx })}
                />
              </g>
            );
          })}

          {hover ? (
            <line
              x1={hover.x}
              x2={hover.x}
              y1={PAD.top}
              y2={PAD.top + PLOT_H}
              className="chart-crosshair"
            />
          ) : null}
        </svg>

        {hovered ? (
          <div
            className="chart-tip"
            style={{ left: `${(hover!.x / W) * 100}%` }}
            role="tooltip"
          >
            <strong>{formatDmy(hovered.date)}</strong>
            {series.map((s) => (
              <span key={s.id}>
                <i className="swatch" style={{ background: `var(${s.colorVar})` }} aria-hidden="true" />
                {s.label}
                <b>{format(hovered.values[s.id] || 0)}</b>
              </span>
            ))}
            <span className="chart-tip-total">
              Total<b>{format(hoveredTotal)}</b>
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ChartHead({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="chart-head">
      <h2>{title}</h2>
      <span className="chart-sub">{subtitle}</span>
    </div>
  );
}

/** Rounds an axis step up to a 1 / 2 / 5 × 10ⁿ value so ticks read cleanly. */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  if (norm <= 1) return mag;
  if (norm <= 2) return 2 * mag;
  if (norm <= 5) return 5 * mag;
  return 10 * mag;
}
