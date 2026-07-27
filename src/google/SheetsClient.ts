import "dotenv/config";

import fs from "fs";
import path from "path";
import { google } from "googleapis";

function loadGoogleCredentials(): Record<string, unknown> {
  const railwayCredentials =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (railwayCredentials) {
    try {
      return JSON.parse(railwayCredentials);
    } catch {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_JSON contains invalid JSON"
      );
    }
  }

  const credentialsPath = path.join(
    process.cwd(),
    "google-service-account.json"
  );

  if (fs.existsSync(credentialsPath)) {
    try {
      const file = fs.readFileSync(
        credentialsPath,
        "utf8"
      );

      return JSON.parse(file);
    } catch {
      throw new Error(
        "google-service-account.json contains invalid JSON"
      );
    }
  }

  throw new Error(
    "Google credentials were not found. Add GOOGLE_SERVICE_ACCOUNT_JSON in Railway or keep google-service-account.json locally."
  );
}

const credentials = loadGoogleCredentials();

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
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

export async function updateSheetValues(
  spreadsheetId: string,
  range: string,
  values: Array<Array<string | number | boolean>>
): Promise<void> {
  if (!spreadsheetId) {
    throw new Error(
      `Spreadsheet ID is missing for range "${range}"`
    );
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values,
    },
  });
}

export async function appendSheetRows(
  spreadsheetId: string,
  range: string,
  rows: Array<Array<string | number | boolean>>
): Promise<void> {
  if (!spreadsheetId) {
    throw new Error(
      `Spreadsheet ID is missing for range "${range}"`
    );
  }

  if (!rows.length) return;

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows,
    },
  });
}

export async function ensureSheetExists(
  spreadsheetId: string,
  sheetName: string,
  headers: string[] = []
): Promise<void> {
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is missing.");
  }

  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });

  const exists = metadata.data.sheets?.some(
    (sheet) => sheet.properties?.title === sheetName
  );

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName,
              },
            },
          },
        ],
      },
    });
  }

  if (!headers.length) return;

  const existing = await readSheet(
    spreadsheetId,
    `'${sheetName}'!A1:${String.fromCharCode(64 + headers.length)}1`
  );

  if (existing.length === 0 || existing[0].length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [headers],
      },
    });
  }
}
