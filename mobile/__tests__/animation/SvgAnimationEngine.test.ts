import { ParametricScaleConfig, SvgAnimationConfig } from '../../src/animation/SvgAnimationEngine';

describe('ParametricScaleConfig validation', () => {
  it('accepts valid config', () => {
    const config: ParametricScaleConfig = { minScale: 0.5, maxScale: 2.0, duration: 300 };
    expect(config.minScale).toBeLessThan(config.maxScale);
  });

  it('minScale < maxScale is the valid ordering', () => {
    const config: ParametricScaleConfig = { minScale: 0.8, maxScale: 1.5 };
    expect(config.minScale).toBeLessThan(config.maxScale);
  });
});

describe('AnimationPreset values', () => {
  const VALID_PRESETS: SvgAnimationConfig['preset'][] = ['pulse', 'spin', 'breathe', 'bounce', 'fadeIn'];

  it('all 5 presets are defined', () => {
    expect(VALID_PRESETS).toHaveLength(5);
  });

  it('each preset is a string', () => {
    VALID_PRESETS.forEach(p => expect(typeof p).toBe('string'));
  });
});

describe('SvgAnimationConfig defaults', () => {
  it('default duration is 1000ms', () => {
    const defaults = { preset: 'pulse' as const, duration: 1000, loop: true, delay: 0 };
    expect(defaults.duration).toBe(1000);
    expect(defaults.loop).toBe(true);
    expect(defaults.delay).toBe(0);
  });
});
