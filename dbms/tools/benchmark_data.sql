-- =============================================================================
-- Benchmark data for 05_query_timings.md: a year of play for 20,000 players.
--
-- Run after 03_schema.sql and tools/load_problems.py:
--     psql -d algoarena -f dbms/tools/benchmark_data.sql
--
-- Reproducible: setseed() fixes every random() below, and "now" is pinned to
-- 2026-11-23 12:00 UTC so date windows (this week, today's quests) always cover
-- the same rows. Sizes after loading:
--   users 20,000 · profiles 20,005 · refresh_tokens 60,000 · matches 100,050
--   match_events 2,500,520 · submissions 499,940 · rating_history 145,715
--   inventory 240,862 · purchases 26,401 · quest_progress 188,680
--   achievements 15,642 · drafts 400 · flags 2,000 · reports 567 · audit_log 3,000
--   problems 17 · test_cases 144 (from tools/load_problems.py); about 1.4 GB.
-- =============================================================================
\set ON_ERROR_STOP on
SET client_min_messages = warning;
SELECT setseed(0.4242);

BEGIN;

TRUNCATE reports, audit_log, flags, achievements, quest_progress, rating_history, purchases, inventory,
    drafts, match_events, submissions, matches, profiles, refresh_tokens, users RESTART IDENTITY CASCADE;

-- Tier rules from shared/game-config.json (rating -> tier -> max HP).
CREATE TEMP TABLE tier_rule (tier int PRIMARY KEY, min_rating int, max_hp int);
INSERT INTO tier_rule VALUES (1, 0, 15000), (2, 1200, 28000), (3, 1400, 50000), (4, 1600, 95000), (5, 1900, 180000);
CREATE FUNCTION pg_temp.tier_of(r int) RETURNS int LANGUAGE sql IMMUTABLE AS
  $$ SELECT max(tier) FROM tier_rule WHERE r >= min_rating $$;
CREATE FUNCTION pg_temp.hp_of(r int) RETURNS int LANGUAGE sql IMMUTABLE AS
  $$ SELECT max_hp FROM tier_rule WHERE tier = pg_temp.tier_of(r) $$;
CREATE FUNCTION pg_temp.uuid_of(t text) RETURNS varchar LANGUAGE sql IMMUTABLE AS
  $$ SELECT substr(md5(t), 1, 8) || '-' || substr(md5(t), 9, 4) || '-4' || substr(md5(t), 14, 3) || '-8'
            || substr(md5(t), 18, 3) || '-' || substr(md5(t), 21, 12) $$;

-- ---------------------------------------------------------------- people
INSERT INTO users (id, username, username_lower, password_hash, role, created_at)
SELECT i, u, lower(u),
       '$argon2id$v=19$m=65536,t=3,p=4$' || md5('salt' || i) || '$' || md5('hash' || i),
       CASE WHEN i <= 3 THEN 'admin' ELSE 'player' END,
       timestamp '2026-11-23 12:00' - (30 + random() * 400) * interval '1 day'
FROM (SELECT i, CASE WHEN i % 3 = 0 THEN 'Player_' ELSE 'player_' END || i AS u FROM generate_series(1, 20000) i) g;

INSERT INTO profiles (id, user_id, display_name, rating, peak_rating, wins, losses, draws, points,
                      equipped_card, equipped_avatar, equipped_arena, equipped_weapon, avatar_color, settings,
                      counters, badges, daily_day, last_win_day, created_at)
SELECT u.id, u.id, u.username, r, r + (random() * 90)::int,
       (random() * 120)::int, (random() * 110)::int, (random() * 6)::int, (random() * 4000)::int,
       (ARRAY['card.classic', 'card.azure', 'card.inferno', 'card.magma', 'card.voltage'])[1 + (random() * 4)::int],
       (ARRAY['bean.plain', 'bean.ninja', 'bean.cape', 'bean.astro'])[1 + (random() * 3)::int],
       (ARRAY[NULL, 'arena.bit', 'arena.neon', 'arena.sakura', 'arena.space'])[1 + (random() * 4)::int],
       (ARRAY['weapon.fireball', 'weapon.arrows', 'weapon.gun', 'weapon.spear', 'weapon.lightning'])[1 + (random() * 4)::int],
       '#' || substr(md5('c' || u.id), 1, 6),
       json_build_object('master', 0.8, 'music', true, 'musicVolume', 0.6, 'codeLanguage', CASE WHEN random() < 0.45 THEN 'cpp' ELSE 'python' END,
                         'templates', CASE WHEN random() < 0.3 THEN json_build_object('cpp', '#include <bits/stdc++.h>' || chr(10) || 'using namespace std;' || chr(10) || 'int main() {' || chr(10) || '}') ELSE '{}'::json END),
       json_build_object('career_blocks', (random() * 5)::int, 'bit_wins', (random() * 30)::int, 'ac_streak', (random() * 8)::int, 'ranked_win_streak', (random() * 4)::int),
       '[]'::json, '2026-11-23', '2026-11-' || lpad((1 + (random() * 22)::int)::text, 2, '0'), u.created_at
FROM users u,
     LATERAL (SELECT greatest(300, least(2600, 1300 + ((random() + random() + random() - 1.5) * 420)::int)) + 0 * u.id AS r OFFSET 0) rr;

-- the four bots and the practice dummy (no user)
INSERT INTO profiles (id, display_name, rating, peak_rating, is_bot, personality, avatar_color)
VALUES (20001, 'Rusty', 1250, 1250, TRUE, 'rusty', '#b45309'), (20002, 'Sprinter', 1250, 1250, TRUE, 'sprinter', '#0ea5e9'),
       (20003, 'Gambler', 1250, 1250, TRUE, 'gambler', '#a855f7'), (20004, 'Turtle', 1250, 1250, TRUE, 'turtle', '#22c55e'),
       (20005, 'Training Dummy', 1200, 1200, TRUE, 'dummy', '#94a3b8');

INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked_at, created_at)
SELECT u, encode(sha256(('token-' || u || '-' || k)::bytea), 'hex'), t + interval '30 days',
       CASE WHEN k < 3 THEN t + interval '1 hour' END, t
