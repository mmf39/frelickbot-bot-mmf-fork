import { getSchedule } from "./google/ScheduleService";
import { getRosters } from "./google/RostersService";
import { getContracts } from "./google/SalaryCapService";

const CAP_LIMIT = 5000;

const LINEUP_ADMIN_USER_IDS = ["Y3KdBmLn"];

const TEAM_LINEUP_SUBMITTER_USER_IDS: Record<string, string[]> = {
  turkeys: ["4JZo9wZv","R3XDLZz3"],
  gusnem: ["rner1dZJ"],
  thephantoms: ["5nxBPRyv"],
  illegals: ["5nxPZYQn"],
  thepandas: ["jvbN8dbv"],
  superkings: ["7JkKrbKJ"],
  dreamteam: ["dvd60P4n","qnBmomW3"],
  badbois: ["xnr4NGkv"],
  scorpions: ["eJ9dx9bn"],
  storm: ["mvg4OPG3"],
};

const TEAM_DISPLAY_NAMES: Record<string, string> = {
  turkeys: "Turkeys",
  gusnem: "Gus N Em",
  thephantoms: "The Phantoms",
  illegals: "Illegals",
  thepandas: "The Pandas",
  superkings: "Super Kings",
  dreamteam: "Dream Team",
  badbois: "Bad Bois",
  scorpions: "Scorpions",
  storm: "Storm",
};

function getTransactionTeamForUserId(userId: string): string | null {
  for (const [teamKey, allowedUserIds] of Object.entries(
    TEAM_LINEUP_SUBMITTER_USER_IDS
  )) {
    if (allowedUserIds.includes(userId)) {
      return TEAM_DISPLAY_NAMES[teamKey] ?? teamKey;
    }
  }

  return null;
}

const DIVISIONS: Record<string, string[]> = {
  north: [
    "Turkeys",
    "Gus N Em",
    "The Phantoms",
    "Illegals",
    "The Pandas",
  ],
  south: [
    "Super Kings",
    "Dream Team",
    "Bad Bois",
    "Scorpions",
    "Storm",
  ],
};

function normalizeTeamName(value: string): string {
  return value
    .toLowerCase()
    .replace(/^@rsklbot\s*/i, "")
    .replace(/[^a-z0-9]/g, "");
}

function displayPlayerName(name: string): string {
  return name.replace(/^@/, "");
}



function getSubmittingUserId(activity: any): string {
  // Only check fields that describe the author of the comment.
  // Do not use activity.userId because that can be the mentioned user's name.
  const directAuthorIds = [
    activity.additionalInfo?.comment?.authorUserId,
    activity.additionalInfo?.comment?.commenterUserId,
    activity.additionalInfo?.comment?.createdByUserId,
    activity.additionalInfo?.comment?.userId,
    activity.additionalInfo?.comment?.author?.id,
    activity.additionalInfo?.comment?.user?.id,

    activity.comment?.authorUserId,
    activity.comment?.commenterUserId,
    activity.comment?.createdByUserId,
    activity.comment?.userId,
    activity.comment?.author?.id,
    activity.comment?.user?.id,

    activity.authorUserId,
    activity.commenterUserId,
    activity.createdByUserId,
    activity.actorUserId,
    activity.author?.id,
    activity.actor?.id,
  ];

  const directMatch = directAuthorIds
    .map((value) => String(value ?? "").trim())
    .find((value) => /^[A-Za-z0-9]{8}$/.test(value));

  if (directMatch) {
    console.log(
      "Comment author Real user ID:",
      directMatch
    );
    return directMatch;
  }

  // Fallback: recursively search only author-specific property names.
  const authorKeys = new Set([
    "authorUserId",
    "commenterUserId",
    "createdByUserId",
    "actorUserId",
    "senderUserId",
    "ownerUserId",
  ]);

  const visited = new Set<any>();

  function findAuthorId(value: any): string {
    if (
      value === null ||
      value === undefined ||
      typeof value !== "object" ||
      visited.has(value)
    ) {
      return "";
    }

    visited.add(value);

    for (const [key, child] of Object.entries(value)) {
      if (authorKeys.has(key)) {
        const candidate = String(child ?? "").trim();

        if (/^[A-Za-z0-9]{8}$/.test(candidate)) {
          console.log(
            `Comment author ID found at ${key}:`,
            candidate
          );
          return candidate;
        }
      }
    }

    for (const child of Object.values(value)) {
      const found = findAuthorId(child);

      if (found) {
        return found;
      }
    }

    return "";
  }

  const recursiveMatch = findAuthorId(activity);

  if (recursiveMatch) {
    return recursiveMatch;
  }

  console.log(
    "Could not find the comment author's Real user ID. Full activity:",
    JSON.stringify(activity)
  );

  return "";
}

function canSubmitLineupForTeam(
  userId: string,
  team: string
): boolean {
  if (!userId) {
    return false;
  }

  if (LINEUP_ADMIN_USER_IDS.includes(userId)) {
    return true;
  }

  const allowedUserIds =
    TEAM_LINEUP_SUBMITTER_USER_IDS[
      normalizeTeamName(team)
    ] ?? [];

  return allowedUserIds.includes(userId);
}

function parseScore(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const cleaned = String(value)
    .replace(/,/g, "")
    .trim();

  const score = Number(cleaned);

  return Number.isFinite(score) ? score : null;
}

function getEasternYear(): number {
  const year = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
  }).format(new Date());

  return Number(year);
}

function getEasternToday(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const getPart = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return new Date(
    getPart("year"),
    getPart("month") - 1,
    getPart("day")
  );
}

function parseScheduleDate(value: string): Date | null {
  const match = value
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);

  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const day = Number(match[2]);

  let year = match[3] ? Number(match[3]) : getEasternYear();

  if (year < 100) {
    year += 2000;
  }

  return new Date(year, month - 1, day);
}

