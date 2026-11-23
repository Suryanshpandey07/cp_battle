"""Time a few writes many times each, to measure what the extra indexes cost them.

    python3 dbms/tools/write_cost.py LABEL [-n 300] [psql connection args...]

Each repetition runs one write under EXPLAIN (ANALYZE) inside its own
transaction and rolls it back, so the data never changes; a write that needs
an earlier one (Q33 makes live the match Q31 creates) runs that one first,
untimed. The whole file's three runs are too noisy for differences this small;
300 repetitions and the median are not. Results are added to
plans/write_cost.json under LABEL (05_query_timings.md used "with", "without",
"with again").
"""

import importlib.util
import json
import pathlib
import re
import statistics
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
DBMS = HERE.parent
spec = importlib.util.spec_from_file_location("run_timings", HERE / "run_timings.py")
assert spec and spec.loader
run_timings = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run_timings)

# the writes that insert into or change indexed columns of profiles and matches, and Q36 as a
# control (match_events has no new index), with what each needs to have run first
TARGETS = {"Q02": [], "Q31": [], "Q33": ["Q31"], "Q35": [], "Q36": [], "Q46": [], "Q51": [], "Q72": []}


def main() -> None:
    label, args = sys.argv[1], sys.argv[2:]
    n = 300
    if args[:1] == ["-n"]:
        n, args = int(args[1]), args[2:]
    blocks = {b["id"]: b for b in run_timings.parse_blocks((DBMS / "04_queries.sql").read_text())}
    script = ["\\set ON_ERROR_STOP on", "\\pset tuples_only on", "\\pset format unaligned"]
    for _ in range(n):
        for q, before in TARGETS.items():
            script.append("BEGIN;")
            for p in before:
                script += ["\\o /dev/null", blocks[p]["sql"], "\\o"]
            script += [f"\\echo @@{q}", "EXPLAIN (ANALYZE) " + blocks[q]["sql"], "ROLLBACK;"]
    out = subprocess.run(["psql", "-X", "-q", *args], input="\n".join(script), capture_output=True, text=True,
                         check=True).stdout
    times: dict[str, list[float]] = {q: [] for q in TARGETS}
    cur = None
    for line in out.splitlines():
        if line.startswith("@@"):
            cur = line[2:]
        m = re.search(r"Execution Time: ([\d.]+) ms", line)
        if m and cur:
            times[cur].append(float(m.group(1)))
    path = DBMS / "plans" / "write_cost.json"
    data = json.loads(path.read_text()) if path.exists() else {}
    data[label] = {q: {"title": blocks[q]["title"], "n": len(v), "median_ms": round(statistics.median(v), 3),
                       "mean_ms": round(statistics.fmean(v), 3)} for q, v in times.items()}
    path.write_text(json.dumps(data, indent=1) + "\n")
    for q, r in data[label].items():
        print(f"{q}  median {r['median_ms']:7.3f}  mean {r['mean_ms']:7.3f}  n={r['n']}  {r['title']}")


if __name__ == "__main__":
    main()
