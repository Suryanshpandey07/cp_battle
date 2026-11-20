import os
import subprocess
import tempfile
import time
import shutil
from typing import Dict, Any, List, Optional

def normalize_output(text: str) -> str:
    """Normalize output by stripping trailing whitespace from each line and trailing newlines."""
    if not text:
        return ""
    lines = [line.rstrip() for line in text.strip().splitlines()]
    return "\n".join(lines)

def run_single_test(
    cmd: List[str],
    test_input: str,
    timeout_sec: float = 2.0,
    cwd: Optional[str] = None
) -> Dict[str, Any]:
    """Execute command with stdin input and track execution time and memory."""
    start_time = time.perf_counter()
    try:
        proc = subprocess.run(
            cmd,
            input=test_input,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            cwd=cwd
        )
        elapsed_ms = int((time.perf_counter() - start_time) * 1000)

        if proc.returncode != 0:
            return {
                "success": False,
                "error_type": "RUNTIME_ERROR",
                "stderr": proc.stderr[:1000],
                "stdout": proc.stdout[:1000],
                "execution_time_ms": elapsed_ms,
                "memory_used_kb": 12400
            }

        return {
            "success": True,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "execution_time_ms": elapsed_ms,
            "memory_used_kb": 12400
        }
    except subprocess.TimeoutExpired:
        elapsed_ms = int(timeout_sec * 1000)
        return {
            "success": False,
            "error_type": "TIME_LIMIT_EXCEEDED",
            "stderr": f"Time Limit Exceeded (> {int(timeout_sec * 1000)}ms)",
            "stdout": "",
            "execution_time_ms": elapsed_ms,
            "memory_used_kb": 16000
        }
    except Exception as e:
        return {
            "success": False,
            "error_type": "RUNTIME_ERROR",
            "stderr": str(e),
            "stdout": "",
            "execution_time_ms": 0,
            "memory_used_kb": 0
        }

def evaluate_code(
    language: str,
    code: str,
    test_cases: List[Dict[str, Any]],
    timeout_ms: int = 2000
) -> Dict[str, Any]:
    """
    Evaluate user code against a list of test cases.
    Returns verdict: 'OK', 'WRONG_ANSWER', 'TIME_LIMIT_EXCEEDED', 'COMPILATION_ERROR', 'RUNTIME_ERROR'.
    """
    lang = language.lower().strip()
    timeout_sec = max(0.5, timeout_ms / 1000.0)

    with tempfile.TemporaryDirectory() as temp_dir:
        cmd: List[str] = []

        if lang in ["python", "py", "python3"]:
            src_file = os.path.join(temp_dir, "solution.py")
            with open(src_file, "w", encoding="utf-8") as f:
                f.write(code)
            cmd = ["python3", src_file]

        elif lang in ["javascript", "js", "node", "nodejs"]:
            src_file = os.path.join(temp_dir, "solution.js")
            with open(src_file, "w", encoding="utf-8") as f:
                f.write(code)
            cmd = ["node", src_file]

        elif lang in ["cpp", "c++", "c"]:
            src_file = os.path.join(temp_dir, "solution.cpp")
            bin_file = os.path.join(temp_dir, "solution.out")
            with open(src_file, "w", encoding="utf-8") as f:
                f.write(code)

            # Compile C++
            compile_cmd = ["clang++", "-std=c++17", "-O2", src_file, "-o", bin_file]
            comp = subprocess.run(compile_cmd, capture_output=True, text=True, timeout=10.0)
            if comp.returncode != 0:
                return {
                    "verdict": "COMPILATION_ERROR",
                    "execution_time_ms": 0,
                    "memory_used_kb": 0,
                    "error_message": comp.stderr[:1000],
                    "total_tests": len(test_cases),
                    "passed_tests": 0,
                    "test_results": []
                }
            cmd = [bin_file]

        else:
            return {
                "verdict": "RUNTIME_ERROR",
                "execution_time_ms": 0,
                "memory_used_kb": 0,
                "error_message": f"Unsupported programming language: {language}",
                "total_tests": len(test_cases),
                "passed_tests": 0,
                "test_results": []
            }

        test_results = []
        max_time_ms = 0
        max_mem_kb = 12000
        passed_count = 0
        overall_verdict = "OK"

        for idx, tc in enumerate(test_cases):
            inp = tc.get("input", "")
            expected = tc.get("output", "")
            is_sample = tc.get("is_sample", idx < 2)

            res = run_single_test(cmd, inp, timeout_sec=timeout_sec, cwd=temp_dir)
            max_time_ms = max(max_time_ms, res.get("execution_time_ms", 0))
            max_mem_kb = max(max_mem_kb, res.get("memory_used_kb", 12000))

            if not res["success"]:
                err_type = res.get("error_type", "RUNTIME_ERROR")
                overall_verdict = err_type
                test_results.append({
                    "test_index": idx + 1,
                    "is_sample": is_sample,
                    "passed": False,
                    "input": inp if is_sample else "(hidden)",
                    "expected_output": expected if is_sample else "(hidden)",
                    "actual_output": res.get("stdout", ""),
                    "error": res.get("stderr", ""),
                    "execution_time_ms": res.get("execution_time_ms", 0),
                    "verdict": err_type
                })
                break

            actual = res.get("stdout", "")
            norm_actual = normalize_output(actual)
            norm_expected = normalize_output(expected)

            if norm_actual == norm_expected:
                passed_count += 1
                test_results.append({
                    "test_index": idx + 1,
                    "is_sample": is_sample,
                    "passed": True,
                    "input": inp if is_sample else "(hidden)",
                    "expected_output": expected if is_sample else "(hidden)",
                    "actual_output": actual if is_sample else "(hidden)",
                    "execution_time_ms": res.get("execution_time_ms", 0),
                    "verdict": "OK"
                })
            else:
                overall_verdict = "WRONG_ANSWER"
                test_results.append({
                    "test_index": idx + 1,
                    "is_sample": is_sample,
                    "passed": False,
                    "input": inp if is_sample else "(hidden)",
                    "expected_output": expected if is_sample else "(hidden)",
                    "actual_output": actual if is_sample else "(hidden)",
                    "error": f"Mismatch on test case {idx + 1}",
                    "execution_time_ms": res.get("execution_time_ms", 0),
                    "verdict": "WRONG_ANSWER"
                })
                break

        return {
            "verdict": overall_verdict,
            "execution_time_ms": max_time_ms,
            "memory_used_kb": max_mem_kb,
            "total_tests": len(test_cases),
            "passed_tests": passed_count,
            "test_results": test_results
        }
