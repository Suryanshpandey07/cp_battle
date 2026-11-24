-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(20) NOT NULL,
    "username_lower" VARCHAR(20) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" VARCHAR(16) NOT NULL DEFAULT 'player',
    "suspended_until" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "revoked_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "display_name" VARCHAR(32) NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 1200,
    "peak_rating" INTEGER NOT NULL DEFAULT 1200,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 0,
    "equipped_card" VARCHAR(48) NOT NULL DEFAULT 'card.classic',
    "equipped_avatar" VARCHAR(48) NOT NULL DEFAULT 'bean.plain',
    "equipped_arena" VARCHAR(48),
    "equipped_weapon" VARCHAR(48) NOT NULL DEFAULT 'weapon.fireball',
    "avatar_color" VARCHAR(9) NOT NULL DEFAULT '#3b82f6',
    "settings" JSON DEFAULT '{}',
    "is_bot" BOOLEAN NOT NULL DEFAULT false,
    "personality" VARCHAR(16),
    "bot_gain_today" INTEGER NOT NULL DEFAULT 0,
    "casual_ap_today" INTEGER NOT NULL DEFAULT 0,
    "daily_day" VARCHAR(10) NOT NULL DEFAULT '',
    "last_win_day" VARCHAR(10) NOT NULL DEFAULT '',
    "no_show_strikes" INTEGER NOT NULL DEFAULT 0,
    "queue_ban_until" TIMESTAMP(6),
    "counters" JSON DEFAULT '{}',
    "badges" JSON DEFAULT '[]',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problems" (
    "id" SERIAL NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "statement_md" TEXT,
    "input_md" TEXT,
    "output_md" TEXT,
    "constraints_md" TEXT,
    "biome" VARCHAR(24) NOT NULL,
    "rating" INTEGER NOT NULL,
    "tier" INTEGER NOT NULL,
    "base_damage" INTEGER NOT NULL,
    "base_recoil" INTEGER NOT NULL,
    "time_limit_ms" INTEGER NOT NULL DEFAULT 2000,
    "memory_mb" INTEGER NOT NULL DEFAULT 256,
    "checker" VARCHAR(24) NOT NULL DEFAULT 'exact',
    "checker_script" TEXT,
    "tags" JSON DEFAULT '[]',
    "hints" JSON DEFAULT '[]',
    "stubs" JSON DEFAULT '{}',
    "reference_solution" TEXT,
    "status" VARCHAR(16) NOT NULL DEFAULT 'published',
    CONSTRAINT "problems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_cases" (
    "id" SERIAL NOT NULL,
    "problem_id" INTEGER NOT NULL,
    "idx" INTEGER NOT NULL,
    "input_text" TEXT,
    "expected_text" TEXT,
    "is_sample" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "test_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" VARCHAR(36) NOT NULL,
    "mode" VARCHAR(16) NOT NULL,
    "map" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'starting',
    "seed" INTEGER NOT NULL,
    "stage_theme" VARCHAR(48) NOT NULL DEFAULT 'arena.bit',
    "stage_owner_side" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "start_time" TIMESTAMP(6),
    "end_time" TIMESTAMP(6),
    "elapsed_ms" INTEGER NOT NULL DEFAULT 0,
    "end_reason" VARCHAR(16),
    "outcome" VARCHAR(16),
    "winner_side" INTEGER,
    "labels" JSON DEFAULT '{}',
    "result" JSON DEFAULT '{}',
    "decks" JSON DEFAULT '{}',
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "player1_profile_id" INTEGER NOT NULL,
    "player1_name" TEXT NOT NULL DEFAULT '',
    "player1_rating" INTEGER NOT NULL DEFAULT 0,
    "player1_tier" INTEGER NOT NULL DEFAULT 1,
    "player1_max_hp" INTEGER NOT NULL DEFAULT 0,
    "player1_hp" INTEGER NOT NULL DEFAULT 0,
    "player1_damage_dealt" INTEGER NOT NULL DEFAULT 0,
    "player1_hits_landed" INTEGER NOT NULL DEFAULT 0,
    "player1_skins" JSON DEFAULT '{}',
    "player1_is_bot" BOOLEAN NOT NULL DEFAULT false,
    "player1_blocks_left" INTEGER NOT NULL DEFAULT 0,
    "player1_hints_left" INTEGER NOT NULL DEFAULT 0,
    "player1_shield_until_ms" INTEGER,
    "player1_rerolls_left" INTEGER NOT NULL DEFAULT 0,
    "player1_last_reroll_ms" INTEGER,
    "player1_hand" JSON DEFAULT '{}',
    "player1_hints_revealed" JSON DEFAULT '{}',
    "player1_stats" JSON DEFAULT '{}',
    "player1_connected" BOOLEAN NOT NULL DEFAULT false,
    "player2_profile_id" INTEGER NOT NULL,
    "player2_name" TEXT NOT NULL DEFAULT '',
    "player2_rating" INTEGER NOT NULL DEFAULT 0,
    "player2_tier" INTEGER NOT NULL DEFAULT 1,
    "player2_max_hp" INTEGER NOT NULL DEFAULT 0,
    "player2_hp" INTEGER NOT NULL DEFAULT 0,
    "player2_damage_dealt" INTEGER NOT NULL DEFAULT 0,
    "player2_hits_landed" INTEGER NOT NULL DEFAULT 0,
    "player2_skins" JSON DEFAULT '{}',
    "player2_is_bot" BOOLEAN NOT NULL DEFAULT false,
    "player2_blocks_left" INTEGER NOT NULL DEFAULT 0,
    "player2_hints_left" INTEGER NOT NULL DEFAULT 0,
    "player2_shield_until_ms" INTEGER,
    "player2_rerolls_left" INTEGER NOT NULL DEFAULT 0,
    "player2_last_reroll_ms" INTEGER,
    "player2_hand" JSON DEFAULT '{}',
    "player2_hints_revealed" JSON DEFAULT '{}',
    "player2_stats" JSON DEFAULT '{}',
    "player2_connected" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" SERIAL NOT NULL,
    "match_id" VARCHAR(36) NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "problem_id" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "language" VARCHAR(16) NOT NULL,
    "code" TEXT,
    "cmd_id" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'judging',
    "verdict" VARCHAR(8),
    "failed_test" INTEGER,
    "tests_passed" INTEGER NOT NULL DEFAULT 0,
    "tests_total" INTEGER NOT NULL DEFAULT 0,
    "time_ms" INTEGER NOT NULL DEFAULT 0,
    "memory_kb" INTEGER NOT NULL DEFAULT 0,
    "damage" INTEGER NOT NULL DEFAULT 0,
    "recoil" INTEGER NOT NULL DEFAULT 0,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "crit" BOOLEAN NOT NULL DEFAULT false,
    "is_bot" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_events" (
    "id" SERIAL NOT NULL,
    "match_id" VARCHAR(36) NOT NULL,
    "seq" INTEGER NOT NULL,
    "t_ms" INTEGER NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "payload" JSON DEFAULT '{}',
    "visibility" VARCHAR(10) NOT NULL DEFAULT 'both',
    CONSTRAINT "match_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drafts" (
    "id" SERIAL NOT NULL,
    "match_id" VARCHAR(36) NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "language" VARCHAR(16) NOT NULL,
    "code" TEXT,
    "problem_slug" VARCHAR(64) NOT NULL DEFAULT '',
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "skin_id" VARCHAR(48) NOT NULL,
    "acquired_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" VARCHAR(16) NOT NULL DEFAULT 'default',
    CONSTRAINT "inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "skin_id" VARCHAR(48) NOT NULL,
    "idem_key" VARCHAR(64) NOT NULL,
    "price" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rating_history" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "match_id" VARCHAR(36) NOT NULL,
    "before" INTEGER NOT NULL,
    "after" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "steps" JSON DEFAULT '[]',
    "multiplier" INTEGER NOT NULL DEFAULT 100,
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rating_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quest_progress" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "day" VARCHAR(10) NOT NULL,
    "key" VARCHAR(32) NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "target" INTEGER NOT NULL DEFAULT 1,
    "earned_at" TIMESTAMP(6),
    "claimed_at" TIMESTAMP(6),
    CONSTRAINT "quest_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "key" VARCHAR(32) NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "earned_at" TIMESTAMP(6),
    "claimed_at" TIMESTAMP(6),
    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flags" (
    "id" SERIAL NOT NULL,
    "match_id" VARCHAR(36),
    "profile_id" INTEGER,
    "kind" VARCHAR(32) NOT NULL,
    "severity" INTEGER NOT NULL DEFAULT 1,
    "details" JSON DEFAULT '{}',
    "status" VARCHAR(16) NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "actor_id" INTEGER,
    "action" VARCHAR(48) NOT NULL,
    "target" VARCHAR(64) NOT NULL DEFAULT '',
    "details" JSON DEFAULT '{}',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" SERIAL NOT NULL,
    "reporter_id" INTEGER NOT NULL,
    "match_id" VARCHAR(36),
    "target_profile_id" INTEGER,
    "reason" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ix_users_username_lower" ON "users"("username_lower");

-- CreateIndex
CREATE INDEX "ix_refresh_tokens_user_id" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ix_refresh_tokens_token_hash" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "ix_profiles_display_name" ON "profiles"("display_name");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_user_id_key" ON "profiles"("user_id");

-- CreateIndex
CREATE INDEX "ix_problems_biome" ON "problems"("biome");

-- CreateIndex
CREATE INDEX "ix_problems_tier" ON "problems"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "ix_problems_slug" ON "problems"("slug");

-- CreateIndex
CREATE INDEX "ix_test_cases_problem_id" ON "test_cases"("problem_id");

-- CreateIndex
CREATE UNIQUE INDEX "test_cases_problem_id_idx_key" ON "test_cases"("problem_id", "idx");

-- CreateIndex
CREATE INDEX "ix_matches_mode" ON "matches"("mode");

-- CreateIndex
CREATE INDEX "ix_matches_status" ON "matches"("status");

-- CreateIndex
CREATE INDEX "ix_matches_player1_profile_id" ON "matches"("player1_profile_id");

-- CreateIndex
CREATE INDEX "ix_matches_player2_profile_id" ON "matches"("player2_profile_id");

-- CreateIndex
CREATE INDEX "ix_matches_created_at" ON "matches"("created_at");

-- CreateIndex
CREATE INDEX "ix_submissions_match_id" ON "submissions"("match_id");

-- CreateIndex
CREATE INDEX "ix_submissions_profile_id" ON "submissions"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_profile_id_cmd_id_key" ON "submissions"("profile_id", "cmd_id");

-- CreateIndex
CREATE INDEX "ix_match_events_match_id" ON "match_events"("match_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_events_match_id_seq_key" ON "match_events"("match_id", "seq");

-- CreateIndex
CREATE INDEX "ix_drafts_match_id" ON "drafts"("match_id");

-- CreateIndex
CREATE INDEX "ix_drafts_profile_id" ON "drafts"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "drafts_match_id_profile_id_slot_language_key" ON "drafts"("match_id", "profile_id", "slot", "language");

-- CreateIndex
CREATE INDEX "ix_inventory_profile_id" ON "inventory"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_profile_id_skin_id_key" ON "inventory"("profile_id", "skin_id");

-- CreateIndex
CREATE INDEX "ix_purchases_profile_id" ON "purchases"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_profile_id_idem_key_key" ON "purchases"("profile_id", "idem_key");

-- CreateIndex
CREATE INDEX "ix_rating_history_profile_id" ON "rating_history"("profile_id");

-- CreateIndex
CREATE INDEX "ix_rating_history_match_id" ON "rating_history"("match_id");

-- CreateIndex
CREATE INDEX "ix_rating_history_profile_created" ON "rating_history"("profile_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_quest_progress_profile_id" ON "quest_progress"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "quest_progress_profile_id_day_key_key" ON "quest_progress"("profile_id", "day", "key");

-- CreateIndex
CREATE INDEX "ix_achievements_profile_id" ON "achievements"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "achievements_profile_id_key_key" ON "achievements"("profile_id", "key");

-- CreateIndex
CREATE INDEX "ix_flags_match_id" ON "flags"("match_id");

-- CreateIndex
CREATE INDEX "ix_flags_profile_id" ON "flags"("profile_id");

-- CreateIndex
CREATE INDEX "ix_reports_reporter_id" ON "reports"("reporter_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "problems"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Indexes Prisma's schema language cannot express (partial and expression
-- indexes). The WHERE clauses repeat the app's own filters, so the planner can
-- prove a query is covered. See dbms/05_query_timings.md.

-- all-time leaderboard in order, and "how many rate higher"
CREATE INDEX "ix_profiles_ladder" ON "profiles"("rating" DESC, lower("display_name")) WHERE "is_bot" = false AND "user_id" IS NOT NULL;

-- profile pages find a player by name, ignoring case
CREATE INDEX "ix_profiles_display_name_lower" ON "profiles"(lower("display_name"));

-- matchmaking and the seed find a bot by personality
CREATE INDEX "ix_profiles_bot_personality" ON "profiles"("personality") WHERE "is_bot" = true;

-- weekly leaderboard: matches that finished since a date
CREATE INDEX "ix_matches_finished_end_time" ON "matches"("end_time") WHERE "status" = 'finished';

-- map leaderboard: wins on one map, answered from the index alone
CREATE INDEX "ix_matches_map_winners" ON "matches"("map") INCLUDE ("winner_side", "player1_profile_id", "player2_profile_id") WHERE "status" = 'finished' AND "winner_side" IS NOT NULL;