FROM generate_series(1, 20000) u, generate_series(1, 3) k,
     LATERAL (SELECT timestamp '2026-11-23 12:00' - (3 - k) * interval '5 days' - random() * interval '2 days' AS t OFFSET 0) tt;

-- ---------------------------------------------------------------- matches
-- Busy players play far more than others: player 1 + floor(x^2.2 * 20000).
CREATE TEMP TABLE gen AS
SELECT n,
       pg_temp.uuid_of('match-' || n) AS id,
       CASE WHEN rm < 0.6 THEN 'ranked' WHEN rm < 0.9 THEN 'bot' ELSE 'practice' END AS mode,
       CASE WHEN rp < 0.5 THEN 'bit' WHEN rp < 0.85 THEN 'binary' ELSE 'prestige' END AS map,
       1 + floor(power(random(), 2.2) * 20000)::int AS p1,
       floor(random() * 19999)::int AS hop,
       20001 + floor(random() * 4)::int AS bot,
       timestamp '2026-11-23 11:00' - power(random(), 1.4) * interval '365 days' AS created,
       random() AS rs, random() AS rw, random() AS re, (2 + floor(random() * 7))::int AS subs,
       (240000 + random() * 1200000)::int AS elapsed
FROM (SELECT n, random() AS rm, random() AS rp FROM generate_series(1, 100000) n) g;

ALTER TABLE gen ADD COLUMN p2 int;
UPDATE gen SET p2 = CASE mode WHEN 'ranked' THEN 1 + ((p1 + hop) % 20000) WHEN 'bot' THEN bot ELSE 20005 END;

