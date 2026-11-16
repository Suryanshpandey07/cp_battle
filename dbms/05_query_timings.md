# Query Execution Timings & Optimization

## 1. Benchmark Environment

- Database: PostgreSQL
- Database name: cp_battle_schema_test
- Benchmark method: EXPLAIN (ANALYZE, BUFFERS)
- Test data generated using PostgreSQL generate_series()
- Statistics refreshed using ANALYZE

### Test Dataset

| Table | Number of Records |
|---|---:|
| users | 20,000 |
| battles | 10,000 |
| battle_participants | 20,000 |
| submissions | 50,000 |
| battle_results | 2,500 |
| **Total** | **102,500** |

## 2. Benchmark Queries

Five representative queries were selected:

1. Find battles by status.
2. Find participants by user ID.
3. Find submissions using battle ID and user ID.
4. Retrieve the latest 20 submissions.
5. Find battle results by winner ID.

## 3. Baseline Execution Timings

The baseline measurements were collected after removing the five additional performance indexes. Primary-key and unique indexes were retained.

| Query | Execution Time |
|---|---:|
| Battles by status | 1.413 ms |
| Participants by user ID | 1.364 ms |
| Submissions by battle and user | 4.109 ms |
| Latest 20 submissions | 6.647 ms |
| Results by winner ID | 0.145 ms |

The query plans primarily used sequential scans. Retrieving the latest submissions also required sorting the submissions table.

## 4. Indexing and Optimization Strategies

The following indexes were created:

```sql
CREATE INDEX idx_battles_status
ON battles(status);

CREATE INDEX idx_battle_participants_user
ON battle_participants(user_id);

CREATE INDEX idx_submissions_battle_user
ON submissions(battle_id, user_id);

CREATE INDEX idx_submissions_submitted_at
ON submissions(submitted_at);

CREATE INDEX idx_battle_results_winner
ON battle_results(winner_user_id);

### Step 23: Verify the final file

After the command finishes, run:

```bash
cd ~/Desktop/cp_battle && wc -l dbms/05_query_timings.md && git diff --check
