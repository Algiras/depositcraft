import {
  AppLogger as CoreAppLogger,
  createDiagnostics,
  isSetupFinished,
  markDashboardLoaded,
  markSetupFinished,
  resetSetupStateForTesting,
} from '@wix-extensions/core/telemetry';

export { isSetupFinished, markDashboardLoaded, markSetupFinished, resetSetupStateForTesting };

/**
 * Wix BI confirms event submission only. It is not a retrievable support-log
 * store; release acceptance must verify any destination and retention policy.
 */
export type DiagnosticEventName =
  | 'storage_metadata_read'
  | 'storage_permissions_read'
  | 'storage_read'
  | 'storage_write'
  | 'storage_init'
  | 'storage_verify'
  | 'storage_install_verify'
  | 'configuration_load'
  | 'configuration_save'
  | 'plan_create'
  | 'plan_toggle'
  | 'plan_save'
  | 'plan_delete'
  | 'entitlement_check'
  | 'deposit_evaluate'
  | 'order_load'
  | 'payment_request_check'
  | 'payment_request_start'
  | 'payment_request_sync'
  | 'payment_request_advance'
  | 'checkout_deposit_seed'
  | 'installment_billing_run'
  | 'automation_report'
  | 'automation_cancel'
  | 'app_installed'
  | 'app_removed'
  | 'app_paid_plan_changed'
  | 'dashboard_error';

export type DiagnosticOutcome = 'success' | 'failure';

export type DiagnosticInput = {
  outcome: DiagnosticOutcome;
  durationMs?: number;
  errorCode?: string;
  wixRequestId?: string;
  surface?: 'dashboard' | 'order_slot' | 'backend' | 'spi' | 'backend_event';
  mode?: 'sample' | 'real';
  /** Retry-loop attempts count (storage_install_verify). */
  attempts?: number;
};

const APP_VERSION = '1.0.0';
const APP_NAME = 'depositcraft';

/**
 * `createDiagnostics` now emits the exact same snake_case BI wire schema this
 * app has always sent under `depositcraft_*` custom event names
 * (`app_version`/`schema_version`/`timestamp`/`outcome`/`surface`/
 * `duration_ms`/`error_code`/`wix_request_id`/`mode`/`attempts`), so the
 * app-specific implementation that used to live here has been removed in
 * favor of delegating to core. See `logger.test.ts` for the pinned wire shape.
 */
const diagnostics = createDiagnostics({ appName: APP_NAME, appVersion: APP_VERSION, schemaVersion: '1' });

/**
 * Best-effort, client-side Wix BI ingress with a closed schema. Deliberately
 * do not await it: diagnostics must never block the primary app operation.
 */
export function emitDiagnostic(eventName: DiagnosticEventName, input: DiagnosticInput): void {
  diagnostics.emitDiagnostic(eventName, input);
}

/**
 * Zero-Infra Telemetry & Structured Logger for DepositCraft.
 * Emits machine-parseable JSON logs ingested directly by Wix Dev Center Monitoring.
 * Tracks execution durations, deposit calculations, layaway schedules, and error boundaries at $0.00/mo cost.
 *
 * Delegates `info`/`warn`/`error`/`time` to `@wix-extensions/core/telemetry`'s
 * `AppLogger` (identical implementation) and adds the app-specific
 * `trackUsage` method that core does not provide.
 */
export interface LogPayload {
  app: string;
  version?: string;
  action: string;
  durationMs?: number;
  data?: Record<string, any>;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

export class AppLogger {
  private readonly core: CoreAppLogger;

  constructor(private readonly appName: string, private readonly version: string = '1.0.0') {
    this.core = new CoreAppLogger(appName, version);
  }

  time<T>(action: string, fn: () => Promise<T> | T, context?: Record<string, any>): Promise<T> {
    return this.core.time(action, fn, context);
  }

  info(action: string, meta?: Partial<LogPayload>): void {
    this.core.info(action, meta);
  }

  warn(action: string, meta?: Partial<LogPayload>): void {
    this.core.warn(action, meta);
  }

  error(action: string, error: any, meta?: Partial<LogPayload>): void {
    this.core.error(action, error, meta);
  }

  /**
   * Records business usage events (e.g. deposit calculated, layaway schedule created).
   */
  trackUsage(event: string, metrics: Record<string, number | string | boolean>): void {
    const payload = {
      app: this.appName,
      version: this.version,
      event: `USAGE_${event.toUpperCase()}`,
      timestamp: new Date().toISOString(),
      metrics,
    };
    console.info(`[TELEMETRY:USAGE] ${JSON.stringify(payload)}`);
  }
}

export const logger = new AppLogger('depositcraft', '1.0.0');
