#!/usr/bin/env node
// M3 probe: write_clip → list_pending → accept_clip → revert_clip roundtrip.
// Uses Node built-in 'net' for raw WebSocket (RFC6455) — no external deps.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import net from "node:net";

function bridgeJsonPath() {
  if (process.platform === "darwin")
    return join(homedir(), "Library", "Application Support", "co-harmo", "bridge.json");
  if (process.platform === "win32")
    return join(process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"), "co-harmo", "bridge.json");
  return join(homedir(), ".config", "co-harmo", "bridge.json");
}

// ── Minimal RFC6455 client over Node net ─────────────────────────────────────

function wsAcceptKey(key) {
  return createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
}

function encodeFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  // Client frames must be masked
  const maskKey = Buffer.allocUnsafe(4);
  for (let i = 0; i < 4; i++) maskKey[i] = Math.floor(Math.random() * 256);
  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ maskKey[i % 4];

  let header;
  if (len <= 125) {
    header = Buffer.from([0x81, 0x80 | len]);
  } else if (len <= 65535) {
    header = Buffer.from([0x81, 0xfe, (len >> 8) & 0xff, len & 0xff]);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x81; header[1] = 0xff;
    for (let i = 0; i < 8; i++) header[9 - i] = (len / (2 ** (8 * i))) & 0xff;
  }
  return Buffer.concat([header, maskKey, masked]);
}

// Decode a single text frame from a buffer; returns { text, bytesConsumed } or null if incomplete.
function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const fin  = (buf[0] & 0x80) !== 0;
  const mask = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = (buf[2] << 8) | buf[3];
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = 0;
    for (let i = 0; i < 8; i++) len = (len * 256) + buf[2 + i];
    offset = 10;
  }
  const maskBytes = mask ? 4 : 0;
  if (buf.length < offset + maskBytes + len) return null;
  const maskKey = mask ? buf.slice(offset, offset + 4) : null;
  offset += maskBytes;
  const payload = buf.slice(offset, offset + len);
  if (maskKey) for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
  return { text: payload.toString("utf8"), bytesConsumed: offset + len };
}

