/* eslint-disable prettier/prettier */
import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

type Scene = {
  narration: string;
  caption: string;
  visualPrompt: string;
  seconds: number;
};

type ScriptJson = {
  title: string;
  cta: string;
  hashtags?: string[];
  scenes: Scene[];
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly aiMode = (process.env.AI_MODE || 'live').toLowerCase();

  private openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // ------------------------
  // 🎯 TOPIC GENERATION
  // ------------------------
  async generateTopics(count = 10): Promise<string[]> {
    if (this.aiMode === 'mock') {
      return [
        'Why you feel tired after sleeping',
        'The hidden cause of low energy',
        'Morning habits ruining your day',
      ];
    }

    const res = await this.openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content: `
You are a viral content strategist.

Return ONLY JSON:
{
  "topics": ["topic1", "topic2"]
}

Rules:
- Health + wellness niche
- Highly curiosity-driven
- Max 10 words each
- No numbering
- EXACTLY ${count} topics
          `,
        },
        {
          role: 'user',
          content: `Generate ${count} viral short-form video topics`,
        },
      ],
    });

    const text = res.choices[0].message.content || '';

    try {
      return JSON.parse(text).topics || [];
    } catch {
      this.logger.warn('[AI] Topic parse failed');
      return [];
    }
  }

  // ------------------------
  // 🎬 SCRIPT GENERATION (UPGRADED)
  // ------------------------
  async generateScript(topic: string): Promise<string> {
    if (this.aiMode === 'mock') {
      return JSON.stringify(this.buildMockScript(topic));
    }

    const res = await this.openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content: `
You are a viral TikTok/Reels script generator.

Return ONLY JSON:

{
  "title": "",
  "cta": "",
  "hashtags": [],
  "scenes": [
    {
      "narration": "",
      "caption": "",
      "visualPrompt": "",
      "seconds": number
    }
  ]
}

STRICT RULES:

🎯 STRUCTURE:
- Total video: 45–60 seconds
- 5–7 scenes
- Scene length: 5–9 seconds

🔥 HOOK:
- First scene MUST be a strong pattern interrupt
- Create curiosity or shock

⚡ PACING:
- Fast, punchy narration
- Each scene must feel different

🎬 VISUAL PROMPTS (VERY IMPORTANT):
Each visualPrompt must include:
- camera movement (zoom in, pan, slow motion)
- subject action
- lighting style
- mood
- realism

Example:
"close-up of tired woman waking up, slow zoom in, morning sunlight, cinematic lighting, realistic"

🚫 DO NOT:
- Use generic prompts
- Repeat visuals
- Add text inside image

🎯 CONTENT STYLE:
- Relatable
- Simple language
- No medical claims

Return ONLY JSON. No explanation.
          `,
        },
        {
          role: 'user',
          content: topic,
        },
      ],
    });

    const text = res.choices[0].message.content || '';

    try {
      const parsed = JSON.parse(text);
      return JSON.stringify(parsed);
    } catch {
      this.logger.error('[AI] Script parse failed');
      throw new Error('INVALID_SCRIPT_JSON');
    }
  }

  // ------------------------
  // 🧪 MOCK
  // ------------------------
  private buildMockScript(topic: string): ScriptJson {
    return {
      title: topic,
      cta: 'Follow for more health tips',
      hashtags: ['#health', '#wellness', '#fyp'],
      scenes: [
        {
          narration: `You’re doing this every morning… and it’s draining your energy.`,
          caption: 'Stop doing this',
          visualPrompt:
            'person waking up tired in bed, slow zoom in, soft morning light, cinematic, realistic',
          seconds: 6,
        },
        {
          narration: `Your body actually needs this instead.`,
          caption: 'Here’s why',
          visualPrompt:
            'person drinking water, close-up, bright lighting, clean lifestyle, realistic',
          seconds: 6,
        },
        {
          narration: `Fix this one habit and everything changes.`,
          caption: 'Game changer',
          visualPrompt:
            'person stretching confidently, slow motion, sunrise background, cinematic',
          seconds: 6,
        },
      ],
    };
  }
}