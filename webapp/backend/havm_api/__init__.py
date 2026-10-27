"""HAVM | Clinical AI Observability — web API over the HAVM research package."""
__version__ = "1.0.0"

# Importing config puts the research package (src/havm) on sys.path, as the project's own
# scripts do, before any service module imports from it.
from havm_api import config as _config  # noqa: E402,F401
