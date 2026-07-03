import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import {
  sanitizeShotstackEffect,
  ShotstackService,
  shotstackRenderUrl,
  validateShotstackPayload,
} from './shotstack.service';
import { Scene } from './interfaces/scene.interface';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ShotstackService payload validation', () => {
  const oldEnv = process.env;

  let tts: {
    synthesizeWithMarksToCloudinaryMp3: jest.Mock;
  };
  let aiImages: {
    generateMultipleScenes: jest.Mock;
  };
  let service: ShotstackService;

  const scenes: Scene[] = [
    {
      index: 0,
      narration: 'Start the day with one focused habit',
      caption: 'Focused habit',
      duration: 2,
      visualPrompt: 'person planning morning habit',
    },
    {
      index: 1,
      narration: 'Keep the next step small and visible',
      caption: 'Small step',
      duration: 2,
      visualPrompt: 'small checklist on desk',
    },
  ];

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = {
      ...oldEnv,
      SHOTSTACK_API_KEY: 'test-shotstack-key',
      MUSIC_DEFAULT: 'https://cdn.example.com/music.mp3',
      SFX_POP: 'https://cdn.example.com/pop.mp3',
      DEBUG_SHOTSTACK_PAYLOAD: 'false',
    };

    tts = {
      synthesizeWithMarksToCloudinaryMp3: jest.fn().mockResolvedValue({
        url: 'https://cdn.example.com/voice.mp3',
        timepoints: [
          { markName: 's1', timeSeconds: -0.5 },
          { markName: 's2', timeSeconds: 1.5 },
          { markName: 'end', timeSeconds: 4 },
        ],
      }),
    };
    aiImages = {
      generateMultipleScenes: jest.fn().mockResolvedValue([
        'https://cdn.example.com/image-1.jpg',
        'https://cdn.example.com/image-2.jpg',
      ]),
    };
    mockedAxios.post.mockResolvedValue({ data: { response: { id: 'render-1' } } });

    service = new ShotstackService(tts as never, aiImages as never);
  });

  afterAll(() => {
    process.env = oldEnv;
  });

  function postedPayload() {
    return mockedAxios.post.mock.calls[0][1] as any;
  }

  function allClips(payload: any) {
    return payload.timeline.tracks.flatMap((track: any) => track.clips);
  }

  function imageClips(payload: any) {
    return allClips(payload).filter((clip: any) => clip.asset?.type === 'image');
  }

  function subtitleClips(payload: any) {
    return allClips(payload).filter((clip: any) => clip.asset?.type === 'html');
  }

  it('moves audio volume to the audio asset and removes clip-level volume', () => {
    const { payload, issues } = validateShotstackPayload({
      timeline: {
        tracks: [
          {
            clips: [
              {
                asset: { type: 'audio', src: 'https://cdn.example.com/a.mp3' },
                start: 0,
                length: 1,
                volume: 0.25,
              },
            ],
          },
        ],
      },
    });

    const clip = payload.timeline.tracks[0].clips[0];
    expect(clip.volume).toBeUndefined();
    expect(clip.asset.volume).toBe(0.25);
    expect(issues).toEqual([
      expect.objectContaining({ code: 'CLIP_VOLUME_MOVED' }),
    ]);
  });

  it('only allows Shotstack-supported effect names', () => {
    expect(sanitizeShotstackEffect('zoomIn')).toBe('zoomIn');
    expect(sanitizeShotstackEffect('slideLeftFast')).toBe('slideLeftFast');
    expect(sanitizeShotstackEffect('fadeIn')).toBeUndefined();
    expect(sanitizeShotstackEffect('panLeft')).toBeUndefined();

    const { payload } = validateShotstackPayload({
      timeline: {
        tracks: [
          {
            clips: [
              { asset: { type: 'image', src: 'a.jpg' }, start: 0, length: 1, effect: 'fadeIn' },
              { asset: { type: 'image', src: 'b.jpg' }, start: 1, length: 1, effect: 'zoomOutSlow' },
            ],
          },
        ],
      },
    });

    expect(payload.timeline.tracks[0].clips[0].effect).toBeUndefined();
    expect(payload.timeline.tracks[0].clips[1].effect).toBe('zoomOutSlow');
  });

  it('clamps negative start values before posting to Shotstack', async () => {
    await service.renderVideo(scenes, 'job-1');

    const starts = allClips(postedPayload()).map((clip: any) => clip.start);
    expect(starts.every((start: number) => start >= 0)).toBe(true);
  });


  it('constructs Shotstack render URLs without duplicating the render path', () => {
    expect(shotstackRenderUrl()).toBe('https://api.shotstack.io/edit/v1/render');
    expect(shotstackRenderUrl('https://api.shotstack.io/edit/v1')).toBe('https://api.shotstack.io/edit/v1/render');
    expect(shotstackRenderUrl('https://api.shotstack.io/edit/v1/render')).toBe('https://api.shotstack.io/edit/v1/render');
    expect(shotstackRenderUrl('https://api.shotstack.io/edit/v1/render/')).toBe('https://api.shotstack.io/edit/v1/render');
  });
  it('posts a validated payload without invalid volume or effect fields', async () => {
    await service.renderVideo(scenes, 'job-1');

    const payload = postedPayload();
    const clips = allClips(payload);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.shotstack.io/edit/v1/render',
      expect.any(Object),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'test-shotstack-key',
        }),
      }),
    );
    expect(clips.some((clip: any) => Object.prototype.hasOwnProperty.call(clip, 'volume'))).toBe(false);
    expect(
      clips
        .map((clip: any) => clip.effect)
        .filter(Boolean)
        .every((effect: string) => sanitizeShotstackEffect(effect) === effect),
    ).toBe(true);
  });

  it('saves the sanitized Shotstack payload JSON only when debug payloads are enabled', async () => {
    process.env.DEBUG_SHOTSTACK_PAYLOAD = 'true';
    const jobId = `debug-test-${Date.now()}`;

    const result = await service.renderVideo(scenes, jobId);

    const dir = path.resolve(process.cwd(), 'tmp', 'shotstack-payloads');
    const file = fs.readdirSync(dir).find((name) => name.startsWith(`${jobId}-`) && name.endsWith('.json'));
    expect(file).toBeDefined();
    expect(result.shotstackPayloadDebugPath).toBe(path.join(dir, file || ''));
    const payload = JSON.parse(fs.readFileSync(path.join(dir, file || ''), 'utf8'));
    expect(payload.timeline.tracks).toBeDefined();
    expect(payload.output).toEqual(expect.objectContaining({ format: 'mp4' }));
  });

  it('returns QA metadata without writing a debug payload by default', async () => {
    const result = await service.renderVideo(scenes, 'job-qa');

    expect(result).toEqual({
      renderId: 'render-1',
      durationSeconds: 75,
      sceneCount: 2,
      hasBurnedSubtitles: true,
      shotstackPayloadDebugPath: null,
    });
  });

  it('rejects multi-scene renders when scene image URLs collapse to one unique URL', async () => {
    aiImages.generateMultipleScenes.mockResolvedValue([
      'https://cdn.example.com/same.jpg',
      'https://cdn.example.com/same.jpg',
    ]);

    await expect(service.renderVideo(scenes, 'job-1')).rejects.toThrow(
      'one unique URL for 2 scenes',
    );
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('allows multi-scene renders when scene image URLs are unique', async () => {
    await service.renderVideo(scenes, 'job-1');

    const images = imageClips(postedPayload());
    expect(new Set(images.map((clip: any) => clip.asset.src)).size).toBe(2);
  });

  it('creates image clips with unique start and duration pairs', async () => {
    await service.renderVideo(scenes, 'job-1');

    const images = imageClips(postedPayload());
    const timingKeys = images.map((clip: any) => `${clip.start}:${clip.length}`);
    expect(new Set(timingKeys).size).toBe(images.length);
  });

  it('rejects duplicate image clip start and duration pairs before posting', () => {
    expect(() =>
      (service as never as { verifyImageClipTiming: (clips: any[], jobId?: string) => void }).verifyImageClipTiming([
        { start: 0, length: 10 },
        { start: 0, length: 10 },
      ], 'job-1'),
    ).toThrow('Image clips must have unique start/duration pairs');
  });

  it('rejects image clips with timeline gaps or overlaps before posting', () => {
    expect(() =>
      (service as never as { verifyImageClipsSequential: (clips: any[], jobId?: string) => void }).verifyImageClipsSequential([
        { start: 0, length: 10 },
        { start: 12, length: 10 },
      ], 'job-1'),
    ).toThrow('Image clips must be sequential');
  });

  it('does not create any image clip that covers the full timeline when there are multiple scenes', async () => {
    await service.renderVideo(scenes, 'job-1');

    const images = imageClips(postedPayload());
    const renderEnd = images.reduce((max: number, clip: any) => Math.max(max, clip.start + clip.length), 0);
    expect(images.every((clip: any) => !(clip.start === 0 && clip.length >= renderEnd))).toBe(true);
  });

  it('rejects full-timeline image clips before posting when multiple image clips exist', () => {
    expect(() =>
      (service as never as { verifyNoFullTimelineImageClip: (clips: any[], renderEnd: number, jobId?: string) => void }).verifyNoFullTimelineImageClip([
        { start: 0, length: 75 },
        { start: 25, length: 25 },
      ], 75, 'job-1'),
    ).toThrow('Image clips must not cover the full timeline');
  });

  it('renders explicit high quality vertical 1080p Shorts output', async () => {
    await service.renderVideo(scenes, 'job-1');

    expect(postedPayload().output).toEqual({
      format: 'mp4',
      resolution: '1080',
      aspectRatio: '9:16',
      fps: 30,
      quality: 'high',
    });
  });

  it('forces render timing to the 60-90 second target even when source scene durations are short', async () => {
    tts.synthesizeWithMarksToCloudinaryMp3.mockResolvedValue({
      url: 'https://cdn.example.com/voice.mp3',
      timepoints: [],
    });

    await service.renderVideo(scenes, 'job-1');

    const images = imageClips(postedPayload());
    const total = images.reduce((sum: number, clip: any) => sum + clip.length, 0);
    expect(total).toBe(75);
    expect(images.map((clip: any) => clip.length)).toEqual([37.5, 37.5]);
    expect(tts.synthesizeWithMarksToCloudinaryMp3).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      [37.5, 37.5],
    );
  });

  it('creates one timed image clip per scene using cumulative timing when TTS scene marks are missing', async () => {
    tts.synthesizeWithMarksToCloudinaryMp3.mockResolvedValue({
      url: 'https://cdn.example.com/voice.mp3',
      timepoints: [{ markName: 'end', timeSeconds: 6 }],
    });
    aiImages.generateMultipleScenes.mockResolvedValue([
      'https://cdn.example.com/image-1.jpg',
      'https://cdn.example.com/image-2.jpg',
      'https://cdn.example.com/image-3.jpg',
    ]);

    await service.renderVideo([
      ...scenes,
      {
        index: 2,
        narration: 'Finish with one repeatable action',
        caption: 'Repeatable action',
        duration: 2,
        visualPrompt: 'habit tracker card',
      },
    ], 'job-1');

    const images = imageClips(postedPayload());
    expect(images).toHaveLength(3);
    expect(images.map((clip: any) => clip.asset.src)).toEqual([
      'https://cdn.example.com/image-1.jpg',
      'https://cdn.example.com/image-2.jpg',
      'https://cdn.example.com/image-3.jpg',
    ]);
    expect(images.map((clip: any) => clip.start)).toEqual([0, 25, 50]);
    expect(images.map((clip: any) => clip.length)).toEqual([25, 25, 25]);
    expect(tts.synthesizeWithMarksToCloudinaryMp3).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      [25, 25, 25],
    );
  });

  it('does not create a single full-timeline image clip when there are multiple scenes', async () => {
    tts.synthesizeWithMarksToCloudinaryMp3.mockResolvedValue({
      url: 'https://cdn.example.com/voice.mp3',
      timepoints: [{ markName: 'end', timeSeconds: 4 }],
    });

    await service.renderVideo(scenes, 'job-1');

    const payload = postedPayload();
    const images = imageClips(payload);
    const renderLength = payload.timeline.tracks
      .flatMap((track: any) => track.clips)
      .reduce((max: number, clip: any) => Math.max(max, clip.start + clip.length), 0);

    expect(images).toHaveLength(2);
    expect(images.every((clip: any) => clip.length < renderLength)).toBe(true);
  });

  it('ignores duplicate TTS scene marks so image clips do not all overlap at the same start', async () => {
    tts.synthesizeWithMarksToCloudinaryMp3.mockResolvedValue({
      url: 'https://cdn.example.com/voice.mp3',
      timepoints: [
        { markName: 's1', timeSeconds: 0 },
        { markName: 's2', timeSeconds: 0 },
        { markName: 'end', timeSeconds: 4 },
      ],
    });

    await service.renderVideo(scenes, 'job-1');

    const images = imageClips(postedPayload());
    expect(images.map((clip: any) => clip.start)).toEqual([0, 37.5]);
    expect(images.map((clip: any) => clip.asset.fit)).toEqual(['cover', 'cover']);
    expect(images.map((clip: any) => clip.position)).toEqual(['center', 'center']);
  });

  it('includes visible top-track subtitle clips with valid timing', async () => {
    await service.renderVideo(scenes, 'job-1');

    const payload = postedPayload();
    const topTrack = payload.timeline.tracks[0];
    const subtitles = subtitleClips(payload);

    expect(topTrack.clips.every((clip: any) => clip.asset.type === 'html')).toBe(true);
    expect(subtitles.length).toBeGreaterThan(0);
    expect(subtitles.every((clip: any) => clip.start >= 0 && clip.length > 0)).toBe(true);
    expect(subtitles[0]).toEqual(
      expect.objectContaining({
        position: 'bottom',
        asset: expect.objectContaining({
          type: 'html',
          css: expect.stringContaining('font-size: 48px'),
          width: 960,
          height: 220,
          background: 'rgba(0,0,0,0.72)',
        }),
        offset: { x: 0, y: 0.1 },
      }),
    );
    expect(subtitles.map((clip: any) => clip.asset.html).join(' ')).toContain('Focused');
  });
});
