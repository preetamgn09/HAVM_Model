"""API contract tests: every page's endpoint, consistent errors, bounded responses."""
import json

import pytest

PAGES = ["/api/health", "/api/overview", "/api/models", "/api/monitors", "/api/performance",
         "/api/experiments", "/api/registry", "/api/audit", "/api/governance", "/api/evidence",
         "/api/evidence/findings", "/api/evidence/ood-distributions", "/api/evidence/policy/defaults",
         "/api/replay", "/api/replay/capabilities", "/api/replay/EXP003", "/api/replay/EXP003/windows",
         "/api/figures", "/api/openapi.json"]


@pytest.mark.parametrize("path", PAGES)
def test_get_ok_and_strict_json(client, path):
    r = client.get(path)
    assert r.status_code == 200
    json.loads(r.text, parse_constant=lambda c: pytest.fail(f"non-finite {c} in {path}"))


def test_health_reports_artefacts(client):
    h = client.get("/api/health").json()
    assert h["status"] == "ok" and all(h["artefacts"].values())


@pytest.mark.parametrize("monitor", ["a1_distribution", "a2_relational", "a3_structural",
                                     "a4_operational", "ood", "calibration", "fairness"])
def test_each_monitor_detail(client, monitor):
    d = client.get(f"/api/monitors/{monitor}").json()["data"]
    assert d["id"] == monitor and d["snapshot"]["availability"] in {"measured", "simulated"}
    exp3 = d["exp003_series"]
    if monitor in {"a2_relational", "a4_operational", "ood"}:
        # Not evaluated per window in EXP003: must be said, not invented.
        assert not exp3["available"] and exp3["reason"]
        assert all(w["value"] is None for w in exp3["windows"])
    else:
        assert exp3["available"] and len(exp3["windows"]) == 20


def test_a4_is_labelled_simulated(client):
    d = client.get("/api/monitors/a4_operational").json()["data"]
    assert d["snapshot"]["evidence_class"] == "SIMULATED"


@pytest.mark.parametrize("path,status,code", [
    ("/api/monitors/nope", 422, "invalid_request"),
    ("/api/experiments/EXP999", 404, "experiment_not_found"),
    ("/api/experiments/EXP0001x", 422, "invalid_request"),
    ("/api/replay/not-a-run", 422, "invalid_run_id"),
    ("/api/replay/run-20260101-000000-abcdef", 404, "run_not_found"),
    ("/api/replay/EXP003/windows/W999", 404, "window_not_found"),
    ("/api/replay/EXP003/windows/zz", 422, "invalid_window_id"),
    ("/api/registry/EXP999", 422, "invalid_request"),
    ("/api/audit/EXP003/9999", 404, "audit_record_not_found"),
    ("/api/audit?source=../../x", 422, "invalid_source"),
    ("/api/audit?limit=5000", 422, "invalid_request"),
    ("/api/figures/secret.png", 404, "figure_not_found"),
    ("/api/no-such-route", 404, "not_found"),
])
def test_errors_are_consistent(client, path, status, code):
    r = client.get(path)
    assert r.status_code == status
    body = r.json()
    assert "error" in body and "message" in body["error"]
    if code:
        assert body["error"]["code"] == code
    assert "/home" not in r.text and "Traceback" not in r.text


def test_audit_filter_pagination_and_export(client):
    page = client.get("/api/audit?limit=5&offset=0").json()
    assert page["total"] == 20 and len(page["rows"]) == 5 and page["historical"]
    held = client.get("/api/audit?event=held").json()
    assert held["total"] > 0 and all(r["event"] == "held" for r in held["rows"])
    inj = client.get("/api/audit?evidence=INJECTED").json()
    assert inj["total"] == 10 and all(r["window_id"].startswith("R") for r in inj["rows"])
    csv = client.get("/api/audit/export?format=csv&window=W").text.splitlines()
    assert csv[0].startswith("source,index,window_id") and len(csv) == 11
    js = client.get("/api/audit/export?format=json&state=ABSTENTION_RECOMMENDED").json()
    assert js["historical"] and all("monitors" in r for r in js["records"])


def test_audit_record_is_original(client):
    from havm_api import artifacts as A
    rec = client.get("/api/audit/EXP003/4").json()["data"]
    assert rec == json.loads(json.dumps(A.load_jsonl("results/audit/EXP003_audit.jsonl")[4]))


def test_policy_validation(client):
    bad = [{"weights": {"a1_distribution": -1}}, {"weights": {"a1_distribution": 1}, "band": 1.5},
           {"weights": {"a1_distribution": 1}, "ablate": ["a1_distribution"]},
           {"weights": {"made_up": 1}}, {"weights": {"a1_distribution": 1}, "bootstrap": 99999}]
    for body in bad:
        assert client.post("/api/evidence/policy", json=body).status_code == 422


def test_governance_simulation_validation(client):
    assert client.post("/api/governance/simulate", json={"steps": []}).status_code == 422
    assert client.post("/api/governance/simulate",
                       json={"steps": [{"ahs": 2, "harm_level": "NONE"}]}).status_code == 422
    assert client.post("/api/governance/simulate",
                       json={"steps": [{"ahs": 0.5, "harm_level": "NONE"}] * 51}).status_code == 422


def test_replay_request_validation(client):
    for body in [{"scenario": "live"}, {"n_windows": 2}, {"n_windows": 500}, {"monitor_set": "nine"},
                 {"extra": 1}]:
        assert client.post("/api/replay", json=body).status_code == 422


def test_live_integration_disabled(client):
    modes = {m["id"]: m for m in client.get("/api/overview").json()["data"]["modes"]}
    assert modes["live_integration"]["available"] is False
    assert modes["historical_replay"]["active"] is True


def test_no_patient_level_data_exposed(client):
    ood = client.get("/api/evidence/ood-distributions").text
    assert "encounter_id" not in ood and "patient_nbr" not in ood
    for path in ("/api/overview", "/api/replay/EXP003/windows/W000", "/api/audit/EXP003/0"):
        assert "patient_nbr" not in client.get(path).text


def test_spa_route_without_build_is_explained(client):
    r = client.get("/some/page")
    assert r.status_code in (200, 503)
