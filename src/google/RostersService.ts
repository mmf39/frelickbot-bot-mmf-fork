import { readSheet } from "./SheetsClient";

const SPREADSHEET_ID =
  process.env.LEAGUE_SPREADSHEET_ID!;

export interface TeamRoster {
  team: string;
  gm: string;
  players: string[];
}

function cleanCell(value: unknown): string {
  return String(value ?? "").trim();
}

function isGmRow(value: string): boolean {
  return /^gm\s*=/i.test(value);
}

function parseGmUsername(value: string): string {
  const username = cleanCell(value)
    .replace(/^gm\s*=\s*/i, "")
    .replace(/^@/, "")
    .trim();

  return username ? `@${username}` : "";
}

function isPlayer(value: string): boolean {
  return value.startsWith("@");
}

function isTeamHeader(
  rows: string[][],
  rowIndex: number,
  columnIndex: number
): boolean {
  const currentCell = cleanCell(
    rows[rowIndex]?.[columnIndex]
  );

  const nextCell = cleanCell(
    rows[rowIndex + 1]?.[columnIndex]
  );

  if (!currentCell) {
    return false;
  }

  return isGmRow(nextCell);
}

export async function getRosters(): Promise<
  TeamRoster[]
> {
  if (!SPREADSHEET_ID) {
    throw new Error(
      "LEAGUE_SPREADSHEET_ID is missing"
    );
  }

  const rows = await readSheet(
    SPREADSHEET_ID,
    "Teams!A:Z"
  );

  const rosters: TeamRoster[] = [];

  const maximumColumns = rows.reduce(
    (largest, row) =>
      Math.max(largest, row.length),
    0
  );

  for (
    let columnIndex = 0;
    columnIndex < maximumColumns;
    columnIndex++
  ) {
    let rowIndex = 0;

    while (rowIndex < rows.length) {
      if (
        !isTeamHeader(
          rows,
          rowIndex,
          columnIndex
        )
      ) {
        rowIndex++;
        continue;
      }

      const team = cleanCell(
        rows[rowIndex]?.[columnIndex]
      );

      const gm = parseGmUsername(
        cleanCell(rows[rowIndex + 1]?.[columnIndex])
      );

      const players: string[] = [];

      rowIndex += 2;

      while (rowIndex < rows.length) {
        if (
          isTeamHeader(
            rows,
            rowIndex,
            columnIndex
          )
        ) {
          break;
        }

        const cell = cleanCell(
          rows[rowIndex]?.[columnIndex]
        );

        if (isPlayer(cell)) {
          players.push(cell);
        }

        rowIndex++;
      }

      rosters.push({
        team,
        gm,
        players,
      });
    }
  }

  return rosters;
}
