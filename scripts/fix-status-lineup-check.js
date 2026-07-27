const fs = require("fs");
const path = require("path");

const filePath = path.join(
  process.cwd(),
  "src",
  "commands",
  "StatusCommand.ts"
);

let source = fs.readFileSync(filePath, "utf8");

const oldCode = `async function getSubmittedTeamKeys(date: string): Promise<Set<string>> {
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
}`;

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

  const queuedResponse =
    (await tryAction("getQueuedLineups")) ||
    (await tryAction("getSubmittedLineups"));

  if (queuedResponse) {
    const queuedRows = getRows(queuedResponse);

    if (queuedRows.length > 0) {
      for (const row of rowsToObjects(queuedRows)) {
        if (!isQueuedLineup(row)) continue;
        addTeam(getLineupTeam(row));
      }
    }
  }

  const scoreResponse =
    (await tryAction("getTeamScores")) ||
    (await tryAction("getScores"));

  if (scoreResponse) {
    const scoreRows = getRows(scoreResponse);

    if (scoreRows.length > 0) {
      for (const row of scoreRows) {
        if (getScore(row) > 0) addTeam(getTeamName(row));
      }
    } else if (
      typeof scoreResponse === "object" &&
      !Array.isArray(scoreResponse)
    ) {
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
}`;

if (source.includes(oldCode)) {
  source = source.replace(oldCode, newCode);
  fs.writeFileSync(filePath, source);
  console.log("Updated $status lineup verification.");
} else if (
  source.includes("$status teams treated as submitted") &&
  source.includes('tryAction("getTeamScores")')
) {
  console.log("$status lineup verification is already updated.");
} else {
  throw new Error("Could not find the expected $status lineup verification function.");
}
