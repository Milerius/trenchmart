import { ButtonLink, EmptyState } from '@/components/ui';

export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      body="The listing may have been delisted, or the link is wrong."
      action={<ButtonLink href="/search">Browse the market</ButtonLink>}
    />
  );
}
