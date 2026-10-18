import { describe, expect, it } from 'vitest';
import { canonicalTerminals, TERMINALS } from './terminals';
import { DEFAULT_CONFIG_JSON } from './config';

describe('terminals', () => {
  it('renames Padre to Terminal, keeps Trojan, drops BullX', () => {
    expect(canonicalTerminals(['padre', 'trojan', 'BullX', 'axiom', 'Trojan', ' My Bot '])).toEqual(
      ['Terminal', 'Trojan', 'Axiom', 'My Bot'],
    );
  });
  it('lists no retired terminal anywhere', () => {
    expect(TERMINALS).toContain('Trojan');
    expect(DEFAULT_CONFIG_JSON.terminals).toEqual([
      'Axiom',
      'GMGN',
      'Photon',
      'Terminal',
      'Trojan',
      'Any',
    ]);
  });
});
