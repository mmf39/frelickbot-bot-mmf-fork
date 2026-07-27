const fs = require("fs");
const path = require("path");

const filePath = path.join(
  process.cwd(),
  "src",
  "jobs",
  "lineupLock.ts"
);

let source = fs.readFileSync(filePath, "utf8");

if (!source.includes("function getLatestLineups(")) {
  const marker = "function getOrderedPlayers(lineup: SubmittedLineup): string[] {";
  const helper = `function getLatestLineups(lineups: SubmittedLineup[]): SubmittedLineup[] {
  const latestByTeam = new Map<string, SubmittedLineup>();

  for (const lineup of lineups) {
    const key = normalizeTeamName(String(lineup.team || ""));
    if (!key) continue;

    const existing = latestByTeam.get(key);

    if (!existing) {
      latestByTeam.set(key, lineup);
      continue;
    }

    const currentTime = Date.parse(String(lineup.submittedAt || "")) || 0;
    const existingTime = Date.parse(String(existing.submittedAt || "")) || 0;

    if (currentTime >= existingTime) {
      latestByTeam.set(key, lineup);
    }
  }

  return [...latestByTeam.values()];
}

`;

  if (!source.includes(marker)) {
    throw new Error("Could not find the lineup helper insertion point.");
  }

  source = source.replace(marker, helper + marker);
  fs.writeFileSync(filePath, source);
  console.log("Restored getLatestLineups in lineupLock.ts");
} else {
  console.log("getLatestLineups is already present.");
}
