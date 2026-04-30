/* eslint-disable prettier/prettier */
import { Injectable, Logger } from '@nestjs/common';
import Replicate from 'replicate';
import { v2 as cloudinary } from 'cloudinary';
import { PrismaService } from '../../prisma/prisma.service';
import { MonitoringService } from 'src/monitoring/monitoring.service';
import axios from 'axios';
import * as crypto from 'crypto';

type ImageModelSpec = {
  owner: string;
  name: string;
  label: string;
  input: Record<string, string | number | boolean | undefined>;
};

type ReplicateOutput = string | string[] | { output?: unknown; url?: unknown; urls?: unknown; image?: unknown };

@Injectable()
export class AiImageService {
  private readonly logger = new Logger(AiImageService.name);
  private readonly aiMode = (process.env.IMAGE_AI_MODE || 'live').toLowerCase();

  private readonly primaryModel: ImageModelSpec = {
    owner: 'alibaba',
    name: 'happyhorse-1.0',
    label: 'alibaba/happyhorse-1.0',
    input: {
      prompt: undefined,
      resolution: '1080p',
      aspect_ratio: '16:9',
      duration: 5,
    },
  };

  private readonly fallbackModel: ImageModelSpec = {
    owner: 'stability-ai',
    name: 'sdxl',
    label: 'stability-ai/sdxl',
    input: {
      prompt: undefined,
      width: 1024,
      height: 1024,
    },
  };

  private replicate?: Replicate;
  private versionCache = new Map<string, string>();

  // 🔥 limit parallel jobs (important)
  private readonly MAX_PARALLEL = 5;