function formatDateForApi(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function isSameCalendarDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getOpponentForTeamOnDate(
  schedule: Awaited<ReturnType<typeof getSchedule>>,
  team: string,
  selectedDate: Date
): string | null {
  const game = schedule.find((item) => {
    const gameDate = parseScheduleDate(String(item.date ?? ""));

    if (!gameDate || !isSameCalendarDate(gameDate, selectedDate)) {
      return false;
    }

    return (
      normalizeTeamName(item.away) === normalizeTeamName(team) ||
      normalizeTeamName(item.home) === normalizeTeamName(team)
    );
  });

  if (!game) {
    return null;
  }

  return normalizeTeamName(game.away) === normalizeTeamName(team)
    ? game.home
    : game.away;
}

function formatScore(score: number): string {
  return score.toLocaleString("en-US");
}

function findMatchingTeam(
  searchText: string,
  availableTeams: string[]
): string | null {
  const search = normalizeTeamName(searchText);

  if (!search) {
    return null;
  }

  const exactMatch = availableTeams.find(
    (team) => normalizeTeamName(team) === search
  );

  if (exactMatch) {
    return exactMatch;
  }

  const partialMatches = availableTeams.filter((team) => {
    const normalizedTeam = normalizeTeamName(team);

    return (
      normalizedTeam.includes(search) ||
      search.includes(normalizedTeam)
    );
  });

  if (partialMatches.length === 1) {
    return partialMatches[0];
  }

  return null;
}

function getTeamEmoji(team: string): string {
  switch (normalizeTeamName(team)) {
    case "turkeys":
      return "🦃";
    case "gusnem":
      return "💪";
    case "storm":
      return "⛈️";
    case "yetis":
      return "🏔️";
    case "cheerios":
      return "🥣";
    case "illegals":
      return "🕶️";
    case "thelions":
      return "🦁";
    case "thephantoms":
      return "👻";
    case "thesnipers":
      return "🎯";
    case "thefuture":
      return "🚀";
    case "thepandas":
      return "🐼";
    case "superkings":
      return "👑";
    case "badbois":
      return "😈";
    case "dreamteam":
      return "💭";
    case "scorpions":
      return "🦂";
    case "bullets":
      return "💥";
    default:
      return "🛡️";
  }
}


type DivisionStanding = {
  team: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  differential: number;
  gamesPlayed: number;
  winPercentage: number;
  gamesBehind: number;
};

function buildDivisionStandings(
  schedule: Awaited<ReturnType<typeof getSchedule>>,
  divisionTeams: string[]
): DivisionStanding[] {
  const standings = divisionTeams.map((team) => ({
    team,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    differential: 0,
    gamesPlayed: 0,
    winPercentage: 0,
    gamesBehind: 0,
  }));

  const standingByTeam = new Map(
    standings.map((standing) => [
      normalizeTeamName(standing.team),
      standing,
    ])
  );

  for (const game of schedule) {
    const status = String(game.status ?? "")
      .trim()
      .toLowerCase();

    if (status !== "completed" && status !== "complete") {
      continue;
    }

    const awayScore = parseScore(game.awayScore);
    const homeScore = parseScore(game.homeScore);

    if (awayScore === null || homeScore === null) {
      continue;
    }

    const awayStanding = standingByTeam.get(
      normalizeTeamName(game.away)
    );

    const homeStanding = standingByTeam.get(
      normalizeTeamName(game.home)
    );

    if (awayStanding) {
      awayStanding.gamesPlayed++;
      awayStanding.pointsFor += awayScore;
      awayStanding.pointsAgainst += homeScore;

      if (awayScore > homeScore) {
        awayStanding.wins++;
      } else if (awayScore < homeScore) {
        awayStanding.losses++;
      } else {
        awayStanding.ties++;
      }
    }

    if (homeStanding) {
      homeStanding.gamesPlayed++;
      homeStanding.pointsFor += homeScore;
      homeStanding.pointsAgainst += awayScore;

      if (homeScore > awayScore) {
        homeStanding.wins++;
      } else if (homeScore < awayScore) {
        homeStanding.losses++;
      } else {
        homeStanding.ties++;
      }
    }
  }

  for (const standing of standings) {
    standing.differential =
      standing.pointsFor - standing.pointsAgainst;

    standing.winPercentage =
      standing.gamesPlayed > 0
        ? (standing.wins + standing.ties * 0.5) /
          standing.gamesPlayed
        : 0;
  }

  standings.sort(
    (a, b) =>
      b.wins - a.wins ||
      b.winPercentage - a.winPercentage ||
      b.differential - a.differential ||
      b.pointsFor - a.pointsFor ||
      a.team.localeCompare(b.team)
  );

  const leader = standings[0];

  for (const standing of standings) {
    standing.gamesBehind = leader
      ? (
          (leader.wins + leader.ties * 0.5) -
          (standing.wins + standing.ties * 0.5) +
          (standing.losses + standing.ties * 0.5) -
          (leader.losses + leader.ties * 0.5)
        ) / 2
      : 0;
  }

  return standings;
}

function formatDivisionStandings(
  divisionName: string,
  standings: DivisionStanding[]
): string {
  const divisionEmoji =
    divisionName.toLowerCase() === "north" ? "🏔️" : "🌴";

  const rows = standings.map((standing, index) => {
    const record =
      standing.ties > 0
        ? `${standing.wins}-${standing.losses}-${standing.ties}`
        : `${standing.wins}-${standing.losses}`;

    const gamesBehind =
      standing.gamesBehind === 0
        ? "-"
        : Number.isInteger(standing.gamesBehind)
          ? String(standing.gamesBehind)
          : standing.gamesBehind.toFixed(1);

    return (
      `${index + 1}. ${getTeamEmoji(standing.team)} ${standing.team}\n` +
      `   Record: ${record} | GB: ${gamesBehind} | ` +
      `PF: ${formatScore(standing.pointsFor)} | ` +
      `PA: ${formatScore(standing.pointsAgainst)}`
    );
  });

  return (
    `--------------------\n` +
    `${divisionEmoji} ${divisionName} Division\n` +
    `--------------------\n\n` +
    rows.join("\n\n")
  );
}


function normalizePlayerName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/\s+/g, "");
}

