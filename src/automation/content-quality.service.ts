/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import crypto from 'crypto';
import { AiService } from './ai/ai.service';

type Scene = {
  narration?: string;
  caption?: string;
  visualPrompt?: string;
  seconds?: number;
};

type ScriptJson = {
  title?: string;
  hook?: string;
  cta?: string;
  hashtags?: string[];
  youtubeDescription?: string;
  thumbnailPrompt?: string;
  scenes?: Scene[];
  [key: string]: unknown;
};

type TitleCandidate = {
  title: string;
  score: number;
  reasons: string[];
};

export type ScriptQualityResult = {
  content: string;
  reviewStatus: 'APPROVED' | 'NEEDS_REVIEW' | 'REJECTED';
  qualityScore: number;
  qualityReview: {
    score: number;
    issues: string[];
    strengths: string[];
    dimensions: Record<string, number>;
  };
  titleCandidates: TitleCandidate[];
  selectedTitle: string;
  youtubeDescription: string;
  hashtags: string[];
  thumbnailPrompt: string;
  rewriteAttempts: number;
  outputHash: string;
};

@Injectable()
export class ContentQualityService {
  private readonly minApprovedScore = 80;
  private readonly maxRewriteAttempts = 2;

  constructor(private readonly ai: AiService) {}

  async prepareScript(params: {
    topic: string;
    content: string;
    offerName?: string;
  }): Promise<ScriptQualityResult> {
    let content = this.normalizeContent(params.topic, params.content);
    let review = this.scoreScript(params.topic, content);
    let rewriteAttempts = 0;

    while (review.score < this.minApprovedScore && rewriteAttempts < this.maxRewriteAttempts) {
      try {
        content = await this.ai.rewriteScriptForQuality({
          topic: params.topic,
          script: content,
          issues: review.issues,
          targetSeconds: 35,
        });
        content = this.normalizeContent(params.topic, content);
        rewriteAttempts++;
        review = this.scoreScript(params.topic, content);
      } catch {
        break;
      }
    }

    const titleCandidates = await this.buildTitleCandidates(params.topic, content);
    const selectedTitle = titleCandidates[0]?.title || this.safeTitle(params.topic);
    const hashtags = this.topicHashtags(params.topic, content);
    const youtubeDescription = await this.buildDescription({
      topic: params.topic,
      title: selectedTitle,
      content,
      hashtags,
      offerName: params.offerName,
    });
    const thumbnailPrompt = this.thumbnailPrompt(params.topic, selectedTitle, content);

    const enriched = this.injectMetadata(content, {
      title: selectedTitle,
      hashtags,
      youtubeDescription,
      thumbnailPrompt,
    });

    const finalReview = this.scoreScript(params.topic, enriched);
    const reviewStatus =
      finalReview.score >= this.minApprovedScore
        ? 'APPROVED'
        : finalReview.score >= 65
          ? 'NEEDS_REVIEW'
          : 'REJECTED';

    return {
      content: enriched,
      reviewStatus,
      qualityScore: finalReview.score,
      qualityReview: finalReview,
      titleCandidates,
      selectedTitle,
      youtubeDescription,
      hashtags,
      thumbnailPrompt,
      rewriteAttempts,
      outputHash: crypto.createHash('sha256').update(enriched).digest('hex'),
    };
  }

  scoreScript(topic: string, content: string): ScriptQualityResult['qualityReview'] {
    const parsed = this.parse(content);
    const scenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
    const issues: string[] = [];
    const strengths: string[] = [];

    const hookScore = this.hookScore(parsed, scenes, issues, strengths);
    const structureScore = this.structureScore(scenes, issues, strengths);
    const pacingScore = this.pacingScore(scenes, issues, strengths);
    const ctaScore = this.ctaScore(parsed, issues, strengths);
    const visualScore = this.visualScore(scenes, issues, strengths);
    const safetyScore = this.safetyScore(content, issues, strengths);
    const titleScore = this.scoreTitle(String(parsed.title || topic), topic).score;

    const dimensions = {
      hook: hookScore,
      structure: structureScore,
      pacing: pacingScore,
      cta: ctaScore,
      visuals: visualScore,
      safety: safetyScore,
      title: titleScore,
    };

    const score = Math.round(
      hookScore * 0.2 +
      structureScore * 0.14 +
      pacingScore * 0.16 +
      ctaScore * 0.12 +
      visualScore * 0.16 +
      safetyScore * 0.12 +
      titleScore * 0.1,
    );

    return { score, issues: [...new Set(issues)], strengths: [...new Set(strengths)], dimensions };
  }

