/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'indigo-deep': '#080f1e',
        'indigo-water': '#0b1728',
        'indigo-mid': '#0f2040',
        gold: '#e8c84a',
        'gold-soft': '#f2d96a',
        olive: '#3a5228',
        'olive-light': '#5a7840',
        'olive-continue': '#3a8a5a',
        chalk: '#f0ede0',
        'chalk-dim': '#b8b49e',
        'lotus-white': '#ddeaf8',
        terracotta: '#c8773a',
      },
      fontFamily: {
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['"Noto Sans"', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Nothing below 20px for body copy — elderly-first typography.
        base: ['20px', '1.6'],
        lg: ['24px', '1.5'],
        xl: ['28px', '1.4'],
      },
    },
  },
  plugins: [],
}
