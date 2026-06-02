/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import axios from 'axios';
import { Injectable, Logger } from '@nestjs/common';
import { Scene } from './interfaces/scene.interface';
import { GoogleTtsService } from '../tts/google-tts.service';
import { AiImageService } from '../ai/ai-image.service';
import * as fs from 'fs';
import * as path from 'path';

type ShotstackValidationIssue = {
  path: string;
  code: 'CLIP_VOLUME_MOVED' | 'INVALID_EFFECT_REMOVED' | 'NEGATIVE_START_CLAMPED';
  value?: unknown;
};

type ShotstackValidationResult = {
  payload: any;
  issues: ShotstackValidationIssue[];
};

const VALID_SHOTSTACK_EFFECTS = new Set([
  'zoomIn',
  'zoomInSlow',
  'zoomInFast',
  'zoomOut',
  'zoomOutSlow',
  'zoomOutFast',
  'slideLeft',
  'slideLeftSlow',
  'slideLeftFast',
  'slideRight',
  'slideRightSlow',
  'slideRightFast',
  'slideUp',
  'slideUpSlow',
  'slideUpFast',
  'slideDown',
  'slideDownSlow',
  'slideDownFast',
]);

function clonePayload<T>(payload: T): T {
  return JSON.parse(JSON.stringify(payload)) as T;
}

function clampStart(value: unknown): number {
  return Math.max(0, typeof value === 'number' && Number.isFinite(value) ? value : 0);
}

function safeLength(value: unknown, fallback = 1.5): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function escapeHtml(text: string) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeShotstackEffect(effect: unknown): string | undefined {
  if (typeof effect !== 'string') return undefined;
  return VALID_SHOTSTACK_EFFECTS.has(effect) ? effect : undefined;
}

