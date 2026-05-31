/* eslint-disable prettier/prettier */
import { Controller, Post, Req, Res, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Digistore24Service } from './digistore24.service';
import { Public } from 'src/auth/public.decorator';
import { MonitoringService } from 'src/monitoring/monitoring.service';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@Controller('webhooks/digistore24')
@ApiTags('Webhooks')
export class Digistore24Controller {
  private readonly logger = new Logger(Digistore24Controller.name);

  constructor(
    private readonly ds: Digistore24Service,
    private readonly monitoring: MonitoringService,
  ) {}
  // Public because Digistore24 must post IPN events without a Jubily bearer token.
  @Public()
  @Post()
  @ApiOperation({ summary: 'Receive Digistore24 IPN webhook', description: 'Public webhook endpoint. Digistore24 posts x-www-form-urlencoded payloads and expects an OK response.' })
  @ApiBody({
    description: 'Digistore24 IPN form payload.',
    schema: { example: { event: 'payment', transaction_id: 'D24-123456', order_id: 'ORDER-123', product_id: '12345', amount: '49.00', currency: 'USD' } },
  })
  @ApiOkResponse({ description: 'Always responds OK for accepted, ignored, and logged webhook events.', schema: { example: 'OK' } })
  async handle(@Req() req: Request, @Res() res: Response) {
    // Digistore sends x-www-form-urlencoded, so req.body is key/value
    const payload = req.body as Record<string, any>;

    const event = String(payload?.event || '');
    if (event === 'connection_test') {
      // must be exactly "OK"
      return res.status(200).send('OK');
    }

    try {
      await this.ds.processIpn(payload);
      return res.status(200).send('OK');
    } catch (e: any) {
      // Return 200 OK so Digistore doesn't spam retries forever,
      // but log + store the error.
      this.logger.warn(`IPN processing failed: ${e?.message || e}`);
      await this.monitoring.error({
        stage: 'CONVERSION',
        status: 'WEBHOOK_FAILED',
        message: e?.message || String(e),
        provider: 'digistore24',
        meta: {
          transactionType: String(payload?.transaction_type || payload?.event || 'unknown'),
          orderId: String(payload?.order_id || payload?.transaction_id || ''),
          productId: String(payload?.product_id || ''),
        },
      });
      return res.status(200).send('OK');
    }
  }
}
