#pragma once
#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_core/juce_core.h>
#include <mutex>

struct ClipData
{
    juce::MidiMessageSequence events;
    double startPpq    = 0.0;
    double lengthPpq   = 0.0;
    int    ppq         = 480;
    double bpm         = 120.0;
    int    timeSigNum  = 4;
    int    timeSigDen  = 4;
};

class SessionState
{
public:
    SessionState();

    // Called from audio thread — appends events captured in one processBlock call.
    // clipStartPpq: the ppq position of the first event in this batch.
    // maxBars: oldest events beyond this bar count are trimmed.
    void appendMidiEvents (const juce::MidiMessageSequence& batch,
                           double clipStartPpq,
                           double bpm,
                           int timeSigNum,
                           int timeSigDen,
                           int maxBars = 32);

    // Called from any thread — returns a snapshot copy.
    ClipData getClipSnapshot() const;

    bool hasClip() const;

    // Immutable session identity set at construction.
    juce::String sessionId;
    double sampleRate = 44100.0;

private:
    mutable std::mutex mutex_;
    ClipData           clip_;
    bool               hasClip_ = false;
};
