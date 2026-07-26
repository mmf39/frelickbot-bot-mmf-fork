import { getSchedule } from "../google/ScheduleService";

type ScheduleGame = Awaited<ReturnType<typeof getSchedule>>[number];

type SubmittedLineup = {
  team?: string;
  submittedTeam?: string;
  submitedTeam?: string;
  "Submited team"?: string;
  "Submitted team"?: string;
  status?: string;
  used?: string;
  usedNot?: string;
  "Used/Not"?: string;
};

type LineupLockTime = {
  hour: number;
  minute: number;
};

const GM_TEAM_BY_USER_ID: Record<string, string> = {
  "4JZo9wZv": "Turkeys",
  R3XDLZz3: "Turkeys",
  rner1dZJ: "Gus N Em",
  "5nxBPRyv": "The Phantoms",
  "5nxPZYQn": "Illegals",
  jvbN8dbv: "The Pandas",
  "7JkKrbKJ": "Super Kings",
  dvd60P4n: "Dream Team",
  qnBmomW3: "Dream Team",
  xnr4NGkv: "Bad Bois",
  eJ9dx9bn: "Scorpions",
  mvg4OPG3: "Storm",
};

function normalizeTeamName(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function getTeamEmoji(team: string): string {
  const emojis: Record<string, string> = {
    turkeys: "🦃",
    gusnem: "💪",
    thephantoms: "👻",
    illegals: "🕶️",
    thepandas: "🐼",
    superkings: "👑",
    dreamteam: "💭",
    badbois: "😈",
    scorpions: "🦂",
    storm: "⛈️",
  };

  return emojis[normalizeTeamName(team)] || "🛡️";
}

function getEasternDateTimeParts(): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const part = (type: string): number =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);

  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

