import clsx from 'clsx';

/**
 * OnlyTanker brand artwork, shared with the mobile app and admin site
 * (brand/build-brand-assets.py → public/brand/*.png, from brand/onlytanker-logo.png).
 */

/** The orange location pin with the tanker. The pin fills the box height and 80% of its width. */
export function LogoMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/logo-mark.png" alt="" aria-hidden className={clsx('inline-block h-9 w-9 shrink-0 select-none object-contain', className)} draggable={false} />
  );
}

/** Pin plus the "OnlyTanker" wordmark (white lettering when `inverted`, for dark backgrounds). */
export function Logo({ inverted }: { inverted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark />
      <span className="leading-tight">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={inverted ? '/brand/wordmark-light.png' : '/brand/wordmark.png'} alt="OnlyTanker" className="block h-[22px] w-auto select-none" draggable={false} />
        <span className={clsx('mt-0.5 block text-[11px] font-medium uppercase tracking-wider', inverted ? 'text-brand-200' : 'text-muted')}>
          Oil tanker marketplace
        </span>
      </span>
    </span>
  );
}
