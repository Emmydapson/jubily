/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { Digistore24Controller } from './digistore24.controller';
import { Digistore24Service } from './digistore24.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ClickbankWebhookController } from './clickbank.controller';

@Module({
  controllers: [Digistore24Controller, ClickbankWebhookController],
  providers: [Digistore24Service, PrismaService],
})
export class Digistore24Module {}
