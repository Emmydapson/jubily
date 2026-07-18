import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActiveWorkspace } from '../workspaces/workspace.decorator';
import { WorkspaceRoles } from '../workspaces/workspace-roles.decorator';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import type { WorkspaceRequest } from '../workspaces/workspace.types';
import { SocialAccountsService } from './social-accounts.service';

@Controller('publishing/accounts')
@UseGuards(WorkspaceGuard)
@ApiTags('Publishing Accounts')
@ApiBearerAuth('jwt')
export class PublishingAccountsController {
  constructor(private readonly accounts: SocialAccountsService) {}

  @Get()
  @ApiOperation({
    summary: 'List workspace publishing accounts without provider tokens',
  })
  list(@ActiveWorkspace() workspace: { id: string }) {
    return this.accounts.listAccounts(workspace.id);
  }

  @Patch(':id/select')
  @WorkspaceRoles('OWNER', 'ADMIN')
  @ApiOperation({
    summary: 'Select default Facebook Page or Instagram business account',
  })
  select(
    @Param('id') id: string,
    @Body()
    body: {
      selectedPageId?: string | null;
      selectedInstagramBusinessAccountId?: string | null;
    },
    @Req() req: WorkspaceRequest,
    @ActiveWorkspace() workspace: { id: string },
  ) {
    return this.accounts.selectAccount(
      workspace.id,
      id,
      body,
      req.user?.userId,
    );
  }

  @Post(':id/disconnect')
  @WorkspaceRoles('OWNER', 'ADMIN')
  @ApiOperation({
    summary:
      'Disconnect a workspace publishing account without deleting publish history',
  })
  disconnect(
    @Param('id') id: string,
    @Req() req: WorkspaceRequest,
    @ActiveWorkspace() workspace: { id: string },
  ) {
    return this.accounts.disconnectAccount(workspace.id, id, req.user?.userId);
  }
}
