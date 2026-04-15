import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

export interface BridgeConfig {
  port: number;
  token: string;
  pid: number;
  sessionId: string;
  startedAt: string;
}

export interface SessionInfo {
  sessionId: string;
  sampleRate: number;
  bpm: number;
  timeSignature: [number, number];
  ppq: number;
  hasClip: boolean;
  clipLengthBars: number;
}

export interface ClipData {
  sessionId: string;
  ppq: number;
  tempo: number;
  timeSignature: [number, number];
  events: Array<{
    tickOn: number;
    tickOff: number;
    pitch: number;
    vel: number;
    channel: number;
  }>;
}

export interface WriteClipResult {
  undoToken: string;
  tempMidiPath: string;
  eventCount: number;
}

export interface ReplaceRange {
  startBar: number;
  endBar: number;
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
  return join(homedir(), ".config", "co-harmo", "bridge.json");
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

export class CoHarmoBridgeClient {
  readonly bridgeJsonPath: string;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private reconnectDelay = 500;
  private config: BridgeConfig | null = null;
  private connecting = false;

  constructor() {
    this.bridgeJsonPath = bridgeJsonPath();
  }

  async readConfig(): Promise<BridgeConfig> {
    let raw: string;
    try {
      raw = await readFile(this.bridgeJsonPath, "utf-8");
    } catch {
      throw new Error(
        `Plugin not running — bridge.json not found at ${this.bridgeJsonPath}`
      );
    }
    return JSON.parse(raw) as BridgeConfig;
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.connecting) {
      // Wait up to 10s for an in-progress connect
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("Connection timeout")), 10_000);
        const check = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            clearInterval(check);
            clearTimeout(t);
            resolve();
          }
        }, 100);
      });
      return;
    }

    this.config = await this.readConfig();
    await this.connect(this.config);
  }

  private connect(config: BridgeConfig): Promise<void> {
    this.connecting = true;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${config.port}`);

      ws.once("open", () => {
        // Send hello with token first
        ws.send(JSON.stringify({ method: "hello", params: { token: config.token } }));
      });

      ws.once("message", (data) => {
        // Expect hello ack or any message before marking connected
        try {
          const msg = JSON.parse(String(data)) as { result?: unknown; error?: unknown };
          if (msg.error) {
            ws.close();
            reject(new Error(`Hello rejected: ${JSON.stringify(msg.error)}`));
            return;
          }
        } catch {
          // Non-JSON hello ack — still fine, proceed
        }
        this.ws = ws;
        this.connecting = false;
        this.reconnectDelay = 500;
        this.attachHandlers(ws, config);
        resolve();
      });

      ws.once("error", (err) => {
        this.connecting = false;
        reject(err);
      });

      ws.once("close", () => {
        if (this.connecting) {
          this.connecting = false;
          reject(new Error("WebSocket closed before hello"));
        }
      });
    });
  }

  private attachHandlers(ws: WebSocket, config: BridgeConfig): void {
    ws.on("message", (data) => {
      let msg: { id?: number; result?: unknown; error?: unknown };
      try {
        msg = JSON.parse(String(data)) as typeof msg;
      } catch {
        return;
      }
      if (msg.id === undefined) return;
      const handler = this.pending.get(msg.id);
      if (!handler) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        handler.reject(new Error(JSON.stringify(msg.error)));
      } else {
        handler.resolve(msg.result);
      }
    });

    ws.on("close", () => {
      this.ws = null;
      // Reject all pending requests
      for (const [, handler] of this.pending) {
        handler.reject(new Error("WebSocket disconnected"));
      }
      this.pending.clear();
      // Exponential backoff reconnect
      setTimeout(() => {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 5_000);
        this.connect(config).catch(() => {/* will retry on next call */});
      }, this.reconnectDelay);
    });
  }

  private async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    await this.ensureConnected();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to plugin");
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async getSession(): Promise<SessionInfo> {
    return this.call<SessionInfo>("get_session");
  }

  async readClip(): Promise<ClipData> {
    return this.call<ClipData>("read_clip");
  }

  async writeClip(clip: ClipData, replaceRange?: ReplaceRange): Promise<WriteClipResult> {
    return this.call<WriteClipResult>("write_clip", {
      clip,
      ...(replaceRange ? { replaceRange } : {}),
    });
  }

  async revertClip(undoToken: string): Promise<void> {
    await this.call<unknown>("revert_clip", { undoToken });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
