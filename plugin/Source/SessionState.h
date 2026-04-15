#pragma once
#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_core/juce_core.h>
#include <mutex>
#include <vector>

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

struct PendingEntry
{
    juce::String              undoToken;
    juce::MidiMessageSequence events;
    int                       ppq         = 480;
    double                    bpm         = 120.0;
    int                       timeSigNum  = 4;
    int                       timeSigDen  = 4;
    juce::String              tempMidiPath;
    juce::String              createdAt;
    bool                      accepted    = false;
};

class SessionState
{
public:
    SessionState();

    // Audio-thread: appends captured MIDI events (rolling 32-bar window).
    void appendMidiEvents (const juce::MidiMessageSequence& batch,
                           double clipStartPpq,
                           double bpm,
                           int timeSigNum,
                           int timeSigDen,
                           int maxBars = 32);

    // Any thread — snapshot of the live captured clip.
    ClipData getClipSnapshot() const;
    bool hasClip() const;

    // Pending clip layer (M3).
    // Stages a new pending clip; writes a .mid to tmpDir/<undoToken>.mid.
    // Returns the undoToken, or empty string on failure.
    juce::String stagePending (const juce::MidiMessageSequence& events,
                               int ppq, double bpm, int timeSigNum, int timeSigDen);

    void acceptPending  (const juce::String& undoToken);
    void revertPending  (const juce::String& undoToken);

    // Returns snapshot list (safe to call from any thread).
    std::vector<PendingEntry> listPending() const;

    // Returns the tempMidiPath for a given token (empty if not found).
    juce::String getTempMidiPath (const juce::String& undoToken) const;

    // Deletes the whole tmp session directory (call from plugin destructor).
    void cleanupTmpDir();

    // Immutable session identity set at construction.
    juce::String sessionId;
    double sampleRate = 44100.0;

private:
    juce::File tmpDir() const;

    mutable std::mutex        mutex_;
    ClipData                  clip_;
    bool                      hasClip_  = false;
    std::vector<PendingEntry> pending_;
};
