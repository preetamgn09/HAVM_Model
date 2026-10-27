"""The repository ships without the raw D2 dataset. Every historical view must work anyway,
and replay must explain itself rather than fail."""
import pytest

HISTORICAL = ["/api/overview", "/api/monitors", "/api/performance", "/api/evidence",
              "/api/evidence/ood-distributions", "/api/governance", "/api/registry",
              "/api/registry/EXP008", "/api/audit", "/api/audit/EXP003/0", "/api/experiments",
              "/api/replay", "/api/replay/EXP003", "/api/replay/EXP003/windows/W004",
              "/api/replay/EXP003/windows/R05", "/api/figures", "/api/models"]
MONITORS = ["a1_distribution", "a2_relational", "a3_structural", "a4_operational", "ood", "calibration", "fairness"]


@pytest.fixture
def no_dataset(monkeypatch, tmp_path):
    from havm_api.services import dataset
    monkeypatch.setattr(dataset, "raw_path", lambda: tmp_path / "absent" / "diabetic_data.csv")
    from havm_api.config import get_settings
    import dataclasses
    s = dataclasses.replace(get_settings(), allow_dataset_fetch=False)
    monkeypatch.setattr("havm_api.services.replay.get_settings", lambda: s)
    monkeypatch.setattr("havm_api.services.dataset.get_settings", lambda: s)


@pytest.mark.parametrize("path", HISTORICAL + [f"/api/monitors/{m}" for m in MONITORS])
def test_historical_views_without_dataset(client, no_dataset, path):
    assert client.get(path).status_code == 200


def test_policy_recompute_without_dataset(client, no_dataset):
    w = client.get("/api/evidence/policy/defaults").json()["data"]["weights"]
    assert client.post("/api/evidence/policy", json={"weights": w}).status_code == 200


def test_replay_explains_missing_dataset(client, no_dataset):
    caps = client.get("/api/replay/capabilities").json()["data"]
    assert caps["dataset"]["present"] is False and caps["can_start"] is False
    assert "fetch_d2.py" in caps["reason"] or "HAVM_ALLOW_DATASET_FETCH" in caps["reason"] or "dataset" in caps["reason"]
    overview = client.get("/api/overview").json()["data"]
    demo = next(m for m in overview["modes"] if m["id"] == "demo_simulation")
    assert demo["available"] is False and demo["detail"]
    r = client.post("/api/replay", json={})
    assert r.status_code == 503 and r.json()["error"]["code"] == "replay_unavailable"
