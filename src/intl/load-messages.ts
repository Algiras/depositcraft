import { i18n } from '@wix/essentials';

export const SUPPORTED_LANGUAGES = ['de', 'es', 'fr', 'it', 'pt', 'nl', 'pl', 'lt'] as const;

const LOADERS: Record<string, () => Promise<{ default: Record<string, string> }>> = {
  de: () => import('./messages/de.json'),
  es: () => import('./messages/es.json'),
  fr: () => import('./messages/fr.json'),
  it: () => import('./messages/it.json'),
  pt: () => import('./messages/pt.json'),
  nl: () => import('./messages/nl.json'),
  pl: () => import('./messages/pl.json'),
  lt: () => import('./messages/lt.json'),
};

/**
 * Loads the dashboard language's messages; missing languages fall back to the
 * inline English defaultMessage so partial catalogs degrade gracefully.
 */
export async function loadMessages(): Promise<Record<string, string>> {
  let raw: string = 'en';
  try {
    raw = i18n.getLanguage();
  } catch {
    raw = 'en';  // no Wix context (tests, previews) — English inline defaults
  }
  const lang = String(raw || 'en').split('-')[0];
  const loader = LOADERS[lang];
  if (!loader) return {};
  try {
    return (await loader()).default;
  } catch {
    return {};
  }
}
