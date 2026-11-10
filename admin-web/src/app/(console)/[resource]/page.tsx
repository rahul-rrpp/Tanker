'use client';

import { notFound, useParams } from 'next/navigation';
import { PageView } from '@/components/Sections';
import { PAGES } from '@/config/pages';

export default function ResourcePage() {
  const { resource } = useParams<{ resource: string }>();
  const page = PAGES[resource];
  if (!page) notFound();
  return <PageView page={page} />;
}
