import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { PromoCodesService } from './promo-codes.service';
import { ValidatePromoCodeDto } from './dto/validate-promo-code.dto';

@ApiTags('promo-codes')
@Controller('promo-codes')
export class PromoCodesController {
  constructor(private readonly promos: PromoCodesService) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('validate')
  @ApiOperation({ summary: 'Validate a promo code without exposing attribution data' })
  validate(@Body() dto: ValidatePromoCodeDto) {
    return this.promos.validatePublic(dto.code, dto.plan, dto.provider, dto.interval, dto.countryCode);
  }
}
