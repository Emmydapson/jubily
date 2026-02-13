/* eslint-disable prettier/prettier */
import { Scene } from './videos/interfaces/scene.interface';

function makeCaption(text: string) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  return words.slice(0, 6).join(' ') + (words.length > 6 ? '…' : '');
}

export function extractScenes(script: string): Scene[] {
  // Try JSON first
  try {
    const obj = JSON.parse(script);

    const scenes = Array.isArray(obj?.scenes) ? obj.scenes : [];
    if (!scenes.length) throw new Error('No scenes');

    return scenes.map((s: any, i: number) => ({
      index: i + 1,
      narration: String(s.narration ?? '').trim(),
      caption: String(s.caption ?? '').trim(),
      visualPrompt: String(s.visualPrompt ?? '').trim(),
      duration: Math.max(3, Math.min(8, Number(s.seconds ?? 4))),
    })).filter((s: Scene) => s.narration && s.caption);
  } catch {
    // Fallback: old plain-text parsing
    const lines = script.split('\n').filter(Boolean);
    return lines.map((line, i) => ({
      index: i + 1,
      narration: line.trim(),
      caption: line.trim().split(' ').slice(0, 6).join(' ') + '…',
      visualPrompt: line.trim(),
      duration: Math.max(3, Math.ceil(line.length / 18)),
    }));
  }
}