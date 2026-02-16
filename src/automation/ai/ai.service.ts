/* eslint-disable prettier/prettier */
import OpenAI from 'openai';
import { Injectable } from '@nestjs/common';

type Scene = {
  narration: string;
  caption: string;
  visualPrompt: string;
  seconds: number;
};

type ScriptJson = {
  title: string;
  cta: string;
  scenes: Scene[];
};

@Injectable()
export class AiService {
  private client?: OpenAI;
  private readonly model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  private readonly aiMode = (process.env.AI_MODE || 'live').toLowerCase(); // live | mock

  constructor() {
    const key = process.env.OPENAI_API_KEY;

    // Only init OpenAI client if we intend to use it
    if (key && this.aiMode !== 'mock') {
      this.client = new OpenAI({ apiKey: key });
    }
  }

  async generateScript(topic: string): Promise<string> {
    // ✅ Mock mode: no cost, full pipeline test
    if (this.aiMode === 'mock' || !this.client) {
      const mock = this.buildMockScript(topic);
      return JSON.stringify(mock);
    }

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `
You create 60-second vertical short video scripts STRICTLY about HEALTH & WELLNESS.
Allowed: nutrition, fitness, sleep, mental wellness, hydration, healthy habits.
Not allowed: politics, finance, sex content, hate, violence, or non-health niches.

Important safety:
- Do not give medical diagnosis or treatment.
- Avoid claiming cures.
- Use cautious language ("may help", "often", "generally").

Output MUST be valid JSON ONLY with this shape:
{
  "title": "string",
  "cta": "string",
  "scenes": [
    {
      "narration": "string (voiceover line)",
      "caption": "string (short on-screen text, 3-8 words)",
      "visualPrompt": "string (what to show visually, realistic b-roll description)",
      "seconds": number (3-6)
    }
  ]
}

Rules:
- Total duration sum(seconds) must be 55-65 seconds.
- Hook in first 3 seconds.
- Captions must NOT repeat full narration.
- visualPrompt should be concrete (e.g., "close-up of cutting fresh vegetables", "person walking outdoors at sunrise").
          `.trim(),
        },
        {
          role: 'user',
          content: `Create a 60-second health & wellness short video about: ${topic}`,
        },
      ],
      temperature: 0.6,
      max_tokens: 800,
    });

    const text = completion.choices?.[0]?.message?.content;
    if (!text) throw new Error('OpenAI returned empty content');

    // ✅ Defensive: ensure it’s JSON. If not, throw with a helpful error.
    const json = this.safeParseJson(text);
    if (!json) {
      throw new Error(`AI returned non-JSON content. First 200 chars: ${text.slice(0, 200)}`);
    }

    return JSON.stringify(json);
  }

  private safeParseJson(text: string): ScriptJson | null {
    // Sometimes models wrap JSON in ```json blocks
    const cleaned = text
      .replace(/^\s*```json\s*/i, '')
      .replace(/^\s*```\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    try {
      const parsed = JSON.parse(cleaned);

      // Minimal validation so your pipeline doesn’t explode later
      if (!parsed?.title || !parsed?.cta || !Array.isArray(parsed?.scenes)) return null;
      return parsed as ScriptJson;
    } catch {
      return null;
    }
  }

  private buildMockScript(topic: string): ScriptJson {
    // 11 scenes x ~5s = ~55s (within 55–65 requirement)
    const scenes: Scene[] = [
      { narration: `Quick tip: ${topic} — here’s a simple way to start today.`, caption: 'Start today', visualPrompt: 'close-up of a person setting a simple daily routine checklist', seconds: 5 },
      { narration: `Rule one: keep it easy and consistent—small wins add up.`, caption: 'Small wins', visualPrompt: 'person putting a glass of water on a desk next to a notebook', seconds: 5 },
      { narration: `Rule two: set a tiny goal you can repeat for 7 days.`, caption: '7-day goal', visualPrompt: 'calendar with a 7-day streak being marked', seconds: 5 },
      { narration: `If you miss a day, don’t quit—just restart the next day.`, caption: 'Restart fast', visualPrompt: 'person smiling and checking off the next day on a calendar', seconds: 5 },
      { narration: `Hydration helps many people feel more energized and focused.`, caption: 'Hydrate', visualPrompt: 'pouring water into a reusable bottle', seconds: 5 },
      { narration: `Add protein to breakfast to stay fuller longer, generally.`, caption: 'Protein first', visualPrompt: 'simple breakfast prep: eggs, yogurt, or beans on a plate', seconds: 5 },
      { narration: `Try a 3-minute walk break—movement may boost mood.`, caption: '3-min walk', visualPrompt: 'person walking outdoors at sunrise, phone in pocket', seconds: 5 },
      { narration: `Stretch your hips and back gently—no pain, just ease.`, caption: 'Gentle stretch', visualPrompt: 'person doing light stretching on a yoga mat', seconds: 5 },
      { narration: `For better sleep, dim lights and avoid heavy meals late.`, caption: 'Sleep setup', visualPrompt: 'warm lamp lighting in a calm bedroom scene', seconds: 5 },
      { narration: `Keep your routine simple: plan, do, review—repeat.`, caption: 'Plan → Do → Repeat', visualPrompt: 'notebook with three bullet points being written', seconds: 5 },
      { narration: `If you want more quick health scripts like this, follow and save this video.`, caption: 'Follow & save', visualPrompt: 'hand tapping “save” and “follow” icons on a phone screen (no branding)', seconds: 5 },
    ];

    return {
      title: `60s Health Habit: ${topic}`,
      cta: 'Follow for more quick health tips and save this for later.',
      scenes,
    };
  }
}
