"""Draw 02_er_diagram.png from 03_schema.sql.

    python3 dbms/tools/er_diagram.py        (needs Graphviz: dot)

Reads every CREATE TABLE, its columns, primary key, foreign keys, UNIQUE
constraints and unique indexes straight from 03_schema.sql, so the picture can
not drift from the schema. Writes tools/er_diagram.dot and 02_er_diagram.png.

Notation (crow's foot): the end at a table says how many rows of that table go
with one row at the other end.  ||  exactly one   |o  zero or one   o{  zero or many
"""

import html
import pathlib
import re
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
DBMS = HERE.parent
SCHEMA = DBMS / "03_schema.sql"

GROUPS = {
    "Accounts and admin": (["users", "refresh_tokens", "profiles", "audit_log"], "#dbeafe", "#1e3a8a"),
    "Problems": (["problems", "test_cases"], "#dcfce7", "#14532d"),
    "Matches": (["matches", "submissions", "match_events", "drafts", "rating_history"], "#fee2e2", "#7f1d1d"),
    "Progress and economy": (["quest_progress", "achievements", "inventory", "purchases"], "#fef3c7", "#78350f"),
    "Moderation": (["flags", "reports"], "#ede9fe", "#4c1d95"),
}
FONT = "DejaVu Sans"
MONO = "DejaVu Sans Mono"


def parse(sql: str) -> dict:
    tables: dict = {}
    for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\n\);", sql, re.S):
        name, body = m.group(1), m.group(2)
        cols, uniques = [], []
        for raw in body.splitlines():
            line = raw.split("--")[0].strip().rstrip(",")
            if not line:
                continue
            u = re.match(r"CONSTRAINT \w+ UNIQUE \(([^)]*)\)", line)
            if u:
                uniques.append([c.strip() for c in u.group(1).split(",")])
                continue
            if line.startswith("CONSTRAINT"):
                continue
            c = re.match(r"(\w+)\s+([A-Z]+(?:\(\d+\))?)(.*)", line)
            if not c:
                continue
            rest = c.group(3)
            ref = re.search(r"REFERENCES (\w+) \((\w+)\)", rest)
            cols.append({"name": c.group(1), "type": c.group(2).lower(), "pk": "PRIMARY KEY" in rest,
                         "notnull": "NOT NULL" in rest or "PRIMARY KEY" in rest,
                         "ref": (ref.group(1), ref.group(2)) if ref else None,
                         "cascade": "ON DELETE CASCADE" in rest})
        tables[name] = {"cols": cols, "uniques": uniques}
    for m in re.finditer(r"CREATE UNIQUE INDEX \w+ ON (\w+) \(([^)]*)\)", sql):
        tables[m.group(1)]["uniques"].append([c.strip() for c in m.group(2).split(",")])
    return tables


def keys_of(t: dict, col: str) -> str:
    marks = []
    c = next(c for c in t["cols"] if c["name"] == col)
    if c["pk"]:
        marks.append("PK")
    if c["ref"]:
        marks.append("FK")
    for i, u in enumerate(t["uniques"]):
        if col in u:
            marks.append("UK" if len(u) == 1 else f"UK{i + 1}")
    return ", ".join(marks)


