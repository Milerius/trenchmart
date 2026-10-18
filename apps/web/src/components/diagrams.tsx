import { feeSplit, orderEdges, protocol, type OrderEdge } from '@/lib/protocol-facts';

const INK = '#eef0ea';
const MUTED = '#9ba19a';
const LINE = '#646c63';
const SURFACE = '#101210';
const BORDER = '#232823';
const ACCENT = '#c6f432';
const ON = '#0a0b0a';

function ArrowDefs({ id }: { id: string }) {
  return (
    <defs>
      <marker id={id} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill={LINE} />
      </marker>
    </defs>
  );
}

/** A numbered sequence: the prototype's step cards (readable at any width, unlike an SVG). */
function FlowDiagram({ testId, title, steps }: { testId: string; title: string; steps: string[] }) {
  return (
    <figure className="m-0 mt-6" data-testid={testId}>
      <figcaption className="sr-only">{title}</figcaption>
      <ol className="m-0 flex flex-col gap-3 p-0">
        {steps.map((step, index) => (
          <li
            key={step}
            className="flex list-none items-center gap-4 rounded-2xl border border-line bg-surface/60 p-4"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-bg font-mono text-sm text-accent ring-1 ring-accent-line">
              {index + 1}
            </span>
            <span className="text-ink-2">{step}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

export function PurchaseDiagram() {
  return (
    <FlowDiagram
      testId="diagram-purchase"
      title="Purchase and escrow sequence"
      steps={[
        'Buyer opens a live listing',
        `API quotes the fee and opens a pending order for ${protocol.orderTtlMinutes} minutes`,
        'Buyer signs one transaction that creates and funds the order escrow',
        `Order is paid and held for ${protocol.escrowWindow}`,
        'Release pays the seller, or a dispute can refund the buyer',
      ]}
    />
  );
}

export function VerificationDiagram() {
  return (
    <FlowDiagram
      testId="diagram-verification"
      title="Listing verification pipeline"
      steps={[
        'Creator uploads a version',
        `Static scan (${protocol.scannerEngine}) returns pass, warn, or fail`,
        'Sandbox runs userscripts and JavaScript alerts',
        `${protocol.aiAgentId} approves, rejects, or asks for a note`,
        'Approved version goes live. A fail rejects it',
      ]}
    />
  );
}

const NODE: Record<string, { x: number; y: number }> = {
  pending: { x: 120, y: 56 },
  paid: { x: 340, y: 56 },
  released: { x: 560, y: 56 },
  expired: { x: 120, y: 196 },
  disputed: { x: 340, y: 196 },
  refunded: { x: 560, y: 196 },
};

function edgeLine(edge: OrderEdge): { x1: number; y1: number; x2: number; y2: number } {
  const from = NODE[edge.from]!;
  const to = NODE[edge.to]!;
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  const back = edge.from === 'disputed' && (edge.to === 'paid' || edge.to === 'released');
  const late = edge.from === 'released' && edge.to === 'disputed';
  if (back) {
    return { x1: from.x + 36, y1: from.y - 16, x2: to.x + 36, y2: to.y + 18 };
  }
  if (late) {
    return { x1: from.x - 36, y1: from.y + 16, x2: to.x - 36, y2: to.y - 18 };
  }
  return {
    x1: from.x + dx * 52,
    y1: from.y + dy * 16,
    x2: to.x - dx * 52,
    y2: to.y - dy * 16,
  };
}

export function EscrowStateDiagram() {
  const marker = 'diagram-escrow-state-arrow';
  return (
    <figure className="m-0 mt-6" data-testid="diagram-escrow-state">
      <svg
        viewBox="0 0 680 260"
        role="img"
        aria-labelledby="diagram-escrow-state-title"
        className="h-auto w-full font-sans"
      >
        <title id="diagram-escrow-state-title">Escrow order state machine</title>
        <ArrowDefs id={marker} />
        {orderEdges.map((edge) => {
          const line = edgeLine(edge);
          return (
            <line
              key={`${edge.from}-${edge.to}`}
              {...line}
              stroke={LINE}
              markerEnd={`url(#${marker})`}
            />
          );
        })}
        {Object.entries(NODE).map(([name, pos]) => (
          <g key={name}>
            <rect
              x={pos.x - 52}
              y={pos.y - 16}
              width="104"
              height="32"
              rx="10"
              fill={name === 'refunded' || name === 'expired' ? SURFACE : '#141a08'}
              stroke={name === 'paid' || name === 'released' ? ACCENT : BORDER}
            />
            <text
              x={pos.x}
              y={pos.y + 5}
              textAnchor="middle"
              fill={INK}
              fontSize="13"
              fontFamily="inherit"
            >
              {name}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

export function FeeFlowDiagram() {
  const marker = 'diagram-fees-arrow';
  const buckets = feeSplit;
  return (
    <figure className="m-0 mt-6" data-testid="diagram-fees">
      <svg
        viewBox="0 0 720 300"
        role="img"
        aria-labelledby="diagram-fees-title"
        className="h-auto w-full font-sans"
      >
        <title id="diagram-fees-title">Fee flow from a purchase</title>
        <ArrowDefs id={marker} />
        <rect x="270" y="16" width="180" height="44" rx="10" fill={ACCENT} />
        <text
          x="360"
          y="44"
          textAnchor="middle"
          fill={ON}
          fontSize="15"
          fontFamily="inherit"
          fontWeight="600"
        >
          Buyer pays total
        </text>
        <line x1="320" y1="60" x2="180" y2="110" stroke={LINE} markerEnd={`url(#${marker})`} />
        <line x1="400" y1="60" x2="500" y2="110" stroke={LINE} markerEnd={`url(#${marker})`} />
        <rect x="70" y="116" width="200" height="44" rx="10" fill={SURFACE} stroke={BORDER} />
        <text x="170" y="144" textAnchor="middle" fill={INK} fontSize="14" fontFamily="inherit">
          Price to the seller
        </text>
        <rect x="400" y="116" width="230" height="44" rx="10" fill={SURFACE} stroke={ACCENT} />
        <text x="515" y="144" textAnchor="middle" fill={INK} fontSize="14" fontFamily="inherit">
          Net fee, then the split
        </text>
        {buckets.map((bucket, index) => {
          const x = 36 + index * 174;
          return (
            <g key={bucket.key}>
              <line
                x1={515}
                y1={160}
                x2={x + 78}
                y2={206}
                stroke={LINE}
                markerEnd={`url(#${marker})`}
              />
              <rect x={x} y="212" width="156" height="64" rx="10" fill={SURFACE} stroke={BORDER} />
              <text
                x={x + 78}
                y="238"
                textAnchor="middle"
                fill={ACCENT}
                fontSize="16"
                fontFamily="inherit"
                fontWeight="600"
              >
                {bucket.percent}
              </text>
              <text
                x={x + 78}
                y="258"
                textAnchor="middle"
                fill={MUTED}
                fontSize="12"
                fontFamily="inherit"
              >
                {bucket.label}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
