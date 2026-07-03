/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable prettier/prettier */
import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { decryptString, encryptString } from '../settings/settings.crypto';
import { safeErrorMessage } from './safe-metadata';

type YoutubeTokens = {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string | null;
  expiry_date?: number | null;
};

type GoogleCredentials = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  expiry_date?: number;
};

type YoutubeChannelDiagnostics = {
  connected: boolean;
  channelId: string | null;
  title: string | null;
  customUrl: string | null;
  thumbnailUrl: string | null;
  selectedChannelId: string | null;
  currentChannel: YoutubeChannelSummary | null;
  channels: YoutubeChannelSummary[];
  subscriberCount: string | null;
  videoCount: string | null;
  statistics: {
    viewCount: string | null;
    subscriberCount: string | null;
    hiddenSubscriberCount: boolean | null;
    videoCount: string | null;
  } | null;
  targetChannelId: string | null;
  channelMatchesTarget: boolean | null;
  scope: string | null;
  tokenStorage: {
    encryptedDbConfigured: boolean;
    encryptedDbUpdatedAt: Date | null;
    legacyFilePresent: boolean;
    legacyFileWriteFallbackEnabled: boolean;
  };
  error: string | null;
};

type YoutubeChannelSummary = {
  id: string;
  title: string;
  thumbnail: string | null;
  customUrl: string | null;
  selected: boolean;
};

