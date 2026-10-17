import React from 'react';
import { Composition } from 'remotion';
import './fonts';
import { Promo } from './Promo';
import { FPS, PROMO_FRAMES } from './timeline';

export const Root: React.FC = () => (
  <>
    <Composition
      id="Promo-1x1"
      component={Promo}
      durationInFrames={PROMO_FRAMES}
      fps={FPS}
      width={1080}
      height={1080}
    />
    <Composition
      id="Promo-16x9"
      component={Promo}
      durationInFrames={PROMO_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
    />
  </>
);
