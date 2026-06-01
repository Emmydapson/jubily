/* eslint-disable prettier/prettier */
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encryptString, maskLast4 } from './settings.crypto';
import { IntegrationProvider } from '@prisma/client';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  private isUniqueConstraintError(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  private validateTimezone(timezone: string) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    } catch {
      throw new BadRequestException('timezone must be a valid IANA timezone');
    }
  }

  async getSettings() {
    const existing = await this.prisma.appSettings.findUnique({
      where: { id: 'app' },
    });
    if (existing) return existing;

    try {
      return await this.prisma.appSettings.create({
        data: { id: 'app' },
      });
    } catch (error: unknown) {
      if (!this.isUniqueConstraintError(error)) throw error;

      const settings = await this.prisma.appSettings.findUnique({
        where: { id: 'app' },
      });
      if (settings) return settings;

      throw error;
    }
  }

  async updateSettings(dto: UpdateSettingsDto) {
    if (dto.timezone != null) {
      dto.timezone = String(dto.timezone).trim();
      this.validateTimezone(dto.timezone);
    }

    if (dto.runHours != null) {
      // Basic guardrails
      const uniq = Array.from(new Set(dto.runHours.map((x) => Number(x))));
      if (uniq.some((h) => !Number.isInteger(h) || h < 0 || h > 23)) {
        throw new BadRequestException('runHours must be integers 0..23');
      }
      if (uniq.length < 1) throw new BadRequestException('runHours must not be empty');
      dto.runHours = uniq.sort((a, b) => a - b);
    }

    if (dto.videosPerDay != null) {
      dto.videosPerDay = Number(dto.videosPerDay);
      if (!Number.isInteger(dto.videosPerDay) || dto.videosPerDay < 1 || dto.videosPerDay > 3) {
        throw new BadRequestException('videosPerDay must be an integer from 1 to 3');
      }
    }

    const updated = await this.prisma.appSettings.upsert({
      where: { id: 'app' },
      create: { id: 'app', ...dto },
      update: { ...dto },
    });

    return updated;
  }

  async listApiKeys() {
    const keys = await this.prisma.integrationKey.findMany({
      orderBy: { provider: 'asc' },
      select: { provider: true, last4: true, updatedAt: true, createdAt: true },
    });

    return keys.map((k) => ({
      provider: k.provider,
      masked: maskLast4(k.last4),
      updatedAt: k.updatedAt,
      createdAt: k.createdAt,
    }));
  }

  async upsertApiKey(provider: IntegrationProvider, rawKey: string) {
    const { encrypted, last4 } = encryptString(rawKey);

    const saved = await this.prisma.integrationKey.upsert({
      where: { provider },
      update: { encrypted, last4 },
      create: { provider, encrypted, last4 },
      select: { provider: true, last4: true, updatedAt: true },
    });

    return { provider: saved.provider, masked: maskLast4(saved.last4), updatedAt: saved.updatedAt };
  }

  async deleteApiKey(provider: IntegrationProvider) {
    await this.prisma.integrationKey.delete({ where: { provider } }).catch(() => null);
    return { ok: true };
  }
}
