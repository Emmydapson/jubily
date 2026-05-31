/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable prettier/prettier */
import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { decryptString, encryptString } from '../settings/settings.crypto';

type YoutubeTokens = {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string | null;
  expiry_date?: number | null;
};

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(YoutubeService.name);
  private oauth;
  private tokensLoaded = false;
  private activeFileTokenPath: string | null = null;
  private currentTokens: YoutubeTokens = {};

  constructor(private prisma: PrismaService) {
    this.oauth = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      process.env.YOUTUBE_REDIRECT,
    );

    this.oauth.on('tokens', (newTokens: YoutubeTokens) => {
      this.currentTokens = {
        ...this.currentTokens,
        ...newTokens,
        refresh_token: newTokens.refresh_token || this.currentTokens.refresh_token,
      };

      void this.persistTokens(this.currentTokens).catch((error: unknown) => {
        this.logger.warn(`[YouTube] token refresh persistence failed msg=${error instanceof Error ? error.message : String(error)}`);
      });
    });
  }

  private tokenCandidates() {
    const cwd = process.cwd();
    const dir = __dirname;
    return [
      path.resolve(cwd, 'credentials', 'youtube-token.json'),
      path.resolve(dir, '..', '..', 'credentials', 'youtube-token.json'),
      path.resolve(dir, '..', 'credentials', 'youtube-token.json'),
    ];
  }

  private shortHost(url: string) {
    try {
      return new URL(url).host;
    } catch {
      return 'invalid-url';
    }
  }

  private async readDbTokens(): Promise<YoutubeTokens | null> {
    const row = await this.prisma.integrationKey.findUnique({
      where: { provider: 'YOUTUBE' },
      select: { encrypted: true },
    });
    if (!row?.encrypted) return null;

    return JSON.parse(decryptString(row.encrypted)) as YoutubeTokens;
  }

  private readFileTokens(): YoutubeTokens | null {
    const tokenPath = this.tokenCandidates().find((p) => fs.existsSync(p));
    if (!tokenPath) return null;

    this.activeFileTokenPath = tokenPath;
    const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8')) as YoutubeTokens;
    if (!tokens.refresh_token && !tokens.access_token) {
      throw new Error('legacy YouTube token file has no usable token fields');
    }
    return tokens;
  }

  private async persistTokens(tokens: YoutubeTokens) {
    if (!tokens.refresh_token && !tokens.access_token) return;

    const packed = JSON.stringify(tokens);
    try {
      const { encrypted, last4 } = encryptString(packed);
      await this.prisma.integrationKey.upsert({
        where: { provider: 'YOUTUBE' },
        update: { encrypted, last4 },
        create: { provider: 'YOUTUBE', encrypted, last4 },
      });
      this.logger.log('[YouTube] OAuth token persisted to encrypted DB storage');
    } catch (error: unknown) {
      const allowFileWrite = process.env.YOUTUBE_ALLOW_FILE_TOKEN_FALLBACK === 'true';
      if (!this.activeFileTokenPath || !allowFileWrite) throw error;
      fs.writeFileSync(this.activeFileTokenPath, JSON.stringify(tokens, null, 2));
      this.logger.warn('[YouTube] OAuth token persisted to legacy file fallback because DB encryption failed');
    }
  }

  async tokenStorageStatus() {
    const dbToken = await this.prisma.integrationKey.findUnique({
      where: { provider: 'YOUTUBE' },
      select: { updatedAt: true },
    });
    const legacyFilePath = this.tokenCandidates().find((p) => fs.existsSync(p));

    return {
      encryptedDbConfigured: Boolean(dbToken),
      encryptedDbUpdatedAt: dbToken?.updatedAt ?? null,
      legacyFilePresent: Boolean(legacyFilePath),
      legacyFileWriteFallbackEnabled: process.env.YOUTUBE_ALLOW_FILE_TOKEN_FALLBACK === 'true',
    };
  }

  private async ensureTokensLoaded() {
    if (this.tokensLoaded) return;

    let tokens: YoutubeTokens | null = null;
    try {
      tokens = await this.readDbTokens();
      if (tokens) {
        this.logger.log('[YouTube] using encrypted DB OAuth token');
      }
    } catch (error: unknown) {
      this.logger.warn(`[YouTube] DB token load failed; trying file fallback msg=${error instanceof Error ? error.message : String(error)}`);
    }

    if (!tokens) {
      tokens = this.readFileTokens();
      if (tokens) {
        this.logger.warn('[YouTube] using legacy file OAuth token fallback; migrate to encrypted DB storage');
        await this.persistTokens(tokens).catch((error: unknown) => {
          this.logger.warn(`[YouTube] legacy token migration skipped msg=${error instanceof Error ? error.message : String(error)}`);
        });
      }
    }

    if (!tokens) {
      this.logger.warn('[YouTube] no OAuth token configured; connect YouTube before publishing');
      this.tokensLoaded = true;
      return;
    }

    this.currentTokens = tokens;
    this.oauth.setCredentials(tokens);
    this.tokensLoaded = true;
  }

  getAuthUrl(state?: string) {
    return this.oauth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube.force-ssl',
      ],
      include_granted_scopes: true,
      response_type: 'code',
      ...(state ? { state } : {}),
    });
  }

  async handleAuthCallback(code: string) {
    const { tokens } = await this.oauth.getToken(code);

    if (!tokens.refresh_token) {
      throw new Error('No refresh token received. Try again.');
    }

    const merged: YoutubeTokens = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      expiry_date: tokens.expiry_date,
    };

    this.currentTokens = merged;
    this.oauth.setCredentials(merged);
    await this.persistTokens(merged);
    this.tokensLoaded = true;

    return { connected: true, scope: merged.scope, expiry_date: merged.expiry_date };
  }

  async upload(
    title: string,
    description: string,
    videoUrl: string,
    tags: string[] = [],
  ): Promise<string>  {
    if (!videoUrl) throw new Error('Missing videoUrl for upload');
    await this.ensureTokensLoaded();
    if (!this.currentTokens.refresh_token && !this.currentTokens.access_token) {
      throw new Error('YouTube OAuth token is not configured');
    }

    const youtube = google.youtube({ version: 'v3', auth: this.oauth });
    const host = this.shortHost(videoUrl);

    let videoStreamRes;
    try {
      videoStreamRes = await axios.get(videoUrl, {
        responseType: 'stream',
        maxRedirects: 5,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: '*/*',
        },
        timeout: 120_000,
      });
    } catch (e: any) {
      this.logger.warn(`[YouTube] video download failed host=${host} status=${e?.response?.status || 'unknown'} msg=${e?.message || e}`);
      throw new Error(`Download failed (${e?.response?.status || 'unknown'}) from host=${host}`);
    }

    const contentType = String(videoStreamRes.headers['content-type'] || '');
    if (!contentType.includes('video') && !contentType.includes('octet-stream')) {
      this.logger.warn(`[YouTube] unexpected content-type host=${host} contentType=${contentType || 'unknown'}`);
    }

    const safeTitle = (title || 'Untitled').slice(0, 95);
    const safeDesc = (description || '').slice(0, 4500);

    try {
      this.logger.log(`[YouTube] upload started host=${host} titleLength=${safeTitle.length}`);
      const res = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: safeTitle,
            description: safeDesc,
            tags: tags.slice(0, 25),
            categoryId: '22',
          },
          status: {
            privacyStatus: process.env.YOUTUBE_PRIVACY || 'unlisted',
            selfDeclaredMadeForKids: false,
          },
        },
        media: {
          body: videoStreamRes.data,
        },
      });

      const videoId = res.data?.id;
      if (!videoId) throw new Error('YouTube insert succeeded but returned empty video id');

      this.logger.log(`[YouTube] upload completed videoId=${videoId}`);
      return videoId;
    } catch (e: any) {
      this.logger.warn(`[YouTube] upload failed status=${e?.code || 'unknown'} msg=${e?.message || e}`);
      throw e;
    }
  }

  async uploadCaptions(videoId: string, srtText: string) {
    if (!videoId) throw new Error('Missing videoId for captions');
    if (!srtText?.trim()) return;
    await this.ensureTokensLoaded();
    if (!this.currentTokens.refresh_token && !this.currentTokens.access_token) {
      throw new Error('YouTube OAuth token is not configured');
    }

    const youtube = google.youtube({ version: 'v3', auth: this.oauth });

    const tmpPath = path.resolve(process.cwd(), 'tmp', `${videoId}.srt`);
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, srtText, 'utf8');

    try {
      await youtube.captions.insert({
        part: ['snippet'],
        requestBody: {
          snippet: {
            videoId,
            language: process.env.YOUTUBE_CAPTION_LANG || 'en',
            name: 'English',
            isDraft: false,
          },
        },
        media: {
          mimeType: 'application/x-subrip',
          body: fs.createReadStream(tmpPath),
        },
      });
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* empty */ }
    }
  }

  async updateMetadata(videoId: string, title: string, description: string, tags: string[] = []) {
    await this.ensureTokensLoaded();
    if (!this.currentTokens.refresh_token && !this.currentTokens.access_token) {
      throw new Error('YouTube OAuth token is not configured');
    }
    const youtube = google.youtube({ version: 'v3', auth: this.oauth });

    await youtube.videos.update({
      part: ['snippet'],
      requestBody: {
        id: videoId,
        snippet: {
          title: title.slice(0, 95),
          description: description.slice(0, 4500),
          tags: tags.slice(0, 25),
          categoryId: '22',
        },
      },
    });
  }
}
