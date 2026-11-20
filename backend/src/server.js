require("dotenv").config();

const express = require("express");
const cors = require("cors");
const pool = require("./db");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const problemRoutes = require("./routes/problems");
const submissionRoutes = require("./routes/submissions");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => {
    res.json({
        status: "healthy",
        service: "CP Battle Node Backend"
    });
});

app.get("/api/health/db", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT current_database(), current_user"
        );

        const userCount = await pool.query(
            "SELECT COUNT(*) FROM users"
        );

        res.json({
            status: "connected",
            database: result.rows[0].current_database,
            user: result.rows[0].current_user,
            totalUsers: Number(userCount.rows[0].count)
        });
    } catch (error) {
        console.error("Database connection failed:", error.message);

        res.status(500).json({
            status: "error",
            message: "Database connection failed"
        });
    }
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/problems", problemRoutes);
app.use("/api/submissions", submissionRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`CP Battle Node Backend running at http://localhost:${PORT}`);
});
