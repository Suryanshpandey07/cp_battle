import httpx
import logging
import time
from typing import List, Dict, Any, Optional

logger = logging.getLogger("codeforces_api")

CF_PROBLEMSET_API = "https://codeforces.com/api/problemset.problems"
CACHE_TTL_SECONDS = 3600  # 1 hour cache

_cached_problems: List[Dict[str, Any]] = []
_last_fetch_time: float = 0.0

async def fetch_codeforces_problems(force_refresh: bool = False) -> List[Dict[str, Any]]:
    """
    Fetch problem list from the official Codeforces API.
    Caches results in memory to minimize external network calls and avoid rate limits.
    """
    global _cached_problems, _last_fetch_time
    now = time.time()

    if not force_refresh and _cached_problems and (now - _last_fetch_time < CACHE_TTL_SECONDS):
        return _cached_problems

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(CF_PROBLEMSET_API)
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "OK":
                    raw_problems = data.get("result", {}).get("problems", [])
                    processed = []
                    for p in raw_problems:
                        contest_id = p.get("contestId")
                        index = p.get("index")
                        if not contest_id or not index:
                            continue
                        code = f"{contest_id}{index}"
                        rating = p.get("rating")
                        processed.append({
                            "problem_code": code,
                            "contest_id": contest_id,
                            "index": index,
                            "name": p.get("name"),
                            "rating": rating,
                            "tags": p.get("tags", []),
                            "url": f"https://codeforces.com/problemset/problem/{contest_id}/{index}"
                        })
                    _cached_problems = processed
                    _last_fetch_time = now
                    logger.info(f"Loaded {len(_cached_problems)} problems from Codeforces API")
                    return _cached_problems
                else:
                    logger.warning(f"Codeforces API error response: {data.get('comment')}")
            else:
                logger.warning(f"Codeforces API returned status code {response.status_code}")
    except Exception as e:
        logger.error(f"Failed to fetch from Codeforces API: {e}")

    # If fetch fails, return existing cache if available, else empty list
    return _cached_problems

async def get_filtered_cf_problems(
    min_rating: Optional[int] = 800,
    max_rating: Optional[int] = 1600,
    tag: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Filter Codeforces problems by rating range and optional tag.
    """
    problems = await fetch_codeforces_problems()
    filtered = []
    for p in problems:
        rating = p.get("rating")
        if rating is None:
            continue
        if min_rating is not None and rating < min_rating:
            continue
        if max_rating is not None and rating > max_rating:
            continue
        if tag and tag.lower() not in [t.lower() for t in p.get("tags", [])]:
            continue
        filtered.append(p)
    return filtered
