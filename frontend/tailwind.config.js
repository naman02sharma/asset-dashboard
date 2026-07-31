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
        // Accent — indigo/violet (Round 11 theme change, chosen by
        // Avs from a 3-way mockup comparison: kept the original
        // teal-blue as "A", added a teal+coral two-tone as "B", this
        // indigo direction as "C" -- "C" was picked for a more premium
        // SaaS feel). Every component references brand-50/100/500/
        // 600/700 by name rather than a literal hex (confirmed via a
        // full grep sweep before this change), so this single edit is
        // the entire color change -- no component files needed
        // touching. Contrast-checked against WCAG AA for every real
        // pairing used in the app (white-on-600 buttons, 700-on-50/100
        // badges, 600-on-white active nav text) before landing.
        brand: {
          50:  '#F2F1FB',
          100: '#D3D1F0',
          500: '#8A86D5',
          600: '#5751C2',
          700: '#3A3597',
        },
        // shadcn/ui's semantic token set (border/input/ring/background/
        // foreground/primary/secondary/muted/accent/destructive/card/
        // popover), added as CSS-variable-backed colors per shadcn's
        // usual convention -- but the variables themselves (see
        // index.css :root) are set to THIS app's existing brand/slate
        // palette above, not shadcn's generic zinc/default theme, so
        // shadcn components (Tooltip, DropdownMenu, sonner toasts,
        // Badge) come out looking native to the app rather than like a
        // bolted-on template. Kept alongside the named brand/slate
        // scale above rather than replacing it -- every existing
        // className using brand-600/slate-200/etc. keeps working
        // unchanged.
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        // Mapped to the project's existing rounded-xl/rounded-lg feel
        // (see --radius in index.css) so shadcn primitives match the
        // rest of the app's corner rounding instead of introducing a
        // different one.
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
