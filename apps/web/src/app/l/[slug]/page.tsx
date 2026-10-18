import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import { publicApi } from '@/lib/server-api';
import { ListingView, type Listing } from './listing-view';

type Props = { params: Promise<{ slug: string }> };

// ISR: a listing page is rendered on its first visit, then served from the incremental
// cache (Workers Cache API, see open-next.config.ts) and re-rendered in the background at most
// once a minute. The render only reads the public, cookie-less API, so nothing
// viewer-specific is ever in the cached HTML; ownership and wallet state load client-side.
export const revalidate = 60;
// No paths at build time: each page is rendered on its first request, then cached.
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return [];
}

// One read per request, shared by generateMetadata and the page.
const load = cache(async (slug: string) =>
  publicApi<Listing>(`/listings/${encodeURIComponent(slug)}`),
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { data } = await load(slug);
  if (!data) return { title: 'Listing · TrenchMart (Solana devnet)' };
  const title = `${data.title} · TrenchMart (Solana devnet)`;
  return {
    title,
    description: data.summary,
    alternates: { canonical: `/l/${data.slug}` },
    openGraph: { title, description: data.summary, url: `/l/${data.slug}`, type: 'website' },
    other: { 'solana:cluster': 'devnet' },
  };
}

export default async function ListingPage({ params }: Props) {
  const { slug } = await params;
  const { status, data } = await load(slug);
  if (status === 404) notFound();
  // /l/<listing id> resolves to the canonical slug URL.
  if (data && data.slug !== slug) permanentRedirect(`/l/${data.slug}`);
  // API unreachable: render the client view, which retries in the browser.
  return <ListingView initial={data} />;
}
