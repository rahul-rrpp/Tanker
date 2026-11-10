import clsx from 'clsx';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={clsx('h-9 w-9', className)} aria-hidden>
      <rect width="40" height="40" rx="10" fill="#2563eb" />
      <rect x="7" y="13" width="18" height="11" rx="5.5" fill="#fff" />
      <path d="M25 16h4.5l3.5 4v4H25z" fill="#fbbf24" />
      <circle cx="13" cy="27" r="3" fill="#fff" stroke="#2563eb" strokeWidth="1.5" />
      <circle cx="28" cy="27" r="3" fill="#fff" stroke="#2563eb" strokeWidth="1.5" />
    </svg>
  );
}

export function Logo({ inverted }: { inverted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      <span className="leading-tight">
        <span className={clsx('block text-base font-bold tracking-tight', inverted ? 'text-white' : 'text-ink')}>TankerLink</span>
        <span className={clsx('block text-[11px] font-medium uppercase tracking-wider', inverted ? 'text-brand-200' : 'text-muted')}>
          Oil tanker marketplace
        </span>
      </span>
    </span>
  );
}