INSERT INTO matches (id, mode, map, status, seed, stage_theme, stage_owner_side, created_at, start_time, end_time, elapsed_ms,
                     end_reason, outcome, winner_side, labels, result, decks, last_seq,
                     player1_profile_id, player1_name, player1_rating, player1_tier, player1_max_hp, player1_hp, player1_damage_dealt,
                     player1_hits_landed, player1_skins, player1_is_bot, player1_blocks_left, player1_hints_left, player1_rerolls_left,
                     player1_hand, player1_hints_revealed, player1_stats,
                     player2_profile_id, player2_name, player2_rating, player2_tier, player2_max_hp, player2_hp, player2_damage_dealt,
                     player2_hits_landed, player2_skins, player2_is_bot, player2_blocks_left, player2_hints_left, player2_rerolls_left,
                     player2_hand, player2_hints_revealed, player2_stats)
SELECT g.id, g.mode, g.map, st.status, g.n, 'arena.' || CASE g.map WHEN 'binary' THEN 'circuit' ELSE g.map END, 1 + (g.n % 2),
       g.created, g.created + interval '20 seconds', g.created + interval '20 seconds' + g.elapsed * interval '1 ms', g.elapsed,
       st.end_reason, st.outcome, st.winner,
       CASE WHEN st.winner IS NULL THEN json_build_object('1', st.label_draw, '2', st.label_draw)
            ELSE json_build_object(st.winner::text, 'victory', (3 - st.winner)::text, 'defeat') END,
       json_build_object('outcome', st.outcome, 'end_reason', st.end_reason, 'winner_side', st.winner, 'sides',
                         json_build_object('1', json_build_object('before', a.rating, 'after', a.rating + d.d1, 'delta', d.d1, 'multiplier', 100),
                                           '2', json_build_object('before', b.rating, 'after', b.rating + d.d2, 'delta', d.d2, 'multiplier', 100))),
       json_build_object('1', json_build_array(1, 2, 3, 4), '2', json_build_array(5, 6, 7, 8), '3', json_build_array(9, 10, 11, 12),
                         '4', json_build_array(13, 14, 15), '5', json_build_array(16, 17)),
       10 + 3 * g.subs,
       a.id, a.display_name, a.rating, pg_temp.tier_of(a.rating), pg_temp.hp_of(a.rating),
       CASE WHEN st.winner = 2 THEN 0 ELSE (pg_temp.hp_of(a.rating) * (0.1 + random() * 0.9))::int END,
       (random() * 60000)::int, (random() * 5)::int,
       json_build_object('card', a.equipped_card, 'avatar', a.equipped_avatar, 'arena', a.equipped_arena, 'color', a.avatar_color, 'weapon', a.equipped_weapon),
       FALSE, (random() * 2)::int, (random() * 3)::int, (random() * 2)::int,
       json_build_object('slots', json_build_array(json_build_object('slug', 'xor-pairs', 'tier', 1), json_build_object('slug', 'gray-ladder', 'tier', 2),
                                                   json_build_object('slug', 'lone-bit', 'tier', 3), json_build_object('slug', 'peak-finder', 'tier', 4))),
       '{}'::json,
       json_build_object('crits', (random() * 2)::int, 'backfires', (random() * 2)::int, 'accepted', (random() * 4)::int, 'submissions', g.subs / 2,
                         'biggest_hit', (random() * 20000)::int, 'fastest_solve_ms', (60000 + random() * 800000)::int, 'damage_taken', (random() * 30000)::int,
                         'blocks_absorbed', (random() * 1.3)::int),
       b.id, CASE WHEN g.mode = 'practice' THEN 'Training Dummy' ELSE b.display_name END, b.rating, pg_temp.tier_of(b.rating), pg_temp.hp_of(b.rating),
       CASE WHEN st.winner = 1 THEN 0 ELSE (pg_temp.hp_of(b.rating) * (0.1 + random() * 0.9))::int END,
       (random() * 60000)::int, (random() * 5)::int,
       json_build_object('card', b.equipped_card, 'avatar', b.equipped_avatar, 'arena', b.equipped_arena, 'color', b.avatar_color, 'weapon', b.equipped_weapon),
       b.is_bot, (random() * 2)::int, (random() * 3)::int, (random() * 2)::int,
       json_build_object('slots', json_build_array(json_build_object('slug', 'bit-count', 'tier', 1), json_build_object('slug', 'mex-run', 'tier', 2),
                                                   json_build_object('slug', 'subset-parade', 'tier', 3), json_build_object('slug', 'kth-gap', 'tier', 4))),
       '{}'::json,
       json_build_object('crits', (random() * 2)::int, 'backfires', (random() * 2)::int, 'accepted', (random() * 4)::int, 'submissions', g.subs / 2,
                         'biggest_hit', (random() * 20000)::int, 'damage_taken', (random() * 30000)::int)
