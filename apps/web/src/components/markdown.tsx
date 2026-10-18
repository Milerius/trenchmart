'use client';

import { createContext, Fragment, useContext, useMemo, type ReactNode } from 'react';
import { mediaIdOf, safeMarkdown, type SafeBlock, type SafeInline } from '@trenchmart/shared';

/**
 * Editor previews only: maps a media id to a local object URL for an image that is picked but
 * not uploaded yet. The src still has to pass isMediaUrl, so nothing else can load.
 */
export const MediaPreviewContext = createContext<Record<string, string>>({});

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
  return (
    <div data-testid="markdown" className={`md max-w-none space-y-4 text-ink-2 ${className}`}>
      {tree.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
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

const HEADING = [
  'text-[22px] font-semibold tracking-[-0.02em] text-ink',
  'text-[20px] font-semibold tracking-[-0.02em] text-ink',
  'text-[17px] font-semibold text-ink',
  'text-[15px] font-semibold text-ink',
  'text-sm font-semibold text-ink',
  'font-mono text-[11px] uppercase tracking-[0.04em] text-muted',
];

function Block({ block }: { block: SafeBlock }): ReactNode {
  switch (block.t) {
    case 'h': {
      // The page title is the only h1; README headings start one level below it.
      const level = Math.min(6, block.depth + 1);
      const Tag = `h${level}` as 'h2';
      return (
        <Tag className={`pt-2 leading-snug ${HEADING[block.depth - 1]}`}>
          <Inlines nodes={block.c} />
        </Tag>
      );
    }
    case 'p':
      return (
        <p className="leading-relaxed">
          <Inlines nodes={block.c} />
        </p>
      );
    case 'list': {
      const items = block.items.map((item, index) => (
        <li key={index} className={`leading-relaxed ${item.checked !== null ? 'list-none' : ''}`}>
          {item.checked !== null ? (
            <span
              aria-label={item.checked ? 'done' : 'not done'}
              className={`mr-2 inline-grid h-4 w-4 place-items-center rounded-[4px] border align-[-2px] font-mono text-[10px] ${item.checked ? 'border-accent bg-accent text-onaccent' : 'border-line-control'}`}
            >
              {item.checked ? '✓' : ''}
            </span>
          ) : null}
          <span className="inline [&>p]:inline">
            {item.c.map((child, key) => (
              <Block key={key} block={child} />
            ))}
          </span>
        </li>
      ));
      return block.ordered ? (
        <ol
          start={block.start}
          className="list-decimal space-y-1.5 pl-6 marker:font-mono marker:text-muted"
        >
          {items}
        </ol>
      ) : (
        <ul className="list-disc space-y-1.5 pl-6 marker:text-decor">{items}</ul>
      );
    }
    case 'pre':
      return (
        <pre className="overflow-auto rounded-card border border-line bg-inset p-4 font-mono text-xs leading-relaxed text-ink-2">
          {block.lang ? (
            <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.04em] text-muted">
              {block.lang}
            </span>
          ) : null}
          <code>{block.v}</code>
        </pre>
      );
    case 'quote':
      return (
        <blockquote className="space-y-3 border-l-2 border-accent-line pl-4 text-ink-2">
          {block.c.map((child, key) => (
            <Block key={key} block={child} />
          ))}
        </blockquote>
      );
    case 'hr':
      return <hr className="my-2 border-0 border-t border-line-soft" />;
    case 'table':
      return (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-inset text-left font-mono text-[11px] uppercase tracking-wide text-muted">
                {block.head.map((cell, index) => (
                  <th
                    key={index}
                    scope="col"
                    className="px-3 py-2 font-medium"
                    style={{ textAlign: block.align[index] ?? undefined }}
                  >
                    <Inlines nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-line-soft">
                  {row.map((cell, index) => (
                    <td
                      key={index}
                      className="px-3 py-2"
                      style={{ textAlign: block.align[index] ?? undefined }}
                    >
                      <Inlines nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function Inlines({ nodes }: { nodes: SafeInline[] }) {
  return (
    <>
      {nodes.map((node, index) => (
        <Fragment key={index}>
          <InlineNode node={node} />
        </Fragment>
      ))}
    </>
  );
}

function InlineNode({ node }: { node: SafeInline }): ReactNode {
  const previews = useContext(MediaPreviewContext);
  switch (node.t) {
    case 'text':
      return node.v;
    case 'br':
      return <br />;
    case 'code':
      return (
        <code className="rounded-tag border border-line bg-inset px-1.5 py-0.5 font-mono text-[0.85em] text-ink">
          {node.v}
        </code>
      );
    case 'strong':
      return (
        <strong className="font-semibold text-ink">
          <Inlines nodes={node.c} />
        </strong>
      );
    case 'em':
      return (
        <em>
          <Inlines nodes={node.c} />
        </em>
      );
    case 'del':
      return (
        <del className="text-muted">
          <Inlines nodes={node.c} />
        </del>
      );
    case 'link':
      return (
        <a
          href={node.href}
          className="text-accent underline-offset-4 hover:underline"
          {...(node.external ? { target: '_blank', rel: 'noopener noreferrer nofollow ugc' } : {})}
        >
          <Inlines nodes={node.c} />
          {node.external ? <span aria-hidden="true"> ↗</span> : null}
        </a>
      );
    case 'img':
      return (
        // Only our own media route reaches here (isMediaUrl); seller uploads are re-checked server side.
        <img
          src={previews[mediaIdOf(node.src) ?? ''] ?? node.src}
          alt={node.alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="my-1 block h-auto max-w-full rounded-card border border-line"
        />
      );
    case 'img-blocked':
      return (
        <span
          data-testid="md-image-blocked"
          className="inline-flex items-center gap-1 rounded-tag border border-warn-line bg-warn-bg px-2 py-0.5 font-mono text-[11px] text-warn"
        >
          External image removed{node.host ? ` (${node.host})` : ''}
        </span>
      );
  }
}
