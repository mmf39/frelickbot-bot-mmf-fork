from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import gspread
from google.oauth2.service_account import Credentials

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
]


def _load_credentials() -> dict[str, Any]:
    raw = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
    if raw:
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError("GOOGLE_SERVICE_ACCOUNT_JSON contains invalid JSON") from exc

    path = Path.cwd() / "google-service-account.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise RuntimeError("google-service-account.json contains invalid JSON") from exc

    raise RuntimeError(
        "Google credentials were not found. Add GOOGLE_SERVICE_ACCOUNT_JSON in Railway "
        "or keep google-service-account.json locally."
    )


@lru_cache(maxsize=1)
def client() -> gspread.Client:
    credentials = Credentials.from_service_account_info(_load_credentials(), scopes=SCOPES)
    return gspread.authorize(credentials)


def _split_range(a1_range: str) -> tuple[str, str]:
    if "!" not in a1_range:
        return a1_range.strip("'"), "A:Z"
    title, cell_range = a1_range.split("!", 1)
    return title.strip("'"), cell_range


def read_sheet(spreadsheet_id: str, a1_range: str) -> list[list[str]]:
    if not spreadsheet_id:
        raise RuntimeError(f'Spreadsheet ID is missing for range "{a1_range}"')
    title, cell_range = _split_range(a1_range)
    worksheet = client().open_by_key(spreadsheet_id).worksheet(title)
    return worksheet.get(cell_range, value_render_option="FORMATTED_VALUE")


def write_sheet(spreadsheet_id: str, a1_range: str, values: list[list[Any]]) -> None:
    if not spreadsheet_id:
        raise RuntimeError(f'Spreadsheet ID is missing for range "{a1_range}"')
    title, cell_range = _split_range(a1_range)
    worksheet = client().open_by_key(spreadsheet_id).worksheet(title)
    worksheet.update(range_name=cell_range, values=values, value_input_option="USER_ENTERED")


def append_rows(spreadsheet_id: str, sheet_title: str, values: list[list[Any]]) -> None:
    if not values:
        return
    worksheet = client().open_by_key(spreadsheet_id).worksheet(sheet_title.strip("'"))
    worksheet.append_rows(values, value_input_option="USER_ENTERED")
