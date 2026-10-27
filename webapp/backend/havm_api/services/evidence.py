"""Research Evidence Lab.

Two kinds of output, always labelled:

  recorded    values read verbatim from results/metrics/*.json
  recomputed  values recomputed on request from stored per-window raw metrics using the
              project's own havm.sweep.rescore / havm.sweep.evaluate. The default policy
              reproduces the recorded EXP005/EXP006 values exactly (asserted by test), so a
              changed policy is a like-for-like counterfactual on identical measurements.

Nothing here re-runs a monitor or touches patient-level data.
"""
from __future__ import annotations

import numpy as np
from havm.aggregation import compute_ahs
from havm.sweep import evaluate, rescore

from havm_api import artifacts as A

SENS = "results/metrics/EXP004-006_sensitivity.json"
OOD = "results/metrics/EXP007-008_ood_and_full_ahs.json"
SCALE = "results/metrics/EXP009-010_scalability_stability.json"
REPLAY = "results/metrics/EXP003_replay.json"
REG3 = "results/registry/EXP003_registry.json"
REG8 = "results/registry/EXP008_registry.json"
SCORES = "results/scores/EXP011_deployment_ood_scores.csv.gz"
BOOT = "results/metrics/EXP011_bootstrap_{}.json"

BANK_MONITORS = ["a1_distribution", "a3_structural", "calibration", "fairness"]
DETECTORS = ["mahalanobis", "knn", "isolation_forest", "predictive_entropy", "max_softmax", "energy"]
UNCERTAINTY = {"predictive_entropy", "max_softmax", "energy"}


def _f(x):
    return None if x is None else float(x)


# --------------------------------------------------------------------------- findings
def _n_eval(m: dict) -> int:
    return int(m["tp"] + m["fp"] + m["fn"] + m["tn"])


def _bands() -> dict:
    g = A.monitor_config()["governance"]["bands"]
    return {"review": g["review"], "suspension": g["suspension"], "width": g["review"] - g["suspension"],
            "source": A.source("configs/monitors.yaml", "governance.bands", "POLICY")}


def _bank_counts(sens: dict) -> dict:
    """Window-bank composition, counted from the stored bank (run_g6 holds out the first 10
    clean windows to calibrate the empirical-quantile null)."""
    bank = sens["window_bank"]
    clean = [w for w in bank if w["degraded"] == 0]
    full = sens["exp006_baselines_and_ablation"]["full_havm_ahs"]
    n_eval = _n_eval(full)
    held_out = len(bank) - n_eval
    sev = sorted({w["severity"] for w in bank if w["degraded"]})
    # F1 change if exactly one missed window had been detected: the size of "one window".
    tp, fp, fn = full["tp"], full["fp"], full["fn"]
    f1_plus = evaluate([1] * (tp + 1) + [1] * fp + [0] * (fn - 1), [1] * (tp + 1) + [0] * fp + [1] * (fn - 1))["f1"] if fn else None
    return {"n_bank": len(bank), "n_clean": len(clean), "n_degraded": len(bank) - len(clean),
            "n_eval": n_eval, "n_eval_clean": full["fp"] + full["tn"], "n_eval_degraded": tp + fn,
            "n_held_out_clean": held_out, "severities": sev,
            "per_severity": len([w for w in bank if w["severity"] == sev[0]]) if sev else 0,
            "one_window_f1_step": (f1_plus - full["f1"]) if f1_plus is not None and full["f1"] is not None else None}


def _integrity_note() -> dict | None:
    chk = or_rule_bootstrap_check()
    if not chk or not chk["recorded_reproduced_with_a1_only_or"]:
        return None
    c = chk["corrected"]
    return {"corrected_ci95": c["ci95"], "corrected_delta_f1_mean": c["delta_f1_mean"],
            "text": "The recorded interval was computed against an A1-only OR-rule (see Evidence Lab). "
                    "Against the four-monitor OR-rule it is [{:.3f}, {:.3f}], mean {:+.3f}; the conclusion "
                    "is unchanged.".format(c["ci95"][0], c["ci95"][1], c["delta_f1_mean"])}


