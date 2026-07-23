from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests
from hashids import Hashids


class RealClient:
    def __init__(self) -> None:
        self.base_url = os.getenv("REAL_API_BASE_URL", "https://web.realapp.com")
        self.session: dict[str, Any] | None = None
        self.http = requests.Session()
        self.http.headers.update(
            {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "real-version": os.getenv("REAL_VERSION", "34"),
                "real-device-type": "desktop_web",
            }
        )
        print("✓ RealClient initialized")

    def load_session(self) -> None:
        railway_session = os.getenv("REAL_SESSION_JSON")
        if railway_session:
            try:
                self.session = json.loads(railway_session)
            except json.JSONDecodeError as exc:
                raise RuntimeError("REAL_SESSION_JSON contains invalid JSON") from exc
            print("✓ Session loaded from Railway variable")
            return

        session_path = Path.cwd() / "session.json"
        if session_path.exists():
            self.session = json.loads(session_path.read_text(encoding="utf-8"))
            print("✓ Session loaded from local file")
            return

        raise RuntimeError(
            "No session found. Add REAL_SESSION_JSON in Railway or keep session.json locally."
        )

    def get_session(self) -> dict[str, Any] | None:
        return self.session

    def _require_session(self) -> dict[str, Any]:
        if not self.session:
            raise RuntimeError("No session has been loaded")
        return self.session

    @staticmethod
    def generate_request_token() -> str:
        salt = os.getenv("HASHIDS_SALT", "realwebapp")
        min_length = int(os.getenv("HASHIDS_MIN_LENGTH", "16"))
        return Hashids(salt=salt, min_length=min_length).encode(int(time.time() * 1000))

    def _headers(self, include_turnstile: bool = False) -> dict[str, str]:
        session = self._require_session()
        headers = {
            "real-auth-info": str(session["authInfo"]),
            "real-device-uuid": str(session["deviceUuid"]),
            "real-request-token": self.generate_request_token(),
            "real-version": os.getenv("REAL_VERSION", "34"),
            "real-device-type": "desktop_web",
            "origin": "https://www.realapp.com",
            "referer": "https://www.realapp.com/",
        }
        if include_turnstile:
            token = os.getenv("REAL_TURNSTILE_TOKEN")
            if not token:
                raise RuntimeError("REAL_TURNSTILE_TOKEN is missing")
            headers["real-turnstile-token"] = token
        return headers

    def get_from_real(self, path: str, params: dict[str, Any] | None = None) -> Any:
        clean = str(path or "").strip()
        if not clean:
            raise ValueError("A Real API path is required.")
        response = self.http.get(
            f"{self.base_url}{clean if clean.startswith('/') else '/' + clean}",
            headers=self._headers(),
            params=params,
            timeout=30,
        )
        response.raise_for_status()
        return response.json()

    def post_to_real(self, path: str, body: Any, include_turnstile: bool = False) -> Any:
        clean = str(path or "").strip()
        if not clean:
            raise ValueError("A Real API path is required.")
        response = self.http.post(
            f"{self.base_url}{clean if clean.startswith('/') else '/' + clean}",
            headers=self._headers(include_turnstile),
            json=body,
            timeout=30,
        )
        response.raise_for_status()
        return response.json()

    def get_user_by_username(self, username: str) -> Any:
        clean = str(username or "").strip().lstrip("@")
        if not clean:
            raise ValueError("Username is required.")
        return self.get_from_real(f"/user/{quote(clean)}")

    def get_player_sport(self, player_id: str | int, sport: str, season: str | int) -> Any:
        return self.get_from_real(
            f"/players/{quote(str(player_id))}/sport/{quote(str(sport).lower())}",
            {"season": season},
        )

    def get_player_season_feed(
        self, player_id: str | int, sport: str, season: str | int, limit: int = 10
    ) -> Any:
        return self.get_from_real(
            f"/players/{quote(str(player_id))}/sport/{quote(str(sport).lower())}/seasonfeed",
            {"limit": limit, "season": season, "view": "recent", "viewFrame": "default"},
        )

    def get_player_box_score(self, box_score_id: str | int) -> Any:
        return self.get_from_real(f"/playerboxscores/{quote(str(box_score_id))}", {"version": 2})

    def get_user_pass_earnings(
        self,
        sport: str,
        season: str | int,
        player_id: str | int,
        player_box_score_id: str | int,
    ) -> Any:
        return self.get_from_real(
            f"/userpassearnings/{quote(sport.lower())}/season/{quote(str(season))}/entity/player/{quote(str(player_id))}",
            {"playerBoxScoreId": str(player_box_score_id)},
        )

    def get_user_passes(self, user_id: str, sport: str, season: str | int) -> Any:
        return self.get_from_real(
            f"/userpasses/{quote(str(user_id))}/passes",
            {"entityType": "player", "season": season, "sport": sport.lower()},
        )

    def post_to_group(
        self,
        text: str,
        group_id: str | int | None = None,
        parent_comment_id: str | None = None,
    ) -> Any:
        resolved = int(group_id or os.getenv("REAL_GROUP_ID", "0"))
        if resolved <= 0:
            raise ValueError("Group ID is missing or invalid")
        message = str(text or "").strip()
        if not message:
            raise ValueError("Cannot post an empty group message.")
        path = f"/comments/groups/{resolved}"
        body = {"groupId": resolved, "text": message, "parentCommentId": parent_comment_id}
        try:
            return self.post_to_real(path, body)
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            if status in {401, 403} and os.getenv("REAL_TURNSTILE_TOKEN"):
                print("Group post rejected; retrying once with Turnstile token.")
                return self.post_to_real(path, body, True)
            raise

    def reply_to_comment(self, parent_comment_id: str, text: str, group_id: str | int | None = None) -> Any:
        return self.post_to_group(text, group_id, parent_comment_id)

    def send_channel_message(self, text: str, channel_id: str | int | None = None) -> Any:
        resolved = str(channel_id or os.getenv("TRANSACTION_DM_CHANNEL_ID", "")).strip()
        if not resolved:
            raise ValueError("TRANSACTION_DM_CHANNEL_ID is missing.")
        message = str(text or "").strip()
        if not message:
            raise ValueError("Cannot send an empty channel message.")
        return self.post_to_real(
            f"/messages/channels/{quote(resolved)}/messages",
            {"text": message, "parentMessageId": None},
        )

    def get_channel_messages(self, channel_id: str | int | None = None) -> Any:
        resolved = str(channel_id or os.getenv("TRANSACTION_DM_CHANNEL_ID", "")).strip()
        if not resolved:
            raise ValueError("TRANSACTION_DM_CHANNEL_ID is missing.")
        return self.get_from_real(f"/messages/channels/{quote(resolved)}/messages")

    def get_activity(self) -> Any:
        return self.get_from_real("/activity")

    def get_karma_feed(self, user_id: str) -> dict[str, float | int]:
        clean = str(user_id or "").strip()
        if not clean:
            return {"val": 0, "rank": 0}
        try:
            response = self.http.get(
                f"https://web.realsports.io/user/{quote(clean)}/karmafeed",
                headers={
                    **self._headers(),
                    "origin": "https://realsports.io",
                    "referer": "https://realsports.io/",
                    "real-version": "27",
                },
                timeout=30,
            )
            response.raise_for_status()
            stats = response.json().get("stats", {})
            return {
                "val": float(stats.get("karmaDelta") or 0),
                "rank": int(stats.get("karmaDayRank") or 0),
            }
        except Exception as exc:
            print(f"Karma fetch failed for {clean}: {exc}")
            return {"val": 0, "rank": 0}
