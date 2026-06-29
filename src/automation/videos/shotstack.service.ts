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

export type ShotstackRenderResult = {
  renderId: string;
  durationSeconds: number;
  sceneCount: number;
  hasBurnedSubtitles: boolean;
  shotstackPayloadDebugPath: string | null;
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
  private readonly targetVideoSeconds = Number(process.env.VIDEO_TARGET_SECONDS || 75);
  private payloadDebugSequence = 0;

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
    return Math.max(6, Math.min(12, words / 2.2));
  }

  private normalizeRenderScenes(scenes: Scene[]) {
    const measured = scenes.map((scene) => ({
      ...scene,
      duration: safeLength(scene.duration || this.estimateSeconds(scene.narration)),
    }));
    const total = measured.reduce((sum, scene) => sum + scene.duration, 0);
    const target = this.targetVideoSeconds >= 60 && this.targetVideoSeconds <= 90
      ? this.targetVideoSeconds
      : 75;
    const scale = total > 0 ? target / total : 1;

    return measured.map((scene) => ({
      ...scene,
      duration: Number((scene.duration * scale).toFixed(2)),
    }));
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
        html: `<p data-html-type="text">${escapeHtml(chunk)}</p>`,
        css: 'p { color: #ffffff; font-size: 48px; line-height: 1.12; font-weight: 800; font-family: Arial, sans-serif; text-align: center; text-shadow: 0 3px 8px rgba(0,0,0,0.95); padding: 18px 26px; border-radius: 18px; }',
        width: 960,
        height: 220,
        background: 'rgba(0,0,0,0.72)',
      },
      start: clampStart(safeStart + i * perChunk),
      length: perChunk,
      position: 'bottom',
      offset: { x: 0, y: 0.1 },
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

  private usableSceneMarks(scenes: Scene[], byName: Map<string, number>) {
    const marks = scenes.map((_, i) => byName.get(`s${i + 1}`));
    if (marks.some((mark) => typeof mark !== 'number' || !Number.isFinite(mark))) {
      return new Map<string, number>();
    }

    for (let i = 1; i < marks.length; i++) {
      if ((marks[i] as number) <= (marks[i - 1] as number)) {
        this.logger.warn('[ShotstackTiming] ignoring non-monotonic TTS scene marks');
        return new Map<string, number>();
      }
      const markedLength = (marks[i] as number) - (marks[i - 1] as number);
      if (markedLength < scenes[i - 1].duration * 0.5) {
        this.logger.warn('[ShotstackTiming] ignoring compressed TTS scene marks');
        return new Map<string, number>();
      }
    }

    if ((marks[0] as number) < 0) {
      this.logger.warn('[ShotstackTiming] ignoring negative TTS scene marks');
      return new Map<string, number>();
    }

    return byName;
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

  private maybeSaveDebugPayload(jobId: string | undefined, payload: any): string | null {
    if (process.env.DEBUG_SHOTSTACK_PAYLOAD !== 'true') return null;

    try {
      const dir = path.resolve(process.cwd(), 'tmp', 'shotstack-payloads');
      fs.mkdirSync(dir, { recursive: true });
      const safeJobId = String(jobId || `job-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
      const file = path.join(dir, `${safeJobId}-${Date.now()}-${++this.payloadDebugSequence}.json`);
      fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
      this.logger.log(`[ShotstackPayloadDebug] saved=${file}`);
      return file;
    } catch (error) {
      this.logger.warn(`[ShotstackPayloadDebug] save failed msg=${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private verifySceneImageUrls(images: string[], sceneCount: number, jobId?: string) {
    const validImages = images.filter((url) => typeof url === 'string' && url.trim());
    const uniqueImages = new Set(validImages);

    this.logger.log(
      `[ShotstackImages] job=${jobId || 'unknown'} scenes=${sceneCount} urls=${validImages.length} uniqueUrls=${uniqueImages.size}`,
    );

    if (validImages.length !== sceneCount) {
      throw new Error(`Scene image generation returned ${validImages.length}/${sceneCount} usable URLs`);
    }

    if (sceneCount > 1 && uniqueImages.size <= 1) {
      throw new Error(`Scene image generation returned one unique URL for ${sceneCount} scenes`);
    }
  }

  private verifyImageClipTiming(bgClips: any[], jobId?: string) {
    const timingKeys = bgClips.map((clip) => `${Number(clip.start).toFixed(3)}:${Number(clip.length).toFixed(3)}`);
    const uniqueTimingKeys = new Set(timingKeys);

    this.logger.log(
      `[ShotstackImageTiming] job=${jobId || 'unknown'} clips=${bgClips.length} uniqueTimings=${uniqueTimingKeys.size}`,
    );

    if (bgClips.length > 1 && uniqueTimingKeys.size !== bgClips.length) {
      throw new Error(`Image clips must have unique start/duration pairs (${uniqueTimingKeys.size}/${bgClips.length})`);
    }
  }

  private verifyImageClipsSequential(bgClips: any[], jobId?: string) {
    const sorted = [...bgClips].sort((a, b) => Number(a.start || 0) - Number(b.start || 0));
    let issues = 0;

    for (let i = 0; i < sorted.length; i++) {
      const clip = sorted[i];
      const start = Number(clip.start || 0);
      const length = Number(clip.length || 0);
      const end = start + length;

      if (length <= 0) issues++;
      if (i === 0 && Math.abs(start) > 0.001) issues++;

      const next = sorted[i + 1];
      if (next) {
        const nextStart = Number(next.start || 0);
        if (Math.abs(nextStart - end) > 0.05) issues++;
      }
    }

    this.logger.log(
      `[ShotstackImageSequence] job=${jobId || 'unknown'} clips=${bgClips.length} issues=${issues}`,
    );

    if (issues > 0) {
      throw new Error(`Image clips must be sequential with no timing gaps or overlaps (issues=${issues})`);
    }
  }

  private verifyNoFullTimelineImageClip(bgClips: any[], renderEnd: number, jobId?: string) {
    const fullTimelineClips = bgClips.filter((clip) => {
      const start = Number(clip.start || 0);
      const length = Number(clip.length || 0);
      return start <= 0.001 && length >= renderEnd - 0.001;
    });

    this.logger.log(
      `[ShotstackImageCoverage] job=${jobId || 'unknown'} clips=${bgClips.length} fullTimelineClips=${fullTimelineClips.length}`,
    );

    if (bgClips.length > 1 && fullTimelineClips.length > 0) {
      throw new Error(`Image clips must not cover the full timeline (${fullTimelineClips.length}/${bgClips.length})`);
    }
  }

  private verifySubtitleTrackAboveImages(tracks: any[], jobId?: string) {
    const subtitleTrackIndex = tracks.findIndex((track) =>
      Array.isArray(track?.clips) && track.clips.some((clip: any) => clip.asset?.type === 'html'),
    );
    const imageTrackIndex = tracks.findIndex((track) =>
      Array.isArray(track?.clips) && track.clips.some((clip: any) => clip.asset?.type === 'image'),
    );

    this.logger.log(
      `[ShotstackTrackOrder] job=${jobId || 'unknown'} subtitleTrack=${subtitleTrackIndex} imageTrack=${imageTrackIndex}`,
    );

    if (subtitleTrackIndex < 0 || imageTrackIndex < 0) {
      throw new Error('Shotstack payload must include subtitle and image tracks');
    }

    if (subtitleTrackIndex >= imageTrackIndex) {
      throw new Error(`Subtitle track must be above image track (${subtitleTrackIndex} >= ${imageTrackIndex})`);
    }
  }

  // ------------------------
  // 🚀 MAIN RENDER FUNCTION
  // ------------------------
  async renderVideo(scenes: Scene[], jobId?: string): Promise<ShotstackRenderResult> {
    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new Error('renderVideo: scenes empty');
    }

    const renderScenes = this.normalizeRenderScenes(scenes);
    const jobKey = `job-${Date.now()}`;
    const narrations = renderScenes.map((s) => s.narration);
    const sceneDurations = renderScenes.map((s) => s.duration);

    // 🎙️ TTS generation
    const { url: voiceoverUrl, timepoints } =
      await this.tts.synthesizeWithMarksToCloudinaryMp3(narrations, jobKey, sceneDurations);

    const byName = new Map<string, number>();
    for (const tp of timepoints || []) {
      if (tp?.markName && typeof tp.timeSeconds === 'number') {
        byName.set(tp.markName, tp.timeSeconds);
      }
    }

    let end = byName.get('end');

    if (!end) {
      end = sceneDurations.reduce((t, n) => t + n, 0);
    }

    // 🎨 AI images (parallel)
    const images = await this.aiImages.generateMultipleScenes(
      renderScenes.map((s, i) => ({
        visualPrompt: s.visualPrompt,
        publicId: `${jobKey}-scene-${i}`,
        jobId,
      })),
    );
    this.verifySceneImageUrls(images, renderScenes.length, jobId);

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
    const timingMarks = this.usableSceneMarks(renderScenes, byName);
    const sceneTimings = this.buildSceneTimings(renderScenes, timingMarks, end);
    const renderEnd = Math.max(
      end,
      ...sceneTimings.map((timing) => timing.start + timing.length),
    );

    // ------------------------
    // 🎬 BUILD SCENES
    // ------------------------
    for (let i = 0; i < renderScenes.length; i++) {
      const scene = renderScenes[i];
      const { start, length } = sceneTimings[i];

      const effect = sanitizeShotstackEffect(motionEffects[i % motionEffects.length]);

      // ------------------------
      // 🎥 BACKGROUND IMAGE
      // ------------------------
      bgClips.push({
        asset: { type: 'image', src: images[i], fit: 'cover' },
        start,
        length,
        position: 'center',
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
    this.verifyImageClipTiming(bgClips, jobId);
    this.verifyImageClipsSequential(bgClips, jobId);
    this.verifyNoFullTimelineImageClip(bgClips, renderEnd, jobId);

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
                  src: this.pickMusic(renderScenes[0].narration) || '',
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
        resolution: '1080',
        aspectRatio: '9:16',
        fps: 30,
        quality: 'high',
      },
    };

    const validation = validateShotstackPayload(payload);
    if (validation.issues.length > 0) {
      this.logger.warn(
        `[ShotstackPayloadValidation] ${JSON.stringify(this.summarizePayloadIssues(validation.issues))}`,
      );
    }
    const shotstackPayloadDebugPath = this.maybeSaveDebugPayload(jobId, validation.payload);

    this.logger.log(
      `[ShotstackRender] scenes=${renderScenes.length} duration=${Math.ceil(renderEnd)}`,
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

    return {
      renderId,
      durationSeconds: Number(renderEnd.toFixed(2)),
      sceneCount: renderScenes.length,
      hasBurnedSubtitles: subtitleClips.length > 0,
      shotstackPayloadDebugPath,
    };
  }
}
