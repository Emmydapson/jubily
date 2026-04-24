/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import axios from 'axios';

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
  private readonly aiMode = (process.env.AI_MODE || 'live').toLowerCase();

  private readonly apiKey = process.env.DEEPSEEK_API_KEY;
  private readonly baseUrl = 'https://api.deepseek.com/v1/chat/completions';
  private readonly model = 'deepseek-chat';

  private async callDeepseek(messages: any[]) {
    const res = await axios.post(
      this.baseUrl,
      {
        model: this.model,
        messages,
        temperature: 0.6,
      },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      },
    );

    return res.data?.choices?.[0]?.message?.content;
  }

  async generateTopics(count = 25): Promise<string[]> {
  if (this.aiMode === 'mock' || !this.apiKey) {
    return [
      'Morning routine for energy',
      'Better sleep habits',
      'Hydration tips',
      'Quick stress relief',
    ];
  }

  const text = await this.callDeepseek([
    {
      role: 'system',
      content: `
You are a content engine.

Return ONLY valid JSON in this format:
{
  "topics": [
    "short health video title",
    "another title"
  ]
}

Rules:
- Health & wellness only
- No numbering
- No explanations
- Max 12 words per topic
- Return EXACTLY ${count} items
`,
    },
    {
      role: 'user',
      content: `Generate ${count} viral health & wellness short-form video topics`,
    },
  ]);

  if (!text) return [];

  const cleaned = text
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed?.topics)) return [];
    return parsed.topics;
  } catch (e) {
    this.logger.warn(`[AI] JSON parse failed, raw output: ${cleaned}`);
    return [];
  }
}
  async generateScriptWithOffer(
  topic: string,
  offer: { name: string; url: string; bullets?: string[] },
): Promise<string> {
    if (this.aiMode === 'mock' || !this.apiKey) {
      const mock = this.buildMockScript(topic);
      mock.cta = `Check ${offer.name}: ${offer.url}`;
      return JSON.stringify(mock);
    }

    const text = await this.callDeepseek([
      {
        role: 'system',
        content: `Return JSON script and include product recommendation naturally`,
      },
      {
        role: 'user',
        content: `
Topic: ${topic}

Offer:
- Name: ${offer.name}
- Link: ${offer.url}
- Benefits: ${(offer.bullets || []).join(', ')}

Make the recommendation feel natural, not salesy.
`,
      },
    ]);

    const json = this.safeParseJson(text);
    if (!json) throw new Error('Invalid JSON');

    return JSON.stringify(json);
  }

  private safeParseJson(text: string): ScriptJson | null {
    try {
      return JSON.parse(
        text.replace(/```json|```/g, '').trim(),
      );
    } catch {
      return null;
    }
  }

  private buildMockScript(topic: string): ScriptJson {
    return {
      title: topic,
      cta: 'Follow for more',
      scenes: [
        {
          narration: `Quick tip about ${topic}`,
          caption: 'Quick tip',
          visualPrompt: 'simple lifestyle scene',
          seconds: 5,
        },
      ],
    };
  }
}