FROM gen g
JOIN profiles a ON a.id = g.p1
JOIN profiles b ON b.id = g.p2
CROSS JOIN LATERAL (
    SELECT CASE WHEN g.rs < 0.03 THEN 'aborted' ELSE 'finished' END AS status,
           CASE WHEN g.rs < 0.03 THEN 'aborted' WHEN g.rs < 0.07 THEN 'timer'
                WHEN g.re < 0.70 THEN 'ko' WHEN g.re < 0.88 THEN 'timer' WHEN g.re < 0.95 THEN 'forfeit' ELSE 'disconnect' END AS end_reason,
           CASE WHEN g.rs < 0.03 THEN 'aborted' WHEN g.rs < 0.07 THEN 'draw' ELSE 'win' END AS outcome,
           CASE WHEN g.rs < 0.07 THEN NULL WHEN g.rw < 0.52 THEN 1 ELSE 2 END AS winner,
           CASE WHEN g.rs < 0.03 THEN 'aborted' ELSE 'draw' END AS label_draw
) st
CROSS JOIN LATERAL (
    SELECT CASE WHEN st.winner = 1 THEN 8 + (g.n % 25) WHEN st.winner = 2 THEN -8 - (g.n % 20) ELSE 0 END AS d1,
           CASE WHEN g.mode <> 'ranked' THEN 0 WHEN st.winner = 2 THEN 8 + (g.n % 25) WHEN st.winner = 1 THEN -8 - (g.n % 20) ELSE 0 END AS d2
) d
ORDER BY g.created;   -- the app appends matches as they happen, so rows sit on disk in time order

-- fifty matches being played right now
INSERT INTO matches (id, mode, map, status, seed, created_at, start_time, elapsed_ms, last_seq,
                     player1_profile_id, player1_name, player1_rating, player1_tier, player1_max_hp, player1_hp, player1_connected,
                     player1_hand, player1_stats,
                     player2_profile_id, player2_name, player2_rating, player2_tier, player2_max_hp, player2_hp, player2_connected,
                     player2_hand, player2_stats)
SELECT pg_temp.uuid_of('live-' || i), 'ranked', 'bit', 'live', i,
       timestamp '2026-11-23 12:00' - (i * interval '30 seconds'), timestamp '2026-11-23 12:00' - (i * interval '30 seconds') + interval '20 seconds',
       i * 20000, 14,
       a.id, a.display_name, a.rating, pg_temp.tier_of(a.rating), pg_temp.hp_of(a.rating), pg_temp.hp_of(a.rating) / 2, TRUE,
       '{"slots": []}'::json, '{}'::json,
       b.id, b.display_name, b.rating, pg_temp.tier_of(b.rating), pg_temp.hp_of(b.rating), pg_temp.hp_of(b.rating) / 2, TRUE,
       '{"slots": []}'::json, '{}'::json
FROM generate_series(1, 50) i
JOIN profiles a ON a.id = 100 + i
JOIN profiles b ON b.id = 5000 + i;

-- ---------------------------------------------------------------- what happened in each match
INSERT INTO submissions (match_id, profile_id, problem_id, slot, language, code, cmd_id, status, verdict, failed_test,
                         tests_passed, tests_total, time_ms, memory_kb, damage, recoil, blocked, crit, is_bot, created_at)
