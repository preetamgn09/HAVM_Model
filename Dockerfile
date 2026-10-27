# HAVM | Clinical AI Observability — one image serving the API and the built frontend.
# Stage 1 builds the React app; stage 2 is the Python runtime. The dataset is NOT baked
# into the image (no patient-level data in the image or in Git); replays fetch and
# checksum-verify it on first use when HAVM_ALLOW_DATASET_FETCH=true.

FROM node:22-slim AS frontend
WORKDIR /app/webapp/frontend
COPY webapp/frontend/package.json webapp/frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY webapp/frontend/ ./
RUN npm run build

FROM python:3.12.3-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=10000
WORKDIR /app
COPY webapp/requirements.txt webapp/requirements.txt
RUN pip install --no-cache-dir -r webapp/requirements.txt
# Research code, configs and recorded artefacts (read-only at runtime)
COPY src/ src/
COPY scripts/ scripts/
COPY configs/ configs/
COPY results/ results/
COPY research/ research/
COPY webapp/backend/ webapp/backend/
COPY --from=frontend /app/webapp/frontend/dist webapp/frontend/dist
RUN useradd --create-home havm && mkdir -p data/raw webapp/runtime && chown -R havm data webapp/runtime
USER havm
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,os;urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"10000\")}/api/health')" || exit 1
# ONE worker: the replay lock and run state live in process memory.
CMD ["sh", "-c", "uvicorn havm_api.main:app --app-dir webapp/backend --host 0.0.0.0 --port ${PORT} --workers 1 --proxy-headers"]
