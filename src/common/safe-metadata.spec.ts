import { sanitizeMetadata, safeErrorMessage } from './safe-metadata';

describe('safe metadata helpers', () => {
  it('redacts sensitive keys recursively', () => {
    expect(
      sanitizeMetadata({
        ok: true,
        accessToken: 'secret-token',
        nested: { api_key: 'secret-key', value: 'visible' },
      }),
    ).toEqual({
      ok: true,
      accessToken: '[REDACTED]',
      nested: { api_key: '[REDACTED]', value: 'visible' },
    });
  });

  it('redacts bearer tokens and query token values from error messages', () => {
    expect(safeErrorMessage(new Error('failed Bearer abc.def access_token=123'))).toBe(
      'failed Bearer [REDACTED] access_token=[REDACTED]',
    );
  });
});
