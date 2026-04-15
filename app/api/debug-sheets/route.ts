import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';

const SPREADSHEET_ID = '1t8sY-JBkSDAnIBhQA_xwotRjxAzRCJ1XMUrxbpHlJpM';

function getAuth() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (clientId && clientSecret && refreshToken) {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    return oauth2;
  }
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('No auth');
  return new google.auth.GoogleAuth({ credentials: JSON.parse(raw), scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
}

export async function GET() {
  const auth = getAuth();
  const resolvedAuth = auth instanceof GoogleAuth ? await auth.getClient() : auth;
  const sheets = google.sheets({ version: 'v4', auth: resolvedAuth as never });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const tabs = meta.data.sheets?.map(s => s.properties?.title ?? '') ?? [];

  const risultati: Record<string, unknown[]> = {};

  for (const tab of tabs) {
    if (tab === 'Prima Nota App') continue;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tab}'!A:P`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = (res.data.values ?? []) as (string|number)[][];
    const hIdx = rows.findIndex(r => String(r[0]??'').trim() === 'Tipologia');
    if (hIdx === -1) continue;

    const affittoRows = [];
    for (let i = hIdx + 1; i < rows.length; i++) {
      const tipo = String(rows[i][0]??'').trim().toLowerCase();
      if (tipo === 'affitto') {
        affittoRows.push({ idx: i, row: rows[i].slice(0, 16) });
        if (affittoRows.length >= 5) break;
      }
    }
    if (affittoRows.length > 0) risultati[tab] = affittoRows;
  }

  return NextResponse.json({ tabs, risultati });
}
