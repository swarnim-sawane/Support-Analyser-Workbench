import { describe, expect, it } from 'vitest';
import { buildAllowedOrigins, parseConfiguredOrigins } from './corsOrigins';

describe('CORS origins', () => {
  it('allows the VM frontend by IP and DNS hostname', () => {
    expect(buildAllowedOrigins()).toEqual(expect.arrayContaining([
      'http://10.65.39.163:3000',
      'http://celvpvm05798.us.oracle.com:3000',
    ]));
  });

  it('trims configured origins and removes duplicates', () => {
    expect(parseConfiguredOrigins(' http://example.com:3000, ,http://example.com:3000 ')).toEqual([
      'http://example.com:3000',
      'http://example.com:3000',
    ]);

    expect(buildAllowedOrigins(' http://10.65.39.163:3000, http://extra.example.com:3000 ')).toEqual(
      expect.arrayContaining([
        'http://10.65.39.163:3000',
        'http://extra.example.com:3000',
      ])
    );
    expect(buildAllowedOrigins(' http://10.65.39.163:3000 ').filter(
      origin => origin === 'http://10.65.39.163:3000'
    )).toHaveLength(1);
  });
});
