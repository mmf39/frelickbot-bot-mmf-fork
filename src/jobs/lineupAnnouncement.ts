import cron from "node-cron";
import { RealClient } from "../core/RealClient";
import { getScheduleForDate } from "../google/ScheduleService";

const SCHEDULE_API_URL =
  "https://schedule.tommyek67.workers.dev/";

const LINEUP_LOCK_SPORTS = [
  "mlb",
  "nfl",
  "wnba",
  "ufc",
  "ncaaf",
  "nhl",
  "nba",
  "ncaam",
  "ncaabb",
] as const;

type LineupLockSport =
  (typeof LINEUP_LOCK_SPORTS)[number];

interface EarliestGame {
  sport: LineupLockSport;
  startsAt: Date;
  rawGame: unknown;
}

interface AppsScriptResponse {
  ok?: boolean;
  message?: string;
}

function getTomorrowEastern(): {
  isoDate: string;
  sheetDate: string;
  displayDate: string;
} {
  const easternNowText = new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }
  ).format(new Date());

  const [
    datePart,
    timePart,
  ] = easternNowText.split(", ");

  const easternNow = new Date(
    `${datePart}T${timePart}`
  );

  easternNow.setDate(easternNow.getDate() + 1);

  const year = easternNow.getFullYear();
  const month = String(
    easternNow.getMonth() + 1
  ).padStart(2, "0");
  const day = String(
    easternNow.getDate()
  ).padStart(2, "0");

  return {
    isoDate: `${year}-${month}-${day}`,
    sheetDate:
      `${Number(month)}/${Number(day)}`,
    displayDate:
      `${Number(month)}/${Number(day)}`,
  };
}

async function fetchScheduleForSport(
  sport: LineupLockSport,
  date: string
): Promise<unknown> {
  const url = new URL(SCHEDULE_API_URL);

  url.searchParams.set("sport", sport);
  url.searchParams.set("day", date);

  const response = await fetch(url, {
    headers: {
      accept: "*/*",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${sport} schedule: ` +
      `${response.status} ${response.statusText}`
    );
  }

  const contentType =
    response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${sport} schedule did not return valid JSON.`
    );
  }
}

function extractScheduleGames(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }

  if (
    typeof data !== "object" ||
    data === null
  ) {
    return [];
  }

  const record =
    data as Record<string, unknown>;

  const possibleArrays = [
    record.games,
    record.events,
    record.schedule,
    record.data,
    record.results,
  ];

  for (const value of possibleArrays) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  if (
    typeof record.data === "object" &&
    record.data !== null
  ) {
    return extractScheduleGames(record.data);
  }

  return [];
}

function getGameStartValue(
  game: unknown
): string | number | null {
  if (
    typeof game !== "object" ||
    game === null
  ) {
    return null;
  }

  const record =
    game as Record<string, unknown>;

  const possibleValues = [
    record.startsAt,
    record.startTime,
    record.startDate,
    record.scheduledAt,
    record.dateTime,
    record.datetime,
    record.timestamp,
    record.gameTime,
    record.start,
  ];

  for (const value of possibleValues) {
    if (
      typeof value === "string" ||
      typeof value === "number"
    ) {
      return value;
    }
  }

  return null;
}

function parseStartDate(
  value: string | number
): Date | null {
  const parsed =
    typeof value === "number" &&
    value < 10_000_000_000
      ? new Date(value * 1000)
      : new Date(value);

  return Number.isNaN(parsed.getTime())
    ? null
    : parsed;
}

async function getEarliestLineupLockGame(
  date: string
): Promise<EarliestGame | null> {
  const results = await Promise.allSettled(
    LINEUP_LOCK_SPORTS.map(
      async (sport) => ({
        sport,
        data: await fetchScheduleForSport(
          sport,
          date
        ),
      })
    )
  );

  const games: EarliestGame[] = [];

  for (const result of results) {
    if (result.status !== "fulfilled") {
      console.error(
        "Schedule request failed:",
        result.reason
      );
      continue;
    }

    const { sport, data } = result.value;
    const sportGames =
      extractScheduleGames(data);

    for (const rawGame of sportGames) {
      const startValue =
        getGameStartValue(rawGame);

      if (startValue === null) {
        continue;
      }

      const startsAt =
        parseStartDate(startValue);

      if (!startsAt) {
        continue;
      }

      games.push({
        sport,
        startsAt,
        rawGame,
      });
    }
  }

  games.sort(
    (a, b) =>
      a.startsAt.getTime() -
      b.startsAt.getTime()
  );

  return games[0] ?? null;
}

