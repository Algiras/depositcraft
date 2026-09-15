/**
 * Wix Stores catalog app definition ID, as referenced by Catalog V3
 * `catalogReference.appId` for a Wix Stores product.
 *
 * @see https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix
 */
export const WIX_STORES_CATALOG_APP_ID = '215238eb-22a5-4c36-9e7b-e7c08025e04e';

/**
 * Wix eCommerce platform app definition ID (checkout, orders, shipping).
 * `site.installedWixApps` may list this ID even when the catalog app id is absent.
 */
export const WIX_ECOM_PLATFORM_APP_ID = '1380b703-ce81-ff05-f115-39571d94dfcd';

/** Wix Bookings — another business solution that brings checkout/eCommerce. */
export const WIX_BOOKINGS_APP_ID = '13d21c63-b5ec-5912-8397-c3a5ddb27a97';

/** Wix Restaurants Orders (new) — checkout-capable business solution. */
export const WIX_RESTAURANTS_ORDERS_APP_ID = '9a5d83fd-8570-482e-81ab-cfa88942ee60';

/** App Market listing used by prerequisite empty states. */
export const WIX_STORES_APP_MARKET_URL = 'https://www.wix.com/app-market/wix-stores';

/** @deprecated Prefer {@link WIX_STORES_CATALOG_APP_ID} */
export const WIX_STORES_APP_ID = WIX_STORES_CATALOG_APP_ID;

const ECOMMERCE_APP_IDS = new Set([
  WIX_STORES_CATALOG_APP_ID,
  WIX_ECOM_PLATFORM_APP_ID,
  WIX_BOOKINGS_APP_ID,
  WIX_RESTAURANTS_ORDERS_APP_ID,
  // Legacy Restaurants Orders app id (still seen on older sites).
  '13e8d036-5516-6104-b456-c8466db39542',
]);

const ECOMMERCE_APP_NAME_PATTERN = /stores|ecommerce|e-commerce|bookings|restaurant/i;

export type EcommerceInstallState = boolean | undefined;

/**
 * `site.installedWixApps` (from `appInstances.getAppInstance()`) is not
 * guaranteed to carry raw app-definition IDs on every site vintage, so this
 * also accepts the human-readable app name as a fallback signal.
 */
export function hasEcommerceInstalled(installedWixApps: readonly string[]): boolean {
  if (installedWixApps.length === 0) return false;
  return installedWixApps.some(
    app => ECOMMERCE_APP_IDS.has(app) || ECOMMERCE_APP_NAME_PATTERN.test(app)
  );
}

/**
 * Fail open when `installedWixApps` is missing from the instance payload or
 * the instance call failed — the dashboard must not block merchants on a check
 * we cannot actually perform.
 */
export function resolveEcommerceInstalled(
  installedWixApps: string[] | undefined | null
): EcommerceInstallState {
  if (!Array.isArray(installedWixApps)) return undefined;
  return hasEcommerceInstalled(installedWixApps);
}
