'use client';

import type { ReactNode } from 'react';

import { useEffect, useRef, useState } from 'react';
import type { FilterKey } from '@/lib/stats';
import { formatDmy } from '@/lib/parse';
import { AlertIcon, CheckIcon, CloseIcon, RefreshIcon } from '@/components/icons';

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------

export type Tone = 'plain' | 'good' | 'bad' | 'warn';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Counts a KPI's leading number up to its target when the value changes.
 * Purely cosmetic — the prefix (e.g. "AED "), the suffix (e.g. "%"), the
 * decimal places and the thousands grouping are all taken from the real
 * formatted string, so the number that lands is exactly `value`. Anything
 * without a number in it (e.g. "—") is passed straight through.
 */
function useCountUp(value: string): string {
  const [display, setDisplay] = useState(value);
  const rafRef = useRef<number | undefined>(undefined);
  const prevNumRef = useRef<number | null>(null);

  useEffect(() => {
    const match = value.match(/-?\d[\d,]*(\.\d+)?/);
    if (!match || prefersReducedMotion()) {
      setDisplay(value);
      prevNumRef.current = match ? parseFloat(match[0].replace(/,/g, '')) : null;
      return;
    }

    const target = parseFloat(match[0].replace(/,/g, ''));
    const decimals = match[1] ? match[1].length - 1 : 0;
    const grouped = match[0].includes(',');
    const from = prevNumRef.current ?? 0;

    if (from === target) {
      setDisplay(value);
      return;
    }

    const fmt = (n: number) =>
      n.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: grouped,
      });

    const start = performance.now();
    const duration = 650;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (target - from) * eased;
      setDisplay(value.replace(match[0], fmt(current)));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        prevNumRef.current = target;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value]);

  return display;
}

/**
 * A KPI's change since the previous period. Whether the change is GOOD is a
 * property of the metric, not of its sign — fewer absences is good, a lower
 * rating is not — so `lowerIsBetter` is required rather than guessed.
 */
export interface KpiDelta {
  /** Signed change: this period minus the one before it. */
  change: number;
  /** What it is measured against, e.g. "Oct" or "yesterday". */
  vs: string;
  lowerIsBetter: boolean;
  /** "pts" for a percentage-point move; omitted for a plain count. */
  suffix?: string;
  decimals?: number;
}

