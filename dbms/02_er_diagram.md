# CP Battle - Entity Relationship Diagram

## ER Diagram

```mermaid
erDiagram
    USERS {
        BIGINT user_id PK
        VARCHAR username UK
        VARCHAR email UK
        TEXT password_hash
        VARCHAR codeforces_handle UK
        INTEGER rating
        TIMESTAMP created_at
    }

    BATTLES {
        BIGINT battle_id PK
        VARCHAR problem_code
        VARCHAR problem_name
        TEXT problem_url
        INTEGER problem_rating
        TIMESTAMP start_time
        TIMESTAMP end_time
        VARCHAR status
        TIMESTAMP created_at
    }

    BATTLE_PARTICIPANTS {
        BIGINT battle_id PK, FK
        BIGINT user_id PK, FK
        SMALLINT player_slot
        TIMESTAMP joined_at
    }

    SUBMISSIONS {
        BIGINT submission_id PK
        BIGINT battle_id FK
        BIGINT user_id FK
        TEXT code
        VARCHAR language
        VARCHAR verdict
        INTEGER execution_time_ms
        INTEGER memory_used_kb
        TIMESTAMP submitted_at
    }

    BATTLE_RESULTS {
        BIGINT battle_id PK, FK
        BIGINT winner_user_id FK
        TIMESTAMP completed_at
        TEXT result_description
    }

    USERS ||--o{ BATTLE_PARTICIPANTS : participates
    BATTLES ||--o{ BATTLE_PARTICIPANTS : has
    BATTLE_PARTICIPANTS ||--o{ SUBMISSIONS : makes
    BATTLES ||--o| BATTLE_RESULTS : produces
    BATTLE_PARTICIPANTS ||--o| BATTLE_RESULTS : wins
```

## Entity Relationships

1. **Users and Battle Participants:** A user can participate in multiple battles.
2. **Battles and Battle Participants:** Each battle supports up to two participants.
3. **Battle Participants and Submissions:** A participant can submit multiple solutions in a battle.
4. **Battles and Battle Results:** A completed battle can have one result record.
5. **Battle Participants and Battle Results:** The winner, if any, must be a participant in that battle.

## Design Notes

- Primary keys uniquely identify each record.
- Foreign keys maintain referential integrity.
- A composite primary key in `battle_participants` prevents the same user from joining the same battle twice.
- A unique constraint on `(battle_id, player_slot)` limits a battle to two player slots.
- The winner is linked to a participant of the corresponding battle.
- The submissions table uses a composite foreign key (battle_id, user_id) referencing the composite primary key of battle_participants.
