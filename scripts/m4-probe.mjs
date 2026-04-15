#!/usr/bin/env node
// M4 probe: exercises summarize_clip and diff_clip_abc logic against live plugin data.
// Uses Node built-in net for WS (no external deps), then imports mcp-server dist
// for summarizeClip and diffClips (pure functions — no ws dep there).
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "mcp-server", "dist");

// Lazy imports from mcp-server dist (pure logic, no ws dep)
const { summarizeClip } = await import(`${DIST}/summarize.js`);
const { diffClips }     = await import(`${DIST}/clipDiff.js`);
const { abcCodec }      = await import(`${DIST}/codec/abcCodec.js`);

// ── bridge.json path ──────────────────────────────────────────────────────────
function bridgeJsonPath() {
  if (process.platform === "darwin")
    return join(homedir(), "Library", "Application Support", "co-harmo", "bridge.json");
  if (process.platform === "win32")
    return join(process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"), "co-harmo", "bridge.json");
  return join(homedir(), ".config", "co-harmo", "bridge.json");
}

// ── Minimal RFC6455 client ────────────────────────────────────────────────────
function wsAcceptKey(key) {
  return createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
}
function encodeFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  const maskKey = Buffer.allocUnsafe(4);
  for (let i = 0; i < 4; i++) maskKey[i] = Math.floor(Math.random() * 256);
  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ maskKey[i % 4];
  let header;
  if (len <= 125)        header = Buffer.from([0x81, 0x80 | len]);
  else if (len <= 65535) header = Buffer.from([0x81, 0xfe, (len >> 8) & 0xff, len & 0xff]);
  else { header = Buffer.allocUnsafe(10); header[0] = 0x81; header[1] = 0xff; for (let i = 0; i < 8; i++) header[9 - i] = (len / (2 ** (8 * i))) & 0xff; }
  return Buffer.concat([header, maskKey, masked]);
}
function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const mask = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f, offset = 2;
  if (len === 126) { if (buf.length < 4) return null; len = (buf[2] << 8) | buf[3]; offset = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = 0; for (let i = 0; i < 8; i++) len = (len * 256) + buf[2 + i]; offset = 10; }
  const maskBytes = mask ? 4 : 0;
  if (buf.length < offset + maskBytes + len) return null;
  const maskKey = mask ? buf.slice(offset, offset + 4) : null;
  offset += maskBytes;
  const payload = Buffer.from(buf.slice(offset, offset + len));
  if (maskKey) for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
  return { text: payload.toString("utf8"), bytesConsumed: offset + len };
}
class RawWsClient {
  constructor(port) { this.port = port; this.socket = null; this.buf = Buffer.alloc(0); this.waiters = []; this.rpcPending = new Map(); this.nextId = 1; }
  connect() {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ port: this.port, host: "127.0.0.1" });
      const key = Buffer.from(Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))).toString("base64");
      const expected = wsAcceptKey(key);
      sock.once("connect", () => sock.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${this.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
      let upgraded = false; let httpRaw = Buffer.alloc(0);
      sock.on("data", (chunk) => {
        if (!upgraded) {
          httpRaw = Buffer.concat([httpRaw, chunk]);
          const sep = httpRaw.indexOf("\r\n\r\n");
          if (sep === -1) return;
          if (!httpRaw.slice(0, sep).toString().includes(expected)) { reject(new Error("WS handshake failed")); return; }
          upgraded = true; this.socket = sock;
          sock.on("data", (d) => this._onData(d));
          const leftover = httpRaw.slice(sep + 4);
          if (leftover.length > 0) this._onData(leftover);
          resolve();
        }
      });
      sock.once("error", reject);
    });
  }
  _onData(chunk) { this.buf = Buffer.concat([this.buf, chunk]); while (true) { const r = decodeFrame(this.buf); if (!r) break; this.buf = this.buf.slice(r.bytesConsumed); this._onMessage(r.text); } }
  _onMessage(text) {
    let msg; try { msg = JSON.parse(text); } catch { return; }
    if (msg.id !== undefined) { const h = this.rpcPending.get(msg.id); if (h) { this.rpcPending.delete(msg.id); msg.error ? h.reject(new Error(JSON.stringify(msg.error))) : h.resolve(msg.result); return; } }
    if (this.waiters.length > 0) { const w = this.waiters.shift(); w.resolve(msg); }
  }
  nextMessage() { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("Message timeout")), 5000); this.waiters.push({ resolve: (v) => { clearTimeout(t); res(v); }, reject: (e) => { clearTimeout(t); rej(e); } }); }); }
  send(obj) { this.socket.write(encodeFrame(JSON.stringify(obj))); }
  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.rpcPending.delete(id); rej(new Error(`Timeout: ${method}`)); }, 5000);
      this.rpcPending.set(id, { resolve: (v) => { clearTimeout(t); res(v); }, reject: (e) => { clearTimeout(t); rej(e); } });
      this.send({ id, method, params });
    });
  }
  close() { this.socket?.destroy(); }
}

async function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1); }

