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

const oldLineupCode = `async function getSubmittedTeamKeys(date: string): Promise<Set<string>> {
  const response = await callLineupApi("getSubmittedLineups", { date });
  return new Set(
    extractSubmittedLineups(response)
      .map((lineup) => normalizeTeamName(String(lineup.team || "")))
      .filter(Boolean)
  );
}`;

const newLineupCode = `async function getSubmittedTeamKeys(date: string): Promise<Set<string>> {
  const teamKeys = new Set<string>();

  const addTeam = (value: unknown): void => {
    const key = normalizeTeamName(String(value || ""));
    if (key) teamKeys.add(key);
  };

  const getRows = (payload: any): any[] => {
    const candidates = [
      payload?.queuedLineups,
      payload?.lineups,
      payload?.submittedLineups,
      payload?.scores,
      payload?.teamScores,
      payload?.teams,
      payload?.results,
      payload?.data,
      payload,
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) return candidate;
    }

    return [];
  };

  const getTeamName = (row: any): unknown => {
    if (Array.isArray(row)) return row[0];
    if (!row || typeof row !== "object") return "";
    return row.team ?? row.teamName ?? row.name ?? row.club;
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

  const tryLineupAction = async (action: string): Promise<any | null> => {
    try {
      return await callLineupApi(action, { date });
    } catch (error) {
      console.warn(
        \`Lineup API action \${action} is unavailable: \${
          error instanceof Error ? error.message : String(error)
        }\`
      );
      return null;
    }
  };

  // A queued lineup always counts as submitted, even when the score is still 0.
  const queuedResponse =
    (await tryLineupAction("getQueuedLineups")) ||
    (await tryLineupAction("getSubmittedLineups"));

  if (queuedResponse) {
    for (const lineup of getRows(queuedResponse)) {
      addTeam(getTeamName(lineup));
    }
  }

  // If no queued lineup exists, a score above 0 also proves that a lineup is active.
  const scoreResponse =
    (await tryLineupAction("getTeamScores")) ||
    (await tryLineupAction("getScores"));

  if (scoreResponse) {
    const rows = getRows(scoreResponse);

    if (rows.length) {
      for (const row of rows) {
        if (getScore(row) > 0) addTeam(getTeamName(row));
      }
    } else if (
      scoreResponse &&
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
    \`Teams treated as having a lineup for \${date}: \${
      [...teamKeys].join(", ") || "none"
    }\`
  );

  return teamKeys;
}`;

if (source.includes(oldLineupCode)) {
  source = source.replace(oldLineupCode, newLineupCode);
  console.log("Added queued-lineup and score fallback checks.");
} else if (
  source.includes('tryLineupAction("getQueuedLineups")') &&
  source.includes('tryLineupAction("getTeamScores")')
) {
  console.log("Queued-lineup and score checks are already installed.");
} else {
  throw new Error("Could not find the expected submitted-lineup function.");
}

fs.writeFileSync(filePath, source);
