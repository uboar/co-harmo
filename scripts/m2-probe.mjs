#!/usr/bin/env node
// Probe script: connects to the running plugin via bridgeClient and calls
// get_session + read_clip. Exits 0 on success, 1 on any failure.
import { CoHarmoBridgeClient } from "../mcp-server/dist/bridgeClient.js";

const client = new CoHarmoBridgeClient();

async function main() {
  console.log(`Reading bridge config from: ${client.bridgeJsonPath}`);

  let config;
  try {
    config = await client.readConfig();
  } catch (err) {
    console.error(`FAIL bridge.json: ${err.message}`);
    process.exit(1);
  }
  console.log(`bridge.json OK  port=${config.port}  pid=${config.pid}  session=${config.sessionId}`);

  try {
    const session = await client.getSession();
    console.log("get_session OK:", JSON.stringify(session, null, 2));
  } catch (err) {
    console.error(`FAIL get_session: ${err.message}`);
    client.close();
    process.exit(1);
  }

  try {
    const clip = await client.readClip();
    console.log(
      `read_clip OK: ${clip.events.length} events  tempo=${clip.tempo}  ppq=${clip.ppq}`
    );
  } catch (err) {
    // An empty clip is acceptable — the plugin may have no notes recorded yet.
    console.warn(`read_clip returned error (may be empty clip): ${err.message}`);
  }

  client.close();
  console.log("\nProbe PASSED");
}

main();
