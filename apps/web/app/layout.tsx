import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { BRANDING } from '@supplyline/core/branding';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: BRANDING.productName,
  description: BRANDING.tagline,
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon-192.png' },
  appleWebApp: { capable: true, title: BRANDING.productName, statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
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
