import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      screens: {
        // A real mouse/trackpad. Touch screens miss this, so hover-only reveals can stay visible there.
        hoverable: { raw: "(hover: hover) and (pointer: fine)" },
        // AVORA-57 · I: a phone on its side — judged by height, not width.
        short: { raw: "(max-height: 500px) and (orientation: landscape)" },
      },
      // AVORA-101B · KHỐI 2E (ADR-079): one inset for every tab's title and strip; four spacing steps.
      spacing: {
        tab: "var(--tab-inset)",
        "s-1": "var(--space-1)",
        "s-2": "var(--space-2)",
        "s-3": "var(--space-3)",
        "s-4": "var(--space-4)",
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        online: "hsl(var(--online))",
        // AVORA-74 (ADR-046): the person's own tone. `primary` stays Avora's terracotta.
        personal: {
          DEFAULT: "hsl(var(--personal))",
          foreground: "hsl(var(--personal-foreground))",
          soft: "hsl(var(--personal-soft))",
          "soft-foreground": "hsl(var(--personal-soft-foreground))",
        },
        star: {
          DEFAULT: "hsl(var(--star))",
          soft: "hsl(var(--star-soft))",
        },
        money: {
          in: "hsl(var(--money-in))",
          out: "hsl(var(--money-out))",
        },
        task: {
          overdue: "hsl(var(--task-overdue))",
          "due-soon": "hsl(var(--task-due-soon))",
          routine: "hsl(var(--task-routine))",
          idle: "hsl(var(--task-idle))",
          important: "hsl(var(--task-important))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      fontFamily: {
        // AVORA-101B · KHỐI 2E: one family for the whole app, chosen in Cài đặt (`--font-sans`).
        sans: ["var(--font-sans)"],
        // AVORA-77 · D3: the reader's serif — system serifs that carry Vietnamese marks well.
        reader: ["Charter", "'Iowan Old Style'", "'Noto Serif'", "Georgia", "'Times New Roman'", "serif"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // AVORA-101B · KHỐI 2E: two radii — controls follow Kiểu nút, cards are 16 px. The old
        // xl / 2xl / 3xl steps all read the card radius, so no stray corner survives anywhere.
        control: "var(--radius-control)",
        card: "var(--radius-card)",
        xl: "var(--radius-card)",
        "2xl": "var(--radius-card)",
        "3xl": "var(--radius-card)",
        bubble: "var(--radius-card)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        "rise-in": {
          from: {
            opacity: "0",
            transform: "translateY(6px)",
          },
          to: {
            opacity: "1",
            transform: "translateY(0)",
          },
        },
        "bubble-in": {
          from: {
            opacity: "0",
            transform: "translateY(8px) scale(0.98)",
          },
          to: {
            opacity: "1",
            transform: "translateY(0) scale(1)",
          },
        },
        blink: {
          "0%, 80%, 100%": {
            opacity: "0.25",
            transform: "translateY(0)",
          },
          "40%": {
            opacity: "1",
            transform: "translateY(-2px)",
          },
        },
        "burst-pop": {
          "0%": {
            opacity: "0",
            transform: "scale(0.72)",
          },
          "40%": {
            opacity: "1",
            transform: "scale(1.04)",
          },
          "100%": {
            opacity: "1",
            transform: "scale(1)",
          },
        },
        "burst-ring": {
          "0%": {
            opacity: "0.5",
            transform: "scale(0.55)",
          },
          "100%": {
            opacity: "0",
            transform: "scale(1.9)",
          },
        },
        /* The press of a feeling: down, overshoot, settle. Every emoji, not just the heart. */
        "emoji-bounce": {
          "0%": {
            transform: "scale(1)",
          },
          "25%": {
            transform: "scale(0.86)",
          },
          "55%": {
            transform: "scale(1.32)",
          },
          "100%": {
            transform: "scale(1)",
          },
        },
        /* AVORA-51: a wrong Két sắt code — a small shake, not an alarm. */
        "code-shake": {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-7px)" },
          "40%": { transform: "translateX(6px)" },
          "60%": { transform: "translateX(-4px)" },
          "80%": { transform: "translateX(2px)" },
        },
      },
      animation: {
        "code-shake": "code-shake 0.42s cubic-bezier(0.36, 0.07, 0.19, 0.97) both",
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "rise-in": "rise-in 0.45s cubic-bezier(0.16, 1, 0.3, 1) both",
        "bubble-in": "bubble-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) both",
        blink: "blink 1.4s ease-in-out infinite",
        "burst-pop": "burst-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        "burst-ring": "burst-ring 1.1s cubic-bezier(0.16, 1, 0.3, 1) both",
        "emoji-bounce": "emoji-bounce 0.26s cubic-bezier(0.34, 1.56, 0.64, 1) both",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
