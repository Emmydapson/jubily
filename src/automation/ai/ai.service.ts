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

export type AffiliateGenerationContext = {
  niche?: string | null;
  platform?: string | null;
  productName?: string | null;
  affiliateLink?: string | null;
  targetAudience?: string | null;
  contentTone?: string | null;
  language?: string | null;
  contentGoal?: string | null;
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly aiMode = (process.env.AI_MODE || 'live').toLowerCase();

  private openai?: OpenAI;

  private getOpenAi() {
    this.openai ??= new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    return this.openai;
  }

  private contextLines(context?: AffiliateGenerationContext) {
    return [
      `Affiliate niche: ${context?.niche || 'general affiliate marketing'}`,
      `Affiliate platform: ${context?.platform || 'not specified'}`,
      `Affiliate product/link: ${context?.productName || context?.affiliateLink || 'not specified'}`,
      `Target audience: ${context?.targetAudience || 'affiliate buyers interested in the topic'}`,
      `Content tone: ${context?.contentTone || 'clear, practical, trustworthy'}`,
      `Language: ${context?.language || 'English'}`,
      `Content goal: ${context?.contentGoal || 'promote an affiliate product with useful YouTube automation content'}`,
    ].join('\n');
  }

  private isHealthContext(context?: AffiliateGenerationContext) {
    return String(context?.niche || '').toUpperCase() === 'HEALTH_WELLNESS';
  }

  async generateTopics(count = 10, context?: AffiliateGenerationContext): Promise<string[]> {
    if (this.aiMode === 'mock') {
      return [
        'Best affiliate tools beginners overlook',
        'How to compare products before buying',
        'Mistakes that waste affiliate traffic',
      ];
    }

    const res = await this.getOpenAi().chat.completions.create({
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
- Affiliate-focused YouTube automation content
- Use this profile context:
${this.contextLines(context)}
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

  async generateScript(topic: string, context?: AffiliateGenerationContext): Promise<string> {
    if (this.aiMode === 'mock') {
      return JSON.stringify(this.buildMockScript(topic, context));
    }

    const res = await this.getOpenAi().chat.completions.create({
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
- Jubily content is affiliate-focused YouTube automation, not a general creator script.
- Build around this affiliate profile:
${this.contextLines(context)}
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
- Do not default to health, supplements, medical products, or wellness unless the profile niche is HEALTH_WELLNESS.
- If the profile niche is HEALTH_WELLNESS, keep claims cautious: no diagnosis, cures, guaranteed results, or fearmongering.
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

  private buildMockScript(topic: string, context?: AffiliateGenerationContext): ScriptJson {
    const product = context?.productName || 'the recommended product';
    const platform = context?.platform || 'affiliate platform';
    const niche = context?.niche || 'affiliate marketing';
    return {
      title: topic,
      hook: `Most buyers miss this before choosing ${product}.`,
      cta: 'Check the recommended resource in the description.',
      hashtags: ['#shorts', '#affiliatemarketing', '#productreview', `#${String(niche).toLowerCase().replace(/[^a-z0-9]/g, '')}`],
      youtubeDescription: `${topic}\nA practical affiliate product breakdown for ${platform} offers.\nCheck the recommended resource in the description.`,
      thumbnailPrompt:
        'vertical YouTube Shorts thumbnail, close-up of a person comparing a product on a laptop, bright high contrast lighting, realistic, no text',
      scenes: [
        {
          narration: `Before you buy ${product}, compare the promise with the real problem it solves.`,
          caption: 'Check this first',
          visualPrompt:
            'person comparing product pages on a laptop, slow zoom in camera movement, bright desk lighting, focused mood, realistic, no text',
          seconds: 9,
        },
        {
          narration: `Look for who the offer is actually built for, not just the headline.`,
          caption: 'Match the buyer',
          visualPrompt:
            'person highlighting audience notes beside product page, close-up camera, bright natural lighting, practical mood, realistic, no text',
          seconds: 9,
        },
        {
          narration: `Then compare features, proof, price, and refund terms before clicking.`,
          caption: 'Compare the details',
          visualPrompt:
            'person reviewing checklist beside ecommerce page, slow pan right, clean lighting, confident mood, realistic, no text',
          seconds: 9,
        },
        {
          narration: `If it fits your goal, the link in the description is the next step.`,
          caption: 'Next step below',
          visualPrompt:
            'person pointing to description area on phone, overhead camera angle, clean bright lighting, helpful mood, realistic, no text',
          seconds: 9,
        },
        {
          narration: `Avoid buying just because a product is trending.`,
          caption: 'Avoid hype',
          visualPrompt:
            'person closing distracting tabs and focusing on one product page, close-up camera, bright office lighting, focused mood, realistic, no text',
          seconds: 9,
        },
        {
          narration: `A good affiliate recommendation should help you decide faster, not pressure you.`,
          caption: 'No pressure',
          visualPrompt:
            'person reading product pros and cons on tablet, slow pan left, clean daylight, trustworthy mood, realistic, no text',
          seconds: 9,
        },
        {
          narration: `Save this checklist before you compare your next offer.`,
          caption: 'Save the checklist',
          visualPrompt:
            'person saving product comparison checklist, overhead camera angle, soft daylight, organized mood, realistic, no text',
          seconds: 9,
        },
        {
          narration: `And check the description if you want the recommended resource.`,
          caption: 'Link in description',
          visualPrompt:
            'person confidently reviewing recommended product link on phone, slow push in, warm cinematic lighting, confident mood, realistic, no text',
          seconds: 9,
        },
      ],
    };
  }

  async generateScriptWithOffer(
  topic: string,
  offer: { name: string; url: string; bullets?: string[]; niche?: string | null; platform?: string | null; targetAudience?: string | null; contentTone?: string | null; language?: string | null; contentGoal?: string | null },
): Promise<string> {
  const script = await this.generateScript(topic, {
    productName: offer.name,
    affiliateLink: offer.url,
    niche: offer.niche,
    platform: offer.platform,
    targetAudience: offer.targetAudience,
    contentTone: offer.contentTone,
    language: offer.language,
    contentGoal: offer.contentGoal,
  });
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
    parsed.cta = 'Check the recommended resource in the description.';
    parsed.scenes = parsed.scenes.length >= 5 ? parsed.scenes : [
      ...parsed.scenes,
      {
        narration: 'The first fix is simpler than most people think.',
        caption: 'Start here',
        visualPrompt:
          'person comparing a product page and notes on laptop, slow push in, bright natural light, optimistic mood, realistic, no text',
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
          'person choosing between affiliate product options, slow push in, bright natural light, practical calm mood, realistic, no text',
        seconds: 9,
      });
    }
    parsed.scenes = parsed.scenes.map((scene) => ({ ...scene, seconds: Math.max(8, Number(scene.seconds || 9)) }));
    return JSON.stringify(parsed);
  }

  const res = await this.getOpenAi().chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0.55,
    messages: [
      {
        role: 'system',
        content: `
You rewrite short-form affiliate marketing YouTube Shorts scripts for retention.

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
- Do not default to health, supplements, medical products, or wellness. If the script is health-related, keep claims cautious; no diagnosis, cure, guaranteed result, or fearmongering.
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
      `Fix this before your next product pick`,
      `This simple habit can change your day`,
      `Stop ignoring this buying signal`,
    ].slice(0, count);
  }

  const res = await this.getOpenAi().chat.completions.create({
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
- No hashtags, no emojis, no all-caps, no false guarantees
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
      'A practical affiliate product note for your next decision.',
      params.offerName ? 'Recommended resource is linked in the description.' : 'Save this for later.',
      params.hashtags.join(' '),
    ].join('\n');
  }

  const res = await this.getOpenAi().chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0.45,
    messages: [
      {
        role: 'system',
        content: `
Return ONLY JSON: { "description": "" }
Write a YouTube Shorts description for affiliate-focused product promotion.
Rules:
- 2-4 short lines before hashtags
- Strong first line based on the hook
- Do not include raw URLs; the backend appends affiliate links later
- Do not default to health, supplements, medical products, or wellness
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
      'A practical affiliate product note for your next decision.',
      params.hashtags.join(' '),
    ].join('\n');
  }
}
}
