/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import axios from 'axios';
import { Injectable, Logger } from '@nestjs/common';
import { Scene } from './interfaces/scene.interface';
import { GoogleTtsService } from '../tts/google-tts.service';
import { AiImageService } from '../ai/ai-image.service';
import * as fs from 'fs';
import * as path from 'path';
import { shotstackHeaders, shotstackRenderUrl } from './shotstack.config';

type ShotstackValidationIssue = {
  path: string;
  code:
    | 'CLIP_VOLUME_MOVED'
    | 'INVALID_EFFECT_REMOVED'
    | 'NEGATIVE_START_CLAMPED'
    | 'UNSUPPORTED_CLIP_PROPERTY_REMOVED'
    | 'UNSUPPORTED_ASSET_PROPERTY_REMOVED'
    | 'MISSING_REQUIRED_FIELD'
    | 'INVALID_ASSET_TYPE'
    | 'INVALID_CLIP_TIMING'
    | 'INVALID_TIMELINE'
    | 'INVALID_OUTPUT'
    | 'UNSUPPORTED_OUTPUT_PROPERTY_REMOVED';
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

const VALID_ASSET_TYPES = new Set(['image', 'video', 'audio', 'html', 'title']);
const VALID_OUTPUT_FORMATS = new Set(['mp4']);
const VALID_OUTPUT_RESOLUTIONS = new Set(['preview', 'mobile', 'sd', 'hd', '1080']);
const VALID_OUTPUT_ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:5']);
const OUTPUT_ALLOWED_KEYS = new Set(['format', 'resolution', 'aspectRatio']);
const VALID_CLIP_POSITION = new Set(['top', 'bottom', 'center', 'left', 'right']);
const CLIP_ALLOWED_KEYS = new Set([
  'asset',
  'start',
  'length',
  'position',
  'offset',
  'effect',
  'transition',
  'filter',
  'opacity',
  'transform',
  'volume',
]);
const ASSET_ALLOWED_KEYS: Record<string, Set<string>> = {
  image: new Set(['type', 'src', 'crop']),
  video: new Set(['type', 'src', 'trim', 'volume', 'crop']),
  audio: new Set(['type', 'src', 'trim', 'volume']),
  html: new Set(['type', 'html', 'css', 'width', 'height', 'background']),
  title: new Set(['type', 'text', 'style', 'color', 'size', 'background', 'position']),
};

export type SafeShotstackProviderError = {
  statusCode: number | null;
  requestId: string | null;
  validationMessages: string[];
};

export class ShotstackProviderError extends Error {
  constructor(
    public readonly publicMessage: string,
    public readonly safe: SafeShotstackProviderError,
  ) {
    super(publicMessage);
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function collectValidationMessages(payload: any): string[] {
  const candidates = [
    payload?.error?.message,
    payload?.error?.details,
    payload?.response?.error,
    payload?.response?.message,
    payload?.message,
  ];
  const messages: string[] = [];

  for (const candidate of candidates.flatMap(asArray)) {
    if (typeof candidate === 'string' && candidate.trim()) messages.push(candidate.trim());
    if (candidate && typeof candidate === 'object') {
      const obj = candidate as Record<string, unknown>;
      for (const key of ['message', 'detail', 'description', 'error']) {
        const value = obj[key];
        if (typeof value === 'string' && value.trim()) messages.push(value.trim());
      }
    }
  }

  return [...new Set(messages)].slice(0, 10);
}

export function serializeShotstackProviderError(error: unknown): SafeShotstackProviderError {
  const response = (error as any)?.response;
  const data = response?.data;
  const headers = response?.headers || {};
  return {
    statusCode: typeof response?.status === 'number' ? response.status : null,
    requestId:
      String(headers['x-request-id'] || headers['x-shotstack-request-id'] || data?.request_id || data?.requestId || '').trim() || null,
    validationMessages: collectValidationMessages(data),
  };
}

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
    issues.push({
      path: 'timeline.tracks',
      code: 'INVALID_TIMELINE',
      value: tracks,
    });
    return { payload: sanitized, issues };
  }

  if (tracks.length === 0) {
    issues.push({
      path: 'timeline.tracks',
      code: 'INVALID_TIMELINE',
      value: tracks,
    });
  }

  const output = sanitized?.output;
  if (!output || typeof output !== 'object') {
    issues.push({ path: 'output', code: 'INVALID_OUTPUT', value: output });
  } else {
    for (const key of Object.keys(output)) {
      if (!OUTPUT_ALLOWED_KEYS.has(key)) {
        issues.push({
          path: `output.${key}`,
          code: 'UNSUPPORTED_OUTPUT_PROPERTY_REMOVED',
          value: output[key],
        });
        delete output[key];
      }
    }
    if (!VALID_OUTPUT_FORMATS.has(String(output.format || ''))) {
      issues.push({ path: 'output.format', code: 'INVALID_OUTPUT', value: output.format });
    }
    if (output.resolution != null && !VALID_OUTPUT_RESOLUTIONS.has(String(output.resolution))) {
      issues.push({ path: 'output.resolution', code: 'INVALID_OUTPUT', value: output.resolution });
    }
    if (output.aspectRatio != null && !VALID_OUTPUT_ASPECT_RATIOS.has(String(output.aspectRatio))) {
      issues.push({ path: 'output.aspectRatio', code: 'INVALID_OUTPUT', value: output.aspectRatio });
    }
  }

  tracks.forEach((track: any, trackIndex: number) => {
    if (!Array.isArray(track?.clips)) {
      issues.push({
        path: `timeline.tracks[${trackIndex}].clips`,
        code: 'INVALID_TIMELINE',
        value: track?.clips,
      });
      return;
    }

    track.clips.forEach((clip: any, clipIndex: number) => {
      const path = `timeline.tracks[${trackIndex}].clips[${clipIndex}]`;
      const asset = clip?.asset;

      if (!clip || typeof clip !== 'object') {
        issues.push({ path, code: 'INVALID_TIMELINE', value: clip });
        return;
      }

      for (const key of Object.keys(clip)) {
        if (!CLIP_ALLOWED_KEYS.has(key)) {
          issues.push({
            path: `${path}.${key}`,
            code: 'UNSUPPORTED_CLIP_PROPERTY_REMOVED',
            value: clip[key],
          });
          delete clip[key];
        }
      }

      if (typeof clip?.start === 'number' && clip.start < 0) {
        issues.push({
          path: `${path}.start`,
          code: 'NEGATIVE_START_CLAMPED',
          value: clip.start,
        });
        clip.start = clampStart(clip.start);
      }

      if (typeof clip?.start !== 'number' || !Number.isFinite(clip.start) || typeof clip?.length !== 'number' || !Number.isFinite(clip.length) || clip.length <= 0) {
        issues.push({
          path,
          code: 'INVALID_CLIP_TIMING',
          value: { start: clip?.start, length: clip?.length },
        });
      }

      if (clip?.effect && !sanitizeShotstackEffect(clip.effect)) {
        issues.push({
          path: `${path}.effect`,
          code: 'INVALID_EFFECT_REMOVED',
          value: clip.effect,
        });
        delete clip.effect;
      }

      if (clip?.position && !VALID_CLIP_POSITION.has(String(clip.position))) {
        issues.push({
          path: `${path}.position`,
          code: 'UNSUPPORTED_CLIP_PROPERTY_REMOVED',
          value: clip.position,
        });
        delete clip.position;
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

      if (!asset || typeof asset !== 'object') {
        issues.push({ path: `${path}.asset`, code: 'MISSING_REQUIRED_FIELD' });
        return;
      }

      const assetType = String(asset.type || '');
      if (!VALID_ASSET_TYPES.has(assetType)) {
        issues.push({ path: `${path}.asset.type`, code: 'INVALID_ASSET_TYPE', value: asset.type });
        return;
      }

      const allowed = ASSET_ALLOWED_KEYS[assetType] ?? new Set(['type']);
      for (const key of Object.keys(asset)) {
        if (!allowed.has(key)) {
          issues.push({
            path: `${path}.asset.${key}`,
            code: 'UNSUPPORTED_ASSET_PROPERTY_REMOVED',
            value: asset[key],
          });
          delete asset[key];
        }
      }

      const requiredContentField = assetType === 'html' ? 'html' : assetType === 'title' ? 'text' : 'src';
      if (typeof asset[requiredContentField] !== 'string' || !asset[requiredContentField].trim()) {
        issues.push({ path: `${path}.asset.${requiredContentField}`, code: 'MISSING_REQUIRED_FIELD' });
      }
    });
  });

  return { payload: sanitized, issues };
}

@Injectable()
export class ShotstackService {
  private readonly logger = new Logger(ShotstackService.name);
  private readonly targetVideoSeconds = Number(process.env.VIDEO_TARGET_SECONDS || 75);
  private payloadDebugSequence = 0;

  constructor(
    private readonly tts: GoogleTtsService,
    private readonly aiImages: AiImageService,
  ) {}

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
        asset: { type: 'image', src: images[i] },
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
      },
    };

    const validation = validateShotstackPayload(payload);
    if (validation.issues.length > 0) {
      this.logger.warn(
        `[ShotstackPayloadValidation] ${JSON.stringify(this.summarizePayloadIssues(validation.issues))}`,
      );
    }
    const blockingIssues = validation.issues.filter((issue) =>
      ['MISSING_REQUIRED_FIELD', 'INVALID_ASSET_TYPE', 'INVALID_CLIP_TIMING', 'INVALID_TIMELINE', 'INVALID_OUTPUT'].includes(issue.code),
    );
    if (blockingIssues.length > 0) {
      throw new ShotstackProviderError('Video render failed because the render payload was invalid.', {
        statusCode: null,
        requestId: null,
        validationMessages: blockingIssues.map((issue) => `${issue.code} at ${issue.path}`),
      });
    }
    const shotstackPayloadDebugPath = this.maybeSaveDebugPayload(jobId, validation.payload);

    this.logger.log(
      `[ShotstackRender] scenes=${renderScenes.length} duration=${Math.ceil(renderEnd)}`,
    );

    let res;
    try {
      res = await axios.post(shotstackRenderUrl(), validation.payload, {
        headers: shotstackHeaders(),
        timeout: 60000,
      });
    } catch (error) {
      const safe = serializeShotstackProviderError(error);
      const hasValidationFailure =
        safe.statusCode === 400 ||
        safe.validationMessages.some((message) => /validation|unknown property|timeline|asset/i.test(message));
      const publicMessage = hasValidationFailure
        ? 'Video render failed because the render payload was invalid.'
        : 'Video render failed at the render provider.';
      this.logger.warn(
        `[ShotstackRenderFailed] status=${safe.statusCode ?? 'unknown'} requestId=${safe.requestId ?? 'none'} validationMessages=${JSON.stringify(safe.validationMessages)}`,
      );
      throw new ShotstackProviderError(publicMessage, safe);
    }

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
