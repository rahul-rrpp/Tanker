'use client';

import { notFound, useParams } from 'next/navigation';
import { DetailView } from '@/components/DetailView';
import { PAGES } from '@/config/pages';

export default function ResourceDetailPage() {
  const { resource, id } = useParams<{ resource: string; id: string }>();
  const page = PAGES[resource];
  if (!page?.detail) notFound();
  return <DetailView def={page.detail} id={id} back={{ href: `/${resource}`, label: page.backLabel ?? page.title }} />;
}
