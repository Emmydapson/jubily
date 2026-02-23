/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import axios from 'axios';
import { Injectable, Logger } from '@nestjs/common';
import { Scene } from './interfaces/scene.interface';
import { GoogleTtsService } from '../tts/google-tts.service';

@Injectable()
export class ShotstackService {
  private readonly logger = new Logger(ShotstackService.name);
  private readonly baseUrl = 'https://api.shotstack.io/stage';

  // ✅ ONE stable Cloudinary image for all scenes (temporary placeholder / logo bg)
  private readonly bgImage =
    'https://res.cloudinary.com/dspv4emds/image/upload/v1771599485/jubily/job-1771599485454-scene-0.jpg';

  // music file used by Shotstack to fetch
  private readonly soundtrackUrl =
    'https://s3-ap-southeast-2.amazonaws.com/shotstack-assets/music/freepd/drive.mp3';

  constructor(private readonly tts: GoogleTtsService) {}

  private apiKey(): string {
    const k = process.env.SHOTSTACK_API_KEY;
    if (!k) throw new Error('Missing SHOTSTACK_API_KEY');
    return k;
  }

  private shortHost(url: string) {
    try {
      return new URL(url).host;
    } catch {
      return 'invalid-url';
    }
  }

  /**
   * Preflight-check assets from *your server* to spot which URL is not public.
   * Shotstack needs assets to be publicly fetchable (no auth, no blocked redirects).
   */
  private async preflight(url: string, label: string) {
    try {
      const res = await axios.head(url, {
        timeout: 15000,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: {
          // some hosts behave differently by UA; keep it simple
          'User-Agent': 'jubily-preflight/1.0',
        },
      });

      const status = res.status;
      const ct = String(res.headers?.['content-type'] || '');
      const cl = String(res.headers?.['content-length'] || '');
      const loc = String(res.headers?.location || '');

      this.logger.log(
        `[AssetPreflight] ${label} status=${status} host=${this.shortHost(url)} ct=${ct} len=${cl}${
          loc ? ` redirect=${loc}` : ''
        } url=${url}`,
      );

      // Warn on anything that isn't OK
      if (status < 200 || status >= 300) {
        this.logger.warn(`[AssetPreflight] ❗ ${label} not-200 status=${status} url=${url}`);
      }
    } catch (e: any) {
      this.logger.error(
        `[AssetPreflight] ❌ ${label} FAILED host=${this.shortHost(url)} url=${url} msg=${
          e?.message || e
        }`,
      );
    }
  }

  async renderVideo(scenes: Scene[]): Promise<string> {
    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new Error('renderVideo: scenes empty');
    }

    let currentTime = 0;

    const fullNarration = scenes
      .map((s) => String((s as any).narration || ''))
      .join(' ')
      .trim();

    if (!fullNarration) throw new Error('renderVideo: narration empty');

    // ✅ Voiceover URL comes from GoogleTtsService
    const ttsPublicId = `job-${Date.now()}`;
    const voiceoverUrl = await this.tts.synthesizeToCloudinaryMp3(fullNarration, ttsPublicId);

    this.logger.log(
      `[TTS] publicId=${ttsPublicId} voiceoverHost=${this.shortHost(
        voiceoverUrl,
      )} voiceoverUrl=${voiceoverUrl}`,
    );

    // ✅ Preflight the assets Shotstack must fetch
    // (This helps you immediately identify which one is blocked/unreachable.)
    await this.preflight(voiceoverUrl, 'voiceover');
    await this.preflight(this.bgImage, 'bgImage');
    await this.preflight(this.soundtrackUrl, 'soundtrack');

    const bgClips: any[] = [];
    const captionClips: any[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene: any = scenes[i];
      const start = currentTime;
      const length = Number(scene.duration || 0);

      if (!Number.isFinite(length) || length <= 0) {
        throw new Error(`Invalid scene.duration at index=${i}`);
      }

      currentTime += length;

      bgClips.push({
        asset: { type: 'image', src: this.bgImage },
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

    const payload: any = {
      timeline: {
        soundtrack: {
          src: this.soundtrackUrl,
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

    this.logger.log(
      `[ShotstackPayload] bgHost=${this.shortHost(this.bgImage)} voiceHost=${this.shortHost(
        voiceoverUrl,
      )} musicHost=${this.shortHost(this.soundtrackUrl)} totalSeconds=${Math.ceil(currentTime)}`,
    );

    try {
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

      this.logger.log(`[ShotstackRenderCreated] renderId=${renderId}`);
      return renderId;
    } catch (e: any) {
      // ✅ This is the most important log: Shotstack often tells which file was denied here.
      const status = e?.response?.status;
      const data = e?.response?.data;
      const msg = e?.message || String(e);

      this.logger.error(
        `[ShotstackRenderError] status=${status} msg=${msg} response=${JSON.stringify(data)}`,
      );

      throw e;
    }
  }
}