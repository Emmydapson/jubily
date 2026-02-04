/* eslint-disable prettier/prettier */
import { Scene } from './videos/interfaces/scene.interface';

export function extractScenes(script: string): Scene[] {
  const lines = script.split('\n').filter(Boolean);

  return lines.map((line, i) => ({
    index: i + 1,
    text: line.trim(),
    duration: Math.max(3, Math.ceil(line.length / 12)),
  }));
}