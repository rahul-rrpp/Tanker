import Link from 'next/link';
import type { ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Logo } from '../ui/Logo';

const POINTS = [
  'Book oil tankers like a cab — pick locations on the map, get road distance instantly',
  'Name your freight price and compare offers from verified transporters',
  'Track trips, pay securely and download every document in one place',
];

/** Split-screen auth layout: brand panel on desktop, compact header on mobile. */
export function AuthShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(380px,_5fr)_7fr]">
      <aside className="relative hidden overflow-hidden bg-brand-950 p-10 text-white lg:flex lg:flex-col">
        <Link href="/login" aria-label="TankerLink home">
          <Logo inverted />
        </Link>
        <div className="relative z-10 mt-auto max-w-md">
          <h2 className="text-3xl font-bold leading-tight tracking-tight">Book a tanker. Negotiate freight. Track every load.</h2>
          <ul className="mt-8 space-y-4">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3 text-brand-100">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent-400" aria-hidden />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 mt-12 text-xs text-brand-300">© {new Date().getFullYear()} TankerLink · Oil Tanker Booking & Logistics Marketplace</p>
        {/* Road stripes */}
        <svg className="absolute -right-24 top-24 h-[520px] w-[520px] opacity-[0.08]" viewBox="0 0 200 200" aria-hidden>
          <circle cx="100" cy="100" r="98" fill="none" stroke="#fff" strokeWidth="2" />
          <circle cx="100" cy="100" r="70" fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="10 8" />
          <circle cx="100" cy="100" r="42" fill="none" stroke="#fff" strokeWidth="2" />
        </svg>
      </aside>

      <main className="flex flex-col">
        <header className="flex items-center justify-between border-b border-line bg-white px-5 py-4 lg:hidden">
          <Link href="/login" aria-label="TankerLink home">
            <Logo />
          </Link>
        </header>
        <div className="flex flex-1 items-start justify-center px-5 py-10 sm:items-center sm:px-8">
          <div className={wide ? 'w-full max-w-2xl' : 'w-full max-w-md'}>{children}</div>
        </div>
      </main>
    </div>
  );
}

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[1.75rem]">{title}</h1>
      {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
    </div>
  );
}
