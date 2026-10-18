'use client';

import { useMemo } from 'react';
import { safeMarkdown, type SafeBlock, type SafeInline } from '@trenchmart/shared/markdown';
import { MarkdownTree } from '@/components/markdown-tree';

export { MarkdownTree, MediaPreviewContext } from '@/components/markdown-tree';

/**
 * Renders listing Markdown from the sanitized tree in @trenchmart/shared. Everything is a
 * React element: no innerHTML, raw HTML shows as text, unsafe links lose their href and
 * images only load from our media route.
 */
export function Markdown({
  source,
  className = '',
  links = true,
}: {
  source: string;
  className?: string;
  /** False for text that skipped the content review (version changelogs): links show as plain text. */
  links?: boolean;
}) {
  const tree = useMemo(() => {
    const parsed = safeMarkdown(source);
    return links ? parsed : parsed.map(unlinkBlock);
  }, [source, links]);
  return <MarkdownTree tree={tree} className={className} />;
}

function unlinkInline(node: SafeInline): SafeInline[] {
  if (node.t === 'link') return node.c.flatMap(unlinkInline);
  if (node.t === 'strong' || node.t === 'em' || node.t === 'del') {
    return [{ ...node, c: node.c.flatMap(unlinkInline) }];
  }
  return [node];
}

function unlinkBlock(block: SafeBlock): SafeBlock {
  switch (block.t) {
    case 'h':
    case 'p':
      return { ...block, c: block.c.flatMap(unlinkInline) };
    case 'quote':
      return { ...block, c: block.c.map(unlinkBlock) };
    case 'list':
      return {
        ...block,
        items: block.items.map((item) => ({ ...item, c: item.c.map(unlinkBlock) })),
      };
    case 'table':
      return {
        ...block,
        head: block.head.map((cell) => cell.flatMap(unlinkInline)),
        rows: block.rows.map((row) => row.map((cell) => cell.flatMap(unlinkInline))),
      };
    default:
      return block;
  }
}