function parseLineupCommand(
  rawText: string
): {
  dateText: string;
  teamText: string;
  players: string[];
  captain: string;
} | null {
  const commandMatch = rawText.match(/\$lineup\b/i);

  if (!commandMatch || commandMatch.index === undefined) {
    return null;
  }

  const afterCommand = rawText
    .slice(commandMatch.index + commandMatch[0].length)
    .replace(/\r/g, "");

  const lines = afterCommand
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !/^[-_=]{3,}$/.test(line)
    );

  if (lines.length < 7) {
    return null;
  }

  let dateText = "today";
  let teamLineIndex = 0;

  if (
    /^today$/i.test(lines[0]) ||
    /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/.test(lines[0])
  ) {
    dateText = lines[0];
    teamLineIndex = 1;
  }

  if (lines.length < teamLineIndex + 7) {
    return null;
  }

  const teamText = lines[teamLineIndex];
  const playerLines = lines.slice(
    teamLineIndex + 1,
    teamLineIndex + 7
  );

  let captain = "";

  const players = playerLines.map((line) => {
    const isCaptain =
      /\s+(?:c|\(c\)|captain)$/i.test(line);

    const player = line
      .replace(/\s+(?:c|\(c\)|captain)$/i, "")
      .trim();

    if (isCaptain) {
      if (captain) {
        throw new Error(
          "Please mark only one player as captain."
        );
      }

      captain = player;
    }

    return player;
  });

  return {
    dateText,
    teamText,
    players,
    captain,
  };
}


type TransactionType = "sign" | "cut" | "trade" | "namechange";

type ParsedTransaction = {
  type: TransactionType;
  team: string | null;
  secondTeam: string | null;
  details: string;
};

function getAllTeamNames(): string[] {
  return Object.values(TEAM_DISPLAY_NAMES);
}

function parseTeamAtStart(
  text: string
): {
  team: string;
  remaining: string;
} | null {
  const teams = getAllTeamNames()
    .sort((a, b) => b.length - a.length);

  const trimmed = text.trim();

  for (const team of teams) {
    if (
      trimmed.toLowerCase() === team.toLowerCase() ||
      trimmed.toLowerCase().startsWith(
        `${team.toLowerCase()} `
      )
    ) {
      return {
        team,
        remaining: trimmed.slice(team.length).trim(),
      };
    }
  }

  return null;
}

function parseTransactionCommand(
  argumentsText: string
): ParsedTransaction | null {
  const cleaned = String(argumentsText || "").trim();

  const match = cleaned.match(
    /^(sign|signing|cut|trade|namechange|name-change|name change)\s+(.+)$/i
  );

  if (!match) {
    return null;
  }

  const rawType = match[1]
    .toLowerCase()
    .replace(/[\s-]+/g, "");

  const typeMap: Record<string, TransactionType> = {
    sign: "sign",
    signing: "sign",
    cut: "cut",
    trade: "trade",
    namechange: "namechange",
  };

  const type = typeMap[rawType];

  if (!type) {
    return null;
  }

  const remainder = match[2].trim();

  if (type === "trade") {
    const sections = remainder
      .split("|")
      .map((section) => section.trim())
      .filter(Boolean);

    if (sections.length < 3) {
      return null;
    }

    const firstTeam = findMatchingTeam(
      sections[0],
      getAllTeamNames()
    );

    const secondTeam = findMatchingTeam(
      sections[1],
      getAllTeamNames()
    );

    if (
      !firstTeam ||
      !secondTeam ||
      normalizeTeamName(firstTeam) ===
        normalizeTeamName(secondTeam)
    ) {
      return null;
    }

    const assets = sections.slice(2).join(" | ").trim();

    if (!assets) {
      return null;
    }

    return {
      type,
      team: firstTeam,
      secondTeam,
      details:
        `${firstTeam} and ${secondTeam} trade | ${assets}`,
    };
  }

  const teamResult = parseTeamAtStart(remainder);

  if (!teamResult || !teamResult.remaining) {
    return null;
  }

  return {
    type,
    team: teamResult.team,
    secondTeam: null,
    details: teamResult.remaining,
  };
}
function formatTransactionType(type:TransactionType){return ({sign:"Signing",cut:"Cut",trade:"Trade",namechange:"Player Name Change"} as any)[type];}
async function callTransactionApi(body:Record<string,unknown>):Promise<any>{
 const url=process.env.TRANSACTION_API_URL;
 if(!url) throw new Error("TRANSACTION_API_URL is not configured.");
 const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
 const txt=await response.text(); let result:any;
 try{result=JSON.parse(txt);}catch{throw new Error(`Transaction API returned invalid JSON: ${txt.slice(0,200)}`);}
 if(!response.ok||!result.ok) throw new Error(result.message||`Transaction API failed with status ${response.status}.`);
 return result;
}

async function callLineupApi(
  body: Record<string, unknown>
): Promise<any> {
  const lineupApiUrl = process.env.LINEUP_API_URL;

  if (!lineupApiUrl) {
    throw new Error(
      "LINEUP_API_URL is not configured."
    );
  }

  const response = await fetch(lineupApiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();

  let result: any;

  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(
      `Lineup API returned an invalid response: ${responseText.slice(0, 200)}`
    );
  }

  if (!response.ok || !result.ok) {
    throw new Error(
      result.message ||
        `Lineup API failed with status ${response.status}.`
    );
  }

  return result;
}

async function submitLineupToSheet(
  action: "submitLineup" | "saveQueuedLineup",
  date: string,
  team: string,
  opponent: string,
  players: string[],
  captain: string
): Promise<{
  ok: boolean;
  message?: string;
}> {
  return callLineupApi({
    action,
    date,
    team,
    opponent,
    lineup: players,
    captain,
    submittedAt: new Date().toISOString(),
  });
}

