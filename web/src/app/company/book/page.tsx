import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingBlock } from '@/components/ui/kit';
import { BookingWizard } from './BookingWizard';

export const metadata: Metadata = { title: 'Book a Tanker' };

export default function BookPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} />}>
      <BookingWizard />
    </Suspense>
  );
}
