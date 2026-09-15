import { biEvents } from '@wix/app-management';

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
};

const APP_VERSION = '1.0.0';
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function addIfDefined(eventData: Record<string, string>, key: string, value: string | undefined): void {
  if (value) eventData[key] = value;
}

function sendBiEventBestEffort(send: () => Promise<void>): void {
  try {
    void send().catch(() => undefined);
  } catch {
    // Diagnostics must not break the merchant operation if the SDK cannot initialize.
  }
}

/**
 * Best-effort, client-side Wix BI ingress with a closed schema. Deliberately
 * do not await it: diagnostics must never block the primary app operation.
 */
export function emitDiagnostic(eventName: DiagnosticEventName, input: DiagnosticInput): void {
  const eventData: Record<string, string> = {
    app_version: APP_VERSION,
    schema_version: '1',
    timestamp: new Date().toISOString(),
    outcome: input.outcome,
    surface: input.surface ?? 'dashboard',
  };
  if (Number.isFinite(input.durationMs) && input.durationMs! >= 0) {
    eventData.duration_ms = String(Math.round(input.durationMs!));
  }
  addIfDefined(eventData, 'error_code', input.errorCode && SAFE_ERROR_CODE.test(input.errorCode) ? input.errorCode : undefined);
  addIfDefined(eventData, 'wix_request_id', input.wixRequestId && SAFE_REQUEST_ID.test(input.wixRequestId) ? input.wixRequestId : undefined);
  addIfDefined(eventData, 'mode', input.mode);

  sendBiEventBestEffort(() => biEvents.sendBiEvent({
    eventName: 'CUSTOM',
    customEventName: `depositcraft_${eventName}`,
    eventData,
  }));
}

/** Call only when the caller has established required first-run setup is complete. */
export function markSetupFinished(): void {
  sendBiEventBestEffort(() => biEvents.sendBiEvent({ eventName: 'APP_SETUP_FINISHED' }));
}

/** Call once when the app's dashboard page mounts; measures install -> visit adoption. */
export function markDashboardLoaded(): void {
  sendBiEventBestEffort(() => biEvents.sendBiEvent({ eventName: 'APP_DASHBOARD_LOADED' }));
}

/**
 * Zero-Infra Telemetry & Structured Logger for DepositCraft.
 * Emits machine-parseable JSON logs ingested directly by Wix Dev Center Monitoring.
 * Tracks execution durations, deposit calculations, layaway schedules, and error boundaries at $0.00/mo cost.
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
  private appName: string;
  private version: string;

  constructor(appName: string, version: string = '1.0.0') {
    this.appName = appName;
    this.version = version;
  }

  /**
   * Times the execution of an async or synchronous function and logs execution telemetry.
   */
  async time<T>(action: string, fn: () => Promise<T> | T, context?: Record<string, any>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      const durationMs = Date.now() - start;
      this.info(action, { durationMs, data: context });
      return result;
    } catch (err: any) {
      const durationMs = Date.now() - start;
      this.error(action, err, { durationMs, data: context });
      throw err;
    }
  }

  info(action: string, meta?: Partial<LogPayload>): void {
    const payload: LogPayload = {
      app: this.appName,
      version: this.version,
      action,
      ...meta,
    };
    console.info(`[TELEMETRY:INFO] ${JSON.stringify(payload)}`);
  }

  warn(action: string, meta?: Partial<LogPayload>): void {
    const payload: LogPayload = {
      app: this.appName,
      version: this.version,
      action,
      ...meta,
    };
    console.warn(`[TELEMETRY:WARN] ${JSON.stringify(payload)}`);
  }

  error(action: string, error: any, meta?: Partial<LogPayload>): void {
    const payload: LogPayload = {
      app: this.appName,
      version: this.version,
      action,
      ...meta,
      error: {
        name: error?.name || 'Error',
        message: error?.message || String(error),
        stack: error?.stack,
      },
    };
    console.error(`[TELEMETRY:ERROR] ${JSON.stringify(payload)}`);
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
