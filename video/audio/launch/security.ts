import {
  HOOK,
  REPORT,
  REVIEW,
  SECURITY,
  UPLOAD,
  VERDICT,
} from '../../src/launch/security/timeline';
import {
  beep,
  chime,
  glitch,
  keyTick,
  lockClunk,
  pop,
  thud,
  uiClick,
  whoosh,
} from '../instruments';
import { scanHum } from '../sfx';
import { FPS } from '../../src/timeline';
import { range, type LaunchAudio } from './spec';

export const security: LaunchAudio<(typeof SECURITY.list)[number]['id']> = {
  id: 'security',
  timeline: SECURITY,
  key: 0,
  prog: ['i', 'VI', 'i', 'VI', 'III', 'VII', 'i', 'VI', 'iv', 'v', 'III', 'VII'],
  sfx: (cue) => {
    cue('hook', HOOK.beam[0], scanHum((HOOK.beam[1] - HOOK.beam[0]) / FPS), 0.06);
    cue('hook', HOOK.flag, glitch(0.4), 0.16);
    cue('hook', HOOK.flag + 2, beep(64, 0.14), 0.1);

    cue('upload', UPLOAD.fly[0] - 2, whoosh(0.32, true), 0.22, 0.4);
    cue('upload', UPLOAD.fly[1], thud(), 0.3);
    range(UPLOAD.progress[0], UPLOAD.progress[1], 4).forEach((f, i) =>
      cue('upload', f, beep(84 + i, 0.05), 0.035),
    );
    range(UPLOAD.sha[0], UPLOAD.sha[1], 2).forEach((f, i) => cue('upload', f, keyTick(i), 0.07));
    cue('upload', UPLOAD.pinned, lockClunk(), 0.3, 0.2);
    cue('upload', UPLOAD.scanning, pop(), 0.12, -0.3);

    range(REVIEW.staticRun, REVIEW.staticDone - 4, 4).forEach((f, i) =>
      cue('review', f, beep(86 + (i % 3) * 2, 0.04), 0.04, 0.2),
    );
    cue('review', REVIEW.staticDone, beep(91), 0.13);
    cue('review', REVIEW.sandboxDone, beep(95), 0.13);
    cue('review', REVIEW.verdictRun, uiClick(22), 0.15);
    cue('review', REVIEW.verdictDone, chime([84, 91, 96]), 0.26);
    cue('review', REVIEW.live, pop(), 0.12, 0.3);

    cue('verdict', VERDICT.rules, whoosh(0.25, true, 33), 0.08, -0.4);
    cue('verdict', VERDICT.llm, whoosh(0.25, true, 34), 0.08, 0.4);
    cue('verdict', VERDICT.rulesDecide, beep(88, 0.1), 0.13, -0.35);
    cue('verdict', VERDICT.rulesDecide + 3, beep(95, 0.12), 0.13, -0.35);
    cue('verdict', VERDICT.llmDecide, beep(83, 0.1), 0.14, 0.35);
    cue('verdict', VERDICT.llmDecide + 3, beep(78, 0.16), 0.14, 0.35);
    cue('verdict', VERDICT.merge[0], whoosh(0.6, false, 35), 0.1);
    cue('verdict', VERDICT.final, thud(), 0.35);
    cue('verdict', VERDICT.final + 1, beep(76, 0.2), 0.1);

    range(REPORT.json[0], REPORT.json[1], 6).forEach((f, i) =>
      cue('report', f, keyTick(300 + i), 0.08),
    );
    cue('report', REPORT.sign, lockClunk(), 0.32, -0.2);
    cue('report', REPORT.browser[0], whoosh(0.4, true, 36), 0.14, 0.3);
    cue('report', REPORT.valid, chime([84, 88, 91, 96]), 0.26);

    cue('outro', 8, whoosh(0.22, true, 33), 0.08);
    cue('outro', 22, whoosh(0.4, false, 35), 0.14);
    cue('outro', 62, pop(), 0.14);
    cue('outro', 62, uiClick(23), 0.12);
  },
};
