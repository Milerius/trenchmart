import React from 'react';
import { Composition } from 'remotion';
import './fonts';
import { Promo, type PromoMix } from './Promo';
import { FPS, PROMO_FRAMES } from './timeline';

const FORMATS = [
  { id: 'Promo-1x1', width: 1080, height: 1080 },
  { id: 'Promo-16x9', width: 1920, height: 1080 },
];

const MIXES: { suffix: string; mix: PromoMix }[] = [
  { suffix: '', mix: 'full' },
  { suffix: '-music-sfx', mix: 'music-sfx' },
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
  </>
);
