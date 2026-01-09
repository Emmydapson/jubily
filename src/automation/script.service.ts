import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import crypto from 'crypto';

@Injectable()
export class ScriptService {
  constructor(private prisma: PrismaService) {}

  private PROMPT_VERSION = 'v1';

  async generate(topicId: string, content: string) {
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    const exists = await this.prisma.script.findFirst({
      where: { outputHash: hash },
    });

    if (exists) return exists;

    return this.prisma.script.create({
      data: {
        topicId,
        promptVer: this.PROMPT_VERSION,
        content,
        outputHash: hash,
      },
    });
  }
}
