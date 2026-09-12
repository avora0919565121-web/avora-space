// Browser tests assert real on-screen geometry, which only exists once the design system
// has actually been applied. Without this the Tailwind classes are inert, every element
// measures 0×0, and a passing test would mean nothing.
import "@/index.css";
