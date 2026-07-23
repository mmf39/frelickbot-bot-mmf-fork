from __future__ import annotations

import json
import os
import re
from datetime import datetime
from typing import Any, Callable
from zoneinfo import ZoneInfo

import requests

from frelickbot.league_services import (
    get_contracts,
    get_draft_capital,
    get_rosters,
    get_schedule,
    get_standings,
    get_transactions,
    matching_team,
    normalize_team,
)
from frelickbot.real_client import RealClient

CAP_LIMIT = 5000
COMMISSIONER_USER_ID = "Y3KdBmLn"
DEFAULT_TRANSACTION_DM_CHANNEL_ID = "2205570"

TEAM_LINEUP_SUBMITTERS: dict[str, list[str]] = {
    "turkeys": ["4JZo9wZv", "R3XDLZz3"],
    "gusnem": ["rner1dZJ"],
    "thephantoms": ["5nxBPRyv"],
    "illegals": ["5nxPZYQn"],
    "thepandas": ["jvbN8dbv"],
    "superkings": ["7JkKrbKJ"],
    "dreamteam": ["dvd60P4n"],
    "badbois": ["xnr4NGkv"],
    "scorpions": ["eJ9dx9bn"],
    "storm": ["mvg4OPG3"],
}

TEAM_DISPLAY_NAMES = {
    "turkeys": "Turkeys",
    "gusnem": "Gus N Em",
    "thephantoms": "The Phantoms",
    "illegals": "Illegals",
    "thepandas": "The Pandas",
    "superkings": "Super Kings",
    "dreamteam": "Dream Team",
    "badbois": "Bad Bois",
    "scorpions": "Scorpions",
    "storm": "Storm",
}

TEAM_EMOJIS = {
    "turkeys": "🦃",
    "gusnem": "💪",
    "storm": "⛈️",
    "yetis": "🏔️",
    "cheerios": "🥣",
    "illegals": "🕶️",
    "thelions": "🦁",
    "thephantoms": "👻",
    "thesnipers": "🎯",
    "thefuture": "🚀",
    "thepandas": "🐼",
    "superkings": "👑",
    "badbois": "😈",
    "dreamteam": "💭",
    "scorpions": "🦂",
    "bullets": "💥",
}


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


def _nested(value: Any, *keys: str) -> Any:
    current = value
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _author_user_id(activity: dict[str, Any]) -> str:
    candidates = [
        _nested(activity, "additionalInfo", "comment", "authorUserId"),
        _nested(activity, "additionalInfo", "comment", "commenterUserId"),
        _nested(activity, "additionalInfo", "comment", "createdByUserId"),
        _nested(activity, "additionalInfo", "comment", "userId"),
        _nested(activity, "comment", "authorUserId"),
        _nested(activity, "comment", "commenterUserId"),
        _nested(activity, "comment", "createdByUserId"),
        _nested(activity, "comment", "userId"),
        _nested(activity, "createdBy", "id"),
        activity.get("createdByUserId"),
        activity.get("authorUserId"),
        activity.get("actorUserId"),
    ]
    for value in candidates:
        text = str(value or "").strip()
        if re.fullmatch(r"[A-Za-z0-9]{8}", text):
            return text
    return ""


def _comment(activity: dict[str, Any]) -> dict[str, Any]:
    for value in (
        _nested(activity, "additionalInfo", "comment"),
        activity.get("comment"),
        activity.get("data"),
    ):
        if isinstance(value, dict):
            return value
    return activity


def _command_text(activity: dict[str, Any]) -> str:
    comment = _comment(activity)
    text = _extract_text(comment.get("content") or comment.get("text") or activity.get("content"))
    if "$" not in text:
        return ""
    return text[text.find("$") :].strip()


def _reply_target(activity: dict[str, Any]) -> tuple[str, str | int | None]:
    comment = _comment(activity)
    parent_id = str(comment.get("id") or activity.get("commentId") or "").strip()
    group_id = comment.get("groupId") or activity.get("groupId") or _nested(activity, "additionalInfo", "groupId")
    return parent_id, group_id


