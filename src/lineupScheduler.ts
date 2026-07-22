import "dotenv/config";
import "./jobDmOnlyPatch";

import { runLineupLock } from "./jobs/lineupLock";

const LINEUP_LOCK_INTERVAL_MS = 5 * 60 * 1000;

let lineupLockRunning = false;

async function checkLineupLock(): Promise<void> {
  if (lineupLockRunning) {
    console.log("Lineup-lock check already running.");
    return;
  }

  lineupLockRunning = true;

  try {
    await runLineupLock();
  } catch (error) {
    console.error("Lineup-lock check failed:", error);
  } finally {
    lineupLockRunning = false;
  }
}

console.log("Starting Railway lineup-lock scheduler.");

void checkLineupLock();

setInterval(() => {
  void checkLineupLock();
}, LINEUP_LOCK_INTERVAL_MS);
