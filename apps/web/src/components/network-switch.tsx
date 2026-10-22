// Server component: the Devnet | Mainnet pill and its menu are plain HTML (<details>), so they
// add no client JS to any page. The layout renders them into the client Shell (header and mobile
// menu, like the social links). Shell's Nav closes an open menu on outside click or Escape.
// A switch opens the other cluster's home page (each cluster has its own listings, so a path
// on one hostname does not exist on the other).
import { CLUSTER, MAINNET_LAUNCHED } from '@/lib/cluster';
import { CLUSTERS, type ClusterId } from '@/lib/clusters';

const ORDER: ClusterId[] = ['devnet', 'mainnet'];
const segment = 'h-8 items-center gap-1.5 rounded-full px-3 whitespace-nowrap';
const active = `inline-flex ${segment} bg-accent font-semibold text-onaccent`;

function Dot() {
  return <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />;
}

function Menu() {
  return (
    <div
      role="menu"
      data-testid="network-menu"
      aria-label="Choose network"
      className="absolute right-0 top-12 z-50 w-[min(280px,calc(100vw-2rem))] rounded-card border border-line-strong bg-surface-2 p-2 text-sm shadow-[0_10px_30px_rgba(0,0,0,.6)]"
    >
      {ORDER.map((id) => {
        const c = CLUSTERS[id];
        const current = id === CLUSTER.id;
        const enabled = id === 'devnet' || MAINNET_LAUNCHED;
        const body = (
          <>
            <span className="flex items-center gap-2 font-semibold">
              <span aria-hidden="true">{current ? '●' : '○'}</span>
              {c.label}
              {current ? <span aria-label="current">✓</span> : null}
              {!enabled ? (
                <span
                  data-testid="network-coming-soon"
                  className="ml-auto rounded-md bg-warn-bg px-2 py-0.5 font-mono text-[11px] text-warn"
                >
                  Coming soon
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block text-xs text-muted">
              {new URL(c.siteOrigin).host} · {c.note}
              {!enabled ? ' · disabled until launch' : ''}
            </span>
          </>
        );
        const cls = `block rounded-lg px-3 py-2.5 ${current ? 'bg-surface' : ''}`;
        return enabled && !current ? (
          <a
            key={id}
            role="menuitem"
            data-testid={`network-option-${id}`}
            href={`${c.siteOrigin}/`}
            className={`${cls} text-ink hover:bg-surface`}
          >
            {body}
          </a>
        ) : (
          <div
            key={id}
            role="menuitem"
            aria-disabled={enabled ? undefined : 'true'}
            aria-current={current ? 'true' : undefined}
            data-testid={`network-option-${id}`}
            className={`${cls} ${enabled ? 'text-ink' : 'cursor-not-allowed text-faint'}`}
          >
            {body}
          </div>
        );
      })}
      <p className="m-0 px-3 pt-2 pb-1 text-xs text-muted">
        Each network has its own API, RPC, program IDs, listings and wallet sessions.
      </p>
    </div>
  );
}

/**
 * Devnet | Mainnet segmented pill, left of the wallet button (approved mockup,
 * /workspace/tm-netswitch-mock). The active cluster is the lime segment; mainnet stays greyed
 * until NEXT_PUBLIC_MAINNET_LAUNCHED=1. The full pill shows from 1440 px; from sm to 1440 only the
 * active segment; below sm the header has no room (logo + wallet + menu fill 390 px), so the
 * same control is the first row of the mobile menu (`inMenu`).
 */
export function NetworkSwitch({ inMenu = false }: { inMenu?: boolean }) {
  const inactive = `${inMenu ? 'inline-flex' : 'hidden min-[1440px]:inline-flex'} ${segment}`;
  const devnet = CLUSTER.id === 'devnet';
  return (
    <details
      data-net=""
      data-testid={inMenu ? 'network-switch-menu' : 'network-switch'}
      className={`relative shrink-0 ${inMenu ? '' : 'hidden sm:block'}`}
    >
      <summary
        data-testid={inMenu ? 'network-pill-menu' : 'network-pill'}
        data-cluster={CLUSTER.id}
        className="motion-press flex h-10 shrink-0 cursor-pointer list-none items-center rounded-full border border-line-strong p-[3px] font-mono text-xs leading-6 hover:border-line-control [&::-webkit-details-marker]:hidden"
      >
        <span className="sr-only">Network:</span>
        <span className={devnet ? active : `${inactive} text-faint`}>
          {devnet ? <Dot /> : null}
          Devnet
        </span>
        <span
          data-testid={inMenu ? undefined : 'network-pill-mainnet'}
          data-launched={MAINNET_LAUNCHED ? '1' : '0'}
          className={
            devnet ? `${inactive} ${MAINNET_LAUNCHED ? 'text-ink-2' : 'text-faint'}` : active
          }
        >
          {devnet ? null : <Dot />}
          Mainnet
        </span>
      </summary>
      <Menu />
    </details>
  );
}