SELECT m.id, CASE WHEN k % 2 = 1 OR m.mode = 'practice' THEN m.player1_profile_id ELSE m.player2_profile_id END,
       1 + ((m.seed * 7 + k * 3) % 17), (m.seed + k) % 4, v.lang,
       CASE WHEN v.lang = 'cpp'
            THEN '#include <bits/stdc++.h>' || chr(10) || 'using namespace std;' || chr(10) || 'int main(){ios::sync_with_stdio(false);cin.tie(nullptr);' || chr(10)
                 || 'long long n; cin >> n; vector<long long> a(n); for (auto &x : a) cin >> x;' || chr(10) || repeat('// work' || chr(10), 6) || 'cout << n << "\n";}'
            ELSE 'import sys' || chr(10) || 'def main():' || chr(10) || '    data = sys.stdin.read().split()' || chr(10) || '    n = int(data[0])' || chr(10)
                 || repeat('    # work' || chr(10), 6) || '    print(n)' || chr(10) || 'main()' END,
       'cmd-' || m.seed || '-' || k, v.status, v.verdict,
       CASE WHEN v.verdict NOT IN ('AC', 'CE') THEN 1 + (k % 6) END,
       CASE v.verdict WHEN 'AC' THEN 8 WHEN 'CE' THEN 0 ELSE k % 6 END, CASE WHEN v.verdict = 'CE' THEN 0 ELSE 8 END,
       (20 + random() * 900)::int, (3000 + random() * 60000)::int,
       CASE WHEN v.verdict = 'AC' THEN (4000 + random() * 20000)::int ELSE 0 END,
       CASE WHEN v.verdict NOT IN ('AC', 'SE') AND v.status = 'done' THEN (2000 + random() * 8000)::int ELSE 0 END,
       coalesce(v.verdict = 'AC', FALSE) AND random() < 0.08, coalesce(v.verdict = 'AC', FALSE) AND random() < 0.1,
       k % 2 = 0 AND m.mode = 'bot',
       m.start_time + (k * m.elapsed_ms / (m.last_seq / 3 + 1)) * interval '1 ms'
FROM matches m
CROSS JOIN LATERAL generate_series(1, (m.last_seq - 10) / 3) k
CROSS JOIN LATERAL (
    SELECT CASE WHEN random() < 0.55 THEN 'python' ELSE 'cpp' END AS lang,
           CASE WHEN m.status = 'aborted' AND k = (m.last_seq - 10) / 3 THEN 'void' ELSE 'done' END AS status,
           CASE WHEN m.status = 'aborted' AND k = (m.last_seq - 10) / 3 THEN NULL
                ELSE (ARRAY['AC', 'AC', 'AC', 'AC', 'AC', 'WA', 'WA', 'WA', 'TLE', 'RE', 'CE', 'MLE', 'OLE'])[1 + floor(random() * 13)::int] END AS verdict
) v
WHERE m.status <> 'live';

-- the event log: start-up events, then three events per submission, then the end
INSERT INTO match_events (match_id, seq, t_ms, type, payload, visibility)
SELECT m.id, s, s * 9000 + (random() * 4000)::int,
       CASE WHEN s = 1 THEN 'match.created' WHEN s = 2 THEN 'ready.check' WHEN s <= 4 THEN 'player.ready' WHEN s = 5 THEN 'match.start'
            WHEN s <= 7 THEN 'hand.updated' WHEN s >= m.last_seq - 1 THEN (CASE WHEN s = m.last_seq THEN 'rewards' ELSE 'match.end' END)
            WHEN s % 3 = 0 THEN 'submission.received' WHEN s % 3 = 1 THEN 'submission.verdict' ELSE 'attack.hit' END,
       json_build_object('side', 1 + s % 2, 'slot', s % 4, 'seq', s, 'hp', json_build_object('1', m.player1_hp, '2', m.player2_hp),
                         'damage', CASE WHEN s % 3 = 2 THEN (random() * 20000)::int END, 'verdict', CASE WHEN s % 3 = 1 THEN 'AC' END),
       CASE WHEN s IN (6, 7) THEN 'p' || (s - 5) ELSE 'both' END
