/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTopicDto } from './dto/create-topic.dto';
import { ScriptService } from './script.service';
import { AiService } from './ai/ai.service';

@Injectable()
export class AutomationService {
  constructor(private prisma: PrismaService,
    private scriptService: ScriptService,
    private aiService: AiService,
  ) {}

  async generateScript(body: { topicId: string; content: string }) {
  return this.scriptService.generate(body.topicId, body.content);
}

  async createTopic(dto: CreateTopicDto) {
    // Deduplication
    const existing = await this.prisma.topic.findFirst({
      where: { title: dto.title },
    });

    if (existing) return existing;

    return this.prisma.topic.create({
      data: {
        title: dto.title,
        source: dto.source,
        score: dto.score,
      },
    });
  }

 async generateScriptWithAi(topicId: string, topicTitle: string) {
  const content = await this.aiService.generateScript(topicTitle);

  return this.prisma.script.create({
    data: {
      content,
      promptVer: 'v2-ai',
      outputHash: `hash_${Date.now()}`,
      topic: {
        connect: { id: topicId },
      },
    },
  });
}


async getTopics() {
  return this.prisma.topic.findMany({
    orderBy: { createdAt: 'desc' },
  });
}

async getPendingTopics() {
  return this.prisma.topic.findMany({
    where: { status: 'PENDING' },
    take: 5,
  });
}

async markTopicUsed(topicId: string) {
  return this.prisma.topic.update({
    where: { id: topicId },
    data: { status: 'USED' },
  });
}

  async getAllScripts() {
  return this.prisma.script.findMany({
    orderBy: { createdAt: 'desc' },
  });
}

}
