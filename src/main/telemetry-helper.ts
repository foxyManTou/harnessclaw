import { TelemetryReporter } from './telemetry'
import type { TelemetryEventInput } from './telemetry'

/**
 * 共享 reporter 实例 (由 index.ts 在 initializeTelemetry 时设置)
 *
 * 通过 helper 模块共享而不是直接 import index.ts,避免循环依赖。
 */
let sharedReporter: TelemetryReporter | null = null

export function setSharedReporter(reporter: TelemetryReporter | null): void {
  sharedReporter = reporter
}

/**
 * 主进程其他模块 (updater.ts / harnessclaw.ts 等) 通过这个函数上报事件
 */
export function reportTelemetry(input: TelemetryEventInput): void {
  if (!sharedReporter) return
  try {
    sharedReporter.report(input)
  } catch (err) {
    console.debug('[Telemetry] report failed:', err)
  }
}
