import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./components/**/*.{ts,tsx}', './app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark theme everywhere, Airbnb-style: neutral greys, one orange brand colour for actions.
        paper: '#0f0f0f',
        card: '#1b1b1b',
        panel: '#232323',
        ink: '#f7f7f7',
        muted: '#a3a3a3',
        line: '#2c2c2c',
        // Orchestral-AI's orange (github.com/binaryshrey/Orchestral-AI, app/globals.css).
        brand: '#fc7249',
        'brand-deep': '#ff6632',
        'brand-soft': '#ffab91',
        // shadcn/ui tokens, mapped onto the palette above.
        background: '#0f0f0f',
        foreground: '#f7f7f7',
        border: '#2c2c2c',
        input: '#2c2c2c',
        ring: '#fc7249',
        primary: { DEFAULT: '#fc7249', foreground: '#ffffff' },
        accent: { DEFAULT: '#232323', foreground: '#f7f7f7' },
        'muted-foreground': '#a3a3a3',
        destructive: { DEFAULT: '#ea6a58', foreground: '#ffffff' },
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
