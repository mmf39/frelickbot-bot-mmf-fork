import { appendSheet, readSheet, writeSheet } from "./SheetsClient";

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID!;
const GAME_LOCKS_RANGE = "Game Locks!A:E";
const SUBMITTED_LINEUPS_RANGE = "SubmittedLineups!A:Z";

export type SavedGameLock = {
  rowNumber: number;
  date: string;
  lockAt: string;
  updatedAt: string;
  lineupDmSent: boolean;
  lineupDmSentAt: string;
};

export type SheetLineup = {
  team: string;
  captain: string;
  players: string[];
  submittedAt: string;
};

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isTruthy(value: unknown): boolean {
  return ["true", "yes", "1", "sent"].includes(
    String(value ?? "").trim().toLowerCase()
  );
}

async function ensureGameLockHeaders(): Promise<void> {
  const rows = await readSheet(SPREADSHEET_ID, "Game Locks!A1:E1");
  const expected = [
    "Date",
    "Lock At",
    "Updated At",
    "Lineup DM Sent",
    "Lineup DM Sent At",
  ];

  if (rows.length === 0 || rows[0].join("|") !== expected.join("|")) {
    await writeSheet(SPREADSHEET_ID, "Game Locks!A1:E1", [expected]);
  }
}

export async function saveGameLock(
  date: string,
  lockAt: Date
): Promise<void> {
  await ensureGameLockHeaders();

  const rows = await readSheet(SPREADSHEET_ID, GAME_LOCKS_RANGE);
  const existingIndex = rows
    .slice(1)
    .findIndex((row) => String(row[0] ?? "").trim() === date);

  const values = [
    date,
    lockAt.toISOString(),
    new Date().toISOString(),
    false,
    "",
  ];

  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 2;
    await writeSheet(
      SPREADSHEET_ID,
      `Game Locks!A${rowNumber}:E${rowNumber}`,
      [values]
    );
    return;
  }

  await appendSheet(SPREADSHEET_ID, GAME_LOCKS_RANGE, [values]);
}

export async function getGameLock(
  date: string
): Promise<SavedGameLock | null> {
  await ensureGameLockHeaders();

  const rows = await readSheet(SPREADSHEET_ID, GAME_LOCKS_RANGE);

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (String(row[0] ?? "").trim() !== date) continue;

    return {
      rowNumber: index + 1,
      date,
      lockAt: String(row[1] ?? "").trim(),
      updatedAt: String(row[2] ?? "").trim(),
      lineupDmSent: isTruthy(row[3]),
      lineupDmSentAt: String(row[4] ?? "").trim(),
    };
  }

  return null;
}

export async function markGameLockDmSent(
  lock: SavedGameLock
): Promise<void> {
  await writeSheet(
    SPREADSHEET_ID,
    `Game Locks!D${lock.rowNumber}:E${lock.rowNumber}`,
    [[true, new Date().toISOString()]]
  );
}

export async function getSubmittedLineups(): Promise<SheetLineup[]> {
  const rows = await readSheet(SPREADSHEET_ID, SUBMITTED_LINEUPS_RANGE);
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeHeader);
  const teamIndex = headers.indexOf("team");
  const captainIndex = headers.indexOf("captain");
  const submittedAtIndex = headers.findIndex((header) =>
    ["submittedat", "submitted", "timestamp"].includes(header)
  );
  const playerIndexes = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => /^p[1-6]$/.test(header))
    .map(({ index }) => index);

  if (teamIndex < 0 || playerIndexes.length === 0) {
    throw new Error(
      "SubmittedLineups must have team, p1-p6, captain, and submitted_at headers."
    );
  }

  return rows
    .slice(1)
    .map((row) => ({
      team: String(row[teamIndex] ?? "").trim(),
      captain:
        captainIndex >= 0 ? String(row[captainIndex] ?? "").trim() : "",
      players: playerIndexes
        .map((index) => String(row[index] ?? "").trim())
        .filter(Boolean),
      submittedAt:
        submittedAtIndex >= 0
          ? String(row[submittedAtIndex] ?? "").trim()
          : "",
    }))
    .filter((lineup) => lineup.team && lineup.players.length > 0);
}