export function validateShotstackPayload(payload: any): ShotstackValidationResult {
  const sanitized = clonePayload(payload);
  const issues: ShotstackValidationIssue[] = [];
  const tracks = sanitized?.timeline?.tracks;

  if (!Array.isArray(tracks)) {
    return { payload: sanitized, issues };
  }

  tracks.forEach((track: any, trackIndex: number) => {
    if (!Array.isArray(track?.clips)) return;

    track.clips.forEach((clip: any, clipIndex: number) => {
      const path = `timeline.tracks[${trackIndex}].clips[${clipIndex}]`;

      if (typeof clip?.start === 'number' && clip.start < 0) {
        issues.push({
          path: `${path}.start`,
          code: 'NEGATIVE_START_CLAMPED',
          value: clip.start,
        });
        clip.start = clampStart(clip.start);
      }

      if (clip?.effect && !sanitizeShotstackEffect(clip.effect)) {
        issues.push({
          path: `${path}.effect`,
          code: 'INVALID_EFFECT_REMOVED',
          value: clip.effect,
        });
        delete clip.effect;
      }

      if (Object.prototype.hasOwnProperty.call(clip, 'volume')) {
        const volume = clip.volume;
        if (clip?.asset?.type === 'audio' && typeof volume === 'number' && Number.isFinite(volume)) {
          clip.asset.volume = Math.max(0, Math.min(1, volume));
        }
        delete clip.volume;
        issues.push({
          path: `${path}.volume`,
          code: 'CLIP_VOLUME_MOVED',
          value: volume,
        });
      }
    });
  });

  return { payload: sanitized, issues };
}

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

    const perChunk = safeLength(duration / Math.max(chunks.length, 1), duration);

    const safeStart = clampStart(start);

    return chunks.map((chunk, i) => ({
      asset: {
        type: 'html',
        html: `<p>${escapeHtml(chunk)}</p>`,
        css: 'p { color: #ffffff; font-size: 52px; font-family: Arial; font-weight: 900; text-align: center; background-color: #000000; padding: 22px; line-height: 62px; }',
        width: 960,
        height: 220,
      },
      start: clampStart(safeStart + i * perChunk),
      length: perChunk,
      position: 'bottom',
      offset: { x: 0, y: -0.06 },
    }));
  }

  private buildSceneTimings(scenes: Scene[], byName: Map<string, number>, end: number) {
    let cursor = 0;
    const fallbackStarts = scenes.map((scene) => {
      const start = cursor;
      cursor += safeLength(scene.duration || this.estimateSeconds(scene.narration));
      return start;
    });
    const fallbackEnd = Math.max(cursor, end || 0);
    const totalEnd = end && end > 0 ? end : fallbackEnd;

    return scenes.map((scene, i) => {
      const markedStart = byName.get(`s${i + 1}`);
      const markedNext = byName.get(`s${i + 2}`);
      const start = clampStart(typeof markedStart === 'number' ? markedStart : fallbackStarts[i]);
      let next = typeof markedNext === 'number' ? clampStart(markedNext) : (fallbackStarts[i + 1] ?? totalEnd);

      if (next <= start) {
        next = start + safeLength(scene.duration || this.estimateSeconds(scene.narration));
      }

      if (i === scenes.length - 1 && totalEnd > start) {
        next = Math.max(next, totalEnd);
      }

      return {
        start,
        length: safeLength(next - start),
      };
    });
  }

  private summarizePayloadIssues(issues: ShotstackValidationIssue[]) {
    const counts = issues.reduce<Record<string, number>>((acc, issue) => {
      acc[issue.code] = (acc[issue.code] ?? 0) + 1;
      return acc;
    }, {});

    return {
      counts,
      paths: issues.slice(0, 8).map((issue) => ({
        path: issue.path,
        code: issue.code,
      })),
    };
  }

  private maybeSaveDebugPayload(jobId: string | undefined, payload: any) {
    if (process.env.DEBUG_SHOTSTACK_PAYLOAD !== 'true' && process.env.NODE_ENV !== 'development') {
      return;
    }

    try {
      const dir = path.resolve(process.cwd(), 'tmp', 'shotstack-payloads');
      fs.mkdirSync(dir, { recursive: true });
      const safeJobId = String(jobId || `job-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
      const file = path.join(dir, `${safeJobId}.json`);
      fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
      this.logger.log(`[ShotstackPayloadDebug] saved=${file}`);
    } catch (error) {
      this.logger.warn(`[ShotstackPayloadDebug] save failed msg=${error instanceof Error ? error.message : String(error)}`);
    }
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

    const bgClips: any[] = [];
    const subtitleClips: any[] = [];
    const sfxClips: any[] = [];

    const motionEffects = [
      'zoomIn',
      'zoomOut',
      'slideLeft',
      'slideRight',
      'slideUp',
    ];
    const sceneTimings = this.buildSceneTimings(scenes, byName, end);
    const renderEnd = Math.max(
      end,
      ...sceneTimings.map((timing) => timing.start + timing.length),
    );

    // ------------------------
    // 🎬 BUILD SCENES
    // ------------------------
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const { start, length } = sceneTimings[i];

      const effect = sanitizeShotstackEffect(motionEffects[i % motionEffects.length]);

      // ------------------------
      // 🎥 BACKGROUND IMAGE
      // ------------------------
      bgClips.push({
        asset: { type: 'image', src: images[i] },
        start,
        length,
        ...(effect ? { effect } : {}),
      });

      // ------------------------
      // 📝 SUBTITLES (GROUPED)
      // ------------------------
      const subtitleBlocks = this.buildGroupedSubtitles(
        scene.caption || scene.narration,
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
          src: process.env.SFX_POP || '',
          volume: 0.15,
        },
        start,
        length: 0.25,
      });
    }

    // ------------------------
    // 🎞️ FINAL PAYLOAD
    // ------------------------
    const payload = {
      timeline: {
        tracks: [
          // Shotstack renders the first track on top, so subtitles must precede images.
          { clips: subtitleClips },
          { clips: bgClips },

          // 🎙 voiceover
          {
            clips: [
              {
                asset: { type: 'audio', src: voiceoverUrl },
                start: 0,
                length: Math.ceil(renderEnd),
              },
            ],
          },

          // 🎵 background music
          {
            clips: [
              {
                asset: {
                  type: 'audio',
                  src: this.pickMusic(scenes[0].narration) || '',
                  volume: 0.08,
                },
                start: 0,
                length: Math.ceil(renderEnd),
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

    const validation = validateShotstackPayload(payload);
    if (validation.issues.length > 0) {
      this.logger.warn(
        `[ShotstackPayloadValidation] ${JSON.stringify(this.summarizePayloadIssues(validation.issues))}`,
      );
    }
    this.maybeSaveDebugPayload(jobId, validation.payload);

    this.logger.log(
      `[ShotstackRender] scenes=${scenes.length} duration=${Math.ceil(renderEnd)}`,
    );

    const res = await axios.post(`${this.baseUrl}/render`, validation.payload, {
      headers: {
        'x-api-key': this.apiKey(),
        'x-shotstack-stage': 'true',
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });

    const renderId = res.data?.response?.id;

    if (!renderId) {
      throw new Error('Shotstack did not return render id');
    }

    this.logger.log(`[ShotstackRenderCreated] id=${renderId}`);

    return renderId;
  }
}
