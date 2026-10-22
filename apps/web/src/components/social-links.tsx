// Server component: the GitHub and X links are plain HTML with inline SVG, so they add no client JS.
// The layout renders them and passes them into the client Shell (header, mobile menu, footer).

const GITHUB = 'https://github.com/Milerius/trenchmart';
const X_URL = 'https://x.com/TrenchmartSI';

// Official marks (Simple Icons paths), drawn with currentColor.
const GITHUB_PATH =
  'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3.495.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12';
const X_PATH =
  'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z';

const SOCIAL = [
  { id: 'github', href: GITHUB, name: 'TrenchMart on GitHub', label: 'GitHub', path: GITHUB_PATH },
  { id: 'x', href: X_URL, name: 'TrenchMart on X', label: '@TrenchmartSI', path: X_PATH },
] as const;

function Mark({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/** Round icon buttons: desktop header and footer. */
export function SocialIcons({ where }: { where: 'header' | 'footer' }) {
  return (
    <div className="flex items-center gap-1.5" data-testid={`social-${where}`}>
      {SOCIAL.map((s) => (
        <a
          key={s.id}
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={s.name}
          title={s.name}
          data-social={s.id}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/[.08] text-ink-2 transition-colors hover:border-accent/40 hover:text-accent"
        >
          <Mark path={s.path} />
        </a>
      ))}
    </div>
  );
}

/** Labelled pills: bottom of the mobile menu. */
export function SocialPills() {
  return (
    <div
      className="mt-1.5 flex gap-2 border-t border-line-soft px-1 pt-3 pb-1"
      data-testid="social-menu"
    >
      {SOCIAL.map((s) => (
        <a
          key={s.id}
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={s.name}
          data-social={s.id}
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full border border-white/[.08] text-sm text-ink-2 hover:text-ink"
        >
          <Mark path={s.path} />
          {s.label}
        </a>
      ))}
    </div>
  );
}
