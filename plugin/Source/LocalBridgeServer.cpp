#include "LocalBridgeServer.h"

// ── helpers ──────────────────────────────────────────────────────────────────

static juce::String generateToken()
{
    juce::Random rng (juce::Time::currentTimeMillis());
    juce::String t;
    const char* hex = "0123456789abcdef";
    for (int i = 0; i < 32; ++i)
        t += hex[rng.nextInt (16)];
    return t;
}

// Base64 from raw bytes (used for WS handshake accept key).
static juce::String base64Encode (const juce::MemoryBlock& data)
{
    return juce::Base64::toBase64 (data.getData(), data.getSize());
}

// SHA-1 of a string → raw bytes.
static juce::MemoryBlock sha1 (const juce::String& input)
{
    // JUCE doesn't expose SHA-1; self-contained implementation for the WS handshake accept key.
    const uint8_t* msg = reinterpret_cast<const uint8_t*> (input.toRawUTF8());
    size_t len = (size_t)input.getNumBytesAsUTF8();

    uint32_t h0 = 0x67452301u, h1 = 0xEFCDAB89u, h2 = 0x98BADCFEu,
             h3 = 0x10325476u, h4 = 0xC3D2E1F0u;

    auto rotl32 = [](uint32_t x, int n) -> uint32_t {
        return (x << n) | (x >> (32 - n));
    };

    size_t padded = ((len + 9 + 63) / 64) * 64;
    juce::MemoryBlock buf (padded, true);
    ::memcpy (buf.getData(), msg, len);
    ((uint8_t*)buf.getData())[len] = 0x80;
    uint64_t bitLen = (uint64_t)len * 8;
    for (int i = 7; i >= 0; --i)
        ((uint8_t*)buf.getData())[padded - 8 + (size_t)(7 - i)] = (uint8_t)(bitLen >> (i * 8));

    for (size_t offset = 0; offset < padded; offset += 64)
    {
        const uint8_t* block = (const uint8_t*)buf.getData() + offset;
        uint32_t w[80];
        for (int i = 0; i < 16; ++i)
            w[i] = ((uint32_t)block[i*4] << 24) | ((uint32_t)block[i*4+1] << 16)
                 | ((uint32_t)block[i*4+2] << 8) | block[i*4+3];
        for (int i = 16; i < 80; ++i)
            w[i] = rotl32 (w[i-3] ^ w[i-8] ^ w[i-14] ^ w[i-16], 1);

        uint32_t a = h0, b = h1, c = h2, d = h3, e = h4;
        for (int i = 0; i < 80; ++i)
        {
            uint32_t f, k;
            if (i < 20)  { f = (b & c) | (~b & d); k = 0x5A827999u; }
            else if (i < 40) { f = b ^ c ^ d;         k = 0x6ED9EBA1u; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDCu; }
            else             { f = b ^ c ^ d;         k = 0xCA62C1D6u; }
            uint32_t temp = rotl32 (a, 5) + f + e + k + w[i];
            e = d; d = c; c = rotl32 (b, 30); b = a; a = temp;
        }
        h0 += a; h1 += b; h2 += c; h3 += d; h4 += e;
    }

    juce::MemoryBlock result (20, false);
    uint32_t digest[5] = { h0, h1, h2, h3, h4 };
    for (int i = 0; i < 5; ++i)
        for (int j = 3; j >= 0; --j)
            ((uint8_t*)result.getData())[i*4 + (3-j)] = (uint8_t)(digest[i] >> (j*8));
    return result;
}

// ── LocalBridgeServer ─────────────────────────────────────────────────────────

LocalBridgeServer::LocalBridgeServer (SessionState& state)
    : juce::Thread ("co-harmo-ws"), state_ (state)
{
    token_ = generateToken();
}

LocalBridgeServer::~LocalBridgeServer()
{
    stop();
}

void LocalBridgeServer::start()
{
    serverSocket_ = std::make_unique<juce::StreamingSocket>();
    // Bind to ephemeral port on loopback.
    if (! serverSocket_->createListener (0, "127.0.0.1"))
    {
        jassertfalse;
        return;
    }
    port_ = serverSocket_->getBoundPort();
    startThread();
}

void LocalBridgeServer::stop()
{
    signalThreadShouldExit();
    if (serverSocket_)
        serverSocket_->close();
    stopThread (2000);
    serverSocket_.reset();
}