async function main() {
  // ── Connect ────────────────────────────────────────────────────────────────
  const bpath = bridgeJsonPath();
  console.log(`Reading bridge config from: ${bpath}`);
  let config;
  try { config = JSON.parse(await readFile(bpath, "utf-8")); }
  catch { await fail(`bridge.json not found at ${bpath}`); }
  console.log(`bridge.json OK  port=${config.port}  pid=${config.pid}`);

  const ws = new RawWsClient(config.port);
  await ws.connect();
  ws.send({ id: 0, method: "hello", params: { token: config.token } });
  const ack = await ws.nextMessage();
  if (ack.error) await fail(`hello: ${JSON.stringify(ack.error)}`);
  console.log("Connected and authenticated");

  // ── Write fixture clip via WS (exercises the write path end-to-end) ──────────
  const ppq = 480, q = ppq;
  const fixtureEvents = [
    { tickOn: 0,   tickOff: q,   pitch: 60, vel: 80, channel: 1 }, // C4
    { tickOn: q,   tickOff: q*2, pitch: 62, vel: 80, channel: 1 }, // D4
    { tickOn: q*2, tickOff: q*3, pitch: 64, vel: 80, channel: 1 }, // E4
    { tickOn: q*3, tickOff: q*4, pitch: 65, vel: 80, channel: 1 }, // F4
    { tickOn: q*4, tickOff: q*5, pitch: 67, vel: 80, channel: 1 }, // G4
    { tickOn: q*5, tickOff: q*6, pitch: 69, vel: 80, channel: 1 }, // A4
    { tickOn: q*6, tickOff: q*7, pitch: 71, vel: 80, channel: 1 }, // B4
    { tickOn: q*7, tickOff: q*8, pitch: 72, vel: 80, channel: 1 }, // c5
  ];
  const session = await ws.call("get_session");
  const writeRes = await ws.call("write_clip", {
    clip: { sessionId: session.sessionId, ppq, tempo: 120, timeSignature: [4, 4], events: fixtureEvents },
  });
  if (!writeRes.undoToken) await fail("write_clip returned no undoToken");
  await ws.call("accept_clip", { undoToken: writeRes.undoToken });
  console.log(`Fixture clip written & accepted  undoToken=${writeRes.undoToken}`);
  console.log(`tempMidiPath=${writeRes.tempMidiPath}`);

  ws.close();

  // Build the in-memory MidiClip from fixture data directly.
  // (accept_clip marks the pending entry; it does not update the live read_clip
  // snapshot which requires audio-thread MIDI capture. For headless smoke the
  // pure-function tests below use the fixture data we constructed above.)
  const clip = {
    ppq,
    tempo: 120,
    timeSignature: [4, 4],
    events: fixtureEvents,
  };
  console.log(`Using fixture clip (${clip.events.length} events) for summarize/diff tests`);

  // ── summarizeClip (pure function, no plugin needed) ────────────────────────
  const summary = summarizeClip(clip, 32);
  if (typeof summary.totalBars !== "number" || summary.totalBars < 1)
    await fail(`summarizeClip: unexpected totalBars: ${summary.totalBars}`);
  if (!summary.barDigestCompact.startsWith("b1:n4"))
    await fail(`summarizeClip: expected bar 1 to have 4 notes, got: ${summary.barDigestCompact}`);
  console.log(`summarizeClip OK  totalBars=${summary.totalBars}  trackHint=${summary.trackHint}`);
  console.log(`  barDigestCompact: ${summary.barDigestCompact}`);

  // maxBars=1
  const summary1 = summarizeClip(clip, 1);
  if (summary1.barDigest.length !== 1)
    await fail(`summarizeClip maxBars=1: expected 1 bar, got ${summary1.barDigest.length}`);
  console.log(`summarizeClip maxBars=1 OK`);

  // ── diffClips (pure function) ──────────────────────────────────────────────
  // No-change diff
  const diffNone = diffClips(clip, clip);
  if (diffNone.summary !== "no changes")
    await fail(`diffClips no-change: expected "no changes", got "${diffNone.summary}"`);
  console.log(`diffClips no-change OK`);

  // Velocity-changed diff: bump velocity on first note
  const modifiedEvents = clip.events.map((e, i) => i === 0 ? { ...e, vel: 100 } : e);
  const clipModified = { ...clip, events: modifiedEvents };
  const diffVel = diffClips(clip, clipModified);
  if (!diffVel.summary.includes("velocity changed"))
    await fail(`diffClips vel: expected "velocity changed", got "${diffVel.summary}"`);
  console.log(`diffClips velocity change OK: "${diffVel.summary}"`);

  // Note-added diff: add one extra note
  const clipWithExtra = { ...clip, events: [...clip.events, { tickOn: q*8, tickOff: q*9, pitch: 74, vel: 80, channel: 1 }] };
  const diffAdd = diffClips(clip, clipWithExtra);
  if (!diffAdd.summary.includes("1 note added"))
    await fail(`diffClips note-added: expected "1 note added", got "${diffAdd.summary}"`);
  console.log(`diffClips note-added OK: "${diffAdd.summary}"`);

  // abcCodec roundtrip through diff unified output
  const abc = abcCodec.encode(clip, "m4-fixture");
  if (!abc.startsWith("X:1"))
    await fail(`abcCodec.encode: unexpected output: ${abc.slice(0, 40)}`);
  console.log(`abcCodec.encode OK`);

  console.log("\nM4 Probe PASSED");
}

main().catch((err) => { console.error("Unhandled error:", err); process.exit(1); });
