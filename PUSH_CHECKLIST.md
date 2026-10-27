# Final release checklist

Run these from the repository root. They synchronise the public repository with the tree that
produced the two manuscripts. Nothing here changes an experimental result.

## 1. Copy in the updated tree

Replace the working copy with the contents of `HAVM.zip`, keeping your `.git` directory.

## 2. Untrack what should never have been committed

`.gitignore` now excludes these, but files already tracked stay tracked until removed from the
index. `--cached` removes them from Git while leaving them on your disk.

```bash
git rm -r --cached data
git rm -r --cached src/havm/__pycache__ src/havm/datasets/__pycache__ \
                   src/havm/monitors/__pycache__ tests/__pycache__
git add .gitignore
```

The dataset (19.2 MB) and the build zip (3.2 MB) leave the repository. Acquisition is by
`scripts/fetch_d2.py --source uci`, which verifies the SHA-256 recorded in
`configs/d2_diabetes.yaml`. This is what the README, `research/reproducibility.md` and both
manuscripts already describe.

## 3. Stage the new and updated files

```bash
git add scripts/run_g9_ood_scores.py scripts/make_figure_p2f2.py scripts/make_figure_p2f3.py
git add results/metrics/EXP011_*.json results/scores/ results/figures/
git add configs/d2_diabetes.yaml research/experiment_log.md research/reproducibility.md \
        research/final_report.md HOW_TO_RUN.md scripts/reproduce_all.py scripts/fetch_d2.py
git add results/            # regenerated result files and registries
```

## 4. Commit and push

```bash
git commit -m "Release tree for the two manuscripts: EXP011 artefacts, UCI-verified provenance, untrack dataset"
git push
```

## 5. Verify after pushing

```bash
python scripts/reproduce_all.py --quick    # ~1 minute
python -m pytest tests/ -q                 # 92 tests
```

And confirm on GitHub that `data/` is absent, that `configs/d2_diabetes.yaml` reads
`provenance_status: "UCI_VERIFIED"`, and that `results/metrics/` contains the four `EXP011_*`
files.
