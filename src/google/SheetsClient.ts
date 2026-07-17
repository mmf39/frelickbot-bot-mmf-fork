import "dotenv/config";

import { google } from "googleapis";
import fs from "fs";
import path from "path";

const credentialsPath = path.join(
  process.cwd(),
  "google-service-account.json"
);

const credentials = JSON.parse(
  fs.readFileSync(credentialsPath, "utf8")
);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ],
});

const sheets = google.sheets({
  version: "v4",
  auth,
});

export async function readSheet(
  spreadsheetId: string,
  range: string
): Promise<string[][]> {
  if (!spreadsheetId) {
    throw new Error(
      `Spreadsheet ID is missing for range "${range}"`
    );
  }

  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

  return (
    response.data.values as string[][] | undefined
  ) ?? [];
}
