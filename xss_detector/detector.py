"""Rule-based XSS detection engine.

Pipeline:
  1. Normalise the input the way a browser/app might eventually decode it
     (URL-decoding, HTML entities, \\uXXXX / \\xXX escapes, NUL/control chars,
     Unicode compatibility forms, short /**/ comments), repeated until stable.
  2. Run weighted regex rules over the decoded text.
  3. Sum the weights of the distinct rules that fired (capped at 100) and map
     the score to a risk level.

All patterns are written to avoid nested unbounded quantifiers so scanning
stays linear-ish on hostile input.
"""

from __future__ import annotations

import html
import re
import unicodedata
from dataclasses import dataclass, field
from urllib.parse import unquote

MAX_DECODE_PASSES = 5
SNIPPET_LEN = 60

LEVELS = ((75, "critical"), (50, "high"), (25, "medium"), (1, "low"), (0, "safe"))


def level_for(score: int) -> str:
    for floor, name in LEVELS:
        if score >= floor:
            return name
    return "safe"


def _spaced(word: str) -> str:
    """'javascript' -> j\\s{0,20}a\\s{0,20}v... (browsers ignore tab/CR/LF inside schemes)."""
    return r"\s{0,20}".join(re.escape(c) for c in word)


_EVENTS = (
    "abort|afterprint|animationend|animationiteration|animationstart|auxclick|"
    "beforecopy|beforecut|beforeinput|beforepaste|beforeprint|beforeunload|begin|"
    "blur|bounce|canplay|canplaythrough|change|click|contextmenu|copy|cut|dblclick|"
    "drag|dragend|dragenter|dragleave|dragover|dragstart|drop|durationchange|end|"
    "ended|error|finish|focus|focusin|focusout|formdata|hashchange|input|invalid|"
    "keydown|keypress|keyup|load|loadeddata|loadedmetadata|loadend|loadstart|message|"
    "mousedown|mouseenter|mouseleave|mousemove|mouseout|mouseover|mouseup|mousewheel|"
    "offline|online|pagehide|pageshow|paste|pause|play|playing|pointerdown|"
    "pointerenter|pointerleave|pointermove|pointerout|pointerover|pointerup|popstate|"
    "progress|ratechange|readystatechange|repeat|reset|resize|scroll|search|seeked|"
    "seeking|select|selectstart|show|start|submit|toggle|touchcancel|touchend|"
    "touchmove|touchstart|transitionend|transitionrun|transitionstart|unload|"
    "volumechange|waiting|wheel"
)

_ATTR_URL = r"(?:href|src|action|formaction|data|xlink:href|background|poster|codebase)"


@dataclass(frozen=True)
class Rule:
    id: str
    name: str
    category: str
    weight: int
    description: str
    pattern: re.Pattern


def _rule(id, name, category, weight, description, regex, flags=re.IGNORECASE):
    return Rule(id, name, category, weight, description, re.compile(regex, flags))


