"""Audit Center.

Audit records are read exactly as written by havm.governance.AuditTrail. This module only
flattens them into rows for search and export; the original files are never modified.
Records contain window-level aggregates only — no patient-level data exists in them.
"""
from __future__ import annotations

import csv
import io

from havm.governance import SEVERITY

EVENTS = ("escalation", "de_escalation", "held", "steady")


def event_of(t: dict) -> str:
    if t.get("escalation"):
        return "escalation"
    if t.get("de_escalation"):
        return "de_escalation"
    if SEVERITY.get(t.get("proposed_state"), 0) > SEVERITY.get(t.get("from_state"), 0) \
            and t.get("to_state") == t.get("from_state"):
        return "held"
    return "steady"


def row(index: int, rec: dict, source: str) -> dict:
    g = rec.get("governance", {})
    sep, col = g.get("separated", {}), g.get("collapsed", {})
    harm = rec.get("harm_assessment") or {}
    packet = rec.get("alert_packet") or {}
    win = rec.get("window") or {}
    return {
        "source": source, "index": index, "window_id": rec.get("window_id"),
        "recorded_at": rec.get("timestamp"),
        "window_evidence_class": win.get("evidence_class"), "severity": win.get("severity"),
        "n": win.get("n"), "ahs": rec.get("ahs"), "harm_level": harm.get("harm_level"),
        "event": event_of(sep),
        "from_state": sep.get("from_state"), "to_state": sep.get("to_state"),
        "proposed_state": sep.get("proposed_state"), "reason": sep.get("reason"),
        "collapsed_to_state": col.get("to_state"), "collapsed_event": event_of(col),
        "top_monitor": packet.get("metric_that_triggered"),
        "top_monitor_evidence_class": packet.get("evidence_class"),
        "triggered_monitors": [m["monitor"] for m in rec.get("monitors", []) if m.get("triggered")],
        "model_version": rec.get("model_version"), "registry_version": rec.get("registry_version"),
        "human_decision": rec.get("human_decision"),
    }


def filter_rows(rows: list[dict], *, q: str | None, state: str | None, event: str | None,
                harm: str | None, window: str | None, evidence: str | None) -> list[dict]:
    out = rows
    if state:
        out = [r for r in out if r["to_state"] == state or r["collapsed_to_state"] == state]
    if event:
        out = [r for r in out if r["event"] == event]
    if harm:
        out = [r for r in out if r["harm_level"] == harm]
    if window:
        out = [r for r in out if (r["window_id"] or "").upper().startswith(window.upper())]
    if evidence:
        out = [r for r in out if r["window_evidence_class"] == evidence]
    if q:
        needle = q.lower()
        out = [r for r in out if needle in " ".join(str(v) for v in r.values()).lower()]
    return out


CSV_FIELDS = ["source", "index", "window_id", "recorded_at", "window_evidence_class", "severity", "n",
              "ahs", "harm_level", "event", "from_state", "proposed_state", "to_state", "reason",
              "collapsed_to_state", "collapsed_event", "top_monitor", "top_monitor_evidence_class",
              "triggered_monitors", "model_version", "registry_version", "human_decision"]


def to_csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=CSV_FIELDS, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow({**r, "triggered_monitors": ";".join(r["triggered_monitors"])})
    return buf.getvalue()
