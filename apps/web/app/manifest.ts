import type { MetadataRoute } from 'next';

/** Instalar na tela inicial do celular/computador com o logo da clínica. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Liecimara CRM',
    short_name: 'Liecimara',
    description: 'CRM da Clínica Dra. Liecimara Esteves',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0D1F3A',
    theme_color: '#0D1F3A',
    lang: 'pt-BR',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
