import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        gold: {
          DEFAULT: '#c9a84c',
          dim:     '#7a6330',
          bright:  '#e8c55a',
        },
      },
      transitionDuration: {
        '1500': '1500ms',
      },
      fontFamily: {
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        sans:  ['"Inter"', 'Helvetica Neue', 'sans-serif'],
      },
      keyframes: {
        'ken-burns': {
          '0%':   { transform: 'scale(1.0) translate(0, 0)' },
          '100%': { transform: 'scale(1.08) translate(-1%, -1%)' },
        },
        'word-in': {
          '0%':   { opacity: '0', transform: 'translateY(5px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-gold': {
          '0%, 100%': { transform: 'scale(1)',   opacity: '0.8' },
          '50%':       { transform: 'scale(1.1)', opacity: '1' },
        },
        'caption-glow': {
          '0%':   { textShadow: '0 0 15px rgba(201,168,76,0.3)' },
          '100%': { textShadow: '0 0 30px rgba(201,168,76,0.7)' },
        },
        'fade-up': {
          '0%':   { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'reel-spin': {
          to: { transform: 'rotate(360deg)' },
        },
        'slide-up': {
          '0%':   { opacity: '0', transform: 'translateX(-50%) translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateX(-50%) translateY(0)' },
        },
      },
      animation: {
        'ken-burns':    'ken-burns 15s ease-in-out infinite alternate',
        'word-in':      'word-in 0.2s ease forwards',
        'pulse-gold':   'pulse-gold 1.5s ease-in-out infinite',
        'caption-glow': 'caption-glow 3s ease-in-out infinite alternate',
        'fade-up':      'fade-up 0.5s ease forwards',
        'reel-spin':    'reel-spin 2s linear infinite',
        'slide-up':     'slide-up 0.3s ease forwards',
      },
    },
  },
  plugins: [],
} satisfies Config;