void LocalBridgeServer::run()
{
    while (! threadShouldExit())
    {
        // waitForNextConnection blocks until a client arrives or the socket closes.
        auto* raw = serverSocket_->waitForNextConnection();
        if (raw == nullptr)
            break;
        std::unique_ptr<juce::StreamingSocket> client (raw);
        serveClient (*client);
    }
}

void LocalBridgeServer::serveClient (juce::StreamingSocket& client)
{
    if (! doHandshake (client))
        return;

    bool authed = false;

    while (! threadShouldExit() && client.isConnected())
    {
        juce::String frame = readTextFrame (client);
        if (frame.isEmpty())
            break;

        juce::String response = handleRequest (frame, authed);
        if (response.isNotEmpty())
            if (! sendTextFrame (client, response))
                break;
    }
}

// ── HTTP Upgrade handshake ────────────────────────────────────────────────────

bool LocalBridgeServer::doHandshake (juce::StreamingSocket& client)
{
    // Read the HTTP request (up to 4096 bytes).
    juce::MemoryBlock buf (4096, true);
    int total = 0;
    while (total < (int)buf.getSize())
    {
        int n = client.read ((char*)buf.getData() + total, 1, true);
        if (n <= 0) return false;
        total += n;
        // Look for end of headers.
        juce::String so_far = juce::String::fromUTF8 ((char*)buf.getData(), total);
        if (so_far.contains ("\r\n\r\n")) break;
    }

    juce::String request = juce::String::fromUTF8 ((char*)buf.getData(), total);

    // Extract Sec-WebSocket-Key.
    juce::String key;
    for (auto& line : juce::StringArray::fromLines (request))
    {
        if (line.startsWithIgnoreCase ("Sec-WebSocket-Key:"))
        {
            key = line.fromFirstOccurrenceOf (":", false, false).trim();
            break;
        }
    }
    if (key.isEmpty()) return false;

    // Compute accept key: base64(sha1(key + magic))
    juce::String magic     = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    juce::MemoryBlock hash = sha1 (key + magic);
    juce::String accept    = base64Encode (hash);

    juce::String response =
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Accept: " + accept + "\r\n"
        "\r\n";

    const char* r = response.toRawUTF8();
    return client.write (r, (int)strlen (r)) > 0;
}

// ── RFC6455 frame I/O ─────────────────────────────────────────────────────────

bool LocalBridgeServer::sendTextFrame (juce::StreamingSocket& client, const juce::String& text)
{
    const char* payload = text.toRawUTF8();
    size_t len = strlen (payload);

    juce::MemoryBlock frame;
    // FIN + opcode 0x1 (text)
    frame.append ("\x81", 1);

    if (len <= 125)
    {
        uint8_t b = (uint8_t)len;
        frame.append (&b, 1);
    }
    else if (len <= 65535)
    {
        uint8_t b = 126;
        frame.append (&b, 1);
        uint8_t ext[2] = { (uint8_t)(len >> 8), (uint8_t)(len & 0xff) };
        frame.append (ext, 2);
    }
    else
    {
        uint8_t b = 127;
        frame.append (&b, 1);
        uint8_t ext[8] = {};
        for (int i = 7; i >= 0; --i) ext[7-i] = (uint8_t)((len >> (i*8)) & 0xff);
        frame.append (ext, 8);
    }
    frame.append (payload, len);

    return client.write ((const char*)frame.getData(), (int)frame.getSize()) > 0;
}

juce::String LocalBridgeServer::readTextFrame (juce::StreamingSocket& client)
{
    auto readExact = [&](void* dst, int n) -> bool {
        int got = 0;
        while (got < n)
        {
            int r = client.read ((char*)dst + got, n - got, true);
            if (r <= 0) return false;
            got += r;
        }
        return true;
    };

    uint8_t header[2];
    if (! readExact (header, 2)) return {};

    // bool fin    = (header[0] & 0x80) != 0;
    int  opcode = header[0] & 0x0f;
    bool masked = (header[1] & 0x80) != 0;
    uint64_t payloadLen = header[1] & 0x7f;

    if (opcode == 8) return {};  // close frame

    if (payloadLen == 126)
    {
        uint8_t ext[2];
        if (! readExact (ext, 2)) return {};
        payloadLen = ((uint64_t)ext[0] << 8) | ext[1];
    }
    else if (payloadLen == 127)
    {
        uint8_t ext[8];
        if (! readExact (ext, 8)) return {};
        payloadLen = 0;
        for (int i = 0; i < 8; ++i) payloadLen = (payloadLen << 8) | ext[i];
    }

    uint8_t maskKey[4] = {};
    if (masked)
        if (! readExact (maskKey, 4)) return {};

    if (payloadLen > 1024 * 1024) return {};  // sanity limit

    juce::MemoryBlock payload ((size_t)payloadLen, false);
    if (! readExact (payload.getData(), (int)payloadLen)) return {};

    if (masked)
        for (size_t i = 0; i < payloadLen; ++i)
            ((uint8_t*)payload.getData())[i] ^= maskKey[i % 4];

    return juce::String::fromUTF8 ((const char*)payload.getData(), (int)payloadLen);
}