  scoreTitle(title: string, topic: string): TitleCandidate {
    const t = this.clean(title);
    const lower = t.toLowerCase();
    const topicWords = this.keywordWords(topic);
    const reasons: string[] = [];
    let score = 40;

    if (t.length >= 35 && t.length <= 70) {
      score += 18;
      reasons.push('strong shorts title length');
    } else if (t.length >= 25 && t.length <= 85) {
      score += 10;
      reasons.push('acceptable title length');
    } else {
      reasons.push('title length is weak');
    }

    if (/(why|mistake|simple|before|hidden|stop|common|most people|this|signals?|habits?)/i.test(t)) {
      score += 18;
      reasons.push('curiosity trigger present');
    }

    if (topicWords.some((word) => lower.includes(word))) {
      score += 14;
      reasons.push('topic keyword present');
    }

    if (/(you|your|people|routine|day|morning|energy|sleep|focus|health)/i.test(t)) {
      score += 8;
      reasons.push('viewer benefit or relevance present');
    }

    if (/[!?]{2,}|#|http|guaranteed|cure|miracle|shocking truth/i.test(t)) {
      score -= 20;
      reasons.push('spam or claim-risk language');
    }

    return { title: t, score: Math.max(0, Math.min(100, score)), reasons };
  }

  private async buildTitleCandidates(topic: string, content: string) {
    const parsed = this.parse(content);
    const generated = await this.ai.generateTitleCandidates({ topic, script: content, count: 5 });
    const candidates = [
      ...generated,
      String(parsed.title || ''),
      `The ${topic} mistake most people miss`,
      `Fix this before your next health routine`,
    ].filter(Boolean);

    const unique = Array.from(new Set(candidates.map((title) => this.clean(title)).filter(Boolean)));
    return unique
      .map((title) => this.scoreTitle(title, topic))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  private async buildDescription(params: {
    topic: string;
    title: string;
    content: string;
    hashtags: string[];
    offerName?: string;
  }) {
    try {
      const generated = await this.ai.generateYoutubeDescription({
        topic: params.topic,
        title: params.title,
        script: params.content,
        hashtags: params.hashtags,
        offerName: params.offerName,
      });
      if (generated && !/https?:\/\//i.test(generated)) return generated.slice(0, 1200);
    } catch {
      // deterministic fallback below
    }

    const parsed = this.parse(params.content);
    return [
      this.clean(String(parsed.hook || params.title)),
      'A quick, practical wellness tip for your daily routine.',
      params.offerName ? 'Recommended resource is linked in the description.' : 'Save this for later.',
      params.hashtags.join(' '),
    ].join('\n').slice(0, 1200);
  }

  private normalizeContent(topic: string, content: string) {
    const parsed = this.parse(content);
    const scenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
    const normalized: ScriptJson = {
      ...parsed,
      title: this.clean(String(parsed.title || topic)),
      hook: this.clean(String(parsed.hook || scenes[0]?.narration || topic)),
      cta: this.clean(String(parsed.cta || 'Save this and follow for more simple health tips.')),
      scenes: scenes.map((scene) => ({
        narration: this.clean(String(scene.narration || '')),
        caption: this.clean(String(scene.caption || '')),
        visualPrompt: this.ensureVisualPrompt(String(scene.visualPrompt || scene.narration || topic)),
        seconds: Number(scene.seconds || 5),
      })),
    };

    return JSON.stringify(normalized);
  }

  private injectMetadata(content: string, metadata: {
    title: string;
    hashtags: string[];
    youtubeDescription: string;
    thumbnailPrompt: string;
  }) {
    const parsed = this.parse(content);
    return JSON.stringify({
      ...parsed,
      title: metadata.title,
      hashtags: metadata.hashtags,
      youtubeDescription: metadata.youtubeDescription,
      thumbnailPrompt: metadata.thumbnailPrompt,
    });
  }

  private hookScore(parsed: ScriptJson, scenes: Scene[], issues: string[], strengths: string[]) {
    const hook = this.clean(String(parsed.hook || scenes[0]?.narration || scenes[0]?.caption || ''));
    let score = 20;
    if (!hook) {
      issues.push('missing hook');
      return 0;
    }
    const words = this.wordCount(hook);
    if (words <= 18) score += 25;
    else issues.push('hook is too long for the first two seconds');
    if (/(you|your|most people|stop|before|why|mistake|hidden|common|this)/i.test(hook)) score += 35;
    else issues.push('hook lacks a clear curiosity trigger');
    if (!/^(\w+\s+){0,2}(this|you|your|stop|why|before|most)/i.test(hook)) score += 10;
    if (score >= 75) strengths.push('strong opening hook');
    return Math.min(100, score);
  }

  private structureScore(scenes: Scene[], issues: string[], strengths: string[]) {
    let score = 35;
    if (scenes.length >= 5 && scenes.length <= 7) {
      score += 45;
      strengths.push('scene count fits Shorts retention');
    } else {
      issues.push('script should use 5-7 scenes');
    }
    if (scenes.every((scene) => scene.narration && scene.caption)) score += 20;
    else issues.push('every scene needs narration and caption');
    return Math.min(100, score);
  }

  private pacingScore(scenes: Scene[], issues: string[], strengths: string[]) {
    if (!scenes.length) return 0;
    const durations = scenes.map((scene) => Number(scene.seconds || this.estimatedSeconds(scene.narration || '')));
    const total = durations.reduce((sum, n) => sum + n, 0);
    let score = 30;
    if (total >= 25 && total <= 40) {
      score += 35;
      strengths.push('total length is retention-friendly');
    } else {
      issues.push('target total length should be 25-40 seconds');
    }
    const goodSceneLengths = durations.filter((seconds) => seconds >= 3 && seconds <= 7).length;
    score += Math.round((goodSceneLengths / scenes.length) * 35);
    if (goodSceneLengths !== scenes.length) issues.push('some scenes are too short or too long');
    return Math.min(100, score);
  }

  private ctaScore(parsed: ScriptJson, issues: string[], strengths: string[]) {
    const cta = this.clean(String(parsed.cta || ''));
    if (!cta) {
      issues.push('missing CTA');
      return 0;
    }
    let score = 35;
    if (!/https?:\/\/|www\./i.test(cta)) score += 25;
    else issues.push('CTA should not contain raw URLs');
    if (/(save|follow|comment|try|description|resource)/i.test(cta)) score += 30;
    else issues.push('CTA should ask for a low-friction action');
    if (this.wordCount(cta) <= 14) score += 10;
    else issues.push('CTA is too long');
    if (score >= 80) strengths.push('CTA is soft and platform-friendly');
    return Math.min(100, score);
  }

  private visualScore(scenes: Scene[], issues: string[], strengths: string[]) {
    if (!scenes.length) return 0;
    let total = 0;
    for (const scene of scenes) {
      const prompt = String(scene.visualPrompt || '');
      let score = 20;
      if (this.wordCount(prompt) >= 10) score += 20;
      if (/(zoom|pan|push|close-up|slow|camera|overhead|tracking)/i.test(prompt)) score += 20;
      if (/(light|lighting|sunlight|bright|cinematic|natural)/i.test(prompt)) score += 20;
      if (/(realistic|documentary|lifestyle)/i.test(prompt)) score += 10;
      if (/no text/i.test(prompt)) score += 10;
      total += Math.min(100, score);
    }
    const avg = Math.round(total / scenes.length);
    if (avg < 75) issues.push('visual prompts need more camera, lighting, realism, and no-text detail');
    else strengths.push('visual prompts are production-ready');
    return avg;
  }

  private safetyScore(content: string, issues: string[], strengths: string[]) {
    if (/(cure|guarantee|diagnose|doctor-approved|lose \d+ pounds|melts fat|reverses disease|miracle)/i.test(content)) {
      issues.push('contains risky health claim language');
      return 45;
    }
    strengths.push('no obvious high-risk health claims');
    return 100;
  }

  private topicHashtags(topic: string, content: string) {
    const lower = `${topic} ${content}`.toLowerCase();
    const tags = new Set(['#shorts']);
    const nicheMap: Array<[RegExp, string[]]> = [
      [/sleep|tired|night|rest/, ['#sleeptips', '#bettersleep']],
      [/energy|morning|fatigue/, ['#energytips', '#morningroutine']],
      [/stress|anxiety|calm/, ['#stressrelief', '#calmmind']],
      [/fitness|workout|exercise|walk/, ['#fitnesstips', '#dailymovement']],
      [/gut|digestion|bloat/, ['#guthealth', '#digestiontips']],
      [/focus|brain|memory/, ['#focustips', '#brainhealth']],
      [/hydration|water/, ['#hydration', '#healthhabits']],
      [/diet|nutrition|food|sugar/, ['#nutritiontips', '#healthyfood']],
    ];

    for (const [pattern, mapped] of nicheMap) {
      if (pattern.test(lower)) mapped.forEach((tag) => tags.add(tag));
    }

    this.keywordWords(topic).slice(0, 3).forEach((word) => tags.add(`#${word.replace(/[^a-z0-9]/g, '')}`));
    tags.add('#healthtips');
    tags.add('#wellness');
    return Array.from(tags).filter((tag) => tag.length > 1).slice(0, 8);
  }

  private thumbnailPrompt(topic: string, title: string, content: string) {
    const parsed = this.parse(content);
    const hook = this.clean(String(parsed.hook || parsed.scenes?.[0]?.caption || title));
    return [
      'vertical YouTube Shorts thumbnail',
      `topic: ${topic}`,
      `emotion: curiosity and urgency from "${hook}"`,
      'single realistic person or clear object',
      'close-up composition',
      'bright high-contrast lighting',
      'clean background',
      'no text, no logo, no watermark',
    ].join(', ');
  }

  private ensureVisualPrompt(prompt: string) {
    const base = this.clean(prompt) || 'person making a healthy daily choice';
    const additions = [
      /zoom|pan|push|camera|close-up|overhead/i.test(base) ? '' : 'slow push in camera movement',
      /light|lighting|sunlight|bright|cinematic|natural/i.test(base) ? '' : 'bright natural lighting',
      /realistic|documentary|lifestyle/i.test(base) ? '' : 'realistic lifestyle mood',
      /no text/i.test(base) ? '' : 'no text',
    ].filter(Boolean);
    return [base, ...additions].join(', ');
  }

  private parse(content: string): ScriptJson {
    try {
      return JSON.parse(content) as ScriptJson;
    } catch {
      const lines = String(content || '').split('\n').map((line) => line.trim()).filter(Boolean);
      return {
        title: lines[0] || 'Untitled',
        hook: lines[0] || '',
        cta: 'Save this and follow for more simple health tips.',
        scenes: lines.map((line) => ({
          narration: line,
          caption: line.split(/\s+/).slice(0, 6).join(' '),
          visualPrompt: this.ensureVisualPrompt(line),
          seconds: this.estimatedSeconds(line),
        })),
      };
    }
  }

  private estimatedSeconds(text: string) {
    return Math.max(3, Math.min(7, this.wordCount(text) / 2.4));
  }

  private safeTitle(topic: string) {
    return this.clean(topic).slice(0, 70) || 'Simple health habit to try today';
  }

  private keywordWords(text: string) {
    const stop = new Set(['this', 'that', 'with', 'from', 'your', 'about', 'before', 'after', 'simple', 'quick']);
    return this.clean(text)
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length >= 4 && !stop.has(word));
  }

  private clean(text: string) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  private wordCount(text: string) {
    return this.clean(text).split(/\s+/).filter(Boolean).length;
  }
}
