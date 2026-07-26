import { getRosters } from "../google/RostersService";
import { getContracts } from "../google/SalaryCapService";

function normalizePlayerName(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^\p{L}\p{N}\p{Extended_Pictographic}]/gu, "");
}

function displayPlayerName(value: string): string {
  return String(value || "").trim().replace(/^@/, "");
}

function formatNumber(value: number): string {
  return Number(value || 0).toLocaleString("en-US");
}

export function parseWhoHasCommand(text: string): string | null {
  const match = String(text || "").match(
    /(?:^|\s)[$@]whohas(?:\s+([^\n]+))?/i
  );

  if (!match) {
    return null;
  }

  return String(match[1] || "").trim();
}

export async function buildWhoHasMessage(
  playerSearch: string
): Promise<string> {
  const searchKey = normalizePlayerName(playerSearch);

  if (!searchKey) {
    return [
      "Please enter a player name.",
      "",
      "Example:",
      "$whohas jordancarter",
    ].join("\n");
  }

  const rosters = await getRosters();
  const rosteredPlayers = rosters.flatMap((roster) =>
    roster.players.map((player) => ({
      team: roster.team,
      player,
      key: normalizePlayerName(player),
    }))
  );

  let matches = rosteredPlayers.filter(
    (entry) => entry.key === searchKey
  );

  if (matches.length === 0) {
    matches = rosteredPlayers.filter(
      (entry) =>
        entry.key.includes(searchKey) ||
        searchKey.includes(entry.key)
    );
  }

  if (matches.length > 1) {
    const uniqueMatches = Array.from(
      new Map(matches.map((entry) => [entry.key, entry])).values()
    );

    if (uniqueMatches.length > 1) {
      return [
        `I found multiple players matching "${playerSearch}":`,
        "",
        ...uniqueMatches
          .slice(0, 10)
          .map(
            (entry) =>
              `• ${displayPlayerName(entry.player)} — ${entry.team}`
          ),
        "",
        "Please enter a more specific player name.",
      ].join("\n");
    }

    matches = uniqueMatches;
  }

  if (matches.length === 0) {
    return [
      `🔍 ${displayPlayerName(playerSearch)}`,
      "",
      "❌ Free Agent",
    ].join("\n");
  }

  const found = matches[0];
  const contracts = await getContracts();
  const contract = contracts.find(
    (entry) =>
      normalizePlayerName(entry.player) === found.key
  );

  return [
    `🔍 ${displayPlayerName(found.player)}`,
    "",
    `💪 Team: ${found.team}`,
    `💰 Cap Hit: ${contract ? formatNumber(contract.currentCapHit) : "N/A"}`,
    `📈 Total Rax: ${contract ? formatNumber(contract.totalRax) : "N/A"}`,
    `📄 Years Left: ${contract ? formatNumber(contract.yearsLeft) : "N/A"}`,
  ].join("\n");
}
