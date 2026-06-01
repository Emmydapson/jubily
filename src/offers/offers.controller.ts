import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { CreateOfferDto } from './dto/create-offer.dto';
import { ListOffersQueryDto } from './dto/list-offers-query.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { OffersService } from './offers.service';

@Controller('offers')
@Roles('ADMIN')
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
            network: 'digistore24',
            name: 'Deep Sleep Support',
            nicheTag: 'sleep',
            hoplink: 'https://www.digistore24.com/redir/example/product',
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
  list(@Query() query: ListOffersQueryDto) {
    return this.offers.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an affiliate offer' })
  @ApiParam({ name: 'id', format: 'uuid' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.offers.getOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create an affiliate offer' })
  @ApiBody({ type: CreateOfferDto })
  create(@Body() dto: CreateOfferDto) {
    return this.offers.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an affiliate offer' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateOfferDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOfferDto) {
    return this.offers.update(id, dto);
  }

  @Post(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate an offer without deleting history' })
  @ApiParam({ name: 'id', format: 'uuid' })
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.offers.deactivate(id);
  }

  @Post(':id/reactivate')
  @ApiOperation({ summary: 'Reactivate an offer' })
  @ApiParam({ name: 'id', format: 'uuid' })
  reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.offers.reactivate(id);
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
  performance(@Param('id', ParseUUIDPipe) id: string) {
    return this.offers.performance(id);
  }

  @Post(':id/test-redirect')
  @ApiOperation({
    summary: 'Preview the affiliate redirect URL without recording a click',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  testRedirect(@Param('id', ParseUUIDPipe) id: string) {
    return this.offers.testRedirect(id);
  }
}

