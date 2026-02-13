/* eslint-disable prettier/prettier */
import { Body, Controller, Delete, Get, Param, Patch, Put } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { UpsertKeyDto } from './dto/upsert-key.dto';
import { IntegrationProvider } from '@prisma/client';

@Controller('settings')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  // App settings (toggles + schedule)
  @Get()
  getSettings() {
    return this.settings.getSettings();
  }

  @Patch()
  updateSettings(@Body() dto: UpdateSettingsDto) {
    return this.settings.updateSettings(dto);
  }

  // API keys
  @Get('api-keys')
  listKeys() {
    return this.settings.listApiKeys();
  }

  @Put('api-keys/:provider')
  upsertKey(@Param('provider') provider: IntegrationProvider, @Body() dto: UpsertKeyDto) {
    return this.settings.upsertApiKey(provider, dto.key);
  }

  @Delete('api-keys/:provider')
  deleteKey(@Param('provider') provider: IntegrationProvider) {
    return this.settings.deleteApiKey(provider);
  }
}
