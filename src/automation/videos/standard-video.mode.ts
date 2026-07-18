import { Scene } from './interfaces/scene.interface';

export type StandardRenderScene = Scene & {
  sourceSceneIndex: number;
  shotType: string;
  suppliedMediaUrl?: string | null;
  isCtaOutro?: boolean;
};

export type TimelineValidationIssue = {
  code:
    | 'NEGATIVE_START'
    | 'INVALID_DURATION'
    | 'GAP_OR_OVERLAP'
    | 'INSUFFICIENT_COVERAGE'
    | 'INVALID_ASSET_URL'
    | 'DUPLICATE_FULL_TIMELINE_IMAGE'
    | 'CTA_OUTRO_MISSING';
  message: string;
};

export const STANDARD_VIDEO_DEFAULTS = {
  minSceneSeconds: Number(process.env.VIDEO_STANDARD_MIN_SCENE_SECONDS || 2.5),
  maxSceneSeconds: Number(process.env.VIDEO_STANDARD_MAX_SCENE_SECONDS || 5),
  captionMaxLines: Number(process.env.VIDEO_CAPTION_MAX_LINES || 2),
  enableImageMotion: process.env.VIDEO_ENABLE_IMAGE_MOTION !== 'false',
  enableTransitions: process.env.VIDEO_ENABLE_TRANSITIONS !== 'false',
  enableCtaOutro: process.env.VIDEO_ENABLE_CTA_OUTRO !== 'false',
};

const SHOT_TYPES = [
  'close-up',
  'product screen',
  'over-the-shoulder',
  'before-and-after',
  'environment shot',
  'result/proof shot',
  'text-focused card',
  'medium shot',
  'wide shot',
  'cta screen',
];

const MOTION_EFFECTS = [
  'zoomInSlow',
  'zoomOutSlow',
  'slideLeftSlow',
  'slideRightSlow',
  'slideUpSlow',
  'slideDownSlow',
  'zoomIn',
  'zoomOut',
];

const TRANSITION_INS = [
  'fade',
  'slideLeft',
  'slideRight',
  'slideUp',
  'wipeLeft',
];

function clean(text: string) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(text: string) {
  return clean(text).split(/\s+/).filter(Boolean).length;
}

function estimateSeconds(text: string) {
  return Math.max(2.5, wordCount(text) / 2.55);
}

function splitIntoPhrases(text: string, maxWords = 9) {
  const normalized = clean(text);
  if (!normalized) return [];

  const sentenceParts = normalized
    .split(/(?<=[.!?])\s+|;\s+|,\s+(?=(and|but|so|then|while|because)\b)/i)
    .map(clean)
    .filter(Boolean);

  const phrases: string[] = [];
  for (const part of sentenceParts.length ? sentenceParts : [normalized]) {
    const words = part.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i += maxWords) {
      phrases.push(words.slice(i, i + maxWords).join(' '));
    }
  }

  return phrases.filter(Boolean);
}

function evenlySplitWords(text: string, count: number) {
  const words = clean(text).split(/\s+/).filter(Boolean);
  if (count <= 1 || words.length <= 1) return [clean(text)].filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * words.length) / count);
    const end = Math.floor(((i + 1) * words.length) / count);
    chunks.push(words.slice(start, end).join(' '));
  }
  return chunks.filter(Boolean);
}

