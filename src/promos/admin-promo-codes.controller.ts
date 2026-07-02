import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { AdminGuard } from '../auth/admin.guard';
import { PromoCodesService } from './promo-codes.service';
import { CreatePromoCodeDto } from './dto/create-promo-code.dto';
import { UpdatePromoCodeDto } from './dto/update-promo-code.dto';

type AdminRequest = {
  user?: {
    adminId?: string;
  };
};

@ApiTags('Admin - Promo Codes')
@ApiBearerAuth()
@Roles('ADMIN')
@UseGuards(AdminGuard)
@Controller('admin/promo-codes')
export class AdminPromoCodesController {
  constructor(private readonly promos: PromoCodesService) {}

  @Post()
  @ApiOperation({ summary: 'Create an influencer promo code' })
  create(@Req() req: AdminRequest, @Body() dto: CreatePromoCodeDto) {
    return this.promos.create(dto, req.user?.adminId);
  }

  @Get()
  @ApiOperation({ summary: 'List promo codes' })
  list() {
    return this.promos.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a promo code' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.promos.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a promo code' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePromoCodeDto) {
    return this.promos.update(id, dto);
  }

  @Post(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate a promo code' })
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.promos.setActive(id, false);
  }

  @Post(':id/reactivate')
  @ApiOperation({ summary: 'Reactivate a promo code' })
  reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.promos.setActive(id, true);
  }

  @Get(':id/performance')
  @ApiOperation({ summary: 'Get promo code attribution and revenue performance' })
  performance(@Param('id', ParseUUIDPipe) id: string) {
    return this.promos.performance(id);
  }
}
