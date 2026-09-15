import { describe, expect, it } from 'vitest';
import {
  WIX_BOOKINGS_APP_ID,
  WIX_ECOM_PLATFORM_APP_ID,
  WIX_STORES_APP_ID,
  WIX_STORES_CATALOG_APP_ID,
  hasEcommerceInstalled,
  resolveEcommerceInstalled,
} from './ecommerce';

describe('hasEcommerceInstalled', () => {
  it('returns false when the installed-apps list is empty', () => {
    expect(hasEcommerceInstalled([])).toBe(false);
  });

  it('recognizes the Wix Stores catalog app definition ID', () => {
    expect(hasEcommerceInstalled(['some-other-app', WIX_STORES_CATALOG_APP_ID])).toBe(true);
    expect(WIX_STORES_APP_ID).toBe(WIX_STORES_CATALOG_APP_ID);
  });

  it('recognizes the Wix eCommerce platform app definition ID', () => {
    expect(hasEcommerceInstalled(['some-other-app', WIX_ECOM_PLATFORM_APP_ID])).toBe(true);
  });

  it('recognizes other checkout-capable Wix business solutions', () => {
    expect(hasEcommerceInstalled(['some-other-app', WIX_BOOKINGS_APP_ID])).toBe(true);
  });

  it('recognizes a human-readable Wix Stores / eCommerce app name as a fallback', () => {
    expect(hasEcommerceInstalled(['Wix Stores'])).toBe(true);
    expect(hasEcommerceInstalled(['Wix eCommerce'])).toBe(true);
  });

  it('returns false when only unrelated apps are installed', () => {
    expect(hasEcommerceInstalled(['Wix Forms', 'Wix Blog'])).toBe(false);
  });
});

describe('resolveEcommerceInstalled', () => {
  it('returns undefined when installedWixApps is missing (fail open)', () => {
    expect(resolveEcommerceInstalled(undefined)).toBeUndefined();
    expect(resolveEcommerceInstalled(null)).toBeUndefined();
  });

  it('returns false when the field is present but empty', () => {
    expect(resolveEcommerceInstalled([])).toBe(false);
  });

  it('returns true when a known eCommerce app id is present', () => {
    expect(resolveEcommerceInstalled([WIX_ECOM_PLATFORM_APP_ID])).toBe(true);
  });
});
