"""Print SQL that loads the game's 17 real problems and their 144 test cases.

    python3 dbms/tools/load_problems.py | psql -d algoarena

Tier, base damage and base recoil come from shared/game-config.json exactly as
backend/app/seed.py derives them.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
cfg = json.loads((ROOT / "shared/game-config.json").read_text())
tiers = sorted(cfg["tiers"], key=lambda t: t["min_rating"])


def tier_row(rating: int) -> dict:
    return [t for t in tiers if rating >= t["min_rating"]][-1]


def lit(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, (dict, list)):
        v = json.dumps(v)
    tag = "$q$"
    while tag in v:
        tag = tag[:-1] + "x$"
    return f"{tag}{v}{tag}"


print("BEGIN;")
for i, f in enumerate(sorted((ROOT / "backend/seed/problems").glob("*.json")), 1):
    d = json.loads(f.read_text())
    t = tier_row(d["rating"])
    cols = {
        "id": i, "slug": d["slug"], "title": d["title"], "statement_md": d["statement_md"], "input_md": d.get("input_md", ""),
        "output_md": d.get("output_md", ""), "constraints_md": d.get("constraints_md", ""), "biome": d["biome"],
        "rating": d["rating"], "tier": t["tier"], "base_damage": d.get("base_damage", t["base_damage"]),
        "base_recoil": d.get("base_recoil", t["base_recoil"]), "time_limit_ms": d.get("time_limit_ms", 2000),
        "memory_mb": d.get("memory_mb", 256), "checker": d.get("checker", "exact"), "checker_script": d.get("checker_script"),
        "tags": d.get("tags", []), "hints": d.get("hints", []), "stubs": d.get("stubs", {}),
        "reference_solution": d.get("reference_solution", ""), "status": "published",
    }
    print(f"INSERT INTO problems ({', '.join(cols)}) VALUES ({', '.join(lit(v) for v in cols.values())});")
    for k, tc in enumerate(d["tests"]):
        print(f"INSERT INTO test_cases (problem_id, idx, input_text, expected_text, is_sample) VALUES "
              f"({i}, {k}, {lit(tc['input'])}, {lit(tc['expected'])}, {lit(bool(tc.get('is_sample')))});")
print("SELECT setval('problems_id_seq', (SELECT max(id) FROM problems));")
print("COMMIT;")
