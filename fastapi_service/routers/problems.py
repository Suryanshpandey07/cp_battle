from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List, Dict, Any
from ..services.problem_bank import (
    get_problem_by_code,
    get_random_problem,
    list_curated_problems,
    PROBLEMS
)
from ..services.cf_api import fetch_codeforces_problems, get_filtered_cf_problems

router = APIRouter(prefix="/api/py/problems", tags=["problems"])

@router.get("/curated")
async def get_curated_list():
    """List all curated problems with statements and sample test cases."""
    return {"status": "success", "count": len(PROBLEMS), "problems": list_curated_problems()}

@router.get("/random")
async def get_random_problem_endpoint(
    min_rating: int = Query(800, ge=800, le=3500),
    max_rating: int = Query(1600, ge=800, le=3500)
):
    """Get a random competitive programming problem."""
    prob = get_random_problem(min_rating=min_rating, max_rating=max_rating)
    # Return without exposing hidden test cases
    safe_problem = {
        "problem_code": prob["problem_code"],
        "contest_id": prob.get("contest_id"),
        "index": prob.get("index"),
        "problem_name": prob["problem_name"],
        "problem_rating": prob["problem_rating"],
        "tags": prob["tags"],
        "problem_url": prob["problem_url"],
        "time_limit_ms": prob.get("time_limit_ms", 1000),
        "memory_limit_mb": prob.get("memory_limit_mb", 256),
        "description": prob.get("description", ""),
        "sample_cases": prob.get("sample_cases", [])
    }
    return {"status": "success", "problem": safe_problem}

@router.get("/codeforces-live")
async def get_live_cf_problems(
    min_rating: Optional[int] = Query(800),
    max_rating: Optional[int] = Query(1600),
    tag: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100)
):
    """Fetch live problems directly from official Codeforces API."""
    problems = await get_filtered_cf_problems(min_rating=min_rating, max_rating=max_rating, tag=tag)
    return {
        "status": "success",
        "total": len(problems),
        "problems": problems[:limit]
    }

@router.get("/{problem_code}")
async def get_problem(problem_code: str):
    """Get full details of a specific problem by code."""
    prob = get_problem_by_code(problem_code)
    if not prob:
        # If not in local bank, try to find in Codeforces live API
        cf_problems = await fetch_codeforces_problems()
        found = next((p for p in cf_problems if p["problem_code"].upper() == problem_code.upper()), None)
        if not found:
            raise HTTPException(status_code=404, detail=f"Problem {problem_code} not found")

        # Construct safe problem model
        return {
            "status": "success",
            "problem": {
                "problem_code": found["problem_code"],
                "contest_id": found["contest_id"],
                "index": found["index"],
                "problem_name": found["name"],
                "problem_rating": found["rating"],
                "tags": found["tags"],
                "problem_url": found["url"],
                "time_limit_ms": 1000,
                "memory_limit_mb": 256,
                "description": f"### {found['name']}\n\nOfficial Codeforces Problem {found['problem_code']}.\n\nView complete statement at [Codeforces Problem Page]({found['url']}).",
                "sample_cases": []
            }
        }

    return {
        "status": "success",
        "problem": {
            "problem_code": prob["problem_code"],
            "contest_id": prob.get("contest_id"),
            "index": prob.get("index"),
            "problem_name": prob["problem_name"],
            "problem_rating": prob["problem_rating"],
            "tags": prob["tags"],
            "problem_url": prob["problem_url"],
            "time_limit_ms": prob.get("time_limit_ms", 1000),
            "memory_limit_mb": prob.get("memory_limit_mb", 256),
            "description": prob.get("description", ""),
            "sample_cases": prob.get("sample_cases", [])
        }
    }
