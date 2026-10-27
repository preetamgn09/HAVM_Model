# Deploying to Render

One Docker web service serves both the API (`/api`) and the built frontend. The repository
root (the folder containing `Dockerfile`, `render.yaml`, `src/` and `results/`) must be the
root of the Git repository you connect to Render.

## 0. Verify locally first

```bash
bash webapp/scripts/verify.sh      # must end without errors
```

## 1. Push the repository

```bash
cd HAVM
git init                      # if it is not already a repository
git add .
git commit -m "HAVM observability platform"
git remote add origin https://github.com/<you>/havm.git
git push -u origin main
```

Check that these are committed:
- `results/`, including `results/models/EXP001_frozen_model.joblib` and `results/scores/*.csv.gz`;
- `webapp/frontend/package-lock.json`.

`data/`, `webapp/frontend/node_modules/`, `webapp/frontend/dist/` and `webapp/runtime/`
are gitignored. The dataset must never be committed.

## 2. Create the service

**Blueprint (recommended).** In Render, go to New → Blueprint, pick the repository and apply.
`render.yaml` creates `havm-observability` with:
- the Dockerfile build;
- `/api/health` as the health check;
- the environment variables below.

**Manual.** New → Web Service → the repository → Runtime: Docker. Leave the build and start
commands empty (the Dockerfile defines them), set the health check path to `/api/health`,
and add the variables:

| Key | Value |
|---|---|
| `HAVM_REPLAY_ENABLED` | `true` |
| `HAVM_ALLOW_DATASET_FETCH` | `true` |
| `HAVM_DATASET_SOURCE` | `mirror` (or `uci`) |
| `HAVM_REPLAY_TIMEOUT_SECONDS` | `600` |

Render sets `PORT`, and the container listens on it.

What the build does:
1. Builds the frontend with `npm ci && npm run build` on Node 22.
2. Installs `webapp/requirements.txt` on Python 3.12.3. These are the exact library versions recorded in the model card, so the frozen pickle loads safely and replays reproduce EXP003.
3. Starts `uvicorn … --workers 1`.

## 3. Verify

1. `https://<service>.onrender.com/api/health` returns `"status": "ok"` and `"frontend_built": true`.
2. The Command Center loads with recorded results.
3. In the Replay Lab, start the default observed replay. The first replay downloads the dataset (~19 MB), verifies its SHA-256 against `configs/d2_diabetes.yaml` and then runs (~15 s). It should report "Reproduces the recorded EXP003 observed windows".

## Storage: what persists and what does not

| Data | Where | Persistence |
|---|---|---|
| Recorded results, model, registry, configs | In the image (`results/`, `configs/`) | Permanent, read-only |
| D2 dataset | `data/raw/` in the container | **Ephemeral.** Re-downloaded and re-verified on the first replay after a deploy or restart |
| Web replay runs | `HAVM_RUNS_DIR` (default `webapp/runtime/runs`) | **Ephemeral** on Render's default filesystem; lost on deploy or restart |

Nothing important depends on ephemeral storage: every research result is in the image, and
the recorded EXP003 replay is always available. To keep web runs across restarts, attach a
Render persistent disk (paid instances) mounted at e.g. `/var/havm`, and set
`HAVM_RUNS_DIR=/var/havm/runs`. Runs are capped by `HAVM_MAX_STORED_RUNS`.

## Plan

`render.yaml` uses the **free** plan, so the Blueprint applies without a payment method. Free
web services sleep after a period of inactivity, so the first request afterwards takes
noticeably longer. Before a live presentation, either open the site a few minutes early or
change `plan: free` to `plan: starter` (paid, always on) in `render.yaml` or in the dashboard.

## Memory and instance size

Measured replay peak is about 365 MB for the four-monitor set and 400 MB for seven monitors,
plus the server. Both the free and starter plans (512 MB) fit one replay at a time, which the
application enforces.

If an instance runs out of memory:
- set `HAVM_REPLAY_ENABLED=false` to serve the recorded results only; every page still works, and the Replay Lab explains why replays are off;
- or move to a 2 GB instance.

Free instances also sleep when idle, so the first request after a pause takes longer.

## Without Docker (Render native Python)

If you prefer a native Python service:
- **Build command:** `pip install -r webapp/requirements.txt && cd webapp/frontend && npm ci && npm run build`
- **Start command:** `uvicorn havm_api.main:app --app-dir webapp/backend --host 0.0.0.0 --port $PORT --workers 1`
- **Environment:** `PYTHON_VERSION=3.12.3`, plus `NODE_VERSION=22` if Node is not already available in your build image.

The Docker route is the tested one.

## Separate frontend hosting (optional)

The frontend uses relative `/api` URLs and is designed to be served by the API. If you host
it elsewhere (e.g. a Render static site), proxy `/api/*` to the web service, or set
`HAVM_CORS_ORIGINS` and change the fetch base in `src/lib/api.ts`.

## Security notes

- The dataset is fetched only from the two sources in `scripts/fetch_d2.py`. A file is used only if its SHA-256 matches the declared value; otherwise it is deleted.
- The frozen model is loaded only after its hash matches the model card, because joblib files are pickles.
- Error responses never contain exception details or filesystem paths.
- No credentials or API keys are required or stored.
- Live clinical integration is not implemented.
