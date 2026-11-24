// The in-memory answers to src/db/sql.js's raw queries, by their /* name */.

const people = (db) => db.profile.rows.filter((p) => p.is_bot === false && p.user_id !== null);
const lower = (s) => s.toLowerCase();
const byLadder = (a, b) => b.rating - a.rating || (lower(a.display_name) < lower(b.display_name) ? -1 : lower(a.display_name) > lower(b.display_name) ? 1 : 0);

export const RAW_HANDLERS = {
  ladder_top: (db, limit) => people(db).sort(byLadder).slice(0, limit)
    .map((p) => ({ id: p.id, display_name: p.display_name, rating: p.rating, wins: p.wins, losses: p.losses })),
  ladder_ahead: (db, rating, rating2, name) => [{
    n: people(db).filter((p) => p.rating > rating || (p.rating === rating2 && lower(p.display_name) < lower(name))).length,
  }],
  profile_by_name: (db, name) => db.profile.rows.filter((p) => lower(p.display_name) === lower(name) && p.is_bot === false)
    .sort((a, b) => a.id - b.id).slice(0, 1).map((p) => ({ id: p.id })),
};