def _dm_channel(user_id: str) -> str:
    raw = os.getenv("REAL_DM_CHANNELS_JSON")
    if raw:
        try:
            mapped = str(json.loads(raw).get(user_id) or "").strip()
            if mapped:
                return mapped
        except (json.JSONDecodeError, AttributeError):
            print("REAL_DM_CHANNELS_JSON contains invalid JSON")
    if user_id == COMMISSIONER_USER_ID:
        return os.getenv("TRANSACTION_DM_CHANNEL_ID", DEFAULT_TRANSACTION_DM_CHANNEL_ID)
    return ""


def _send_response(
    client: RealClient,
    activity: dict[str, Any],
    text: str,
    *,
    public: bool = False,
) -> None:
    user_id = _author_user_id(activity)
    parent_id, group_id = _reply_target(activity)
    if not public:
        channel_id = _dm_channel(user_id)
        if channel_id:
            client.send_channel_message(text, channel_id)
            return
    if parent_id:
        client.reply_to_comment(parent_id, text, group_id)
    else:
        client.post_to_group(text, group_id)


def _fmt_number(value: float | int) -> str:
    return f"{value:,.0f}"


def _team_emoji(team: str) -> str:
    return TEAM_EMOJIS.get(normalize_team(team), "🛡️")


def _parse_date(value: str) -> datetime | None:
    value = value.strip()
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%m/%d"):
        try:
            parsed = datetime.strptime(value, fmt)
            if fmt == "%m/%d":
                parsed = parsed.replace(year=datetime.now(ZoneInfo("America/New_York")).year)
            return parsed
        except ValueError:
            continue
    return None


def _find_team(search: str) -> str | None:
    teams = sorted({roster.team for roster in get_rosters()})
    return matching_team(search, teams)


def _help() -> str:
    return "\n".join(
        [
            "🤖 RSKL Bot Commands",
            "$schedule [team] - upcoming games",
            "$live - games currently in progress",
            "$standings [north|south] - division standings",
            "$roster [team] - team roster",
            "$cap [team] - contracts and remaining cap",
            "$draftcapital [team] - draft picks",
            "$transactions - recent transactions",
            "$lineup [team] @player ... captain=@player - submit lineup",
            "$transaction sign|cut|trade|namechange [details] - submit transaction",
            "$ping - bot status",
        ]
    )


def _schedule(arguments: str) -> str:
    games = get_schedule()
    now = datetime.now(ZoneInfo("America/New_York")).replace(tzinfo=None)
    requested_team = _find_team(arguments) if arguments.strip() else None
    selected = []
    for game in games:
        game_date = _parse_date(game.date)
        if not game_date or game_date.date() < now.date():
            continue
        if requested_team and normalize_team(requested_team) not in {
            normalize_team(game.away),
            normalize_team(game.home),
        }:
            continue
        selected.append((game_date, game))
    selected.sort(key=lambda item: item[0])
    if not selected:
        return "No upcoming games were found."
    lines = [f"📅 {'Upcoming ' + requested_team + ' Games' if requested_team else 'Upcoming Schedule'}"]
    for _, game in selected[:15]:
        status = game.status.strip().lower()
        icon = "📺" if status in {"in progress", "inprogress", "live"} else "🗓️"
        lines.append(
            f"{icon} {game.date}: {_team_emoji(game.away)} {game.away} vs "
            f"{_team_emoji(game.home)} {game.home}"
        )
    return "\n".join(lines)


def _live() -> str:
    games = [
        game
        for game in get_schedule()
        if game.status.strip().lower() in {"in progress", "inprogress", "live"}
    ]
    if not games:
        return "📺 There are no games currently in progress."
    lines = ["📺 Live Games"]
    for game in games:
        score = ""
        if game.away_score or game.home_score:
            score = f" — {game.away_score or '0'} to {game.home_score or '0'}"
        lines.append(
            f"{_team_emoji(game.away)} {game.away} vs {_team_emoji(game.home)} {game.home}{score}"
        )
    return "\n".join(lines)