class RawWsClient {
  constructor(port) {
    this.port = port;
    this.socket = null;
    this.buf = Buffer.alloc(0);
    this.waiters = [];        // [{resolve, reject}] for incoming frames
    this.rpcPending = new Map(); // id → {resolve, reject}
    this.nextId = 1;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ port: this.port, host: "127.0.0.1" });
      const key = Buffer.from(Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))).toString("base64");
      const expectedAccept = wsAcceptKey(key);

      sock.once("connect", () => {
        sock.write(
          `GET / HTTP/1.1\r\nHost: 127.0.0.1:${this.port}\r\nUpgrade: websocket\r\n` +
          `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
        );
      });

      let upgraded = false;
      let httpRaw = Buffer.alloc(0);
      sock.on("data", (chunk) => {
        if (!upgraded) {
          httpRaw = Buffer.concat([httpRaw, chunk]);
          const sep = httpRaw.indexOf("\r\n\r\n");
          if (sep === -1) return;
          const headers = httpRaw.slice(0, sep).toString();
          if (!headers.includes(expectedAccept)) {
            reject(new Error("WS handshake accept key mismatch")); return;
          }
          upgraded = true;
          this.socket = sock;
          sock.on("data", (d) => this._onData(d));
          const leftover = httpRaw.slice(sep + 4);
          if (leftover.length > 0) this._onData(leftover);
          resolve();
        }
      });
      sock.once("error", reject);
    });
  }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (true) {
      const result = decodeFrame(this.buf);
      if (!result) break;
      this.buf = this.buf.slice(result.bytesConsumed);
      this._onMessage(result.text);
    }
  }

  _onMessage(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.id !== undefined) {
      const h = this.rpcPending.get(msg.id);
      if (h) {
        this.rpcPending.delete(msg.id);
        msg.error ? h.reject(new Error(JSON.stringify(msg.error))) : h.resolve(msg.result);
        return;
      }
    }
    // Fire waiting raw-message listeners
    if (this.waiters.length > 0) {
      const w = this.waiters.shift();
      w.resolve(msg);
    }
  }

  nextMessage() {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Message timeout")), 5000);
      this.waiters.push({
        resolve: (v) => { clearTimeout(t); resolve(v); },
        reject:  (e) => { clearTimeout(t); reject(e); },
      });
    });
  }

  send(obj) {
    this.socket.write(encodeFrame(JSON.stringify(obj)));
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.rpcPending.delete(id);
        reject(new Error(`Timeout waiting for ${method} (id=${id})`));
      }, 5000);
      this.rpcPending.set(id, {
        resolve: (v) => { clearTimeout(t); resolve(v); },
        reject:  (e) => { clearTimeout(t); reject(e); },
      });
      this.send({ id, method, params });
    });
  }

  close() { this.socket?.destroy(); }
}

async function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function main() {
  const bpath = bridgeJsonPath();
  console.log(`Reading bridge config from: ${bpath}`);
  let config;
  try {
    config = JSON.parse(await readFile(bpath, "utf-8"));
  } catch {
    await fail(`bridge.json not found at ${bpath}`);
  }
  console.log(`bridge.json OK  port=${config.port}  pid=${config.pid}`);

  const client = new RawWsClient(config.port);
  await client.connect();

  // Auth: hello (no id expected in response for hello — server echoes whatever id we send)
  client.send({ id: 0, method: "hello", params: { token: config.token } });
  const helloAck = await client.nextMessage();
  if (helloAck.error) await fail(`hello rejected: ${JSON.stringify(helloAck.error)}`);
  console.log("Connected and authenticated");

  // ── Step 1: get_session ────────────────────────────────────────────────────
  const session = await client.call("get_session");
  console.log(`get_session OK  sessionId=${session.sessionId}  bpm=${session.bpm}`);

  // ── Step 2: write_clip ─────────────────────────────────────────────────────
  const ppq = 480;
  const tickQ = ppq;
  const clipPayload = {
    sessionId: session.sessionId,
    ppq,
    tempo: 120,
    timeSignature: [4, 4],
    events: [
      { tickOn: 0,       tickOff: tickQ,   pitch: 60, vel: 80, channel: 1 },
      { tickOn: tickQ,   tickOff: tickQ*2, pitch: 64, vel: 80, channel: 1 },
      { tickOn: tickQ*2, tickOff: tickQ*3, pitch: 67, vel: 80, channel: 1 },
    ],
  };

  let writeResult;
  try {
    writeResult = await client.call("write_clip", { clip: clipPayload });
  } catch (err) {
    await fail(`write_clip: ${err.message}`);
  }
  const { undoToken, tempMidiPath } = writeResult;
  if (!undoToken) await fail("write_clip returned no undoToken");
  console.log(`write_clip OK  undoToken=${undoToken}`);
  console.log(`               tempMidiPath=${tempMidiPath}`);

  // ── Step 3: list_pending ───────────────────────────────────────────────────
  const { pending } = await client.call("list_pending");
  const entry = pending.find((e) => e.undoToken === undoToken);
  if (!entry) await fail(`list_pending: undoToken ${undoToken} not found`);
  console.log(`list_pending OK  eventCount=${entry.eventCount}  accepted=${entry.accepted}`);

  // ── Step 4: accept_clip ────────────────────────────────────────────────────
  await client.call("accept_clip", { undoToken });
  console.log(`accept_clip OK  undoToken=${undoToken}`);

  const { pending: pending2 } = await client.call("list_pending");
  const entry2 = pending2.find((e) => e.undoToken === undoToken);
  if (!entry2?.accepted) await fail("accept_clip did not mark entry as accepted");
  console.log(`list_pending after accept OK  accepted=${entry2.accepted}`);

  // ── Step 5: write a second clip, then revert it ────────────────────────────
  const clipPayload2 = {
    ...clipPayload,
    events: [
      { tickOn: 0, tickOff: tickQ * 4, pitch: 72, vel: 90, channel: 1 },
    ],
  };
  const writeResult2 = await client.call("write_clip", { clip: clipPayload2 });
  const undoToken2 = writeResult2.undoToken;
  if (!undoToken2) await fail("second write_clip returned no undoToken");
  console.log(`second write_clip OK  undoToken2=${undoToken2}`);

  await client.call("revert_clip", { undoToken: undoToken2 });
  console.log(`revert_clip OK  undoToken2=${undoToken2}`);

  client.close();
  console.log("\nM3 Probe PASSED");
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
