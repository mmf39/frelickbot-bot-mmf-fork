from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any

from frelickbot.sheets import read_sheet


def clean(value: Any) -> str:
    return str(value or "").strip()


def number(value: Any) -> float:
    text = re.sub(r"[^\d.\-]", "", clean(value).replace(",", ""))
    try:
        return float(text)
    except (TypeError, ValueError):
        return 0.0


def normalize_team(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", clean(value).lower().replace("@rsklbot", ""))


@dataclass(slots=True)
class ScheduledGame:
    date: str
    away: str
    home: str
    away_score: str = ""
    home_score: str = ""
    status: str = ""


@dataclass(slots=True)
class TeamRoster:
    team: str
    players: list[str]


@dataclass(slots=True)
class PlayerContract:
    team: str
    player: str
    contract_years: float
    years_left: float
    total_rax: float
    rax_per_season: float
    current_cap_hit: float
    options_notes: str
    clauses: str


@dataclass(slots=True)
class Standing:
    division: str
    team: str
    gp: int
    wins: int
    losses: int
    gb: str
    win_pct: str


def league_spreadsheet_id() -> str:
    return clean(os.getenv("LEAGUE_SPREADSHEET_ID") or os.getenv("GOOGLE_SPREADSHEET_ID"))


def get_schedule() -> list[ScheduledGame]:
    spreadsheet_id = clean(os.getenv("GOOGLE_SPREADSHEET_ID") or os.getenv("LEAGUE_SPREADSHEET_ID"))
    rows = read_sheet(spreadsheet_id, "Schedule!A:F")
    return [
        ScheduledGame(
            date=clean(row[0] if len(row) > 0 else ""),
            away=clean(row[1] if len(row) > 1 else ""),
            home=clean(row[2] if len(row) > 2 else ""),
            away_score=clean(row[3] if len(row) > 3 else ""),
            home_score=clean(row[4] if len(row) > 4 else ""),
            status=clean(row[5] if len(row) > 5 else ""),
        )
        for row in rows[1:]
        if len(row) >= 3 and clean(row[0]) and clean(row[1]) and clean(row[2])
    ]


def get_rosters() -> list[TeamRoster]:
    rows = read_sheet(league_spreadsheet_id(), "Teams!A:Z")
    rosters: list[TeamRoster] = []
    max_columns = max((len(row) for row in rows), default=0)

    def cell(row_index: int, column_index: int) -> str:
        if row_index >= len(rows) or column_index >= len(rows[row_index]):
            return ""
        return clean(rows[row_index][column_index])

    def team_header(row_index: int, column_index: int) -> bool:
        return bool(cell(row_index, column_index)) and bool(
            re.match(r"^gm\s*=", cell(row_index + 1, column_index), re.I)
        )

    for column_index in range(max_columns):
        row_index = 0
        while row_index < len(rows):
            if not team_header(row_index, column_index):
                row_index += 1
                continue
            team = cell(row_index, column_index)
            players: list[str] = []
            row_index += 2
            while row_index < len(rows) and not team_header(row_index, column_index):
                value = cell(row_index, column_index)
                if value.startswith("@"):
                    players.append(value)
                row_index += 1
            rosters.append(TeamRoster(team=team, players=players))
    return rosters


def get_contracts() -> list[PlayerContract]:
    spreadsheet_id = clean(os.getenv("SALARY_SPREADSHEET_ID"))
    rows = read_sheet(spreadsheet_id, "'Entire Leage'!A:L")
    contracts: list[PlayerContract] = []
    for row in rows[1:]:
        padded = row + [""] * max(0, 12 - len(row))
        if not clean(padded[0]) or not clean(padded[1]):
            continue
        contracts.append(
            PlayerContract(
                team=clean(padded[0]),
                player=clean(padded[1]),
                contract_years=number(padded[2]),
                years_left=number(padded[3]),
                total_rax=number(padded[4]),
                rax_per_season=number(padded[5]),
                current_cap_hit=number(padded[7]),
                options_notes=clean(padded[8]),
                clauses=clean(padded[11]),
            )
        )
    return contracts


def get_standings() -> list[Standing]:
    rows = read_sheet(league_spreadsheet_id(), "Standings!A:G")
    standings: list[Standing] = []
    division = ""
    for row in rows:
        padded = row + [""] * max(0, 7 - len(row))
        if clean(padded[1]) in {"North", "South"}:
            division = clean(padded[1])
            continue
        if clean(padded[1]) in {"", "Team"}:
            continue
        standings.append(
            Standing(
                division=division,
                team=clean(padded[1]),
                gp=int(number(padded[2])),
                wins=int(number(padded[3])),
                losses=int(number(padded[4])),
                gb=clean(padded[5]),
                win_pct=clean(padded[6]),
            )
        )
    return standings


def get_draft_capital() -> list[dict[str, Any]]:
    rows = read_sheet(league_spreadsheet_id(), "'Draft Capital'!A:Z")
    return [
        {"team": clean(row[0]), "picks": [clean(value) for value in row[1:] if clean(value)]}
        for row in rows
        if row and clean(row[0])
    ]


def get_transactions() -> list[dict[str, str]]:
    rows = read_sheet(league_spreadsheet_id(), "Transactions!A:E")
    output: list[dict[str, str]] = []
    for row in rows[2:]:
        padded = row + [""] * max(0, 5 - len(row))
        if not clean(padded[0]):
            continue
        output.append(
            {
                "date": clean(padded[0]),
                "team1": clean(padded[1]),
                "receive1": clean(padded[2]),
                "team2": clean(padded[3]),
                "receive2": clean(padded[4]),
            }
        )
    return output


def matching_team(search: str, teams: list[str]) -> str | None:
    normalized = normalize_team(search)
    exact = next((team for team in teams if normalize_team(team) == normalized), None)
    if exact:
        return exact
    partial = [
        team
        for team in teams
        if normalized in normalize_team(team) or normalize_team(team) in normalized
    ]
    return partial[0] if len(partial) == 1 else None
