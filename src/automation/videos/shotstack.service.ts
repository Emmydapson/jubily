/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import axios from 'axios';
import { Injectable, Logger } from '@nestjs/common';
import { Scene } from './interfaces/scene.interface';
import { GoogleTtsService } from '../tts/google-tts.service';
import { AiImageService } from '../ai/ai-image.service'; // ✅ adjust path to where you create it

@Injectable()
export class ShotstackService {
  private readonly logger = new Logger(ShotstackService.name);
  private readonly baseUrl = 'https://api.shotstack.io/stage';

  constructor(
    private readonly tts: GoogleTtsService,
    private readonly aiImages: AiImageService, // ✅ inject image generator
  ) {}

  private apiKey(): string {
    const k = process.env.SHOTSTACK_API_KEY;
    if (!k) throw new Error('Missing SHOTSTACK_API_KEY');
    return k;
  }

  private estimateSeconds(narration: string) {
  const words = narration.trim().split(/\s+/).filter(Boolean).length;
  const sec = words / 2.2; // ~132 wpm
  return Math.max(3, Math.min(9, sec));
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
        headers: { 'User-Agent': 'jubily-preflight/1.0' },
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

      if (status < 200 || status >= 300) {
        this.logger.warn(`[AssetPreflight] ❗ ${label} not-200 status=${status} url=${url}`);
      }
    } catch (e: any) {
      this.logger.error(
        `[AssetPreflight] ❌ ${label} FAILED host=${this.shortHost(url)} url=${url} msg=${e?.message || e}`,
      );
    }
  }

  async renderVideo(scenes: Scene[]): Promise<string> {
    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new Error('renderVideo: scenes empty');
    }

    

    const fullNarration = scenes
      .map((s) => String((s as any).narration || ''))
      .join(' ')
      .trim();

    if (!fullNarration) throw new Error('renderVideo: narration empty');

    // ✅ One job key per render run (used for voiceover + scene image public ids)
    const jobKey = `job-${Date.now()}`;

    // ✅ Get voice URL + timepoints
const narrations = scenes.map((s: any) => String(s.narration || '').trim());
const { url: voiceoverUrl, timepoints } =
  await this.tts.synthesizeWithMarksToCloudinaryMp3(narrations, jobKey);

  const byName = new Map<string, number>();
for (const tp of timepoints || []) {
  if (tp?.markName && typeof tp.timeSeconds === 'number') {
    byName.set(tp.markName, tp.timeSeconds);
  }
}

let end = byName.get('end');

if (typeof end !== 'number' || !Number.isFinite(end) || end <= 0) {
  this.logger.warn(
    `[TTS] No valid "end" mark. Falling back to estimated narration duration`,
  );

  end = narrations.reduce((total, line) => {
    return total + this.estimateSeconds(line);
  }, 0);
}
    this.logger.log(
      `[TTS] publicId=${jobKey} voiceHost=${this.shortHost(voiceoverUrl)} voiceoverUrl=${voiceoverUrl}`,
    );

    // Shotstack will fetch this
    await this.preflight(voiceoverUrl, 'voiceover');

    const bgClips: any[] = [];
const captionClips: any[] = [];

for (let i = 0; i < scenes.length; i++) {
  const scene: any = scenes[i];

  const start = byName.get(`s${i + 1}`);
  const nextStart = byName.get(`s${i + 2}`);

  let sceneStart = start;

if (typeof sceneStart !== 'number') {
  this.logger.warn(`[TTS] Missing mark s${i + 1}, estimating start time`);

  sceneStart = scenes
    .slice(0, i)
    .reduce((t, s) => t + this.estimateSeconds(s.narration), 0);
}

  const sceneEnd = typeof nextStart === 'number' ? nextStart : end;

  // ✅ real duration based on audio marks
 const length = Math.max(1.2, Number((sceneEnd - sceneStart).toFixed(2)));

  // ✅ AI image per scene using visualPrompt
  const visualPrompt = String(scene.visualPrompt || '').trim();
  if (!visualPrompt) throw new Error(`Missing visualPrompt at scene index=${i}`);

  const imgPublicId = `${jobKey}-scene-${i}`;
  const sceneImageUrl = await this.aiImages.generateSceneImageUrl(visualPrompt, imgPublicId);

  await this.preflight(sceneImageUrl, `sceneImage-${i}`);


  bgClips.push({
  asset: { type: 'image', src: sceneImageUrl },
  start: sceneStart,
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
    start: sceneStart,
    length,
  });
}

bgClips.sort((a, b) => a.start - b.start);
captionClips.sort((a, b) => a.start - b.start);

    // ✅ NO BACKGROUND MUSIC: only image + captions + voiceover audio track
    const payload: any = {
      timeline: {
        tracks: [
          { clips: bgClips },
          { clips: captionClips },
          {
            clips: [
              {
                asset: { type: 'audio', src: voiceoverUrl },
                start: 0,
                length: Math.max(1, Math.ceil(end)),
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

    this.logger.log(`[ShotstackPayload] scenes=${scenes.length} totalSeconds=${Math.ceil(end)} voiceHost=${this.shortHost(voiceoverUrl)}`);

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