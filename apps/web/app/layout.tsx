import type { Metadata, Viewport } from 'next';
// Fontes auto-hospedadas (pacotes npm): o build não depende de fonts.googleapis.com.
import '@fontsource-variable/inter';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import './globals.css';
import { THEME_BOOT } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'Liecimara CRM',
  description: 'CRM da Clínica Dra. Liecimara Esteves',
  robots: { index: false, follow: false },
  applicationName: 'Liecimara CRM',
  appleWebApp: { capable: true, title: 'Liecimara', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = { themeColor: '#0D1F3A', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* Aplica o tema salvo antes de desenhar a página */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
