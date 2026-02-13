/* eslint-disable prettier/prettier */
import OpenAI from 'openai';
import { Injectable } from '@nestjs/common';

@Injectable()
export class AiService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async generateScript(topic: string): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
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

    const text = completion.choices[0].message.content;
    if (!text) throw new Error('OpenAI returned empty content');
    return text;
  }
}
