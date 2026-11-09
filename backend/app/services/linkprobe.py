"""Follow a publication URL the way a browser would and decide whether it lands on the right page.

A well-formed URL proves nothing: a DOI can be registered but point at a dead publisher page, a landing page can redirect to the
publisher's home page, and a "page not found" page can answer HTTP 200. `probe` therefore follows every redirect hop itself and judges
the FINAL page:

  ok               final page answered 200 and (when a title was given) its text contains the paper's title words
  dead             HTTP 404 / 410 at the end of the chain
  generic_redirect the chain ended on a site's home page although the starting URL was record-specific
  soft_404         HTTP 200 but the page says the content does not exist
  blocked          401 / 403 / 429: the site refuses scripts, so the link cannot be judged from here (NOT proof it is broken)
  unverified       page loaded but the title could not be found in the HTML (JavaScript-rendered pages do this)
  unreachable      network error / 5xx / too many redirects
Used by `app.scripts.check_links` (live QA) and unit-tested with httpx.MockTransport.
"""
import re
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx

from app.services import ranking

UA = {"User-Agent": "Mozilla/5.0 (compatible; ResearchForge-linkcheck/0.5; +https://researchforge.example)"}
_SOFT_404 = re.compile(r"(page (you (requested|are looking for)|cannot be found)|page not found|404 (error|not found)|no longer available|"
                       r"article (was )?not found|content (is )?not available|this page (does not|doesn.t) exist)", re.I)
_STOP_WORDS = ranking.STOP


def _is_root(url: str) -> bool:
    return urlsplit(url).path in ("", "/")


def _title_words(title: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", title.lower()) if len(w) >= 4 and w not in _STOP_WORDS}


def probe(url: str, expected_title: str | None = None, client: httpx.Client | None = None, max_hops: int = 8) -> dict[str, Any]:
    own = client is None
    c = client or httpx.Client(headers=UA, timeout=20)
    hops: list[str] = [url]
    try:
        cur = url
        r: httpx.Response | None = None
        for _ in range(max_hops):
            r = c.get(cur, follow_redirects=False)
            if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                cur = urljoin(cur, r.headers["location"])
                hops.append(cur)
                continue
            break
        else:
            return _out("unreachable", None, hops, "Too many redirects.")
        assert r is not None
        code = r.status_code
        if code in (404, 410):
            return _out("dead", code, hops, f"HTTP {code} at the end of the redirect chain.")
        if code in (401, 403, 429):
            return _out("blocked", code, hops, f"HTTP {code}: the site refuses automated requests, so this page could not be checked here.")
        if code >= 400:
            return _out("unreachable", code, hops, f"HTTP {code}.")
        if _is_root(hops[-1]) and not _is_root(url) and len(hops) > 1:
            return _out("generic_redirect", code, hops, f"Redirected to a generic home page ({hops[-1]}).")
        text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", r.text[:400_000], flags=re.S | re.I)
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).lower()
        if _SOFT_404.search(text[:4000]) and (not expected_title or not _title_hit(expected_title, text)):
            return _out("soft_404", code, hops, "The page answered 200 but says the content does not exist.")
        if expected_title:
            if _title_hit(expected_title, text):
                return _out("ok", code, hops, "Page text contains the paper's title words.", title_match=True)
            return _out("unverified", code, hops, "Page loaded, but the paper's title was not found in its HTML (it may be rendered by JavaScript).", title_match=False)
        return _out("ok", code, hops, "Page loaded.")
    except httpx.HTTPError as exc:
        return _out("unreachable", None, hops, f"Network error ({type(exc).__name__}).")
    finally:
        if own:
            c.close()


def _title_hit(title: str, text: str) -> bool:
    words = _title_words(title)
    return bool(words) and sum(1 for w in words if w in text) / len(words) >= 0.6


def _out(verdict: str, status: int | None, hops: list[str], detail: str, title_match: bool | None = None) -> dict[str, Any]:
    return {"verdict": verdict, "status": status, "final_url": hops[-1], "redirects": len(hops) - 1, "title_match": title_match, "detail": detail}
