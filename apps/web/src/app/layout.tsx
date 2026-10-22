import type { Metadata } from 'next';
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import { Shell } from '@/components/shell';
import { SocialIcons, SocialPills } from '@/components/social-links';
import { DEVNET_ADDRESSES, ESCROW_CLUSTER, ESCROW_PROGRAM_ID } from '@/lib/protocol-facts';
import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });
// Display accent only (italic words in headings). One weight, one style, latin only: ~20 KB.
const serif = Instrument_Serif({
  weight: '400',
  style: 'italic',
  subsets: ['latin'],
  variable: '--font-instrument-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'TrenchMart · Reviewed trading tools, escrowed on Solana devnet',
  description:
    'Buy and sell trading scripts, filters and wallet lists that pass automated security review. On-chain escrow on every order, 0% creator commission. Devnet proof of concept.',
  metadataBase: new URL('https://trenchmart.fun'),
  alternates: {
    types: { 'application/json': '/.well-known/trenchmart.json' },
  },
  // Machine-readable: this deployment is Solana devnet only (see /.well-known/trenchmart.json).
  other: {
    'solana:cluster': ESCROW_CLUSTER,
    'trenchmart:cluster': ESCROW_CLUSTER,
    'trenchmart:escrow-program': ESCROW_PROGRAM_ID,
    'trenchmart:treasury-vault': DEVNET_ADDRESSES.vault,
    'trenchmart:squads-multisig': DEVNET_ADDRESSES.multisig,
    'trenchmart:trench-mint': DEVNET_ADDRESSES.trenchMint,
    'trenchmart:manifest': '/.well-known/trenchmart.json',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>
        <Shell
          social={{
            header: <SocialIcons where="header" />,
            menu: <SocialPills />,
            footer: <SocialIcons where="footer" />,
          }}
        >
          {children}
        </Shell>
      </body>
    </html>
  );
}
