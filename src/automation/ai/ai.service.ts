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
  hook?: string;
  cta: string;
  hashtags?: string[];
  youtubeDescription?: string;
  thumbnailPrompt?: string;
  scenes: Scene[];
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly aiMode = (process.env.AI_MODE || 'live').toLowerCase();

  private openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

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
You are a viral TikTok/Reels/YouTube Shorts script generator.

Return ONLY JSON:

{
  "title": "",
  "hook": "",
  "cta": "",
  "hashtags": [],
  "youtubeDescription": "",
  "thumbnailPrompt": "",
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
- Target 60-90 seconds total, with 75 seconds ideal.
- Use 8-12 scenes; prefer 9 or 10 scenes for a 60-90 second video.
- Each scene must have "seconds" between 6 and 12.
- The sum of all scene "seconds" must be between 60 and 90.
- Do not create 25-40 second scripts.
- First scene must create curiosity in the first 2 seconds.
- The top-level hook must work as the first line of a YouTube Shorts description.
- Narration should be fast, plain, concrete, and non-repetitive.
- CTA must be soft: save, follow, comment, or see resources in the description.
- Do not include raw URLs in narration or CTA.
- Keep health claims cautious. No diagnosis, cures, guaranteed results, or fearmongering.
- Every visualPrompt must include camera movement, subject action, lighting, mood, realism, and "no text".
- Thumbnail prompt must describe a high-contrast vertical thumbnail image with no text.
- YouTube description should be 2-4 concise lines and include no raw affiliate URLs.
- Return only JSON. No explanation.
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

  private buildMockScript(topic: string): ScriptJson {
    return {
      title: topic,
      hook: `This common habit may be draining your energy.`,
      cta: 'Save this and follow for more simple health tips.',
      hashtags: ['#shorts', '#healthtips', '#wellness', '#energy'],
      youtubeDescription: `${topic}\nA quick, practical health tip you can try today.\nSave this for your next routine.`,
      thumbnailPrompt:
        'vertical YouTube Shorts thumbnail, close-up of a tired person turning energized, bright morning light, high contrast, realistic, no text',
      scenes: [
        {
          narration: `You might be doing this every morning, and it could be draining your energy.`,
          caption: 'Stop doing this',
          visualPrompt:
            'person waking up tired in bed, slow zoom in, soft morning light, concerned mood, realistic, no text',
          seconds: 9,
        },
        {
          narration: `Before coffee, your body may need a simpler signal first.`,
          caption: 'Start simpler',
          visualPrompt:
            'person drinking water in kitchen, close-up camera, bright natural lighting, fresh mood, realistic, no text',
          seconds: 9,
        },
        {
          narration: `A short walk or stretch can help your brain feel more awake.`,
          caption: 'Move first',
          visualPrompt:
            'person stretching near window, slow pan right, sunrise lighting, optimistic mood, realistic, no text',
          seconds: 9,
        },
        {
          narration: `Keep it easy enough that you can repeat it tomorrow.`,
          caption: 'Make it repeatable',
          visualPrompt:
            'person checking a simple morning routine list, overhead camera angle, clean bright lighting, calm mood, realistic, no text',
          seconds: 9,
        },
        {
          narration: `The second mistake is making the routine too big to repeat on a busy day.`,
          caption: 'Keep it small',
          visualPrompt:
            'person choosing one simple habit card, close-up camera, bright kitchen lighting, focused mood, realistic, no text',
          seconds: 9,
        },
        {
          narration: `Pair the habit with something you already do, like brushing your teeth or filling your bottle.`,
          caption: 'Stack the habit',
          visualPrompt:
            'person filling a water bottle beside bathroom sink, slow pan left, clean morning lighting, practical mood, realistic, no text',
          seconds: 9,
        },
        {
          narration: `If you miss a day, restart with the smallest version instead of quitting completely.`,
          caption: 'Restart small',
          visualPrompt:
            'person resetting a simple checklist, overhead camera angle, soft daylight, calm determined mood, realistic, no text',
          seconds: 9,
        },
        {
          narration: `Save this and try the first step tomorrow morning.`,
          caption: 'Try it tomorrow',
          visualPrompt:
            'person smiling with morning sunlight, slow push in, warm cinematic lighting, confident mood, realistic, no text',
          seconds: 9,
        },
      ],
    };
  }

  async generateScriptWithOffer(
  topic: string,
  offer: { name: string; url: string; bullets?: string[] },
): Promise<string> {
  const script = await this.generateScript(topic);
  const parsed = JSON.parse(script);

  parsed.cta = 'See the recommended resource in the description.';
  parsed.offerContext = {
    name: offer.name,
    bullets: offer.bullets ?? [],
  };

  return JSON.stringify(parsed);
}

async rewriteScriptForQuality(params: {
  topic: string;
  script: string;
  issues: string[];
  targetSeconds?: number;
}): Promise<string> {
  if (this.aiMode === 'mock') {
    const parsed = JSON.parse(params.script) as ScriptJson;
    parsed.hook = parsed.hook || `Most people miss this about ${params.topic}.`;
    parsed.cta = 'Save this and follow for more simple health tips.';
    parsed.scenes = parsed.scenes.length >= 5 ? parsed.scenes : [
      ...parsed.scenes,
      {
        narration: 'The first fix is simpler than most people think.',
        caption: 'Start here',
        visualPrompt:
          'person making a simple healthy choice in kitchen, slow push in, bright natural light, optimistic mood, realistic, no text',
        seconds: 9,
      },
      {
        narration: 'Do it consistently and your routine starts feeling easier.',
        caption: 'Consistency wins',
        visualPrompt:
          'person checking off a small daily habit, overhead camera angle, clean desk lighting, calm productive mood, realistic, no text',
        seconds: 9,
      },
    ];
    while (parsed.scenes.length < 8) {
      parsed.scenes.push({
        narration: 'Add one small repeatable step so the routine feels realistic on a busy day.',
        caption: 'Keep it realistic',
        visualPrompt:
          'person choosing one simple wellness habit, slow push in, bright natural light, practical calm mood, realistic, no text',
        seconds: 9,
      });
    }
    parsed.scenes = parsed.scenes.map((scene) => ({ ...scene, seconds: Math.max(8, Number(scene.seconds || 9)) }));
    return JSON.stringify(parsed);
  }

  const res = await this.openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0.55,
    messages: [
      {
        role: 'system',
        content: `
You rewrite short-form health/wellness scripts for retention.

Return ONLY valid JSON in this schema:
{
  "title": "",
  "hook": "",
  "cta": "",
  "hashtags": [],
  "youtubeDescription": "",
  "thumbnailPrompt": "",
  "scenes": [
    { "narration": "", "caption": "", "visualPrompt": "", "seconds": number }
  ]
}

Rules:
- Improve first 2 seconds for retention.
- Target 60-90 seconds total, with 75 seconds ideal.
- Use 8-12 scenes; prefer 9 or 10 scenes for a 60-90 second video.
- Each scene must have "seconds" between 6 and 12.
- The sum of all scene "seconds" must be between 60 and 90.
- Do not rewrite into a 25-40 second script.
- Make every scene concrete and visually distinct.
- Keep health claims cautious; no diagnosis, cure, guaranteed result, or fearmongering.
- CTA must be soft and not include raw URLs.
- Thumbnail prompt must be visual only, no text.
- Do not add explanations outside JSON.
        `,
      },
      {
        role: 'user',
        content: JSON.stringify({
          topic: params.topic,
          issues: params.issues,
          targetSeconds: params.targetSeconds ?? 75,
          script: JSON.parse(params.script),
        }),
      },
    ],
  });

  const text = res.choices[0].message.content || '';
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    this.logger.error('[AI] Script rewrite parse failed');
    throw new Error('INVALID_REWRITE_JSON');
  }
}

