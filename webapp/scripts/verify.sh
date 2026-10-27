#!/usr/bin/env bash
# Full verification: research tests, frontend typecheck + unit tests + production build,
# then the API tests (which include serving the built frontend). Run from the repo root:
#     bash webapp/scripts/verify.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
step() { printf '\n== %s\n' "$1"; }

step "Research test suite (tests/)"
python -m pytest tests -q -p no:cacheprovider

step "Frontend: install, typecheck, unit tests, production build"
( cd webapp/frontend && npm ci --no-audit --no-fund --loglevel=error && npm run typecheck && npm test && npm run build )

step "API tests (webapp/backend/tests), frontend-serving tests REQUIRED"
HAVM_REQUIRE_FRONTEND_BUILD=1 python -m pytest webapp/backend/tests -q -p no:cacheprovider -rs

if [ -f data/raw/diabetic_data.csv ]; then
  echo; echo "Dataset present: replay reproduction tests ran."
else
  echo; echo "Dataset absent: replay reproduction tests were skipped (historical views tested)."
fi
