"""Evidence traceability: displayed numbers must equal or reproduce the recorded artefacts."""
import numpy as np
import pytest

from havm_api import artifacts as A


def test_findings_match_recorded_files(client):
    f = {x["id"]: x for x in client.get("/api/evidence/findings").json()["data"]}
    lad = A.load_json("results/metrics/EXP004-006_sensitivity.json")["exp006_baselines_and_ablation"]
    assert f["integration"]["values"]["ahs_f1"] == lad["full_havm_ahs"]["f1"]
    assert f["integration"]["values"]["or_rule_f1"] == lad["independent_or_rule"]["f1"]
    assert f["integration"]["values"]["ci95"] == lad["_bootstrap_vs_challengers"]["independent_or_rule"]["ci95"]
    gov = A.load_json("results/metrics/EXP003_replay.json")["part_a_observed"]["governance"]
    assert f["separation"]["values"]["collapsed_suspension_windows"] == \
        gov["collapsed"]["state_occupancy"]["AUTOMATED_PREDICTION_SUSPENSION"]
    ood = A.load_json("results/metrics/EXP007-008_ood_and_full_ahs.json")["exp007_ood_bakeoff"]
    assert f["ood"]["values"]["uncertainty_family_mean"] == ood["uncertainty_family_mean"]


def test_default_policy_reproduces_recorded_ladder(client):
    sens = A.load_json("results/metrics/EXP004-006_sensitivity.json")
    defaults = client.get("/api/evidence/policy/defaults").json()["data"]
    assert defaults["n_eval_windows"] == 35
    r = client.post("/api/evidence/policy", json={"weights": defaults["weights"]}).json()["data"]
    assert r["ahs"] == sens["exp006_baselines_and_ablation"]["full_havm_ahs"]
    assert r["or_rule"] == sens["exp006_baselines_and_ablation"]["independent_or_rule"]


@pytest.mark.parametrize("band", ["0.5", "0.6", "0.7", "0.75", "0.8", "0.9", "0.95"])
def test_threshold_sweep_reproduces(client, band):
    sens = A.load_json("results/metrics/EXP004-006_sensitivity.json")
    w = client.get("/api/evidence/policy/defaults").json()["data"]["weights"]
    r = client.post("/api/evidence/policy", json={"weights": w, "band": float(band)}).json()["data"]
    assert r["ahs"] == sens["exp005a_threshold_sensitivity"][band]


@pytest.mark.parametrize("monitor", ["a1_distribution", "calibration", "fairness"])
def test_single_monitor_rows_reproduce(client, monitor):
    lad = A.load_json("results/metrics/EXP004-006_sensitivity.json")["exp006_baselines_and_ablation"]
    r = client.post("/api/evidence/policy", json={"weights": {monitor: 1.0}}).json()["data"]
    assert r["ahs"] == lad[f"single::{monitor}"]


def test_ablation_rows_reproduce(client):
    lad = A.load_json("results/metrics/EXP004-006_sensitivity.json")["exp006_baselines_and_ablation"]
    w = client.get("/api/evidence/policy/defaults").json()["data"]["weights"]
    for m in w:
        r = client.post("/api/evidence/policy", json={"weights": w, "ablate": [m]}).json()["data"]
        assert r["ahs"] == lad[f"ablate::{m}"], m


def test_bootstrap_integrity_check(client):
    chk = client.get("/api/evidence").json()["data"]["bootstrap"]["integrity_check"]
    assert chk["recorded_reproduced_with_a1_only_or"] is True
    assert chk["four_monitor_or_differs"] is True
    assert chk["conclusion_unchanged"] is True
    assert chk["corrected"]["ci95"][0] <= 0 <= chk["corrected"]["ci95"][1]


def test_missing_monitor_bracket_recomputed(client):
    mm = client.get("/api/evidence").json()["data"]["missing_monitors"]
    assert mm["matches_recorded"] is True
    assert mm["four_renormalised"] < mm["seven_measured"] < mm["four_missing_as_zero"]


def test_confusion_matrix_consistent(client):
    for c in client.get("/api/performance").json()["data"]["candidates"]:
        cm = c["confusion"]
        if cm:
            assert cm["tp"] + cm["fp"] == c["operating_point"]["n_flagged"]
            assert cm["tp"] + cm["fp"] + cm["fn"] + cm["tn"] == c["n"]


def test_performance_does_not_mix_domains(client):
    p = client.get("/api/performance").json()["data"]
    card = A.model_card()
    gb = next(c for c in p["candidates"] if c["selected"])
    assert gb["auroc"] == card["validation_metrics"]["auroc"]
    assert p["deployment"]["auroc"] != gb["auroc"]
    assert "deployment" in p["deployment"]["domain"]


def test_governance_simulation_uses_real_engine(client):
    steps = [{"ahs": 0.4, "harm_level": "MEASURED"}] * 2 + [{"ahs": 0.9, "harm_level": "NONE"}]
    t = client.post("/api/governance/simulate", json={"steps": steps}).json()["data"]["transitions"]
    assert t[0]["separated"]["to_state"] == "NORMAL" and t[0]["separated"]["event"] == "held"
    assert t[1]["separated"]["to_state"] == "ABSTENTION_RECOMMENDED"
    assert t[1]["collapsed"]["to_state"] == "AUTOMATED_PREDICTION_SUSPENSION"
    assert t[2]["separated"]["event"] == "de_escalation"


def test_governance_timeline_matches_audit(client):
    tl = client.get("/api/governance").json()["data"]["timeline"]
    recs = A.load_jsonl("results/audit/EXP003_audit.jsonl")
    rows = tl["observed"] + tl["injected"]
    assert len(rows) == len(recs)
    for row in rows:
        assert row["separated"]["to_state"] == recs[row["audit_index"]]["governance"]["separated"]["to_state"]


def test_registry_integrity_recomputed(client):
    snaps = {s["id"]: s for s in client.get("/api/registry").json()["data"]["snapshots"]}
    for s in snaps.values():
        assert s["integrity"]["g3_core_verified"] is True
    assert snaps["EXP003"]["integrity"]["stored_matches_full_content"] is False
    assert "monitor_config" in snaps["EXP003"]["integrity"]["sections_added_after_g3"]


def test_overview_ahs_from_replay(client):
    o = client.get("/api/overview").json()["data"]
    rep = A.load_json("results/metrics/EXP003_replay.json")
    assert o["ahs"]["observed_mean"] == rep["part_a_observed"]["ahs_mean"]
    assert o["ahs"]["n_windows_evaluated"] == 20


def test_ood_histograms_are_densities(client):
    g = client.get("/api/evidence/ood-distributions").json()["data"]["groups"]["paediatric_and_adolescent"]
    assert g["n_group"] == 557
    d = g["detectors"]["predictive_entropy"]
    width = np.diff(d["edges"])
    assert abs(float(np.sum(np.array(d["remainder_density"]) * width)) - 1) < 1e-6