def findings() -> list[dict]:
    """The headline results, each derived from its file and carrying its provenance."""
    out = []
    sens = A.optional_json(SENS)
    if sens:
        lad = sens["exp006_baselines_and_ablation"]
        boot = lad["_bootstrap_vs_challengers"]["independent_or_rule"]
        out.append({
            "id": "integration", "question": "RQ1",
            "title": "Composite scoring shows no established detection advantage",
            "values": {"ahs_f1": lad["full_havm_ahs"]["f1"], "or_rule_f1": lad["independent_or_rule"]["f1"],
                       "delta_f1_mean": boot["delta_f1_mean"], "ci95": boot["ci95"],
                       "excludes_zero": boot["excludes_zero"], "n_resamples": boot["n_resamples"]},
            "evidence_class": "INJECTED",
            "statement": "On {} evaluation windows, full AHS reached F1 {:.3f} against {:.3f} for the "
                         "independent OR-rule. The bootstrap 95% interval for the difference is "
                         "[{:.3f}, {:.3f}] and does not exclude zero, so the integration advantage is "
                         "not statistically established.".format(
                             _n_eval(lad["full_havm_ahs"]), lad["full_havm_ahs"]["f1"], lad["independent_or_rule"]["f1"], *boot["ci95"]),
            "source": A.source(SENS, "exp006_baselines_and_ablation", "INJECTED"),
            "integrity_note": _integrity_note(),
        })
    rep = A.optional_json(REPLAY)
    if rep:
        a = rep["part_a_observed"]["governance"]
        col = a["collapsed"]["state_occupancy"]["AUTOMATED_PREDICTION_SUSPENSION"]
        sep = a["separated"]["state_occupancy"]["AUTOMATED_PREDICTION_SUSPENSION"]
        out.append({
            "id": "separation", "question": "RQ9",
            "title": "Separating detection from governance prevents inappropriate escalation",
            "values": {"collapsed_suspension_windows": col, "separated_suspension_windows": sep,
                       "n_windows": a["collapsed"]["n_windows"]},
            "evidence_class": "SIMULATED",
            "statement": f"On identical monitor output, the collapsed policy recommended suspension in "
                         f"{col} of {a['collapsed']['n_windows']} windows; the separated policy in {sep}. "
                         "The governance policy is a simulation with no human in it.",
            "source": A.source(REPLAY, "part_a_observed.governance", "SIMULATED",
                               "Monitor output OBSERVED; governance decisions are POLICY outputs"),
        })
    ood = A.optional_json(OOD)
    if ood:
        b = ood["exp007_ood_bakeoff"]
        ped = b["groups"].get("paediatric_and_adolescent", {}).get("auroc", {})
        out.append({
            "id": "ood", "question": "RQ3",
            "title": "Uncertainty-based OOD detection fails on tabular EHR",
            "values": {"uncertainty_family_mean": b["uncertainty_family_mean"],
                       "distance_density_family_mean": b["distance_density_family_mean"],
                       "paediatric_entropy_auroc": ped.get("predictive_entropy")},
            "evidence_class": "OBSERVED",
            "statement": "Uncertainty detectors averaged AUROC {:.3f} (chance is 0.5) against {:.3f} for "
                         "distance and density methods. On paediatric and adolescent patients predictive "
                         "entropy is inverted at {:.3f}: the model is most confident about the patients "
                         "least represented in training.".format(
                             b["uncertainty_family_mean"], b["distance_density_family_mean"],
                             ped.get("predictive_entropy", float("nan"))),
            "source": A.source(OOD, "exp007_ood_bakeoff", "OBSERVED",
                               "OOD groups defined by clinical criteria fixed before scoring"),
        })
    sc = A.optional_json(SCALE)
    if sc:
        st = sc["exp010_ahs_stability"]
        rows = sorted(((v["window_rows"], v) for v in st["by_window_count"].values()), key=lambda t: t[0])
        small, large = rows[0][1], rows[-1][1]
        band = st["governance_band_width"]
        span = lambda v: v["p05_p95"][1] - v["p05_p95"][0]
        out.append({
            "id": "stability", "question": "RQ4",
            "title": "Small monitoring windows make the AHS unstable",
            "values": {"small_window_rows": small["window_rows"], "small_span": span(small),
                       "large_window_rows": large["window_rows"], "large_span": span(large),
                       "governance_band_width": band},
            "evidence_class": "OBSERVED",
            "statement": "On unchanged data, the 5–95% AHS span is {:.3f} at ≈{:,} rows ({:.0%} of the "
                         "{:.2f} governance band) and {:.3f} at ≈{:,} rows ({:.0%}).".format(
                             span(small), small["window_rows"], span(small) / band, band,
                             span(large), large["window_rows"], span(large) / band),
            "source": A.source(SCALE, "exp010_ahs_stability", "OBSERVED",
                               "30 random partitions of the deployment domain per window size"),
        })
    return out


