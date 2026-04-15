#pragma once
#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>
#include "SessionState.h"

/**
 * Minimal RFC6455 WebSocket server (text frames only, single client, localhost).
 *
 * We implement RFC6455 manually on top of juce::StreamingSocket rather than
 * pulling in a heavy dependency (uWebSockets/websocketpp). M2 only needs
 * unmasked text frames, single connection, no TLS — the hand-rolled path is
 * ~200 lines and avoids CMake complexity on both Mac and Windows.
 */
class LocalBridgeServer : private juce::Thread
{
public:
    explicit LocalBridgeServer (SessionState& state);
    ~LocalBridgeServer() override;

    void start();
    void stop();

    int  getPort()  const { return port_; }
    juce::String getToken() const { return token_; }

private:
    // juce::Thread
    void run() override;

    // Handshake + frame loop for one accepted client.
    void serveClient (juce::StreamingSocket& client);

    // HTTP upgrade handshake.
    bool doHandshake (juce::StreamingSocket& client);

    // Frame I/O.
    bool sendTextFrame (juce::StreamingSocket& client, const juce::String& text);
    juce::String readTextFrame (juce::StreamingSocket& client);

    // Request dispatch.
    juce::String handleRequest (const juce::String& json, bool& authed);

    // Helpers.
    juce::String buildError (const juce::var& id, int code, const juce::String& msg);
    juce::String buildResult (const juce::var& id, const juce::var& result);

    SessionState& state_;
    int  port_  = 0;
    juce::String token_;

    std::unique_ptr<juce::StreamingSocket> serverSocket_;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (LocalBridgeServer)
};
