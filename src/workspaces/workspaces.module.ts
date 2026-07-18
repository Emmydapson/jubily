import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { YoutubeService } from '../common/youtube.service';
import { WorkspacesController } from './workspaces.controller';
import { WorkspaceYoutubeOAuthController } from './youtube-oauth.controller';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspacesService } from './workspaces.service';
import { AuditModule } from '../audit/audit.module';
import { OAuthStateService } from '../auth/oauth-state.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [WorkspacesController, WorkspaceYoutubeOAuthController],
  providers: [
    WorkspacesService,
    WorkspaceGuard,
    YoutubeService,
    OAuthStateService,
  ],
  exports: [WorkspacesService, WorkspaceGuard],
})
export class WorkspacesModule {}
