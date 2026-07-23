# FrelickBot — Python

This branch is the Python-only migration of FrelickBot. The working TypeScript backup remains on the `mmf-bot` branch.

## Runtime

- Python 3.12+
- `main.py` runs the activity listener, DM approval listener, and five-minute live-score updater.
- `frelickbot/real_client.py` handles authenticated Real API requests and generates a fresh request token for every request.
- `frelickbot/command_handler.py` handles bot commands and sends private command responses through configured DM channels.
- `frelickbot/league_services.py` and `frelickbot/sheets.py` read league data from Google Sheets.
- `frelickbot/jobs.py` contains the GOTD, lineup announcement, lineup lock, final-score recap, and daily ranking jobs.

## Install

```bash
python -m pip install -r requirements.txt
```

## Run the bot

```bash
python main.py
```

Railway can use the included `Procfile`:

```text
worker: python main.py
```

## Run scheduled jobs

```bash
python -m frelickbot.jobs gotd
python -m frelickbot.jobs lineup-announcement
python -m frelickbot.jobs lineup-lock
python -m frelickbot.jobs final-scores
python -m frelickbot.jobs daily-score-rankings
```

## Required environment variables

Core Real variables:

- `REAL_SESSION_JSON`
- `REAL_GROUP_ID`
- `REAL_TURNSTILE_TOKEN` when Real requires Turnstile
- `REAL_DM_CHANNELS_JSON`
- `TRANSACTION_DM_CHANNEL_ID`

Google Sheets variables:

- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_SPREADSHEET_ID`
- `LEAGUE_SPREADSHEET_ID`
- `SALARY_SPREADSHEET_ID`
- `SCORES_SPREADSHEET_ID`

Apps Script/job variables:

- `LIVE_SCORE_API_URL`
- `LINEUP_API_URL`
- `TRANSACTION_API_URL`
- `FREE_AGENCY_API_URL`

A local `session.json` and `google-service-account.json` can be used instead of the matching JSON environment variables during local development.