# --------------------------------------------------------------------------- bootstrap check
_or_check_cache: dict = {}


def or_rule_bootstrap_check() -> dict | None:
    """Re-derive the recorded "AHS vs independent OR-rule" bootstrap.

    scripts/run_g6.py stores the OR-rule decisions with decision_store.setdefault(...) on the
    FIRST tagged sweep call, which is single::a1_distribution (weights {a1: 1.0}). Because
    havm.sweep.rescore skips zero-weight monitors before checking triggers, those stored
    decisions are an OR over A1 only. This function recomputes both versions with the
    script's own procedure so the difference is shown rather than asserted. The recorded
    artefact is not modified."""
    key = A.mtime_iso(SENS)
    if key in _or_check_cache:
        return _or_check_cache[key]
    sens = A.optional_json(SENS)
    if not sens:
        return None
    d = _bank_inputs()
    w4 = {m: d["default_weights"][m] for m in BANK_MONITORS}

    def decisions(weights):
        ahs, orr = [], []
        for res in d["results"]:
            sc = rescore(res, weights=weights, normalisation="threshold_relative", thresholds={},
                         baselines=d["baselines"], entry_mode=d["entry_mode"], ahs_band=0.75,
                         null_quantiles=d["null_q"])
            ahs.append(sc["alert_ahs"])
            orr.append(sc["alert_or_rule"])
        return ahs, orr

    ahs, or_full = decisions(w4)
    _, or_a1 = decisions({"a1_distribution": 1.0})
    y = np.asarray(d["truth"])

    def boot(a, b, rng):
        a, b = np.asarray(a, int), np.asarray(b, int)
        diffs = []
        for _ in range(2000):
            idx = rng.integers(0, len(y), len(y))
            fa = evaluate(a[idx].tolist(), y[idx].tolist())["f1"]
            fb = evaluate(b[idx].tolist(), y[idx].tolist())["f1"]
            if fa is not None and fb is not None:
                diffs.append(fa - fb)
        lo, hi = float(np.percentile(diffs, 2.5)), float(np.percentile(diffs, 97.5))
        return {"delta_f1_mean": float(np.mean(diffs)), "ci95": [lo, hi],
                "excludes_zero": bool(lo > 0 or hi < 0), "n_resamples": len(diffs)}

    replicated = boot(ahs, or_a1, np.random.default_rng(20260819))
    corrected = boot(ahs, or_full, np.random.default_rng(20260819))
    recorded = sens["exp006_baselines_and_ablation"]["_bootstrap_vs_challengers"]["independent_or_rule"]
    reproduced = (abs(replicated["delta_f1_mean"] - recorded["delta_f1_mean"]) < 1e-12
                  and np.allclose(replicated["ci95"], recorded["ci95"]))
    out = {
        "recorded": recorded,
        "recorded_reproduced_with_a1_only_or": reproduced,
        "a1_only_or_equals_single_a1": or_a1 == decisions({"a1_distribution": 1.0})[0],
        "four_monitor_or_differs": or_full != or_a1,
        "or_alerts": {"four_monitor": int(sum(or_full)), "a1_only": int(sum(or_a1))},
        "corrected": corrected,
        "conclusion_unchanged": not corrected["excludes_zero"] and not recorded["excludes_zero"],
        "explanation": "The recorded interval compares AHS with OR-rule decisions stored during the "
                       "single::a1_distribution sweep, i.e. an OR over A1 alone. The ladder's OR-rule "
                       "F1 (0.898) is correct; only the bootstrap used the A1-only decisions. "
                       "Recomputed against the four-monitor OR-rule with the same procedure and seed, "
                       "the interval still includes zero, so the conclusion is unchanged.",
        "method": "Recomputed with havm.sweep.rescore/evaluate on the stored window bank, 2,000 "
                  "resamples, seed 20260819 (scripts/run_g6.py procedure).",
    }
    _or_check_cache[key] = out
    return out


