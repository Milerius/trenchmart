import type React from 'react';
import type { LaunchProps } from './kit/shell';
import { SecurityVideo } from './security/Security';
import { SECURITY } from './security/timeline';

export const LAUNCH_VIDEOS: { id: string; component: React.FC<LaunchProps>; frames: number }[] = [
  { id: 'Security', component: SecurityVideo, frames: SECURITY.total },
];
