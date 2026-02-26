/* eslint-disable prettier/prettier */
import { Scene } from './videos/interfaces/scene.interface';

function estimateSecondsFromText(text: string, wps = 2.3) {
  // ~2.2–2.6 words/sec is typical for short VO
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  const raw = words / wps;
  return Math.max(2.8, Math.min(8.0, raw)); // clamp per scene
}

export function extractScenes(script: string): Scene[] {
  try {
    const obj = JSON.parse(script);
    const scenes = Array.isArray(obj?.scenes) ? obj.scenes : [];
    if (!scenes.length) throw new Error('No scenes');

    let mapped = scenes
      .map((s: any, i: number) => {
        const narration = String(s.narration ?? '').trim();
        const caption = String(s.caption ?? '').trim();
        const visualPrompt = String(s.visualPrompt ?? '').trim();
        if (!narration || !caption) return null;

        // prefer narration-based timing (fixes early audio)
        const dur = estimateSecondsFromText(narration);

        return {
          index: i + 1,
          narration,
          caption,
          visualPrompt,
          duration: dur,
        } as Scene;
      })
      .filter(Boolean) as Scene[];

    // scale to ~58s target (keeps Shorts length consistent)
    const total = mapped.reduce((a, s) => a + s.duration, 0);
    const target = 58;
    const scale = total > 0 ? target / total : 1;

    mapped = mapped.map((s) => ({
      ...s,
      duration: Math.max(2.8, Math.min(8.0, Number((s.duration * scale).toFixed(2)))),
    }));

    return mapped;
  } catch {
    // plain text fallback
    const lines = script.split('\n').filter(Boolean);
    return lines.map((line, i) => {
      const narration = line.trim();
      return {
        index: i + 1,
        narration,
        caption: narration.split(' ').slice(0, 6).join(' ') + '…',
        visualPrompt: narration,
        duration: estimateSecondsFromText(narration),
      };
    });
  }
}