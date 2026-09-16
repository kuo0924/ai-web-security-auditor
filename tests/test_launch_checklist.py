"""What'Sub 事件延伸：金流 HashKey / HashIV 視同金鑰外洩；上線前五問進知識庫與首頁。"""
from conftest import fr, m
from fastapi.testclient import TestClient

KEY = "Ab3dEf9hIjK1MnOpQrStUvWxYz012345"


def test_tw_payment_hashkey_in_frontend_is_secret_leak():
    js = f'const pay = {{ MerchantID: "MS12345678", HashKey: "{KEY}", HashIV: "Zy9XwV7uTs5RqP3o" }};'
    main_r = fr("https://shop.example/", headers={"content-type": "text/html"}, body=b'<html><script src="/pay.js"></script></html>')
    rep = m.evaluate(input_url="https://shop.example/", main=main_r, http_probe=None,
                     js_results=[("https://shop.example/pay.js", fr("https://shop.example/pay.js", body=js.encode()))],
                     env_result=fr("x", status=404), git_result=fr("x", status=404))
    leak = next(i for i in rep["issues"] if i["id"] == "secret_leak")
    assert leak["penalty"] == 30 and "HashKey" in leak["evidence"] and KEY not in leak["evidence"]
    types = {f["type"] for f in m.scan_secrets([("pay.js", js)])}
    assert types == {"tw_payment"}
    assert m.scan_secrets([("x.js", 'hashKey: "1234"')]) == []  # 太短、名稱不符
    assert m.scan_secrets([("x.js", 'HashKey = "0000000000000000"')]) == []  # 不像亂數


def test_launch_checklist_in_kb_and_page(fresh_state):
    text = m.KB.retrieve({"platform": "generic", "stack": []}, [])
    assert "上線前五問" in text and "What'Sub" in text
    assert "藍新" in m.KB.retrieve({"platform": "generic", "stack": []}, ["secret_leak"])
    html = TestClient(m.app).get("/").text
    assert 'id="five-questions"' in html and "只能回答第五題" in html and "<script>" not in html
