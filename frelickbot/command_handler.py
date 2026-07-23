from __future__ import annotations

from typing import Any

from frelickbot.real_client import RealClient


def _extract_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(filter(None, (_extract_text(item) for item in value)))
    if isinstance(value, dict):
        if isinstance(value.get("text"), str):
            return value["text"]
        return _extract_text(
            value.get("children") or value.get("content") or value.get("nodes") or []
        )
    return ""


def handle_activity_command(client: RealClient, activity: dict[str, Any]) -> None:
    """Route a Real activity into the Python command system.

    The complete command implementations are being ported from CommandHandler.ts.
    Unknown activity shapes are ignored rather than crashing the polling loop.
    """
    comment = activity.get("comment") or activity.get("data") or activity
    text = _extract_text(comment.get("content") if isinstance(comment, dict) else comment).strip()
    if not text or "$" not in text:
        return

    command_text = text[text.find("$") :].strip()
    command, _, arguments = command_text.partition(" ")
    command = command.lower()

    parent_id = str(
        (comment.get("id") if isinstance(comment, dict) else None)
        or activity.get("commentId")
        or ""
    ).strip()
    group_id = (
        (comment.get("groupId") if isinstance(comment, dict) else None)
        or activity.get("groupId")
    )

    if command in {"$ping", "$test"}:
        if parent_id:
            client.reply_to_comment(parent_id, "FrelickBot is online (Python).", group_id)
        return

    print(f"Python command received: {command} {arguments}".strip())
