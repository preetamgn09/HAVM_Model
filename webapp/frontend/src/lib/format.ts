export const fx = (v: unknown, d = 3) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—";
export const pct = (v: unknown, d = 0) =>
  typeof v === "number" && Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : "—";
export const int = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v).toLocaleString("en-US") : "—";
export const signed = (v: unknown, d = 3) =>
  typeof v === "number" && Number.isFinite(v) ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}` : "—";

export function when(iso?: string | null, withTime = true) {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  const date = dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  if (!withTime) return date;
  const time = dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return `${date}, ${time} UTC`;
}

export const humanize = (s?: string | null) =>
  !s ? "—" : s.replace(/::/g, ": ").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export const MONITOR_NAMES: Record<string, string> = {
  a1_distribution: "Distribution shift (A1)",
  a2_relational: "Relational / performance (A2)",
  a3_structural: "Structural / schema (A3)",
  a4_operational: "Operational (A4)",
  ood: "Out-of-distribution",
  calibration: "Calibration",
  fairness: "Fairness / subgroup",
};
export const mname = (id?: string | null) => (id ? MONITOR_NAMES[id] ?? humanize(id) : "—");

export const STATE_LABEL: Record<string, string> = {
  NORMAL: "Normal", MONITOR: "Monitor", GOVERNANCE_REVIEW: "Governance review",
  HUMAN_REVIEW_REQUIRED: "Human review required", ABSTENTION_RECOMMENDED: "Abstention recommended",
  AUTOMATED_PREDICTION_SUSPENSION: "Suspension recommended",
};
export const STATE_COLOR: Record<string, string> = {
  NORMAL: "#4E9E8C", MONITOR: "#5BC6E4", GOVERNANCE_REVIEW: "#E2A543",
  HUMAN_REVIEW_REQUIRED: "#E3834A", ABSTENTION_RECOMMENDED: "#E2686A",
  AUTOMATED_PREDICTION_SUSPENSION: "#C4426E",
};
export const STATES = Object.keys(STATE_LABEL);

export const EVIDENCE_COLOR: Record<string, string> = {
  OBSERVED: "#2FB5A3", INJECTED: "#D9A04A", SIMULATED: "#A08EF0", POLICY: "#7D95C0",
};
export const HARM_COLOR: Record<string, string> = { NONE: "#4E9E8C", POTENTIAL: "#E2A543", MEASURED: "#E2686A" };

export const CHART = {
  grid: "#1C2D4A", axis: "#5F7190", teal: "#2FB5A3", cyan: "#5BC6E4", amber: "#D9A04A",
  rose: "#E2686A", violet: "#A08EF0", slate: "#7D95C0", text: "#E3E9F2",
};
