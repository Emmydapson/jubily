/* eslint-disable prettier/prettier */
import { Injectable, NotFoundException } from '@nestjs/common';
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
  const title = dto.title.trim();
  const source = (dto.source ?? "manual").trim();
  const score = dto.score ?? 50;

  const existing = await this.prisma.topic.findFirst({
    where: { title },
  });
  if (existing) return existing;

  return this.prisma.topic.create({
    data: { title, source, score },
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

async getScriptById(id: string) {
    const script = await this.prisma.script.findUnique({
      where: { id },
      select: {
        id: true,
        topicId: true,
        promptVer: true,
        content: true,
        createdAt: true,
      },
    });

    if (!script) throw new NotFoundException('Script not found');
    return script;
  }

}
