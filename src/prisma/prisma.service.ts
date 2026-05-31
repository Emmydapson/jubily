import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async enableShutdownHooks() {
    // no-op for Prisma v6 – Nest handles shutdown
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
