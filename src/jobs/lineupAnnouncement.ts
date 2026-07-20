import "dotenv/config";

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


/*
 * Replace each example value below with the actual Real username
 * of the GM for that team.
 *
 * Keep the @ at the beginning of every username.
 */
const TEAM_GMS: Record<string, string> = {
  turkeys: "@corbin",
  gusnem: "@bostonsportsfan11",
  thephantoms: "@maliknabers.1",
  illegals: "@cjstroud777",
  pandas: "@dbook",
  superkings: "@sirelmodoggy",
  dreamteam: "@germie",
  badbois: "@imgoingd1",
  scorpions: "@yup_",
  storm: "@creeperpotato",
};

function normalizeTeamName(
  team: string
): string {
  return team
    .toLowerCase()
    .replace(
      /[^a-z0-9]/g,
      ""
    );
}

function getTeamGM(
  team: string
): string | null {
  const normalized =
    normalizeTeamName(team);

  const gm =
    TEAM_GMS[normalized];

  if (!gm) {
    console.warn(
      `No GM username is configured for team: ${team}`
    );

    return null;
  }

  return gm.startsWith("@")
    ? gm
    : `@${gm}`;
}

function getPlayingGMs(
  leagueGames: Array<{
    away: string;
    home: string;
  }>
): string[] {
  const mentions =
    leagueGames.flatMap(
      (game) => [
        getTeamGM(game.away),
        getTeamGM(game.home),
      ]
    );

  return Array.from(
    new Set(
      mentions.filter(
        (mention): mention is string =>
          Boolean(mention)
      )
    )
  );
}

function extractPostedCommentId(
  value: unknown
): string | null {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return null;
  }

  const record =
    value as Record<string, unknown>;

  const possibleIds = [
    record.commentId,
    record.commentID,
    record.id,
  ];

  for (const possibleId of possibleIds) {
    if (
      typeof possibleId === "string" &&
      possibleId.trim()
    ) {
      return possibleId;
    }

    if (
      typeof possibleId === "number" &&
      Number.isFinite(possibleId)
    ) {
      return String(possibleId);
    }
  }

  const nestedValues = [
    record.comment,
    record.data,
    record.result,
    record.content,
    record.response,
  ];

  for (const nestedValue of nestedValues) {
    const nestedId =
      extractPostedCommentId(
        nestedValue
      );

    if (nestedId) {
      return nestedId;
    }
  }

  return null;
}

function getTomorrowEastern(): {
  isoDate: string;
  sheetDate: string;
  displayDate: string;
} {
  const easternDateParts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }
    ).formatToParts(new Date());

  const year = Number(
    easternDateParts.find(
      (part) => part.type === "year"
    )?.value
  );

  const month = Number(
    easternDateParts.find(
      (part) => part.type === "month"
    )?.value
  );

  const day = Number(
    easternDateParts.find(
      (part) => part.type === "day"
    )?.value
  );

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    throw new Error(
      "Could not determine the current Eastern date."
    );
  }

  const tomorrow = new Date(
    Date.UTC(
      year,
      month - 1,
      day + 1
    )
  );

  const tomorrowYear =
    tomorrow.getUTCFullYear();

  const tomorrowMonth =
    tomorrow.getUTCMonth() + 1;

  const tomorrowDay =
    tomorrow.getUTCDate();

  return {
    isoDate:
      `${tomorrowYear}-` +
      `${String(tomorrowMonth).padStart(2, "0")}-` +
      `${String(tomorrowDay).padStart(2, "0")}`,

    sheetDate:
      `${tomorrowMonth}/${tomorrowDay}`,

    displayDate:
      `${tomorrowMonth}/${tomorrowDay}`,
  };
}

async function fetchScheduleForSport(
  sport: LineupLockSport,
  date: string
): Promise<unknown> {
  const url = new URL(
    SCHEDULE_API_URL
  );

  url.searchParams.set(
    "sport",
    sport
  );

  url.searchParams.set(
    "day",
    date
  );

  console.log(
    `Fetching ${sport} schedule for ${date}...`
  );

  const response = await fetch(
    url,
    {
      headers: {
        accept: "application/json",
      },
    }
  );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${sport} schedule: ` +
      `${response.status} ${response.statusText}. ` +
      text.slice(0, 300)
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${sport} schedule did not return valid JSON. ` +
      text.slice(0, 300)
    );
  }
}

function extractScheduleGames(
  data: unknown
): unknown[] {
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
    record.results,
  ];

  for (const value of possibleArrays) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  const possibleNestedObjects = [
    record.content,
    record.data,
    record.result,
    record.response,
  ];

  for (
    const nestedValue of possibleNestedObjects
  ) {
    if (
      typeof nestedValue === "object" &&
      nestedValue !== null
    ) {
      const nestedGames =
        extractScheduleGames(
          nestedValue
        );

      if (nestedGames.length > 0) {
        return nestedGames;
      }
    }
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

  for (
    const value of possibleValues
  ) {
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
  let parsed: Date;

  if (
    typeof value === "number"
  ) {
    parsed =
      value < 10_000_000_000
        ? new Date(value * 1000)
        : new Date(value);
  } else if (
    /^\d+$/.test(value.trim())
  ) {
    const numericValue =
      Number(value);

    parsed =
      numericValue <
      10_000_000_000
        ? new Date(
            numericValue * 1000
          )
        : new Date(
            numericValue
          );
  } else {
    parsed = new Date(value);
  }

  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return null;
  }

  return parsed;
}

