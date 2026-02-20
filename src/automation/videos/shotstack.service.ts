/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import axios from 'axios';
import { Injectable } from '@nestjs/common';
import { Scene } from './interfaces/scene.interface';
import { GoogleTtsService } from '../tts/google-tts.service';

@Injectable()
export class ShotstackService {
  private readonly baseUrl = 'https://api.shotstack.io/stage';

  constructor(private readonly tts: GoogleTtsService) {}

  private apiKey(): string {
    const k = process.env.SHOTSTACK_API_KEY;
    if (!k) throw new Error('Missing SHOTSTACK_API_KEY');
    return k;
  }

  /**
   * IMPORTANT:
   * source.unsplash.com often fails for renderers (redirects / bot blocks).
   * Use a stable direct image URL first to confirm Shotstack works.
   */
  private safeBgImageUrl(_visualPrompt: string) {
    // 1080x1920, direct CDN, no redirects
    return 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1080&h=1920&fit=crop&auto=format&q=80';
  }

  async renderVideo(scenes: Scene[]): Promise<string> {
    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new Error('renderVideo: scenes is empty');
    }

    let currentTime = 0;

    // One voiceover mp3 for the whole script (TTS may be mock inside GoogleTtsService)
    const fullNarration = scenes.map((s) => String(s.narration || '')).join(' ').trim();
    if (!fullNarration) throw new Error('renderVideo: narration is empty');

    const voiceoverUrl = await this.tts.synthesizeToCloudinaryMp3(
      fullNarration,
      `job-${Date.now()}`,
    );

    const bgClips: any[] = [];
    const captionClips: any[] = [];

    scenes.forEach((scene: any, idx: number) => {
      const start = currentTime;
      const length = Number(scene.duration || 0);

      if (!Number.isFinite(length) || length <= 0) {
        throw new Error(`Invalid scene.duration at index=${idx}`);
      }

      currentTime += length;

      bgClips.push({
        asset: {
          type: 'image',
          src: this.safeBgImageUrl(scene.visualPrompt),
        },
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
    });

    const payload: any = {
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

    // ✅ debug the exact URLs Shotstack must fetch
    console.log('[SHOTSTACK PAYLOAD CHECK]', {
      voiceoverUrl,
      soundtrack: payload.timeline?.soundtrack?.src,
      firstBg: bgClips?.[0]?.asset?.src,
      lastBg: bgClips?.[bgClips.length - 1]?.asset?.src,
      totalSeconds: Math.ceil(currentTime),
    });

    const res = await axios.post(`${this.baseUrl}/render`, payload, {
      headers: {
        'x-api-key': this.apiKey(),
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    });

    const renderId = res.data?.response?.id;
    if (!renderId) throw new Error('Shotstack did not return render id');

    return renderId;
  }
}