  constructor(
    private prisma: PrismaService,
    private monitoring: MonitoringService,
  ) {
    if (process.env.REPLICATE_API_TOKEN) {
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
      message: params.status === 'SUCCESS' ? 'Image generation completed' : params.errorMessage || 'Image generation failed',
      jobId: params.jobId ?? null,
      provider: 'replicate',
      meta: {
        model: params.model,
        errorMessage: params.errorMessage ?? null,
      },
    });
  }

  private async resolveModelVersionId(spec: ImageModelSpec) {
    const key = `${spec.owner}/${spec.name}`;
    const cached = this.versionCache.get(key);
    if (cached) return cached;

    if (!this.replicate) {
      throw new Error('REPLICATE_CLIENT_UNAVAILABLE');
    }

    const model = await this.replicate.models.get(spec.owner, spec.name);
    const latestVersionId = model.latest_version?.id;
    if (latestVersionId) {
      this.versionCache.set(key, latestVersionId);
      return latestVersionId;
    }

    const versionsPage = await this.replicate.models.versions.list(spec.owner, spec.name);
    const latest = versionsPage.results[0];
    if (!latest?.id) {
      throw new Error(`No Replicate version found for ${key}`);
    }

    this.versionCache.set(key, latest.id);
    return latest.id;
  }

  private isImageLikeUrl(value: string) {
    const normalized = String(value || '').split('?')[0].toLowerCase();
    return /\.(png|jpe?g|webp|gif|bmp)$/i.test(normalized);
  }

  private extractRemoteUrl(output: ReplicateOutput): string | null {
    if (typeof output === 'string') return output;
    if (Array.isArray(output)) {
      const first = output.find((item): item is string => typeof item === 'string' && item.trim().length > 0);
      return first ?? null;
    }

    if (output && typeof output === 'object') {
      const record = output as Record<string, unknown>;
      for (const field of ['url', 'image', 'output', 'urls'] as const) {
        const candidate = record[field];
        if (typeof candidate === 'string' && candidate.trim()) return candidate;
        if (Array.isArray(candidate)) {
          const first = candidate.find((item): item is string => typeof item === 'string' && item.trim().length > 0);
          if (first) return first;
        }
      }
    }

    return null;
  }

  private async verifyImageUrl(imageUrl: string) {
    if (this.isImageLikeUrl(imageUrl)) return;

    const response = await axios.head(imageUrl, {
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: () => true,
    });

    const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      throw new Error(`Unsupported Replicate output content-type: ${contentType || 'unknown'}`);
    }
  }

  private async runModel(spec: ImageModelSpec, prompt: string, jobId?: string) {
    if (!this.replicate) {
      throw new Error('REPLICATE_CLIENT_UNAVAILABLE');
    }

    const versionId = await this.resolveModelVersionId(spec);
    const modelIdentifier = `${spec.owner}/${spec.name}:${versionId}`;
    const input = {
      ...spec.input,
      prompt,
    };

    this.logger.log(`[IMAGE_GEN] start job=${jobId ?? 'n/a'} model=${modelIdentifier}`);

    const result = (await Promise.race([
      this.replicate.run(modelIdentifier, { input }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Replicate timeout')), 60000),
      ),
    ])) as ReplicateOutput;

    const remoteUrl = this.extractRemoteUrl(result);
    if (!remoteUrl) {
      throw new Error(`No usable output returned from ${modelIdentifier}`);
    }

    await this.verifyImageUrl(remoteUrl);

    return { remoteUrl, modelIdentifier };
  }

  private async retryPrimary(prompt: string, jobId?: string) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.runModel(this.primaryModel, prompt, jobId);
      } catch (error: unknown) {
        lastError = error;
        const delayMs = 2 ** (attempt - 1) * 1000;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[IMAGE_GEN] primary retry ${attempt}/3 job=${jobId ?? 'n/a'} delayMs=${delayMs} msg=${message}`,
        );
        await this.emitImageEvent({
          status: 'FAILED',
          jobId,
          model: this.primaryModel.label,
          errorMessage: message,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError instanceof Error ? lastError : new Error('IMAGE_GENERATION_FAILED');
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
      const storedNorm = this.normalizePrompt(c.promptText);

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
  async generateSceneImageUrl(
    visualPrompt: string,
    publicId: string,
    jobId?: string,
  ): Promise<string> {
    const prompt = this.safeVisualPrompt(visualPrompt);
    const hash = this.hashPrompt(prompt);

    // ✅ 1. EXACT CACHE
    const existing = await this.prisma.generatedImage.findUnique({
      where: { promptHash: hash },
    });

    if (existing) {
      this.logger.log(`[CACHE HIT] ${publicId}`);
      await this.emitImageEvent({ status: 'SUCCESS', jobId, model: 'cache' });
      return existing.imageUrl;
    }

    // ✅ 2. SIMILAR CACHE (fuzzy)
    const similar = await this.findSimilarImage(prompt);
    if (similar) {
      this.logger.log(`[SIMILAR HIT] ${publicId}`);
      await this.emitImageEvent({ status: 'SUCCESS', jobId, model: 'cache-similar' });
      return similar.imageUrl;
    }

    // ✅ 3. MOCK
    if (this.aiMode === 'mock' || !this.replicate) {
      const fallback =
        process.env.MOCK_SCENE_IMAGE_URL ||
        'https://via.placeholder.com/1280x720.png';

      this.logger.warn(`[MOCK IMAGE USED] ${publicId}`);
      await this.emitImageEvent({ status: 'SUCCESS', jobId, model: 'mock' });
      return fallback;
    }

    this.logger.log(`[GEN IMAGE] ${publicId}`);
    const attempts = [
      {
        model: this.primaryModel,
        runner: () => this.runModel(this.primaryModel, prompt, jobId),
      },
      {
        model: this.fallbackModel,
        runner: () => this.runModel(this.fallbackModel, prompt, jobId),
      },
    ];

    for (const attempt of attempts) {
      try {
        const { remoteUrl, modelIdentifier } = await attempt.runner();
        const cloudUrl = await this.uploadFromUrl(remoteUrl, publicId);

        try {
          await this.prisma.generatedImage.create({
            data: {
              promptHash: hash,
              promptText: prompt,
              imageUrl: cloudUrl,
            },
          });
        } catch (error: unknown) {
          this.logger.warn(`[CACHE RACE] ${publicId}`);

          const cached = await this.prisma.generatedImage.findUnique({
            where: { promptHash: hash },
          });

          if (cached) {
            await this.emitImageEvent({
              status: 'SUCCESS',
              jobId,
              model: modelIdentifier,
            });
            return cached.imageUrl;
          }

          throw error;
        }

        await this.emitImageEvent({
          status: 'SUCCESS',
          jobId,
          model: modelIdentifier,
        });

        return cloudUrl;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[IMAGE_GEN] attempt failed job=${jobId ?? 'n/a'} msg=${message}`);
        await this.emitImageEvent({
          status: 'FAILED',
          jobId,
          model: attempt.model.label,
          errorMessage: message,
        });
      }
    }

    try {
      const retried = await this.retryPrimary(prompt, jobId);
      const cloudUrl = await this.uploadFromUrl(retried.remoteUrl, publicId);

      try {
        await this.prisma.generatedImage.create({
          data: {
            promptHash: hash,
            promptText: prompt,
            imageUrl: cloudUrl,
          },
        });
      } catch (error: unknown) {
        const cached = await this.prisma.generatedImage.findUnique({
          where: { promptHash: hash },
        });

        if (cached) {
          await this.emitImageEvent({
            status: 'SUCCESS',
            jobId,
            model: retried.modelIdentifier,
          });
          return cached.imageUrl;
        }

        throw error;
      }

      await this.emitImageEvent({
        status: 'SUCCESS',
        jobId,
        model: retried.modelIdentifier,
      });
      return cloudUrl;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.emitImageEvent({
        status: 'FAILED',
        jobId,
        model: this.primaryModel.label,
        errorMessage: message,
      });
      throw new Error('IMAGE_GENERATION_FAILED');
    }
  }

  // ------------------------
  // ⚡ PARALLEL GENERATION (KEY UPGRADE)
  // ------------------------
  async generateMultipleScenes(
    scenes: { visualPrompt: string; publicId: string; jobId?: string }[],
  ): Promise<string[]> {
    const results: string[] = [];
    const queue = [...scenes];

    const workers = Array.from({ length: this.MAX_PARALLEL }).map(async () => {
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
