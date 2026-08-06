'use client';

import { useEffect, useRef, useState } from 'react';
import type { FilterKey } from '@/lib/stats';
import { formatDmy } from '@/lib/parse';

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------

export type Tone = 'plain' | 'good' | 'bad' | 'warn';

export function Kpi({
  label,
  value,
  unit,
  tone = 'plain',
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: Tone;
}) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value tone-${tone}`}>
        {value}
        {unit ? <small>{unit}</small> : null}
      </span>
    </div>
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
}: {
  value: FilterKey;
  counts: Record<FilterKey, number>;
  onChange: (f: FilterKey) => void;
}) {
  return (
    <div className="filters" role="tablist" aria-label="Date filter">
      {FILTERS.map((f) => (
        <button
          key={f.key}
          type="button"
          role="tab"
          aria-selected={value === f.key}
          className={`filter${value === f.key ? ' is-active' : ''}`}
          onClick={() => onChange(f.key)}
        >
          {f.label}
          <span className="filter-count">{counts[f.key]}</span>
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
          <span aria-hidden="true">{t.kind === 'ok' ? '✓' : '⚠'}</span>
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
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Debounced text area used for every free-text reason field
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
  const dirty = useRef(false);

  // Adopt server-side changes, but never clobber what someone is mid-way typing.
  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => {
      dirty.current = false;
      if (draft !== value) onSave(draft);
    }, 900);
    return () => clearTimeout(t);
    // onSave is stable per row; value is the last committed server state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return (
    <textarea
      className="reason-input"
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      rows={2}
      onChange={(e) => {
        dirty.current = true;
        setDraft(e.target.value);
      }}
      onBlur={() => {
        if (!dirty.current) return;
        dirty.current = false;
        if (draft !== value) onSave(draft);
      }}
    />
  );
}
