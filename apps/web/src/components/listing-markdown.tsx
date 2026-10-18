'use client';

import dynamic from 'next/dynamic';
import { createContext, useContext } from 'react';
import type { SafeBlock } from '@trenchmart/shared/markdown-tree';
import { MarkdownTree } from '@/components/markdown-tree';

/** Markdown the server already parsed for this page, keyed by its exact source text. */
export type ParsedMarkdown = Record<string, SafeBlock[]>;

export const ParsedMarkdownContext = createContext<ParsedMarkdown>({});

// The parser (micromark + GFM, ~26 KB gzip) loads only for text the server did not parse,
// such as version changelogs fetched after the page loads.
const LazyMarkdown = dynamic(() => import('@/components/markdown').then((m) => m.Markdown), {
  ssr: false,
  loading: () => <div className="skeleton h-16 w-full max-w-3xl" aria-hidden="true" />,
});

export function ListingMarkdown({
  source,
  className = '',
  links = true,
}: {
  source: string;
  className?: string;
  links?: boolean;
}) {
  const parsed = useContext(ParsedMarkdownContext);
  const tree = links ? parsed[source] : undefined;
  if (tree) return <MarkdownTree tree={tree} className={className} />;
  return <LazyMarkdown source={source} className={className} links={links} />;
}
