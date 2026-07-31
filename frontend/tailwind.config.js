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
        // Accent — teal/emerald (Round 12: switched again, this time
        // to option "B" from the original 3-way mockup -- Avs shared a
        // screenshot of that exact card and asked to use "the white
        // and green one"). Every component references brand-50/100/
        // 500/600/700 by name, never a literal hex (confirmed via a
        // full grep sweep both times this palette has changed), so
        // this is again a two-file edit (this + index.css's CSS
        // vars) -- no component files touched for the base color.
        // Contrast-checked against WCAG AA (white-on-600 buttons
        // 5.72:1, 700-on-50 badges 8.3:1) before landing -- darkened
        // slightly versus the screenshot's literal color so white
        // button text stays comfortably readable.
        brand: {
          50:  '#EDF8F4',
          100: '#C6ECDE',
          500: '#259D71',
          600: '#1B7453',
          700: '#13533B',
        },
        // Secondary accent — coral (the second half of the "teal +
        // coral" two-tone direction). Used specifically for the
        // Senior role's identity color everywhere it appears (badges
        // in the header account menu, Manage Users, HR directory),
        // replacing the generic Tailwind amber that was there before
        // -- swapped in every one of those spots for consistency, not
        // just the one place that happened to get touched first. NOT
        // used for the unrelated "X pending" amber badges elsewhere
        // (maintenance/approval pending counts) -- those keep amber's
        // standard warning/pending meaning, which is a different
        // concept from the Senior role and shouldn't be visually
        // conflated with it.
        coral: {
          50:  '#F8E8E2',
          100: '#F2CDC0',
          500: '#E77C55',
          600: '#DF5320',
          700: '#A13C17',
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
