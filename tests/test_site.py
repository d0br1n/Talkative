"""Rule guards for the static landing page in site/.

The brief's "claims you may not make" are enforced here as tests so a copy
edit cannot quietly break them. Every site/*.html, site/*.css and site/*.js
file is scanned, not a fixed list. Only the standard library is used.
"""

import re
from html.parser import HTMLParser
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
FOOTER_LINE = (
    "Talkative is an independent open-source project "
    "and is not affiliated with Anthropic."
)
FAQ_ANTHROPIC_SENTENCE = (
    "It uses your normal Claude Code login, "
    "and Talkative is not affiliated with Anthropic."
)
VOID = {"meta", "link", "br", "hr", "img", "input", "source", "area", "base", "col", "wbr"}
# The ASCII art (wordmark and listening mark) is drawn only from these
# characters, so it can be left out of the copy scans without becoming a
# place to hide words: test_ascii_art_has_no_words enforces the charset.
ART_CHARS = set(" \n#%&'*+,-.8:=@`~")
ART_CONTAINERS = ("wordmark", "hero-mark")


def read_site_files():
    """Every site/*.html, site/*.css and site/*.js, keyed by file name."""
    files = {}
    for pattern in ("*.html", "*.css", "*.js"):
        for path in sorted(SITE.glob(pattern)):
            files[path.name] = path.read_text(encoding="utf-8")
    assert "index.html" in files, "site/index.html missing"
    return files


def files_of(kind):
    return {n: t for n, t in read_site_files().items() if n.endswith("." + kind)}


class Node:
    def __init__(self, tag, attrs, parent):
        self.tag, self.attrs, self.parent = tag, dict(attrs), parent
        self.children = []  # Node or str

    def classes(self):
        return (self.attrs.get("class") or "").split()

    def text(self):
        return "".join(c if isinstance(c, str) else c.text() for c in self.children)

    def walk(self):
        yield self
        for c in self.children:
            if isinstance(c, Node):
                yield from c.walk()


