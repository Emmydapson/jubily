import { allowedCorsOrigins, corsOrigin } from './main';

describe('main app HTTP contract', () => {
  it('allows the production Jubily frontend origin for CORS', () => {
    const callback = jest.fn();

    corsOrigin('https://joinjubily.com', callback);

    expect(allowedCorsOrigins).toContain('https://joinjubily.com');
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('rejects unknown CORS origins', () => {
    const callback = jest.fn();

    corsOrigin('https://evil.example.com', callback);

    expect(callback.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(callback.mock.calls[0][0].message).toBe('Not allowed by CORS');
  });
});
