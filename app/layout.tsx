import type {Metadata} from 'next';
import {Inter, JetBrains_Mono} from 'next/font/google';
import './globals.css';
import {Providers} from './providers';

// Inter for the interface and text. JetBrains Mono for code, ids, and data.
const display = Inter({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap'
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap'
});

export const metadata: Metadata = {
  title: 'Contract Intelligence: an AI agent permissions demo',
  description:
    'See how an AI agent gets tricked into doing something its user cannot do, and how Kinde stops it.'
};

export default function RootLayout({
  children
}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
