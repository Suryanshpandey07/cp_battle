const express = require("express");
const authenticateToken = require("../middleware/auth");
const pool = require("../db");

const router = express.Router();

const FASTAPI_URL =
    process.env.FASTAPI_URL || "http://127.0.0.1:8001";

// RUN CODE
router.post("/run", authenticateToken, async (req, res) => {
    try {
        const { language, code, custom_input, problem_code } = req.body;

        if (!language || !code) {
            return res.status(400).json({
                message: "Language and code are required"
            });
        }

        const response = await fetch(
            `${FASTAPI_URL}/api/py/judge/run`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    language,
                    code,
                    custom_input: custom_input ?? "",
                    problem_code: problem_code ?? null
                })
            }
        );

        const data = await response.json();
        return res.status(response.status).json(data);

    } catch (error) {
        console.error("Run code error:", error.message);

        return res.status(502).json({
            message: "Could not connect to the Python judge"
        });
    }
});

// OFFICIAL EVALUATION
router.post("/evaluate", authenticateToken, async (req, res) => {
    try {
        const { battle_id, problem_code, language, code } = req.body;
        const userId = req.user.userId;

        if (!battle_id || !problem_code || !language || !code) {
            return res.status(400).json({
                message: "Battle ID, problem code, language and code are required"
            });
        }

        const battle = await pool.query(
            `SELECT b.battle_id
             FROM battles b
             JOIN battle_participants bp
               ON bp.battle_id = b.battle_id
             WHERE b.battle_id = $1
               AND bp.user_id = $2
               AND b.problem_code = $3
               AND b.status = 'active'
               AND b.start_time <= CURRENT_TIMESTAMP
               AND b.end_time > CURRENT_TIMESTAMP`,
            [battle_id, userId, problem_code]
        );

        if (battle.rowCount === 0) {
            return res.status(403).json({
                message: "You are not an eligible participant in this active battle"
            });
        }

        const response = await fetch(
            `${FASTAPI_URL}/api/py/judge/evaluate`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    problem_code,
                    language,
                    code
                })
            }
        );

        const data = await response.json();

        if (!response.ok || !data.verdict) {
            return res.status(response.status || 502).json(data);
        }

        const saved = await pool.query(
            `INSERT INTO submissions (
                battle_id,
                user_id,
                code,
                language,
                verdict,
                execution_time_ms,
                memory_used_kb
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING submission_id, battle_id, user_id,
                      verdict, execution_time_ms, memory_used_kb,
                      submitted_at`,
            [
                battle_id,
                userId,
                code,
                language,
                data.verdict,
                data.execution_time_ms ?? null,
                data.memory_used_kb ?? null
            ]
        );

        return res.status(200).json({
            ...data,
            submission: saved.rows[0]
        });

    } catch (error) {
        console.error("Submission evaluation error:", error.message);

        return res.status(500).json({
            message: "Could not evaluate or save submission"
        });
    }
});

module.exports = router;
