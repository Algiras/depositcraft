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
