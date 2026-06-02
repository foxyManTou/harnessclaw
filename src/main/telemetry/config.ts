import fs from 'fs'
import path from 'path'

export interface TelemetryConfig {
  endpoint: string
  enabled: boolean
  consented: boolean
}

const DEFAULT_CONFIG: TelemetryConfig = {
  // 生产环境(带 /spark-pai 前缀)
  endpoint: 'http://agentbuilder.aipaasapi.cn/spark-pai/api/v1/telemetry/events',
  enabled: true,
  consented: false,
}

export class TelemetryConfigManager {
  private config: TelemetryConfig
  private configPath: string

  constructor(harnessclawDir: string) {
    this.configPath = path.join(harnessclawDir, 'telemetry.json')
    this.config = this.load()
  }

  private load(): TelemetryConfig {
    if (!fs.existsSync(this.configPath)) {
      return { ...DEFAULT_CONFIG }
    }
    try {
      const loaded = JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) as Partial<TelemetryConfig>
      return {
        endpoint: loaded.endpoint ?? DEFAULT_CONFIG.endpoint,
        enabled: loaded.enabled ?? DEFAULT_CONFIG.enabled,
        consented: loaded.consented ?? DEFAULT_CONFIG.consented,
      }
    } catch (err) {
      console.warn('[Telemetry] Failed to load config, using defaults:', err)
      return { ...DEFAULT_CONFIG }
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch (err) {
      console.error('[Telemetry] Failed to save config:', err)
    }
  }

  getConfig(): TelemetryConfig {
    return { ...this.config }
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled
    this.save()
  }

  setEndpoint(endpoint: string): void {
    this.config.endpoint = endpoint
    this.save()
  }

  setConsented(consented: boolean): void {
    this.config.consented = consented
    this.save()
  }

  shouldReport(_category: string, _action: string): boolean {
    return this.config.enabled
  }
}
