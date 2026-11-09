"""Unified relevance ranking across providers.

Each provider ranks by its own opaque scoring, so interleaving their lists puts a provider's rank-3
hit above another's rank-4 hit regardless of which paper actually answers the query. Here every merged
paper gets ONE score computed from its own text, so results from all providers are comparable.

The score is explainable (the UI can show which query terms were found where) and is *gated by term
coverage*: a paper that contains only one word of a four-word query cannot rank highly just because
that word is frequent or because a provider ranked it first.

Signals (weights sum to ~1 before the gate):
  title coverage .34 · abstract coverage .18 · keyword coverage .07 · phrase/bigram adjacency .13
  exact / contained title .12 · author match .04 · domain-concept overlap .05
  provider consensus .03 · best provider rank (reciprocal) .02 · citations .01 · publication type ±.01..03
No relevance claim is made for ordering across "Load more" pages: each page is ranked within itself.
"""
import math
import re
from typing import Any

from app.services.extraction import extract_metadata

STOP = frozenset("""a an and are as at be been but by can could do does for from had has have how in into is it its of on or
our over than that the their these this those to using use used via was were what when where which while who why will with within
without we study analysis based approach new novel towards toward""".split())

# Abbreviation <-> expansion pairs that are standard in neuroimaging / ML. A query term counts as found if the paper has the
# term itself or the full expansion (all words), so "MRI" matches "magnetic resonance imaging" and vice versa.
EXPANSIONS: dict[str, list[list[str]]] = {
    "mri": [["magnetic", "resonance", "imaging"]],
    "fmri": [["functional", "magnetic", "resonance"], ["functional", "mri"]],
    "dti": [["diffusion", "tensor"]],
    "pet": [["positron", "emission"]],
    "eeg": [["electroencephalography"], ["electroencephalogram"]],
    "meg": [["magnetoencephalography"]],
    "cnn": [["convolutional", "neural", "network"]],
    "gnn": [["graph", "neural", "network"]],
    "gan": [["generative", "adversarial"]],
    "ad": [["alzheimer"]],
    "mci": [["mild", "cognitive", "impairment"]],
    "asd": [["autism"]],
    "adni": [["alzheimer", "neuroimaging", "initiative"]],
    "dl": [["deep", "learning"]],
    "ml": [["machine", "learning"]],
    "nlp": [["natural", "language", "processing"]],
    "llm": [["large", "language", "model"]],
    "bci": [["brain", "computer", "interface"]],
}
_WORD = re.compile(r"[a-z0-9]+")


def stem(w: str) -> str:
    """Very small plural/-ing/-e stemmer: enough to match 'networks'/'network', 'imaging'/'image', 'studies'/'study'.
    Both sides of every comparison are stemmed the same way, so the stems only have to be consistent, not real words."""
    if len(w) > 4 and w.endswith("ies"):
        w = w[:-3] + "y"
    elif len(w) > 5 and w.endswith("ing"):
        w = w[:-3]
        w = w[:-1] if len(w) > 2 and w[-1] == w[-2] else w
    elif len(w) > 4 and w.endswith(("ches", "shes", "xes", "sses")):
        w = w[:-2]
    elif len(w) > 3 and w.endswith("s") and not w.endswith(("ss", "us", "is")):
        w = w[:-1]
    if len(w) > 4 and w.endswith("e"):
        w = w[:-1]
    return w


def tokenize(text: str | None) -> list[str]:
    return [stem(w) for w in _WORD.findall((text or "").lower())]


def _phrases(query: str) -> tuple[list[list[str]], str]:
    quoted = re.findall(r'"([^"]{2,100})"', query)
    return [tokenize(p) for p in quoted], re.sub(r'"[^"]*"', " ", query)


class Query:
    def __init__(self, raw: str):
        self.raw = raw
        self.phrases, rest = _phrases(raw)
        all_tokens = tokenize(raw.replace('"', " "))
        content = [t for t in tokenize(rest) if t not in STOP and len(t) > 1]
        for ph in self.phrases:
            content += [t for t in ph if t not in STOP and len(t) > 1]
        self.terms: list[str] = list(dict.fromkeys(content or [t for t in all_tokens if len(t) > 1]))
        self.sequence: list[str] = [t for t in all_tokens if t not in STOP]  # order kept, for adjacency
        self.concepts = _concepts(extract_metadata(raw, None, []))
        self.norm = " ".join(all_tokens)


def _concepts(meta: dict[str, Any]) -> set[str]:
    return {f"{k}:{t['value']}" for k in ("modalities", "diseases", "datasets", "methods") for t in meta.get(k, [])}


def _has(term: str, bag: set[str]) -> bool:
    """The term itself, or its full standard expansion (MRI <-> magnetic resonance imaging), is present."""
    return term in bag or any(all(stem(w) in bag for w in e) for e in EXPANSIONS.get(term, []))


