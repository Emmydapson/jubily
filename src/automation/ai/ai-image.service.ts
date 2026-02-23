/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import OpenAI from 'openai';
import { Injectable, Logger } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

type OpenAIImageSize =
  | 'auto'
  | '256x256'
  | '512x512'
  | '1024x1024'
  | '1536x1024'
  | '1024x1536'
  | '1792x1024'
  | '1024x1792';

@Injectable()
export class AiImageService {
  private readonly logger = new Logger(AiImageService.name);
  private client?: OpenAI;

  private readonly imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
  private readonly aiMode = (process.env.AI_MODE || 'live').toLowerCase(); // live | mock

  constructor() {
    const key = process.env.OPENAI_API_KEY;

    if (key && this.aiMode !== 'mock') {
      this.client = new OpenAI({ apiKey: key });
    }

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  private getImageSize(): OpenAIImageSize {
    const raw = String(process.env.OPENAI_IMAGE_SIZE || '1024x1024').trim();

    const allowed: OpenAIImageSize[] = [
      'auto',
      '256x256',
      '512x512',
      '1024x1024',
      '1536x1024',
      '1024x1536',
      '1792x1024',
      '1024x1792',
    ];

    return (allowed.includes(raw as OpenAIImageSize) ? (raw as OpenAIImageSize) : '1024x1024');
  }

  private safeVisualPrompt(raw: string) {
    const base = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!base) return 'clean wellness infographic background, soft lighting, no text';

    const isMedical =
      /liver|cirrhosis|disease|infection|symptom|diagnosis|treatment|cancer|tumou?r|organ|blood/i.test(
        base,
      );

    const medicalStyle =
      'high-quality medical illustration, non-graphic, educational diagram style, clean, no gore, no surgery, no real patient photo, no text';

    const generalStyle =
      'high-quality realistic b-roll style photo, clean lighting, natural colors, no text, no logos';

    return isMedical
      ? `${base}. Style: ${medicalStyle}.`
      : `${base}. Style: ${generalStyle}.`;
  }

  private async uploadToCloudinaryPng(base64: string, publicId: string): Promise<string> {
    const folder = process.env.CLOUDINARY_FOLDER || 'automation';

    const up = await cloudinary.uploader.upload(`data:image/png;base64,${base64}`, {
      resource_type: 'image',
      folder,
      public_id: publicId,
      overwrite: true,
      format: 'png',
    });

    if (!up?.secure_url) throw new Error('Cloudinary image upload missing secure_url');
    return up.secure_url;
  }

  async generateSceneImageUrl(visualPrompt: string, publicId: string): Promise<string> {
    const prompt = this.safeVisualPrompt(visualPrompt);

    if (this.aiMode === 'mock' || !this.client) {
      const fallback = process.env.MOCK_SCENE_IMAGE_URL;
      if (!fallback) throw new Error('AI_MODE=mock but MOCK_SCENE_IMAGE_URL is missing');
      this.logger.warn(`[MockImage] publicId=${publicId} using=${fallback}`);
      return fallback;
    }

    const size = this.getImageSize();
    this.logger.log(`[ImageGen] publicId=${publicId} model=${this.imageModel} size=${size}`);

    const img = await this.client.images.generate({
      model: this.imageModel,
      prompt,
      size, // ✅ now typed correctly
    });

    const b64 = img.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI image generation returned empty b64_json');

    const url = await this.uploadToCloudinaryPng(b64, publicId);

    this.logger.log(`[ImageGen] ✅ publicId=${publicId} urlHost=${new URL(url).host}`);
    return url;
  }
}