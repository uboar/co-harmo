import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

interface BridgeConfig {
  port: number;
  host: string;
}

function bridgeJsonPath(): string {
  const platform = process.platform;
  if (platform === "win32") {
    const appData = process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "co-harmo", "bridge.json");
  }
  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "co-harmo", "bridge.json");
  }
  // Linux / other — dev ergonomics
  return join(homedir(), ".config", "co-harmo", "bridge.json");
}

/** Stub — resolves bridge.json path and reads config; WS connection is M2 work. */
export class CoHarmoBridgeClient {
  readonly bridgeJsonPath: string;

  constructor() {
    this.bridgeJsonPath = bridgeJsonPath();
  }

  async readConfig(): Promise<BridgeConfig> {
    const raw = await readFile(this.bridgeJsonPath, "utf-8");
    return JSON.parse(raw) as BridgeConfig;
  }
}