FROM matches m
CROSS JOIN LATERAL generate_series(1, m.last_seq) s;

INSERT INTO rating_history (profile_id, match_id, before, after, delta, steps, multiplier, created_at)
SELECT x.pid, m.id, x.before, x.before + x.delta, x.delta,
       json_build_array(json_build_object('key', CASE WHEN x.delta > 0 THEN 'win' WHEN x.delta < 0 THEN 'loss' ELSE 'draw' END, 'delta', x.delta)),
       CASE m.mode WHEN 'bot' THEN 40 ELSE 100 END, m.end_time
FROM matches m
CROSS JOIN LATERAL (VALUES
    (m.player1_profile_id, m.player1_rating, (m.result -> 'sides' -> '1' ->> 'delta')::int, TRUE),
    (m.player2_profile_id, m.player2_rating, (m.result -> 'sides' -> '2' ->> 'delta')::int, m.mode = 'ranked')
) x (pid, before, delta, rated)
WHERE m.status = 'finished' AND m.mode IN ('ranked', 'bot') AND x.rated AND x.before + x.delta >= 0;

-- in-progress code for the live matches
INSERT INTO drafts (match_id, profile_id, slot, language, code, problem_slug, updated_at)
SELECT m.id, CASE WHEN side = 1 THEN m.player1_profile_id ELSE m.player2_profile_id END, slot, lang,
       'print(sum(map(int, input().split())))', 'xor-pairs', m.created_at + interval '2 minutes'
FROM matches m, generate_series(1, 2) side, generate_series(0, 1) slot, unnest(ARRAY['python', 'cpp']) lang
WHERE m.status = 'live';

-- ---------------------------------------------------------------- items, progress, moderation
INSERT INTO inventory (profile_id, skin_id, source, acquired_at)
SELECT p.id, d.skin, 'default', p.created_at
FROM profiles p
CROSS JOIN unnest(ARRAY['arena.bit', 'arena.circuit', 'arena.prestige', 'bean.plain', 'card.classic', 'weapon.arrows',
                        'weapon.fireball', 'weapon.gun', 'weapon.lightning', 'weapon.spear']) d (skin)
WHERE NOT p.is_bot;

INSERT INTO inventory (profile_id, skin_id, source, acquired_at)
SELECT p.id, e.skin, e.src, p.created_at + random() * interval '200 days'
FROM profiles p
CROSS JOIN (VALUES ('arena.handheld', 'ap'), ('arena.neon', 'ap'), ('arena.sakura', 'ap'), ('arena.volcano', 'ap'), ('bean.astro', 'ap'),
                   ('bean.dino', 'ap'), ('bean.ninja', 'ap'), ('card.frostbyte', 'ap'), ('card.magma', 'ap'), ('card.voltage', 'ap'),
                   ('weapon.shuriken', 'ap'), ('card.azure', 'tier'), ('card.inferno', 'tier'), ('bean.cape', 'tier'),
                   ('arena.space', 'tier'), ('weapon.laser', 'tier'), ('card.glitch', 'achievement')) e (skin, src)
WHERE NOT p.is_bot AND random() < 0.12;

INSERT INTO purchases (profile_id, skin_id, idem_key, price, created_at)
SELECT profile_id, skin_id, md5('buy' || id), 300 + (id % 16) * 100, acquired_at
FROM inventory WHERE source = 'ap';

INSERT INTO achievements (profile_id, key, progress, earned_at)
SELECT p.id, a.key, 1, p.created_at + random() * interval '300 days'
FROM profiles p
CROSS JOIN unnest(ARRAY['flawless', 'comeback', 'one_shot', 'heroic', 'wall', 'crit_machine', 'bit_master', 'perfectionist',
                        'marathon', 'hot_streak']) a (key)
WHERE NOT p.is_bot AND random() < 0.08;

UPDATE profiles p SET badges = b.keys
FROM (SELECT profile_id, json_agg(key ORDER BY key) AS keys FROM achievements GROUP BY profile_id) b
WHERE b.profile_id = p.id;

