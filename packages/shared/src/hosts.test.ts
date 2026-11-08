import { describe, expect, it } from 'vitest';

import { coHostInviteUrl, formatHostNames, hostedByKey, isValidCoHostToken } from './hosts';
import { isValidInviteToken } from './invite';

describe('formatHostNames', () => {
  it('one name', () => {
    expect(formatHostNames('Anna', [], 'en')).toBe('Anna');
    expect(formatHostNames('Anna', [], 'sv')).toBe('Anna');
  });
  it('two names', () => {
    expect(formatHostNames('Anna', ['Erik'], 'en')).toBe('Anna & Erik');
    expect(formatHostNames('Anna', ['Erik'], 'sv')).toBe('Anna och Erik');
  });
  it('three or more names, owner first and co-hosts in the given order', () => {
    expect(formatHostNames('Anna', ['Erik', 'Sara'], 'en')).toBe('Anna, Erik & Sara');
    expect(formatHostNames('Anna', ['Erik', 'Sara'], 'sv')).toBe('Anna, Erik och Sara');
    expect(formatHostNames('Anna', ['Erik', 'Sara', 'Bo'], 'en')).toBe('Anna, Erik, Sara & Bo');
    expect(formatHostNames('Anna', ['Erik', 'Sara', 'Bo'], 'sv')).toBe('Anna, Erik, Sara och Bo');
  });
  it('skips missing names', () => {
    expect(formatHostNames(null, ['Erik'], 'en')).toBe('Erik');
    expect(formatHostNames('Anna', ['', '  ', null], 'en')).toBe('Anna');
    expect(formatHostNames(null, [], 'en')).toBe('');
  });
  it('picks the singular or plural "hosted by" key', () => {
    expect(hostedByKey('Anna')).toBe('hosted_by');
    expect(hostedByKey('Anna', [''])).toBe('hosted_by');
    expect(hostedByKey('Anna', ['Erik'])).toBe('hosted_by_many');
  });
});

describe('co-host links', () => {
  it('builds /c/ URLs', () => {
    expect(coHostInviteUrl('https://checkin.example/', 'A'.repeat(22))).toBe(`https://checkin.example/c/${'A'.repeat(22)}`);
  });
  it('co-host and guest token formats never overlap', () => {
    const coHost = 'AbCdEfGhIjKlMnOpQrStUv';
    expect(isValidCoHostToken(coHost)).toBe(true);
    expect(isValidInviteToken(coHost)).toBe(false);
    expect(isValidCoHostToken('AbC123def456')).toBe(false);
  });
});
