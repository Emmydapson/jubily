import { topicToNicheCandidates } from './orchestrator.service';

describe('topicToNicheCandidates', () => {
  it.each([
    ['sleep better through insomnia habits', ['sleep']],
    ['weight loss diet fat burn routine', ['weight-loss']],
    ['morning energy and fatigue reset', ['energy']],
    ['stress anxiety calm breathing', ['stress']],
    ['gut digestion bloat support', ['gut-health']],
    ['brain focus concentration tips', ['focus', 'memory']],
    ['fitness workout strength body tone', ['fitness']],
    ['hormonal menopause cycle balance', ['hormones']],
    ['memory recall concentration training', ['focus', 'memory']],
    ['male prostate testosterone urinary health', ['mens-health']],
    ['teeth gum oral breath support', ['dental-health']],
    ['joint knee pain mobility cartilage', ['joint-health']],
    ['hearing tinnitus ear sound support', ['hearing-health']],
  ])('maps "%s" to expected niches', (title, expected) => {
    expect(topicToNicheCandidates(title)).toEqual(expect.arrayContaining(expected));
  });

  it('returns unique niche matches', () => {
    expect(topicToNicheCandidates('memory memory recall')).toEqual(['focus', 'memory']);
  });
});

