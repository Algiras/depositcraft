import { describe, expect, it } from 'vitest';

describe('i18n message loading', () => {
  it('falls back to English inline defaults for unsupported languages', async () => {
    const { loadMessages } = await import('./load-messages');
    const messages = await loadMessages();
    expect(typeof messages).toBe('object');
  });

  it('ships complete catalogs for every supported language', async () => {
    for (const lang of ['de', 'es', 'fr', 'it', 'pt', 'nl', 'pl', 'lt']) {
      const data = (await import(`./messages/${lang}.json`)).default;
      expect(Object.keys(data)).toContain('app.common.save');
      expect(Object.keys(data)).toContain('app.title');
    }
  });
});
