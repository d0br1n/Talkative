"""Rule guards for the static landing page in site/.

The brief's "claims you may not make" are enforced here as tests so a copy
edit cannot quietly break them. Only the standard library is used.
"""

import re
from html.parser import HTMLParser
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
FOOTER_LINE = (
    "Talkative is an independent open-source project "
    "and is not affiliated with Anthropic."
)
VOID = {"meta", "link", "br", "hr", "img", "input", "source", "area", "base", "col", "wbr"}


def read_site_files():
    """index.html is required; styles.css and mark.js are skipped until they exist."""
    files = {"index.html": (SITE / "index.html").read_text(encoding="utf-8")}
    for name in ("styles.css", "mark.js"):
        path = SITE / name
        if path.exists():
            files[name] = path.read_text(encoding="utf-8")
    return files


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


def visible_text(node, skip=None):
    """Text a reader sees or hears: no scripts, styles or comments; labels included."""
    out = []

    def go(n):
        if n is skip:
            return
        if n.tag in ("script", "style"):
            return
        if n.tag == "meta" and n.attrs.get("name") in ("description", "twitter:description"):
            out.append(n.attrs.get("content", ""))
        if n.tag == "meta" and (n.attrs.get("property") or "").endswith(":description"):
            out.append(n.attrs.get("content", ""))
        for key in ("aria-label", "alt", "title", "placeholder"):
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


def test_no_external_requests():
    for name, text in read_site_files().items():
        assert not re.search(r"https?://", text, re.I), f"external URL in {name}"
    assert not find_all(index_tree(), "iframe")


BANNED = [
    "available now", "download", "completely private", "end-to-end",
    "revolutionary", "ai-powered", "sub-second", "testimonial", "sidetone",
    "livekit", "whisper", "sherpa", "windows", "macos",
]


def test_banned_claims_absent():
    text = visible_text(index_tree()).lower()
    for term in BANNED:
        assert term not in text, f"banned term: {term}"
    assert not re.search(r"\b\d+(\.\d+)?\s?(ms|milliseconds?|seconds?)\b", text, re.I)


def faq_item(root):
    for d in find_all(root, "details"):
        summ = [c for c in d.children if isinstance(c, Node) and c.tag == "summary"]
        if summ and summ[0].text().strip() == "Is it in the App Store?":
            return d
    return None


def test_app_store_only_in_faq():
    root = index_tree()
    item = faq_item(root)
    assert item is not None, "FAQ item 'Is it in the App Store?' missing"
    assert "app store" in visible_text(item).lower()
    assert "app store" not in visible_text(root, skip=item).lower()


def test_anthropic_mentions_limited():
    text = visible_text(index_tree())
    sentences = re.split(r"(?<=[.!?])\s+", text)
    hits = [s for s in sentences if "anthropic" in s.lower()]
    assert hits, "expected the footer line"
    for s in hits:
        assert FOOTER_LINE in s or "not affiliated with Anthropic" in s, s


def test_footer_line_verbatim():
    footers = find_all(index_tree(), "footer")
    assert footers and FOOTER_LINE in visible_text(footers[0])


def test_owner_todos_present():
    html = read_site_files()["index.html"]
    for s in ("TODO(owner): repository URL", "TODO(owner): notify endpoint",
              "TODO(owner): hero photo"):
        assert s in html


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
        assert max(len(line) for line in pre.text().splitlines()) <= 36
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


def test_visible_text_includes_meta_description():
    root = parse('<html><head><meta name="description" content="Available now, 3 seconds"></head></html>')
    assert "available now" in visible_text(root).lower()
