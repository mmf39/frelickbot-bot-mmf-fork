import "dotenv/config";

import { google } from "googleapis";

export interface CompletedPlayer {
  username: string;
  karma: number;
  rank: number;
  isCaptain: boolean;
}

export interface CompletedTeam {
  team: string;
  emoji?: string;
  score: number;
  wins: number;
  losses: number;
  winStreak?: number;
  lossStreak?: number;
  players: CompletedPlayer[];
}

export interface CompletedGame {
  leagueDay: string;
  away: CompletedTeam;
  home: CompletedTeam;
}

interface StandingInfo {
  wins: number;
  losses: number;
}

const COMPLETED_GAMES_SHEET = "Completed Games";
const STANDINGS_SHEET = "Standings";

const SPREADSHEET_ID =
  process.env.GOOGLE_SPREADSHEET_ID ||
  process.env.LEAGUE_SPREADSHEET_ID ||
  "1EEFztFGUNtQqhHkftJHma3WHILDjZjv2WGErHEIuCbg";

function getGoogleAuth() {
  const rawServiceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!rawServiceAccount) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_JSON environment variable."
    );
  }

  let credentials: {
    client_email?: string;
    private_key?: string;
  };

  try {
    credentials = JSON.parse(rawServiceAccount);
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON."
    );
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON must contain client_email and private_key."
    );
  }

  return new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key.replace(/\\n/g, "\n"),
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets.readonly",
    ],
  });
}

function cleanCell(value: unknown): string {
  return String(value ?? "").trim();
}

function parseNumber(value: unknown): number {
  const cleaned = cleanCell(value).replace(/,/g, "");
  const parsed = Number(cleaned);

  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLeagueDay(value: string): string {
  const match = cleanCell(value).match(/(\d{1,2})\/(\d{1,2})/);

  if (!match) {
    return cleanCell(value);
  }

  return `${Number(match[1])}/${Number(match[2])}`;
}

function parseTeamHeader(value: unknown): {
  team: string;
  score: number;
} | null {
  const text = cleanCell(value);

  if (!text) {
    return null;
  }

  const match = text.match(/^(.*?)\s*\(([\d,]+)\)\s*$/);

  if (!match) {
    return null;
  }

  return {
    team: match[1].trim(),
    score: parseNumber(match[2]),
  };
}

function parsePlayer(
  usernameValue: unknown,
  karmaValue: unknown,
  rankValue: unknown
): CompletedPlayer | null {
  let username = cleanCell(usernameValue);

  if (!username || username.toLowerCase() === "player") {
    return null;
  }

  const captainPattern = /\s+(?:\(C\)|C\*?|©)$/i;
  const isCaptain = captainPattern.test(username);

  username = username.replace(captainPattern, "").trim();

  if (!username.startsWith("@")) {
    username = `@${username}`;
  }

  return {
    username,
    karma: parseNumber(karmaValue),
    rank: parseNumber(rankValue),
    isCaptain,
  };
}

async function getSheetValues(
  range: string
): Promise<unknown[][]> {
  const auth = getGoogleAuth();
  const sheets = google.sheets({
    version: "v4",
    auth,
  });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
  });

  return response.data.values ?? [];
}

async function getStandings(): Promise<Map<string, StandingInfo>> {
  const values = await getSheetValues(
    `'${STANDINGS_SHEET}'!A1:Z1000`
  );

  const standings = new Map<string, StandingInfo>();

  if (values.length === 0) {
    return standings;
  }

  const header = values[0].map((cell) =>
    cleanCell(cell).toLowerCase()
  );

  const teamIndex = header.findIndex((value) => value === "team");
  const winsIndex = header.findIndex(
    (value) => value === "wins" || value === "w"
  );
  const lossesIndex = header.findIndex(
    (value) => value === "losses" || value === "l"
  );

  if (teamIndex === -1 || winsIndex === -1 || lossesIndex === -1) {
    console.warn(
      "Could not find Team, Wins, and Losses columns in Standings."
    );

    return standings;
  }

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    const team = cleanCell(row[teamIndex]);

    if (!team) {
      continue;
    }

    standings.set(team.toLowerCase(), {
      wins: parseNumber(row[winsIndex]),
      losses: parseNumber(row[lossesIndex]),
    });
  }

  return standings;
}

function getTeamRecord(
  standings: Map<string, StandingInfo>,
  team: string
): StandingInfo {
  return (
    standings.get(team.toLowerCase()) ?? {
      wins: 0,
      losses: 0,
    }
  );
}