# --------------------------------------------------------------------------- lab datasets
def lab() -> dict:
    sens = A.optional_json(SENS)
    ood = A.optional_json(OOD)
    sc = A.optional_json(SCALE)
    rep = A.optional_json(REPLAY)
    out: dict = {"findings": findings(), "available": {}, "bands": _bands()}

    if sens:
        lad = sens["exp006_baselines_and_ablation"]
        rows = []
        for key, m in lad.items():
            if key.startswith("_"):
                continue
            kind = key.split("::")[0] if "::" in key else key
            rows.append({"id": key, "kind": kind, "label": key.split("::")[-1].replace("+", " + "),
                         **{k: m.get(k) for k in ("precision", "recall", "f1", "false_alarm_rate",
                                                  "alert_rate", "tp", "fp", "fn", "tn")}})
        out["ladder"] = {"rows": rows, "n_eval_windows": _n_eval(lad["full_havm_ahs"]), "bank": _bank_counts(sens),
                         "sweep_band": _sweep_band(),
                         "ground_truth": sens["ground_truth"],
                         "source": A.source(SENS, "exp006_baselines_and_ablation", "INJECTED")}
        out["bootstrap"] = {"comparisons": [{"challenger": k, **v} for k, v in
                                            lad["_bootstrap_vs_challengers"].items()],
                            "integrity_check": or_rule_bootstrap_check(),
                            "source": A.source(SENS, "exp006_baselines_and_ablation._bootstrap_vs_challengers",
                                               "INJECTED")}
        out["thresholds"] = {"rows": [{"band": float(b), **m} for b, m in
                                      sorted(sens["exp005a_threshold_sensitivity"].items(), key=lambda t: float(t[0]))],
                             "source": A.source(SENS, "exp005a_threshold_sensitivity", "INJECTED")}
        out["normalisation"] = {"rows": [{"method": k, **v} for k, v in
                                         sens["exp005b_normalisation_sensitivity"].items() if v],
                                "source": A.source(SENS, "exp005b_normalisation_sensitivity", "INJECTED")}
        ws = sens["exp005c_weight_sensitivity"]
        out["weights"] = {"named": [{"config": k, **v} for k, v in ws.items() if k != "random_dirichlet"],
                          "random_dirichlet": ws.get("random_dirichlet"),
                          "source": A.source(SENS, "exp005c_weight_sensitivity", "INJECTED")}
        nb = sens["exp004_ahs_null_band_by_window_size"]
        out["null_band"] = {"rows": [{"window_rows": int(k), **{x: v[x] for x in ("mean", "sd", "p05_p95", "range", "scores")}}
                                     for k, v in sorted(nb.items(), key=lambda t: int(t[0]))],
                            "source": A.source(SENS, "exp004_ahs_null_band_by_window_size", "OBSERVED",
                                               "Clean windows resampled from source validation")}
        out["available"]["sensitivity"] = True
    else:
        out["available"]["sensitivity"] = False

    if sc:
        st = sc["exp010_ahs_stability"]
        out["stability"] = {
            "rows": [{"window_count": int(k), **v} for k, v in sorted(st["by_window_count"].items(), key=lambda t: int(t[0]))],
            "governance_band_width": st["governance_band_width"],
            "source": A.source(SCALE, "exp010_ahs_stability", "OBSERVED"),
        }
        s9 = sc["exp009_scalability"]
        out["scalability"] = {
            "by_window_size": [v for _, v in sorted(s9["by_window_size"].items(), key=lambda t: int(t[0]))],
            "by_reference_fraction": [{"fraction": float(k), **v} for k, v in
                                      sorted(s9["by_reference_fraction"].items(), key=lambda t: float(t[0]))],
            "pipeline_seconds": s9["pipeline_seconds"], "ood_fit_seconds": s9.get("ood_fit_seconds"),
            "seven_monitor_seconds_n5000": s9.get("seven_monitor_seconds_n5000"),
            "four_monitor_seconds_n5000": s9.get("four_monitor_seconds_n5000"),
            "hardware": sc.get("hardware"),
            "source": A.source(SCALE, "exp009_scalability", "OBSERVED"),
        }
        out["available"]["scalability"] = True
    else:
        out["available"]["scalability"] = False

    if ood:
        b = ood["exp007_ood_bakeoff"]
        groups = []
        for g, v in b["groups"].items():
            boot = A.optional_json(BOOT.format(g))
            ci = boot["interval"] if boot else None
            boot_meta = boot.get("bootstrap") if boot else None
            groups.append({"group": g, "n_in_group": v["n_in_group"], "rationale": v["rationale"],
                           "detectors": [{"detector": d, "auroc": v["auroc"][d],
                                          "ci95": ci[d]["ci95"] if ci and d in ci else None,
                                          "family": "uncertainty" if d in UNCERTAINTY else "distance_density"}
                                         for d in DETECTORS if d in v["auroc"]],
                           "bootstrap_available": bool(ci), "bootstrap": boot_meta})
        out["ood"] = {"groups": groups, "mean_auroc": b["mean_auroc"], "ranking": b["ranking"],
                      "uncertainty_family_mean": b["uncertainty_family_mean"],
                      "distance_density_family_mean": b["distance_density_family_mean"],
                      "energy_note": b["energy_note"],
                      "source": A.source(OOD, "exp007_ood_bakeoff", "OBSERVED"),
                      "ci_source": A.source("results/metrics/EXP011_bootstrap_*.json", "interval", "OBSERVED",
                                            "2,000 stratified record-level resamples; detector fit held fixed")}
        e8 = ood["exp008_complete_ahs"]
        out["missing_monitors"] = _missing_monitor_bracket(e8)
        out["available"]["ood"] = True
    else:
        out["available"]["ood"] = False

    if rep:
        b = rep["part_b_injected"]
        out["severity_ramp"] = {
            "windows": [{"window_id": w["window_id"], "severity": w["meta"]["severity"], "ahs": w["ahs"],
                         "saturated": w["saturated"], "harm_level": w["harm_level"],
                         "states": w["states"], "violations": w["violations"]} for w in b["windows"]],
            "monotone_decreasing_on_ramp": b["monotone_decreasing_on_ramp"],
            "floor": _ramp_floor(b["windows"]),
            "source": A.source(REPLAY, "part_b_injected", "INJECTED"),
        }
    return out


