import type { Metadata, Viewport } from 'next';
// Fontes auto-hospedadas (pacotes npm): o build não depende de fonts.googleapis.com.
import '@fontsource-variable/inter';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Liecimara Ads CRM',
  description: 'Rastreamento de leads de anúncios e conversões comerciais',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#0D1F3A', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