async generateTitleCandidates(params: {
  topic: string;
  script: string;
  count?: number;
}): Promise<string[]> {
  const count = params.count ?? 5;
  if (this.aiMode === 'mock') {
    return [
      `The ${params.topic} mistake most people miss`,
      `Why ${params.topic.toLowerCase()} feels harder than it should`,
      `Fix this before your next health routine`,
      `This simple habit can change your day`,
      `Stop ignoring this wellness signal`,
    ].slice(0, count);
  }

  const res = await this.openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0.8,
    messages: [
      {
        role: 'system',
        content: `
Return ONLY JSON: { "titles": [""] }
Write ${count} YouTube Shorts title candidates.
Rules:
- 35-70 characters when possible
- Curiosity-driven but not misleading
- Specific to the topic
- No hashtags, no emojis, no all-caps, no medical guarantees
        `,
      },
      {
        role: 'user',
        content: JSON.stringify({ topic: params.topic, script: JSON.parse(params.script) }),
      },
    ],
  });

  const text = res.choices[0].message.content || '';
  try {
    const parsed = JSON.parse(text) as { titles?: unknown };
    return Array.isArray(parsed.titles)
      ? parsed.titles.map((x) => String(x).trim()).filter(Boolean).slice(0, count)
      : [];
  } catch {
    this.logger.warn('[AI] Title candidate parse failed');
    return [];
  }
}

async generateYoutubeDescription(params: {
  topic: string;
  title: string;
  script: string;
  hashtags: string[];
  offerName?: string;
}): Promise<string> {
  const parsed = JSON.parse(params.script) as ScriptJson;
  if (this.aiMode === 'mock') {
    return [
      parsed.hook || params.title,
      'A quick, practical health tip for your daily routine.',
      params.offerName ? 'Recommended resource is linked in the description.' : 'Save this for later.',
      params.hashtags.join(' '),
    ].join('\n');
  }

  const res = await this.openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0.45,
    messages: [
      {
        role: 'system',
        content: `
Return ONLY JSON: { "description": "" }
Write a YouTube Shorts description for health/wellness content.
Rules:
- 2-4 short lines before hashtags
- Strong first line based on the hook
- Include cautious wording; no diagnosis/cure promises
- If an offer exists, mention "recommended resource" but do not include URLs
- End with provided hashtags
        `,
      },
      {
        role: 'user',
        content: JSON.stringify({
          topic: params.topic,
          title: params.title,
          script: parsed,
          hashtags: params.hashtags,
          offerName: params.offerName,
        }),
      },
    ],
  });

  const text = res.choices[0].message.content || '';
  try {
    const parsedResponse = JSON.parse(text) as { description?: string };
    return String(parsedResponse.description || '').trim();
  } catch {
    this.logger.warn('[AI] Description parse failed');
    return [
      parsed.hook || params.title,
      'A quick, practical health tip for your daily routine.',
      params.hashtags.join(' '),
    ].join('\n');
  }
}
}
