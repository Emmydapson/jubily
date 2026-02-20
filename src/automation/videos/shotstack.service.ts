/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import axios from 'axios';
import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { Scene } from './interfaces/scene.interface';
import { GoogleTtsService } from '../tts/google-tts.service';

@Injectable()
export class ShotstackService {
  private readonly baseUrl = 'https://api.shotstack.io/stage';

  constructor(private readonly tts: GoogleTtsService) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  private apiKey(): string {
    const k = process.env.SHOTSTACK_API_KEY;
    if (!k) throw new Error('Missing SHOTSTACK_API_KEY');
    return k;
  }

  private unsplashUrl(query: string) {
    const q = encodeURIComponent((query || 'healthy lifestyle').slice(0, 120));
    return `https://source.unsplash.com/1080x1920/?${q}`;
  }

  /**
   * Upload any external image to Cloudinary first
   */
  private async uploadImageToCloudinary(url: string, publicId: string) {
    const folder = process.env.CLOUDINARY_FOLDER || 'automation';

    const res = await cloudinary.uploader.upload(url, {
      folder,
      public_id: publicId,
      overwrite: true,
    });

    if (!res?.secure_url) throw new Error('Cloudinary image upload failed');

    return res.secure_url;
  }

  async renderVideo(scenes: Scene[]): Promise<string> {
    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new Error('renderVideo: scenes empty');
    }

    let currentTime = 0;

    const fullNarration = scenes.map(s => String(s.narration || '')).join(' ').trim();
    if (!fullNarration) throw new Error('renderVideo: narration empty');

    // ✅ voiceover already uploaded to Cloudinary
    const voiceoverUrl = await this.tts.synthesizeToCloudinaryMp3(
      fullNarration,
      `job-${Date.now()}`
    );

    const bgClips: any[] = [];
    const captionClips: any[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const start = currentTime;
      const length = Number(scene.duration || 0);

      if (!Number.isFinite(length) || length <= 0) {
        throw new Error(`Invalid scene.duration at index=${i}`);
      }

      currentTime += length;

      // 🔥 Upload image to Cloudinary FIRST
      const rawImageUrl = this.unsplashUrl(scene.visualPrompt);
      const cloudImageUrl = await this.uploadImageToCloudinary(
        rawImageUrl,
        `job-${Date.now()}-scene-${i}`
      );

      bgClips.push({
        asset: { type: 'image', src: cloudImageUrl },
        start,
        length,
        effect: 'zoomIn',
      });

      captionClips.push({
        asset: {
          type: 'html',
          html: `
            <div style="
              width:100%; height:100%;
              display:flex; align-items:flex-end; justify-content:center;
              padding:90px;
              font-family:Arial; font-size:56px; font-weight:800;
              color:white; text-shadow: 0 2px 14px rgba(0,0,0,.9);
              text-align:center;">
              <div style="background: rgba(0,0,0,.45); padding:24px 30px; border-radius:18px;">
                ${String(scene.caption || '')}
              </div>
            </div>
          `,
        },
        start,
        length,
      });
    }

    const payload = {
      timeline: {
        soundtrack: {
          src: 'https://s3-ap-southeast-2.amazonaws.com/shotstack-assets/music/freepd/drive.mp3',
          effect: 'fadeInFadeOut',
          volume: 0.12,
        },
        tracks: [
          { clips: bgClips },
          { clips: captionClips },
          {
            clips: [
              {
                asset: { type: 'audio', src: voiceoverUrl },
                start: 0,
                length: Math.max(1, Math.ceil(currentTime)),
              },
            ],
          },
        ],
      },
      output: {
        format: 'mp4',
        resolution: 'hd',
      },
    };

    console.log('[SHOTSTACK FINAL PAYLOAD]', {
      voiceoverUrl,
      firstBg: bgClips?.[0]?.asset?.src,
      totalSeconds: Math.ceil(currentTime),
    });

    const res = await axios.post(`${this.baseUrl}/render`, payload, {
      headers: {
        'x-api-key': this.apiKey(),
        'x-shotstack-stage': 'true',
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    });

    const renderId = res.data?.response?.id;
    if (!renderId) throw new Error('Shotstack did not return render id');

    return renderId;
  }
}
