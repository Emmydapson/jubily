/* eslint-disable prettier/prettier */
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encryptString, maskLast4 } from './settings.crypto';
import { IntegrationProvider } from '@prisma/client';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async getSettings() {
    const settings = await this.prisma.appSettings.upsert({
      where: { id: 'app' },
      update: {},
      create: { id: 'app' },
    });
    return settings;
  }

  async updateSettings(dto: UpdateSettingsDto) {
    if (dto.runHours) {
      // Basic guardrails
      const uniq = Array.from(new Set(dto.runHours.map((x) => Number(x))));
      if (uniq.some((h) => !Number.isInteger(h) || h < 0 || h > 23)) {
        throw new BadRequestException('runHours must be integers 0..23');
      }
      if (uniq.length < 1) throw new BadRequestException('runHours must not be empty');
      dto.runHours = uniq;
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
