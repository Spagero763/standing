import type { Config } from 'tailwindcss'

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#07070b',
        surface: '#0e0f16',
        edge: '#1c1e2a',
        muted: '#8b8fa3',
        proof: '#5eead4',
        credit: '#a78bfa',
        warn: '#fb923c'
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      }
    }
  },
  plugins: []
} satisfies Config
