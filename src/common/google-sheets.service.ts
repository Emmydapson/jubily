/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import * as path from 'path';

@Injectable()
export class GoogleSheetsService {
  private sheets: any;
  private automationLogSheetId: number | null = null;

  // ✅ keep sheet small (tune these)
  private readonly MAX_LOG_ROWS = Number(process.env.SHEETS_MAX_LOG_ROWS || 5000); // data rows (excluding header)
  private readonly TRIM_BATCH = Number(process.env.SHEETS_TRIM_BATCH || 500); // delete this many oldest rows at a time
  private readonly TAB_NAME = 'Automation Log';

  constructor() {
    const auth = new google.auth.GoogleAuth({
      keyFile: path.join(process.cwd(), 'credentials/google-service-account.json'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
  }

  private get spreadsheetId() {
    const id = process.env.GOOGLE_SHEET_ID;
    if (!id) throw new Error('Missing GOOGLE_SHEET_ID');
    return id;
  }

  private normalizeRow(row: any[]) {
  const safe = Array.isArray(row) ? row : [];

  // pad to expected length so indexes always exist
  while (safe.length < 10) safe.push('');

  return {
    jobId: String(safe[0] ?? ''),
    scriptId: String(safe[1] ?? ''),
    topicTitle: String(safe[2] ?? ''),
    product: String(safe[3] ?? ''),      // offerName
    platform: String(safe[4] ?? ''),
    status: String(safe[5] ?? ''),
    url: String(safe[6] ?? ''),
    note: String(safe[7] ?? ''),
    createdAt: String(safe[8] ?? ''),
    updatedAt: String(safe[9] ?? ''),
  };
}

  private tabRange(a1: string) {
    // e.g. "'Automation Log'!A1:A1"
    return `'${this.TAB_NAME}'!${a1}`;
  }

  private async ensureSheetIdLoaded() {
    if (this.automationLogSheetId !== null) return;

    const meta = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      fields: 'sheets.properties',
    });

    const sheet = (meta.data.sheets || []).find(
      (s: any) => s?.properties?.title === this.TAB_NAME,
    );

    if (!sheet?.properties?.sheetId && sheet?.properties?.sheetId !== 0) {
      throw new Error(`Sheet tab '${this.TAB_NAME}' not found`);
    }

    this.automationLogSheetId = sheet.properties.sheetId;
  }

  /**
   * ✅ Trim old rows if we exceed MAX_LOG_ROWS.
   * Keeps header row (row 1).
   *
   * Strategy:
   * - Check if there is any value at row = (MAX_LOG_ROWS + 2).
   *   (Row 1 = header, rows 2..(MAX+1) = allowed data, row (MAX+2) means overflow)
   * - If overflow exists, delete TRIM_BATCH oldest rows starting from row 2.
   */
  private async trimIfNeeded() {
    await this.ensureSheetIdLoaded();

    const overflowRow = this.MAX_LOG_ROWS + 2; // 1 header + MAX data + 1 overflow check
    const check = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: this.tabRange(`A${overflowRow}:A${overflowRow}`),
    });

    const hasOverflow = (check.data.values || []).length > 0;
    if (!hasOverflow) return;

    const startIndex = 1; // 0-based. 1 = row 2 (keep header at row 1)
    const endIndex = 1 + this.TRIM_BATCH;

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: this.automationLogSheetId!,
                dimension: 'ROWS',
                startIndex,
                endIndex,
              },
            },
          },
        ],
      },
    });
  }

  /**
   * Appends a row to the 'Automation Log' sheet (bounded size)
   */
  async append(row: any[]) {
  try {
    await this.trimIfNeeded();

    const r = Array.isArray(row) ? [...row] : [];
    while (r.length < 10) r.push('');

    // stringify dates (Sheets RAW + Date objects can behave weird)
    r[8] = r[8] instanceof Date ? r[8].toISOString() : String(r[8] ?? '');
    r[9] = r[9] instanceof Date ? r[9].toISOString() : String(r[9] ?? '');

    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: this.tabRange('A:Z'),
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [r] },
    });
  } catch (err: any) {
    // keep your existing error handling
    const message = err?.message || '';
    if (message.includes('above the limit of 10000000 cells')) return;
    if (message.includes('Quota exceeded')) return;
    console.error('Failed to append to Google Sheet:', message);
  }
}
  async read(range: string) {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
    });

    return res.data.values ?? [];
  }

  async getAutomationLogs(limit = 20) {
  const rows = await this.read(this.tabRange('A:Z'));
  if (!rows.length) return [];

  const hasHeader =
    String(rows[0]?.[0] ?? '').toLowerCase() === 'jobid' ||
    String(rows[0]?.[0] ?? '').toLowerCase() === 'id';

  const dataRows = hasHeader ? rows.slice(1) : rows;
  const last = dataRows.slice(-limit).reverse();

  return last.map((r: any[]) => this.normalizeRow(r));
}
}