def _coverage(q: Query, tokens: list[str]) -> tuple[float, list[str]]:
    if not q.terms:
        return 0.0, []
    bag = set(tokens)
    found = [t for t in q.terms if _has(t, bag) or _long_form_hit(t, q, bag)]
    return len(found) / len(q.terms), [t for t in q.terms if t not in found]


def _long_form_hit(term: str, q: Query, bag: set[str]) -> bool:
    """Query said 'magnetic resonance imaging' (3 terms); paper says 'MRI'. Count the long-form words as found when the abbreviation is present."""
    for abbr, expansions in EXPANSIONS.items():
        if abbr in bag:
            for e in expansions:
                words = {stem(w) for w in e}
                if term in words and words <= set(q.terms):
                    return True
    return False


def _bigrams(seq: list[str]) -> set[tuple[str, str]]:
    return set(zip(seq, seq[1:]))


def _adjacency(q: Query, tokens: list[str]) -> float:
    want = _bigrams(q.sequence)
    if not want:
        return 0.0
    return len(want & _bigrams(tokens)) / len(want)


def score_paper(q: Query, p: dict[str, Any], *, n_providers: int, ranks: dict[str, int]) -> dict[str, Any]:
    """Score one merged paper. `ranks` maps provider id -> 1-based rank that provider gave it."""
    title_t = tokenize(p.get("title"))
    abs_t = tokenize(p.get("abstract"))
    kw_t = tokenize(" ".join(p.get("keywords") or []))
    title_cov, title_missing = _coverage(q, title_t)
    abs_cov, _ = _coverage(q, abs_t)
    kw_cov, _ = _coverage(q, kw_t)
    all_cov, missing = _coverage(q, title_t + abs_t + kw_t)

    adj = 0.6 * _adjacency(q, title_t) + 0.4 * _adjacency(q, abs_t)
    tnorm = " ".join(title_t)
    exact = 1.0 if q.norm and tnorm == q.norm else 0.0
    contained = 0.7 if q.norm and len(q.sequence) >= 2 and q.norm in tnorm else 0.0
    title_match = max(exact, contained)
    phrase_ok = all(" ".join(ph) in " ".join(title_t + [""] + abs_t) for ph in q.phrases) if q.phrases else True

    q_authors = {t for t in q.terms if len(t) > 2}
    a_tokens = {w for a in (p.get("authors") or []) for w in tokenize(a)}
    author = len(q_authors & a_tokens) / len(q_authors) if q_authors and a_tokens else 0.0

    concept = 0.0
    if q.concepts:
        pc = _concepts(extract_metadata(p.get("title") or "", p.get("abstract"), p.get("keywords") or []))
        concept = len(q.concepts & pc) / len(q.concepts)

    consensus = min(1.0, len(ranks) / max(1, n_providers)) if ranks else 0.0
    rrf = sum(1 / (60 + r) for r in ranks.values()) / (n_providers / 61) if ranks and n_providers else 0.0
    cites = min(1.0, math.log1p(p.get("cited_by_count") or 0) / math.log1p(5000))
    ptype = {"journal_article": 0.0, "review": 0.0, "conference_paper": 0.0, "preprint": -0.01, "book_chapter": -0.02, "book": -0.02, "other": -0.03}.get(
        p.get("publication_type") or "", 0.0)

    has_abs = bool(abs_t)
    text = 0.34 * title_cov + 0.18 * abs_cov + 0.07 * kw_cov + 0.13 * adj + 0.12 * title_match + 0.04 * author + 0.05 * concept
    if not has_abs:  # no abstract means less evidence, not a penalty beyond the missing abstract signal
        text += 0.18 * title_cov * 0.5
    raw = text + 0.03 * consensus + 0.02 * min(1.0, rrf) + 0.01 * cites + ptype
    # Coverage gate: found 1 of 4 terms -> x0.06; 2 of 4 -> x0.25; 3 of 4 -> x0.56; all -> x1.
    gate = all_cov ** 2 if q.terms else 1.0
    if not phrase_ok:
        gate *= 0.5
    score = max(0.0, min(1.0, raw * gate))
    if exact:
        score = max(score, 0.97)
    return {
        "relevance": round(score, 3),
        "match": {
            "terms": len(q.terms), "terms_found": len(q.terms) - len(missing), "missing_terms": missing,
            "in_title": len(q.terms) - len(title_missing), "exact_title": bool(exact), "phrase_found": phrase_ok,
        },
    }


def rank(query: str, papers: list[dict[str, Any]], *, n_providers: int) -> list[dict[str, Any]]:
    """Attach `relevance` + `match` to every paper and return them best first (stable for ties)."""
    q = Query(query)
    scored = []
    for i, p in enumerate(papers):
        s = score_paper(q, p, n_providers=n_providers, ranks=p.get("_ranks") or {})
        scored.append((s["relevance"], -i, {**p, **s}))
    scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
    return [p for _, _, p in scored]