type ConnectedYoutubeChannel = {
  channelId: string | null;
  title: string | null;
  customUrl: string | null;
  thumbnailUrl: string | null;
  statistics: {
    viewCount: string | null;
    subscriberCount: string | null;
    hiddenSubscriberCount: boolean | null;
    videoCount: string | null;
  } | null;
};

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(YoutubeService.name);
  private activeFileTokenPath: string | null = null;

  constructor(private prisma: PrismaService) {}

  private youtubeRedirectUri(kind: 'admin' | 'customer') {
    const specific =
      kind === 'admin'
        ? process.env.YOUTUBE_ADMIN_REDIRECT_URI
        : process.env.YOUTUBE_CUSTOMER_REDIRECT_URI;
    const legacy = process.env.NODE_ENV === 'production' ? '' : process.env.YOUTUBE_REDIRECT;
    const redirectUri = String(specific || legacy || '').trim();
    if (!redirectUri) {
      throw new Error(
        kind === 'admin'
          ? 'YOUTUBE_ADMIN_REDIRECT_URI is required'
          : 'YOUTUBE_CUSTOMER_REDIRECT_URI is required',
      );
    }
    return redirectUri;
  }

  private createOAuthClient(persistWorkspaceId?: string, redirectKind: 'admin' | 'customer' = persistWorkspaceId ? 'customer' : 'admin') {
    const oauth = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      this.youtubeRedirectUri(redirectKind),
    );

    oauth.on('tokens', (newTokens: YoutubeTokens) => {
      const persist = (async () => {
        const existing = persistWorkspaceId
          ? await this.readWorkspaceTokens(persistWorkspaceId)
          : await this.readDbTokens().catch(() => null);
        const merged = {
          ...(existing ?? {}),
          ...newTokens,
          refresh_token: newTokens.refresh_token || existing?.refresh_token,
        };
        if (persistWorkspaceId) {
          await this.persistWorkspaceTokens(persistWorkspaceId, merged);
        } else {
          await this.persistTokens(merged);
        }
      })();

      void persist.catch((error: unknown) => {
        this.logger.warn(`[YouTube] token refresh persistence failed msg=${safeErrorMessage(error)}`);
      });
    });

    return oauth;
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

  private targetChannelId() {
    return String(process.env.YOUTUBE_TARGET_CHANNEL_ID || process.env.YOUTUBE_CHANNEL_ID || '').trim() || null;
  }

  private channelMatchesTarget(channelId: string | null) {
    const targetChannelId = this.targetChannelId();
    if (!targetChannelId) return null;
    return Boolean(channelId) && channelId === targetChannelId;
  }

  private channelThumbnail(snippet: any) {
    return snippet?.thumbnails?.default?.url ?? snippet?.thumbnails?.medium?.url ?? snippet?.thumbnails?.high?.url ?? null;
  }

  private channelSummary(channel: ConnectedYoutubeChannel, selectedChannelId?: string | null): YoutubeChannelSummary | null {
    if (!channel.channelId) return null;
    return {
      id: channel.channelId,
      title: channel.title || 'Untitled YouTube channel',
      thumbnail: channel.thumbnailUrl,
      customUrl: channel.customUrl,
      selected: selectedChannelId ? channel.channelId === selectedChannelId : true,
    };
  }

  private async fetchConnectedChannels(auth: any): Promise<ConnectedYoutubeChannel[]> {
    const youtube = google.youtube({ version: 'v3', auth });
    const res = await youtube.channels.list({
      mine: true,
      part: ['snippet', 'statistics'],
    });
    const items = Array.isArray(res.data?.items) ? res.data.items : [];

    return items.map((channel: any) => ({
      channelId: channel?.id ?? null,
      title: channel?.snippet?.title ?? null,
      customUrl: channel?.snippet?.customUrl ?? null,
      thumbnailUrl: this.channelThumbnail(channel?.snippet),
      statistics: channel?.statistics
        ? {
            viewCount: channel.statistics.viewCount ?? null,
            subscriberCount: channel.statistics.subscriberCount ?? null,
            hiddenSubscriberCount: channel.statistics.hiddenSubscriberCount ?? null,
            videoCount: channel.statistics.videoCount ?? null,
          }
        : null,
    }));
  }

  private async fetchConnectedChannel(auth: any): Promise<ConnectedYoutubeChannel> {
    const channels = await this.fetchConnectedChannels(auth);
    return channels[0] ?? { channelId: null, title: null, customUrl: null, thumbnailUrl: null, statistics: null };
  }

  private async assertTargetChannel(auth: any, operation: string) {
    const targetChannelId = this.targetChannelId();
    if (!targetChannelId) return;

    const channel = await this.fetchConnectedChannel(auth);
    if (channel.channelId !== targetChannelId) {
      throw new Error(
        `YouTube ${operation} blocked: connected channel ${channel.channelId || 'unknown'} (${channel.title || 'untitled'}) does not match target channel ${targetChannelId}`,
      );
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

  private async readWorkspaceTokens(workspaceId: string): Promise<YoutubeTokens | null> {
    const row = await this.prisma.workspaceYoutubeConnection.findUnique({
      where: { workspaceId },
      select: { encrypted: true },
    });
    if (!row?.encrypted) return null;
    return JSON.parse(decryptString(row.encrypted)) as YoutubeTokens;
  }

  private async persistWorkspaceTokens(
    workspaceId: string,
    tokens: YoutubeTokens,
    channel?: ConnectedYoutubeChannel,
  ) {
    if (!tokens.refresh_token && !tokens.access_token) return;
    const { encrypted, last4 } = encryptString(JSON.stringify(tokens));

    await this.prisma.workspaceYoutubeConnection.upsert({
      where: { workspaceId },
      update: {
        encrypted,
        last4,
        channelId: channel?.channelId ?? undefined,
        channelTitle: channel?.title ?? undefined,
        channelCustomUrl: channel?.customUrl ?? undefined,
        scope: tokens.scope ?? undefined,
        connectedAt: new Date(),
      },
      create: {
        workspaceId,
        encrypted,
        last4,
        channelId: channel?.channelId ?? null,
        channelTitle: channel?.title ?? null,
        channelCustomUrl: channel?.customUrl ?? null,
        scope: tokens.scope ?? null,
      },
    });
  }

  private async loadGlobalTokens(): Promise<YoutubeTokens | null> {
    let tokens: YoutubeTokens | null = null;
    try {
      tokens = await this.readDbTokens();
      if (tokens) {
        this.logger.log('[YouTube] using encrypted DB OAuth token');
      }
    } catch (error: unknown) {
      this.logger.warn(`[YouTube] DB token load failed; trying file fallback msg=${safeErrorMessage(error)}`);
    }

    if (!tokens) {
      tokens = this.readFileTokens();
      if (tokens) {
        this.logger.warn('[YouTube] using legacy file OAuth token fallback; migrate to encrypted DB storage');
        await this.persistTokens(tokens).catch((error: unknown) => {
          this.logger.warn(`[YouTube] legacy token migration skipped msg=${safeErrorMessage(error)}`);
        });
      }
    }

    if (!tokens) {
      this.logger.warn('[YouTube] no OAuth token configured; connect YouTube before publishing');
    }

    return tokens;
  }

  private async clientWithTokens(workspaceId?: string) {
    const oauth = this.createOAuthClient(workspaceId);
    const tokens = workspaceId ? await this.readWorkspaceTokens(workspaceId) : await this.loadGlobalTokens();
    if (!tokens?.refresh_token && !tokens?.access_token) {
      throw new Error(workspaceId ? 'Workspace YouTube OAuth token is not configured' : 'YouTube OAuth token is not configured');
    }
    oauth.setCredentials(this.googleCredentials(tokens));
    return { oauth, tokens };
  }

  private googleCredentials(tokens: YoutubeTokens): GoogleCredentials {
    return {
      access_token: tokens.access_token ?? undefined,
      refresh_token: tokens.refresh_token ?? undefined,
      scope: tokens.scope ?? undefined,
      expiry_date: tokens.expiry_date ?? undefined,
    };
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

  private getAuthUrl(kind: 'admin' | 'customer', state?: string) {
    const oauth = this.createOAuthClient(undefined, kind);
    return oauth.generateAuthUrl({
      access_type: 'offline',
      // Force account selection so admins can switch away from a wrong cached Google account.
      prompt: 'consent select_account',
      scope: [
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube.force-ssl',
      ],
      include_granted_scopes: true,
      response_type: 'code',
      ...(state ? { state } : {}),
    });
  }

  getAdminAuthUrl(state?: string) {
    return this.getAuthUrl('admin', state);
  }

  getCustomerAuthUrl(state?: string) {
    return this.getAuthUrl('customer', state);
  }

  async handleAuthCallback(code: string) {
    const oauth = this.createOAuthClient();
    const { tokens } = await oauth.getToken(code);

    if (!tokens.refresh_token) {
      throw new Error('No refresh token received. Try again.');
    }

    const merged: YoutubeTokens = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      expiry_date: tokens.expiry_date,
    };

    oauth.setCredentials(this.googleCredentials(merged));
    try {
      await this.assertTargetChannel(oauth, 'connection');
    } catch (error) {
      throw error;
    }
    await this.persistTokens(merged);

    return { connected: true, scope: merged.scope, expiry_date: merged.expiry_date };
  }

  async getChannelDiagnostics(): Promise<YoutubeChannelDiagnostics> {
    const tokenStorage = await this.tokenStorageStatus();
    const tokens = await this.loadGlobalTokens();
    if (!tokens?.refresh_token && !tokens?.access_token) {
      return {
        connected: false,
        channelId: null,
        title: null,
        customUrl: null,
        thumbnailUrl: null,
        selectedChannelId: null,
        currentChannel: null,
        channels: [],
        subscriberCount: null,
        videoCount: null,
        statistics: null,
        targetChannelId: this.targetChannelId(),
        channelMatchesTarget: this.channelMatchesTarget(null),
        scope: null,
        tokenStorage,
        error: 'YouTube OAuth token is not configured',
      };
    }

    try {
      const oauth = this.createOAuthClient();
      oauth.setCredentials(this.googleCredentials(tokens));
      const channels = await this.fetchConnectedChannels(oauth);
      const channel = channels[0] ?? { channelId: null, title: null, customUrl: null, thumbnailUrl: null, statistics: null };
      const selectedChannelId = channel.channelId;
      const channelSummaries = channels.map((item) => this.channelSummary(item, selectedChannelId)).filter(Boolean) as YoutubeChannelSummary[];
      const currentChannel = channelSummaries.find((item) => item.selected) ?? null;
      const matchesTarget = this.channelMatchesTarget(channel.channelId);

      return {
        connected: Boolean(channel.channelId),
        channelId: channel.channelId,
        title: channel.title,
        customUrl: channel.customUrl,
        thumbnailUrl: channel.thumbnailUrl,
        selectedChannelId,
        currentChannel,
        channels: channelSummaries,
        subscriberCount: channel.statistics?.subscriberCount ?? null,
        videoCount: channel.statistics?.videoCount ?? null,
        statistics: channel.statistics,
        targetChannelId: this.targetChannelId(),
        channelMatchesTarget: matchesTarget,
        scope: tokens.scope ?? null,
        tokenStorage,
        error: channel.channelId
          ? matchesTarget === false
            ? `Connected YouTube channel does not match target channel ${this.targetChannelId()}`
            : null
          : 'No YouTube channel was returned for the stored OAuth token',
      };
    } catch (error: unknown) {
      return {
        connected: false,
        channelId: null,
        title: null,
        customUrl: null,
        thumbnailUrl: null,
        selectedChannelId: null,
        currentChannel: null,
        channels: [],
        subscriberCount: null,
        videoCount: null,
        statistics: null,
        targetChannelId: this.targetChannelId(),
        channelMatchesTarget: this.channelMatchesTarget(null),
        scope: tokens.scope ?? null,
        tokenStorage,
        error: safeErrorMessage(error),
      };
    }
  }

  async getWorkspaceChannelDiagnostics(workspaceId: string): Promise<YoutubeChannelDiagnostics> {
    const row = await this.prisma.workspaceYoutubeConnection.findUnique({
      where: { workspaceId },
      select: {
        updatedAt: true,
        channelId: true,
        channelTitle: true,
        channelCustomUrl: true,
        scope: true,
      },
    });

    const tokenStorage = {
      encryptedDbConfigured: Boolean(row),
      encryptedDbUpdatedAt: row?.updatedAt ?? null,
      legacyFilePresent: false,
      legacyFileWriteFallbackEnabled: false,
    };

    if (!row) {
      return {
        connected: false,
        channelId: null,
        title: null,
        customUrl: null,
        thumbnailUrl: null,
        selectedChannelId: null,
        currentChannel: null,
        channels: [],
        subscriberCount: null,
        videoCount: null,
        statistics: null,
        targetChannelId: null,
        channelMatchesTarget: null,
        scope: null,
        tokenStorage,
        error: 'Workspace YouTube OAuth token is not configured',
      };
    }

    try {
      const { oauth, tokens } = await this.clientWithTokens(workspaceId);
      const channels = await this.fetchConnectedChannels(oauth);
      const channel = channels[0] ?? { channelId: null, title: null, customUrl: null, thumbnailUrl: null, statistics: null };
      const selectedChannelId = channel.channelId;
      const channelSummaries = channels.map((item) => this.channelSummary(item, selectedChannelId)).filter(Boolean) as YoutubeChannelSummary[];
      const currentChannel = channelSummaries.find((item) => item.selected) ?? null;
      return {
        connected: Boolean(channel.channelId),
        channelId: channel.channelId,
        title: channel.title,
        customUrl: channel.customUrl,
        thumbnailUrl: channel.thumbnailUrl,
        selectedChannelId,
        currentChannel,
        channels: channelSummaries,
        subscriberCount: channel.statistics?.subscriberCount ?? null,
        videoCount: channel.statistics?.videoCount ?? null,
        statistics: channel.statistics,
        targetChannelId: null,
        channelMatchesTarget: null,
        scope: tokens.scope ?? row.scope ?? null,
        tokenStorage,
        error: channel.channelId ? null : 'No YouTube channel was returned for the workspace OAuth token',
      };
    } catch (error: unknown) {
      return {
        connected: false,
        channelId: row.channelId,
        title: row.channelTitle,
        customUrl: row.channelCustomUrl,
        thumbnailUrl: null,
        selectedChannelId: row.channelId,
        currentChannel: row.channelId ? { id: row.channelId, title: row.channelTitle || 'Untitled YouTube channel', thumbnail: null, customUrl: row.channelCustomUrl, selected: true } : null,
        channels: row.channelId ? [{ id: row.channelId, title: row.channelTitle || 'Untitled YouTube channel', thumbnail: null, customUrl: row.channelCustomUrl, selected: true }] : [],
        subscriberCount: null,
        videoCount: null,
        statistics: null,
        targetChannelId: null,
        channelMatchesTarget: null,
        scope: row.scope,
        tokenStorage,
        error: safeErrorMessage(error),
      };
    }
  }

  async handleWorkspaceAuthCallback(workspaceId: string, code: string) {
    const oauth = this.createOAuthClient(workspaceId);
    const { tokens } = await oauth.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error('No refresh token received. Try reconnecting YouTube for this workspace.');
    }

    const merged: YoutubeTokens = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      expiry_date: tokens.expiry_date,
    };

    oauth.setCredentials(this.googleCredentials(merged));
    const channel = await this.fetchConnectedChannel(oauth);
    await this.persistWorkspaceTokens(workspaceId, merged, channel);

    return {
      connected: true,
      channelId: channel.channelId,
      title: channel.title,
      customUrl: channel.customUrl,
      scope: merged.scope,
      expiry_date: merged.expiry_date,
    };
  }

  async disconnectWorkspace(workspaceId: string) {
    await this.prisma.workspaceYoutubeConnection.deleteMany({ where: { workspaceId } });
    return { connected: false };
  }

  async upload(
    title: string,
    description: string,
    videoUrl: string,
    tags: string[] = [],
    workspaceId?: string,
  ): Promise<string>  {
    if (!videoUrl) throw new Error('Missing videoUrl for upload');
    const { oauth } = await this.clientWithTokens(workspaceId);
    if (!workspaceId) await this.assertTargetChannel(oauth, 'upload');

    const youtube = google.youtube({ version: 'v3', auth: oauth });
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
      this.logger.warn(`[YouTube] video download failed host=${host} status=${e?.response?.status || 'unknown'} msg=${safeErrorMessage(e)}`);
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
      this.logger.warn(`[YouTube] upload failed status=${e?.code || 'unknown'} msg=${safeErrorMessage(e)}`);
      throw e;
    }
  }

  async uploadCaptions(videoId: string, srtText: string, workspaceId?: string) {
    if (!videoId) throw new Error('Missing videoId for captions');
    if (!srtText?.trim()) return;
    const { oauth } = await this.clientWithTokens(workspaceId);
    if (!workspaceId) await this.assertTargetChannel(oauth, 'caption upload');

    const youtube = google.youtube({ version: 'v3', auth: oauth });

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

  async updateMetadata(videoId: string, title: string, description: string, tags: string[] = [], workspaceId?: string) {
    const { oauth } = await this.clientWithTokens(workspaceId);
    if (!workspaceId) await this.assertTargetChannel(oauth, 'metadata update');
    const youtube = google.youtube({ version: 'v3', auth: oauth });

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
