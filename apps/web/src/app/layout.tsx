import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Shell } from '@/components/shell';
import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'TrenchMart · Reviewed trading tools, escrowed on Solana devnet',
  description:
    'Buy and sell trading scripts, filters and wallet lists that pass automated security review. On-chain escrow on every order, 0% creator commission. Devnet proof of concept.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
