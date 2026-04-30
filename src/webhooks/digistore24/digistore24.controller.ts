/* eslint-disable prettier/prettier */
import { Controller, Post, Req, Res, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Digistore24Service } from './digistore24.service';
import { Public } from 'src/auth/public.decorator';
import { MonitoringService } from 'src/monitoring/monitoring.service';

@Controller('webhooks/digistore24')
export class Digistore24Controller {
  private readonly logger = new Logger(Digistore24Controller.name);

  constructor(
    private readonly ds: Digistore24Service,
    private readonly monitoring: MonitoringService,
  ) {}
@Public()
  @Post()
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