def _sweep_band() -> float:
    """scripts/run_g6.py evaluates the ladder, weights and ablation at band 0.75, which is
    the review band of the EXP003 registry it loads."""
    reg = A.optional_json(REG3) or {}
    return reg.get("monitor_config", {}).get("governance", {}).get("bands", {}).get("review")


def _missing_monitor_bracket(e8: dict) -> dict | None:
    """Recompute the missing-monitor bracketing with havm.aggregation.compute_ahs from the
    stored EXP008 monitor results (the 0.677 figure is reported in the experiment log but not
    stored in a results file, so it is recomputed here rather than typed in)."""
    reg = A.optional_json(REG8)
    if not reg:
        return None
    four = [r for r in e8["monitors"] if r["monitor"] in BANK_MONITORS]
    partial = compute_ahs(four, reg)
    full = compute_ahs(e8["monitors"], reg)
    return {
        "seven_measured": full["ahs"],
        "four_missing_as_zero": partial["ahs_declared_weights"],
        "four_renormalised": partial["ahs_renormalised"],
        "recorded_four": e8["ahs_four_monitors"], "recorded_seven": e8["ahs_seven_monitors"],
        "matches_recorded": abs(partial["ahs_renormalised"] - e8["ahs_four_monitors"]) < 1e-9
                            and abs(full["ahs"] - e8["ahs_seven_monitors"]) < 1e-9,
        "source": A.source(OOD, "exp008_complete_ahs.monitors", "OBSERVED",
                           "Recomputed with havm.aggregation.compute_ahs and the EXP008 registry"),
    }


