"""知識庫層：knowledge/ 目錄的標籤式檢索與 few-shot（RAG 預留介面）。"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from config import *  # noqa: F401,F403


# ---------------------------------------------------------------------------
# 5. 知識庫層（RAG 預留介面）
# ---------------------------------------------------------------------------
class KnowledgeBase:
    """
    標籤式知識庫：
      * knowledge/*.md      第一行 `tags: nextjs, csp, ...`，其餘為內容。
      * knowledge/fewshot.json  few-shot 範例（list of {input, output}）。
    要升級成向量 RAG，只需改寫 retrieve()，其餘程式不用動。
    """

    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.docs: list[dict[str, Any]] = []
        self.fewshot: list[dict[str, Any]] = []
        self.reload()

    def reload(self) -> None:
        docs: list[dict[str, Any]] = []
        if self.directory.is_dir():
            for path in sorted(self.directory.glob("*.md")):
                text = path.read_text(encoding="utf-8", errors="replace").strip()
                first, _, rest = text.partition("\n")
                tags: set[str] = set()
                if first.lower().startswith("tags:"):
                    tags = {t.strip().lower() for t in first[5:].split(",") if t.strip()}
                    text = rest.strip()
                docs.append({"name": path.stem, "tags": tags, "text": text})
            fewshot_path = self.directory / "fewshot.json"
            if fewshot_path.exists():
                try:
                    self.fewshot = json.loads(fewshot_path.read_text(encoding="utf-8"))
                except json.JSONDecodeError as exc:
                    log.warning("fewshot.json 解析失敗：%s", exc)
                    self.fewshot = []
        self.docs = docs
        log.info("知識庫載入 %d 份文件、%d 個 few-shot 範例", len(self.docs), len(self.fewshot))

    @staticmethod
    def _norm(name: str) -> str:
        return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

    def retrieve(self, tech: dict[str, Any], issue_ids: list[str], max_chars: int = 7000) -> str:
        wanted = {"general", tech.get("platform", "")} | {self._norm(s) for s in tech.get("stack", [])} | set(issue_ids)
        chosen = [d for d in self.docs if d["tags"] & wanted]
        parts: list[str] = []
        used = 0
        for d in chosen:
            chunk = f"### 知識庫：{d['name']}\n{d['text']}"
            if used + len(chunk) > max_chars:
                break
            parts.append(chunk)
            used += len(chunk)
        return "\n\n".join(parts)

    def fewshot_block(self) -> str:
        if not self.fewshot:
            return ""
        blocks = []
        for ex in self.fewshot[:2]:
            blocks.append(
                "【範例輸入】\n" + json.dumps(ex.get("input", {}), ensure_ascii=False)
                + "\n【範例輸出】\n" + json.dumps(ex.get("output", {}), ensure_ascii=False)
            )
        return "以下是輸出風格範例：\n" + "\n\n".join(blocks)


KB = KnowledgeBase(KNOWLEDGE_DIR)
