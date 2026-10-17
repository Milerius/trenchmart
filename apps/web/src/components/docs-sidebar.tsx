'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DOCS_NAV } from '@/lib/protocol-facts';

export function DocsSidebar() {
  const path = usePathname();
  return (
    <nav aria-label="Documentation" data-testid="docs-nav" className="lg:sticky lg:top-6">
      <ul className="m-0 flex gap-1 overflow-x-auto p-0 lg:flex-col">
        {DOCS_NAV.map((item) => {
          const current = path === item.href;
          return (
            <li key={item.href} className="list-none">
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={`block whitespace-nowrap rounded-ctl px-3 py-2 text-sm ${
                  current ? 'bg-surface text-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
