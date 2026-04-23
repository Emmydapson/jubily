/* eslint-disable prettier/prettier */
import { Injectable, Logger } from '@nestjs/common';
import Replicate from 'replicate';
import { v2 as cloudinary } from 'cloudinary';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class AiImageService {
  private readonly logger = new Logger(AiImageService.name);
  private readonly aiMode = (process.env.AI_MODE || 'live').toLowerCase();

  private replicate?: Replicate;

  // 🔥 limit parallel jobs (important)
  private readonly MAX_PARALLEL = 5;

  constructor(private prisma: PrismaService) {
    if (process.env.REPLICATE_API_TOKEN && this.aiMode !== 'mock') {
      this.replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN,
      });
    }

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
  // 🧠 NORMALIZE (for similarity dedupe)
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
    if (!base) return 'clean wellness background, soft lighting, no text';

    return `${base}, high quality, realistic, cinematic lighting, no text, no logo`;
  }

  // ------------------------
  // ☁️ CLOUDINARY
  // ------------------------
  private async uploadFromUrl(imageUrl: string, publicId: string): Promise<string> {
    const folder = process.env.CLOUDINARY_FOLDER || 'automation';

    const res = await cloudinary.uploader.upload(imageUrl, {
      folder,
      public_id: publicId,
      overwrite: true,
    });

    if (!res?.secure_url) throw new Error('Cloudinary upload failed');
    return res.secure_url;
  }

  // ------------------------
  // 🔍 SMART CACHE (fuzzy + exact)
  // ------------------------
  private async findSimilarImage(prompt: string) {
    const normalized = this.normalizePrompt(prompt);

    // ⚡ simple similarity trick (LIKE query)
    const candidates = await this.prisma.generatedImage.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
    });

    for (const c of candidates) {
      const storedNorm = this.normalizePrompt(c.promptHash);

      // simple similarity check
      if (normalized.includes(storedNorm) || storedNorm.includes(normalized)) {
        return c;
      }
    }

    return null;
  }

  // ------------------------
  // 🚀 SINGLE GENERATION
  // ------------------------
  async generateSceneImageUrl(visualPrompt: string, publicId: string): Promise<string> {
    const prompt = this.safeVisualPrompt(visualPrompt);
    const hash = this.hashPrompt(prompt);

    // ✅ 1. EXACT CACHE
    const existing = await this.prisma.generatedImage.findUnique({
      where: { promptHash: hash },
    });

    if (existing) {
      this.logger.log(`[CACHE HIT] ${publicId}`);
      return existing.imageUrl;
    }

    // ✅ 2. SIMILAR CACHE (fuzzy)
    const similar = await this.findSimilarImage(prompt);
    if (similar) {
      this.logger.log(`[SIMILAR HIT] ${publicId}`);
      return similar.imageUrl;
    }

    // ✅ 3. MOCK
    if (this.aiMode === 'mock' || !this.replicate) {
      const fallback = process.env.MOCK_SCENE_IMAGE_URL;
      if (!fallback) throw new Error('Missing MOCK_SCENE_IMAGE_URL');
      return fallback;
    }

    this.logger.log(`[GEN IMAGE] ${publicId}`);

    // ✅ 4. GENERATE WITH TIMEOUT
    const output = await Promise.race([
      this.replicate.run(
        // 🔒 PINNED VERSION (IMPORTANT)
        "stability-ai/sdxl:8beff3369e814221e4b7b5c9f6b8d8b1f",
        {
          input: {
            prompt,
            width: 1024,
            height: 1024,
          },
        }
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Replicate timeout')), 30000)
      ),
    ]);

    const imageUrl = Array.isArray(output) ? output[0] : output;
    if (!imageUrl) throw new Error('No image returned');

    const cloudUrl = await this.uploadFromUrl(imageUrl as string, publicId);

    // ✅ 5. SAFE SAVE (race-proof)
    try {
      await this.prisma.generatedImage.create({
        data: {
          promptText: prompt
          imageUrl: cloudUrl,
        },
      });
    } catch (e: any) {
      this.logger.warn(`[CACHE RACE] ${publicId}`);

      const existing = await this.prisma.generatedImage.findUnique({
        where: { promptText: prompt },
      });

      if (existing) return existing.imageUrl;
    }

    return cloudUrl;
  }

  // ------------------------
  // ⚡ PARALLEL GENERATION (KEY UPGRADE)
  // ------------------------
  async generateMultipleScenes(
    scenes: { visualPrompt: string; publicId: string }[],
  ): Promise<string[]> {
    const results: string[] = [];
    const queue = [...scenes];

    const workers = Array.from({ length: this.MAX_PARALLEL }).map(async () => {
      while (queue.length) {
        const item = queue.shift();
        if (!item) break;

        try {
          const url = await this.generateSceneImageUrl(
            item.visualPrompt,
            item.publicId,
          );
          results.push(url);
        } catch (e: any) {
          this.logger.error(`[IMG FAIL] ${item.publicId} ${e.message}`);
        }
      }
    });

    await Promise.all(workers);
    return results;
  }
}