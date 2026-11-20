const express = require("express");
const pool = require("../db");
const authenticateToken = require("../middleware/auth");

const router = express.Router();

// GET LOGGED-IN USER PROFILE
router.get("/me", authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT user_id, username, email,
                    codeforces_handle, rating, created_at
             FROM users
             WHERE user_id = $1`,
            [req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        res.json({
            message: "Profile fetched successfully",
            user: result.rows[0]
        });

    } catch (error) {
        console.error("Profile error:", error.message);

        res.status(500).json({
            message: "Server error while fetching profile"
        });
    }
});

module.exports = router;
