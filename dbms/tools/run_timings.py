"""Time every query in 04_queries.sql three times and save the raw plans.

    python3 dbms/tools/run_timings.py [--restart "pg_ctl -D ... restart"] [psql connection args...]

Each run executes the whole file top to bottom inside one transaction that is
rolled back at the end, so every run starts from the same data and a query can
use what an earlier one wrote (Q38 reads the submission Q37 inserted), as the
app does. Every statement is wrapped in EXPLAIN (ANALYZE, BUFFERS): PostgreSQL
runs it for real and reports the plan, the rows and the time.

The number recorded is the "Execution Time" line: time spent executing on the
server, without planning and without sending rows to the client. Planning time
is kept in the plan files. Run 1 follows a server restart (empty shared
buffers); runs 2 and 3 follow straight after.

Writes plans/Qnn.txt (the statement and its three plans) and plans/timings.json.
Set PLANS_DIR to write somewhere else (plans/with_recommended_indexes/ was made
that way) and QUERIES_FILE to time a different file.
"""

import json
import os
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
DBMS = HERE.parent
QUERIES = pathlib.Path(os.environ.get("QUERIES_FILE", DBMS / "04_queries.sql"))
PLANS = pathlib.Path(os.environ.get("PLANS_DIR", DBMS / "plans"))
HEADER = re.compile(r"^-- (Q\d\d) · (READ|WRITE) · (.+)$")


def parse_blocks(text: str) -> list[dict]:
    """Split 04_queries.sql into blocks: id, kind, title, source lines and the statement."""
    blocks: list[dict] = []
    cur: dict | None = None
    for line in text.splitlines():
        if line.strip() == "-- END":
            break
        m = HEADER.match(line)
        if m:
            cur = {"id": m.group(1), "kind": m.group(2), "title": m.group(3).strip(), "notes": [], "sql": []}
            blocks.append(cur)
            continue
        if cur is None:
            continue
        if line.startswith("--"):
            if not cur["sql"] and not line.startswith("-- ===") and line.strip() not in ("-- READ", "-- WRITE"):
                if not cur["notes"] and not line.startswith("-- App:") and not cur.get("titled"):
                    cur["title"] += " " + line[3:].strip()   # a title wrapped onto a second line
                    continue
                cur["titled"] = True
                cur["notes"].append(line[3:])
            continue
        if line.startswith("#") or line.startswith("-- ###"):
            continue
        if line.strip() or cur["sql"]:
            cur["sql"].append(line)
    for b in blocks:
        b.pop("titled", None)
        sql = "\n".join(b["sql"]).strip()
        sql = re.sub(r"\n-- #+.*", "", sql).strip()
        assert sql.endswith(";"), (b["id"], sql[-80:])
        b["sql"] = sql
        app = next((i for i, n in enumerate(b["notes"]) if n.startswith("App:")), None)
        b["source"] = b["notes"][app][5:].split(" (")[0].split(";")[0].strip() if app is not None else ""
    return blocks


def run_once(blocks: list[dict], psql: list[str]) -> dict[str, dict]:
    script = ["\\set ON_ERROR_STOP on", "\\pset format unaligned", "\\pset tuples_only on", "BEGIN;"]
    for b in blocks:
        script.append(f"\\echo @@{b['id']}")
        script.append(f"EXPLAIN (ANALYZE, BUFFERS) {b['sql']}")
    script.append("\\echo @@END")
    script.append("ROLLBACK;")
    out = subprocess.run([*psql, "-X", "-q"], input="\n".join(script), text=True, capture_output=True, check=False)
    if out.returncode != 0:
        sys.exit(f"psql failed:\n{out.stderr[-2000:]}")
    res: dict[str, dict] = {}
    cur = None
    lines: list[str] = []
    for line in out.stdout.splitlines():
        if line.startswith("@@"):
            if cur:
                res[cur] = {"plan": "\n".join(lines)}
            cur, lines = line[2:], []
            continue
        lines.append(line)
    for qid, r in res.items():
        ex = re.search(r"Execution Time: ([\d.]+) ms", r["plan"])
        pl = re.search(r"Planning Time: ([\d.]+) ms", r["plan"])
        if not ex:
            sys.exit(f"{qid}: no execution time in\n{r['plan']}")
        r["exec_ms"] = float(ex.group(1))
        r["plan_ms"] = float(pl.group(1)) if pl else 0.0
    return res


def main() -> None:
    args = sys.argv[1:]
    restart = None
    if args[:1] == ["--restart"]:
        restart, args = args[1], args[2:]
    psql = ["psql", *args]
    blocks = parse_blocks(QUERIES.read_text())
    if restart:
        subprocess.run(restart, shell=True, check=True, capture_output=True)
    runs = [run_once(blocks, psql) for _ in range(3)]
    PLANS.mkdir(parents=True, exist_ok=True)
    summary = []
    for b in blocks:
        ex = [r[b["id"]]["exec_ms"] for r in runs]
        pl = [r[b["id"]]["plan_ms"] for r in runs]
        summary.append({"id": b["id"], "kind": b["kind"], "title": b["title"], "source": b["source"],
                        "runs_ms": ex, "avg_ms": round(sum(ex) / 3, 3), "planning_avg_ms": round(sum(pl) / 3, 3)})
        body = [f"{b['id']} · {b['kind']} · {b['title']}", *b["notes"], "", b["sql"], ""]
        for i, r in enumerate(runs, 1):
            body += [f"---- Run {i}: execution {r[b['id']]['exec_ms']:.3f} ms, planning {r[b['id']]['plan_ms']:.3f} ms ----",
                     r[b["id"]]["plan"].rstrip(), ""]
        (PLANS / f"{b['id']}.txt").write_text("\n".join(body))
    (PLANS / "timings.json").write_text(json.dumps(summary, indent=1) + "\n")
    for s in summary:
        print(f"{s['id']} {s['kind']:5} {s['runs_ms'][0]:9.3f} {s['runs_ms'][1]:9.3f} {s['runs_ms'][2]:9.3f}  avg {s['avg_ms']:9.3f}  {s['title'][:60]}")


if __name__ == "__main__":
    main()
