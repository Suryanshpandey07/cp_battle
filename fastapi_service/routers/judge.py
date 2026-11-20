from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from ..services.code_runner import evaluate_code, run_single_test, normalize_output
from ..services.problem_bank import get_problem_by_code

router = APIRouter(prefix="/api/py/judge", tags=["judge"])

class RunCodeRequest(BaseModel):
    language: str
    code: str
    custom_input: Optional[str] = ""
    problem_code: Optional[str] = None

class EvaluateCodeRequest(BaseModel):
    problem_code: str
    language: str
    code: str


@router.post("/run")
async def run_code(req: RunCodeRequest):
    """
    Run code against custom input or sample inputs.
    Does not register an official submission verdict.
    """
    if not req.code.strip():
        raise HTTPException(status_code=400, detail="Code cannot be empty")

    tests_to_run = []

    if req.custom_input is not None and req.custom_input.strip() != "":
        tests_to_run.append({
            "input": req.custom_input,
            "output": "",
            "is_sample": True
        })
    elif req.problem_code:
        prob = get_problem_by_code(req.problem_code)
        if prob and prob.get("sample_cases"):
            for sc in prob["sample_cases"]:
                tests_to_run.append({
                    "input": sc["input"],
                    "output": sc["output"],
                    "is_sample": True
                })

    if not tests_to_run:
        raise HTTPException(
            status_code=400,
            detail="Please provide custom input or a valid problem code"
        )

    result = evaluate_code(
        language=req.language,
        code=req.code,
        test_cases=tests_to_run,
        timeout_ms=3000
    )

    # Custom input mode: execution only, no expected-output comparison
    if req.custom_input is not None and req.custom_input.strip() != "":
        for test in result.get("test_results", []):
            test["passed"] = None
            test["expected_output"] = None
            test["error"] = None

            if test.get("verdict") == "WRONG_ANSWER":
                test["verdict"] = "EXECUTED"

        if result["verdict"] == "WRONG_ANSWER":
            result["verdict"] = "EXECUTED"

    return {"status": "success", "result": result}



@router.post("/evaluate")
async def evaluate_submission(req: EvaluateCodeRequest):
    """
    Evaluate code against the complete test suite (samples + hidden tests)
    for the specified problem code. Returns official CP verdict.
    """
    if not req.code.strip():
        raise HTTPException(status_code=400, detail="Code cannot be empty")

    prob = get_problem_by_code(req.problem_code)
    if not prob:
        raise HTTPException(status_code=404, detail=f"Problem {req.problem_code} test suite not found")

    all_tests = []
    for sc in prob.get("sample_cases", []):
        all_tests.append({
            "input": sc["input"],
            "output": sc["output"],
            "is_sample": True
        })

    for hc in prob.get("hidden_cases", []):
        all_tests.append({
            "input": hc["input"],
            "output": hc["output"],
            "is_sample": False
        })

    result = evaluate_code(
        language=req.language,
        code=req.code,
        test_cases=all_tests,
        timeout_ms=prob.get("time_limit_ms", 2000)
    )

    return {
        "status": "success",
        "problem_code": req.problem_code,
        "verdict": result["verdict"],
        "execution_time_ms": result["execution_time_ms"],
        "memory_used_kb": result["memory_used_kb"],
        "total_tests": result["total_tests"],
        "passed_tests": result["passed_tests"],
        "test_results": result["test_results"]
    }
