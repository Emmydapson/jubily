import { AiService } from './ai.service';

describe('AiService affiliate defaults', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, AI_MODE: 'mock' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('does not default mock affiliate scripts to health content', async () => {
    const service = new AiService();

    const script = await service.generateScript('Compare AI writing tools', {
      niche: 'AI_SOFTWARE',
      platform: 'PARTNERSTACK',
      productName: 'AI Writer Pro',
      targetAudience: 'solo founders',
      contentTone: 'practical',
      language: 'en',
    });

    expect(script.toLowerCase()).toContain('affiliate');
    expect(script).toContain('AI Writer Pro');
    expect(script.toLowerCase()).not.toContain('healthtips');
    expect(script.toLowerCase()).not.toContain('wellness');
  });

  it('renders Selar with the display label in mock AI context', async () => {
    const service = new AiService();

    const script = await service.generateScript('Promote a creator course', {
      niche: 'EDUCATION',
      platform: 'SELAR',
      productName: 'Creator Course',
    });

    expect(script).toContain('Selar offers');
    expect(script).not.toContain('SELAR offers');
  });
});
