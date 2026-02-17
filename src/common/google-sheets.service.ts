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

      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `'${this.TAB_NAME}'`, // tab name only is fine for append
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] },
      });
    } catch (err: any) {
      const message = err?.message || '';

      // ✅ if sheet is already huge, don't spam logs / crash workers
      if (message.includes('above the limit of 10000000 cells')) {
        console.warn('⚠️ Google Sheet cell limit reached. Skipping append.');
        return;
      }

      if (message.includes('Quota exceeded')) {
        console.warn('⚠️ Google Sheets quota exceeded. Skipping append.');
        return;
      }

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
    const rows = await this.read(`'${this.TAB_NAME}'`);
    if (!rows.length) return [];

    const hasHeader =
      String(rows[0]?.[0] ?? '').toLowerCase() === 'jobid' ||
      String(rows[0]?.[0] ?? '').toLowerCase() === 'id';

    const dataRows = hasHeader ? rows.slice(1) : rows;
    return dataRows.slice(-limit).reverse();
  }
}
