import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ActiveWorkspace } from '../workspaces/workspace.decorator';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import { WorkspaceRoles } from '../workspaces/workspace-roles.decorator';
import { CreateOfferDto } from './dto/create-offer.dto';
import { ListOffersQueryDto } from './dto/list-offers-query.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { OffersService } from './offers.service';

@Controller('offers')
@UseGuards(WorkspaceGuard)
@ApiTags('Offers')
@ApiBearerAuth('jwt')
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Get()
  @ApiOperation({ summary: 'List affiliate offers' })
  @ApiOkResponse({
    description: 'Paginated offers with usage counts.',
    schema: {
      example: {
        items: [
          {
            id: 'd766cd09-66f7-4a22-a8d5-2cf05a2dc7d4',
            network: 'PARTNERSTACK',
            name: 'AI Writing Tool',
            nicheTag: 'AI_SOFTWARE',
            hoplink: 'https://example.partnerstack.com/ai-tool',
            active: true,
            _count: { clicks: 12, conversions: 1, videoJobs: 3 },
          },
        ],
        page: 1,
        limit: 50,
        total: 1,
      },
    },
  })
  list(@Query() query: ListOffersQueryDto, @ActiveWorkspace() workspace?: { id: string } | null) {
    return this.offers.list(query, workspace?.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an affiliate offer' })
  @ApiParam({ name: 'id', format: 'uuid' })
  get(@Param('id', ParseUUIDPipe) id: string, @ActiveWorkspace() workspace?: { id: string } | null) {
    return this.offers.getOne(id, workspace?.id);
  }

  @Post()
  @WorkspaceRoles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create an affiliate offer' })
  @ApiBody({ type: CreateOfferDto })
  create(@Body() dto: CreateOfferDto, @ActiveWorkspace() workspace?: { id: string } | null) {
    return this.offers.create(dto, workspace?.id);
  }

  @Patch(':id')
  @WorkspaceRoles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update an affiliate offer' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateOfferDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOfferDto,
    @ActiveWorkspace() workspace?: { id: string } | null,
  ) {
    return this.offers.update(id, dto, workspace?.id);
  }

  @Post(':id/deactivate')
  @WorkspaceRoles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Deactivate an offer without deleting history' })
  @ApiParam({ name: 'id', format: 'uuid' })
  deactivate(@Param('id', ParseUUIDPipe) id: string, @ActiveWorkspace() workspace?: { id: string } | null) {
    return this.offers.deactivate(id, workspace?.id);
  }

  @Post(':id/reactivate')
  @WorkspaceRoles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Reactivate an offer' })
  @ApiParam({ name: 'id', format: 'uuid' })
  reactivate(@Param('id', ParseUUIDPipe) id: string, @ActiveWorkspace() workspace?: { id: string } | null) {
    return this.offers.reactivate(id, workspace?.id);
  }

  @Get(':id/performance')
  @ApiOperation({ summary: 'Get click/conversion performance for an offer' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Offer performance summary.',
    schema: {
      example: {
        offer: { id: 'd766cd09-66f7-4a22-a8d5-2cf05a2dc7d4' },
        totals: {
          clicks: 12,
          conversions: 1,
          videoJobs: 3,
          conversionRate: 0.08333333333333333,
          revenueByCurrency: [
            { currency: 'USD', conversions: 1, amount: 21.5 },
          ],
        },
        recent: {
          lastClickAt: '2026-06-01T10:00:00.000Z',
          lastConversionAt: '2026-06-01T10:05:00.000Z',
        },
      },
    },
  })
  performance(@Param('id', ParseUUIDPipe) id: string, @ActiveWorkspace() workspace?: { id: string } | null) {
    return this.offers.performance(id, workspace?.id);
  }

  @Post(':id/test-redirect')
  @ApiOperation({
    summary: 'Preview the affiliate redirect URL without recording a click',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  testRedirect(@Param('id', ParseUUIDPipe) id: string, @ActiveWorkspace() workspace?: { id: string } | null) {
    return this.offers.testRedirect(id, workspace?.id);
  }
}
