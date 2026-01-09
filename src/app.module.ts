import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AutomationModule } from './automation/automation.module';
import { PublishingModule } from './publishing/publishing.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AutomationModule,
    PublishingModule,
  ],
})
export class AppModule {}
