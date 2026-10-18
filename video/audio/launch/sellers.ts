import { PRICING, SELLERS, STUDIO, VERSIONS, WIZARD } from '../../src/launch/sellers/timeline';
import { beep, chime, keyTick, pop, uiClick, whoosh } from '../instruments';
import { range, type LaunchAudio } from './spec';

export const sellers: LaunchAudio<(typeof SELLERS.list)[number]['id']> = {
  id: 'sellers',
  timeline: SELLERS,
  key: 1,
  prog: ['i', 'III', 'VII', 'VI', 'i', 'III', 'VII', 'VI', 'iv', 'v', 'VI', 'VII'],
  sfx: (cue) => {
    cue('wizard', WIZARD.pick, uiClick(), 0.36);
    cue('wizard', WIZARD.step2 - 2, whoosh(0.3, true, 33), 0.1, 0.3);
    WIZARD.terminals.forEach((f, i) => cue('wizard', f, beep(84 + i * 2, 0.07), 0.1, -0.4 + i * 0.2));

    range(PRICING.price[0], PRICING.price[1], 4).forEach((f, i) => cue('pricing', f, keyTick(i), 0.08));
    cue('pricing', PRICING.toggle, uiClick(22), 0.34);
    cue('pricing', PRICING.free, chime([84, 91]), 0.16);
    range(PRICING.monthly[0], PRICING.monthly[1], 4).forEach((f, i) => cue('pricing', f, keyTick(50 + i), 0.08));
    cue('pricing', PRICING.renews, beep(88, 0.1), 0.1, 0.3);

    range(VERSIONS.semver[0], VERSIONS.semver[1], 3).forEach((f, i) => cue('versions', f, keyTick(100 + i), 0.07));
    range(VERSIONS.changelog[0], VERSIONS.changelog[1], 2).forEach((f, i) => cue('versions', f, keyTick(200 + i), 0.05));
    cue('versions', VERSIONS.submit, uiClick(), 0.34);
    cue('versions', VERSIONS.verdict, beep(88, 0.08), 0.1);
    cue('versions', VERSIONS.live, chime([84, 88, 91, 96]), 0.24);

    range(STUDIO.chips[0], STUDIO.chips[0] + 18, 6).forEach((f, i) => cue('studio', f, pop(), 0.06, -0.3 + i * 0.2));
    cue('studio', STUDIO.chips[1] - 6, whoosh(0.4, true, 36), 0.12, 0.3);
    cue('studio', STUDIO.bond, beep(91, 0.1), 0.1);
    cue('studio', STUDIO.trust, chime([84, 91, 96]), 0.2);

    cue('outro', 8, whoosh(0.22, true, 33), 0.08);
    cue('outro', 22, whoosh(0.4, false, 35), 0.14);
    cue('outro', 62, pop(), 0.14);
    cue('outro', 62, uiClick(23), 0.12);
  },
};
