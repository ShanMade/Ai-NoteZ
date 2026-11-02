from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class NoteNotFound(Exception):
    pass


class VersionConflict(Exception):
    def __init__(self, *, current_version: int, current: dict):
        self.current_version = current_version
        self.current = current


class InvalidNoteHierarchy(Exception):
    pass


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(NoteNotFound)
    async def note_not_found_handler(_: Request, __: NoteNotFound) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": "Note not found."})

    @app.exception_handler(VersionConflict)
    async def version_conflict_handler(_: Request, exc: VersionConflict) -> JSONResponse:
        return JSONResponse(
            status_code=409,
            content={"current_version": exc.current_version, "current": exc.current},
        )

    @app.exception_handler(InvalidNoteHierarchy)
    async def invalid_note_hierarchy_handler(_: Request, exc: InvalidNoteHierarchy) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(exc)})