def table_label(name: str, t: dict, head_bg: str, head_fg: str) -> str:
    rows = [f'<TR><TD COLSPAN="3" BGCOLOR="{head_fg}" ALIGN="CENTER"><FONT COLOR="white" FACE="{FONT}" POINT-SIZE="13"><B>{name}</B></FONT></TD></TR>']
    cols = t["cols"]
    if name == "matches":   # 55 columns: show the keys, then the two player groups folded
        p1 = [c["name"][len("player1_"):] for c in cols if c["name"].startswith("player1_") and c["name"] != "player1_profile_id"]
        cols = [c for c in cols if not c["name"].startswith(("player1_", "player2_"))] + \
               [c for c in t["cols"] if c["name"] in ("player1_profile_id", "player2_profile_id")]
    for c in cols:
        k = keys_of(t, c["name"])
        bold = c["pk"] or c["ref"] or k
        nm = html.escape(c["name"])
        nm = f"<B>{nm}</B>" if bold else nm
        if c["pk"]:
            nm = f"<U>{nm}</U>"
        typ = html.escape(c["type"]) + ("" if c["notnull"] else " ?")
        rows.append(f'<TR><TD ALIGN="LEFT" BGCOLOR="{head_bg}"><FONT FACE="{MONO}" POINT-SIZE="9">{k or "&#160;"}</FONT></TD>'
                    f'<TD ALIGN="LEFT" PORT="{c["name"]}"><FONT FACE="{MONO}" POINT-SIZE="10">{nm}</FONT></TD>'
                    f'<TD ALIGN="LEFT"><FONT FACE="{MONO}" POINT-SIZE="9" COLOR="#555555">{typ}</FONT></TD></TR>')
    if name == "matches":
        chunks, line = [], ""
        for p in p1:
            nxt = (line + ", " if line else "") + p
            if len(nxt) > 44:
                chunks.append(line + ",")
                line = p
            else:
                line = nxt
        chunks.append(line)
        txt = "<BR ALIGN=\"LEFT\"/>".join(html.escape(x) for x in chunks)
        rows.append(f'<TR><TD BGCOLOR="{head_bg}"></TD><TD COLSPAN="2" ALIGN="LEFT"><FONT FACE="{MONO}" POINT-SIZE="9">'
                    f'<B>player1_* and player2_*</B>, {len(p1)} each:<BR ALIGN="LEFT"/>{txt}<BR ALIGN="LEFT"/></FONT></TD></TR>')
    for i, u in enumerate(t["uniques"]):
        if len(u) > 1:
            rows.append(f'<TR><TD COLSPAN="3" ALIGN="LEFT" BGCOLOR="#f8fafc"><FONT FACE="{FONT}" POINT-SIZE="9" COLOR="#334155">'
                        f'UK{i + 1}: unique ({html.escape(", ".join(u))})</FONT></TD></TR>')
    return '<<TABLE BORDER="1" CELLBORDER="1" CELLSPACING="0" CELLPADDING="3" COLOR="#94a3b8">' + "".join(rows) + "</TABLE>>"


def main() -> None:
    tables = parse(SCHEMA.read_text())
    assert len(tables) == 17, sorted(tables)
    out = ["digraph er {",
           f'  graph [rankdir=TB, splines=true, nodesep=0.45, ranksep=0.9, newrank=true, pad=0.4, bgcolor="white", fontname="{FONT}",'
           '         label=<<FONT POINT-SIZE="22"><B>AlgoArena (cp_battle): entity-relationship diagram</B></FONT><BR/>'
           '<FONT POINT-SIZE="12">17 tables from 03_schema.sql · PK primary key · FK foreign key · UK unique (alternate) key · '
           '<U>underlined</U> = primary key · ? = nullable<BR/>Crow\'s foot at each end: || exactly one · |o zero or one · '
           'o&lt; zero or many · edge label = foreign-key column (cardinality parent : child)</FONT>>,'
           '         labelloc=t];',
           f'  node [shape=plaintext, fontname="{FONT}"];',
           f'  edge [fontname="{FONT}", fontsize=9, color="#475569", fontcolor="#334155", dir=both, arrowsize=0.9, penwidth=1.2];']
    for gi, (gname, (members, bg, fg)) in enumerate(GROUPS.items()):
        out.append(f'  subgraph cluster_{gi} {{ label=<<B>{gname}</B>>; fontsize=14; style="rounded,filled"; '
                   f'fillcolor="{bg}50"; color="{fg}"; fontcolor="{fg}";')
        for t in members:
            out.append(f"    {t} [label={table_label(t, tables[t], bg, fg)}];")
        out.append("  }")
    n_fk = 0
    for child, t in tables.items():
        for c in t["cols"]:
            if not c["ref"]:
                continue
            n_fk += 1
            parent, pcol = c["ref"]
            unique = any(u == [c["name"]] for u in t["uniques"])
            tail = "teetee" if c["notnull"] else "teeodot"      # parents per child row
            head = "teeodot" if unique else "crowodot"           # child rows per parent
            card = ("1" if c["notnull"] else "0..1") + " : " + ("0..1" if unique else "0..N")
            extra = ", on delete cascade" if c["cascade"] else ""
            out.append(f'  {parent} -> {child} [arrowtail={tail}, arrowhead={head}, '
                       f'label="{c["name"]}\\n{card}{extra}"];')
    out.append("}")
    assert n_fk == 23, n_fk
    dot = "\n".join(out) + "\n"
    (HERE / "er_diagram.dot").write_text(dot)
    subprocess.run(["dot", "-Tpng", "-Gdpi=110", "-o", str(DBMS / "02_er_diagram.png"), str(HERE / "er_diagram.dot")], check=True)
    print("wrote", DBMS / "02_er_diagram.png", "with", len(tables), "tables and", n_fk, "relationships")


if __name__ == "__main__":
    main()
