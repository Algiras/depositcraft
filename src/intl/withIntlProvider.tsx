import React from 'react';
import { IntlProvider } from 'react-intl';
import { i18n } from '@wix/essentials';
import { loadMessages } from './load-messages';

/**
 * Wraps a dashboard component with react-intl. Renders immediately with the
 * inline English defaultMessage and swaps in translated messages once loaded,
 * so there is no blank flash while the catalog imports.
 */
export function withIntlProvider<P extends object>(Component: React.ComponentType<P>): React.ComponentType<P> {
  return function WithIntlProvider(props: P) {
    const [messages, setMessages] = React.useState<Record<string, string>>({});

    React.useEffect(() => {
      let mounted = true;
      loadMessages().then((data) => {
        if (mounted && Object.keys(data).length > 0) setMessages(data);
      }).catch(() => undefined);
      return () => { mounted = false; };
    }, []);

    let locale = 'en';
    try {
      locale = i18n.getLocale() || 'en';
    } catch {
      locale = 'en';
    }
    return (
      <IntlProvider messages={messages} locale={locale} defaultLocale="en">
        <Component {...(props as P)} />
      </IntlProvider>
    );
  };
}
