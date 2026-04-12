/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        navy: '#1a2b3c',
        'navy-light': '#2c4560',
        cream: '#faf8f3',
        'cream-dark': '#f0ede4',
        green: {
          50: '#eaf5ee',
          200: '#a8d8b4',
          500: '#3a8f55',
          700: '#1f5e36',
        },
        text: '#1a2b3c',
        'text-muted': '#5a6a7a',
      },
      borderRadius: {
        soft: '16px',
      },
      boxShadow: {
        soft: '0 12px 30px rgba(26, 43, 60, 0.08)',
      },
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        serif: ['DM Serif Display', 'serif'],
      },
    },
  },
  plugins: [],
};
