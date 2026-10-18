import { publicApi } from '@/lib/server-api';
import { ProfileView, type PublicProfile } from './profile-view';

type Props = { params: Promise<{ handle: string }> };

// ISR like the listing page: the public profile is in the first HTML (no skeleton, no
// layout shift), cached for a minute. The read is cookie-less, so viewer-only fields
// (isOwner, buyer-only contacts) are never in the cached HTML; the client view refetches
// with the visitor's session and fills them in.
export const revalidate = 60;
// No paths at build time: each page is rendered on its first request, then cached.
export async function generateStaticParams(): Promise<{ handle: string }[]> {
  return [];
}

export default async function CreatorPage({ params }: Props) {
  const { handle } = await params;
  const { data } = await publicApi<PublicProfile>(`/creators/${encodeURIComponent(handle)}`);
  // Keyed by handle so moving between profiles never shows the previous one.
  return <ProfileView key={handle} initial={data} />;
}