-- the last 30 days of daily quests for the more active half of the players
INSERT INTO quest_progress (profile_id, day, key, progress, target, earned_at, claimed_at)
SELECT p, to_char(date '2026-11-23' - d, 'YYYY-MM-DD'), q.key, pr, q.target,
       CASE WHEN pr >= q.target THEN timestamp '2026-11-23' - d * interval '1 day' + interval '18 hours' END,
       CASE WHEN pr >= q.target AND random() < 0.7 THEN timestamp '2026-11-23' - d * interval '1 day' + interval '19 hours' END
FROM generate_series(0, 29) d
CROSS JOIN generate_series(1, 10000) p
CROSS JOIN LATERAL (VALUES ((ARRAY['first_blood', 'ambitious', 'wall', 'bit_hunter'])[1 + (d % 4)], 1),
                           ((ARRAY['binary_hunter', 'sparring', 'clean_sweep'])[1 + (d % 3)], 1),
                           ('daily_grind', 3)) q (key, target)
CROSS JOIN LATERAL (SELECT least(q.target, floor(random() * (q.target + 1.5))::int) AS pr OFFSET 0) r
WHERE random() < 0.21;

INSERT INTO flags (match_id, profile_id, kind, severity, details, status, created_at)
SELECT m.id, m.player1_profile_id, CASE WHEN i % 3 = 0 THEN 'judge_system_errors' ELSE 'suspicious_speed' END, 1 + i % 3,
       json_build_object('count', 1 + i % 5), (ARRAY['open', 'open', 'dismissed', 'warned', 'actioned'])[1 + i % 5], m.end_time
FROM generate_series(1, 2000) i
JOIN matches m ON m.id = pg_temp.uuid_of('match-' || (i * 47));

INSERT INTO reports (reporter_id, match_id, target_profile_id, reason, created_at)
SELECT m.player1_profile_id, m.id, m.player2_profile_id, 'They pasted a solution in under ten seconds', m.end_time
FROM generate_series(1, 1000) i
JOIN matches m ON m.id = pg_temp.uuid_of('match-' || (i * 89)) AND m.mode = 'ranked';

INSERT INTO audit_log (actor_id, action, target, details, created_at)
SELECT 1 + i % 3, (ARRAY['void_match', 'grant_skin', 'suspend', 'flag_dismissed', 'reset_daily_cap'])[1 + i % 5],
       'player_' || (1 + i * 7 % 20000), json_build_object('note', 'benchmark'), timestamp '2026-11-23 12:00' - i * interval '1 hour'
FROM generate_series(1, 3000) i;

-- keep the sequences ahead of the explicit ids
SELECT setval('users_id_seq', (SELECT max(id) FROM users));
SELECT setval('profiles_id_seq', (SELECT max(id) FROM profiles));

COMMIT;

VACUUM ANALYZE;

SELECT 'users' AS table_name, count(*) FROM users UNION ALL SELECT 'profiles', count(*) FROM profiles
UNION ALL SELECT 'refresh_tokens', count(*) FROM refresh_tokens UNION ALL SELECT 'problems', count(*) FROM problems
UNION ALL SELECT 'test_cases', count(*) FROM test_cases UNION ALL SELECT 'matches', count(*) FROM matches
UNION ALL SELECT 'match_events', count(*) FROM match_events UNION ALL SELECT 'submissions', count(*) FROM submissions
UNION ALL SELECT 'rating_history', count(*) FROM rating_history UNION ALL SELECT 'drafts', count(*) FROM drafts
UNION ALL SELECT 'inventory', count(*) FROM inventory UNION ALL SELECT 'purchases', count(*) FROM purchases
UNION ALL SELECT 'achievements', count(*) FROM achievements UNION ALL SELECT 'quest_progress', count(*) FROM quest_progress
UNION ALL SELECT 'flags', count(*) FROM flags UNION ALL SELECT 'reports', count(*) FROM reports
UNION ALL SELECT 'audit_log', count(*) FROM audit_log;
