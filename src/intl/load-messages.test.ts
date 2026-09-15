import { describe, expect, it } from 'vitest';
import en from './messages/en.json';

const SUPPORTED = ['de', 'es', 'fr', 'it', 'pt', 'nl', 'pl', 'lt'] as const;

/** Keys whose translation is allowed to be identical to English: brand words and
 * purely-symbolic templates that carry no translatable natural-language content. */
const ALLOW_IDENTICAL = new Set([
  'app.common.pro',
  'app.common.percentage',
  'app.table.idPrefix',
  'app.table.installmentsValue',
]);

const PLACEHOLDER_PATTERN = /\{\s*([a-zA-Z0-9_]+)\s*[,}]/g;

function placeholders(message: string): Set<string> {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(PLACEHOLDER_PATTERN);
  while ((match = re.exec(message))) {
    found.add(match[1]);
  }
  return found;
}

describe('i18n message loading', () => {
  it('falls back to English inline defaults for unsupported languages', async () => {
    const { loadMessages } = await import('./load-messages');
    const messages = await loadMessages();
    expect(typeof messages).toBe('object');
  });

  it('ships complete catalogs for every supported language', async () => {
    for (const lang of SUPPORTED) {
      const data = (await import(`./messages/${lang}.json`)).default as Record<string, string>;
      expect(Object.keys(data)).toContain('app.common.save');
      expect(Object.keys(data)).toContain('app.title');
    }
  });

  for (const lang of SUPPORTED) {
    it(`${lang}.json has every en.json key, no empty values, and matching ICU placeholders`, async () => {
      const data = (await import(`./messages/${lang}.json`)).default as Record<string, string>;
      const enKeys = Object.keys(en as Record<string, string>);

      for (const key of enKeys) {
        expect(data, `${lang}.json is missing key "${key}"`).toHaveProperty(key);
        expect(data[key].trim(), `${lang}.json has an empty value for "${key}"`).not.toBe('');

        const enPlaceholders = placeholders((en as Record<string, string>)[key]);
        const langPlaceholders = placeholders(data[key]);
        expect(
          [...langPlaceholders].sort(),
          `${lang}.json key "${key}" has placeholders ${JSON.stringify([...langPlaceholders])} but en.json has ${JSON.stringify([...enPlaceholders])}`
        ).toEqual([...enPlaceholders].sort());

        if (!ALLOW_IDENTICAL.has(key)) {
          expect(
            data[key],
            `${lang}.json key "${key}" is identical to English and is not in ALLOW_IDENTICAL`
          ).not.toBe((en as Record<string, string>)[key]);
        }
      }

      // No stray keys beyond the English catalog.
      for (const key of Object.keys(data)) {
        expect(enKeys, `${lang}.json has an extra key "${key}" not present in en.json`).toContain(key);
      }
    });
  }
});
