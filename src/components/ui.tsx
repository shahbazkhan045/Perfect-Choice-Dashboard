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
            ✓
          </button>
          <button
            type="button"
            className="reason-btn reason-btn-cancel"
            onClick={discard}
            disabled={disabled}
            title="Discard changes (Esc)"
            aria-label="Discard changes"
          >
            ✕
          </button>
        </div>
      ) : null}
    </div>
  );
}
