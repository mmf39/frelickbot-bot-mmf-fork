from __future__ import annotations

import argparse
import os
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import requests

from frelickbot.league_services import get_schedule
from frelickbot.real_client import RealClient

EASTERN = ZoneInfo("America/New_York")


def _today_labels() -> set[str]:
    now = datetime.now(EASTERN)
    return {now.strftime("%-m/%-d"), now.strftime("%m/%d"), now.strftime("%-m/%-d/%Y"), now.strftime("%m/%d/%Y")}


def _client() -> RealClient:
    client = RealClient()
    client.load_session()
    return client


def _post(client: RealClient, text: str, group_id: str | int | None = None) -> None:
    client.post_to_group(text, group_id or os.getenv("REAL_GROUP_ID"))


def game_of_the_day() -> None:
    client = _client()
    games = [game for game in get_schedule() if game.date.strip() in _today_labels()]
    if not games:
        print("No scheduled games today; GOTD post skipped.")
        return
    lines = ["📊 Vote for Game of the Day"]
    for game in games:
        lines.append(f"{game.away} vs {game.home}")
    _post(client, "\n".join(lines))
    print("Game of the Day post sent.")


def lineup_announcement() -> None:
    client = _client()
    games = [game for game in get_schedule() if game.date.strip() in _today_labels()]
    if not games:
        print("No games today; lineup announcement skipped.")
        return
    lines = ["📋 Lineups are due before the first game today."]
    lines.extend(f"{game.away} vs {game.home}" for game in games)
    lines.append("Submit with $lineup [team] @player1 ... captain=@player")
    _post(client, "\n".join(lines))
    print("Lineup announcement sent.")


def _call_job_api(action: str) -> dict[str, Any]:
    url = os.getenv("LINEUP_API_URL") or os.getenv("LIVE_SCORE_API_URL")
    if not url:
        raise RuntimeError("LINEUP_API_URL or LIVE_SCORE_API_URL is missing")
    response = requests.post(url, json={"action": action}, timeout=90)
    response.raise_for_status()
    result = response.json()
    if not result.get("ok"):
        raise RuntimeError(result.get("message") or f"{action} failed")
    return result


def lineup_lock() -> None:
    result = _call_job_api("lockLineups")
    client = _client()
    message = str(result.get("message") or "🔒 Today's lineups are now locked.")
    _post(client, message)
    print(message)


def final_score_recaps() -> None:
    client = _client()
    completed = [
        game
        for game in get_schedule()
        if game.status.strip().lower() in {"complete", "completed"}
        and game.date.strip() in _today_labels()
    ]
    if not completed:
        print("No completed games found for today.")
        return
    for game in completed:
        _post(
            client,
            f"🏁 Final\n{game.away} {game.away_score or '0'} - "
            f"{game.home_score or '0'} {game.home}",
        )
    print(f"Posted {len(completed)} final-score recaps.")


def daily_score_rankings() -> None:
    result = _call_job_api("getDailyScoreRankings")
    rankings = result.get("rankings") or []
    if not rankings:
        print("No daily rankings returned.")
        return
    lines = ["📈 Daily Score Rankings"]
    for index, row in enumerate(rankings[:25], start=1):
        player = row.get("player") or row.get("name") or row.get("user") or "Unknown"
        score = row.get("score") or row.get("value") or 0
        lines.append(f"{index}. {player} — {score}")
    _post(_client(), "\n".join(lines))
    print("Daily rankings posted.")


JOBS = {
    "gotd": game_of_the_day,
    "lineup-announcement": lineup_announcement,
    "lineup-lock": lineup_lock,
    "final-scores": final_score_recaps,
    "daily-score-rankings": daily_score_rankings,
}


def main() -> None:
    parser = argparse.ArgumentParser(description="FrelickBot Python scheduled jobs")
    parser.add_argument("job", choices=sorted(JOBS))
    args = parser.parse_args()
    JOBS[args.job]()


if __name__ == "__main__":
    main()
