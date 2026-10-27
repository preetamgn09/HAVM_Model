"""The production frontend build is served by the API process (single Render service)."""
import os
import re

import pytest

from havm_api.config import get_settings

DIST = get_settings().frontend_dist
IS_BUILT = (DIST / "index.html").is_file()

# A plain `pytest` run (API-only development) skips these when dist/ is absent, because the
# build is gitignored. verify.sh and CI set HAVM_REQUIRE_FRONTEND_BUILD=1 so that a missing
# build FAILS instead of passing silently as "skipped".
REQUIRED = os.environ.get("HAVM_REQUIRE_FRONTEND_BUILD") == "1"
built = pytest.mark.skipif(not IS_BUILT and not REQUIRED,
                           reason="frontend not built (cd webapp/frontend && npm run build); "
                                  "set HAVM_REQUIRE_FRONTEND_BUILD=1 to make this a failure")


def test_frontend_build_present_when_required():
    if REQUIRED:
        assert IS_BUILT, f"HAVM_REQUIRE_FRONTEND_BUILD=1 but {DIST}/index.html does not exist"


@built
@pytest.mark.parametrize("route", ["/", "/monitors/fairness", "/evidence", "/governance", "/registry",
                                   "/audit", "/replay", "/replay/EXP003", "/performance"])
def test_spa_routes_serve_index(client, route):
    r = client.get(route)
    assert r.status_code == 200 and '<div id="root">' in r.text


@built
def test_built_assets_are_served(client):
    html = client.get("/").text
    assets = re.findall(r'(?:src|href)="(/assets/[^"]+)"', html)
    assert assets, "index.html references no built assets"
    for a in assets:
        r = client.get(a)
        assert r.status_code == 200 and len(r.content) > 0


@built
def test_health_reports_frontend(client):
    assert client.get("/api/health").json()["frontend_built"] is True


def test_unknown_api_route_is_json_not_html(client):
    r = client.get("/api/does-not-exist")
    assert r.status_code == 404 and r.headers["content-type"].startswith("application/json")
