/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import axios from 'axios';
import { Injectable, Logger } from '@nestjs/common';
import { Scene } from './interfaces/scene.interface';
import { GoogleTtsService } from '../tts/google-tts.service';
import { AiImageService } from '../ai/ai-image.service';

@Injectable()
export class ShotstackService {
  private readonly logger = new Logger(ShotstackService.name);
  private readonly baseUrl = 'https://api.shotstack.io/stage';

  constructor(
    private readonly tts: GoogleTtsService,
    private readonly aiImages: AiImageService,
  ) {}

  private apiKey(): string {
    const k = process.env.SHOTSTACK_API_KEY;
    if (!k) throw new Error('Missing SHOTSTACK_API_KEY');
    return k;
  }

  // ------------------------
  // ⏱️ duration estimation fallback
  // ------------------------
  private estimateSeconds(narration: string) {
    const words = narration.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(3, Math.min(9, words / 2.2));
  }

  // ------------------------
  // 🎵 MOOD-BASED MUSIC SELECTION
  // ------------------------
  private pickMusic(topic: string) {
    const t = topic.toLowerCase();

    if (t.includes('stress') || t.includes('anxiety')) {
      return process.env.MUSIC_CALM;
    }

    if (t.includes('energy') || t.includes('morning')) {
      return process.env.MUSIC_UPBEAT;
    }

    if (t.includes('sleep') || t.includes('night')) {
      return process.env.MUSIC_SOFT;
    }

    return process.env.MUSIC_DEFAULT;
  }

  // ------------------------
  // 🎯 GROUPED SUBTITLES (OPTIMIZED — NOT WORD EXPLOSION)
  // ------------------------
  private buildGroupedSubtitles(text: string, start: number, duration: number) {
    const words = text.split(' ').filter(Boolean);

    // group words in chunks (prevents Shotstack overload)
    const chunkSize = 3;
    const chunks: string[] = [];

    for (let i = 0; i < words.length; i += chunkSize) {
      chunks.push(words.slice(i, i + chunkSize).join(' '));
    }

    const perChunk = duration / chunks.length;

    return chunks.map((chunk, i) => ({
      asset: {
        type: 'html',
        html: `
        <div style="
          width:100%; height:100%;
          display:flex;
          align-items:flex-end;
          justify-content:center;
          padding:80px;
          font-family:Arial;
          font-size:58px;
          font-weight:900;
          color:white;
          text-align:center;
          text-shadow: 0 4px 18px rgba(0,0,0,0.95);
        ">
          <div style="
            background: rgba(0,0,0,0.55);
            padding:22px 32px;
            border-radius:18px;
            backdrop-filter: blur(6px);
          ">
            ${chunk}
          </div>
        </div>
        `,
      },
      start: start + i * perChunk,
      length: perChunk,
    }));
  }

  // ------------------------
  // 🚀 MAIN RENDER FUNCTION
  // ------------------------
  async renderVideo(scenes: Scene[], jobId?: string): Promise<string> {
    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new Error('renderVideo: scenes empty');
    }

    const jobKey = `job-${Date.now()}`;
    const narrations = scenes.map((s) => s.narration);

    // 🎙️ TTS generation
    const { url: voiceoverUrl, timepoints } =
      await this.tts.synthesizeWithMarksToCloudinaryMp3(narrations, jobKey);

    const byName = new Map<string, number>();
    for (const tp of timepoints || []) {
      if (tp?.markName && typeof tp.timeSeconds === 'number') {
        byName.set(tp.markName, tp.timeSeconds);
      }
    }

    let end = byName.get('end');

    if (!end) {
      end = narrations.reduce((t, n) => t + this.estimateSeconds(n), 0);
    }

    // 🎨 AI images (parallel)
    const images = await this.aiImages.generateMultipleScenes(
      scenes.map((s, i) => ({
        visualPrompt: s.visualPrompt,
        publicId: `${jobKey}-scene-${i}`,
        jobId,
      })),
    );

    const bgClips = [];
    const subtitleClips = [];
    const sfxClips = [];

    const motionEffects = [
      'zoomIn',
      'zoomOut',
      'panLeft',
      'panRight',
      'fadeIn',
    ];

    // ------------------------
    // 🎬 BUILD SCENES
    // ------------------------
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];

      let start = byName.get(`s${i + 1}`) ?? 0;
      let next = byName.get(`s${i + 2}`) ?? end;

      let length = Math.max(1.5, next - start);

      // slight overlap for smooth flow
      if (i !== 0) start -= 0.25;

      const effect = motionEffects[i % motionEffects.length];

      // ------------------------
      // 🎥 BACKGROUND IMAGE
      // ------------------------
      bgClips.push({
        asset: { type: 'image', src: images[i] },
        start,
        length,
        effect,
      });

      // ------------------------
      // 📝 SUBTITLES (GROUPED)
      // ------------------------
      const subtitleBlocks = this.buildGroupedSubtitles(
        scene.narration,
        start,
        length,
      );

      subtitleClips.push(...subtitleBlocks);

      // ------------------------
      // 🔊 SFX (soft pop per scene)
      // ------------------------
      sfxClips.push({
        asset: {
          type: 'audio',
          src: process.env.SFX_POP,
        },
        start,
        length: 0.25,
        volume: 0.15,
      });
    }

    // ------------------------
    // 🎞️ FINAL PAYLOAD
    // ------------------------
    const payload = {
      timeline: {
        tracks: [
          { clips: bgClips },
          { clips: subtitleClips },

          // 🎙 voiceover
          {
            clips: [
              {
                asset: { type: 'audio', src: voiceoverUrl },
                start: 0,
                length: Math.ceil(end),
              },
            ],
          },

          // 🎵 background music
          {
            clips: [
              {
                asset: {
                  type: 'audio',
                  src: this.pickMusic(scenes[0].narration),
                },
                start: 0,
                length: Math.ceil(end),
                volume: 0.08,
              },
            ],
          },

          // 🔊 SFX layer
          {
            clips: sfxClips,
          },
        ],
      },

      output: {
        format: 'mp4',
        resolution: 'hd',
      },
    };

    this.logger.log(
      `[ShotstackRender] scenes=${scenes.length} duration=${Math.ceil(end)}`,
    );

    const res = await axios.post(`${this.baseUrl}/render`, payload, {
      headers: {
        'x-api-key': this.apiKey(),
        'x-shotstack-stage': 'true',
        'Content-Type': 'application/json',
      },
    });

    const renderId = res.data?.response?.id;

    if (!renderId) {
      throw new Error('Shotstack did not return render id');
    }

    this.logger.log(`[ShotstackRenderCreated] id=${renderId}`);

    return renderId;
  }
}