"""設定與常數：環境變數、路徑、限流與額度參數、logging。其他模組 `from config import *`。"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

import httpx

try:  # .env 為選配，沒有 python-dotenv 也能跑；明確指向專案目錄，不受啟動時的 cwd 影響
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:  # pragma: no cover
    pass

for _stream in (sys.stdout, sys.stderr):  # Windows 主控台預設 cp950，中文 log 會變亂碼
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("auditor")

# ---------------------------------------------------------------------------
# 0. 設定
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
INDEX_HTML = BASE_DIR / "index.html"
KNOWLEDGE_DIR = BASE_DIR / "knowledge"

USER_AGENT = "AI-WebSec-Auditor/1.0 (passive header & static-asset check)"
REQUEST_TIMEOUT = httpx.Timeout(8.0, connect=5.0)
MAX_REDIRECTS = 5
MAX_HTML_BYTES = 2_000_000
MAX_JS_BYTES = 1_500_000
MAX_PROBE_BYTES = 64_000
MAX_JS_FILES = 2

SCAN_RATE_LIMIT = (int(os.getenv("SCAN_RATE_LIMIT", "3")), 60)       # 每 IP 每分鐘 3 次
CONSULT_RATE_LIMIT = (int(os.getenv("CONSULT_RATE_LIMIT", "10")), 60)  # 保護 LLM 額度
TRUST_PROXY = os.getenv("TRUST_PROXY", "0") == "1"

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
# 可用逗號列多個模型：遇到 429 / 5xx / 逾時會依序換下一個（Gemini 免費層的日額度是綁模型的）
OPENAI_MODELS = [m.strip() for m in os.getenv("OPENAI_MODEL", "gpt-4o-mini").split(",") if m.strip()] or ["gpt-4o-mini"]
OPENAI_MODEL = OPENAI_MODELS[0]
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
ANTHROPIC_EFFORT = os.getenv("ANTHROPIC_EFFORT", "medium")  # low | medium | high | xhigh | max
# 供應商順序，逗號分隔：前面的失敗（額度、429、5xx、拒答）就換下一個；auto = anthropic,openai（只保留有金鑰的）
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "auto").lower()
LLM_DAILY_BUDGET_USD = float(os.getenv("LLM_DAILY_BUDGET_USD", "2"))  # Claude 每日估算費用上限（美元），0 = 不限制
# 每百萬 token 的定價（輸入 / 輸出 / 快取讀取 / 快取寫入），用來估算 Claude 的花費；查不到的模型以 Sonnet 5 計
CLAUDE_PRICING = {
    "claude-sonnet-5": (2.0, 10.0, 0.2, 2.5),
    "claude-opus-5": (5.0, 25.0, 0.5, 6.25),
    "claude-haiku-4-5": (1.0, 5.0, 0.1, 1.25),
    "claude-fable-5-1": (10.0, 50.0, 1.0, 12.5),
}
LLM_TIMEOUT = httpx.Timeout(90.0, connect=10.0)
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "6000"))  # 思考型模型的思考 token 也算在內，要留寬
# Gemini 3.x 預設會花大量思考 token，透過相容端點送 reasoning_effort=low 壓低；OpenAI 非推理模型不接受此參數故預設留空
OPENAI_REASONING_EFFORT = os.getenv("OPENAI_REASONING_EFFORT", "low" if OPENAI_MODEL.startswith("gemini") else "").strip()
LLM_DAILY_BUDGET = int(os.getenv("LLM_DAILY_BUDGET", "300"))  # 全站每日 LLM 呼叫上限，超過就降級成規則模式；0 = 不限制
CONSULT_HOURLY_LIMIT = int(os.getenv("CONSULT_HOURLY_LIMIT", "30"))  # 同一 IP 每小時 AI 顧問呼叫上限

STATS_TOKEN = os.getenv("STATS_TOKEN", "").strip()  # 設了就要帶 ?token= 才能看 /api/stats；留空 = 公開（只有彙總數字）
# Cloudflare Web Analytics 的 beacon token（公開的站台識別碼，會出現在 HTML 裡，不是機密）；留空 = 不載入分析腳本
CF_BEACON_TOKEN = os.getenv("CF_BEACON_TOKEN", "").strip()
# Cloudflare Turnstile 人機驗證：site key 公開、secret 機密。secret 留空 = 不啟用
TURNSTILE_SITE_KEY = os.getenv("TURNSTILE_SITE_KEY", "").strip()
TURNSTILE_SECRET_KEY = os.getenv("TURNSTILE_SECRET_KEY", "").strip()
# 給 CI / 腳本用的 API 金鑰（逗號分隔），帶 X-Api-Key 可跳過 Turnstile（限流仍然算）
API_KEYS = {k.strip() for k in os.getenv("API_KEYS", "").split(",") if k.strip()}
# Upstash Redis（REST）：設了就把統計、額度、徽章快取每 60 秒存一份，重啟後還原；留空 = 純記憶體
UPSTASH_URL = os.getenv("UPSTASH_REDIS_REST_URL", "").strip().rstrip("/")
UPSTASH_TOKEN = os.getenv("UPSTASH_REDIS_REST_TOKEN", "").strip()
STATE_KEY = "wsa:state:v1"
MAX_EXTRA_PATHS = 5
# 網域擁有者來信要求排除的網域（逗號分隔，含子網域）；掃描這些網域會直接拒絕
EXCLUDED_HOSTS = {h.strip().lower().lstrip(".") for h in os.getenv("EXCLUDED_HOSTS", "").split(",") if h.strip()}
CONTACT_EMAIL = os.getenv("CONTACT_EMAIL", "a112221040@mail.shu.edu.tw")
PUBLIC_ORIGIN = os.getenv("PUBLIC_ORIGIN", "https://ai-web-security-auditor.onrender.com").rstrip("/")


def is_excluded_host(host: str) -> bool:
    h = host.lower().rstrip(".")
    return any(h == ex or h.endswith("." + ex) for ex in EXCLUDED_HOSTS)
