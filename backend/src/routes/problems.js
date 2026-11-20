const express = require("express");

const router = express.Router();

const FASTAPI_URL =
    process.env.FASTAPI_URL || "http://127.0.0.1:8001";

async function forwardRequest(url, res) {
    try {
        const response = await fetch(url);
        const data = await response.json();

        return res.status(response.status).json(data);
    } catch (error) {
        console.error("FastAPI connection error:", error.message);

        return res.status(502).json({
            message: "Could not connect to the Python problem service"
        });
    }
}

// GET /api/problems
router.get("/", async (req, res) => {
    return forwardRequest(
        `${FASTAPI_URL}/api/py/problems/curated`,
        res
    );
});

// GET /api/problems/random
router.get("/random", async (req, res) => {
    const query = new URLSearchParams(req.query).toString();

    const url = `${FASTAPI_URL}/api/py/problems/random${
        query ? `?${query}` : ""
    }`;

    return forwardRequest(url, res);
});

// GET /api/problems/codeforces-live
router.get("/codeforces-live", async (req, res) => {
    const query = new URLSearchParams(req.query).toString();

    const url = `${FASTAPI_URL}/api/py/problems/codeforces-live${
        query ? `?${query}` : ""
    }`;

    return forwardRequest(url, res);
});

// GET /api/problems/:problemCode
router.get("/:problemCode", async (req, res) => {
    const problemCode = encodeURIComponent(req.params.problemCode);

    return forwardRequest(
        `${FASTAPI_URL}/api/py/problems/${problemCode}`,
        res
    );
});

module.exports = router;
