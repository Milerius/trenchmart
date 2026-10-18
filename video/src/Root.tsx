import React from 'react';
import { Composition, Folder } from 'remotion';
import './fonts';
import { Promo, type PromoMix } from './Promo';
import { FPS, PROMO_FRAMES } from './timeline';
import { LAUNCH_VIDEOS } from './launch';

const FORMATS = [
  { id: 'Promo-1x1', width: 1080, height: 1080 },
  { id: 'Promo-16x9', width: 1920, height: 1080 },
];

const MIXES: { suffix: string; mix: PromoMix }[] = [
  { suffix: '', mix: 'full' },
  { suffix: '-music-sfx', mix: 'music-sfx' },
];

const LAUNCH_FORMATS = [
  { suffix: '16x9', width: 1920, height: 1080 },
  { suffix: '9x16', width: 1080, height: 1920 },
];

export const Root: React.FC = () => (
  <>
    {FORMATS.flatMap(({ id, width, height }) =>
      MIXES.map(({ suffix, mix }) => (
        <Composition
          key={id + suffix}
          id={id + suffix}
          component={Promo}
          defaultProps={{ mix }}
          durationInFrames={PROMO_FRAMES}
          fps={FPS}
          width={width}
          height={height}
        />
      )),
    )}
    <Folder name="Launch">
      {LAUNCH_VIDEOS.flatMap((v) =>
        LAUNCH_FORMATS.map((f) => (
          <Composition
            key={`${v.id}-${f.suffix}`}
            id={`Launch-${v.id}-${f.suffix}`}
            component={v.component}
            defaultProps={{ audio: true }}
            durationInFrames={v.frames}
            fps={FPS}
            width={f.width}
            height={f.height}
          />
        )),
      )}
    </Folder>
  </>
);
