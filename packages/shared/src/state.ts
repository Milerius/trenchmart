export const ORDER_STATUSES = ['pending', 'paid', 'released', 'refunded', 'disputed', 'expired'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const VERSION_STATUSES = [
  'uploading',
  'scanning',
  'needs_creator',
  'in_review',
  'live',
  'rejected',
  'superseded',
  'delisted',
] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

const ORDER_NEXT: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'expired'],
  paid: ['released', 'disputed'],
  disputed: ['refunded', 'paid', 'released'],
  released: ['disputed'],
  refunded: [],
  expired: [],
};

const VERSION_NEXT: Record<VersionStatus, VersionStatus[]> = {
  uploading: ['scanning', 'rejected'],
  scanning: ['needs_creator', 'in_review', 'rejected', 'live'],
  needs_creator: ['in_review', 'scanning', 'rejected', 'live'],
  in_review: ['live', 'rejected', 'needs_creator'],
  live: ['superseded', 'delisted'],
  rejected: [],
  superseded: ['delisted'],
  delisted: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_NEXT[from].includes(to);
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrder(from, to)) {
    throw new Error(`illegal order transition ${from} -> ${to}`);
  }
}

export function canTransitionVersion(from: VersionStatus, to: VersionStatus): boolean {
  return VERSION_NEXT[from].includes(to);
}

export function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8);
}

export function orderMemo(orderId: string): string {
  return `tm:${shortId(orderId)}`;
}

export function bondMemo(bondId: string): string {
  return `bond:${shortId(bondId)}`;
}

export function verificationFeeMemo(versionId: string): string {
  return `vfee:${shortId(versionId)}`;
}
