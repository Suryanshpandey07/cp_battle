import re
import subprocess
from pathlib import Path
from datetime import datetime

DB = "cp_battle_schema_test"
SQL_FILE = Path("dbms/04_queries.sql")
PLAN_DIR = Path("dbms/plans")

PLAN_DIR.mkdir(parents=True, exist_ok=True)

content = SQL_FILE.read_text()

# Extract numbered SQL queries
matches = list(re.finditer(r"--\s*(\d+)\.\s*(.+)", content))

queries = []

for i, match in enumerate(matches):
    number = int(match.group(1))
    name = match.group(2).strip()

    start = match.end()
    end = matches[i + 1].start() if i + 1 < len(matches) else len(content)

    sql = content[start:end]

    # Remove SQL comments
    sql = re.sub(r"--.*", "", sql)
    sql = sql.strip()

    if sql.endswith(";"):
        sql = sql[:-1].strip()

    if sql.upper().startswith("SELECT"):
        queries.append((number, name, sql))

if not queries:
    raise SystemExit("No SQL queries found.")

print(f"Found {len(queries)} queries.")

results = []

for number, name, sql in queries:
    print(f"\nBenchmarking Query {number}: {name}")

    times = []
    plans = []

    for run in range(1, 4):
        explain_sql = (
            "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) " + sql
        )

        result = subprocess.run(
            ["psql", "-X", "-q", "-A", "-t", "-d", DB,
             "-c", explain_sql],
            capture_output=True,
            text=True
        )

        if result.returncode != 0:
            raise RuntimeError(
                f"Query {number}, run {run} failed:\n{result.stderr}"
            )

        output = result.stdout.strip()
        match = re.search(
            r"Execution Time:\s*([\d.]+)\s*ms",
            output
        )

        if not match:
            raise RuntimeError(
                f"Execution time missing for query {number}, run {run}"
            )

        execution_time = float(match.group(1))
        times.append(execution_time)
        plans.append(output)

        print(f"  Run {run}: {execution_time:.3f} ms")

    average = sum(times) / len(times)

    results.append((number, name, times, average))

    plan_file = PLAN_DIR / f"query_{number:02d}.txt"

    with plan_file.open("w") as f:
        f.write(f"Query {number}: {name}\n")
        f.write(f"Database: {DB}\n")
        f.write(f"Generated: {datetime.now()}\n")
        f.write("=" * 70 + "\n")

        for run, plan in enumerate(plans, 1):
            f.write(f"\nRUN {run}\n")
            f.write("-" * 70 + "\n")
            f.write(plan + "\n")

    print(f"  Average: {average:.3f} ms")
    print(f"  Plan saved: {plan_file}")

# Generate timing report
report = [
    "# CP Battle - CP04 Query Benchmark Results",
    "",
    f"- Database: `{DB}`",
    "- Method: `EXPLAIN (ANALYZE, BUFFERS)`",
    "- Runs per query: 3",
    "- Benchmark state: Existing optimized indexes",
    f"- Generated: {datetime.now()}",
    "",
    "## Query Execution Timings",
    "",
    "| Query | Run 1 (ms) | Run 2 (ms) | Run 3 (ms) | Average (ms) |",
    "|---|---:|---:|---:|---:|"
]

for number, name, times, average in results:
    report.append(
        f"| {number}. {name} | "
        f"{times[0]:.3f} | {times[1]:.3f} | "
        f"{times[2]:.3f} | {average:.3f} |"
    )

report += [
    "",
    "## Execution Plans",
    "",
    "Individual execution plans for all three runs are saved in `plans/`.",
    "",
    "## Notes",
    "",
    "These measurements represent the current indexed database state.",
    "No baseline-versus-optimized improvement is claimed from these runs.",
    "Execution times may vary with cache state and system load.",
    ""
]

Path("dbms/05_query_timings.md").write_text("\n".join(report))

print("\n===================================")
print("CP04 BENCHMARK COMPLETED")
print(f"Queries benchmarked: {len(results)}")
print(f"Execution plans: {len(results)}")
print("Timing report updated.")
print("===================================")
