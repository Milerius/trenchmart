import type { MetadataRoute } from 'next';
import { CATEGORY_CODES } from '@trenchmart/shared/config';
import { publicApi } from '@/lib/server-api';

const SITE = 'https://trenchmart.fun';
const STATIC = [
  '/',
  '/search',
  '/sell',
  '/token',
  '/creators',
  '/verify',
  '/docs',
  '/docs/buyers',
  '/docs/sellers',
  '/docs/escrow',
  '/docs/security',
  '/docs/faq',
  '/docs/fees',
  '/docs/token',
  '/docs/treasury',
  '/terms',
  '/privacy',
  '/status',
];

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data } = await publicApi<{ slug: string; updatedAt?: string }[]>(
    '/listings?limit=48&sort=new',
    3600,
  );
  const listings = (Array.isArray(data) ? data : []).map((listing) => ({
    url: `${SITE}/l/${listing.slug}`,
    changeFrequency: 'daily' as const,
    priority: 0.8,
  }));
  return [
    ...STATIC.map((path) => ({ url: `${SITE}${path}`, changeFrequency: 'weekly' as const })),
    ...CATEGORY_CODES.map((code) => ({
      url: `${SITE}/c/${code}`,
      changeFrequency: 'daily' as const,
    })),
    ...listings,
  ];
}
