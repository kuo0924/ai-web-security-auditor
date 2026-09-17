"""正則的最壞情況：目標網站回傳的內容全部視為惡意輸入。

背景：掃描器會吃下目標站最多 2 MB 的 HTML、1.5 MB 的 JS、64 KB 的 /.env。
只要有一個樣式是 O(n²)，對方就能用一份壓縮後只有幾百 bytes 的回應，
讓單一 uvicorn 事件迴圈卡住數十分鐘，整個服務對外停擺（正則執行中無法被 timeout 中斷）。

這支測試有兩層：
1. 對已知會吃到大輸入的函式，直接餵「真實上限」的惡意內容並限時。
2. 掃過專案裡每一個字面樣式，量測是否有超線性成長，讓新加的正則也被擋下。
"""
import ast
import pathlib
import re
import time

import httpx
from conftest import m

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCES = ["scanner.py", "netsafe.py", "advisor.py", "main.py", "knowledge.py"]
RE_FUNCS = {"compile", "search", "finditer", "match", "fullmatch", "sub", "subn", "split", "findall"}
FLAG_NAMES = {"I": re.I, "IGNORECASE": re.I, "S": re.S, "DOTALL": re.S, "M": re.M, "MULTILINE": re.M}


def _elapsed(fn, *args) -> float:
    t0 = time.perf_counter()
    fn(*args)
    return time.perf_counter() - t0


def _match_time(rx: re.Pattern, text: str) -> float:
    """量一次完整比對的耗時（finditer 是惰性的，要把結果取完才算數）。"""
    t0 = time.perf_counter()
    list(rx.finditer(text))
    return time.perf_counter() - t0


def test_hostile_input_at_real_ceilings_is_fast():
    """修正前這四項分別要 90 分鐘、81 秒、0.4 秒、2 秒；現在全部是毫秒級。"""
    no_headers = httpx.Headers({})
    budget = 1.0  # 每項的寬鬆上限；真的退化成 O(n²) 會差好幾個數量級，不會卡在邊界

    # 1. <meta generator> 塞滿數字，長度吃到 HTML 上限
    huge_meta = '<meta name="generator" content="' + "0" * m.MAX_HTML_BYTES + '">'
    assert _elapsed(m.version_disclosures, no_headers, huge_meta) < budget

    # 2. 回應標頭塞滿數字
    assert _elapsed(m.version_disclosures, httpx.Headers({"server": "0" * 32_000}), "") < budget

    # 3. /.env 幾乎全是空白（開頭放一個字元才能通過 exposed_check 的空內容判斷）
    env_body = "x\n" + "\n " * (m.MAX_PROBE_BYTES // 2)
    assert _elapsed(m.looks_like_env, env_body, "text/plain") < budget

    # 4. LLM 回應全是空白（內容不是 JSON，會丟例外；這裡只在意耗時）
    def parse_ignoring_errors(text):
        try:
            m.extract_json(text)
        except Exception:
            pass
    assert _elapsed(parse_ignoring_errors, "\n " * 40_000) < budget

    # 5. 惡意 sitemap（2026-09-17 修掉的那個，一併守住）
    for body in ("<loc>" + " " * 300_000, "<loc>a" + " " * 300_000, "<loc><![CDATA[" + " " * 300_000):
        assert _elapsed(m.sitemap_locs, body) < budget

    # 6. HTML 裡塞大量 <meta 開頭：這個樣式是線性的，但量大仍要有上限
    assert _elapsed(m.version_disclosures, no_headers, "<meta " * 300_000) < 3.0


def test_detection_behaviour_unchanged():
    """收緊樣式不能改變判斷結果。"""
    assert all(m.looks_like_env(s, "text/plain") for s in ["KEY=v", "  KEY = v", "export KEY=v", "\n\nAPI_KEY=abc\n", "# 註解\nDB_URL=x", "\tTOKEN\t=\t1"])
    assert not any(m.looks_like_env(s, "text/plain") for s in ["just words", "no equals here", "= leading", "1KEY=v"])
    assert not m.looks_like_env("KEY=v", "text/html; charset=utf-8")  # SPA fallback 仍然不算裸露
    assert m.version_disclosures(httpx.Headers({"server": "nginx/1.24.0"}), "") == ["server: nginx/1.24.0"]
    assert m.version_disclosures(httpx.Headers({"server": "nginx"}), "") == []
    assert m.version_disclosures(httpx.Headers({}), '<meta name="generator" content="WordPress 6.4.2">') == ["meta generator: WordPress 6.4.2"]
    assert m.version_disclosures(httpx.Headers({}), '<meta name="generator" content="Hugo">') == []
    assert m.extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert m.extract_json('{"b": [1, 2]}') == {"b": [1, 2]}
    assert m.extract_json('前言 {"c": {"d": 2}} 後記') == {"c": {"d": 2}}


def _literal_patterns() -> list[tuple[str, int, str, int]]:
    """用 ast 取出每個 re.xxx(字面樣式) 的樣式與 flags。"""
    found = []
    for name in SOURCES:
        tree = ast.parse((ROOT / name).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in RE_FUNCS):
                continue
            base = node.func.value
            if not (isinstance(base, ast.Name) and base.id == "re"):
                continue
            if not node.args or not isinstance(node.args[0], ast.Constant) or not isinstance(node.args[0].value, str):
                continue
            flags = 0
            for arg in list(node.args[1:]) + [kw.value for kw in node.keywords if kw.arg == "flags"]:
                for sub in ast.walk(arg):
                    if isinstance(sub, ast.Attribute) and sub.attr in FLAG_NAMES:
                        flags |= FLAG_NAMES[sub.attr]
            found.append((name, node.lineno, node.args[0].value, flags))
    return found


def _literal_prefix(pattern: str) -> str:
    """樣式開頭的字面字元，讓對抗字串真的能進入比對。"""
    out, i = [], 0
    while i < len(pattern):
        ch = pattern[i]
        if ch == "\\" and i + 1 < len(pattern):
            if pattern[i + 1] in "bBdDsSwWAZ":
                break
            out.append(pattern[i + 1])
            i += 2
            continue
        if ch in "([{|?*+.^$" or (i + 1 < len(pattern) and pattern[i + 1] in "?*{"):
            break
        out.append(ch)
        i += 1
    return "".join(out)


def test_no_pattern_in_the_project_is_superlinear():
    """新增的正則若對某種填充字元呈二次方成長，這裡會指名擋下。

    判準：長度加倍時耗時不得超過 3 倍（線性約 2 倍，災難性回溯約 4 倍）。
    """
    fillers = [" ", "\n ", "a", "0", "<", "=", '"', "/", ";", "]", "-", ".", "a ", "0.0", "<a>"]
    offenders = []
    patterns = _literal_patterns()
    assert len(patterns) > 25, "樣式數量異常，可能是解析壞了"
    for name, lineno, pattern, flags in patterns:
        try:
            rx = re.compile(pattern, flags)
        except re.error:
            continue
        prefix = _literal_prefix(pattern)
        for filler in fillers:
            for pre in ({prefix, ""} if prefix else {""}):
                t1 = _match_time(rx, pre + filler * 2000)
                if t1 < 0.002:  # 夠快就不必再放大
                    continue
                t2 = _match_time(rx, pre + filler * 4000)
                if t1 and t2 / t1 > 3.0:
                    offenders.append(f"{name}:{lineno} 樣式 {pattern[:70]!r} 對填充 {filler!r} 呈超線性（{t2 / t1:.1f}x）")
    assert not offenders, "以下樣式在惡意輸入下會退化，請設上界或避免相鄰的 \\s*：\n" + "\n".join(offenders)
