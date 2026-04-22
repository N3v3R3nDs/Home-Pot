import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Felt + brass palettes are CSS-var driven so the active theme
        // (set on documentElement[data-theme]) re-skins the whole app.
        felt: {
          50:  'rgb(var(--felt-50) / <alpha-value>)',
          100: 'rgb(var(--felt-100) / <alpha-value>)',
          200: 'rgb(var(--felt-200) / <alpha-value>)',
          300: 'rgb(var(--felt-300) / <alpha-value>)',
          400: 'rgb(var(--felt-400) / <alpha-value>)',
          500: 'rgb(var(--felt-500) / <alpha-value>)',
          600: 'rgb(var(--felt-600) / <alpha-value>)',
          700: 'rgb(var(--felt-700) / <alpha-value>)',
          800: 'rgb(var(--felt-800) / <alpha-value>)',
          900: 'rgb(var(--felt-900) / <alpha-value>)',
          950: 'rgb(var(--felt-950) / <alpha-value>)',
        },
        brass: {
          50:  'rgb(var(--brass-50) / <alpha-value>)',
          100: 'rgb(var(--brass-100) / <alpha-value>)',
          200: 'rgb(var(--brass-200) / <alpha-value>)',
          300: 'rgb(var(--brass-300) / <alpha-value>)',
          400: 'rgb(var(--brass-400) / <alpha-value>)',
          500: 'rgb(var(--brass-500) / <alpha-value>)',
          600: 'rgb(var(--brass-600) / <alpha-value>)',
          700: 'rgb(var(--brass-700) / <alpha-value>)',
          800: 'rgb(var(--brass-800) / <alpha-value>)',
          900: 'rgb(var(--brass-900) / <alpha-value>)',
        },
        ink: {
          50:  'rgb(var(--ink-50) / <alpha-value>)',
          100: 'rgb(var(--ink-100) / <alpha-value>)',
          200: 'rgb(var(--ink-200) / <alpha-value>)',
          300: 'rgb(var(--ink-300) / <alpha-value>)',
          400: 'rgb(var(--ink-400) / <alpha-value>)',
          500: 'rgb(var(--ink-500) / <alpha-value>)',
          600: 'rgb(var(--ink-600) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          800: 'rgb(var(--ink-800) / <alpha-value>)',
          900: 'rgb(var(--ink-900) / <alpha-value>)',
          950: 'rgb(var(--ink-950) / <alpha-value>)',
        },
      },
      fontFamily: {
        display: ['"Bebas Neue"', 'Impact', 'system-ui', 'sans-serif'],
        sans: ['"Inter"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 32px rgba(216,169,32,0.35)',
        felt: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.4)',
      },
      backgroundImage: {
        'felt-radial': 'radial-gradient(ellipse at top, rgb(var(--felt-700)) 0%, rgb(var(--felt-950)) 70%)',
        'felt-card':   'linear-gradient(180deg, rgb(var(--felt-800)) 0%, rgb(var(--felt-950)) 100%)',
        'brass-shine': 'linear-gradient(135deg, rgb(var(--shine-from)) 0%, rgb(var(--shine-mid)) 50%, rgb(var(--shine-to)) 100%)',
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'count-up': 'countUp 600ms ease-out',
        'shine': 'shine 2.5s ease-in-out infinite',
      },
      keyframes: {
        countUp: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        shine: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
