const fs = require("fs");
const path = require("path");

const filePath = path.join(
  process.cwd(),
  "src",
  "commands",
  "StatusCommand.ts"
);

let source = fs.readFileSync(filePath, "utf8");

const functionStart = source.indexOf(
  "async function getSubmittedTeamKeys(date: string): Promise<Set<string>> {"
);
const functionEndMarker = "\nasync function getLineupLockTime";
const functionEnd = source.indexOf(functionEndMarker, functionStart);

if (functionStart < 0 || functionEnd < 0) {
  throw new Error("Could not find the $status submitted-team verification function.");
}

const newCode = `async function getSubmittedTeamKeys(date: string): Promise<Set<string>> {
  const teamKeys = new Set<string>();

  const addTeam = (value: unknown): void => {
    const teamKey = normalizeTeamName(String(value || ""));
    if (teamKey) teamKeys.add(teamKey);
  };

  const getRows = (payload: any): any[] => {
    const candidates = [
      payload?.queuedLineups,
      payload?.lineups,
      payload?.submittedLineups,
      payload?.scores,
      payload?.teamScores,
      payload?.teams,
      payload?.rows,
      payload?.values,
      payload?.results,
      payload?.data,
      payload,
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) return candidate;
      if (Array.isArray(candidate?.rows)) return candidate.rows;
      if (Array.isArray(candidate?.values)) return candidate.values;
    }

    return [];
  };

  const getTeamName = (row: any): unknown => {
    if (Array.isArray(row)) return row[0];
    if (!row || typeof row !== "object") return "";

    return (
      row.team ??
      row.teamName ??
      row.submittedTeam ??
      row.submitedTeam ??
      row["Submitted team"] ??
      row["Submited team"] ??
      row.name ??
      row.club
    );
  };

  const getScore = (row: any): number => {
    if (Array.isArray(row)) {
      for (let index = 1; index < row.length; index += 1) {
        const value = Number(String(row[index] ?? "").replace(/,/g, ""));
        if (Number.isFinite(value)) return value;
      }
      return 0;
    }

    if (!row || typeof row !== "object") return 0;

    const rawScore =
      row.score ??
      row.teamScore ??
      row.totalScore ??
      row.total ??
      row.rax ??
      row.points;

    const score = Number(String(rawScore ?? "0").replace(/,/g, ""));
    return Number.isFinite(score) ? score : 0;
  };

  const tryAction = async (action: string): Promise<any | null> => {
    try {
      return await callLineupApi({ action, date, includeQueued: true });
    } catch (error) {
      console.warn(
        \`Status lineup API action \${action} is unavailable: \${
          error instanceof Error ? error.message : String(error)
        }\`
      );
      return null;
    }
  };

  // Count every lineup returned by either lookup. Do not exclude rows marked Used.
  const lineupResponses = await Promise.all([
    tryAction("getQueuedLineups"),
    tryAction("getSubmittedLineups"),
  ]);

  for (const response of lineupResponses) {
    if (!response) continue;

    const rows = getRows(response);
    const lineups = rowsToObjects(rows);

    for (const lineup of lineups) {
      addTeam(getLineupTeam(lineup));
    }
  }

  // A score above 0 also proves that the team has an active lineup.
  const scoreResponses = await Promise.all([
    tryAction("getTeamScores"),
    tryAction("getScores"),
  ]);

  for (const scoreResponse of scoreResponses) {
    if (!scoreResponse) continue;

    const scoreRows = getRows(scoreResponse);

    if (scoreRows.length > 0) {
      for (const row of scoreRows) {
        if (getScore(row) > 0) addTeam(getTeamName(row));
      }
      continue;
    }

    if (typeof scoreResponse === "object" && !Array.isArray(scoreResponse)) {
      const scoreMap =
        scoreResponse.scores && typeof scoreResponse.scores === "object"
          ? scoreResponse.scores
          : scoreResponse;

      for (const [team, rawScore] of Object.entries(scoreMap)) {
        const score = Number(String(rawScore ?? "0").replace(/,/g, ""));
        if (Number.isFinite(score) && score > 0) addTeam(team);
      }
    }
  }

  console.log(
    \`$status teams treated as submitted for \${date}: \${
      [...teamKeys].join(", ") || "none"
    }\`
  );

  return teamKeys;
}
`;

source =
  source.slice(0, functionStart) +
  newCode +
  source.slice(functionEnd + 1);

fs.writeFileSync(filePath, source);
console.log("Updated $status to use reminder-equivalent lineup verification.");
