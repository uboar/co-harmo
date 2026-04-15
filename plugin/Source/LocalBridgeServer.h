#pragma once
#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>
#include "SessionState.h"

/**
 * Minimal RFC6455 WebSocket server (text frames only, single client, localhost).
 *
 * Hand-rolled on juce::StreamingSocket — no external WS dependency.
 * M2/M3 only needs text frames, single connection, no TLS, localhost only.
 *
 * ── Protocol (JSON, request/response, `id` echoed) ───────────────────────────
 *
 * Auth (must be first frame after handshake):
 *   → {"id":N,"method":"hello","params":{"token":"<from bridge.json>"}}
 *   ← {"id":N,"result":{}}
 *
 * M2 read:
 *   → {"id":N,"method":"get_session"}
 *   ← {"id":N,"result":{"sessionId","sampleRate","bpm","timeSignature":[n,d],
 *                        "ppq","hasClip","clipLengthBars"}}
 *
 *   → {"id":N,"method":"read_clip"}
 *   ← {"id":N,"result":{"sessionId","ppq","tempo","timeSignature",
 *                        "events":[{"tickOn","tickOff","pitch","vel","channel"}]}}
 *
 * M3 write:
 *   → {"id":N,"method":"write_clip",
 *      "params":{"clip":{"ppq","tempo","timeSignature":[n,d],
 *                        "events":[{"tickOn","tickOff","pitch","vel","channel"}]},
 *                "replaceRange":{"startBar":0,"endBar":4}}}   // replaceRange optional
 *   ← {"id":N,"result":{"undoToken","tempMidiPath"}}
 *
 *   → {"id":N,"method":"accept_clip","params":{"undoToken":"..."}}
 *   ← {"id":N,"result":{}}
 *
 *   → {"id":N,"method":"revert_clip","params":{"undoToken":"..."}}
 *   ← {"id":N,"result":{}}
 *
 *   → {"id":N,"method":"list_pending"}
 *   ← {"id":N,"result":{"pending":[{"undoToken","eventCount","tempMidiPath","createdAt","accepted"}]}}
 */
class LocalBridgeServer : private juce::Thread
{
public:
    explicit LocalBridgeServer (SessionState& state);
    ~LocalBridgeServer() override;

    void start();
    void stop();

    int          getPort()  const { return port_; }
    juce::String getToken() const { return token_; }

private:
    void run() override;
    void serveClient (juce::StreamingSocket& client);
    bool doHandshake (juce::StreamingSocket& client);
    bool sendTextFrame (juce::StreamingSocket& client, const juce::String& text);
    juce::String readTextFrame (juce::StreamingSocket& client);
    juce::String handleRequest (const juce::String& json, bool& authed);
    juce::String buildError  (const juce::var& id, int code, const juce::String& msg);
    juce::String buildResult (const juce::var& id, const juce::var& result);

    SessionState& state_;
    int           port_  = 0;
    juce::String  token_;

    std::unique_ptr<juce::StreamingSocket> serverSocket_;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (LocalBridgeServer)
};
