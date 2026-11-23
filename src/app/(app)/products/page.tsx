import type { Metadata } from 'next';
import { ProductsView } from './products-view';

export const metadata: Metadata = { title: 'المنتجات' };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <ProductsView newBarcode={sp.new ?? null} />;
}
