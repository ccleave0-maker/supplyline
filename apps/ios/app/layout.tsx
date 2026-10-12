import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { BRANDING } from '@supplyline/core/branding';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: BRANDING.productName,
  description: BRANDING.tagline,
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // An app, not a web page: no pinch/double-tap zoom or zoom-on-type. Text size follows
  // the iPhone's Settings › Display › Text Size instead.
  maximumScale: 1,
  userScalable: false,
  themeColor: BRANDING.defaultThemeColor,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-CA">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