def _standings(arguments: str) -> str:
    requested = arguments.strip().lower()
    standings = get_standings()
    if requested in {"north", "south"}:
        standings = [row for row in standings if row.division.lower() == requested]
    if not standings:
        return "No standings were found."
    divisions: list[str] = []
    for row in standings:
        if row.division not in divisions:
            divisions.append(row.division)
    sections: list[str] = []
    for division in divisions:
        rows = [row for row in standings if row.division == division]
        lines = [f"🏆 {division} Division", "Team | W-L | GB"]
        for row in rows:
            lines.append(f"{_team_emoji(row.team)} {row.team} | {row.wins}-{row.losses} | {row.gb or '—'}")
        sections.append("\n".join(lines))
    return "\n\n--\n\n".join(sections)


def _roster(arguments: str) -> str:
    rosters = get_rosters()
    team = matching_team(arguments, [row.team for row in rosters])
    if not team:
        return "Team not found. Use $roster [team]."
    roster = next(row for row in rosters if normalize_team(row.team) == normalize_team(team))
    lines = [f"{_team_emoji(roster.team)} {roster.team} Roster"]
    lines.extend(player for player in roster.players)
    return "\n".join(lines) if roster.players else f"{roster.team} has no listed players."


def _cap(arguments: str) -> str:
    contracts = get_contracts()
    teams = sorted({contract.team for contract in contracts})
    team = matching_team(arguments, teams)
    if not team:
        return "Team not found. Use $cap [team]."
    selected = [contract for contract in contracts if normalize_team(contract.team) == normalize_team(team)]
    used = sum(contract.current_cap_hit for contract in selected)
    remaining = CAP_LIMIT - used
    lines = [f"💰 {team} Salary Cap", f"Used: {_fmt_number(used)}", f"Remaining: {_fmt_number(remaining)}"]
    for contract in selected:
        years = int(contract.years_left)
        lines.append(f"{contract.player}: {_fmt_number(contract.current_cap_hit)} ({years} yr{'s' if years != 1 else ''} left)")
    return "\n".join(lines)


def _draft_capital(arguments: str) -> str:
    capital = get_draft_capital()
    team = matching_team(arguments, [row["team"] for row in capital])
    if not team:
        return "Team not found. Use $draftcapital [team]."
    row = next(row for row in capital if normalize_team(row["team"]) == normalize_team(team))
    lines = [f"📝 {team} Draft Capital"]
    lines.extend(f"• {pick}" for pick in row["picks"])
    return "\n".join(lines) if row["picks"] else f"{team} has no listed draft picks."


def _transactions() -> str:
    transactions = get_transactions()[-10:]
    if not transactions:
        return "No transactions were found."
    lines = ["🔄 Recent Transactions"]
    for transaction in reversed(transactions):
        if transaction["team2"]:
            lines.append(
                f"{transaction['date']}: {transaction['team1']} receives {transaction['receive1']}; "
                f"{transaction['team2']} receives {transaction['receive2']}"
            )
        else:
            lines.append(
                f"{transaction['date']}: {transaction['team1']} — {transaction['receive1']}"
            )
    return "\n".join(lines)


def _transaction_team(user_id: str) -> str | None:
    for key, allowed in TEAM_LINEUP_SUBMITTERS.items():
        if user_id in allowed:
            return TEAM_DISPLAY_NAMES.get(key, key)
    return None


