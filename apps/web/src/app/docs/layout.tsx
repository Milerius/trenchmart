import type { ReactNode } from 'react';
import { DocsSidebar } from '@/components/docs-sidebar';

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
      <DocsSidebar />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