function safeDuration(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function pickShotType(index: number, prompt: string, isLast: boolean) {
  if (isLast) return 'cta screen';
  const lower = prompt.toLowerCase();
  if (/screen|dashboard|app|software|website|checkout|product page/.test(lower))
    return 'product screen';
  if (/before|after|compare|comparison/.test(lower)) return 'before-and-after';
  if (/proof|result|testimonial|review|receipt/.test(lower))
    return 'result/proof shot';
  return SHOT_TYPES[index % (SHOT_TYPES.length - 1)];
}

function varyShotType(
  index: number,
  previous: string | null,
  prompt: string,
  isLast: boolean,
) {
  let selected = pickShotType(index, prompt, isLast);
  if (previous && selected === previous) {
    selected =
      SHOT_TYPES[
        (SHOT_TYPES.indexOf(selected) + 1 + index) % (SHOT_TYPES.length - 1)
      ];
  }
  return selected;
}

export function resolvePlatformCta(
  platform: string | null | undefined,
  format?: string | null,
) {
  const normalized = String(platform || 'YOUTUBE').toUpperCase();
  const isShort =
    normalized === 'YOUTUBE_SHORTS' ||
    String(format || '')
      .toUpperCase()
      .includes('SHORT');

  if (normalized === 'TIKTOK' || normalized === 'INSTAGRAM') {
    return { type: 'LINK_IN_BIO', text: 'Link in bio' };
  }
  if (normalized === 'FACEBOOK') {
    return {
      type: 'LINK_IN_PROFILE',
      text: 'Learn more through the link provided',
    };
  }
  if (
    normalized === 'YOUTUBE_SHORTS' ||
    (normalized === 'YOUTUBE' && isShort)
  ) {
    return {
      type: 'YOUTUBE_SHORTS_PROFILE',
      text: 'Find the full link in the channel links',
    };
  }
  return { type: 'DESCRIPTION_LINK', text: 'Link in the description' };
}

export function detectContradictoryBrief(input: {
  topic?: string | null;
  offerName?: string | null;
  niche?: string | null;
  targetAudience?: string | null;
  contentGoal?: string | null;
}) {
  const text = [
    input.topic,
    input.offerName,
    input.niche,
    input.targetAudience,
    input.contentGoal,
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');

  const categories: Record<string, RegExp> = {
    fitness: /fitness|workout|gym|weight loss|protein|exercise/,
    aiSoftware: /ai|automation|software|saas|dashboard|content tool|chatbot/,
    travel: /vacation|hotel|flight|beach|travel|tour/,
    finance: /crypto|loan|invest|stock|trading|forex/,
    wellness: /sleep|stress|supplement|wellness|gut|nutrition/,
  };

  const hits = Object.entries(categories)
    .filter(([, pattern]) => pattern.test(text))
    .map(([category]) => category);

  const unrelatedPairs = [
    ['fitness', 'aiSoftware'],
    ['travel', 'aiSoftware'],
    ['travel', 'fitness'],
    ['finance', 'wellness'],
  ];

  const conflicts = unrelatedPairs.filter(
    ([a, b]) => hits.includes(a) && hits.includes(b),
  );
  return {
    hasContradiction: conflicts.length > 0,
    categories: hits,
    conflicts,
    message: conflicts.length
      ? `Brief mixes unrelated categories: ${conflicts.map((pair) => pair.join(' + ')).join(', ')}`
      : null,
  };
}

export function buildStandardRenderScenes(
  scenes: Scene[],
  options: {
    offerName?: string | null;
    platform?: string | null;
    format?: string | null;
    productMediaUrls?: string[];
  } = {},
) {
  const min = STANDARD_VIDEO_DEFAULTS.minSceneSeconds;
  const max = STANDARD_VIDEO_DEFAULTS.maxSceneSeconds;
  const productMedia = (options.productMediaUrls || []).filter((url) =>
    /^https?:\/\//i.test(url),
  );
  const cta = resolvePlatformCta(options.platform, options.format);
  const planned: StandardRenderScene[] = [];
  let previousShotType: string | null = null;

  scenes.forEach((scene, sceneIndex) => {
    const narration = clean(scene.narration);
    if (!narration) return;
    const requested = safeDuration(scene.duration, estimateSeconds(narration));
    const beatCount = Math.max(1, Math.ceil(requested / max));
    const phraseCandidates = splitIntoPhrases(narration, 9);
    const narrationBeats =
      phraseCandidates.length >= beatCount
        ? phraseCandidates
        : evenlySplitWords(narration, beatCount);
    const totalWords = Math.max(1, wordCount(narration));

    narrationBeats.forEach((beatNarration, beatIndex) => {
      const weight = Math.max(1, wordCount(beatNarration)) / totalWords;
      const weightedDuration = requested * weight;
      const duration = Number(
        Math.max(min, Math.min(max, weightedDuration)).toFixed(2),
      );
      const isOriginalFinal = sceneIndex === scenes.length - 1;
      const isLastBeat =
        isOriginalFinal && beatIndex === narrationBeats.length - 1;
      const shotType = varyShotType(
        planned.length,
        previousShotType,
        scene.visualPrompt || beatNarration,
        isLastBeat,
      );
      previousShotType = shotType;

      const promptParts = [
        clean(scene.visualPrompt || beatNarration),
        `visual beat: ${beatNarration}`,
        options.offerName ? `product or offer: ${options.offerName}` : '',
        `shot type: ${shotType}`,
        'vertical 9:16 short-form composition',
        'keep faces and product UI inside center safe zone',
        'consistent realistic lighting and brand-safe palette',
        'no readable text, no random dashboards, no unrelated people, no food unless relevant',
      ].filter(Boolean);

      planned.push({
        ...scene,
        index: planned.length + 1,
        sourceSceneIndex: scene.index || sceneIndex + 1,
        narration: beatNarration,
        caption: clean(scene.caption || beatNarration),
        duration,
        visualPrompt: promptParts.join(', '),
        shotType,
        suppliedMediaUrl:
          productMedia[planned.length % productMedia.length] || null,
        isCtaOutro: isLastBeat,
      });
    });
  });

  if (
    STANDARD_VIDEO_DEFAULTS.enableCtaOutro &&
    planned.length > 0 &&
    !planned[planned.length - 1].isCtaOutro
  ) {
    const finalScene = planned[planned.length - 1];
    planned.push({
      ...finalScene,
      index: planned.length + 1,
      sourceSceneIndex: finalScene.sourceSceneIndex,
      narration: `${cta.text}.`,
      caption: cta.text,
      duration: Math.max(3, min),
      visualPrompt: [
        `clean CTA outro card for ${options.offerName || 'recommended product'}`,
        cta.text,
        'vertical 9:16, centered product proof area, subtle brand color accents, no long URL, no clutter',
      ].join(', '),
      shotType: 'cta screen',
      suppliedMediaUrl: productMedia[0] || null,
      isCtaOutro: true,
    });
  } else if (planned.length > 0) {
    const final = planned[planned.length - 1];
    final.isCtaOutro = true;
    final.caption = cta.text;
    final.visualPrompt = `${final.visualPrompt}, final CTA outro card, ${cta.text}, no long URL`;
  }

  return {
    mode: 'STANDARD',
    scenes: planned.map((scene, index) => ({ ...scene, index: index + 1 })),
    cta,
    diagnostics: {
      sceneCount: planned.length,
      averageSceneDuration:
        planned.length > 0
          ? Number(
              (
                planned.reduce((sum, scene) => sum + scene.duration, 0) /
                planned.length
              ).toFixed(2),
            )
          : 0,
      suppliedMediaCount: planned.filter((scene) => scene.suppliedMediaUrl)
        .length,
      aiImageCount: planned.filter((scene) => !scene.suppliedMediaUrl).length,
      shotTypes: planned.map((scene) => scene.shotType),
    },
  };
}

export function motionEffectForScene(index: number) {
  if (!STANDARD_VIDEO_DEFAULTS.enableImageMotion) return undefined;
  return MOTION_EFFECTS[index % MOTION_EFFECTS.length];
}

export function transitionForScene(
  index: number,
  sceneCount: number,
  tone?: string | null,
) {
  if (
    !STANDARD_VIDEO_DEFAULTS.enableTransitions ||
    index === 0 ||
    index >= sceneCount
  )
    return undefined;
  const normalizedTone = String(tone || '').toLowerCase();
  if (/calm|trust|professional/.test(normalizedTone)) {
    return { in: index % 3 === 0 ? 'fade' : 'slideLeft' };
  }
  if (index % 4 === 0) return { in: 'fade' };
  if (index % 2 === 0)
    return { in: TRANSITION_INS[index % TRANSITION_INS.length] };
  return undefined;
}

export function buildModernCaptionChunks(
  text: string,
  start: number,
  duration: number,
) {
  const maxLines = Math.max(1, STANDARD_VIDEO_DEFAULTS.captionMaxLines);
  const phrases = splitIntoPhrases(text, 8);
  const chunks = phrases.length ? phrases : [clean(text)].filter(Boolean);
  const perChunk = duration / Math.max(chunks.length, 1);

  return chunks.map((chunk, index) => {
    const words = chunk.split(/\s+/).filter(Boolean);
    const midpoint = Math.ceil(words.length / maxLines);
    const lines =
      maxLines <= 1 || words.length <= 5
        ? [chunk]
        : [
            words.slice(0, midpoint).join(' '),
            words.slice(midpoint).join(' '),
          ].filter(Boolean);

    return {
      text: lines.slice(0, maxLines).join('<br/>'),
      start: Number((start + index * perChunk).toFixed(3)),
      length: Number(Math.max(0.8, perChunk).toFixed(3)),
      keyword: words.find((word) => word.length >= 5) || words[0] || '',
      lines: lines.slice(0, maxLines),
    };
  });
}

export function validateStandardTimeline(input: {
  imageClips: Array<{
    start: number;
    length: number;
    asset?: { src?: string; type?: string };
  }>;
  subtitleClips: Array<{ start: number; length: number }>;
  renderEnd: number;
  hasCtaOutro: boolean;
}) {
  const issues: TimelineValidationIssue[] = [];
  const sorted = [...input.imageClips].sort((a, b) => a.start - b.start);

  sorted.forEach((clip, index) => {
    if (clip.start < 0)
      issues.push({
        code: 'NEGATIVE_START',
        message: `Image clip ${index} starts before zero`,
      });
    if (!(clip.length > 0))
      issues.push({
        code: 'INVALID_DURATION',
        message: `Image clip ${index} has invalid duration`,
      });
    if (!clip.asset?.src || !/^https?:\/\//i.test(clip.asset.src)) {
      issues.push({
        code: 'INVALID_ASSET_URL',
        message: `Image clip ${index} has invalid asset URL`,
      });
    }
    const next = sorted[index + 1];
    if (next) {
      const end = clip.start + clip.length;
      if (Math.abs(next.start - end) > 0.06) {
        issues.push({
          code: 'GAP_OR_OVERLAP',
          message: `Image clip ${index} does not meet next clip`,
        });
      }
    }
  });

  const visualEnd = sorted.reduce(
    (max, clip) => Math.max(max, clip.start + clip.length),
    0,
  );
  if (visualEnd + 0.06 < input.renderEnd) {
    issues.push({
      code: 'INSUFFICIENT_COVERAGE',
      message: 'Visual timeline does not cover narration',
    });
  }

  const fullTimeline = sorted.filter(
    (clip) => clip.start <= 0.001 && clip.length >= input.renderEnd - 0.001,
  );
  if (sorted.length > 1 && fullTimeline.length > 0) {
    issues.push({
      code: 'DUPLICATE_FULL_TIMELINE_IMAGE',
      message: 'A multi-scene render contains a full-timeline image clip',
    });
  }

  for (const clip of input.subtitleClips) {
    if (clip.start < 0 || clip.start + clip.length > input.renderEnd + 0.1) {
      issues.push({
        code: 'INVALID_DURATION',
        message: 'Caption clip sits outside the render timeline',
      });
    }
  }

  if (!input.hasCtaOutro) {
    issues.push({
      code: 'CTA_OUTRO_MISSING',
      message: 'Standard mode requires a CTA outro',
    });
  }

  return { valid: issues.length === 0, issues };
}
