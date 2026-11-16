-- CP Battle: PostgreSQL Database Schema

-- 1. Users: stores player account information
CREATE TABLE IF NOT EXISTS users (
    user_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    codeforces_handle VARCHAR(50) UNIQUE,
    rating INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Battles: stores each competitive programming battle
CREATE TABLE IF NOT EXISTS battles (
    battle_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    problem_code VARCHAR(30) NOT NULL,
    problem_name VARCHAR(255) NOT NULL,
    problem_url TEXT,
    problem_rating INTEGER,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'waiting'
        CHECK (status IN ('waiting', 'active', 'completed', 'cancelled')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_time > start_time)
);

-- 3. Battle participants: connects users to battles
-- Each battle has at most two players.
CREATE TABLE IF NOT EXISTS battle_participants (
    battle_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    player_slot SMALLINT NOT NULL CHECK (player_slot IN (1, 2)),
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (battle_id, user_id),
    UNIQUE (battle_id, player_slot),

    FOREIGN KEY (battle_id)
        REFERENCES battles(battle_id) ON DELETE CASCADE,

    FOREIGN KEY (user_id)
        REFERENCES users(user_id) ON DELETE CASCADE
);

-- 4. Submissions: stores players' submitted solutions
CREATE TABLE IF NOT EXISTS submissions (
    submission_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    battle_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    code TEXT NOT NULL,
    language VARCHAR(50) NOT NULL,
    verdict VARCHAR(30),
    execution_time_ms INTEGER,
    memory_used_kb INTEGER,
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (battle_id, user_id)
        REFERENCES battle_participants(battle_id, user_id)
        ON DELETE CASCADE,

    CHECK (execution_time_ms IS NULL OR execution_time_ms >= 0),
    CHECK (memory_used_kb IS NULL OR memory_used_kb >= 0)
);

-- 5. Battle results: stores the final outcome of each battle
CREATE TABLE IF NOT EXISTS battle_results (
    battle_id BIGINT PRIMARY KEY,
    winner_user_id BIGINT,
    completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    result_description TEXT,

    FOREIGN KEY (battle_id)
        REFERENCES battles(battle_id) ON DELETE CASCADE,

    FOREIGN KEY (battle_id, winner_user_id)
        REFERENCES battle_participants(battle_id, user_id)
);

-- Indexes for commonly used lookups
CREATE INDEX IF NOT EXISTS idx_battles_status
    ON battles(status);

CREATE INDEX IF NOT EXISTS idx_battle_participants_user
    ON battle_participants(user_id);

CREATE INDEX IF NOT EXISTS idx_submissions_battle_user
    ON submissions(battle_id, user_id);

CREATE INDEX IF NOT EXISTS idx_submissions_submitted_at
    ON submissions(submitted_at);

CREATE INDEX IF NOT EXISTS idx_battle_results_winner
    ON battle_results(winner_user_id);
