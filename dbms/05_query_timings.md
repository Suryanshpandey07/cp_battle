# Query Execution Timings & Optimization

## 1. Benchmark Environment

- Database: PostgreSQL
- Database name: `cp_battle_schema_test`
- Benchmark method: `EXPLAIN (ANALYZE, BUFFERS)`
- Test data generated using PostgreSQL `generate_series()`
- Statistics refreshed using `ANALYZE`
- Each query was executed three times.

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

Five representative queries were selected for the index optimization comparison:

1. Find battles by status.
2. Find participants by user ID.
3. Find submissions using battle ID and user ID.
4. Retrieve the latest 20 submissions.
5. Find battle results by winner ID.

A separate set of 12 application queries was also benchmarked. Their execution plans are stored in `dbms/plans/`.

## 3. Baseline Execution Timings

The baseline measurements were collected after removing the five additional performance indexes. Primary-key and unique indexes were retained.

| Query | Execution Time |
|---|---:|
| Battles by status | 1.413 ms |
| Participants by user ID | 1.364 ms |
| Submissions by battle and user | 4.109 ms |
| Latest 20 submissions | 6.647 ms |
| Results by winner ID | 0.145 ms |

The baseline query plans primarily used sequential scans. Retrieving the latest submissions also required sorting the submissions table.

## 4. Indexing and Optimization Strategies

The following additional indexes were created:

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
```

These indexes target columns used in filtering, searching, and retrieving recent submissions.

## 5. Application Query Execution Timings

The following results were collected from the 12 query-plan files. Each query was executed three times. Average execution time is calculated as the arithmetic mean of the three runs.

| Query | Description | Run 1 (ms) | Run 2 (ms) | Run 3 (ms) | Average (ms) |
|---|---|---:|---:|---:|---:|
| Q1 | Display all registered users | 6.973 | 5.139 | 4.237 | 5.450 |
| Q2 | Display all battles with their current status | 2.933 | 2.005 | 1.883 | 2.274 |
| Q3 | Display battles with their participants | 10.178 | 10.066 | 10.150 | 10.131 |
| Q4 | Display completed battles and their winners | 2.990 | 2.998 | 2.542 | 2.843 |
| Q5 | Count the total battles played by each user | 9.072 | 9.154 | 8.963 | 9.063 |
| Q6 | Display the leaderboard based on battle wins | 20.099 | 19.540 | 19.795 | 19.811 |
| Q7 | Find users who have never participated in a battle | 3.258 | 3.643 | 3.199 | 3.367 |
| Q8 | Display all submissions with player and battle details | 25.981 | 25.658 | 26.992 | 26.210 |
| Q9 | Count submissions made by each user | 15.753 | 15.180 | 15.639 | 15.524 |
| Q10 | Find the average execution time of accepted submissions | 2.749 | 2.786 | 2.374 | 2.636 |
| Q11 | Find users whose rating is above the average user rating | 3.987 | 3.617 | 3.477 | 3.694 |
| Q12 | Display the number of participants in each battle | 7.225 | 4.349 | 4.078 | 5.217 |

All values represent measured PostgreSQL execution times in milliseconds. The original execution-plan files contain the detailed query plans, planning times, and buffer statistics.

## 6. Optimized Execution Timings for the Five Representative Queries

Optimized execution timings for the five representative benchmark queries must be collected by running the same queries after creating the five additional indexes.

The 12 application query measurements above are a separate benchmark set and must not be treated as the optimized results for these five representative queries.

The five-query optimized measurements and before-and-after comparison remain pending verification.

## 7. Conclusion

The benchmark covers a dataset of 102,500 records across five tables and includes 12 application queries, each executed three times.

The results provide a measured reference for application query performance. The additional indexes target frequently filtered columns and the submission timestamp used for retrieving recent submissions.

A final comparison of baseline and optimized execution times should use measurements from the same dataset and benchmark environment.
