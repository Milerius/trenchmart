import type { Metadata } from 'next';
import { Geist, Geist_Mono, Space_Mono } from 'next/font/google';
import { Shell } from '@/components/shell';
import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });
const display = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-space-mono',
});

export const metadata: Metadata = {
  title: 'TrenchMart · AI-verified trading tools, escrowed on Solana',
  description:
    'Buy and sell AI-verified trading scripts, filters and wallet lists. Escrow on every order, 0% creator commission.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable}`}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