def _ramp_floor(windows: list[dict]) -> dict:
    """Which injected severities share the minimum AHS (saturation), and how far apart the
    clean (severity 0) windows are — both read off the recorded ramp."""
    lo = min(w["ahs"] for w in windows)
    floor_sev = sorted({w["meta"]["severity"] for w in windows if abs(w["ahs"] - lo) < 1e-9})
    clean = [w for w in windows if w["meta"]["severity"] == 0]
    return {"min_ahs": lo, "severities_at_floor": floor_sev,
            "clean_window_ids": [w["window_id"] for w in clean],
            "clean_ahs_range": [min(w["ahs"] for w in clean), max(w["ahs"] for w in clean)] if clean else None}


# --------------------------------------------------------------------------- OOD histograms
def paediatric_distributions(bins: int = 40) -> dict:
    """Aggregated score histograms (group vs remainder) per detector. Only binned densities
    leave the server; no per-record value is returned."""
    df = A.load_csv_gz_columns(SCORES)
    out = {}
    for group in ("paediatric_and_adolescent", "rare_specialty", "extreme_prior_utilisation"):
        col = f"group_{group}"
        if col not in df.columns:
            continue
        mask = df[col].to_numpy() == 1
        dets = {}
        for d in DETECTORS:
            s = df[f"score_{d}"].to_numpy(dtype=float)
            lo, hi = np.nanpercentile(s, [0.5, 99.5])
            edges = np.linspace(lo, hi, bins + 1)
            g, _ = np.histogram(np.clip(s[mask], lo, hi), bins=edges, density=True)
            r, _ = np.histogram(np.clip(s[~mask], lo, hi), bins=edges, density=True)
            dets[d] = {"edges": edges.tolist(), "group_density": g.tolist(), "remainder_density": r.tolist()}
        out[group] = {"n_group": int(mask.sum()), "n_remainder": int((~mask).sum()), "detectors": dets}
    return {"groups": out, "clipped_to_percentiles": [0.5, 99.5],
            "source": A.source(SCORES, None, "OBSERVED",
                               "Binned densities computed server-side; no record-level values are returned")}


# --------------------------------------------------------------------------- policy rescoring
def _bank_inputs():
    sens = A.load_json(SENS)
    reg = A.load_json(REG3)
    mc = reg["monitor_config"]
    thresholds = {
        "a1_distribution": ("max_psi", "psi", mc["monitors"]["a1_distribution"]["psi_threshold"]),
        "calibration": ("ece", "ece", mc["monitors"]["calibration"]["ece_threshold"]),
        "fairness": ("max_delta_tpr", "delta_tpr", mc["monitors"]["fairness"]["delta_tpr_threshold"]),
    }

    def reconstruct(window: dict) -> list[dict]:
        # Rebuild the minimal MonitorResult shape havm.sweep.raw_metric reads.
        res = []
        for m, v in window["raw"].items():
            if m == "a3_structural":
                res.append({"monitor": m, "raw": {"n_columns_affected": v, "n_columns_total": 1}, "threshold": {}})
            else:
                key, tkey, t = thresholds[m]
                res.append({"monitor": m, "raw": {key: v}, "threshold": {tkey: t}})
        return res

    bank = sens["window_bank"]
    # Exactly as scripts/run_g6.py: the first 10 clean windows calibrate the empirical-quantile
    # null and are held out of evaluation.
    calib = [w for w in bank if w["kind"] == "clean"][:10]
    calib_ids = {w["window_id"] for w in calib}
    evaluation = [w for w in bank if w["window_id"] not in calib_ids]
    null_q = {m: np.sort([w["raw"][m] for w in calib]) for m in BANK_MONITORS}
    baselines = {k: v["value"] for k, v in reg.get("freeze_baselines", {}).items()}
    return {"evaluation": evaluation, "results": [reconstruct(w) for w in evaluation],
            "truth": [w["degraded"] for w in evaluation], "null_q": null_q, "baselines": baselines,
            "entry_mode": mc["ahs"]["entry_mode"], "default_weights": mc["ahs"]["weights"],
            "review_band": mc["governance"]["bands"]["review"]}