class Tree(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root", [], None)
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.cur)
        self.cur.children.append(node)
        if tag not in VOID:
            self.cur = node

    def handle_startendtag(self, tag, attrs):
        self.cur.children.append(Node(tag, attrs, self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not self.root and n.tag != tag:
            n = n.parent
        if n is not self.root:
            self.cur = n.parent

    def handle_data(self, data):
        self.cur.children.append(data)


def parse(html):
    t = Tree()
    t.feed(html)
    return t.root


def visible_text(node, skip=()):
    """Text a reader sees or hears: no scripts, styles or comments; labels included."""
    out = []
    skip = skip if isinstance(skip, (list, tuple, set)) else (skip,)

    def go(n):
        if any(n is s for s in skip):
            return
        if n.tag in ("script", "style"):
            return
        if n.tag == "meta" and n.attrs.get("name") in ("description", "twitter:description"):
            out.append(n.attrs.get("content", ""))
        if n.tag == "meta" and (n.attrs.get("property") or "").endswith(":description"):
            out.append(n.attrs.get("content", ""))
        for key in ("aria-label", "alt", "title", "placeholder", "value"):
            if n.attrs.get(key):
                out.append(n.attrs[key])
        for c in n.children:
            if isinstance(c, str):
                out.append(c)
            else:
                go(c)

    go(node)
    return re.sub(r"\s+", " ", " ".join(out))


def index_tree():
    return parse(read_site_files()["index.html"])


def find_all(root, tag=None, cls=None):
    return [
        n for n in root.walk()
        if n.tag != "#root" and (tag is None or n.tag == tag)
        and (cls is None or cls in n.classes())
    ]


def art_pres(root):
    return [
        pre for pre in find_all(root, "pre")
        if pre.parent is not None and any(c in pre.parent.classes() for c in ART_CONTAINERS)
    ]


def faq_item(root, question):
    for d in find_all(root, "details"):
        summ = [c for c in d.children if isinstance(c, Node) and c.tag == "summary"]
        if summ and summ[0].text().strip() == question:
            return d
    return None


# ---------- Copy sources: HTML text, CSS content strings, JS strings ----------

QUOTED = r""""(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'"""
JS_STRING = re.compile(QUOTED + r"|`(?:[^`\\]|\\.)*`", re.S)
CSS_CONTENT = re.compile(r"\bcontent\s*:\s*([^;}]*)", re.I)


def css_strings(css):
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    out = []
    for decl in CSS_CONTENT.findall(css):
        out += [s[1:-1] for s in re.findall(QUOTED, decl)]
    return out


def js_strings(js):
    return [m.group(0)[1:-1] for m in JS_STRING.finditer(js)]


def copy_sources(html_skip=lambda root: []):
    """(source, text) pairs for every piece of copy a reader can meet."""
    out = []
    for name, text in read_site_files().items():
        if name.endswith(".html"):
            root = parse(text)
            out.append((name, visible_text(root, skip=art_pres(root) + list(html_skip(root)))))
        elif name.endswith(".css"):
            out += [(name + " content", s) for s in css_strings(text)]
        elif name.endswith(".js"):
            out += [(name + " string", s) for s in js_strings(text)]
    return out


# ---------- No external requests ----------

EXTERNAL_ANYWHERE = [
    r"https?://",
    r"""(?:src|href|action|srcset|poster)\s*=\s*["']?\s*(?:https?:)?//""",
    r"""url\(\s*["']?(?:https?:)?//""",
    r"@import",
]
JS_BANNED = [
    r"\bimport\s*\(", r"\bsendBeacon\b", r"\bWebSocket\b", r"\bfetch\s*\(",
    r"\bXMLHttpRequest\b", r"\blocalStorage\b", r"\bsessionStorage\b",
    r"\bindexedDB\b", r"\bEventSource\b", r"document\.cookie",
]


def test_no_external_requests():
    files = read_site_files()
    for name, text in files.items():
        for pat in EXTERNAL_ANYWHERE:
            assert not re.search(pat, text, re.I), f"{name}: matches {pat}"
        if name.endswith(".js"):
            for pat in JS_BANNED:
                assert not re.search(pat, text), f"{name}: uses {pat}"
    for name, text in files.items():
        if name.endswith(".html"):
            assert not find_all(parse(text), "iframe"), name
            assert not find_all(parse(text), "object"), name
            assert not find_all(parse(text), "embed"), name


def test_mark_js_is_the_only_script_and_local():
    scripts = []
    for name, text in files_of("html").items():
        root = parse(text)
        for node in root.walk():
            if node.tag == "script":
                scripts.append((name, node))
            for attr in node.attrs:
                assert not attr.lower().startswith("on"), f"{name}: inline handler {attr}"
    assert len(scripts) == 1, scripts
    name, node = scripts[0]
    assert name == "index.html"
    assert node.attrs.get("src") == "mark.js"
    assert not node.text().strip(), "inline script body"
    assert (SITE / "mark.js").is_file()
    assert set(files_of("js")) == {"mark.js"}


# ---------- Banned claims (brief section 8) ----------

BANNED = [
    "available now", "download", "coming soon", "completely private",
    "end-to-end", "end to end", "e2e", "encrypted", "revolutionary",
    "ai-powered", "powered by", "sub-second", "latency", "instant",
    "seamless", "magic", "testimonial", "users", "stars", "official",
    "partner", "endorsed", "sidetone", "livekit", "whisper", "sherpa",
    "kokoro", "windows",
]
BANNED_RE = [
    (r"\b\d+(\.\d+)?\s?(s|ms|milliseconds?|secs?|seconds?)\b", re.I),
    (r"\d+\s?%", 0),
    (r"under a second", re.I),
    (r"half a second", re.I),
    (r"real[\s-]?time", re.I),
    (r"\bmac(os)?\b", re.I),
    (r"\bHappy\b", 0),  # the project, by name; "happy" the word is fine
]


def test_banned_claims_absent():
    for source, text in copy_sources():
        low = text.lower()
        for term in BANNED:
            assert term not in low, f"banned term {term!r} in {source}"
        for pat, flags in BANNED_RE:
            assert not re.search(pat, text, flags), f"banned pattern {pat!r} in {source}"


def test_android_only_in_its_faq_item():
    root = index_tree()
    item = faq_item(root, "Does it work on Android?")
    assert item is not None, "FAQ item 'Does it work on Android?' missing"
    for source, text in copy_sources(lambda r: [faq_item(r, "Does it work on Android?")]):
        assert "android" not in text.lower(), f"Android mentioned in {source}"


def test_app_store_only_in_faq():
    root = index_tree()
    item = faq_item(root, "Is it in the App Store?")
    assert item is not None, "FAQ item 'Is it in the App Store?' missing"
    assert "app store" in visible_text(item).lower()
    for source, text in copy_sources(lambda r: [faq_item(r, "Is it in the App Store?")]):
        assert "app store" not in text.lower(), f"App Store mentioned in {source}"


def test_anthropic_mentions_limited():
    seen = set()
    for source, text in copy_sources():
        for s in re.split(r"(?<=[.!?])\s+", text):
            if "anthropic" in s.lower():
                s = s.strip()
                assert s in (FOOTER_LINE, FAQ_ANTHROPIC_SENTENCE), f"{source}: {s}"
                seen.add(s)
    assert seen == {FOOTER_LINE, FAQ_ANTHROPIC_SENTENCE}


def test_footer_line_verbatim():
    footers = find_all(index_tree(), "footer")
    assert footers and FOOTER_LINE in visible_text(footers[0])


def test_ascii_art_has_no_words():
    pres = art_pres(index_tree())
    assert len(pres) == 2, "expected the wordmark and the listening mark"
    for pre in pres:
        extra = set(pre.text()) - ART_CHARS
        assert not extra, f"ASCII art uses non-art characters {sorted(extra)}"


# ---------- Page structure ----------

def test_owner_todos_present():
    html = read_site_files()["index.html"]
    for s in ("TODO(owner): repository URL", "TODO(owner): notify endpoint",
              "TODO(owner): hero photo"):
        assert s in html


def test_notify_form_cannot_leak_without_js():
    root = index_tree()
    forms = [n for n in root.walk() if "data-notify-form" in n.attrs]
    assert len(forms) == 1
    form = forms[0]
    for n in form.walk():
        if n.tag in ("input", "select", "textarea", "button", "object", "output"):
            assert "name" not in n.attrs, f"named field <{n.tag} name=...> in notify form"
    assert not [n for n in root.walk() if "form" in n.attrs and n.tag != "form"], \
        "a field joins the form from outside via form="
    buttons = find_all(form, "button")
    assert buttons and all("disabled" in b.attrs for b in buttons), "button must ship disabled"
    assert "placeholder" in visible_text(form).lower()
    js = read_site_files()["mark.js"]
    assert re.search(r"\.disabled\s*=\s*false", js), "mark.js must enable the button"


def test_hero_says_in_development_before_the_form():
    root = index_tree()
    hero = find_all(root, "section", "hero")[0]
    text = visible_text(hero)
    assert "In development." in text
    assert text.index("In development.") < text.index("Email, to follow development")


def test_brand_name_has_one_accessible_name_per_width():
    root = index_tree()
    header = find_all(root, "header")[0]
    art = find_all(header, cls="wordmark")
    plain = find_all(header, cls="wordmark-text")
    assert len(art) == 1 and len(plain) == 1
    assert art[0].attrs.get("role") == "img" and art[0].attrs.get("aria-label") == "Talkative"
    assert plain[0].text().strip() == "Talkative"
    css = read_site_files()["styles.css"]
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    m = re.search(r"@media \(min-width: 600px\) \{(.*?)\n\}", css, re.S)
    assert m, "missing @media (min-width: 600px) block"
    wide = re.sub(r"\s+", " ", m.group(1))
    outside = re.sub(r"\s+", " ", css[:m.start()] + css[m.end():])
    assert ".wordmark { display: flex; }" in wide
    assert ".wordmark-text { display: none; }" in wide
    assert ".wordmark { display: none; }" in outside


def test_headings_draw_hashes_in_css_only():
    for h2 in find_all(index_tree(), "h2"):
        assert not h2.text().lstrip().startswith("#"), h2.text()
    css = read_site_files()["styles.css"]
    assert re.search(r'h2::before\s*\{[^}]*content:\s*"## "\s*/\s*""', css)


def test_infinite_css_animations_are_tied_to_the_bounded_run():
    css = re.sub(r"/\*.*?\*/", "", read_site_files()["styles.css"], flags=re.S)
    for sel, body in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        if re.search(r"animation\s*:[^;]*infinite", body):
            assert "is-listening" in sel, f"unbounded animation on {sel.strip()}"
    js = read_site_files()["mark.js"]
    assert "MAX_MS = 5000" in js and "IntersectionObserver" in js
    assert "prefers-reduced-motion: reduce" in js


def test_transcript_is_short_and_marked():
    root = index_tree()
    transcripts = find_all(root, cls="transcript")
    assert len(transcripts) == 1 and transcripts[0].tag == "ol"
    items = [c for c in transcripts[0].children if isinstance(c, Node) and c.tag == "li"]
    assert 1 <= len(items) <= 8
    section = transcripts[0].parent
    while section.tag != "section" and section.parent is not None:
        section = section.parent
    assert "Illustrative" in visible_text(section)


def test_six_cards():
    assert len(find_all(index_tree(), cls="card")) == 6


def test_ascii_art_hidden_from_screen_readers():
    pres = find_all(index_tree(), "pre")
    assert pres, "expected ASCII art"
    for pre in pres:
        assert pre.attrs.get("aria-hidden") == "true"
        assert pre.parent.attrs.get("role") == "img"
        assert pre.parent.attrs.get("aria-label")


def test_diagrams_fit_a_phone_and_have_list_equivalents():
    root = index_tree()
    for ident in ("diagram-split", "diagram-local"):
        box = next(n for n in root.walk() if n.attrs.get("id") == ident)
        pre = find_all(box, "pre")[0]
        assert max(len(line) for line in pre.text().splitlines()) <= 34
        assert find_all(box, "h3") and find_all(box, "ol")
    buttons = find_all(root, "button")
    toggles = {b.attrs.get("data-diagram"): b for b in buttons if b.attrs.get("data-diagram")}
    assert set(toggles) == {"split", "local"}
    assert toggles["split"].attrs["aria-pressed"] == "true"
    assert toggles["local"].attrs["aria-pressed"] == "false"
    assert all("hidden" in b.attrs for b in toggles.values())


def test_hooks_for_later_tasks():
    html = read_site_files()["index.html"]
    root = parse(html)
    assert [n.tag for n in root.walk() if n.attrs.get("id") == "main"] == ["main"]
    assert [n.tag for n in root.walk() if n.attrs.get("id") == "hero-mark"] == ["pre"]
    forms = [n for n in root.walk() if "data-notify-form" in n.attrs]
    assert len(forms) == 1
    assert find_all(forms[0], "input") and find_all(forms[0], "label")
    assert any(p.attrs.get("role") == "status" for p in find_all(forms[0], "p"))
    assert 'href="styles.css"' in html
    assert re.search(r'<script src="mark\.js" defer></script>', html)


def test_document_basics():
    html = read_site_files()["index.html"]
    root = parse(html)
    htmls = find_all(root, "html")
    assert htmls and htmls[0].attrs.get("lang") == "en"
    assert len(find_all(root, "h1")) == 1
    assert any(a.attrs.get("href") == "#main" for a in find_all(root, "a"))
    metas = [m.attrs for m in find_all(root, "meta")]
    assert any(m.get("name") == "viewport" for m in metas)
    assert any(m.get("name") == "color-scheme" and m.get("content") == "light dark" for m in metas)


# ---------- Self-checks of the helpers ----------

def test_visible_text_includes_meta_description():
    root = parse('<html><head><meta name="description" content="Available now, 3 seconds"></head></html>')
    assert "available now" in visible_text(root).lower()


def test_string_extractors():
    assert css_strings('a::before { content: "x" / ""; } /* content: "no" */') == ["x", ""]
    assert js_strings("""var a = 'it\\'s', b = "q", c = `t`;""") == ["it\\'s", "q", "t"]