DEFAULT_RULES: tuple[Rule, ...] = (
    # --- script / markup injection -------------------------------------------------
    _rule("XSS001", "Script tag", "markup", 70,
          "Opening or closing <script> tag.",
          r"</?script(?![a-z0-9_-])"),
    _rule("XSS002", "Inline event handler (known)", "markup", 60,
          "HTML event-handler attribute such as onerror=, onload=, onclick=.",
          rf"(?<![a-z0-9_-])on(?:{_EVENTS})\s*="),
    _rule("XSS003", "Inline event handler (generic)", "markup", 30,
          "Unrecognised on*= attribute inside an opening tag; possibly a newer or obscure event handler.",
          rf"<[a-z][^<>]{{0,200}}?(?<![a-z0-9_-])on(?!(?:{_EVENTS})\s*=)[a-z]{{3,25}}\s*="),
    _rule("XSS004", "Active embedding tag", "markup", 55,
          "iframe/frame/object/embed/applet can load and run foreign content.",
          r"</?(?:iframe|frame|frameset|object|embed|applet)(?![a-z0-9_-])"),
    _rule("XSS005", "Document-altering tag", "markup", 40,
          "meta/base/link/style can redirect, hijack relative URLs or load code.",
          r"</?(?:meta|base|link|style)(?![a-z0-9_-])"),
    _rule("XSS006", "Vector-capable tag", "markup", 35,
          "svg/math/xml/template/foreignObject are frequent XSS vehicles.",
          r"</?(?:svg|math|xml|foreignobject|template|animate|set)(?![a-z0-9_-])"),
    _rule("XSS007", "Handler-carrying tag", "markup", 15,
          "Tag that commonly hosts event handlers (img, body, video, input, ...).",
          r"</?(?:img|body|video|audio|source|details|marquee|input|form|button|"
          r"select|textarea|isindex|keygen)(?![a-z0-9_-])"),
    _rule("XSS008", "Attribute breakout", "markup", 40,
          "Quote followed by '>' and a new tag: closes an attribute to inject markup.",
          r"[\"'`]\s{0,10}/?>\s{0,10}<\s{0,10}[a-z!/]"),
    _rule("XSS009", "srcdoc / formaction / xlink:href", "markup", 45,
          "Attributes that embed HTML or navigate via injected values.",
          r"(?<![a-z0-9_-])(?:srcdoc|formaction|xlink:href)\s*="),
    _rule("XSS010", "Comment / CDATA trick", "markup", 20,
          "Conditional comments or CDATA sections used to hide payloads from filters.",
          r"<!--\s{0,5}\[if|<!\[cdata\["),

    # --- dangerous URI schemes -----------------------------------------------------
    _rule("XSS020", "javascript: URI in URL attribute", "uri", 70,
          "javascript:/vbscript: used as the value of href/src/action/etc.",
          rf"{_ATTR_URL}\s{{0,10}}=\s{{0,10}}[\"'`]?\s{{0,10}}"
          rf"(?:{_spaced('javascript')}|{_spaced('vbscript')})\s{{0,10}}:"),
    _rule("XSS021", "javascript: URI with payload", "uri", 30,
          "javascript:/vbscript: immediately followed by code.",
          rf"(?:{_spaced('javascript')}|{_spaced('vbscript')})\s{{0,10}}:(?=\S)"),
    _rule("XSS022", "javascript: scheme mention", "uri", 20,
          "The javascript:/vbscript: scheme appears in the text (may be prose).",
          rf"(?:{_spaced('javascript')}|{_spaced('vbscript')})\s{{0,10}}:"),
    _rule("XSS023", "Executable data: URI", "uri", 60,
          "data: URI carrying HTML, SVG or JavaScript.",
          rf"{_spaced('data')}\s{{0,10}}:\s{{0,10}}(?:text/html|application/xhtml|"
          r"image/svg\+xml|text/javascript|application/(?:x-)?javascript)"),

    # --- JavaScript sinks & helpers ------------------------------------------------
    _rule("XSS030", "Cookie / storage access", "javascript", 35,
          "Reads cookies, storage or document.domain (session theft).",
          r"document\s{0,5}\.\s{0,5}(?:cookie|domain)|(?:local|session)storage"),
    _rule("XSS031", "DOM write sink", "javascript", 40,
          "document.write, innerHTML/outerHTML assignment, insertAdjacentHTML.",
          r"document\s{0,5}\.\s{0,5}write(?:ln)?\s{0,5}\(|"
          r"\.\s{0,5}(?:inner|outer)html\s{0,5}=|insertadjacenthtml"),
    _rule("XSS032", "Dynamic code execution", "javascript", 40,
          "eval, new Function, setTimeout/setInterval, execScript.",
          r"(?<![a-z0-9_$.])(?:eval|new\s{1,5}function|settimeout|setinterval|execscript)"
          r"\s{0,5}\(\s{0,5}[^\s)]"),
    _rule("XSS033", "Popup probe", "javascript", 20,
          "alert/prompt/confirm call - the classic XSS proof-of-concept.",
          r"(?<![a-z0-9_$])(?:alert|prompt|confirm)\s{0,5}(?:\(|`)|"
          r"[=,(]\s{0,5}(?:alert|prompt|confirm)\s{0,5}[,)]"),
    _rule("XSS034", "Navigation / redirect", "javascript", 35,
          "Assigns or reads window/document location.",
          r"(?:window|document|top|self|parent)\s{0,5}\.\s{0,5}location|"
          r"(?<![a-z0-9_$])location\s{0,5}\.\s{0,5}(?:href|replace|assign)"),
    _rule("XSS035", "String obfuscation helper", "javascript", 30,
          "fromCharCode/atob/unescape are used to hide payload text.",
          r"fromcharcode|(?<![a-z0-9_$])(?:atob|unescape)\s{0,5}\("),
    _rule("XSS036", "Network exfiltration", "javascript", 30,
          "XMLHttpRequest / fetch / sendBeacon / WebSocket / new Image().",
          r"xmlhttprequest|(?<![a-z0-9_$])fetch\(|sendbeacon|websocket|new\s{1,5}image\b"),

    # --- CSS & template injection ---------------------------------------------------
    _rule("XSS040", "CSS script vector", "css", 50,
          "expression(), -moz-binding, behavior:url(), url(javascript:).",
          rf":\s{{0,5}}expression\s{{0,5}}\(|-moz-binding|behavior\s{{0,5}}:\s{{0,5}}url|"
          rf"url\s{{0,5}}\(\s{{0,5}}[\"']?\s{{0,5}}{_spaced('javascript')}\s{{0,5}}:"),
    _rule("XSS041", "Template expression injection", "template", 45,
          "{{ ... constructor ... }} style sandbox escapes (AngularJS, Vue, etc.).",
          r"\{\{.{0,200}?(?:constructor|__proto__|\$on|\$eval).{0,200}?\}\}", re.IGNORECASE | re.DOTALL),
)

