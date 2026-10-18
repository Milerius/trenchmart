import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import { publicApi } from '@/lib/server-api';
import { ListingView, type Listing } from './listing-view';

type Props = { params: Promise<{ slug: string }> };

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
