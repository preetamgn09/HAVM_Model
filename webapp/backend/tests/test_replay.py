"""Replay runs: reproduction of the recorded EXP003, single-flight lock, dataset gating."""
import time

import pytest

from conftest import needs_dataset


def _wait(client, run_id, limit=300):
    t0 = time.time()
    while time.time() - t0 < limit:
        s = client.get(f"/api/replay/{run_id}").json()
        if s["state"] in ("completed", "failed", "timed_out"):
            return s
        time.sleep(0.5)
    pytest.fail("replay did not finish")


def test_historical_run_always_available(client):
    s = client.get("/api/replay/EXP003").json()
    assert s["kind"] == "historical" and s["read_only"] and s["windows_total"] == 20
    w = client.get("/api/replay/EXP003/windows/R05").json()["data"]
    assert w["evidence_class"] == "INJECTED" and w["severity"] == 1.0
    assert {"separated", "collapsed"} == set(w["governance"])


@needs_dataset
@pytest.mark.parametrize("scenario", ["observed_partition", "injected_ramp"])
def test_web_replay_reproduces_exp003(client, scenario):
    r = client.post("/api/replay", json={"scenario": scenario})
    assert r.status_code == 202
    assert client.post("/api/replay", json={"scenario": scenario}).status_code == 409  # single flight
    s = _wait(client, r.json()["run_id"])
    assert s["state"] == "completed", s.get("error")
    assert s["reproduction"]["reproduces_recorded"] is True
    audit = client.get(f"/api/audit?source={s['run_id']}").json()
    assert audit["total"] == 10 and not audit["historical"]


def test_replay_refused_without_dataset(client, monkeypatch, tmp_path):
    from havm_api.services import dataset
    monkeypatch.setattr(dataset, "raw_path", lambda: tmp_path / "absent.csv")
    caps = client.get("/api/replay/capabilities").json()["data"]
    assert caps["can_start"] is False and caps["reason"]
    r = client.post("/api/replay", json={})
    assert r.status_code == 503 and r.json()["error"]["code"] == "replay_unavailable"
