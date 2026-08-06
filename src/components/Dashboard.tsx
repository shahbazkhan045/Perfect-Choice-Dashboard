'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AnyRow, CanxRow, CashRow, DashboardData, Role, Section } from '@/lib/types';
import { type FilterKey } from '@/lib/stats';
import { Toaster, useToast } from '@/components/ui';
import CashSection from '@/components/CashSection';
import CanxSection from '@/components/CanxSection';
import ReminderModal from '@/components/ReminderModal';

const NAME_KEY = 'pcd-actor-name';
const THEME_KEY = 'pcd-theme';

/**
 * Declared as a type alias, not an interface: only aliases get an implicit
 * index signature, which is what lets this be passed where a
 * `Record<string, unknown>` is expected.
 */
export type EntryPatch = {
  status?: string;
  ticket?: string;
  reason?: string;
  screenshot?: string;
};

export interface SectionProps {
  data: DashboardData;
  filter: FilterKey;
  setFilter: (f: FilterKey) => void;
  search: string;
  setSearch: (s: string) => void;
  savingKeys: Set<string>;
  onPatch: (section: Section, key: string, patch: EntryPatch) => void;
  onUpload: (section: Section, key: string, file: File) => void;
  money: (n: number) => string;
}

export default function Dashboard({ role, roleLabel }: { role: Role; roleLabel: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>('CASH');
  const [filters, setFilters] = useState<Record<Section, FilterKey>>({
    CASH: 'yesterday',
    CANX: 'yesterday',
  });
  const [search, setSearch] = useState<Record<Section, string>>({ CASH: '', CANX: '' });
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const [actorName, setActorName] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [showReminder, setShowReminder] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  const { toasts, push } = useToast();

  const canEdit = role === 'JUSTLIFE_ADMIN' || role === 'PC_ADMIN';
  const canRemind = role === 'JUSTLIFE_ADMIN';

  // ---- boot ----
  useEffect(() => {
    try {
      setActorName(localStorage.getItem(NAME_KEY) || '');
      const t = localStorage.getItem(THEME_KEY);
      if (t === 'dark' || t === 'light') setTheme(t);
    } catch {
      /* storage can be blocked; the dashboard still works */
    }
  }, []);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const res = await fetch('/api/data', { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not load the sheet.');
        setData(json as DashboardData);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // ---- theme ----
  function toggleTheme() {
    const prefersDark =
      typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const current = theme ?? (prefersDark ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
  }

  // ---- name ----
  function saveName(name: string) {
    const trimmed = name.trim().slice(0, 60);
    setActorName(trimmed);
    try {
      localStorage.setItem(NAME_KEY, trimmed);
    } catch {
      /* ignore */
    }
  }

  // ---- money ----
  const money = useCallback(
    (n: number) => {
      const code = data?.currency || 'AED';
      return `${code} ${n.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    },
    [data?.currency],
  );

  // ---- saving ----
  const markSaving = useCallback((key: string, on: boolean) => {
    setSavingKeys((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  /**
   * Merges fields into one row. Written as two branches rather than one shared
   * `list` because `CashRow[] | CanxRow[]` has no callable `.map` signature.
   */
  const applyLocal = useCallback(
    (sectionKey: Section, key: string, patch: Record<string, unknown>) => {
      setData((prev) => {
        if (!prev) return prev;
        if (sectionKey === 'CASH') {
          return {
            ...prev,
            cash: prev.cash.map((r) => (r.key === key ? ({ ...r, ...patch } as CashRow) : r)),
          };
        }
        return {
          ...prev,
          canx: prev.canx.map((r) => (r.key === key ? ({ ...r, ...patch } as CanxRow) : r)),
        };
      });
    },
    [],
  );

  const onPatch = useCallback(
    async (sectionKey: Section, key: string, patch: EntryPatch) => {
      // Snapshot just this row — reverting the whole dataset on one failure
      // would silently undo other edits that are still in flight.
      const source: AnyRow[] = sectionKey === 'CASH' ? (data?.cash ?? []) : (data?.canx ?? []);
      const before = source.find((r) => r.key === key);

      // Collected cash has nothing to explain — clear the dependent fields too.
      const effective: EntryPatch =
        sectionKey === 'CASH' && patch.status === 'Collected'
          ? { ...patch, ticket: '', reason: '' }
          : patch;

      applyLocal(sectionKey, key, effective);
      markSaving(key, true);

      try {
        const res = await fetch('/api/entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ section: sectionKey, key, ...effective, actorName }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Save failed.');

        // Adopt the server's version, including its Updated By / Updated At.
        applyLocal(sectionKey, key, json.entry as Record<string, unknown>);
        push('Saved to the sheet');
      } catch (err) {
        if (before) applyLocal(sectionKey, key, before as unknown as Record<string, unknown>);
        push(err instanceof Error ? err.message : 'Save failed.', 'err');
      } finally {
        markSaving(key, false);
      }
    },
    [actorName, applyLocal, data, markSaving, push],
  );

  const onUpload = useCallback(
    async (sectionKey: Section, key: string, file: File) => {
      markSaving(key, true);
      try {
        const form = new FormData();
        form.append('file', file);
        form.append('section', sectionKey);
        form.append('key', key);
        form.append('actorName', actorName);

        const res = await fetch('/api/upload', { method: 'POST', body: form });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Upload failed.');

        applyLocal(sectionKey, key, { screenshot: json.url });
        push('Screenshot attached');
      } catch (err) {
        push(err instanceof Error ? err.message : 'Upload failed.', 'err');
      } finally {
        markSaving(key, false);
      }
    },
    [actorName, applyLocal, markSaving, push],
  );

  // ---- header counts ----
  const counts = useMemo(() => {
    if (!data) return { CASH: 0, CANX: 0 };
    return {
      CASH: data.cash.filter((r) => !r.status).length,
      CANX: data.canx.filter((r) => !r.reason.trim()).length,
    };
  }, [data]);

  const sectionProps = (s: Section): SectionProps | null =>
    data
      ? {
          data,
          filter: filters[s],
          setFilter: (f) => setFilters((prev) => ({ ...prev, [s]: f })),
          search: search[s],
          setSearch: (v) => setSearch((prev) => ({ ...prev, [s]: v })),
          savingKeys,
          onPatch,
          onUpload,
          money,
        }
      : null;

  const cashProps = sectionProps('CASH');
  const canxProps = sectionProps('CANX');

  return (
    <>
      <Toaster toasts={toasts} />

      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              J
            </span>
            <span className="brand-text">
              <b>Justlife</b>
              <span className="brand-x" aria-hidden="true">
                ×
              </span>
              <b className="brand-pc">Perfect Choice</b>
            </span>
            <span className="brand-chip">Perfect Choice</span>
          </div>

          <div className="topbar-right">
            <div className="sync">
              <span className="sync-day">
                {data ? `Yesterday · ${dmy(data.yesterday)}` : 'Loading…'}
              </span>
              <span className="sync-at">{data ? `Synced ${data.syncedAt}` : ''}</span>
            </div>
            <span className="role-chip" title="Your access level">
              {roleLabel}
            </span>
            <button
              type="button"
              className="icon-btn"
              onClick={toggleTheme}
              title="Switch light / dark"
              aria-label="Switch light or dark theme"
            >
              🌙
            </button>
          </div>
        </div>

        <nav className="sections" role="tablist" aria-label="Report sections">
          <button
            type="button"
            role="tab"
            aria-selected={section === 'CASH'}
            className={`section-tab${section === 'CASH' ? ' is-active' : ''}`}
            onClick={() => setSection('CASH')}
          >
            <span aria-hidden="true">💵</span> Cash collection
            <span className="count-badge">{counts.CASH}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === 'CANX'}
            className={`section-tab${section === 'CANX' ? ' is-active' : ''}`}
            onClick={() => setSection('CANX')}
          >
            <span aria-hidden="true">🚫</span> Cancellations &amp; releases
            <span className="count-badge">{counts.CANX}</span>
          </button>
        </nav>
      </header>

      <main className="page">
        {canEdit && !actorName ? (
          <form
            className="name-bar"
            onSubmit={(e) => {
              e.preventDefault();
              if (nameDraft.trim()) {
                saveName(nameDraft);
                push('Thanks — your updates will be signed with your name');
              }
            }}
          >
            <span>
              👋 Add your name so every update is attributed to you in the sheet.
            </span>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="Your name"
              aria-label="Your name"
              maxLength={60}
            />
            <button type="submit" className="btn btn-primary">
              Save
            </button>
          </form>
        ) : null}

        {error ? (
          <div className="error-card" role="alert">
            <b>Could not load the dashboard.</b>
            <p>{error}</p>
            <button type="button" className="btn" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : null}

        {loading && !data ? <SkeletonPanel /> : null}

        {cashProps && canxProps ? (
          <>
            <div hidden={section !== 'CASH'}>
              <CashSection
                {...cashProps}
                canEdit={canEdit}
                canRemind={canRemind}
                onRefresh={() => void load(true)}
                onRemind={() => setShowReminder(true)}
              />
            </div>
            <div hidden={section !== 'CANX'}>
              <CanxSection {...canxProps} canEdit={canEdit} onRefresh={() => void load(true)} />
            </div>
          </>
        ) : null}

        <footer className="page-foot">
          <span>Justlife × Perfect Choice — daily confirmation</span>
          {canEdit && actorName ? (
            <button
              type="button"
              className="linkish"
              onClick={() => {
                const next = window.prompt('Your name', actorName);
                if (next !== null) saveName(next);
              }}
            >
              Updating as <b>{actorName}</b> · change
            </button>
          ) : null}
        </footer>
      </main>

      {showReminder ? (
        <ReminderModal
          onClose={() => setShowReminder(false)}
          onSent={(msg) => {
            push(msg);
            setShowReminder(false);
          }}
          onError={(msg) => push(msg, 'err')}
        />
      ) : null}
    </>
  );
}

function SkeletonPanel() {
  return (
    <div className="skeleton-wrap" aria-hidden="true">
      <div className="kpi-row">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="kpi skeleton" />
        ))}
      </div>
      <div className="card skeleton skeleton-table" />
    </div>
  );
}

function dmy(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