function getEasternToday(): Date {
  const now = getEasternDateTimeParts();
  return new Date(now.year, now.month - 1, now.day);
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function parseScheduleDate(value: string): Date | null {
  const match = String(value || "")
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);

  if (!match) return null;

  let year = match[3]
    ? Number(match[3])
    : getEasternToday().getFullYear();

  if (year < 100) year += 2000;

  const parsed = new Date(year, Number(match[1]) - 1, Number(match[2]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateForApi(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDisplayDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function isCompleted(game: ScheduleGame): boolean {
  const status = String(game.status ?? "").trim().toLowerCase();
  return status === "complete" || status === "completed";
}

function gameIncludesTeam(game: ScheduleGame, team: string): boolean {
  const teamKey = normalizeTeamName(team);
  return (
    normalizeTeamName(game.away) === teamKey ||
    normalizeTeamName(game.home) === teamKey
  );
}

function rowsToObjects(rows: any[]): SubmittedLineup[] {
  if (!rows.length || !Array.isArray(rows[0])) return rows as SubmittedLineup[];

  const headers = rows[0].map((header: unknown) => String(header ?? "").trim());

  return rows.slice(1).map((row: any[]) => {
    const result: Record<string, unknown> = {};

    headers.forEach((header, index) => {
      result[header] = row[index];
    });

    return result as SubmittedLineup;
  });
}

function extractSubmittedLineups(value: any): SubmittedLineup[] {
  const candidates = [
    value?.lineups,
    value?.submittedLineups,
    value?.queuedLineups,
    value?.queue,
    value?.rows,
    value?.values,
    value?.results,
    value?.data,
    value,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return rowsToObjects(candidate);
    if (Array.isArray(candidate?.values)) return rowsToObjects(candidate.values);
    if (Array.isArray(candidate?.rows)) return rowsToObjects(candidate.rows);
  }

  return [];
}

async function callLineupApi(body: Record<string, unknown>): Promise<any> {
  const url = String(process.env.LINEUP_API_URL || "").trim();

  if (!url) {
    throw new Error("LINEUP_API_URL is not configured.");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let result: any;

  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`Lineup API returned invalid JSON: ${text.slice(0, 200)}`);
  }

  if (!response.ok || result?.ok === false) {
    throw new Error(
      result?.message || `Lineup API failed with status ${response.status}.`
    );
  }

  return result;
}

function getLineupTeam(lineup: SubmittedLineup): string {
  return String(
    lineup.team ??
      lineup.submittedTeam ??
      lineup.submitedTeam ??
      lineup["Submitted team"] ??
      lineup["Submited team"] ??
      ""
  ).trim();
}

function isQueuedLineup(lineup: SubmittedLineup): boolean {
  const status = String(
    lineup.status ??
      lineup.used ??
      lineup.usedNot ??
      lineup["Used/Not"] ??
      ""
  )
    .trim()
    .toLowerCase();

  return !status || status === "queued" || status === "not used";
}

function addLineupTeams(
  target: Set<string>,
  value: any,
  queuedOnly = false
): void {
  for (const lineup of extractSubmittedLineups(value)) {
    if (queuedOnly && !isQueuedLineup(lineup)) continue;

    const teamKey = normalizeTeamName(getLineupTeam(lineup));
    if (teamKey) target.add(teamKey);
  }
}

async function getSubmittedTeamKeys(date: string): Promise<Set<string>> {
  const teamKeys = new Set<string>();

  const submittedResult = await callLineupApi({
    action: "getSubmittedLineups",
    date,
    includeQueued: true,
  });

  addLineupTeams(teamKeys, submittedResult);

  try {
    const queuedResult = await callLineupApi({
      action: "getQueuedLineups",
      date,
    });

    addLineupTeams(teamKeys, queuedResult, true);
  } catch (error) {
    console.warn(
      "Queued lineup lookup was unavailable; using the submitted lineup response only:",
      error
    );
  }

  return teamKeys;
}

async function getLineupLockTime(): Promise<LineupLockTime> {
  const result = await callLineupApi({
    action: "getLineupLockTime",
  });

  const hour = Number(result.hour);
  const minute = Number(result.minute);

  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error("The saved lineup lock time is invalid.");
  }

  return { hour, minute };
}

async function getFirstStatusDate(): Promise<Date> {
  const today = getEasternToday();
  const now = getEasternDateTimeParts();
  const lockTime = await getLineupLockTime();
  const currentMinutes = now.hour * 60 + now.minute;
  const lockMinutes = lockTime.hour * 60 + lockTime.minute;

  return currentMinutes >= lockMinutes ? addDays(today, 1) : today;
}

export function isStatusCommand(text: string): boolean {
  return /(?:^|\s)[$@]status(?:\s|$)/i.test(String(text || ""));
}

export async function buildStatusMessage(userId = ""): Promise<string> {
  const schedule = await getSchedule();
  const firstStatusDate = await getFirstStatusDate();
  const firstStatusTime = firstStatusDate.getTime();
  const gmTeam = GM_TEAM_BY_USER_ID[String(userId || "").trim()] || "";

  let upcoming: Array<{ game: ScheduleGame; date: Date }> = schedule.flatMap(
    (game) => {
      const date = parseScheduleDate(String(game.date ?? ""));

      if (!date || date.getTime() < firstStatusTime || isCompleted(game)) {
        return [];
      }

      return [{ game, date }];
    }
  );

  if (gmTeam) {
    upcoming = upcoming.filter(({ game }) => gameIncludesTeam(game, gmTeam));
  }

  upcoming.sort((a, b) => a.date.getTime() - b.date.getTime());

  if (!upcoming.length) {
    return gmTeam
      ? `📅 ${gmTeam} does not have another upcoming game on the schedule.`
      : "📅 There are no upcoming games on the schedule.";
  }

  const nextDate = upcoming[0].date;
  const games = upcoming.filter(
    (item) => item.date.getTime() === nextDate.getTime()
  );

  const apiDate = formatDateForApi(nextDate);
  const submittedTeams = await getSubmittedTeamKeys(apiDate);

  const matchupSections = games.map(({ game }, index) => {
    const awaySubmitted = submittedTeams.has(normalizeTeamName(game.away));
    const homeSubmitted = submittedTeams.has(normalizeTeamName(game.home));

    return [
      `${gmTeam ? "" : `${index + 1}. `}${getTeamEmoji(game.away)} ${game.away} vs ${getTeamEmoji(game.home)} ${game.home}`,
      `${awaySubmitted ? "✅" : "❌"} ${game.away}: ${awaySubmitted ? "Submitted" : "Not submitted"}`,
      `${homeSubmitted ? "✅" : "❌"} ${game.home}: ${homeSubmitted ? "Submitted" : "Not submitted"}`,
    ].join("\n");
  });

  return [
    `${gmTeam ? `📋 ${gmTeam} Game Status` : "📋 Next Game Status"} — ${formatDisplayDate(nextDate)}`,
    "",
    ...matchupSections.flatMap((section, index) =>
      index === matchupSections.length - 1 ? [section] : [section, ""]
    ),
  ].join("\n");
}
