/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import { Prisma, PublishingProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { encryptString } from '../settings/settings.crypto';
import { safeErrorMessage } from '../common/safe-metadata';
import { AuditService } from '../audit/audit.service';
import {
  ProviderPublishingError,
  PublishPayload,
} from './social-publishing.types';

type TokenBundle = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scopes: string[];
};

type AccountInput = TokenBundle & {
  workspaceId: string;
  userId: string;
  provider: PublishingProvider;
  providerAccountId: string;
  displayName: string;
  username?: string | null;
  avatarUrl?: string | null;
  selectedPageId?: string | null;
  selectedInstagramBusinessAccountId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

@Injectable()
export class SocialAccountsService {
  private readonly logger = new Logger(SocialAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private scopes(raw: string | string[] | undefined, fallback: string[]) {
    if (Array.isArray(raw)) {
      const values = raw.filter(Boolean);
      return values.length ? values : fallback;
    }
    const values = String(raw || '')
      .split(/[,\s]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
    return values.length ? values : fallback;
  }

  tiktokScopes() {
    return this.scopes(process.env.TIKTOK_SCOPES, [
      'user.info.basic',
      'video.publish',
    ]);
  }

  facebookScopes() {
    return this.scopes(process.env.FACEBOOK_SCOPES, [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
      'instagram_basic',
      'instagram_content_publish',
    ]);
  }

  createTikTokAuthUrl(state: string) {
    if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_REDIRECT_URI) {
      throw new BadRequestException('TikTok OAuth is not configured');
    }
    const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
    url.searchParams.set('client_key', process.env.TIKTOK_CLIENT_KEY);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.tiktokScopes().join(','));
    url.searchParams.set('redirect_uri', process.env.TIKTOK_REDIRECT_URI);
    url.searchParams.set('state', state);
    return url.toString();
  }

  createFacebookAuthUrl(state: string) {
    if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_REDIRECT_URI) {
      throw new BadRequestException('Facebook OAuth is not configured');
    }
    const url = new URL('https://www.facebook.com/v20.0/dialog/oauth');
    url.searchParams.set('client_id', process.env.FACEBOOK_APP_ID);
    url.searchParams.set('redirect_uri', process.env.FACEBOOK_REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.facebookScopes().join(','));
    url.searchParams.set('state', state);
    return url.toString();
  }

  private async upsertAccount(input: AccountInput) {
    const access = encryptString(input.accessToken);
    const refresh = input.refreshToken
      ? encryptString(input.refreshToken)
      : null;
    const row = await this.prisma.socialAccount.upsert({
      where: {
        workspaceId_provider_providerAccountId: {
          workspaceId: input.workspaceId,
          provider: input.provider,
          providerAccountId: input.providerAccountId,
        },
      },
      update: {
        userId: input.userId,
        displayName: input.displayName,
        username: input.username ?? null,
        avatarUrl: input.avatarUrl ?? null,
        accessTokenEncrypted: access.encrypted,
        accessTokenLast4: access.last4,
        refreshTokenEncrypted: refresh?.encrypted ?? null,
        refreshTokenLast4: refresh?.last4 ?? null,
        expiresAt: input.expiresAt ?? null,
        scopes: input.scopes,
        selectedPageId: input.selectedPageId ?? null,
        selectedInstagramBusinessAccountId:
          input.selectedInstagramBusinessAccountId ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
        disconnectedAt: null,
        connectedAt: new Date(),
      },
      create: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        provider: input.provider,
        providerAccountId: input.providerAccountId,
        displayName: input.displayName,
        username: input.username ?? null,
        avatarUrl: input.avatarUrl ?? null,
        accessTokenEncrypted: access.encrypted,
        accessTokenLast4: access.last4,
        refreshTokenEncrypted: refresh?.encrypted ?? null,
        refreshTokenLast4: refresh?.last4 ?? null,
        expiresAt: input.expiresAt ?? null,
        scopes: input.scopes,
        selectedPageId: input.selectedPageId ?? null,
        selectedInstagramBusinessAccountId:
          input.selectedInstagramBusinessAccountId ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
      },
    });
    await this.audit.record({
      action: 'SOCIAL_ACCOUNT_CONNECTED',
      workspaceId: input.workspaceId,
      userId: input.userId,
      targetType: 'SocialAccount',
      targetId: row.id,
      metadata: {
        provider: input.provider,
        providerAccountId: input.providerAccountId,
        scopes: input.scopes,
      },
    });
    return this.sanitize(row);
  }

  private sanitize(account: any) {
    return {
      id: account.id,
      workspaceId: account.workspaceId,
      provider: account.provider,
      providerAccountId: account.providerAccountId,
      displayName: account.displayName,
      username: account.username ?? null,
      avatarUrl: account.avatarUrl ?? null,
      expiresAt: account.expiresAt ?? null,
      scopes: account.scopes ?? [],
      selectedPageId: account.selectedPageId ?? null,
      selectedInstagramBusinessAccountId:
        account.selectedInstagramBusinessAccountId ?? null,
      metadata: account.metadata ?? null,
      connectedAt: account.connectedAt,
      updatedAt: account.updatedAt,
      disconnectedAt: account.disconnectedAt ?? null,
      status: account.disconnectedAt ? 'DISCONNECTED' : 'CONNECTED',
    };
  }

  async listAccounts(workspaceId: string) {
    const accounts = await this.prisma.socialAccount.findMany({
      where: { workspaceId },
      orderBy: [
        { disconnectedAt: 'asc' },
        { provider: 'asc' },
        { connectedAt: 'desc' },
      ],
    });
    return accounts.map((account) => this.sanitize(account));
  }

  async selectAccount(
    workspaceId: string,
    accountId: string,
    input: {
      selectedPageId?: string | null;
      selectedInstagramBusinessAccountId?: string | null;
    },
    userId?: string | null,
  ) {
    const account = await this.prisma.socialAccount.findFirst({
      where: { id: accountId, workspaceId, disconnectedAt: null },
    });
    if (!account) throw new NotFoundException('Publishing account not found');
    if (!input.selectedPageId && !input.selectedInstagramBusinessAccountId) {
      throw new BadRequestException(
        'selectedPageId or selectedInstagramBusinessAccountId is required',
      );
    }
    const updated = await this.prisma.socialAccount.update({
      where: { id: account.id },
      data: {
        selectedPageId: input.selectedPageId ?? account.selectedPageId,
        selectedInstagramBusinessAccountId:
          input.selectedInstagramBusinessAccountId ??
          account.selectedInstagramBusinessAccountId,
      },
    });
    await this.audit.record({
      action: 'SOCIAL_ACCOUNT_SELECTED',
      workspaceId,
      userId: userId ?? null,
      targetType: 'SocialAccount',
      targetId: account.id,
      metadata: {
        provider: account.provider,
        selectedPageId: updated.selectedPageId,
        selectedInstagramBusinessAccountId:
          updated.selectedInstagramBusinessAccountId,
      },
    });
    return this.sanitize(updated);
  }

  async disconnectAccount(
    workspaceId: string,
    accountId: string,
    userId?: string | null,
  ) {
    const account = await this.prisma.socialAccount.findFirst({
      where: { id: accountId, workspaceId, disconnectedAt: null },
    });
    if (!account) throw new NotFoundException('Publishing account not found');
    await this.revokeBestEffort(account.provider);
    const updated = await this.prisma.socialAccount.update({
      where: { id: account.id },
      data: { disconnectedAt: new Date() },
    });
    await this.audit.record({
      action: 'SOCIAL_ACCOUNT_DISCONNECTED',
      workspaceId,
      userId: userId ?? null,
      targetType: 'SocialAccount',
      targetId: account.id,
      metadata: { provider: account.provider },
    });
    return this.sanitize(updated);
  }

  private async revokeBestEffort(provider: PublishingProvider) {
    this.logger.log(
      `[${provider}] disconnect requested; provider token revocation is best-effort and no token value is logged`,
    );
  }

  async handleTikTokCallback(
    workspaceId: string,
    userId: string,
    code: string,
  ) {
    if (
      !process.env.TIKTOK_CLIENT_KEY ||
      !process.env.TIKTOK_CLIENT_SECRET ||
      !process.env.TIKTOK_REDIRECT_URI
    ) {
      throw new BadRequestException('TikTok OAuth is not configured');
    }
    try {
      const params = new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.TIKTOK_REDIRECT_URI,
      });
      const token = await axios.post(
        'https://open.tiktokapis.com/v2/oauth/token/',
        params,
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      );
      const accessToken = String(token.data?.access_token || '');
      if (!accessToken)
        throw new Error('TikTok token response missing access token');
      const profile = await axios.get(
        'https://open.tiktokapis.com/v2/user/info/',
        {
          params: { fields: 'open_id,union_id,avatar_url,display_name' },
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      const user = profile.data?.data?.user || {};
      const expiresIn = Number(token.data?.expires_in || 0);
      return this.upsertAccount({
        workspaceId,
        userId,
        provider: 'TIKTOK',
        providerAccountId: String(user.open_id || token.data?.open_id || ''),
        displayName: String(user.display_name || 'TikTok account'),
        username: null,
        avatarUrl: user.avatar_url ?? null,
        accessToken,
        refreshToken: token.data?.refresh_token ?? null,
        expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
        scopes: this.scopes(token.data?.scope, this.tiktokScopes()),
        metadata: {
          profile: user,
          appReview: {
            publishingEnabled: process.env.TIKTOK_PUBLISHING_ENABLED === 'true',
          },
        },
      });
    } catch (error) {
      this.logger.warn(
        `[TikTok] OAuth callback failed msg=${safeErrorMessage(error)}`,
      );
      throw new BadRequestException(
        'TikTok connection failed. Please try again.',
      );
    }
  }

  async handleFacebookCallback(
    workspaceId: string,
    userId: string,
    code: string,
  ) {
    if (
      !process.env.FACEBOOK_APP_ID ||
      !process.env.FACEBOOK_APP_SECRET ||
      !process.env.FACEBOOK_REDIRECT_URI
    ) {
      throw new BadRequestException('Facebook OAuth is not configured');
    }
    try {
      const token = await axios.get(
        'https://graph.facebook.com/v20.0/oauth/access_token',
        {
          params: {
            client_id: process.env.FACEBOOK_APP_ID,
            client_secret: process.env.FACEBOOK_APP_SECRET,
            redirect_uri: process.env.FACEBOOK_REDIRECT_URI,
            code,
          },
        },
      );
      const accessToken = String(token.data?.access_token || '');
      if (!accessToken)
        throw new Error('Facebook token response missing access token');
      const [me, pages] = await Promise.all([
        axios.get('https://graph.facebook.com/v20.0/me', {
          params: { fields: 'id,name,picture', access_token: accessToken },
        }),
        axios.get('https://graph.facebook.com/v20.0/me/accounts', {
          params: {
            fields:
              'id,name,username,access_token,instagram_business_account{id,username,name,profile_picture_url}',
            access_token: accessToken,
          },
        }),
      ]);
      const pageItems = Array.isArray(pages.data?.data) ? pages.data.data : [];
      const instagramAccounts = pageItems
        .map((page: any) =>
          page.instagram_business_account
            ? {
                ...page.instagram_business_account,
                pageId: page.id,
                pageName: page.name,
              }
            : null,
        )
        .filter(Boolean);
      const expiresIn = Number(token.data?.expires_in || 0);
      return this.upsertAccount({
        workspaceId,
        userId,
        provider: 'FACEBOOK',
        providerAccountId: String(me.data?.id || ''),
        displayName: String(me.data?.name || 'Facebook account'),
        username: null,
        avatarUrl: me.data?.picture?.data?.url ?? null,
        accessToken,
        expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
        scopes: this.facebookScopes(),
        selectedPageId: pageItems[0]?.id ?? null,
        selectedInstagramBusinessAccountId: instagramAccounts[0]?.id ?? null,
        metadata: {
          pages: pageItems.map((page: any) => ({
            id: page.id,
            name: page.name,
            username: page.username ?? null,
            instagramBusinessAccount: page.instagram_business_account ?? null,
          })),
          instagramBusinessAccounts: instagramAccounts,
          appReview: {
            publishingEnabled: process.env.META_PUBLISHING_ENABLED === 'true',
          },
        },
      });
    } catch (error) {
      this.logger.warn(
        `[Meta] OAuth callback failed msg=${safeErrorMessage(error)}`,
      );
      throw new BadRequestException(
        'Facebook connection failed. Please try again.',
      );
    }
  }

  async publish(input: PublishPayload) {
    if (input.provider === 'YOUTUBE')
      throw new ConflictException(
        'Use the YouTube adapter for YouTube publishing',
      );
    if (input.provider === 'TIKTOK') {
      throw new ProviderPublishingError(
        'TikTok publishing is not enabled yet. App review approval is required.',
        'TIKTOK',
      );
    }
    if (input.provider === 'FACEBOOK' || input.provider === 'INSTAGRAM') {
      throw new ProviderPublishingError(
        'Meta publishing is not enabled yet. App review approval is required.',
        input.provider,
      );
    }
    throw new BadRequestException('Unsupported publishing provider');
  }
}
