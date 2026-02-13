/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { VideosService } from './videos.service';
import { VideosController } from './videos.controller';
import { ShotstackService } from './shotstack.service';
import { RenderWorker } from './render.worker';
import { PublishWorker } from './publish.worker';
import { GoogleSheetsService } from '../../common/google-sheets.service';
import { YoutubeService } from '../../common/youtube.service';
import { ShotstackServeService } from './shotstack-serve.service';
import { GoogleTtsService } from '../tts/google-tts.service';

@Module({
  providers: [
    VideosService,
    ShotstackService,
    ShotstackServeService,
    RenderWorker,
    PublishWorker,     // ✅ add
    GoogleSheetsService,
    YoutubeService,    // ✅ add
    GoogleTtsService
  ],
  controllers: [VideosController],
  exports: [VideosService],
})
export class VideosModule {}
