// The few queries Prisma's query builder cannot express (ordering and matching
// on lower(display_name), so the expression indexes ix_profiles_ladder and
// ix_profiles_display_name_lower are used). Each starts with a /* name */
// comment; the in-memory test database answers them by that name.

/** The all-time board: people (not bots) by rating, then name. */
export function ladderTop(db, limit = 100) {
  return db.$queryRaw`/* ladder_top */
    SELECT id, display_name, rating, wins, losses FROM profiles
    WHERE is_bot = false AND user_id IS NOT NULL
    ORDER BY rating DESC, lower(display_name)
    LIMIT ${limit}`;
}

/** How many people are ordered ahead of this rating and name on the all-time board. */
export async function ladderAhead(db, rating, name) {
  const rows = await db.$queryRaw`/* ladder_ahead */
    SELECT count(*)::int AS n FROM profiles
    WHERE is_bot = false AND user_id IS NOT NULL
      AND (rating > ${rating} OR (rating = ${rating} AND lower(display_name) < lower(${name})))`;
  return Number(rows[0].n);
}

/** A person's profile id by display name, case-insensitively. */
export async function profileIdByName(db, name) {
  const rows = await db.$queryRaw`/* profile_by_name */
    SELECT id FROM profiles WHERE lower(display_name) = lower(${name}) AND is_bot = false
    ORDER BY id LIMIT 1`;
  return rows.length ? Number(rows[0].id) : null;
}

export const ping = (db) => db.$queryRaw`/* ping */ SELECT 1`;
