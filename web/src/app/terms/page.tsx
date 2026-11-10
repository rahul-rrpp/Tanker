import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/AuthShell';

export const metadata: Metadata = { title: 'Terms and Conditions' };

export default function TermsPage() {
  return (
    <AuthShell wide>
      <article className="space-y-4 text-sm leading-relaxed text-muted">
        <h1 className="text-2xl font-bold text-ink">Terms and Conditions</h1>
        <p>
          This page is a placeholder for your organisation&apos;s legal Terms and Conditions and Privacy Policy. Replace this
          content with text approved by your legal team before going live.
        </p>
      </article>
    </AuthShell>
  );
}
