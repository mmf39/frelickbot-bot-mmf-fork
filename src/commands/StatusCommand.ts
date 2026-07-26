import { getSchedule } from "../google/ScheduleService";

type ScheduleGame = Awaited<ReturnType<typeof getSchedule>>[number];

type SubmittedLineup = {
  team?: string;
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

function getEasternToday(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const part = (type: string): number =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);

  return new Date(part("year"), part("month") - 1, part("day"));
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

function extractSubmittedLineups(value: any): SubmittedLineup[] {
  const candidates = [
    value?.lineups,
    value?.submittedLineups,
    value?.results,
    value?.data,
    value,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

async function getSubmittedTeamKeys(date: string): Promise<Set<string>> {
  const url = String(process.env.LINEUP_API_URL || "").trim();

  if (!url) {
    throw new Error("LINEUP_API_URL is not configured.");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "getSubmittedLineups",
      date,
    }),
  });

  const text = await response.text();
  let result: any;

  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`Lineup API returned invalid JSON: ${text.slice(0, 200)}`);
  }

  if (!response.ok || result?.ok === false) {
    throw new Error(result?.message || `Lineup API failed with status ${response.status}.`);
  }

  return new Set(
    extractSubmittedLineups(result)
      .map((lineup) => normalizeTeamName(String(lineup.team || "")))
      .filter(Boolean)
  );
}

export function isStatusCommand(text: string): boolean {
  return /(?:^|\s)[$@]status(?:\s|$)/i.test(String(text || ""));
}

export async function buildStatusMessage(userId = ""): Promise<string> {
  const schedule = await getSchedule();
  const today = getEasternToday();
  const todayTime = today.getTime();
  const gmTeam = GM_TEAM_BY_USER_ID[String(userId || "").trim()] || "";

  let upcoming = schedule
    .map((game) => ({
      game,
      date: parseScheduleDate(String(game.date ?? "")),
    }))
    .filter(
      (item): item is { game: ScheduleGame; date: Date } =>
        Boolean(item.date) &&
        item.date.getTime() >= todayTime &&
        !isCompleted(item.game)
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
