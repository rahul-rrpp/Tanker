import { FlaskConical } from 'lucide-react';

/**
 * DEVELOPMENT ONLY. Shown when the backend runs the mock OTP provider with OTP_DEV_ECHO=true
 * (the backend refuses that configuration in production, so no code is ever returned there).
 */
export function DevOtpHint({ code }: { code?: string }) {
  if (!code) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-fuchsia-300 bg-fuchsia-50 px-3 py-2 text-xs text-fuchsia-800" role="note">
      <FlaskConical className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        Development OTP simulation — code: <strong className="font-mono text-sm tracking-widest">{code}</strong> (no SMS/email is sent)
      </span>
    </div>
  );
}
