const fs = require("fs");
const path = require("path");

const filePath = path.join(
  process.cwd(),
  "src",
  "jobs",
  "gmLineupReminders.ts"
);

const source = fs.readFileSync(filePath, "utf8");
const oldCode = "  const client = await RealClient.create();";
const newCode = [
  "  const client = new RealClient();",
  "  client.loadSession();",
].join("\n");

if (source.includes(oldCode)) {
  fs.writeFileSync(filePath, source.replace(oldCode, newCode));
  console.log("Fixed RealClient initialization in gmLineupReminders.ts");
} else if (
  source.includes("  const client = new RealClient();") &&
  source.includes("  client.loadSession();")
) {
  console.log("RealClient initialization is already fixed.");
} else {
  throw new Error("Could not find the expected RealClient initialization.");
}
