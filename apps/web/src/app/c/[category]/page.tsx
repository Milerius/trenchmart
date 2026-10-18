import { CATEGORIES } from '@trenchmart/shared/categories';
import { CategoryView } from './category-view';

// The category pages are the same shell for every visitor (listings load client-side), so
// they are prerendered at build time instead of server-rendered on every request.
export function generateStaticParams(): { category: string }[] {
  return CATEGORIES.map((c) => ({ category: c.code }));
}

export default function CategoryPage() {
  return <CategoryView />;
}
