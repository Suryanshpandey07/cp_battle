# CP Battle - CP04 Query Benchmark Results

- Database: `cp_battle_schema_test`
- Method: `EXPLAIN (ANALYZE, BUFFERS)`
- Runs per query: 3
- Benchmark state: Existing optimized indexes
- Generated: 2026-11-20 00:43:01.313702

## Query Execution Timings

| Query | Run 1 (ms) | Run 2 (ms) | Run 3 (ms) | Average (ms) |
|---|---:|---:|---:|---:|
| 1. Display all registered users | 6.973 | 5.139 | 4.237 | 5.450 |
| 2. Display all battles with their current status | 2.933 | 2.005 | 1.883 | 2.274 |
| 3. Display battles with their participants | 10.178 | 10.066 | 10.150 | 10.131 |
| 4. Display completed battles and their winners | 2.990 | 2.998 | 2.542 | 2.843 |
| 5. Count the total battles played by each user | 9.072 | 9.154 | 8.963 | 9.063 |
| 6. Display the leaderboard based on battle wins | 20.099 | 19.540 | 19.795 | 19.811 |
| 7. Find users who have never participated in a battle | 3.258 | 3.643 | 3.199 | 3.367 |
| 8. Display all submissions with player and battle details | 25.981 | 25.658 | 26.992 | 26.210 |
| 9. Count submissions made by each user | 15.753 | 15.180 | 15.639 | 15.524 |
| 10. Find the average execution time of accepted submissions | 2.749 | 2.786 | 2.374 | 2.636 |
| 11. Find users whose rating is above the average user rating | 3.987 | 3.617 | 3.477 | 3.694 |
| 12. Display the number of participants in each battle | 7.225 | 4.349 | 4.078 | 5.217 |

## Execution Plans

Individual execution plans for all three runs are saved in `plans/`.

## Notes

These measurements represent the current indexed database state.
No baseline-versus-optimized improvement is claimed from these runs.
Execution times may vary with cache state and system load.
