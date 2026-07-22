import type {Metadata} from 'next';
import {Space_Grotesk, JetBrains_Mono} from 'next/font/google';
import './globals.css';
import {Providers} from './providers';

// Two voices, on purpose. The demo is about a confusion between a HUMAN's
// authority and a MACHINE's: Space Grotesk carries the human framing and UI;
// JetBrains Mono is the machine's own voice — the agent's log, scopes, and
// correlation ids. The typography encodes the theme.
const display = Space_Grotesk({
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
  title: 'Confused Deputy — a live agent-authorization demo',
  description:
    'Watch an AI agent get tricked into approving something the human who triggered it could never approve — then watch Kinde stop it.'
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
