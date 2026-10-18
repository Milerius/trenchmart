import { CHECKOUT, FEE, HOOK_T, LADDER, TIERS, WINDOW } from '../../src/launch/tiers/timeline';
import { beep, chime, coin, pop, thud, uiClick, whoosh } from '../instruments';
import { range, type LaunchAudio } from './spec';

export const tiers: LaunchAudio<(typeof TIERS.list)[number]['id']> = {
  id: 'tiers',
  timeline: TIERS,
  key: -2,
  prog: ['i', 'VI', 'III', 'VII', 'i', 'VI', 'III', 'VII', 'iv', 'VI', 'v', 'VII'],
  sfx: (cue) => {
    range(HOOK_T.count[0], HOOK_T.count[1], (HOOK_T.count[1] - HOOK_T.count[0]) / 3).forEach((f, i) =>
      cue('hook', f, beep(84 - i * 3, 0.08), 0.05),
    );

    cue('fee', FEE.buyer, whoosh(0.25, true, 33), 0.1, -0.4);
    cue('fee', FEE.fee, beep(84, 0.1), 0.1, -0.3);
    cue('fee', FEE.creator, whoosh(0.25, true, 34), 0.1, 0.4);
    cue('fee', FEE.zero, chime([84, 91]), 0.18, 0.3);

    const steps = [
      [LADDER.scout, LADDER.scoutOff, 84],
      [LADDER.trencher, LADDER.trencherOff, 88],
      [LADDER.og, LADDER.ogOff, 91],
    ] as const;
    steps.forEach(([row, off, m], i) => {
      cue('tiers', row, thud(), 0.22);
      cue('tiers', row + 1, beep(m, 0.08), 0.1);
      cue('tiers', off, chime(i === 2 ? [84, 88, 91, 96] : [m, m + 7]), i === 2 ? 0.26 : 0.16);
      for (let k = 0; k < 6; k += 2) cue('tiers', off + k, coin(i * 10 + k), 0.04, 0.3);
    });

    cue('checkout', CHECKOUT.tier, pop(), 0.14, 0.3);
    cue('checkout', CHECKOUT.discount, beep(88, 0.08), 0.1);
    cue('checkout', CHECKOUT.total, beep(93, 0.12), 0.12);
    cue('checkout', CHECKOUT.sign, uiClick(), 0.3);

    cue('window', WINDOW.draw[0], whoosh(1.4, true, 39), 0.07);
    cue('window', WINDOW.spike[0], beep(76, 0.12), 0.08, 0.4);
    cue('window', WINDOW.low, beep(91, 0.12), 0.12);
    cue('window', WINDOW.result, chime([84, 88, 91]), 0.22);

    cue('outro', 8, whoosh(0.22, true, 33), 0.08);
    cue('outro', 22, whoosh(0.4, false, 35), 0.14);
    cue('outro', 62, pop(), 0.14);
    cue('outro', 62, uiClick(23), 0.12);
  },
};
