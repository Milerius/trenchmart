import { BUY, DISPUTE, ESCROW_V, HOLD, PROOF, RELEASE } from '../../src/launch/escrow/timeline';
import { FPS } from '../../src/timeline';
import {
  beep,
  chime,
  coin,
  glitch,
  lockClunk,
  pop,
  thud,
  uiClick,
  whir,
  whoosh,
} from '../instruments';
import { range, type LaunchAudio } from './spec';

export const escrow: LaunchAudio<(typeof ESCROW_V.list)[number]['id']> = {
  id: 'escrow',
  timeline: ESCROW_V,
  key: 2,
  prog: ['i', 'VII', 'VI', 'VII', 'i', 'VII', 'VI', 'v', 'iv', 'VI', 'III', 'VII', 'i'],
  sfx: (cue) => {
    range(20, 110, 18).forEach((f, i) =>
      cue('hook', f, beep(76 + (i % 3) * 3, 0.05), 0.03, i % 2 ? 0.4 : -0.4),
    );

    cue('buy', BUY.click, uiClick(), 0.42);
    cue('buy', BUY.click + 3, beep(83, 0.08), 0.08);
    cue('buy', BUY.signed, beep(88, 0.08), 0.1);
    cue('buy', BUY.confirmed, beep(91, 0.08), 0.12);
    cue('buy', BUY.done, chime([84, 88, 91, 96]), 0.26);

    for (let i = 0; i < 20; i += 2) cue('hold', HOLD.count[0] + i * 1.2, coin(i), 0.05, 0.35);
    cue('hold', HOLD.count[1], lockClunk(), 0.45, 0.2);
    cue('hold', HOLD.download, pop(), 0.12, -0.3);

    cue('dispute', DISPUTE.click, uiClick(), 0.42);
    cue('dispute', DISPUTE.open, glitch(0.3, 52), 0.1);
    cue('dispute', DISPUTE.open + 1, thud(), 0.35);
    cue('dispute', DISPUTE.open + 2, beep(70, 0.3), 0.08);
    for (const k of ['refund', 'reject', 'timeout'] as const)
      cue('dispute', DISPUTE[k], beep(86, 0.05), 0.06, 0.3);

    cue('release', RELEASE.ff[0], whir((RELEASE.ff[1] - RELEASE.ff[0]) / FPS), 0.14);
    cue('release', RELEASE.released, lockClunk(), 0.3);
    cue('release', RELEASE.released + 1, chime([80, 84, 87, 92]), 0.26);
    for (let i = 0; i < 14; i += 2) cue('release', RELEASE.seller + i, coin(40 + i), 0.05, -0.3);
    range(RELEASE.split[0], RELEASE.split[0] + 9, 3).forEach((f, i) =>
      cue('release', f, beep(88 + i * 2, 0.06), 0.07, 0.3),
    );

    cue('proof', 2, whoosh(0.4, true, 36), 0.14, 0.3);
    cue('proof', PROOF.addr, beep(91, 0.1), 0.1);
    cue('proof', PROOF.tx - 4, whoosh(0.35, false, 37), 0.12);
    cue('proof', PROOF.escrowRow, beep(93, 0.1), 0.1);
    cue('proof', PROOF.zoomC[0], whoosh(0.4, true, 38), 0.1, -0.3);
    cue('proof', PROOF.logs, chime([84, 91, 96]), 0.22);

    cue('outro', 8, whoosh(0.22, true, 33), 0.08);
    cue('outro', 22, whoosh(0.4, false, 35), 0.14);
    cue('outro', 62, pop(), 0.14);
    cue('outro', 62, uiClick(23), 0.12);
  },
};