function getTeamEmoji(team: string): string {
  const emojis: Record<string, string> = {
    Turkeys: "🦃",
    "Gus N Em": "💪",
    "The Phantoms": "👻",
    Illegals: "🚨",
    Pandas: "🐼",
    "Super Kings": "👑",
    "Dream Team": "💭",
    "Bad Bois": "😈",
    Scorpions: "🦂",
    Storm: "⛈️",
  };

  return emojis[team] ?? "🏒";
}

export async function getCompletedGamesForLeagueDay(
  leagueDay: string
): Promise<CompletedGame[]> {
  const targetLeagueDay = normalizeLeagueDay(leagueDay);

  const [rows, standings] = await Promise.all([
    getSheetValues(`'${COMPLETED_GAMES_SHEET}'!A1:Z1000`),
    getStandings(),
  ]);

  const leagueDayHeader = `league day: ${targetLeagueDay}`.toLowerCase();

  const startRowIndex = rows.findIndex((row) =>
    row.some(
      (cell) => cleanCell(cell).toLowerCase() === leagueDayHeader
    )
  );

  if (startRowIndex === -1) {
    console.log(
      `Could not find League Day: ${targetLeagueDay} in Completed Games.`
    );

    return [];
  }

  let endRowIndex = rows.length;

  for (
    let rowIndex = startRowIndex + 1;
    rowIndex < rows.length;
    rowIndex += 1
  ) {
    const containsNextLeagueDay = rows[rowIndex].some((cell) =>
      /^league day:\s*\d{1,2}\/\d{1,2}$/i.test(cleanCell(cell))
    );

    if (containsNextLeagueDay) {
      endRowIndex = rowIndex;
      break;
    }
  }

  const sectionRows = rows.slice(startRowIndex + 1, endRowIndex);
  const games: CompletedGame[] = [];

  for (let rowIndex = 0; rowIndex < sectionRows.length; rowIndex += 1) {
    const row = sectionRows[rowIndex];

    const awayHeader = parseTeamHeader(row[0]);
    const homeHeader = parseTeamHeader(row[5]);

    if (!awayHeader || !homeHeader) {
      continue;
    }

    const awayPlayers: CompletedPlayer[] = [];
    const homePlayers: CompletedPlayer[] = [];

    let playerRowIndex = rowIndex + 1;

    if (
      cleanCell(sectionRows[playerRowIndex]?.[0]).toLowerCase() ===
      "player"
    ) {
      playerRowIndex += 1;
    }

    while (playerRowIndex < sectionRows.length) {
      const playerRow = sectionRows[playerRowIndex];

      const nextAwayHeader = parseTeamHeader(playerRow[0]);
      const nextHomeHeader = parseTeamHeader(playerRow[5]);

      if (nextAwayHeader && nextHomeHeader) {
        break;
      }

      const nextLeagueDayFound = playerRow.some((cell) =>
        /^league day:/i.test(cleanCell(cell))
      );

      if (nextLeagueDayFound) {
        break;
      }

      const awayPlayer = parsePlayer(
        playerRow[0],
        playerRow[1],
        playerRow[2]
      );

      const homePlayer = parsePlayer(
        playerRow[5],
        playerRow[6],
        playerRow[7]
      );

      if (awayPlayer) {
        awayPlayers.push(awayPlayer);
      }

      if (homePlayer) {
        homePlayers.push(homePlayer);
      }

      const rowIsEmpty = playerRow.every(
        (cell) => cleanCell(cell) === ""
      );

      if (
        rowIsEmpty &&
        (awayPlayers.length > 0 || homePlayers.length > 0)
      ) {
        break;
      }

      playerRowIndex += 1;
    }

    const awayRecord = getTeamRecord(
      standings,
      awayHeader.team
    );

    const homeRecord = getTeamRecord(
      standings,
      homeHeader.team
    );

    games.push({
      leagueDay: targetLeagueDay,
      away: {
        team: awayHeader.team,
        emoji: getTeamEmoji(awayHeader.team),
        score: awayHeader.score,
        wins: awayRecord.wins,
        losses: awayRecord.losses,
        players: awayPlayers,
      },
      home: {
        team: homeHeader.team,
        emoji: getTeamEmoji(homeHeader.team),
        score: homeHeader.score,
        wins: homeRecord.wins,
        losses: homeRecord.losses,
        players: homePlayers,
      },
    });

    rowIndex = Math.max(rowIndex, playerRowIndex - 1);
  }

  return games;
}
