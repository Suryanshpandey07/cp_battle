-- CP Battle: SQL Queries
-- PostgreSQL

-- 1. Display all registered users
SELECT
    user_id,
    username,
    codeforces_handle,
    rating,
    created_at
FROM users
ORDER BY rating DESC;


-- 2. Display all battles with their current status
SELECT
    battle_id,
    problem_code,
    problem_name,
    problem_rating,
    start_time,
    end_time,
    status
FROM battles
ORDER BY created_at DESC;


-- 3. Display battles with their participants
SELECT
    b.battle_id,
    b.problem_name,
    u.username,
    bp.player_slot,
    bp.joined_at
FROM battles b
JOIN battle_participants bp
    ON b.battle_id = bp.battle_id
JOIN users u
    ON bp.user_id = u.user_id
ORDER BY b.battle_id, bp.player_slot;


-- 4. Display completed battles and their winners
SELECT
    b.battle_id,
    b.problem_name,
    winner.username AS winner,
    br.completed_at,
    br.result_description
FROM battles b
JOIN battle_results br
    ON b.battle_id = br.battle_id
LEFT JOIN users winner
    ON br.winner_user_id = winner.user_id
WHERE b.status = 'completed'
ORDER BY br.completed_at DESC;


-- 5. Count the total battles played by each user
SELECT
    u.user_id,
    u.username,
    COUNT(bp.battle_id) AS total_battles
FROM users u
LEFT JOIN battle_participants bp
    ON u.user_id = bp.user_id
GROUP BY u.user_id, u.username
ORDER BY total_battles DESC;


-- 6. Display the leaderboard based on battle wins
SELECT
    u.user_id,
    u.username,
    COUNT(br.battle_id) AS total_wins
FROM users u
LEFT JOIN battle_results br
    ON u.user_id = br.winner_user_id
GROUP BY u.user_id, u.username
ORDER BY total_wins DESC, u.username;


-- 7. Find users who have never participated in a battle
SELECT
    user_id,
    username,
    email
FROM users
WHERE user_id NOT IN (
    SELECT user_id
    FROM battle_participants
);


-- 8. Display all submissions with player and battle details
SELECT
    s.submission_id,
    u.username,
    b.problem_name,
    s.language,
    s.verdict,
    s.execution_time_ms,
    s.memory_used_kb,
    s.submitted_at
FROM submissions s
JOIN users u
    ON s.user_id = u.user_id
JOIN battles b
    ON s.battle_id = b.battle_id
ORDER BY s.submitted_at DESC;


-- 9. Count submissions made by each user
SELECT
    u.user_id,
    u.username,
    COUNT(s.submission_id) AS total_submissions
FROM users u
LEFT JOIN submissions s
    ON u.user_id = s.user_id
GROUP BY u.user_id, u.username
ORDER BY total_submissions DESC;


-- 10. Find the average execution time of accepted submissions
SELECT
    AVG(execution_time_ms) AS average_execution_time_ms
FROM submissions
WHERE verdict = 'OK'
  AND execution_time_ms IS NOT NULL;


-- 11. Find users whose rating is above the average user rating
SELECT
    user_id,
    username,
    rating
FROM users
WHERE rating > (
    SELECT AVG(rating)
    FROM users
)
ORDER BY rating DESC;


-- 12. Display the number of participants in each battle
SELECT
    b.battle_id,
    b.problem_name,
    COUNT(bp.user_id) AS participant_count
FROM battles b
LEFT JOIN battle_participants bp
    ON b.battle_id = bp.battle_id
GROUP BY b.battle_id, b.problem_name
ORDER BY b.battle_id;
