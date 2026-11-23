import type { Metadata } from 'next';
import { SortingView } from './sorting-view';

export const metadata: Metadata = { title: 'الفرز والمعالجة' };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <SortingView initialTab={sp.tab === 'red' ? 'red' : 'purple'} />;
}