function extractCommentText(value: any): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => extractCommentText(item))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value.text === "string" && value.text.length > 0) {
    return value.text;
  }

  const mentionText =
    value.attrs?.label ??
    value.attrs?.username ??
    value.attrs?.displayName ??
    value.additionalInfo?.username ??
    value.username ??
    value.name;

  if (
    typeof mentionText === "string" &&
    (value.type === "mention" || value.type === "userMention")
  ) {
    return mentionText.startsWith("@")
      ? mentionText
      : `@${mentionText}`;
  }

  if (value.type === "hardBreak" || value.type === "lineBreak") {
    return "\n";
  }

  const nested =
    value.children ??
    value.content ??
    value.nodes ??
    [];

  const nestedText = extractCommentText(nested);

  if (
    value.type === "paragraph" ||
    value.type === "heading" ||
    value.type === "listItem"
  ) {
    return `${nestedText}\n`;
  }

  return nestedText;
}
type LineupLockTime = {
  hour: number;
  minute: number;
  display: string;
};

function parseLineupLockTime(value: string): LineupLockTime | null {
  const cleaned = value.trim().toUpperCase();

  const match = cleaned.match(
    /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/
  );

  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const period = match[3];

  if (
    hour < 1 ||
    hour > 12 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  if (period === "AM") {
    if (hour === 12) {
      hour = 0;
    }
  } else if (hour !== 12) {
    hour += 12;
  }

  const displayHour = Number(match[1]);
  const displayMinute = String(minute).padStart(2, "0");

  return {
    hour,
    minute,
    display: `${displayHour}:${displayMinute} ${period} ET`,
  };
}

function getEasternTimeParts(): {
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  return {
    hour: Number(
      parts.find((part) => part.type === "hour")?.value ?? 0
    ),
    minute: Number(
      parts.find((part) => part.type === "minute")?.value ?? 0
    ),
  };
}

function isPastLineupLockTime(
  lockTime: LineupLockTime
): boolean {
  const current = getEasternTimeParts();

  const currentMinutes =
    current.hour * 60 + current.minute;

  const lockMinutes =
    lockTime.hour * 60 + lockTime.minute;

  return currentMinutes >= lockMinutes;
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

  return {
    hour,
    minute,
    display:
      String(result.display ?? "").trim() ||
      `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ET`,
  };
}
export async function handleCommand(
  client: any,
  activity: any
): Promise<void> {
  const rawText = String(
  activity.additionalInfo?.comment?.plainText ??
  activity.comment?.plainText ??
  ""
).trim();

console.log("Raw plain text:", JSON.stringify(rawText));

  const fullText = rawText
    .replace(/\s+/g, " ")
    .trim();

  if (!fullText) {
    return;
  }

  console.log("Full message:", fullText);

  const commandMatch = fullText.match(/\$[a-z0-9_-]+/i);

  if (!commandMatch) {
    console.log("No command found.");
    return;
  }

  const command = commandMatch[0].toLowerCase();
  const commandIndex = commandMatch.index ?? 0;

  const argumentsText = fullText
    .slice(commandIndex + commandMatch[0].length)
    .trim();

  console.log("Command received:", command);
  console.log("Arguments:", argumentsText);

  switch (command) {
    case "$help": {
  await client.replyToComment(
    activity.commentId,
`📖 RSKL Bot Help

$help - Show this menu
$ping - Test the bot
$schedule [team] - Show a team's full schedule
$standing [division] - Show division standings
$roster [team] - Show a team's roster
$cap [team/all] - Show salary-cap information
$live [team] - Show live game scores
$lineup [today/date] - Submit or queue a six-player lineup\n$lineup lock time [time] - Set the daily Eastern lineup deadline
$transaction [sign/cut/trade/namechange] [details] - Submit a transaction request
$[team] - Show a team's information`
  );

  return;
}
    case "$mensah": {
  const roasts = [
    "@mensah still thinks rebuilding means collecting every 5th round pick.",
    "@mensah has more transaction ideas than wins.",
    "@mensah somehow loses trades he offered himself.",
    "@mensah's scouting department is just the Trending page.",
    "@mensah treats draft picks like trading cards.",
    "@mensah's salary cap cries every time he logs in.",
    "@mensah's best player is Future Considerations.",
    "@mensah's championship window is scheduled for 2037.",
    "@mensah's rebuild has been rebuilding for three seasons.",
    "@mensah sends trade offers like they're spam emails.",
    "@mensah thinks cap space scores points.",
    "@mensah is allergic to fair trades."
  ];

  const roast =
    roasts[Math.floor(Math.random() * roasts.length)];

  await client.replyToComment(
    activity.commentId,
    roast
  );

  return;
}

    case "$ping": {
      await client.replyToComment(
        activity.commentId,
        "🏓 Pong!"
      );

      return;
    }

    case "$lineup": {
      const lockTimeCommand = argumentsText.match(
        /^lock\s+time\s+(.+)$/i
      );

      if (lockTimeCommand) {
        const submittingUserId = getSubmittingUserId(activity);

        if (
          !submittingUserId ||
          !LINEUP_ADMIN_USER_IDS.includes(submittingUserId)
        ) {
          await client.replyToComment(
            activity.commentId,
            "Sorry, only a lineup administrator can change the lineup lock time."
          );

          return;
        }

        const parsedLockTime = parseLineupLockTime(
          lockTimeCommand[1]
        );

        if (!parsedLockTime) {
          await client.replyToComment(
            activity.commentId,
`I could not read that time.

Use a time like:
@rsklbot $lineup lock time 6:55 PM
@rsklbot $lineup lock time 11:30 AM`
          );

          return;
        }

        try {
          await callLineupApi({
            action: "setLineupLockTime",
            hour: parsedLockTime.hour,
            minute: parsedLockTime.minute,
            display: parsedLockTime.display,
          });

          await client.replyToComment(
            activity.commentId,
            `🔒 The daily lineup lock time is now ${parsedLockTime.display}.`
          );
        } catch (error) {
          console.error("Could not save lineup lock time:", error);

          await client.replyToComment(
            activity.commentId,
            error instanceof Error
              ? `Could not save the lineup lock time: ${error.message}`
              : "Could not save the lineup lock time."
          );
        }

        return;
      }

      let parsedLineup;

      try {
        parsedLineup = parseLineupCommand(rawText);
      } catch (error) {
        await client.replyToComment(
          activity.commentId,
          error instanceof Error
            ? error.message
            : "The lineup could not be read."
        );

        return;
      }

      if (!parsedLineup) {
        await client.replyToComment(
          activity.commentId,
`Use one of these formats:

Today's lineup:
@rsklbot $lineup
Gus N Em
Player 1
Player 2 C
Player 3
Player 4
Player 5
Player 6

Today's lineup can also use:
@rsklbot $lineup today

Future lineup:
@rsklbot $lineup 7/22
Gus N Em
Player 1
Player 2 C
Player 3
Player 4
Player 5
Player 6

Mark exactly one player with C.`
        );

        return;
      }

      if (!parsedLineup.captain) {
        await client.replyToComment(
          activity.commentId,
          "Please mark exactly one player with C."
        );

        return;
      }

      const today = getEasternToday();
      let selectedDate = today;

      if (!/^today$/i.test(parsedLineup.dateText)) {
        const parsedDate = parseScheduleDate(
          parsedLineup.dateText
        );

        if (!parsedDate) {
          await client.replyToComment(
            activity.commentId,
            `I could not read the date "${parsedLineup.dateText}". Use today or a date like 7/22.`
          );

          return;
        }

        selectedDate = parsedDate;
      }

      const todayStart = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
      );

      const selectedStart = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate()
      );

      const isToday = isSameCalendarDate(
        selectedDate,
        today
      );

      if (isToday) {
        try {
          const lockTime = await getLineupLockTime();

          if (isPastLineupLockTime(lockTime)) {
            await client.replyToComment(
              activity.commentId,
              `🔒 Lineups are locked for today. The deadline was ${lockTime.display}.`
            );

            return;
          }
        } catch (error) {
          console.error("Could not check lineup lock time:", error);

          await client.replyToComment(
            activity.commentId,
            error instanceof Error
              ? `Could not check the lineup lock time: ${error.message}`
              : "Could not check the lineup lock time."
          );

          return;
        }
      }

      if (selectedStart.getTime() < todayStart.getTime()) {
        await client.replyToComment(
          activity.commentId,
          "You cannot submit a lineup for a past date."
        );

        return;
      }

      const rosters = await getRosters();
      const availableTeams = rosters.map(
        (roster) => roster.team
      );

      const matchedTeam = findMatchingTeam(
        parsedLineup.teamText,
        availableTeams
      );

      if (!matchedTeam) {
        await client.replyToComment(
          activity.commentId,
          `I could not find the team "${parsedLineup.teamText}".`
        );

        return;
      }

      const submittingUserId =
        getSubmittingUserId(activity);

      if (
        !submittingUserId ||
        !canSubmitLineupForTeam(
          submittingUserId,
          matchedTeam
        )
      ) {
        await client.replyToComment(
          activity.commentId,
          submittingUserId
            ? `Sorry, you are not allowed to submit a lineup for ${matchedTeam}.`
            : "I could not identify who submitted this lineup."
        );

        return;
      }

      const schedule = await getSchedule();
      const opponent = getOpponentForTeamOnDate(
        schedule,
        matchedTeam,
        selectedDate
      );

      if (!opponent) {
        await client.replyToComment(
          activity.commentId,
          `${matchedTeam} does not have a scheduled game on ${parsedLineup.dateText}.`
        );

        return;
      }

      const roster = rosters.find(
        (teamRoster) =>
          normalizeTeamName(teamRoster.team) ===
          normalizeTeamName(matchedTeam)
      );

      if (!roster) {
        await client.replyToComment(
          activity.commentId,
          `No roster was found for ${matchedTeam}.`
        );

        return;
      }

      const rosterPlayers = new Map(
        roster.players.map((player) => [
          normalizePlayerName(player),
          player,
        ])
      );

      const resolvedPlayers: string[] = [];
      const missingPlayers: string[] = [];

      for (const submittedPlayer of parsedLineup.players) {
        const rosterPlayer = rosterPlayers.get(
          normalizePlayerName(submittedPlayer)
        );

        if (!rosterPlayer) {
          missingPlayers.push(submittedPlayer);
          continue;
        }

        resolvedPlayers.push(rosterPlayer);
      }

      if (missingPlayers.length > 0) {
        await client.replyToComment(
          activity.commentId,
`These players were not found on the ${matchedTeam} roster:

${missingPlayers.map((player) => `• ${player}`).join("\n")}`
        );

        return;
      }

      const uniquePlayers = new Set(
        resolvedPlayers.map(normalizePlayerName)
      );

      if (uniquePlayers.size !== 6) {
        await client.replyToComment(
          activity.commentId,
          "The lineup must contain six different players."
        );

        return;
      }

      const resolvedCaptain = rosterPlayers.get(
        normalizePlayerName(parsedLineup.captain)
      );

      if (!resolvedCaptain) {
        await client.replyToComment(
          activity.commentId,
          `Captain "${parsedLineup.captain}" was not found on the roster.`
        );

        return;
      }

      const action = isToday
        ? "submitLineup"
        : "saveQueuedLineup";

      const apiDate = formatDateForApi(selectedDate);

      try {
        await submitLineupToSheet(
          action,
          apiDate,
          matchedTeam,
          opponent,
          resolvedPlayers,
          resolvedCaptain
        );

        const statusText = isToday
          ? "submitted"
          : `queued for ${parsedLineup.dateText}`;

        await client.replyToComment(
          activity.commentId,
`${getTeamEmoji(matchedTeam)} ${matchedTeam} lineup ${statusText}.

Opponent: ${getTeamEmoji(opponent)} ${opponent}

${resolvedPlayers
  .map(
    (player) =>
      `• ${displayPlayerName(player)}${
        normalizePlayerName(player) ===
        normalizePlayerName(resolvedCaptain)
          ? " C"
          : ""
      }`
  )
  .join("\n")}`
        );
      } catch (error) {
        console.error("Lineup submission failed:", error);

        await client.replyToComment(
          activity.commentId,
          error instanceof Error
            ? `Lineup submission failed: ${error.message}`
            : "Lineup submission failed."
        );
      }

      return;
    }

    case "$transaction": {
      const parsed = parseTransactionCommand(argumentsText);

      if (!parsed) {
        await client.replyToComment(
          activity.commentId,
`Use one of these formats:

@rsklbot $transaction sign Team Player
@rsklbot $transaction cut Team Player
@rsklbot $transaction namechange Team OldName NewName

Trade format:

@rsklbot $transaction trade Team One | Team Two | Team One give: assets | Team Two give: assets`
        );

        return;
      }

      const submittingUserId = getSubmittingUserId(activity);

      if (!submittingUserId) {
        await client.replyToComment(
          activity.commentId,
          "I could not identify who submitted this transaction."
        );

        return;
      }

      const isCommissioner =
  LINEUP_ADMIN_USER_IDS.includes(submittingUserId);

const assignedTeam =
  getTransactionTeamForUserId(submittingUserId);

if (!isCommissioner && !assignedTeam) {
  await client.replyToComment(
    activity.commentId,
    "Sorry, you are not authorized to submit a transaction."
  );

  return;
}

let submittingTeam: string;

if (isCommissioner) {
  if (!parsed.team) {
    await client.replyToComment(
      activity.commentId,
`Please include the team.

Examples:

@rsklbot $transaction cut Turkeys @Player
@rsklbot $transaction sign Storm @Player

Trade format:

@rsklbot $transaction trade Turkeys | Gus N Em | Turkeys give: @Player | Gus N Em give: @Player2`
    );

    return;
  }

  submittingTeam = parsed.team;
} else {
  submittingTeam = assignedTeam!;

  if (
    parsed.team &&
    normalizeTeamName(parsed.team) !==
      normalizeTeamName(submittingTeam)
  ) {
    await client.replyToComment(
      activity.commentId,
      `You can only submit transactions for ${submittingTeam}.`
    );

    return;
  }

  if (
    parsed.type === "trade" &&
    parsed.secondTeam &&
    normalizeTeamName(parsed.secondTeam) ===
      normalizeTeamName(submittingTeam)
  ) {
    await client.replyToComment(
      activity.commentId,
      "A trade must include two different teams."
    );

    return;
  }
}

      try {
        const result = await callTransactionApi({
  action: "submitTransaction",
  submittedByUserId: submittingUserId,
  team: submittingTeam,
  secondTeam: parsed.secondTeam,
  transactionType: parsed.type,
  details: parsed.details,
  source: isCommissioner
    ? "Real Bot - Commissioner"
    : "Real Bot",
  submittedAt: new Date().toISOString(),
});

        const transactionId = String(
          result.transactionId ?? result.id ?? "Pending"
        );

        const team = String(
          result.team ?? result.gmTeam ?? submittingTeam
        );

        const typeName = formatTransactionType(parsed.type);

        const dmMessage = [
          "📋 New RSKL Transaction Request",
          "",
          `ID: ${transactionId}`,
          `Type: ${typeName}`,
          `Team: ${team}`,
          `Submitted By User ID: ${submittingUserId}`,
          "",
          `Details: ${parsed.details}`,
          "",
          "Status: Pending Commissioner Approval",
        ].join("\n");

        const transactionChannelId =
          process.env.TRANSACTION_DM_CHANNEL_ID;

        if (transactionChannelId) {
          try {
            await client.sendChannelMessage(
  dmMessage,
  transactionChannelId
);
          } catch (notificationError) {
            console.error(
              "Transaction was submitted, but the commissioner notification failed:",
              notificationError
            );
          }
        } else {
          console.warn(
            "TRANSACTION_DM_CHANNEL_ID is not configured."
          );
        }

        await client.replyToComment(
          activity.commentId,
`✅ Transaction Submitted

ID: ${transactionId}
Type: ${typeName}
Team: ${team}
Status: Pending Commissioner Approval`
        );
      } catch (error) {
        console.error(
          "Transaction command failed:",
          error
        );

        await client.replyToComment(
          activity.commentId,
          error instanceof Error
            ? `Could not submit the transaction: ${error.message}`
            : "Could not submit the transaction."
        );
      }

      return;
    }

case "$roster": {
      if (!argumentsText) {
        await client.replyToComment(
          activity.commentId,
`Please enter a team name.

Example:
@rsklbot $roster Gus N Em`
        );

        return;
      }

      const rosters = await getRosters();
      const availableTeams = rosters.map((roster) => roster.team);

      const matchedTeam = findMatchingTeam(
        argumentsText,
        availableTeams
      );

      if (!matchedTeam) {
        await client.replyToComment(
          activity.commentId,
          `I could not find the team "${argumentsText}".`
        );

        return;
      }

      const roster = rosters.find(
        (teamRoster) =>
          normalizeTeamName(teamRoster.team) ===
          normalizeTeamName(matchedTeam)
      );

      if (!roster || roster.players.length === 0) {
        await client.replyToComment(
          activity.commentId,
          `No roster was found for ${matchedTeam}.`
        );

        return;
      }

      const rosterLines = roster.players.map(
        (player) => `• ${displayPlayerName(player)}`
      );

      await client.replyToComment(
        activity.commentId,
`${getTeamEmoji(matchedTeam)} ${matchedTeam} Roster

${rosterLines.join("\n")}`
      );

      return;
    }

    case "$cap": {
      if (!argumentsText) {
        await client.replyToComment(
          activity.commentId,
`Please enter a team name or "all".

Examples:
@rsklbot $cap Gus N Em
@rsklbot $cap all`
        );

        return;
      }

      const contracts = await getContracts();

      if (argumentsText.trim().toLowerCase() === "all") {
        const teamTotals = new Map<string, number>();

        for (const contract of contracts) {
          const currentTotal = teamTotals.get(contract.team) ?? 0;

          teamTotals.set(
            contract.team,
            currentTotal + contract.currentCapHit
          );
        }

        const capLines = Array.from(teamTotals.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([team, capUsed]) => {
            const capRemaining = CAP_LIMIT - capUsed;

            return (
              `${getTeamEmoji(team)} ${team} | ` +
              `${formatScore(capUsed)} used | ` +
              `${formatScore(capRemaining)} remaining`
            );
          })
          .join("\n");

        const leagueTotal = Array.from(teamTotals.values()).reduce(
          (total, capHit) => total + capHit,
          0
        );

        await client.replyToComment(
          activity.commentId,
`💰 League Salary Cap

Team | Cap Used | Cap Remaining
${capLines}

League Total Used: ${formatScore(leagueTotal)} Rax`
        );

        return;
      }

      const availableTeams = Array.from(
        new Set(contracts.map((contract) => contract.team))
      );

      const matchedTeam = findMatchingTeam(
        argumentsText,
        availableTeams
      );

      if (!matchedTeam) {
        await client.replyToComment(
          activity.commentId,
          `I could not find the team "${argumentsText}".`
        );

        return;
      }

      const teamContracts = contracts.filter(
        (contract) =>
          normalizeTeamName(contract.team) ===
          normalizeTeamName(matchedTeam)
      );

      if (teamContracts.length === 0) {
        await client.replyToComment(
          activity.commentId,
          `No salary-cap information was found for ${matchedTeam}.`
        );

        return;
      }

      const totalCapUsed = teamContracts.reduce(
        (total, contract) => total + contract.currentCapHit,
        0
      );

      const capRemaining = CAP_LIMIT - totalCapUsed;

      const contractText = teamContracts
        .map((contract) => {
          return (
            `• ${displayPlayerName(contract.player)} | ` +
            `${formatScore(contract.totalRax)} total Rax | ` +
            `${contract.yearsLeft} year${
              contract.yearsLeft === 1 ? "" : "s"
            } left | ` +
            `${formatScore(contract.currentCapHit)} cap hit`
          );
        })
        .join("\n");

      await client.replyToComment(
        activity.commentId,
`${getTeamEmoji(matchedTeam)} ${matchedTeam} Salary Cap

Player | Total Rax | Years Left | Cap Hit
${contractText}

Cap Used: ${formatScore(totalCapUsed)} / ${formatScore(CAP_LIMIT)}
Cap Remaining: ${formatScore(capRemaining)}`
      );

      return;
    }

    case "$live": {
      const schedule = await getSchedule();

      const liveGames = schedule.filter((game) => {
        const status = String(game.status ?? "")
          .trim()
          .toLowerCase();

        return status === "in progress" || status === "live";
      });

      if (liveGames.length === 0) {
        await client.replyToComment(
          activity.commentId,
          "📺 There are no live games right now."
        );

        return;
      }

      let gamesToShow = liveGames;
      let matchedTeam: string | null = null;

      if (argumentsText) {
        const availableTeams = Array.from(
          new Set(
            liveGames.flatMap((game) => [
              game.away,
              game.home,
            ])
          )
        );

        matchedTeam = findMatchingTeam(
          argumentsText,
          availableTeams
        );

        if (!matchedTeam) {
          const allScheduleTeams = Array.from(
            new Set(
              schedule.flatMap((game) => [
                game.away,
                game.home,
              ])
            )
          );

          const existingTeam = findMatchingTeam(
            argumentsText,
            allScheduleTeams
          );

          if (existingTeam) {
            await client.replyToComment(
              activity.commentId,
              `📺 ${getTeamEmoji(existingTeam)} ${existingTeam} does not have a live game right now.`
            );
          } else {
            await client.replyToComment(
              activity.commentId,
              `I could not find the team "${argumentsText}".`
            );
          }

          return;
        }

        gamesToShow = liveGames.filter(
          (game) =>
            normalizeTeamName(game.away) ===
              normalizeTeamName(matchedTeam!) ||
            normalizeTeamName(game.home) ===
              normalizeTeamName(matchedTeam!)
        );

        if (gamesToShow.length === 0) {
          await client.replyToComment(
            activity.commentId,
            `📺 ${getTeamEmoji(matchedTeam)} ${matchedTeam} does not have a live game right now.`
          );

          return;
        }
      }

      const liveGameLines = gamesToShow
        .map((game) => {
          const awayScore = parseScore(game.awayScore) ?? 0;
          const homeScore = parseScore(game.homeScore) ?? 0;

          return (
            `${getTeamEmoji(game.away)} ${game.away} ` +
            `${formatScore(awayScore)} - ${formatScore(homeScore)} ` +
            `${game.home} ${getTeamEmoji(game.home)}`
          );
        })
        .join("\n");

      const title = matchedTeam
        ? `📺 ${getTeamEmoji(matchedTeam)} ${matchedTeam} Live Game`
        : "📺 Live Games";

      await client.replyToComment(
        activity.commentId,
`${title}

${liveGameLines}`
      );

      return;
    }

    case "$standing":
    case "$standings": {
      const requestedDivision = argumentsText
        .trim()
        .toLowerCase();

      if (
        requestedDivision &&
        requestedDivision !== "north" &&
        requestedDivision !== "south"
      ) {
        await client.replyToComment(
          activity.commentId,
`Please enter North or South.

Examples:
@rsklbot $standing north
@rsklbot $standing south

You can also use:
@rsklbot $standing`
        );

        return;
      }

      const schedule = await getSchedule();

      // No division entered: send North and South as two separate replies.
      if (!requestedDivision) {
        const northStandings = formatDivisionStandings(
          "North",
          buildDivisionStandings(
            schedule,
            DIVISIONS.north
          )
        );

        const southStandings = formatDivisionStandings(
          "South",
          buildDivisionStandings(
            schedule,
            DIVISIONS.south
          )
        );

        await client.replyToComment(
          activity.commentId,
          northStandings
        );

        await client.replyToComment(
          activity.commentId,
          southStandings
        );

        return;
      }

      // A division was entered: send only that division.
      const standings = buildDivisionStandings(
        schedule,
        DIVISIONS[requestedDivision]
      );

      const divisionName =
        requestedDivision.charAt(0).toUpperCase() +
        requestedDivision.slice(1);

      await client.replyToComment(
        activity.commentId,
        formatDivisionStandings(
          divisionName,
          standings
        )
      );

      return;
    }

    case "$schedule": {
      if (!argumentsText) {
        await client.replyToComment(
          activity.commentId,
`Please enter a team name.

Example:
@rsklbot $schedule Gus N Em`
        );

        return;
      }

      const schedule = await getSchedule();

      const availableTeams = Array.from(
        new Set(
          schedule.flatMap((game) => [
            game.away,
            game.home,
          ])
        )
      );

      const matchedTeam = findMatchingTeam(
        argumentsText,
        availableTeams
      );

      if (!matchedTeam) {
        await client.replyToComment(
          activity.commentId,
          `I could not find the team "${argumentsText}".`
        );

        return;
      }

      const teamSchedule = schedule.filter(
        (game) =>
          normalizeTeamName(game.away) ===
            normalizeTeamName(matchedTeam) ||
          normalizeTeamName(game.home) ===
            normalizeTeamName(matchedTeam)
      );

      const lines = teamSchedule.map(
        (game) =>
          `• ${game.date}: ${getTeamEmoji(game.away)} ${game.away} vs ${game.home} ${getTeamEmoji(game.home)}`
      );

      await client.replyToComment(
        activity.commentId,
`${getTeamEmoji(matchedTeam)} ${matchedTeam} Schedule

${lines.join("\n")}`
      );

      return;
    }
  }
  const teamSearchText = [
    command.replace(/^\$/, ""),
    argumentsText,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  const schedule = await getSchedule();

  const availableTeams = Array.from(
    new Set(
      schedule.flatMap((game) => [
        game.away,
        game.home,
      ])
    )
  );

  const matchedTeam = findMatchingTeam(
    teamSearchText,
    availableTeams
  );

  if (!matchedTeam) {
    await client.replyToComment(
      activity.commentId,
`I could not find the team "${teamSearchText}".

Use $help to see the available commands.`
    );

    return;
  }

  const teamGames = schedule
    .filter(
      (game) =>
        normalizeTeamName(game.away) ===
          normalizeTeamName(matchedTeam) ||
        normalizeTeamName(game.home) ===
          normalizeTeamName(matchedTeam)
    )
    .map((game) => ({
      ...game,
      parsedDate: parseScheduleDate(game.date),
      parsedAwayScore: parseScore(game.awayScore),
      parsedHomeScore: parseScore(game.homeScore),
    }))
    .filter((game) => game.parsedDate !== null)
    .sort(
      (a, b) =>
        a.parsedDate!.getTime() -
        b.parsedDate!.getTime()
    );

  const completedGames = teamGames.filter(
    (game) =>
      game.parsedAwayScore !== null &&
      game.parsedHomeScore !== null
  );

  let wins = 0;
  let losses = 0;
  let ties = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;

  const results: Array<"W" | "L" | "T"> = [];

  for (const game of completedGames) {
    const isAway =
      normalizeTeamName(game.away) ===
      normalizeTeamName(matchedTeam);

    const teamScore = isAway
      ? game.parsedAwayScore!
      : game.parsedHomeScore!;

    const opponentScore = isAway
      ? game.parsedHomeScore!
      : game.parsedAwayScore!;

    pointsFor += teamScore;
    pointsAgainst += opponentScore;

    if (teamScore > opponentScore) {
      wins++;
      results.push("W");
    } else if (teamScore < opponentScore) {
      losses++;
      results.push("L");
    } else {
      ties++;
      results.push("T");
    }
  }

  let currentStreak = "—";

  if (results.length > 0) {
    const latestResult = results[results.length - 1];
    let streakLength = 0;

    for (
      let index = results.length - 1;
      index >= 0;
      index--
    ) {
      if (results[index] !== latestResult) {
        break;
      }

      streakLength++;
    }

    currentStreak = `${latestResult}${streakLength}`;
  }

  const today = getEasternToday();

  const nextGame = teamGames.find(
    (game) =>
      game.parsedDate!.getTime() >= today.getTime() &&
      !(
        game.parsedAwayScore !== null &&
        game.parsedHomeScore !== null
      )
  );

  const lastGame =
    completedGames.length > 0
      ? completedGames[completedGames.length - 1]
      : null;

  let nextGameText = "No upcoming game";

  if (nextGame) {
    const isAway =
      normalizeTeamName(nextGame.away) ===
      normalizeTeamName(matchedTeam);

    const opponent = isAway
      ? nextGame.home
      : nextGame.away;

    nextGameText =
      `${nextGame.date} ` +
      `${isAway ? "at" : "vs"} ` +
      `${getTeamEmoji(opponent)} ${opponent}`;
  }

  let lastGameText = "No completed games";

  if (lastGame) {
    const isAway =
      normalizeTeamName(lastGame.away) ===
      normalizeTeamName(matchedTeam);

    const opponent = isAway
      ? lastGame.home
      : lastGame.away;

    const teamScore = isAway
      ? lastGame.parsedAwayScore!
      : lastGame.parsedHomeScore!;

    const opponentScore = isAway
      ? lastGame.parsedHomeScore!
      : lastGame.parsedAwayScore!;

    const result =
      teamScore > opponentScore
        ? "W"
        : teamScore < opponentScore
          ? "L"
          : "T";

    lastGameText =
      `${lastGame.date}: ${result} vs ` +
      `${getTeamEmoji(opponent)} ${opponent}, ` +
      `${formatScore(teamScore)}-${formatScore(opponentScore)}`;
  }

  const record =
    ties > 0
      ? `${wins}-${losses}-${ties}`
      : `${wins}-${losses}`;

  const contracts = await getContracts();

  const teamContracts = contracts.filter(
    (contract) =>
      normalizeTeamName(contract.team) ===
      normalizeTeamName(matchedTeam)
  );

  const totalCapUsed = teamContracts.reduce(
    (total, contract) => total + contract.currentCapHit,
    0
  );

  const capRemaining = CAP_LIMIT - totalCapUsed;

  await client.replyToComment(
    activity.commentId,
`${getTeamEmoji(matchedTeam)} ${matchedTeam}

Record: ${record}
Next Game: ${nextGameText}
Last Game: ${lastGameText}
Current Streak: ${currentStreak}
Points For: ${formatScore(pointsFor)}
Points Against: ${formatScore(pointsAgainst)}
Cap Used: ${formatScore(totalCapUsed)} / ${formatScore(CAP_LIMIT)}
Cap Remaining: ${formatScore(capRemaining)}`
  );
}
