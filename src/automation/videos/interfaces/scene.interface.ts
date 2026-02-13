/* eslint-disable prettier/prettier */
export interface Scene {
  index: number;
  narration: string;   // full voiceover sentence
  caption: string;     // short on-screen text
  duration: number;

  visualPrompt: string; // ✅ add this (required)
  // visualQuery?: string; // optional - you can remove this if not used
}
