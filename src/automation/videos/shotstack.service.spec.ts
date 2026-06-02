import axios from 'axios';
import {
  sanitizeShotstackEffect,
  ShotstackService,
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

  it('posts a validated payload without invalid volume or effect fields', async () => {
    await service.renderVideo(scenes, 'job-1');

    const payload = postedPayload();
    const clips = allClips(payload);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/render'),
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
    expect(images.map((clip: any) => clip.start)).toEqual([0, 2, 4]);
    expect(images.map((clip: any) => clip.length)).toEqual([2, 2, 2]);
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
          css: expect.stringContaining('font-size: 52px'),
          width: 960,
          height: 220,
        }),
      }),
    );
    expect(subtitles.map((clip: any) => clip.asset.html).join(' ')).toContain('Focused');
  });
});
