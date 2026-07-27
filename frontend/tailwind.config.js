/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      colors: {
        // Whitish neutral scale — lightest steps pushed whiter than
        // the reference palette itself (true white/near-white for
        // 50/100) per "keep more whitish", then anchored on the given
        // swatches for the mid/dark tones: #E8E9F3 (200), #CECECE
        // (300), #A6A6A8 (400), #272635 (900, body text/darkest).
        slate: {
          50:  '#FCFCFE',
          100: '#F5F6FA',
          200: '#E8E9F3',
          300: '#CECECE',
          400: '#A6A6A8',
          500: '#87878C',
          600: '#68686F',
          700: '#4B4A54',
          800: '#332F3F',
          900: '#272635',
          950: '#18171F',
        },
        // Accent — a saturated blue derived from the palette's sky
        // swatch (#B1E5F2), which is too pale on its own for readable
        // buttons/links; kept as brand-100 for soft highlight
        // backgrounds, with a deeper blue for the interactive states.
        brand: {
          50:  '#EEFAFD',
          100: '#B1E5F2',
          500: '#2E9CBE',
          600: '#1C7E9E',
          700: '#146178',
        },
      },
    },
  },
  plugins: [],
};
