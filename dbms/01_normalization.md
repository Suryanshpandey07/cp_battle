# CP Battle - Database Normalization

## 1. Overview

The CP Battle database stores player accounts, competitive battles, battle participants, submissions, and battle results.

The database is designed to reduce data redundancy and maintain data integrity through First Normal Form (1NF), Second Normal Form (2NF), and Third Normal Form (3NF).

## 2. Functional Dependencies

The main functional dependencies identified in the database are:

### Users

- user_id -> username, email, password_hash, codeforces_handle, rating, created_at
- username -> user_id
- email -> user_id
- codeforces_handle -> user_id (when provided)

### Battles

- battle_id -> problem_code, problem_name, problem_url, problem_rating, start_time, end_time, status, created_at

### Battle Participants

- (battle_id, user_id) -> player_slot, joined_at
- (battle_id, player_slot) -> user_id, joined_at

### Submissions

- submission_id -> battle_id, user_id, code, language, verdict, execution_time_ms, memory_used_kb, submitted_at

### Battle Results

- battle_id -> winner_user_id, completed_at, result_description

## 3. First Normal Form (1NF)

A relation satisfies 1NF when:

- Every column contains atomic (indivisible) values.
- Each record is uniquely identifiable.
- There are no repeating groups or multivalued columns.

Application to CP Battle:

- User details are stored in individual columns.
- Each battle stores one selected problem.
- Each participant is represented by a separate row.
- Every submission is stored as a separate record.
- Each battle has at most one result record.

Therefore, all five relations satisfy 1NF.

## 4. Second Normal Form (2NF)

A relation satisfies 2NF when:

- It is already in 1NF.
- Every non-key attribute depends on the whole candidate key, not just part of a composite key.

Application to CP Battle:

- The users, battles, submissions, and battle_results tables use single-column primary keys.
- The battle_participants table uses the composite key (battle_id, user_id).
- Its non-key attributes, player_slot and joined_at, describe the complete user participation in a particular battle.
- The unique constraint on (battle_id, player_slot) also ensures that each player slot belongs to only one user in a battle.

There are no partial dependencies on part of a composite primary key.

Therefore, all five relations satisfy 2NF.

## 5. Third Normal Form (3NF)

A relation satisfies 3NF when:

- It is already in 2NF.
- Non-key attributes do not depend transitively on the primary key through other non-key attributes.

Application to CP Battle:

- User account details are stored in users.
- Problem and timing details are stored in battles.
- Participation details are stored in battle_participants.
- Solution details are stored in submissions.
- Final outcomes are stored in battle_results.
- Relationships between these entities are maintained using foreign keys.

For example, participant information is not duplicated in every submission. Instead, submissions reference the corresponding battle participant using a composite foreign key.

This avoids unnecessary duplication and update anomalies.

Therefore, the five relations satisfy 3NF.

## 6. Final Normalized Relations

| Relation | Primary Key |
|---|---|
| users | user_id |
| battles | battle_id |
| battle_participants | (battle_id, user_id) |
| submissions | submission_id |
| battle_results | battle_id |

## 7. Design Rationale

- Primary keys uniquely identify records.
- Unique constraints prevent duplicate usernames, email addresses, and Codeforces handles.
- Foreign keys maintain relationships between users, battles, participants, submissions, and results.
- The composite key in battle_participants prevents a user from joining the same battle twice.
- The player_slot constraint restricts each battle to two available player slots.
- Separating submissions from participants allows multiple submissions per player in a battle.
- Separating battle_results keeps final outcome information independent from individual submissions.

## 8. Conclusion

The CP Battle database is organized into five related relations.

The design satisfies 1NF, 2NF, and 3NF by using atomic attributes, eliminating partial dependencies, and avoiding transitive dependencies.

Primary keys, foreign keys, unique constraints, and check constraints help maintain data integrity and consistency.
