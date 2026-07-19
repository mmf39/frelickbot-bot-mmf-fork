import "dotenv/config";

import { RealClient } from "./core/RealClient";
import { handleActivity } from "./handlers/ActivityHandler";
import { startDailyLineupAnnouncement } from "./jobs/lineupAnnouncement";

async function main() {
  const client = new RealClient();

  client.loadSession();

  // Start the nightly 9:00 PM ET lineup announcement scheduler
  startDailyLineupAnnouncement(client);

  console.log("==========================");
  console.log("FrelickBot Started");
  console.log("==========================");

  const seen = new Set<string>();

  try {
    const initial = await client.getActivity();

    for (const activity of initial.activities ?? []) {
      seen.add(activity.id);
    }

    console.log(`Loaded ${seen.size} existing activities.`);
  } catch (err) {
    console.error("Failed to load initial activity:", err);
  }

  while (true) {
    try {
      const data = await client.getActivity();

      for (const activity of data.activities ?? []) {
        if (seen.has(activity.id)) continue;

        seen.add(activity.id);

        await handleActivity(client, activity);
      }
    } catch (err) {
      console.error(err);
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

main().catch(console.error);
