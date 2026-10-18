import { BAR } from '../../timeline';

export type SceneDef<T extends string> = { id: T; bars: number; chapter?: string };
export type Placed<T extends string> = SceneDef<T> & { from: number; dur: number };

/** Lays scenes end to end on the 100 BPM bar grid. */
export const sequence = <T extends string>(defs: SceneDef<T>[]) => {
  let from = 0;
  const list: Placed<T>[] = defs.map((d) => {
    const placed = { ...d, from, dur: Math.round(d.bars * BAR) };
    from += placed.dur;
    return placed;
  });
  const at = Object.fromEntries(list.map((s) => [s.id, s])) as Record<T, Placed<T>>;
  return { list, at, total: from };
};
