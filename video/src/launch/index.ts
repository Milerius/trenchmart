import type React from 'react';
import { EscrowVideo } from './escrow/Escrow';
import { ESCROW_V } from './escrow/timeline';
import type { LaunchProps } from './kit/shell';
import { SecurityVideo } from './security/Security';
import { SECURITY } from './security/timeline';
import { TiersVideo } from './tiers/Tiers';
import { TIERS } from './tiers/timeline';

export const LAUNCH_VIDEOS: { id: string; component: React.FC<LaunchProps>; frames: number }[] = [
  { id: 'Security', component: SecurityVideo, frames: SECURITY.total },
  { id: 'Escrow', component: EscrowVideo, frames: ESCROW_V.total },
  { id: 'Tiers', component: TiersVideo, frames: TIERS.total },
];
