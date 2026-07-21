import "dotenv/config";

import cron from "node-cron";
import { RealClient } from "./core/RealClient";
import { handleActivity } from "./handlers/ActivityHandler";
import { runLineupLock } from "./jobs/lineupLock";

const client = new RealClient();
client.loadSession();

const handledActivityIds = new Set<string>();
let lineupLockCheckRunning = false;

function getActivities(response: any): any[] {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.activities)) return response.activities;
  if (Array.isArray(response?.results)) return response.results;
  if (Array.isArray(response?.data)) return response.data;

  return [];
}

async function checkActivities(): Promise<void> {
  try {
    const response = await client.getActivity();
    const activities = getActivities(response);

    console.log(`Found ${activities.length} activities.`);

    for (const activity of activities) {
      const activityId = String(
        activity.id ??
        activity.activityId ??
        activity.commentId ??
        ""
      );

      if (!activityId) continue;
      if (handledActivityIds.has(activityId)) continue;

      handledActivityIds.add(activityId);

      await handleActivity(client, activity);
    }

    if (handledActivityIds.size > 500) {
      handledActivityIds.clear();
    }
  } catch (error) {
    console.error("Activity check failed:", error);
  }
}

async function checkLineupLock(): Promise<void> {
  if (lineupLockCheckRunning) {
    console.log("Skipping lineup-lock check because the previous check is still running.");
    return;
  }

  lineupLockCheckRunning = true;

  try {
    await runLineupLock();
  } catch (error) {
    console.error("Lineup-lock check failed:", error);
  } finally {
    lineupLockCheckRunning = false;
  }
}

console.log("FrelickBot command listener is running.");
console.log("Lineup-lock checker will run every 5 minutes.");

void checkActivities();

setInterval(() => {
  void checkActivities();
}, 15_000);

cron.schedule("*/5 * * * *", () => {
  void checkLineupLock();
});
