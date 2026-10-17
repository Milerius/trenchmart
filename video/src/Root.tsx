import React from 'react';
import { Composition } from 'remotion';
import './fonts';
import { Promo, PROMO_FRAMES } from './Promo';
import { FPS } from './theme';

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
