import clsx from 'clsx';

/** The OnlyTanker pin (same artwork as the mobile app and main site: brand/build-brand-assets.py). */
export function BrandMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/logo-mark.png" alt="" aria-hidden className={clsx('inline-block h-9 w-9 shrink-0 select-none object-contain', className)} draggable={false} />
  );
}
