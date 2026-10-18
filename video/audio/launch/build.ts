// Builds launch-video soundtracks: `npm run audio:launch -- [id...]` (default: all).
// Needs the voiceover first: `npm run tts:launch -- <id>`.
// Writes stems to audio/build/launch/<id>/ and public/audio/launch/<id>.flac
// (music ducked under the voice, SFX, voice), mastered to -14 LUFS / -1 dBTP.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BAR, FPS } from '../../src/timeline';
import { place, stereo, wav } from '../dsp';
import { master, mixWithVo, renderVoBus } from '../mix';
import { renderLaunchMusic } from './music';
import { escrow } from './escrow';
import { security } from './security';
import type { LaunchAudio } from './spec';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const PUBLIC = path.join(ROOT, 'public', 'audio', 'launch');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const VIDEOS: Record<string, LaunchAudio<any>> = { security, escrow };

const build = <T extends string>(spec: LaunchAudio<T>) => {
  const dir = path.join(HERE, '..', 'build', 'launch', spec.id);
  mkdirSync(dir, { recursive: true });
  mkdirSync(PUBLIC, { recursive: true });
  const seconds = spec.timeline.total / FPS;

  console.log(`[${spec.id}] music…`);
  const music = renderLaunchMusic({
    bars: Math.round(spec.timeline.total / BAR),
    key: spec.key,
    prog: spec.prog,
    scenes: spec.timeline.list.map((s) => Math.round(s.from / BAR)),
  });

  console.log(`[${spec.id}] SFX…`);
  const sfx = stereo(seconds);
  spec.sfx((scene, frame, src, gain, pan = 0) =>
    place(sfx, src, (spec.timeline.at[scene].from + frame) / FPS, gain, pan),
  );

  const script = JSON.parse(readFileSync(path.join(ROOT, 'src', 'launch', spec.id, 'vo.json'), 'utf8')) as {
    lines: { id: string; at: number }[];
  };
  const vo = renderVoBus(
    script.lines.map((l) => ({ id: l.id, seconds: l.at / FPS })),
    path.join(dir, 'vo'),
    seconds,
  );
  if (!vo) throw new Error(`[${spec.id}] voiceover missing; run \`npm run tts:launch -- ${spec.id}\``);

  writeFileSync(path.join(dir, 'stem-music.wav'), wav(music));
  writeFileSync(path.join(dir, 'stem-sfx.wav'), wav(sfx));
  writeFileSync(path.join(dir, 'stem-vo.wav'), wav(vo));
  writeFileSync(path.join(dir, 'premaster.wav'), wav(mixWithVo(music, sfx, vo, seconds)));
  const m = master(path.join(dir, 'premaster.wav'), path.join(PUBLIC, `${spec.id}.flac`));
  console.log(`[${spec.id}] ${m.I} LUFS / ${m.TP} dBTP`);
};

const ids = process.argv.slice(2);
for (const id of ids.length ? ids : Object.keys(VIDEOS)) {
  const spec = VIDEOS[id];
  if (!spec) throw new Error(`Unknown launch video "${id}". Known: ${Object.keys(VIDEOS).join(', ')}`);
  build(spec);
}
