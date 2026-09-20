import { appInstances } from '@wix/app-management';
import { items } from '@wix/data';
import { auth } from '@wix/essentials';
import { createLifecycleEventHandlers } from '@wix-extensions/core/telemetry';
import { purgeCollections } from '@wix-extensions/core/storage';
import { PAYMENT_LEDGER_COLLECTION } from '../../../shared/payment-ledger';
import { logger } from '../../../shared/logger';

/**
 * Uninstall lifecycle telemetry, plus a best-effort purge of order-linked data.
 *
 * NOTE ON MERCHANT DATA: DepositCraft stores two collections.
 * `depositcraft-payment-ledger` (see `src/shared/payment-ledger.ts`) is keyed
 * by `orderId` and records each order's deposit/installment schedule and
 * payment-request state -- that is order-linked data with a real
 * personal-data dimension, so this handler now purges it on uninstall.
 * `depositcraft-plans` (pure merchant-configured deposit rules: thresholds,
 * percentages, SKU targets -- no reference to any individual) is
 * deliberately left alone: it is retained so a merchant who
 * uninstalls/reinstalls (or hits an accidental uninstall) does not lose
 * their configured plans, and it carries no personal-data obligation of its
 * own.
 *
 * `purgeCollections` (see `packages/core/src/storage/purge.ts`) never throws,
 * is bounded by hard page/record caps, and reports counts -- logged below via
 * `logger` for support diagnostics. A purge failure can therefore never turn
 * this webhook into one of Wix's up-to-12 retries. This handler runs with no
 * merchant session, so both the query and the remove must go through
 * `auth.elevate` or they 403 ("Missing authentication information").
 *
 * An earlier version of this comment claimed "no merchant data is stored",
 * which was false.
 */
export default appInstances.onAppInstanceRemoved(
  createLifecycleEventHandlers('depositcraft', {
    onAppRemoved: async () => {
      const report = await purgeCollections(PAYMENT_LEDGER_COLLECTION, {
        query: auth.elevate(items.query),
        remove: auth.elevate(items.remove),
      });
      const result = report.results[0];
      const logMeta = { data: { collection: PAYMENT_LEDGER_COLLECTION, ...result } };
      if (result?.error) {
        logger.error('app_removed_purge', new Error(result.error), logMeta);
      } else if (report.totalFailed > 0 || report.anyCapped) {
        logger.warn('app_removed_purge', logMeta);
      } else {
        logger.info('app_removed_purge', logMeta);
      }
    },
  }).onAppRemoved,
);
