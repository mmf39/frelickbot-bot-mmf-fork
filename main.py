from __future__ import annotations

import os
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any

import requests
from dotenv import load_dotenv

from frelickbot.command_handler import handle_activity_command
from frelickbot.free_agency import handle_free_agency_reply
from frelickbot.real_client import RealClient

load_dotenv()

TRANSACTION_CHANNEL_ID = "2205570"
COMMISSIONER_USER_ID = "Y3KdBmLn"
TRANSACTION_GROUP_ID = "30139"
LIVE_SCORE_INTERVAL_SECONDS = 300


def extract_message_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(filter(None, (extract_message_text(item) for item in value)))
    if not isinstance(value, dict):
        return ""
    if isinstance(value.get("text"), str):
        return value["text"]
    children = value.get("children") or value.get("content") or value.get("nodes") or []
    text = extract_message_text(children)
    return f"{text}\n" if value.get("type") in {"paragraph", "Paragraph"} else text


def find_transaction_id(text: str) -> str:
    match = re.search(r"TX-\d{8}-\d{3}", text, re.I)
    return match.group(0).upper() if match else ""


def format_transaction_type(value: str) -> str:
    cleaned = str(value or "").strip().lower()
    return {
        "sign": "Signing",
        "cut": "Cut",
        "trade": "Trade",
        "namechange": "Name Change",
    }.get(cleaned, cleaned[:1].upper() + cleaned[1:] if cleaned else "Transaction")


def approve_transaction(transaction_id: str) -> dict[str, Any]:
    url = os.getenv("TRANSACTION_API_URL")
    if not url:
        raise RuntimeError("TRANSACTION_API_URL is missing.")
    response = requests.post(
        url,
        json={
            "action": "approveBotTransaction",
            "transactionId": transaction_id,
            "reviewedBy": COMMISSIONER_USER_ID,
            "reviewedAt": datetime.now(timezone.utc).isoformat(),
        },
        timeout=30,
    )
    response.raise_for_status()
    result = response.json()
    if not result.get("ok"):
        raise RuntimeError(result.get("message") or "Approval failed.")
    return result


def update_live_scores(client: RealClient) -> None:
    url = os.getenv("LIVE_SCORE_API_URL")
    if not url:
        print("LIVE_SCORE_API_URL is missing; live-score updater disabled.")
        return
    try:
        separator = "&" if "?" in url else "?"
        response = requests.get(f"{url}{separator}action=getLiveScoreUsers", timeout=30)
        response.raise_for_status()
        data = response.json()
        users = data.get("users") or []
        scores = []
        for start in range(0, len(users), 5):
            for user in users[start : start + 5]:
                karma = client.get_karma_feed(str(user.get("userId", "")))
                scores.append({"userId": user.get("userId"), **karma})
                print(f"{user.get('player') or user.get('userId')}: {karma['val']} | Rank {karma['rank']}")
            if start + 5 < len(users):
                time.sleep(0.5)
        saved_response = requests.post(
            url,
            json={
                "action": "saveLiveScoresAndRefresh",
                "leagueDate": data.get("leagueDate"),
                "scores": scores,
            },
            timeout=60,
        )
        saved_response.raise_for_status()
        saved = saved_response.json()
        if not saved.get("ok"):
            raise RuntimeError(saved.get("message") or "Live-score save failed")
        print(f"✅ Live scores updated. {saved.get('saved', 0)} scores saved.")
    except Exception as exc:
        print(f"Live-score update failed: {exc}")


def live_score_loop(client: RealClient) -> None:
    while True:
        update_live_scores(client)
        time.sleep(LIVE_SCORE_INTERVAL_SECONDS)


def handle_activity(client: RealClient, activity: dict[str, Any]) -> None:
    if activity.get("type") not in {"mention", "reply"}:
        return
    if activity.get("type") == "reply" and handle_free_agency_reply(client, activity):
        return
    handle_activity_command(client, activity)


def main() -> None:
    client = RealClient()
    client.load_session()
    threading.Thread(target=live_score_loop, args=(client,), daemon=True).start()

    print("==========================")
    print("FrelickBot Started (Python)")
    print("==========================")

    seen_activity_ids: set[str] = set()
    seen_message_ids: set[str] = set()

    try:
        for activity in client.get_activity().get("activities", []):
            seen_activity_ids.add(str(activity.get("id")))
    except Exception as exc:
        print(f"Failed to load initial activity: {exc}")

    try:
        for message in client.get_channel_messages(TRANSACTION_CHANNEL_ID).get("messages", []):
            seen_message_ids.add(str(message.get("id")))
    except Exception as exc:
        print(f"Failed to load initial DM messages: {exc}")

    while True:
        try:
            for activity in client.get_activity().get("activities", []):
                activity_id = str(activity.get("id"))
                if activity_id in seen_activity_ids:
                    continue
                seen_activity_ids.add(activity_id)
                handle_activity(client, activity)
        except Exception as exc:
            print(f"Activity polling error: {exc}")

        try:
            messages = client.get_channel_messages(TRANSACTION_CHANNEL_ID).get("messages", [])
            for message in reversed(messages):
                message_id = str(message.get("id"))
                if message_id in seen_message_ids:
                    continue
                seen_message_ids.add(message_id)
                text = extract_message_text(message.get("content")).strip()
                if str(message.get("userId")) != COMMISSIONER_USER_ID or text.lower() != "approved":
                    continue
                transaction_id = find_transaction_id(extract_message_text(message.get("replyingToContent")))
                approved = approve_transaction(transaction_id)
                team = str(approved.get("team") or "Unknown Team").strip()
                transaction_type = format_transaction_type(str(approved.get("transactionType") or ""))
                details = str(approved.get("details") or "").strip()
                client.post_to_group(
                    f"✅ {team} Transaction\n{team} {transaction_type} {details}".strip(),
                    TRANSACTION_GROUP_ID,
                )
        except Exception as exc:
            print(f"DM polling error: {exc}")

        time.sleep(2)


if __name__ == "__main__":
    main()
