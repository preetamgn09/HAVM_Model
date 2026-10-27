import { describe, expect, it } from "vitest";
import { MONITOR_NAMES, STATES, STATE_COLOR, STATE_LABEL, fx, int, mname, pct, signed, when } from "../format";

describe("number formatting never invents a value", () => {
  it("renders missing or non-finite values as a dash", () => {
    for (const f of [fx, pct, int, signed]) {
      expect(f(null)).toBe("—");
      expect(f(undefined)).toBe("—");
      expect(f(Number.NaN)).toBe("—");
      expect(f("0.5" as unknown)).toBe("—");
    }
  });
  it("formats finite values", () => {
    expect(fx(0.9130434782608696)).toBe("0.913");
    expect(pct(0.82, 0)).toBe("82%");
    expect(int(55848)).toBe("55,848");
    expect(signed(-0.0543768905021174)).toBe("−0.054");
    expect(signed(0.015)).toBe("+0.015");
  });
  it("formats timestamps in UTC and passes through unparseable input", () => {
    expect(when("2026-08-20T05:16:47.190630+00:00")).toBe("20 Aug 2026, 05:16 UTC");
    expect(when(null)).toBe("—");
    expect(when("not-a-date")).toBe("not-a-date");
  });
});

describe("vocabulary matches the research package", () => {
  it("lists the six governance states in havm.governance.STATES order", () => {
    expect(STATES).toEqual(["NORMAL", "MONITOR", "GOVERNANCE_REVIEW", "HUMAN_REVIEW_REQUIRED",
      "ABSTENTION_RECOMMENDED", "AUTOMATED_PREDICTION_SUSPENSION"]);
    for (const s of STATES) { expect(STATE_LABEL[s]).toBeTruthy(); expect(STATE_COLOR[s]).toMatch(/^#/); }
  });
  it("names the seven monitors and falls back for unknown ids", () => {
    for (const m of ["a1_distribution", "a2_relational", "a3_structural", "a4_operational", "ood", "calibration", "fairness"])
      expect(Object.keys(MONITOR_NAMES)).toContain(m);
    expect(mname("new_monitor")).toBe("New monitor");
  });
});
