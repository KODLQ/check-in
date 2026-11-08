import type { Metadata } from 'next';

import { getLocale } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: 'check-in',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang={await getLocale()}>
      <body>{children}</body>
    </html>
  );
}
