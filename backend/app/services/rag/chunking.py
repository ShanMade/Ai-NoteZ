from __future__ import annotations

from dataclasses import dataclass
from html.parser import HTMLParser
import re

CHUNK_SIZE = 1600
CHUNK_OVERLAP = 250
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?。؟])\s+")
_MARKDOWN_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")


@dataclass(frozen=True)
class TextChunk:
    text: str


class _ReadableHTML(HTMLParser):
    _BLOCK_TAGS = {
        "address", "article", "blockquote", "br", "div", "h1", "h2", "h3", "h4", "h5", "h6",
        "li", "p", "pre", "section", "td", "th", "tr",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript"}:
            self.hidden_depth += 1
        if not self.hidden_depth and tag in self._BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript"} and self.hidden_depth:
            self.hidden_depth -= 1
        if not self.hidden_depth and tag in self._BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.hidden_depth:
            self.parts.append(data)


def has_indexable_content(title: str, body: str) -> bool:
    return bool(_plain_text(title).strip() or _plain_text(body).strip())


def _plain_text(value: str) -> str:
    html_fragments: list[str] = []
    non_code_lines: list[str] = []
    code_lines: list[str] = []
    open_fence: str | None = None

    def flush_html() -> None:
        if not non_code_lines:
            return
        parser = _ReadableHTML()
        parser.feed("".join(non_code_lines))
        parser.close()
        html_fragments.append("".join(parser.parts))
        non_code_lines.clear()

    for line in (value or "").splitlines(keepends=True):
        stripped = line.lstrip()
        if open_fence is None and stripped.startswith(("```", "~~~")):
            flush_html()
            open_fence = stripped[:3]
            code_lines.append(line)
        elif open_fence is not None:
            code_lines.append(line)
            if stripped.startswith(open_fence):
                html_fragments.append("".join(code_lines))
                code_lines.clear()
                open_fence = None
        else:
            non_code_lines.append(line)
    if open_fence is not None:
        html_fragments.append("".join(code_lines))
    flush_html()
    return _strip_markdown("".join(html_fragments))


def _strip_markdown(value: str) -> str:
    lines: list[str] = []
    in_code = False
    for line in value.splitlines():
        stripped = line.strip()
        if stripped.startswith(("```", "~~~")):
            in_code = not in_code
            lines.append(line)
            continue
        if in_code or stripped.startswith("|"):
            lines.append(line)
            continue
        line = re.sub(r"^\s{0,3}#{1,6}\s+", "", line)
        line = re.sub(r"^\s{0,3}>\s?", "", line)
        line = re.sub(r"^\s*[-*+]\s+", "", line)
        line = re.sub(r"^\s*\d+[.)]\s+", "", line)
        line = _MARKDOWN_LINK.sub(r"\1", line)
        line = re.sub(r"(\*\*|__|~~|\*)", "", line)
        line = re.sub(r"(?<!\w)_(.+?)_(?!\w)", r"\1", line)
        lines.append(line)
    return "\n".join(lines)


def _blocks(text: str) -> list[tuple[str, bool]]:
    lines = text.splitlines()
    blocks: list[tuple[str, bool]] = []
    current: list[str] = []
    mode: str | None = None

    def flush() -> None:
        if current:
            value = "\n".join(current).strip()
            if value:
                blocks.append((value, mode == "table"))
            current.clear()

    index = 0
    while index < len(lines):
        line = lines[index]
        if line.strip().startswith("```") or line.strip().startswith("~~~"):
            flush()
            fence = line.strip()[:3]
            code = [line]
            index += 1
            while index < len(lines):
                code.append(lines[index])
                if lines[index].strip().startswith(fence):
                    break
                index += 1
            blocks.append(("\n".join(code).strip(), False))
        elif line.lstrip().startswith("|"):
            if mode != "table":
                flush()
            mode = "table"
            current.append(line)
        elif not line.strip():
            flush()
            mode = None
        else:
            if mode == "table":
                flush()
                mode = None
            if mode == "text":
                current.append(line)
            else:
                mode = "text"
                current.append(line)
        index += 1
    flush()
    return blocks


def _sentences(block: str) -> list[str]:
    sentences = [part.strip() for part in _SENTENCE_BOUNDARY.split(block) if part.strip()]
    return sentences or [block.strip()]


def _split_long_text(text: str, *, size: int = CHUNK_SIZE) -> list[str]:
    pieces: list[str] = []
    pending = ""
    for sentence in _sentences(text):
        while len(sentence) > size:
            if pending:
                pieces.append(pending)
                pending = ""
            boundary = sentence.rfind(" ", 0, size)
            boundary = boundary if boundary > 0 else size
            piece = sentence[:boundary].strip()
            pieces.append(piece)
            remainder = sentence[boundary:].strip()
            sentence = f"{piece[-CHUNK_OVERLAP:]} {remainder}".strip() if remainder else ""
        if pending and len(pending) + len(sentence) + 1 > size:
            pieces.append(pending)
            overlap_limit = max(0, size - len(sentence) - 1)
            overlap = pending[-min(CHUNK_OVERLAP, overlap_limit):].lstrip() if overlap_limit else ""
            pending = f"{overlap} {sentence}".strip()
        else:
            pending = f"{pending}\n{sentence}".strip()
    if pending:
        pieces.append(pending)
    return pieces


def chunk_text(body: str, title: str = "", *, size: int = CHUNK_SIZE) -> list[TextChunk]:
    title_text = _plain_text(title).strip()
    body_text = _plain_text(body).strip()
    if not has_indexable_content(title, body):
        return []
    source = "\n\n".join(value for value in (title_text, body_text) if value)
    blocks = _blocks(source)
    result: list[str] = []
    pending = ""
    for block, is_table in blocks:
        if is_table and len(block) <= size:
            pieces = [block]
        elif block.startswith(("```", "~~~")):
            pieces = [block]
        else:
            pieces = _split_long_text(block, size=size)
        for piece in pieces:
            if len(piece) > size:
                if pending:
                    result.append(pending)
                    pending = ""
                result.append(piece)
            elif pending and len(pending) + len(piece) + 2 > size:
                result.append(pending)
                overlap_limit = max(0, size - len(piece) - 1)
                overlap = pending[-min(CHUNK_OVERLAP, overlap_limit):].lstrip() if overlap_limit else ""
                pending = f"{overlap}\n{piece}".strip()
            else:
                pending = f"{pending}\n\n{piece}".strip()
    if pending:
        result.append(pending)
    return [TextChunk(text=text) for text in result if text]