def policy_defaults() -> dict:
    d = _bank_inputs()
    w = {m: d["default_weights"][m] for m in BANK_MONITORS}
    total = sum(w.values())
    return {"monitors": BANK_MONITORS, "weights": {m: v / total for m, v in w.items()},
            "band": d["review_band"], "normalisation": "threshold_relative",
            "normalisations": ["threshold_relative", "soft_exponential", "empirical_quantile", "linear_clip"],
            "n_eval_windows": len(d["evaluation"])}


def rescore_policy(weights: dict, band: float, normalisation: str, ablate: list[str],
                   bootstrap: int, seed: int) -> dict:
    d = _bank_inputs()
    active = {m: float(weights.get(m, 0.0)) for m in BANK_MONITORS if m not in ablate}
    total = sum(active.values())
    if total <= 0:
        raise ValueError("At least one active monitor needs a positive weight.")
    w = {m: v / total for m, v in active.items()}

    per_window, ahs_dec, or_dec = [], [], []
    for win, res in zip(d["evaluation"], d["results"]):
        sc = rescore(res, weights=w, normalisation=normalisation, thresholds={},
                     baselines=d["baselines"], entry_mode=d["entry_mode"], ahs_band=band,
                     null_quantiles=d["null_q"], ablate=set(ablate))
        ahs_dec.append(sc["alert_ahs"])
        or_dec.append(sc["alert_or_rule"])
        per_window.append({"window_id": win["window_id"], "kind": win["kind"], "severity": win["severity"],
                           "degraded": win["degraded"], "ahs": sc["ahs"], "alert_ahs": sc["alert_ahs"],
                           "alert_or_rule": sc["alert_or_rule"], "saturated": sc["saturated"],
                           "contributions": {k: c["contribution"] for k, c in sc["components"].items()}})
    m_ahs = evaluate(ahs_dec, d["truth"])
    m_or = evaluate(or_dec, d["truth"])

    boot = None
    if bootstrap:
        rng = np.random.default_rng(seed)
        a, b, y = np.asarray(ahs_dec, int), np.asarray(or_dec, int), np.asarray(d["truth"])
        diffs = []
        for _ in range(bootstrap):
            idx = rng.integers(0, len(y), len(y))
            fa = evaluate(a[idx].tolist(), y[idx].tolist())["f1"]
            fb = evaluate(b[idx].tolist(), y[idx].tolist())["f1"]
            if fa is not None and fb is not None:
                diffs.append(fa - fb)
        if diffs:
            lo, hi = float(np.percentile(diffs, 2.5)), float(np.percentile(diffs, 97.5))
            boot = {"delta_f1_mean": float(np.mean(diffs)), "ci95": [lo, hi],
                    "excludes_zero": bool(lo > 0 or hi < 0), "n_resamples": len(diffs), "seed": seed}

    return {"policy": {"weights": w, "band": band, "normalisation": normalisation, "ablate": ablate},
            "n_eval_windows": len(d["evaluation"]), "n_eval_clean": len(d["truth"]) - sum(d["truth"]),
            "ahs": m_ahs, "or_rule": m_or, "bootstrap_ahs_minus_or": boot, "windows": per_window,
            "evidence_class": "INJECTED",
            "method": "Recomputed with havm.sweep.rescore and havm.sweep.evaluate on the stored "
                      f"EXP005 window-bank raw metrics ({len(d['evaluation'])} evaluation windows).",
            "source": A.source(SENS, "window_bank", "INJECTED")}
