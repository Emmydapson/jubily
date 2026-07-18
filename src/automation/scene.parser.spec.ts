import { extractScenes } from './scene.parser';

describe('extractScenes duration targeting', () => {
  it('keeps short JSON scripts in the Standard short-form pacing range', () => {
    const script = JSON.stringify({
      scenes: Array.from({ length: 8 }, (_, index) => ({
        narration: `Scene ${index + 1} explains one practical step in the routine.`,
        caption: `Step ${index + 1}`,
        visualPrompt:
          'person doing a simple wellness habit, bright natural light, realistic, no text',
        seconds: 5,
      })),
    });

    const scenes = extractScenes(script);
    const total = scenes.reduce((sum, scene) => sum + scene.duration, 0);

    expect(scenes).toHaveLength(8);
    expect(total).toBe(40);
    expect(scenes.every((scene) => scene.duration <= 5)).toBe(true);
  });

  it('keeps 12-scene scripts in the Standard short-form target range', () => {
    const script = JSON.stringify({
      scenes: Array.from({ length: 12 }, (_, index) => ({
        narration: `Scene ${index + 1} explains one practical step in the routine.`,
        caption: `Step ${index + 1}`,
        visualPrompt:
          'person doing a simple wellness habit, bright natural light, realistic, no text',
        seconds: 4,
      })),
    });

    const scenes = extractScenes(script);
    const total = scenes.reduce((sum, scene) => sum + scene.duration, 0);

    expect(scenes).toHaveLength(12);
    expect(total).toBe(48);
    expect(scenes.every((scene) => scene.duration <= 5)).toBe(true);
  });

  it('keeps plain text fallback scripts paced as short visual beats', () => {
    const script = Array.from(
      { length: 8 },
      (_, index) => `Plain text scene ${index + 1} for a wellness video.`,
    ).join('\n');
    const scenes = extractScenes(script);
    const total = scenes.reduce((sum, scene) => sum + scene.duration, 0);

    expect(scenes).toHaveLength(8);
    expect(total).toBeGreaterThanOrEqual(20);
    expect(total).toBeLessThanOrEqual(40);
    expect(
      scenes.every((scene) => scene.duration >= 2.5 && scene.duration <= 5),
    ).toBe(true);
  });
});
