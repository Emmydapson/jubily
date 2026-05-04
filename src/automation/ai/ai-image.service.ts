/* eslint-disable prettier/prettier */
import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { v2 as cloudinary } from 'cloudinary';
import { PrismaService } from '../../prisma/prisma.service';
import { MonitoringService } from 'src/monitoring/monitoring.service';
import * as crypto from 'crypto';

@Injectable()
export class AiImageService {
  private readonly logger = new Logger(AiImageService.name);

  private readonly aiMode =
    (process.env.IMAGE_AI_MODE || 'live').toLowerCase();

  private readonly MAX_PARALLEL = 3; // reduce cost

  private openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  constructor(
    private prisma: PrismaService,
    private monitoring: MonitoringService,
  ) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  // ------------------------
  // 🔑 HASH
  // ------------------------
  private hashPrompt(prompt: string) {
    return crypto.createHash('md5').update(prompt).digest('hex');
  }

  // ------------------------
  // 🧠 NORMALIZE
  // ------------------------
  private normalizePrompt(prompt: string) {
    return prompt
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ------------------------
  // 🎯 PROMPT BUILDER
  // ------------------------
  private safeVisualPrompt(raw: string) {
    const base = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!base)
      return 'clean wellness background, soft lighting, no text';

    return `${base}, high quality, realistic, cinematic lighting, no text, no logo`;
  }

  // ------------------------
  // 📊 MONITORING
  // ------------------------
  private async emitImageEvent(params: {
    status: 'SUCCESS' | 'FAILED';
    jobId?: string;
    model: string;
    errorMessage?: string;
  }) {
    await this.monitoring.logEvent({
      stage: 'IMAGE_GENERATION',
      severity: params.status === 'SUCCESS' ? 'INFO' : 'ERROR',
      status: params.status,
      message:
        params.status === 'SUCCESS'
          ? 'Image generation completed'
          : params.errorMessage || 'Image generation failed',
      jobId: params.jobId ?? null,
      provider: 'openai',
      meta: {
        model: params.model,
        errorMessage: params.errorMessage ?? null,
      },
    });
  }

  // ------------------------
  // ☁️ CLOUDINARY UPLOAD (FIXED)
  // ------------------------
  private async uploadBuffer(
    buffer: Buffer,
    publicId: string,
  ): Promise<string> {
    const folder = process.env.CLOUDINARY_FOLDER || 'automation';

    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          overwrite: true,
        },
        (error, result) => {
          if (error || !result?.secure_url) {
            return reject(
              error || new Error('Cloudinary upload failed'),
            );
          }
          resolve(result.secure_url);
        },
      );

      stream.end(buffer);
    });
  }

  // ------------------------
  // 🧠 CACHE (SIMILAR)
  // ------------------------
  private async findSimilarImage(prompt: string) {
    const normalized = this.normalizePrompt(prompt);

    const candidates = await this.prisma.generatedImage.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
    });

    for (const c of candidates) {
      const storedNorm = this.normalizePrompt(c.promptText);

      if (
        normalized.includes(storedNorm) ||
        storedNorm.includes(normalized)
      ) {
        return c;
      }
    }

    return null;
  }

  // ------------------------
  // 🎨 OPENAI IMAGE GENERATION
  // ------------------------
  private async generateWithOpenAI(
    prompt: string,
  ): Promise<Buffer> {
    const result = await this.openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      size: '1792x1024',
    });

    const b64 = result.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error('No image returned from OpenAI');
    }

    return Buffer.from(b64, 'base64');
  }

  // ------------------------
  // 🚀 MAIN GENERATION
  // ------------------------
  async generateSceneImageUrl(
    visualPrompt: string,
    publicId: string,
    jobId?: string,
  ): Promise<string> {
    const prompt = this.safeVisualPrompt(visualPrompt);
    const hash = this.hashPrompt(prompt);

    // ✅ EXACT CACHE
    const existing = await this.prisma.generatedImage.findUnique({
      where: { promptHash: hash },
    });

    if (existing) {
      this.logger.log(`[CACHE HIT] ${publicId}`);
      await this.emitImageEvent({
        status: 'SUCCESS',
        jobId,
        model: 'cache',
      });
      return existing.imageUrl;
    }

    // ✅ SIMILAR CACHE
    const similar = await this.findSimilarImage(prompt);
    if (similar) {
      this.logger.log(`[SIMILAR HIT] ${publicId}`);
      await this.emitImageEvent({
        status: 'SUCCESS',
        jobId,
        model: 'cache-similar',
      });
      return similar.imageUrl;
    }

    // ✅ MOCK MODE (SAFE)
    if (this.aiMode === 'mock') {
      const fallback =
        process.env.MOCK_SCENE_IMAGE_URL ||
        'https://via.placeholder.com/1280x720.png';

      this.logger.warn(`[MOCK IMAGE USED] ${publicId}`);
      return fallback;
    }

    // ✅ REAL GENERATION (NO RETRIES = COST CONTROL)
    try {
      this.logger.log(`[GEN IMAGE] ${publicId}`);

      const buffer = await this.generateWithOpenAI(prompt);

      const cloudUrl = await this.uploadBuffer(buffer, publicId);

      // save cache
      await this.prisma.generatedImage.create({
        data: {
          promptHash: hash,
          promptText: prompt,
          imageUrl: cloudUrl,
        },
      });

      await this.emitImageEvent({
        status: 'SUCCESS',
        jobId,
        model: 'gpt-image-1',
      });

      return cloudUrl;
    } catch (error: any) {
      const msg = error?.message || String(error);

      this.logger.error(`[IMAGE FAILED] ${msg}`);

      await this.emitImageEvent({
        status: 'FAILED',
        jobId,
        model: 'gpt-image-1',
        errorMessage: msg,
      });

      // ✅ FALLBACK (VERY IMPORTANT)
      return (
        process.env.MOCK_SCENE_IMAGE_URL ||
        'https://via.placeholder.com/1280x720.png'
      );
    }
  }

  // ------------------------
  // ⚡ PARALLEL GENERATION
  // ------------------------
  async generateMultipleScenes(
    scenes: {
      visualPrompt: string;
      publicId: string;
      jobId?: string;
    }[],
  ): Promise<string[]> {
    const results: string[] = [];
    const queue = [...scenes];

    const workers = Array.from({
      length: this.MAX_PARALLEL,
    }).map(async () => {
      while (queue.length) {
        const item = queue.shift();
        if (!item) break;

        const url = await this.generateSceneImageUrl(
          item.visualPrompt,
          item.publicId,
          item.jobId,
        );

        results.push(url);
      }
    });

    await Promise.all(workers);
    return results;
  }
}