async function getEarliestLineupLockGame(
  date: string
): Promise<EarliestGame | null> {
  const results =
    await Promise.allSettled(
      LINEUP_LOCK_SPORTS.map(
        async (sport) => ({
          sport,
          data:
            await fetchScheduleForSport(
              sport,
              date
            ),
        })
      )
    );

  const games: EarliestGame[] =
    [];

  for (
    const result of results
  ) {
    if (
      result.status !==
      "fulfilled"
    ) {
      console.error(
        "Schedule request failed:",
        result.reason
      );

      continue;
    }

    const {
      sport,
      data,
    } = result.value;

    const sportGames =
      extractScheduleGames(data);

    console.log(
      `${sport}: found ${sportGames.length} games.`
    );

    for (
      const rawGame of sportGames
    ) {
      const startValue =
        getGameStartValue(
          rawGame
        );

      if (
        startValue === null
      ) {
        continue;
      }

      const startsAt =
        parseStartDate(
          startValue
        );

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
    (first, second) =>
      first.startsAt.getTime() -
      second.startsAt.getTime()
  );

  return games[0] ?? null;
}

function formatEasternTime(
  date: Date
): string {
  return new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone:
        "America/New_York",
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
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }
    ).formatToParts(date);

  const hour = Number(
    parts.find(
      (part) =>
        part.type === "hour"
    )?.value
  );

  const minute = Number(
    parts.find(
      (part) =>
        part.type === "minute"
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
  } = getEasternHourMinute(
    startsAt
  );

  const display =
    formatEasternTime(
      startsAt
    );

  console.log(
    `Saving lineup lock for ${date}: ${display}`
  );

  const response = await fetch(
    apiUrl,
    {
      method: "POST",

      headers: {
        "content-type":
          "application/json",
      },

      body: JSON.stringify({
        action:
          "setLineupLockTime",
        date,
        hour,
        minute,
        display,
      }),
    }
  );

  const text =
    await response.text();

  let result:
    AppsScriptResponse;

  try {
    result =
      JSON.parse(
        text
      ) as AppsScriptResponse;
  } catch {
    throw new Error(
      "Apps Script returned invalid JSON: " +
      text.slice(0, 300)
    );
  }

  if (
    !response.ok ||
    result.ok !== true
  ) {
    throw new Error(
      result.message ??
        `Apps Script request failed: ${response.status}`
    );
  }

  console.log(
    "Lineup lock time saved."
  );
}

function getTeamEmoji(
  team: string
): string {
  const normalized =
    normalizeTeamName(team);

  const emojis:
    Record<string, string> = {
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

  return (
    emojis[normalized] ??
    "🛡️"
  );
}

export async function postTomorrowGames(
  client: RealClient
): Promise<void> {
  console.log(
    "Starting daily lineup announcement..."
  );

  const tomorrow =
    getTomorrowEastern();

  console.log(
    `Tomorrow's Eastern date: ${tomorrow.isoDate}`
  );

  console.log(
    `Checking RSKL schedule for ${tomorrow.sheetDate}...`
  );

  const leagueGames =
    await getScheduleForDate(
      tomorrow.sheetDate
    );

  console.log(
    `Found ${leagueGames.length} RSKL games.`
  );

  if (
    leagueGames.length === 0
  ) {
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

  const lockTime =
    formatEasternTime(
      earliestGame.startsAt
    );

  console.log(
    `Earliest game is ${earliestGame.sport} at ${lockTime}.`
  );

  await saveLineupLockTime(
    tomorrow.isoDate,
    earliestGame.startsAt
  );

  const gameLines =
    leagueGames.map(
      (game) =>
        `${getTeamEmoji(game.away)} ${game.away} vs ` +
        `${getTeamEmoji(game.home)} ${game.home}`
    );

  const message =
    `📅 Games ${tomorrow.displayDate}\n\n` +
    `${gameLines.join("\n")}\n\n` +
    `Send lineups by posting ` +
    `@rsklbot $lineup by ${lockTime}.`;

  console.log(
    "Posting this message:"
  );

  console.log(message);

  const postedComment =
    await client.postToGroup(
      message
    );

  console.log(
    "Schedule post response:",
    postedComment
  );

  const parentCommentId =
    extractPostedCommentId(
      postedComment
    );

  if (!parentCommentId) {
    throw new Error(
      "The schedule was posted, but its comment ID could not be found. " +
      "Check the logged schedule post response."
    );
  }

  const playingGMs =
    getPlayingGMs(
      leagueGames
    );

  if (playingGMs.length > 0) {
    const gmReply =
      `GMs playing ${tomorrow.displayDate}:\n\n` +
      playingGMs.join(" ");

    console.log(
      "Posting GM reply:"
    );

    console.log(gmReply);

    await client.replyToComment(
      parentCommentId,
      gmReply
    );

    console.log(
      `Replied with ${playingGMs.length} GM mention(s).`
    );
  } else {
    console.warn(
      "No GM usernames were found for the teams playing tomorrow."
    );
  }

  console.log(
    `Posted tomorrow's games for ${tomorrow.isoDate}.`
  );

  console.log(
    `Lineup lock: ${earliestGame.sport} at ${lockTime}.`
  );
}

async function main(): Promise<void> {
  console.log(
    "Starting Railway daily lineup job..."
  );

  const client =
    new RealClient();

  client.loadSession();

  await postTomorrowGames(
    client
  );

  console.log(
    "Railway daily lineup job finished."
  );
}

main().catch(
  (error: unknown) => {
    console.error(
      "Daily lineup announcement failed:",
      error
    );

    process.exit(1);
  }
);