function formatEasternTime(date: Date): string {
  return new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }
  ).format(date);
}

function getEasternHourMinute(
  date: Date
): {
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }
  ).formatToParts(date);

  const hour = Number(
    parts.find(
      (part) => part.type === "hour"
    )?.value
  );

  const minute = Number(
    parts.find(
      (part) => part.type === "minute"
    )?.value
  );

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    throw new Error(
      "Could not convert lock time to Eastern Time."
    );
  }

  return {
    hour,
    minute,
  };
}

async function saveLineupLockTime(
  date: string,
  startsAt: Date
): Promise<void> {
  const apiUrl =
    process.env.LINEUP_API_URL;

  if (!apiUrl) {
    throw new Error(
      "LINEUP_API_URL is missing."
    );
  }

  const {
    hour,
    minute,
  } = getEasternHourMinute(startsAt);

  const display =
    formatEasternTime(startsAt);

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "setLineupLockTime",
      date,
      hour,
      minute,
      display,
    }),
  });

  const text = await response.text();

  let result: AppsScriptResponse;

  try {
    result =
      JSON.parse(text) as AppsScriptResponse;
  } catch {
    throw new Error(
      "Apps Script returned invalid JSON."
    );
  }

  if (!response.ok || result.ok !== true) {
    throw new Error(
      result.message ??
      `Apps Script request failed: ${response.status}`
    );
  }
}

function getTeamEmoji(team: string): string {
  const normalized = team
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  const emojis: Record<string, string> = {
    turkeys: "🦃",
    gusnem: "💪",
    thephantoms: "👻",
    illegals: "🕶️",
    pandas: "🐼",
    superkings: "👑",
    dreamteam: "💭",
    badbois: "😈",
    scorpions: "🦂",
    storm: "⛈️",
  };

  return emojis[normalized] ?? "🛡️";
}

async function postTomorrowGames(
  client: RealClient
): Promise<void> {
  const tomorrow =
    getTomorrowEastern();

  const leagueGames =
    await getScheduleForDate(
      tomorrow.sheetDate
    );

  if (leagueGames.length === 0) {
    console.log(
      `No RSKL games scheduled for ${tomorrow.sheetDate}.`
    );
    return;
  }

  const earliestGame =
    await getEarliestLineupLockGame(
      tomorrow.isoDate
    );

  if (!earliestGame) {
    console.log(
      `No eligible sports games found for ${tomorrow.isoDate}.`
    );
    return;
  }

  await saveLineupLockTime(
    tomorrow.isoDate,
    earliestGame.startsAt
  );

  const lockTime =
    formatEasternTime(
      earliestGame.startsAt
    );

  const gameLines = leagueGames.map(
    (game) =>
      `${getTeamEmoji(game.away)} ${game.away} vs ` +
      `${getTeamEmoji(game.home)} ${game.home}`
  );

  const message =
    `📅 Games ${tomorrow.displayDate}\n\n` +
    `${gameLines.join("\n")}\n\n` +
    `Send lineups by posting ` +
    `@rsklbot $lineup by ${lockTime}.`;

  await client.postToGroup(message);

  console.log(
    `Posted tomorrow's games for ${tomorrow.isoDate}.`
  );

  console.log(
    `Lineup lock: ${earliestGame.sport} at ${lockTime}.`
  );
}

export function startDailyLineupAnnouncement(
  client: RealClient
): void {
  cron.schedule(
    "0 21 * * *",
    async () => {
      try {
        await postTomorrowGames(client);
      } catch (error) {
        console.error(
          "Daily lineup announcement failed:",
          error
        );
      }
    },
    {
      timezone: "America/New_York",
    }
  );

  console.log(
    "✓ Daily lineup announcement scheduled for 9:00 PM ET"
  );
}
