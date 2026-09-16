"""網路安全層：SSRF 阻絕（主機黑名單、逐一驗證 IP、釘選連線）與受控的 safe_fetch。"""
from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
import ssl
from dataclasses import dataclass, field
from typing import Any, Optional
from urllib.parse import urljoin, urlparse, urlunparse

import httpx

from config import *  # noqa: F401,F403


# ---------------------------------------------------------------------------
# 1. 例外與資料結構
# ---------------------------------------------------------------------------
class SSRFBlocked(Exception):
    """目標指向私有/保留位址，或主機名稱屬於內部網域。"""


class TargetUnreachable(Exception):
    """DNS 失敗、連線逾時、轉址過多等，目標本身無法完成檢測。"""



@dataclass
class FetchResult:
    url: str
    status: int
    headers: httpx.Headers
    body: bytes
    hops: list[dict[str, Any]] = field(default_factory=list)
    set_cookies: list[str] = field(default_factory=list)
    truncated: bool = False
    requests_made: int = 1
    tls_not_after: Optional[float] = None  # 憑證到期時間（epoch 秒），從已建立的 TLS 連線讀出，不多送請求

    def text(self) -> str:
        ctype = self.headers.get("content-type", "")
        m = re.search(r"charset=([\w\-]+)", ctype, re.I)
        enc = m.group(1) if m else "utf-8"
        try:
            return self.body.decode(enc, errors="replace")
        except LookupError:
            return self.body.decode("utf-8", errors="replace")



# ---------------------------------------------------------------------------
# 3. SSRF 阻絕：主機名稱黑名單 + 解析後逐一驗證 + IP 釘選
# ---------------------------------------------------------------------------
BLOCKED_HOSTS = {"localhost", "metadata.google.internal", "metadata", "instance-data", "kubernetes.default"}
BLOCKED_HOST_SUFFIXES = (".localhost", ".local", ".internal", ".home.arpa", ".lan", ".intranet", ".corp", ".onion")


def _ip_is_public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        elif ip.sixtofour:
            ip = ip.sixtofour
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    ):
        return False
    return bool(ip.is_global)


async def resolve_public_ip(hostname: str, port: int) -> str:
    """把主機名稱解析成 IP，任一筆落在私有/保留網段就整個拒絕；回傳要釘選連線的 IP。"""
    host = hostname.strip().rstrip(".").lower()
    if not host:
        raise SSRFBlocked("缺少主機名稱")
    if host in BLOCKED_HOSTS or host.endswith(BLOCKED_HOST_SUFFIXES):
        raise SSRFBlocked(f"不允許檢測內部主機名稱：{host}")

    try:  # IP 字面值（含 [::1] 這種寫法）
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        literal = None
    if literal is not None:
        if not _ip_is_public(literal):
            raise SSRFBlocked(f"目標 IP {literal} 屬於私有／保留網段")
        return str(literal)

    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise TargetUnreachable(f"無法解析網域 {host}（{exc.strerror or exc}）") from exc

    addrs: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    for _family, _type, _proto, _canon, sockaddr in infos:
        try:
            addrs.append(ipaddress.ip_address(sockaddr[0]))
        except ValueError:
            continue
    if not addrs:
        raise TargetUnreachable(f"網域 {host} 沒有可用的 IP")
    for ip in addrs:
        if not _ip_is_public(ip):
            raise SSRFBlocked(f"網域 {host} 解析到非公開位址 {ip}，已拒絕")
    addrs.sort(key=lambda a: a.version)  # IPv4 優先，連線較穩
    return str(addrs[0])


async def _read_limited(resp: httpx.Response, max_bytes: int) -> tuple[bytes, bool]:
    chunks: list[bytes] = []
    total = 0
    async for chunk in resp.aiter_bytes():
        chunks.append(chunk)
        total += len(chunk)
        if total >= max_bytes:
            return b"".join(chunks)[:max_bytes], True
    return b"".join(chunks), False


async def safe_fetch(
    client: httpx.AsyncClient,
    url: str,
    *,
    max_bytes: int,
    follow_redirects: bool = True,
    max_redirects: int = MAX_REDIRECTS,
) -> FetchResult:
    """
    受控的 GET：
      * 每一跳（含轉址）都重新解析並驗證 IP。
      * 實際連線釘選到驗證過的 IP，Host 與 SNI 仍用原網域，因此 TLS 憑證驗證照常進行。
    """
    current = url
    hops: list[dict[str, Any]] = []
    cookies: list[str] = []
    made = 0
    tls_not_after: float | None = None
    for _ in range(max_redirects + 1):
        p = urlparse(current)
        if p.scheme not in ("http", "https"):
            raise SSRFBlocked(f"僅允許 http/https（收到 {p.scheme or '空'}）")
        host = p.hostname
        if not host:
            raise TargetUnreachable("轉址目標缺少主機名稱")
        try:
            host_ascii = host.encode("idna").decode("ascii")
        except UnicodeError as exc:
            raise TargetUnreachable(f"主機名稱無法編碼：{host}") from exc
        port = p.port or (443 if p.scheme == "https" else 80)
        ip = await resolve_public_ip(host_ascii, port)

        netloc = f"[{ip}]" if ":" in ip else ip
        if p.port:
            netloc += f":{p.port}"
        pinned = urlunparse(p._replace(netloc=netloc))
        headers = {
            "Host": host_ascii if p.port is None else f"{host_ascii}:{p.port}",
            "User-Agent": USER_AGENT,
            "Accept": "*/*",
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        }
        extensions = {"sni_hostname": host_ascii} if p.scheme == "https" else {}
        req = client.build_request("GET", pinned, headers=headers, extensions=extensions)
        try:
            resp = await client.send(req, stream=True)
        except httpx.HTTPError as exc:
            raise TargetUnreachable(f"連線失敗：{current}（{type(exc).__name__}）") from exc
        made += 1
        try:
            try:  # 從這條連線的 TLS 物件讀憑證到期日（只讀，不多送請求）
                stream = resp.extensions.get("network_stream")
                ssl_obj = stream.get_extra_info("ssl_object") if stream is not None else None
                cert = ssl_obj.getpeercert() if ssl_obj is not None else None
                if cert and cert.get("notAfter"):
                    tls_not_after = float(ssl.cert_time_to_seconds(cert["notAfter"]))
            except Exception:  # 憑證讀不到不影響檢測
                pass
            cookies.extend(resp.headers.get_list("set-cookie"))
            location = resp.headers.get("location")
            if follow_redirects and resp.status_code in (301, 302, 303, 307, 308) and location:
                nxt = urljoin(current, location)
                hops.append({"from": current, "to": nxt, "status": resp.status_code})
                current = nxt
                continue
            body, truncated = await _read_limited(resp, max_bytes)
            return FetchResult(
                url=current,
                status=resp.status_code,
                headers=resp.headers,
                body=body,
                hops=hops,
                set_cookies=cookies,
                truncated=truncated,
                requests_made=made,
                tls_not_after=tls_not_after,
            )
        finally:
            await resp.aclose()
    raise TargetUnreachable(f"轉址次數過多（超過 {max_redirects} 次）")
