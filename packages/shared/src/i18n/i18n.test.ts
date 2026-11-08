import { describe, expect, it } from 'vitest';
import { parseAcceptLanguage, pickLocale, translations } from './index';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('i18n', () => {
  it('sv and en have the same keys', () => {
    expect(keys(translations.sv).sort()).toEqual(keys(translations.en).sort());
  });
  it('picks Swedish for sv-SE', () => expect(pickLocale(['sv-SE'])).toBe('sv'));
  it('falls back to English', () => expect(pickLocale(['de-DE', 'fr'])).toBe('en'));
  it('orders Accept-Language by quality', () =>
    expect(parseAcceptLanguage('en;q=0.5, sv-SE, de;q=0.8')).toEqual(['sv-SE', 'de', 'en']));
});
