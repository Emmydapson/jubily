/* eslint-disable prettier/prettier */
import { Body, Controller, Delete, Get, Param, ParseEnumPipe, Patch, Put } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { UpsertKeyDto } from './dto/upsert-key.dto';
import { IntegrationProvider } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

@Controller('settings')
@Roles('ADMIN')
@ApiTags('Settings')
@ApiBearerAuth('jwt')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  // App settings (toggles + schedule)
  @Get()
  @ApiOperation({ summary: 'Get application settings', description: 'Requires a valid ADMIN bearer token.' })
  @ApiOkResponse({ description: 'Current settings.', schema: { example: { automationEnabled: true, verticalEnabled: true, autoPublish: false, timezone: 'America/New_York', videosPerDay: 3, runHours: [9, 13, 18] } } })
  getSettings() {
    return this.settings.getSettings();
  }

  @Patch()
  @ApiOperation({ summary: 'Update application settings', description: 'Requires a valid ADMIN bearer token.' })
  @ApiBody({ type: UpdateSettingsDto })
  @ApiOkResponse({ description: 'Updated settings.', schema: { example: { automationEnabled: true, verticalEnabled: true, autoPublish: false, timezone: 'America/New_York', videosPerDay: 3, runHours: [9, 13, 18] } } })
  updateSettings(@Body() dto: UpdateSettingsDto) {
    return this.settings.updateSettings(dto);
  }

  // API keys
  @Get('api-keys')
  @ApiOperation({ summary: 'List configured API keys', description: 'Requires a valid ADMIN bearer token. Secret values are not returned.' })
  @ApiOkResponse({ description: 'Configured integration key metadata.', schema: { example: [{ provider: 'OPENAI', configured: true, updatedAt: '2026-05-30T14:00:00.000Z' }] } })
  listKeys() {
    return this.settings.listApiKeys();
  }

  @Put('api-keys/:provider')
  @ApiOperation({ summary: 'Create or replace an integration API key', description: 'Requires a valid ADMIN bearer token.' })
  @ApiParam({ name: 'provider', enum: IntegrationProvider, example: 'OPENAI' })
  @ApiBody({ type: UpsertKeyDto })
  @ApiOkResponse({ description: 'API key metadata after upsert.', schema: { example: { provider: 'OPENAI', configured: true } } })
  upsertKey(@Param('provider', new ParseEnumPipe(IntegrationProvider)) provider: IntegrationProvider, @Body() dto: UpsertKeyDto) {
    return this.settings.upsertApiKey(provider, dto.key);
  }

  @Delete('api-keys/:provider')
  @ApiOperation({ summary: 'Delete an integration API key', description: 'Requires a valid ADMIN bearer token.' })
  @ApiParam({ name: 'provider', enum: IntegrationProvider, example: 'OPENAI' })
  @ApiOkResponse({ description: 'Delete result.', schema: { example: { ok: true } } })
  deleteKey(@Param('provider', new ParseEnumPipe(IntegrationProvider)) provider: IntegrationProvider) {
    return this.settings.deleteApiKey(provider);
  }
}
