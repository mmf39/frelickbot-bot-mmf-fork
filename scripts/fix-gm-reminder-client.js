const fs = require("fs");
const path = require("path");

const filePath = path.join(
  process.cwd(),
  "src",
  "jobs",
  "gmLineupReminders.ts"
);

let source = fs.readFileSync(filePath, "utf8");

const oldClientCode = "  const client = await RealClient.create();";
const newClientCode = [
  "  const client = new RealClient();",
  "  client.loadSession();",
].join("\n");

if (source.includes(oldClientCode)) {
  source = source.replace(oldClientCode, newClientCode);
  console.log("Fixed RealClient initialization in gmLineupReminders.ts");
} else if (
  source.includes("  const client = new RealClient();") &&
  source.includes("  client.loadSession();")
) {
  console.log("RealClient initialization is already fixed.");
} else {
  throw new Error("Could not find the expected RealClient initialization.");
}

const replacement = `async function getSubmittedTeamKeys(date: string): Promise<Set<string>> {
  const teamKeys = new Set<string>();
  const spreadsheetId = String(process.env.GOOGLE_SPREADSHEET_ID || "").trim();

  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is not configured.");
  }

  const normalizeDate = (value: unknown): string => {
    const text = String(value ?? "").trim();
    if (!text) return "";

    const isoMatch = text.match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})/);
    if (isoMatch) {
      return [
        isoMatch[1],
        String(Number(isoMatch[2])).padStart(2, "0"),
        String(Number(isoMatch[3])).padStart(2, "0"),
      ].join("-");
    }

    const usMatch = text.match(/^(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?/);
    if (usMatch) {
      let year = usMatch[3] ? Number(usMatch[3]) : Number(date.slice(0, 4));
      if (year < 100) year += 2000;

      return [
        year,
        String(Number(usMatch[1])).padStart(2, "0"),
        String(Number(usMatch[2])).padStart(2, "0"),
      ].join("-");
    }

    return "";
  };

  const queuedRows = await readSheet(
    spreadsheetId,
    "Queued Lineups!A:L"
  );

  if (queuedRows.length > 1) {
    const headers = queuedRows[0].map((header) =>
      String(header ?? "").trim().toLowerCase()
    );
    const dateIndex = headers.findIndex((header) =>
      header === "game date" || header === "date"
    );
    const teamIndex = headers.findIndex((header) =>
      header === "submited team" ||
      header === "submitted team" ||
      header === "team"
    );

    if (dateIndex >= 0 && teamIndex >= 0) {
      for (const row of queuedRows.slice(1)) {
        if (normalizeDate(row[dateIndex]) !== date) continue;

        const teamKey = normalizeTeamName(String(row[teamIndex] ?? ""));
        if (teamKey) teamKeys.add(teamKey);
      }
    }
  }

  const inProgressRows = await readSheet(
    spreadsheetId,
    "In Progress!A:Z"
  );

  for (const row of inProgressRows) {
    for (const cell of row) {
      const match = String(cell ?? "")
        .trim()
        .match(/^(.+?)\\s*\\((-?[\\d,]+(?:\\.\\d+)?)\\)$/);

      if (!match) continue;

      const score = Number(match[2].replace(/,/g, ""));
      if (!Number.isFinite(score) || score <= 0) continue;

      const teamKey = normalizeTeamName(match[1]);
      if (teamKey) teamKeys.add(teamKey);
    }
  }

  console.log(
    \`Reminder teams treated as having a lineup for \${date}: \${
      [...teamKeys].join(", ") || "none"
    }\`
  );

  return teamKeys;
}`;

const functionPattern = /async function getSubmittedTeamKeys\(date: string\): Promise<Set<string>> \{[\s\S]*?\n\}\n\nasync function getTeamRecords/;

if (!functionPattern.test(source)) {
  throw new Error("Could not find the GM reminder lineup-verification function.");
}

source = source.replace(
  functionPattern,
  `${replacement}\n\nasync function getTeamRecords`
);

fs.writeFileSync(filePath, source);
console.log("Updated GM reminders to read Queued Lineups and In Progress directly.");
