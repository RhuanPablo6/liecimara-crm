import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

// Identidade visual: azul-marinho e dourado.
const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1.5rem', screens: { '2xl': '1400px' } },
    extend: {
      colors: {
        navy: {
          50: '#EEF2F8',
          100: '#D5DEEC',
          200: '#AABBD6',
          300: '#7590B8',
          400: '#456596',
          500: '#264A7C',
          600: '#1B3964',
          700: '#132B4E',
          800: '#0D1F3A',
          900: '#081428',
        },
        gold: {
          50: '#FBF7EA',
          100: '#F5EBC8',
          200: '#ECD892',
          300: '#E0C25C',
          400: '#D4AF37',
          500: '#B8952A',
          600: '#937520',
          700: '#6E5719',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      fontFamily: { sans: ['var(--font-sans)', 'system-ui', 'sans-serif'], serif: ['var(--font-serif)', 'Georgia', 'serif'] },
    },
  },
  plugins: [animate],
};

export default config;
