import "dotenv/config";

import fs from "fs";
import path from "path";
import { google } from "googleapis";

function loadGoogleCredentials(): Record<string, unknown> {
  const railwayCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (railwayCredentials) {
    try {
      return JSON.parse(railwayCredentials);
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON contains invalid JSON");
    }
  }

  const credentialsPath = path.join(
    process.cwd(),
    "google-service-account.json"
  );

  if (fs.existsSync(credentialsPath)) {
    try {
      return JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
    } catch {
      throw new Error("google-service-account.json contains invalid JSON");
    }
  }

  throw new Error(
    "Google credentials were not found. Add GOOGLE_SERVICE_ACCOUNT_JSON in Railway or keep google-service-account.json locally."
  );
}

const credentials = loadGoogleCredentials();

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
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
    throw new Error(`Spreadsheet ID is missing for range "${range}"`);
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  return (response.data.values as string[][] | undefined) ?? [];
}

export async function writeSheet(
  spreadsheetId: string,
  range: string,
  values: unknown[][]
): Promise<void> {
  if (!spreadsheetId) {
    throw new Error(`Spreadsheet ID is missing for range "${range}"`);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

export async function appendSheet(
  spreadsheetId: string,
  range: string,
  values: unknown[][]
): Promise<void> {
  if (!spreadsheetId) {
    throw new Error(`Spreadsheet ID is missing for range "${range}"`);
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}
