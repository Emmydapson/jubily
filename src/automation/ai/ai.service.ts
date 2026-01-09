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
          content:
            'You are a professional viral short-form content script writer for African entrepreneurs and tech founders.',
        },
        {
          role: 'user',
          content: `Write a 60 second viral short video script about: ${topic}. Hook viewers in first 3 seconds. End with strong call to action.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 300,
    });

    const text = completion.choices[0].message.content;

if (!text) {
  throw new Error('OpenAI returned empty content');
}

return text;

  }
}
