"""Coded API errors: `detail` is always {"code": ..., "message": ...} so the UI can branch."""
from fastapi import HTTPException


def api_error(
    status_code: int, code: str, message: str, headers: dict[str, str] | None = None
) -> HTTPException:
    return HTTPException(status_code, detail={"code": code, "message": message}, headers=headers)
