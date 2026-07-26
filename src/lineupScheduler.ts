import "dotenv/config";
import "./jobDmOnlyPatch";

import { runGmLineupReminders } from "./jobs/gmLineupReminders";
import { runLineupLock } from "./jobs/lineupLock";

const LINEUP_LOCK_INTERVAL_MS = 5 * 60 * 1000;

let lineupJobsRunning = false;

async function checkLineupJobs(): Promise<void> {
  if (lineupJobsRunning) {
    console.log("Lineup job check already running.");
    return;
  }

  lineupJobsRunning = true;

  try {
    await runLineupLock();
  } catch (error) {
    console.error("Lineup-lock check failed:", error);
  }

  try {
    await runGmLineupReminders();
  } catch (error) {
    console.error("GM lineup-reminder check failed:", error);
  } finally {
    lineupJobsRunning = false;
  }
}

console.log("Starting Railway lineup-lock and GM-reminder scheduler.");

void checkLineupJobs();

setInterval(() => {
  void checkLineupJobs();
}, LINEUP_LOCK_INTERVAL_MS);
