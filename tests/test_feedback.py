"""修復 Prompt 的 👍👎 回饋：計數、驗證、限流、進統計與狀態快照、前端有接線。"""
from conftest import m
from fastapi.testclient import TestClient


def test_feedback_counts_validation_and_stats(fresh_state):
    c = TestClient(m.app)
    r = c.post("/api/feedback", json={"kind": "issue", "issue_id": "csp", "vote": "up"})
    assert r.status_code == 200 and r.json() == {"ok": True, "kind": "issue", "id": "csp", "up": 1, "down": 0}
    assert c.post("/api/feedback", json={"kind": "issue", "issue_id": "csp", "vote": "down"}).json()["down"] == 1
    assert c.post("/api/feedback", json={"kind": "ai", "issue_id": "hsts+https", "vote": "up"}).status_code == 200
    assert c.post("/api/feedback", json={"kind": "snippet", "issue_id": "public/_headers", "vote": "up"}).status_code == 200
    assert c.post("/api/feedback", json={"kind": "bogus", "issue_id": "csp", "vote": "up"}).status_code == 422
    assert c.post("/api/feedback", json={"kind": "issue", "issue_id": "csp<script>", "vote": "up"}).status_code == 422
    assert c.post("/api/feedback", json={"kind": "issue", "issue_id": "csp", "vote": "meh"}).status_code == 422
    fb = c.get("/api/stats").json()["feedback"]
    assert fb["total_up"] == 3 and fb["total_down"] == 1
    assert fb["items"][0] == {"kind": "issue", "id": "csp", "up": 1, "down": 1, "helpful": 50}
    assert {i["id"] for i in fb["items"]} == {"csp", "hsts+https", "public/_headers"}


def test_feedback_rate_limit_and_cap(fresh_state):
    fresh_state("feedback_limiter", m.SlidingWindowLimiter(2, 60))
    c = TestClient(m.app)
    for _ in range(2):
        assert c.post("/api/feedback", json={"kind": "issue", "issue_id": "csp", "vote": "up"}).status_code == 200
    r = c.post("/api/feedback", json={"kind": "issue", "issue_id": "csp", "vote": "up"})
    assert r.status_code == 429 and "Retry-After" in r.headers
    m.stats.feedback = {f"issue:k{i}": {"up": 1, "down": 0} for i in range(m.UsageStats.FEEDBACK_MAX_KEYS)}
    assert m.stats.record_feedback("issue", "overflow", "up") == {"up": 0, "down": 0} and "issue:overflow" not in m.stats.feedback
    assert m.stats.record_feedback("issue", "k1", "down") == {"up": 1, "down": 1}
    assert len(m.stats.feedback_view()["items"]) == 30


def test_feedback_survives_state_roundtrip(fresh_state):
    m.stats.record_feedback("snippet", "next.config.js", "up")
    blob = m.export_state()
    fresh_state("stats", m.UsageStats())
    assert m.stats.feedback == {}
    m.import_state(blob)
    assert m.stats.feedback == {"snippet:next.config.js": {"up": 1, "down": 0}}
    m.stats.load({"started_at": "2026-01-01T00:00:00+00:00", "feedback": {"x:y": "junk", "a:b": {"up": "2"}}})
    assert m.stats.feedback == {"a:b": {"up": 2, "down": 0}}


def test_feedback_ui_wired(fresh_state):
    c = TestClient(m.app)
    js = c.get("/static/app.js").text
    assert "data-vote" in js and "/api/feedback" in js and "voteButtons('issue', it.id)" in js
    assert 'id="feedback"' in c.get("/stats").text and "s.feedback" in c.get("/static/stats.js").text
    assert ".vote-on" in c.get("/static/tailwind.css").text
    assert "commit" in c.get("/api/health").json()


def test_static_cache_headers(fresh_state):
    c = TestClient(m.app)
    assert len(m.ASSET_VERSION) == 10
    assert c.get(f"/static/app.js?v={m.ASSET_VERSION}").headers["cache-control"] == "public, max-age=31536000, immutable"
    assert c.get("/static/app.js").headers["cache-control"] == "no-cache"
    assert c.get("/static/app.js?v=stale").headers["cache-control"] == "no-cache"
    assert f"stats.js?v={m.ASSET_VERSION}" in c.get("/stats").text
