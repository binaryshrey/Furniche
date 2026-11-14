import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./components/**/*.{ts,tsx}', './app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark theme everywhere, Airbnb-style: neutral greys, one coral brand colour for actions.
        paper: '#0f0f0f',
        card: '#1b1b1b',
        panel: '#232323',
        ink: '#f7f7f7',
        muted: '#a3a3a3',
        line: '#2c2c2c',
        brand: '#ff385c',
        'brand-deep': '#e31c5f',
        sage: '#a3b496',
        clay: '#d9976f',
        ok: '#6cc08a',
        warn: '#e6ae45',
        bad: '#ea6a58',
      },
      fontFamily: {
        display: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        swatch: '0 1px 2px rgba(0,0,0,.3), 0 12px 32px -12px rgba(0,0,0,.6)',
      },
    },
  },
  plugins: [],
};
export default config;