_UNI_ESC = re.compile(r"\\u([0-9a-fA-F]{4})")
_HEX_ESC = re.compile(r"\\x([0-9a-fA-F]{2})")
_PCT_U = re.compile(r"%u([0-9a-fA-F]{4})")
_JS_COMMENT =re.compile(r"/\*[^*]{0,64}\*/")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

OBFUSCATION_RULE = Rule(
    "XSS099", "Encoded / obfuscated payload", "evasion", 15,
    "The dangerous content only appears after decoding URL/HTML/unicode escapes.",
    re.compile(r"(?!)"),
)


def normalize(text: str) -> tuple[str, int]:
    """Decode `text` repeatedly. Returns (decoded_text, number_of_layers_removed)."""
    layers = 0
    current = text
    for _ in range(MAX_DECODE_PASSES):
        previous = current
        current = _CONTROL.sub("", current)
        if "%" in current:
            current = _PCT_U.sub(lambda m: chr(int(m.group(1), 16)), current)
            current = unquote(current)
        if "&" in current:
            current = html.unescape(current)
        if "\\" in current:
            current = _UNI_ESC.sub(lambda m: chr(int(m.group(1), 16)), current)
            current = _HEX_ESC.sub(lambda m: chr(int(m.group(1), 16)), current)
        current = unicodedata.normalize("NFKC", current)
        current = _JS_COMMENT.sub("", current)
        if current == previous:
            break
        layers += 1
    return current, layers


@dataclass(frozen=True)
class Finding:
    rule_id: str
    name: str
    category: str
    weight: int
    description: str
    match: str
    position: int
    count: int = 1

    def to_dict(self) -> dict:
        return dict(self.__dict__)


@dataclass
class ScanResult:
    score: int
    level: str
    is_malicious: bool
    findings: list[Finding] = field(default_factory=list)
    decoded: str = ""
    decode_layers: int = 0

    def to_dict(self) -> dict:
        return {
            "score": self.score,
            "level": self.level,
            "is_malicious": self.is_malicious,
            "decode_layers": self.decode_layers,
            "decoded": self.decoded,
            "findings": [f.to_dict() for f in self.findings],
        }


class XSSDetector:
    """Scan strings (or dicts of form fields) for XSS indicators.

    `block_threshold` is the score at which input is considered malicious
    (default 25 = "medium" or worse).
    """

    def __init__(self, rules=DEFAULT_RULES, block_threshold: int = 25):
        self.rules = tuple(rules)
        self.block_threshold = block_threshold

    def scan(self, text) -> ScanResult:
        text = "" if text is None else str(text)
        decoded, layers = normalize(text)

        findings: list[Finding] = []
        for rule in self.rules:
            matches = list(rule.pattern.finditer(decoded))
            if not matches:
                continue
            first = matches[0]
            findings.append(Finding(
                rule.id, rule.name, rule.category, rule.weight, rule.description,
                first.group(0).strip()[:SNIPPET_LEN], first.start(), len(matches),
            ))

        if findings and decoded != text:
            r = OBFUSCATION_RULE
            findings.append(Finding(r.id, r.name, r.category, r.weight, r.description,
                                    f"{layers} decoding layer(s)", 0))

        findings.sort(key=lambda f: -f.weight)
        score = min(100, sum(f.weight for f in findings))
        return ScanResult(score, level_for(score), score >= self.block_threshold,
                          findings, decoded, layers)

    def scan_fields(self, fields: dict) -> dict[str, ScanResult]:
        return {str(name): self.scan(value) for name, value in fields.items()}


_default = XSSDetector()


def scan(text) -> ScanResult:
    """Scan with the default detector."""
    return _default.scan(text)
