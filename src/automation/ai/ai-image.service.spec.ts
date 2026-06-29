import { AiImageService } from './ai-image.service';

describe('AiImageService scene image generation', () => {
  it('returns parallel scene image results in input scene order', async () => {
    const service = new AiImageService({} as never, { logEvent: jest.fn() } as never);
    const delays = new Map([
      ['scene-0', 30],
      ['scene-1', 5],
      ['scene-2', 15],
    ]);

    jest.spyOn(service as any, 'generateSceneImageUrl').mockImplementation(async (_prompt: string, publicId: string) => {
      await new Promise((resolve) => setTimeout(resolve, delays.get(publicId) || 0));
      return `https://cdn.example.com/${publicId}.jpg`;
    });

    await expect(
      service.generateMultipleScenes([
        { visualPrompt: 'first', publicId: 'scene-0' },
        { visualPrompt: 'second', publicId: 'scene-1' },
        { visualPrompt: 'third', publicId: 'scene-2' },
      ]),
    ).resolves.toEqual([
      'https://cdn.example.com/scene-0.jpg',
      'https://cdn.example.com/scene-1.jpg',
      'https://cdn.example.com/scene-2.jpg',
    ]);
  });
});
