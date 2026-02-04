/* eslint-disable prettier/prettier */
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { CreateTopicDto } from './dto/create-topic.dto';

@Controller('automation')
export class AutomationController {
  constructor(private readonly automationService: AutomationService) {}

  @Post('topics')
  createTopic(@Body() dto: CreateTopicDto) {
    return this.automationService.createTopic(dto);
  }

  @Post('scripts')
generateScript(@Body() body: { topicId: string; content: string }) {
  return this.automationService.generateScript(body);

  
}

@Post('scripts/ai')
generateWithAi(@Body() body: { topicId: string; topic: string }) {
  return this.automationService.generateScriptWithAi(body.topicId, body.topic);
}

@Get('topics')
getTopics() {
  return this.automationService.getTopics();
}

@Get('topics/pending')
getPending() {
  return this.automationService.getPendingTopics();
}

@Patch('topics/:id/used')
markUsed(@Param('id') id: string) {
  return this.automationService.markTopicUsed(id);
}

@Get('scripts')
getAllScripts() {
  return this.automationService.getAllScripts();
}

}
