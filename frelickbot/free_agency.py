from __future__ import annotations

import os
from typing import Any

import requests

from frelickbot.real_client import RealClient


def handle_free_agency_reply(client: RealClient, activity: dict[str, Any]) -> bool:
    """Handle free-agency approval/rejection replies through the configured Apps Script API."""
    if activity.get("type") != "reply":
        return False

    comment = activity.get("comment") or activity.get("additionalInfo", {}).get("comment") or {}
    text = str(comment.get("text") or comment.get("content") or "").strip().lower()
    if text not in {"approve", "approved", "deny", "denied", "reject", "rejected"}:
        return False

    parent_text = str(
        comment.get("replyingToContent")
        or activity.get("replyingToContent")
        or activity.get("additionalInfo", {}).get("replyingToContent")
        or ""
    )
    if "free agent" not in parent_text.lower() and "waiver" not in parent_text.lower():
        return False

    url = os.getenv("FREE_AGENCY_API_URL") or os.getenv("TRANSACTION_API_URL")
    if not url:
        print("FREE_AGENCY_API_URL is missing; reply was not processed.")
        return False

    approved = text in {"approve", "approved"}
    response = requests.post(
        url,
        json={
            "action": "reviewFreeAgencyRequest",
            "approved": approved,
            "activity": activity,
        },
        timeout=30,
    )
    response.raise_for_status()
    result = response.json()
    if not result.get("ok"):
        raise RuntimeError(result.get("message") or "Free-agency review failed")

    message = str(result.get("message") or ("✅ Free-agency request approved." if approved else "❌ Free-agency request denied."))
    group_id = comment.get("groupId") or activity.get("groupId")
    parent_id = str(comment.get("id") or activity.get("commentId") or "")
    if parent_id:
        client.reply_to_comment(parent_id, message, group_id)
    return True
