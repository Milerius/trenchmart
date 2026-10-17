import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Shell } from '@/components/shell';
import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'TrenchMart · AI-verified trading tools, escrowed on Solana',
  description:
    'Buy and sell AI-verified trading scripts, filters and wallet lists. Escrow on every order, 0% creator commission.',
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