// ── Request dispatch ──────────────────────────────────────────────────────────

juce::String LocalBridgeServer::handleRequest (const juce::String& json, bool& authed)
{
    juce::var parsed;
    if (juce::JSON::parse (json, parsed).failed())
        return buildError (juce::var(), -32700, "Parse error");

    auto id     = parsed["id"];
    auto method = parsed["method"].toString();
    auto params = parsed["params"];

    if (! authed)
    {
        if (method != "hello")
            return buildError (id, -32001, "Not authenticated");

        juce::String clientToken = params["token"].toString();
        if (clientToken != token_)
            return buildError (id, -32001, "Invalid token");

        authed = true;
        return buildResult (id, juce::var (new juce::DynamicObject()));
    }

    if (method == "get_session")
    {
        auto* obj = new juce::DynamicObject();
        obj->setProperty ("sessionId",   state_.sessionId);
        obj->setProperty ("sampleRate",  state_.sampleRate);

        ClipData clip = state_.getClipSnapshot();
        obj->setProperty ("bpm",         clip.bpm);

        juce::Array<juce::var> ts;
        ts.add (clip.timeSigNum);
        ts.add (clip.timeSigDen);
        obj->setProperty ("timeSignature", ts);

        obj->setProperty ("ppq",          clip.ppq);
        obj->setProperty ("hasClip",      state_.hasClip());

        double ppqPerBar = 4.0 * clip.ppq * (double)clip.timeSigNum / (double)clip.timeSigDen;
        double bars      = ppqPerBar > 0 ? clip.lengthPpq / ppqPerBar : 0.0;
        obj->setProperty ("clipLengthBars", bars);

        return buildResult (id, juce::var (obj));
    }

    if (method == "read_clip")
    {
        ClipData clip = state_.getClipSnapshot();

        auto* obj = new juce::DynamicObject();
        obj->setProperty ("sessionId",     state_.sessionId);
        obj->setProperty ("ppq",           clip.ppq);
        obj->setProperty ("tempo",         clip.bpm);

        juce::Array<juce::var> ts;
        ts.add (clip.timeSigNum);
        ts.add (clip.timeSigDen);
        obj->setProperty ("timeSignature", ts);

        juce::Array<juce::var> events;
        auto& seq = clip.events;
        for (int i = 0; i < seq.getNumEvents(); ++i)
        {
            auto* ev = seq.getEventPointer (i);
            auto& msg = ev->message;
            if (! msg.isNoteOn()) continue;

            auto* noteObj = new juce::DynamicObject();
            noteObj->setProperty ("tickOn",   (int)msg.getTimeStamp());
            noteObj->setProperty ("pitch",    msg.getNoteNumber());
            noteObj->setProperty ("vel",      msg.getVelocity());
            noteObj->setProperty ("channel",  msg.getChannel());

            // Find matching note-off.
            int tickOff = (int)msg.getTimeStamp();
            if (auto* off = seq.getEventPointer (i)->noteOffObject)
                tickOff = (int)off->message.getTimeStamp();
            noteObj->setProperty ("tickOff", tickOff);

            events.add (juce::var (noteObj));
        }
        obj->setProperty ("events", events);

        return buildResult (id, juce::var (obj));
    }

    return buildError (id, -32601, "Method not found: " + method);
}

juce::String LocalBridgeServer::buildError (const juce::var& id, int code, const juce::String& msg)
{
    auto* obj = new juce::DynamicObject();
    obj->setProperty ("id", id);
    auto* err = new juce::DynamicObject();
    err->setProperty ("code",    code);
    err->setProperty ("message", msg);
    obj->setProperty ("error", juce::var (err));
    return juce::JSON::toString (juce::var (obj), true);
}

juce::String LocalBridgeServer::buildResult (const juce::var& id, const juce::var& result)
{
    auto* obj = new juce::DynamicObject();
    obj->setProperty ("id",     id);
    obj->setProperty ("result", result);
    return juce::JSON::toString (juce::var (obj), true);
}
