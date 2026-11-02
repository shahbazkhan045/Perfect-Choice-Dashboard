/**
 * The targets the team is actually held to, and the thresholds the tables
 * flag against. They live here, named, rather than as bare numbers scattered
 * through the components — so "why is this row red?" has one answer, and
 * changing a target is a one-line edit.
 *
 * Nothing here changes how a figure is CALCULATED; these only decide how a
 * figure already computed elsewhere is coloured and labelled.
 */

/** Cancellation & release rate. Lower is better. */
export const CANX_PCT_TARGET = 0.35;

/** Absent BD rate. Lower is better. */
export const ABSENT_BD_PCT_TARGET = 3.0;

/** On time rate. Higher is better. */
export const ON_TIME_PCT_TARGET = 90;

/** Average customer rating, out of 5. Higher is better. */
export const RATING_TARGET = 4.7;

/** A cleaner or van at or above this many Absent BD in a month is flagged. */
export const ABSENT_MONTH_FLAG = 2;

/** The same, per week. */
export const ABSENT_WEEK_FLAG = 1;

/** Cancellations in a month at or above this are flagged. */
export const CANX_MONTH_FLAG = 2;

export type TargetTone = 'good' | 'warn' | 'bad';

/**
 * How a value scores against its target. "warn" is the near-miss band:
 * within 10% of the target on the wrong side, so a figure that is drifting
 * reads differently from one that has clearly gone.
 */
export function targetTone(
  value: number | null,
  target: number,
  higherIsBetter: boolean,
): TargetTone | null {
  if (value == null || !isFinite(value)) return null;
  const met = higherIsBetter ? value >= target : value <= target;
  if (met) return 'good';
  const slack = Math.abs(target) * 0.1;
  const near = higherIsBetter ? value >= target - slack : value <= target + slack;
  return near ? 'warn' : 'bad';
}

/** "Target 0.35%" — the sub-label under a percentage KPI. */
export function targetLabel(target: number, suffix = '%'): string {
  return `Target ${target}${suffix}`;
}
