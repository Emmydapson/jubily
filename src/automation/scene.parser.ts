/* eslint-disable prettier/prettier */
import { Scene } from './videos/interfaces/scene.interface';

const TARGET_SECONDS = 75;
const MIN_SCENE_SECONDS = 6;
const MAX_SCENE_SECONDS = 12;

function estimateSecondsFromText(text: string, wps = 2.3) {
  // ~2.2–2.6 words/sec is typical for short VO
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  const raw = words / wps;
  return Math.max(MIN_SCENE_SECONDS, Math.min(MAX_SCENE_SECONDS, raw)); // clamp per scene
}

function normalizeSceneDurations(scenes: Scene[]) {
  const total = scenes.reduce((a, s) => a + s.duration, 0);
  const scale = total > 0 ? TARGET_SECONDS / total : 1;

  return scenes.map((s) => ({
    ...s,
    duration: Math.max(MIN_SCENE_SECONDS, Math.min(MAX_SCENE_SECONDS, Number((s.duration * scale).toFixed(2)))),
  }));
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

        // Prefer explicit reviewed timing, with narration-based timing as fallback.
        const requestedSeconds = Number(s.seconds || s.duration || 0);
        const dur = requestedSeconds > 0 ? requestedSeconds : estimateSecondsFromText(narration);

        return {
          index: i + 1,
          narration,
          caption,
          visualPrompt,
          duration: dur,
        } as Scene;
      })
      .filter(Boolean) as Scene[];

    return normalizeSceneDurations(mapped);
  } catch {
    // plain text fallback
    const lines = script.split('\n').filter(Boolean);
    return normalizeSceneDurations(lines.map((line, i) => {
      const narration = line.trim();
      return {
        index: i + 1,
        narration,
        caption: narration.split(' ').slice(0, 6).join(' ') + '…',
        visualPrompt: narration,
        duration: estimateSecondsFromText(narration),
      };
    }));
  }
}
