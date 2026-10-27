# HAVM | Clinical AI Observability

*Monitor model assumptions. Understand risk signals. Govern with evidence.*

A web application over the HAVM capstone. It reads the recorded experiment artefacts in
`results/`, recomputes selected results with the project's own code, and replays the
existing pipeline on the retrospective dataset. The research package (`src/havm`), scripts,
configs and results are used as they are: **nothing under `results/` or `configs/` is
written by the application**, and a test asserts it.

> **Research prototype.** Retrospective public EHR data (Diabetes 130-US Hospitals, UCI #296),
> injected perturbations and a simulated governance policy. Not clinically validated, not a
> medical device, no live patient data, no treatment recommendations. Governance states are
> recommendations recorded for a human; nothing is ever suspended.

## Run it locally

You need Python 3.12 and Node 20 or newer. From the repository root (`HAVM/`):

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\Activate.ps1
pip install -r webapp/requirements.txt

cd webapp/frontend && npm ci && npm run build && cd ../..

uvicorn havm_api.main:app --app-dir webapp/backend --port 8000 --workers 1
```

Open http://localhost:8000. API documentation is at http://localhost:8000/api/docs.

Every page except the Replay Lab works immediately from `results/`. To enable replays,
either fetch the dataset once:

```bash
python scripts/fetch_d2.py --source mirror     # checksum-verified; or --source uci
```

or start the server with `HAVM_ALLOW_DATASET_FETCH=true`. The dataset is then downloaded
on the first replay only, never at startup.

**Frontend development with hot reload:** keep uvicorn running on :8000, then
`cd webapp/frontend && npm run dev` and open http://localhost:5173 (Vite proxies `/api`).

**Run with one worker.** The one-replay-at-a-time lock and live run state live in process
memory.

## Tests

One command runs everything (research tests, frontend typecheck, unit tests and production
build, then the API tests, which include serving the built frontend):

```bash
bash webapp/scripts/verify.sh
```

Or individually:

```bash
python -m pytest tests -q                    # original research suite
cd webapp/frontend && npm run typecheck && npm test && npm run build && cd ../..
python -m pytest webapp/backend/tests -q     # API, traceability, no-dataset, frontend-serving, replay
```

`verify.sh` sets `HAVM_REQUIRE_FRONTEND_BUILD=1`, so the frontend-serving tests must run and
fail if `dist/` is missing. A bare `pytest` run without a build skips them (`dist/` is
gitignored) and says so in the skip reason.

Results from the last full run:

| Suite | Without the dataset (repository as shipped) | With `data/raw/diabetic_data.csv` |
|---|---|---|
| Research `tests/` | 86 passed, 6 skipped (the project's own data-dependent tests skip) | 92 passed |
| Frontend (Vitest) | 9 passed | 9 passed |
| API `webapp/backend/tests` via `verify.sh` | 112 passed, 2 skipped (replay reproduction needs the dataset) | 114 passed |

The API tests check:
- **Endpoint contracts:** every endpoint and its error cases.
- **Traceability:** displayed numbers equal the recorded files, and the policy recomputation reproduces every recorded ladder, threshold and ablation row.
- **No dataset:** every historical view works with the dataset absent.
- **Frontend serving:** the built frontend is served on every route.
- **Replay:** a web replay reproduces EXP003 exactly, and a second launch while one runs returns 409.
- **Artefacts untouched:** `results/` and `configs/` are byte-identical before and after the session.

## Pages

| Page | What it shows | Interactive |
|---|---|---|
| Command Center | Modes, frozen model, AHS against governance bands, seven monitor signals, governance distribution, findings, recent audit events, dataset provenance, experiment catalogue | Run demo replay |
| Monitor Explorer | Each monitor's question, measurement, threshold, freeze baseline, violation, evidence class, limitations; per-window series; monitor-specific evidence | Select monitor; switch EXP003 / detection bank / EXP002 |
| Model Performance | AUROC, AUPRC, Brier, ECE; reliability; candidate comparison; confusion matrix at the operating point; subgroups; deployment domain reported separately | Toggle deployment curve; subgroup attribute |
| Evidence Lab | Ladder, bootstrap, window-size stability, OOD bake-off with intervals and score distributions, thresholds, weights, normalisation, ablation, severity ramp, missing-monitor bias, scalability, recorded figures | Policy playground recomputes detection metrics live |
| Governance | States, decision rules, configuration, recorded timeline for both policies, separated vs collapsed | Click any transition; step the real engine in the simulator |
| Assumption Registry | Four historical snapshots with hash verification, the loaded configuration, snapshot diff | Read-only by design |
| Audit Trail | All audit records, searchable and filterable, with an inspector | Download CSV / JSON |
| Replay Lab | Start a replay, watch windows arrive, inspect each window's monitors, AHS decomposition, harm and governance | Simulated-streaming playback of computed windows |

## Where every number comes from

Each value in the UI carries a source chip naming its file and field. The main mappings:

| Displayed | Source |
|---|---|
| Model metrics, operating point, subgroups | `results/metrics/EXP001_baselines.json` → `candidates` |
| Model identity, freeze time, artefact hash | `results/models/EXP001_model_card.json` (hash re-verified against the `.joblib`) |
| Confusion matrix | Derived from EXP001 `n`, `prevalence`, `tpr`, `fpr`; shown only if it reproduces `n_flagged` exactly |
| Deployment AUROC / ECE | `EXP007-008_ood_and_full_ahs.json` → `exp008_complete_ahs.monitors[a2_relational, calibration]` |
| Monitor snapshot (all seven) | `EXP007-008…json` → `exp008_complete_ahs.monitors` |
| Per-window monitor series | `results/audit/EXP003_audit.jsonl` → `monitors`; AHS entry values from `EXP003_replay.json` |
| Window bank series | `EXP004-006_sensitivity.json` → `window_bank` |
| AHS windows, governance occupancy | `EXP003_replay.json` → `part_a_observed`, `part_b_injected` |
| Ladder, ablation, thresholds, weights, normalisation | `EXP004-006_sensitivity.json` → `exp005*`, `exp006*` |
| Bootstrap intervals | `EXP004-006…` → `exp006…._bootstrap_vs_challengers` (see the integrity note below) |
| Stability by window size | `EXP009-010_scalability_stability.json` → `exp010_ahs_stability`; clean null band from `exp004_ahs_null_band_by_window_size` |
| OOD AUROCs / intervals | `EXP007-008…` → `exp007_ood_bakeoff`; `EXP011_bootstrap_*.json` → `interval` |
| OOD score distributions | `results/scores/EXP011_deployment_ood_scores.csv.gz`, binned server-side; no record values are returned |
| Missing-monitor bracket (0.677 / 0.481 / 0.412) | Recomputed with `havm.aggregation.compute_ahs` from EXP008 monitor results and the EXP008 registry |
| Scalability | `EXP009-010…` → `exp009_scalability` |
| Thresholds, weights, bands | `configs/monitors.yaml` (current) and `results/registry/*.json` (historical) |
| States, rules | `havm.governance.STATES` and `GovernanceEngine` |

**Recomputed (not recorded) values** are labelled as such:
- **Policy playground:** `havm.sweep.rescore` / `evaluate` on the stored window bank. With the default policy it equals the recorded ladder, threshold and ablation rows exactly.
- **Governance simulator:** steps the real `GovernanceEngine`.
- **Missing-monitor bracket:** recomputed with `compute_ahs`, as above.
- **Registry hash verification:** `havm.utils.sha256_obj`.

### Notes on the recorded artefacts

The application shows recorded values as recorded. Where recomputing from stored
measurements disagrees with a label or a sentence in the reports, it shows both. No research
file has been modified.

1. **Recorded OR-rule bootstrap.**
   - **What happened:** `scripts/run_g6.py` stores the OR-rule decisions with `decision_store.setdefault(...)` on the first tagged sweep, which is `single::a1_distribution` (weights `{a1: 1.0}`). `havm.sweep.rescore` skips zero-weight monitors, so the recorded "AHS vs independent OR-rule" interval [0.000, 0.085] compares AHS with an A1-only OR-rule. The app reproduces it exactly that way.
   - **Corrected:** against the four-monitor OR-rule, with the same procedure and seed, ΔF1 is +0.015 with 95% CI [−0.054, +0.087].
   - **Impact:** the ladder's OR-rule F1 of 0.898 is unaffected, and the conclusion holds.
2. **Severity ramp wording.** `HOW_TO_RUN.md`, `G5_report.md` and `final_report.md` §9 say severities 0.5, 0.75 and 1.0 are indistinguishable. The recorded EXP003 ramp gives AHS 0.175, 0.175 and 0.241: the floor is reached at 0.5 and 0.75, and the maximum-severity window scores *higher*. That is consistent with saturation and with the recorded `monotone_decreasing_on_ramp: false`, but "indistinguishable" is loose for 1.0. The Evidence Lab states the recorded values.
3. **Ablation wording.** The final report says every ablation difference is one window wide. The largest, removing A1 (0.913 → 0.875), is about 1.6× the one-window F1 step of 0.023. The conclusion that no component is shown to earn its place still holds on 35 windows without intervals.
4. **Registry hash scope.** `registry_hash` verifies the Gate 3 core of every snapshot. Sections added at later gates are not covered by any hash.
5. **Provenance status.** EXP001 recorded `MIRROR_UNVERIFIED`; the configuration now records `UCI_VERIFIED`, as explained in `final_report.md` §3.

All narrative numbers in the UI (the "If asked" notes, ratios, window counts, band
positions) are computed from these files at request time, not typed in.

## Replay

`POST /api/replay` runs the existing pipeline in a background thread. It uses:
- `build_splits`, `havm.replay` windows, and `compute_ahs` / `assess_harm` / `GovernanceEngine` / `AuditTrail`;
- `run_monitors`, `freeze_baselines` and `perturb` imported from `scripts/run_g5.py`.

| Scenario | Evidence | Windows |
|---|---|---|
| Observed partition | OBSERVED | Random partition of the emergency-admission domain, 5–20 windows. D2 has no time axis, so this is not a time series. |
| Injected ramp | INJECTED | The declared EXP003 severity ramp 0 → 1 → 0. Not clinical harm. |

Monitor sets:
- **four** — the EXP003 configuration.
- **seven** — adds A2, A4 and OOD per window, as in EXP008. A4 telemetry is SIMULATED, and this set is a composition rather than a recorded experiment.

With seed 20260819 and the four-monitor set, a run reproduces the recorded EXP003 values,
and the app reports the comparison. Other safeguards:
- **Single flight:** only one run executes at a time; a second launch returns 409.
- **Timeout:** each run has a deadline, checked between windows.
- **Model integrity:** the model is loaded only after its SHA-256 matches the model card.
- **Storage:** runs are written to `HAVM_RUNS_DIR`, never to `results/`.

"Simulated streaming" in the Replay Lab plays back already-computed windows at a controlled
pace and is labelled as such. Live integration is not implemented and is reported as not
configured.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `HAVM_REPLAY_ENABLED` | `true` | Allow `POST /api/replay` |
| `HAVM_ALLOW_DATASET_FETCH` | `false` | Download and checksum-verify D2 on the first replay if absent |
| `HAVM_DATASET_SOURCE` | `mirror` | `mirror` (GitHub, verified by SHA-256) or `uci` |
| `HAVM_REPLAY_TIMEOUT_SECONDS` | `600` | Per-run deadline (30–3600) |
| `HAVM_MAX_STORED_RUNS` | `20` | Web runs kept on disk; oldest pruned |
| `HAVM_RUNS_DIR` | `webapp/runtime/runs` | Where web runs are written |
| `HAVM_CORS_ORIGINS` | empty | Comma-separated origins, only needed for a separately hosted frontend |
| `HAVM_REPO_ROOT` | auto | Repository root |
| `PORT` | `10000` in Docker | Listening port |

## Layout

```
webapp/
  backend/havm_api/
    main.py          app, static frontend, error envelope, NaN-safe JSON
    config.py        environment settings; puts src/ on sys.path like the scripts do
    artifacts.py     read-only, mtime-cached access to results/ and configs/
    schemas.py       Pydantic request / response models
    routers/         core, research, governance (incl. registry, audit), replay
    services/        monitors, performance, evidence, governance, registry, audit,
                     dataset, replay, overview
  backend/tests/     API, traceability and replay tests
  frontend/src/      React + TypeScript + Tailwind + Recharts
  requirements.txt   pinned to the versions that froze the model
  DEPLOYMENT.md      Render guide
```
