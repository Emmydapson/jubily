import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import * as path from 'path';

@Injectable()
export class GoogleSheetsService {
  private sheets;

  constructor() {
    const auth = new google.auth.GoogleAuth({
      keyFile: path.join(process.cwd(), 'credentials/google-service-account.json'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
  }

  /**
   * Appends a row to the 'Automation Log' sheet
   */
  async append(row: any[]) {
    try {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `'Automation Log'`, // <-- wrap tab name in single quotes
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS', // ensures it always appends
        requestBody: {
          values: [row],
        },
      });
    } catch (err) {
      console.error('Failed to append to Google Sheet:', err.message);
    }
  }
}
