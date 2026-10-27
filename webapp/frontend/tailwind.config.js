/** Palette: navy/slate surfaces, one teal accent. Colour beyond that carries meaning only:
 *  evidence class (observed / injected / simulated / policy) and governance severity. */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0C1524",
        surface: "#121E33",
        raised: "#182840",
        line: "#24375A",
        hair: "#1C2D4A",
        text: "#E3E9F2",
        muted: "#8C9CB5",
        faint: "#5F7190",
        teal: { DEFAULT: "#2FB5A3", soft: "#1D4A4A" },
        cyan: "#5BC6E4",
        ev: { observed: "#2FB5A3", injected: "#D9A04A", simulated: "#A08EF0", policy: "#7D95C0" },
        st: { normal: "#4E9E8C", monitor: "#5BC6E4", review: "#E2A543", human: "#E3834A",
              abstain: "#E2686A", suspend: "#C4426E" },
      },
      fontFamily: {
        sans: ["'IBM Plex Sans'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
      fontSize: { "2xs": ["0.6875rem", "1rem"] },
    },
  },
  plugins: [],
};
