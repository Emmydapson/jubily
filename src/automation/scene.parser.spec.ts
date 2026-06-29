import { extractScenes } from './scene.parser';

describe('extractScenes duration targeting', () => {
  it('scales short JSON scripts toward the 60-90 second target range', () => {
    const script = JSON.stringify({
      scenes: Array.from({ length: 8 }, (_, index) => ({
        narration: `Scene ${index + 1} explains one practical step in the routine.`,
        caption: `Step ${index + 1}`,
        visualPrompt: 'person doing a simple wellness habit, bright natural light, realistic, no text',
        seconds: 5,
      })),
    });

    const scenes = extractScenes(script);
    const total = scenes.reduce((sum, scene) => sum + scene.duration, 0);

    expect(scenes).toHaveLength(8);
    expect(total).toBeGreaterThanOrEqual(60);
    expect(total).toBeLessThanOrEqual(90);
  });

  it('scales 12-scene scripts into the 60-90 second target range', () => {
    const script = JSON.stringify({
      scenes: Array.from({ length: 12 }, (_, index) => ({
        narration: `Scene ${index + 1} explains one practical step in the routine.`,
        caption: `Step ${index + 1}`,
        visualPrompt: 'person doing a simple wellness habit, bright natural light, realistic, no text',
        seconds: 4,
      })),
    });

    const scenes = extractScenes(script);
    const total = scenes.reduce((sum, scene) => sum + scene.duration, 0);

    expect(scenes).toHaveLength(12);
    expect(total).toBeGreaterThanOrEqual(60);
    expect(total).toBeLessThanOrEqual(90);
  });

  it('scales plain text fallback scripts toward the 60-90 second target range', () => {
    const script = Array.from({ length: 8 }, (_, index) => `Plain text scene ${index + 1} for a wellness video.`).join('\n');
    const scenes = extractScenes(script);
    const total = scenes.reduce((sum, scene) => sum + scene.duration, 0);

    expect(scenes).toHaveLength(8);
    expect(total).toBeGreaterThanOrEqual(60);
    expect(total).toBeLessThanOrEqual(90);
  });
});
