"""顧問評測集：案例檔與現行規則一致、dry run（規則模式）全部通過、期望欄位與檢查邏輯正確。不碰 LLM。"""
import json
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CASES = sorted((ROOT / "evals" / "cases").glob("*.json"))
ENV = {**os.environ, "LLM_PROVIDER": "none", "PYTHONIOENCODING": "utf-8", "CF_BEACON_TOKEN": ""}
sys.path.insert(0, str(ROOT / "evals"))
import build_cases  # noqa: E402
import run_eval  # noqa: E402


def test_cases_exist_and_expectations_are_consistent():
    assert len(CASES) >= 6
    for path in CASES:
        case = json.loads(path.read_text(encoding="utf-8"))
        assert case["name"] == path.stem and case["description"]
        penalized = {i["id"] for i in case["scan"]["issues"] if i["penalty"] > 0}
        assert set(case["expect"].get("fix_prompts_cover", [])) <= penalized, path.name
        for group in case["expect"].get("must_mention_any", []):
            assert isinstance(group, list) and group, path.name
        assert set(case["expect"].get("risk_level_in", ["低"])) <= {"低", "中", "高", "危急"}, path.name


def test_committed_cases_match_current_rules():
    """規則引擎改了（新增檢查、改扣分）卻沒重跑 build_cases.py → 這裡擋下來。"""
    built = build_cases.build_all()
    assert set(built) == {p.stem for p in CASES}
    for path in CASES:
        committed = json.loads(path.read_text(encoding="utf-8"))
        assert committed == built[path.stem], f"{path.name} 與現行規則不一致，請執行 python evals/build_cases.py"


def test_dry_run_passes_and_does_not_save():
    r = subprocess.run([sys.executable, "evals/run_eval.py", "--dry", "--no-save"], cwd=ROOT, env=ENV, capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stdout + r.stderr
    assert r.stdout.count("[PASS]") == len(CASES) and "[FAIL]" not in r.stdout and "結果已存" not in r.stdout
    r = subprocess.run([sys.executable, "evals/run_eval.py", "--dry", "--no-save", "--only", "no-such-case"], cwd=ROOT, env=ENV, capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 1 and "沒有符合的案例" in r.stdout


def test_check_logic():
    consult = {"summary": "s", "risk_level": "高", "priority_actions": ["a"], "stack_note": "用 nginx",
               "fix_prompts": [{"issue_ids": ["https"], "title": "t", "prompt": "p" * 50}]}
    expect = {"risk_level_in": ["低"], "must_mention_any": [["certbot", "nginx"], ["Let's Encrypt"]], "must_not_mention": ["vercel.json", "NGINX"], "fix_prompts_cover": ["https", "csp"]}
    assert run_eval.check(consult, expect, structural_only=True) == ["fix_prompts 沒涵蓋 csp（有：['https']）"]
    full = run_eval.check(consult, expect, structural_only=False)
    assert any("risk_level=高" in f for f in full) and any("Let's Encrypt" in f for f in full) and any("不該提到：NGINX" in f for f in full)
    assert not any("certbot" in f for f in full)
    assert run_eval.check({**consult, "risk_level": "超高"}, {}, True) == ["risk_level 不合法：'超高'"]
    assert run_eval.check({**consult, "priority_actions": ["a"] * 7}, {}, True) == ["priority_actions 有 7 條，超過上限"]
    assert run_eval.load_cases("nextjs") and not run_eval.load_cases("no-such-case")
