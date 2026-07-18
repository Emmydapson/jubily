import { Module } from '@nestjs/common';
import { PublishingService } from './publishing.service';
import { PublishingController } from './publishing.controller';
import { MonitoringModule } from 'src/monitoring/monitoring.module';
import { AdminGuard } from '../auth/admin.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { OAuthStateService } from '../auth/oauth-state.service';
import { SocialAccountsService } from './social-accounts.service';
import { SocialOAuthController } from './social-oauth.controller';
import { PublishingAccountsController } from './publishing-accounts.controller';

@Module({
  imports: [PrismaModule, MonitoringModule, AuditModule, WorkspacesModule],
  providers: [
    PublishingService,
    SocialAccountsService,
    OAuthStateService,
    AdminGuard,
  ],
  controllers: [
    PublishingController,
    SocialOAuthController,
    PublishingAccountsController,
  ],
  exports: [SocialAccountsService],
})
export class PublishingModule {}
