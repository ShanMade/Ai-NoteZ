from __future__ import annotations

from dataclasses import dataclass
import re
import uuid
from typing import Literal


@dataclass(frozen=True)
class QueryPlan:
    scope: Literal["note", "library"]
    resolved_query: str
    note_id: uuid.UUID | None = None
    operation: Literal["count", "largest", "recent"] | None = None


_VAGUE_PRONOUN = re.compile(
    r"\b(?:it|that|those|these|they|them|this|same|former|latter)\b",
    re.IGNORECASE,
)
_VAGUE_SHAPE = re.compile(
    r"^(?:summari[sz]e|largest|longest|shortest|most recent|latest|oldest|compare|expand|"
    r"continue|explain|elaborate|what about|and|why|how so)(?:\s+(?:it|that|this|them|those|"
    r"the same|more|less|again))?[?.! ]*$",
    re.IGNORECASE,
)
_COUNT = re.compile(r"\bhow many\b.*\bnotes?\b|\bcount\b.*\bnotes?\b", re.IGNORECASE)
_LARGEST = re.compile(r"\b(?:largest|longest|biggest)\s+notes?\b|\blongest note\b", re.IGNORECASE)
_RECENT = re.compile(r"\b(?:most recent|latest|newest)\s+notes?\b|\bwhat did i write last\b", re.IGNORECASE)


def is_vague_followup(question: str, conversation_history: list[dict[str, str]]) -> bool:
    if not conversation_history:
        return False
    cleaned = question.strip().rstrip("?.!").strip()
    return bool(_VAGUE_PRONOUN.search(cleaned) or _VAGUE_SHAPE.fullmatch(cleaned))


def resolve_against_history(question: str, conversation_history: list[dict[str, str]]) -> str:
    prior = next(
        (turn["content"].strip() for turn in reversed(conversation_history) if turn.get("role") == "user" and turn.get("content", "").strip()),
        "",
    )
    if not prior:
        return question
    return f"Follow-up to the user's earlier question, “{prior}”: {question}"


def classify(
    question: str,
    note_id: uuid.UUID | str | None,
    conversation_history: list[dict[str, str]],
) -> QueryPlan:
    if note_id is not None:
        parsed_id = note_id if isinstance(note_id, uuid.UUID) else uuid.UUID(note_id)
        return QueryPlan(scope="note", note_id=parsed_id, resolved_query=question)
    resolved = resolve_against_history(question, conversation_history) if is_vague_followup(question, conversation_history) else question
    operation = "count" if _COUNT.search(resolved) else "largest" if _LARGEST.search(resolved) else "recent" if _RECENT.search(resolved) else None
    return QueryPlan(scope="library", resolved_query=resolved, operation=operation)
