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

export async function getCompletedGamesForLeagueDay(
  leagueDay: string
): Promise<CompletedGame[]> {
  /*
   * This function must read the Completed Games sheet and find:
   *
   * League Day: M/D
   *
   * It should return every matchup listed underneath that heading.
   *
   * I need to connect this portion to the Google Sheets-reading code
   * already used in your project because I do not yet have that file.
   */

  throw new Error(
    `getCompletedGamesForLeagueDay(${leagueDay}) still needs to be connected to the Google Sheet reader.`
  );
}
