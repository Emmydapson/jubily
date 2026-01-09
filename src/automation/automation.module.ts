/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { ScriptService } from './script.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { VideosModule } from './videos/videos.module';
import { AiService } from './ai/ai.service';

@Module({
  controllers: [AutomationController],
  providers: [AutomationService, PrismaService, ScriptService, AiService],
  imports: [VideosModule]
})
export class AutomationModule {}
