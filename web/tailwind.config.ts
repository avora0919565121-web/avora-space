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
        sans: ["Inter Tight", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        bubble: "1rem",
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
      },
      animation: {
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