export function Kpi({
  label,
  value,
  unit,
  tone = 'plain',
  title,
  delta,
  footnote,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: Tone;
  /** Hover text for the whole tile — used to explain a value like "Not tracked". */
  title?: string;
  /** Change vs the previous period, shown under the value. */
  delta?: KpiDelta | null;
  /** A standing note under the value, e.g. "Target 0.35%". */
  footnote?: string;
  /**
   * A decorative glyph for the tile's corner. Purely a way to tell the
   * tiles apart at a glance in a row of six — the label is still the thing
   * that says what the number is, so this is always aria-hidden.
   */
  icon?: ReactNode;
}) {
  const shown = useCountUp(value);
  return (
    <div className="kpi" title={title}>
      <span className="kpi-head">
        {icon ? (
          <span className="kpi-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span className="kpi-label">{label}</span>
      </span>
      <span className={`kpi-value tone-${tone}`}>
        {shown}
        {unit ? <small>{unit}</small> : null}
      </span>
      {delta ? <KpiDeltaLine {...delta} /> : null}
      {footnote ? <span className="kpi-footnote">{footnote}</span> : null}
    </div>
  );
}

function KpiDeltaLine({ change, vs, lowerIsBetter, suffix, decimals = 0 }: KpiDelta) {
  if (!isFinite(change)) return null;

  const magnitude = Math.abs(change).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const unchanged = Math.abs(change) < Math.pow(10, -decimals) / 2;
  const better = lowerIsBetter ? change < 0 : change > 0;
  const tone = unchanged ? 'flat' : better ? 'good' : 'bad';
  const arrow = unchanged ? '→' : change > 0 ? '▲' : '▼';
  const text = unchanged ? 'no change' : `${magnitude}${suffix ? ` ${suffix}` : ''}`;

  return (
    <span className={`kpi-delta kpi-delta-${tone}`}>
      <span aria-hidden="true">{arrow}</span> {text} vs {vs}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Refresh button — spins its icon briefly on click. Cosmetic only; the
// actual refresh is whatever `onRefresh` does.
// ---------------------------------------------------------------------------

export function RefreshButton({ onRefresh }: { onRefresh: () => void }) {
  const [spinning, setSpinning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <button
      type="button"
      className="btn btn-refresh"
      onClick={() => {
        onRefresh();
        setSpinning(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setSpinning(false), 700);
      }}
    >
      <span className={`refresh-icon${spinning ? ' is-spinning' : ''}`} aria-hidden="true">
        <RefreshIcon size={16} />
      </span>
      Refresh
    </button>
  );
}

// ---------------------------------------------------------------------------
// Filter pills
// ---------------------------------------------------------------------------

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'pending', label: 'Pending' },
  { key: 'updated', label: 'Updated' },
  { key: 'mtd', label: 'Month to date' },
];

export function Filters({
  value,
  counts,
  onChange,
  extraTabs,
}: {
  value: FilterKey;
  counts: Partial<Record<FilterKey, number>>;
  onChange: (f: FilterKey) => void;
  /** Additional tabs appended after the standard four — e.g. Cash's "Finance comments". */
  extraTabs?: { key: FilterKey; label: string }[];
}) {
  const tabs = extraTabs?.length ? [...FILTERS, ...extraTabs] : FILTERS;
  return (
    <div className="filters" role="tablist" aria-label="Date filter">
      {tabs.map((f) => (
        <button
          key={f.key}
          type="button"
          role="tab"
          aria-selected={value === f.key}
          className={`filter${value === f.key ? ' is-active' : ''}`}
          onClick={() => onChange(f.key)}
        >
          {f.label}
          <span className="filter-count">{counts[f.key] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fallback banner
// ---------------------------------------------------------------------------

export function FallbackBanner({ from, to }: { from: string; to: string }) {
  return (
    <div className="banner" role="status">
      No data yet for <b>{formatDmy(from)}</b>. Showing the most recent day in the sheet,{' '}
      <b>{formatDmy(to)}</b>.
    </div>
  );
}

export function EmptyBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="banner banner-quiet" role="status">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ageing badge
// ---------------------------------------------------------------------------

export function AgeBadge({ days }: { days: number }) {
  if (days < 1) return null;
  const level = days >= 3 ? 'crit' : days >= 2 ? 'warn' : 'soft';
  return (
    <span className={`age age-${level}`} title="How long this row has been waiting for an update">
      {days} day{days === 1 ? '' : 's'} overdue
    </span>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

export interface ToastMessage {
  id: number;
  text: string;
  kind: 'ok' | 'err';
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const seq = useRef(0);

  function push(text: string, kind: 'ok' | 'err' = 'ok') {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 3200);
  }

  return { toasts, push };
}

export function Toaster({ toasts }: { toasts: ToastMessage[] }) {
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.kind === 'ok' ? <CheckIcon size={16} /> : <AlertIcon size={16} />}
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div
        className={`modal${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text area used for every free-text reason field. Saves ONLY on explicit
// submit — never while typing, never on blur, never on a timer. Typing used
// to autosave on a debounce, which meant any natural pause mid-sentence
// fired a save and re-rendered the row out from under the typist. Now
// nothing reaches the server until the checkmark is clicked.
// ---------------------------------------------------------------------------

export function ReasonField({
  value,
  placeholder,
  disabled,
  onSave,
}: {
  value: string;
  placeholder: string;
  disabled?: boolean;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const dirty = draft !== value;

  // Adopt server-side changes only while there is nothing unsaved locally —
  // an in-progress, not-yet-submitted edit is never overwritten.
  useEffect(() => {
    if (!dirty) setDraft(value);
    // dirty is derived from draft itself; including it would re-run this on
    // every keystroke and fight the very thing it's meant to protect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function submit() {
    if (!dirty || disabled) return;
    onSave(draft);
  }

  function discard() {
    setDraft(value);
  }

  return (
    <div className="reason-editor">
      <textarea
        className="reason-input"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && dirty) {
            e.preventDefault();
            discard();
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {dirty ? (
        <div className="reason-actions">
          <span className="reason-unsaved">Unsaved</span>
          <button
            type="button"
            className="reason-btn reason-btn-save"
            onClick={submit}
            disabled={disabled}
            title="Save (Ctrl+Enter)"
            aria-label="Save reason"
          >
            <CheckIcon size={16} />
          </button>
          <button
            type="button"
            className="reason-btn reason-btn-cancel"
            onClick={discard}
            disabled={disabled}
            title="Discard changes (Esc)"
            aria-label="Discard changes"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