def _submit_transaction(user_id: str, arguments: str) -> str:
    match = re.match(r"^(sign|signing|cut|trade|namechange|name-change|name change)\s+(.+)$", arguments.strip(), re.I)
    if not match:
        return "Use $transaction sign|cut|trade|namechange [details]."
    raw_type = re.sub(r"[\s-]+", "", match.group(1).lower())
    transaction_type = "sign" if raw_type == "signing" else raw_type
    team = _transaction_team(user_id)
    if not team:
        return "You are not authorized to submit transactions for a team."
    url = os.getenv("TRANSACTION_API_URL")
    if not url:
        return "TRANSACTION_API_URL is missing."
    response = requests.post(
        url,
        json={
            "action": "createBotTransaction",
            "team": team,
            "transactionType": transaction_type,
            "details": match.group(2).strip(),
            "submittedBy": user_id,
        },
        timeout=30,
    )
    response.raise_for_status()
    result = response.json()
    if not result.get("ok"):
        return str(result.get("message") or "Transaction submission failed.")
    transaction_id = result.get("transactionId") or "Pending"
    return f"✅ Transaction submitted for commissioner approval.\nID: {transaction_id}"


def _submit_lineup(user_id: str, arguments: str) -> str:
    players = re.findall(r"@[A-Za-z0-9_.-]+", arguments)
    team_text = arguments
    if players:
        team_text = arguments[: arguments.find(players[0])].strip()
    team = _find_team(team_text)
    if not team:
        return "Team not found. Use $lineup [team] @player1 ... captain=@player."
    if user_id != COMMISSIONER_USER_ID and user_id not in TEAM_LINEUP_SUBMITTERS.get(normalize_team(team), []):
        return f"You are not authorized to submit the {team} lineup."
    unique_players = list(dict.fromkeys(players))
    if len(unique_players) != 6:
        return f"A lineup must contain exactly 6 unique players. I found {len(unique_players)}."
    captain_match = re.search(r"captain\s*=\s*(@[A-Za-z0-9_.-]+)", arguments, re.I)
    captain = captain_match.group(1) if captain_match else ""
    if not captain or captain not in unique_players:
        return "Choose one of the six players as captain using captain=@player."
    url = os.getenv("LINEUP_API_URL") or os.getenv("LIVE_SCORE_API_URL")
    if not url:
        return "LINEUP_API_URL is missing."
    response = requests.post(
        url,
        json={
            "action": "submitBotLineup",
            "team": team,
            "players": unique_players,
            "captain": captain,
            "submittedBy": user_id,
        },
        timeout=30,
    )
    response.raise_for_status()
    result = response.json()
    if not result.get("ok"):
        return str(result.get("message") or "Lineup submission failed.")
    return f"✅ {team} lineup submitted.\nCaptain: {captain}\n" + "\n".join(unique_players)


COMMANDS: dict[str, Callable[[str], str]] = {
    "$schedule": _schedule,
    "$live": lambda _arguments: _live(),
    "$standings": _standings,
    "$standing": _standings,
    "$roster": _roster,
    "$cap": _cap,
    "$salarycap": _cap,
    "$draftcapital": _draft_capital,
    "$draft": _draft_capital,
    "$transactions": lambda _arguments: _transactions(),
    "$transactionhistory": lambda _arguments: _transactions(),
}


def handle_activity_command(client: RealClient, activity: dict[str, Any]) -> None:
    if activity.get("type") not in {None, "mention", "reply"}:
        return
    session = client.session or {}
    user_id = _author_user_id(activity)
    if user_id and user_id == str(session.get("userId") or ""):
        return

    command_text = _command_text(activity)
    if not command_text:
        return
    command, _, arguments = command_text.partition(" ")
    command = command.lower().strip()
    arguments = arguments.strip()
    print(f"Python command received: {command} {arguments}".strip())

    try:
        if command in {"$ping", "$test"}:
            response = "FrelickBot is online (Python)."
        elif command in {"$help", "$commands"}:
            response = _help()
        elif command in {"$transaction", "$transact"}:
            response = _submit_transaction(user_id, arguments)
        elif command == "$lineup":
            response = _submit_lineup(user_id, arguments)
        elif command in COMMANDS:
            response = COMMANDS[command](arguments)
        else:
            response = f"Unknown command: {command}\nUse $help to see available commands."
        _send_response(client, activity, response)
    except Exception as exc:
        print(f"Command failed ({command}): {exc}")
        _send_response(client, activity, f"❌ Command failed: {exc}")
