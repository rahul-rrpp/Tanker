'use client';

import { FlaskConical } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Catalog } from '@/lib/company-types';
import { useApi } from '@/lib/useApi';

/**
 * Clearly separated demo simulator controls. Rendered only when the backend runs with DEMO_MODE=true.
 * They stand in for the Transporter / Driver / Admin portals that come in later phases.
 */
export function DemoPanel({ title, children }: { title: string; children: ReactNode }) {
  const { data } = useApi<Catalog>('/catalog', { revalidateOnFocus: false });
  if (!data?.demoMode) return null;
  return (
    <div className="rounded-2xl border border-dashed border-fuchsia-300 bg-fuchsia-50/60 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-fuchsia-800">
        <FlaskConical className="h-4 w-4" aria-hidden /> Demo simulator · {title}
      </p>
      <p className="mt-1 text-xs text-fuchsia-800/80">Stands in for the upcoming Transporter &amp; Driver portals. Everything it creates is labelled DEMO and is not a real transaction.</p>
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function DemoButton({ onClick, children, loading, disabled }: { onClick: () => void; children: ReactNode; loading?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-300 bg-white px-3 py-1.5 text-xs font-semibold text-fuchsia-800 hover:bg-fuchsia-100 disabled:opacity-50"
    >
      {loading ? 'Working…' : children}
    </button>
  );
}
