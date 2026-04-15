#include "SessionState.h"
#include <juce_audio_formats/juce_audio_formats.h>

SessionState::SessionState()
{
    sessionId = juce::Uuid().toString();
}

// ── Captured clip ─────────────────────────────────────────────────────────────

void SessionState::appendMidiEvents (const juce::MidiMessageSequence& batch,
                                     double clipStartPpq,
                                     double bpm,
                                     int timeSigNum,
                                     int timeSigDen,
                                     int maxBars)
{
    if (batch.getNumEvents() == 0)
        return;

    std::lock_guard<std::mutex> lock (mutex_);

    clip_.bpm        = bpm;
    clip_.timeSigNum = timeSigNum;
    clip_.timeSigDen = timeSigDen;
    clip_.ppq        = 480;

    for (int i = 0; i < batch.getNumEvents(); ++i)
        clip_.events.addEvent (batch.getEventPointer (i)->message);

    clip_.events.updateMatchedPairs();
    clip_.events.sort();

    const double ppqPerBar = 4.0 * clip_.ppq * (double)timeSigNum / (double)timeSigDen;
    const double windowPpq = ppqPerBar * maxBars;

    double lastTick = 0.0;
    for (int i = clip_.events.getNumEvents() - 1; i >= 0; --i)
        lastTick = juce::jmax (lastTick, clip_.events.getEventPointer (i)->message.getTimeStamp());

    const double cutoff = lastTick - windowPpq;
    if (cutoff > 0.0)
        for (int i = clip_.events.getNumEvents() - 1; i >= 0; --i)
            if (clip_.events.getEventPointer (i)->message.getTimeStamp() < cutoff)
                clip_.events.deleteEvent (i, true);

    clip_.startPpq  = clipStartPpq;
    clip_.lengthPpq = lastTick - clipStartPpq;
    hasClip_        = true;
}

ClipData SessionState::getClipSnapshot() const
{
    std::lock_guard<std::mutex> lock (mutex_);
    return clip_;
}

bool SessionState::hasClip() const
{
    std::lock_guard<std::mutex> lock (mutex_);
    return hasClip_;
}

// ── Pending clip layer ────────────────────────────────────────────────────────

juce::File SessionState::tmpDir() const
{
    return juce::File::getSpecialLocation (juce::File::userHomeDirectory)
               .getChildFile (".co-harmo/tmp/" + sessionId);
}

static bool writeMidiFile (const juce::File& dest,
                           const juce::MidiMessageSequence& seq,
                           int ppq, double bpm)
{
    dest.getParentDirectory().createDirectory();

    // Prepend a tempo event at tick 0.
    juce::MidiMessageSequence track;
    track.addEvent (juce::MidiMessage::tempoMetaEvent (
        (int)(60000000.0 / bpm)), 0.0);
    for (int i = 0; i < seq.getNumEvents(); ++i)
        track.addEvent (seq.getEventPointer (i)->message);
    track.updateMatchedPairs();

    juce::MidiFile mf;
    mf.setTicksPerQuarterNote (ppq);
    mf.addTrack (track);

    juce::FileOutputStream fos (dest);
    if (! fos.openedOk()) return false;
    return mf.writeTo (fos);
}

juce::String SessionState::stagePending (const juce::MidiMessageSequence& events,
                                         int ppq, double bpm,
                                         int timeSigNum, int timeSigDen)
{
    juce::String token = juce::Uuid().toString().replace ("-", "");

    auto midiFile = tmpDir().getChildFile (token + ".mid");
    if (! writeMidiFile (midiFile, events, ppq, bpm))
        return {};

    PendingEntry entry;
    entry.undoToken    = token;
    entry.events       = events;
    entry.ppq          = ppq;
    entry.bpm          = bpm;
    entry.timeSigNum   = timeSigNum;
    entry.timeSigDen   = timeSigDen;
    entry.tempMidiPath = midiFile.getFullPathName();
    entry.createdAt    = juce::Time::getCurrentTime().toISO8601 (true);

    std::lock_guard<std::mutex> lock (mutex_);
    pending_.push_back (std::move (entry));
    return token;
}

void SessionState::acceptPending (const juce::String& undoToken)
{
    std::lock_guard<std::mutex> lock (mutex_);
    for (auto& e : pending_)
        if (e.undoToken == undoToken)
            e.accepted = true;
}

void SessionState::revertPending (const juce::String& undoToken)
{
    std::lock_guard<std::mutex> lock (mutex_);
    for (int i = (int)pending_.size() - 1; i >= 0; --i)
    {
        if (pending_[(size_t)i].undoToken == undoToken)
        {
            juce::File (pending_[(size_t)i].tempMidiPath).deleteFile();
            pending_.erase (pending_.begin() + i);
            return;
        }
    }
}

std::vector<PendingEntry> SessionState::listPending() const
{
    std::lock_guard<std::mutex> lock (mutex_);
    return pending_;
}

juce::String SessionState::getTempMidiPath (const juce::String& undoToken) const
{
    std::lock_guard<std::mutex> lock (mutex_);
    for (const auto& e : pending_)
        if (e.undoToken == undoToken)
            return e.tempMidiPath;
    return {};
}

void SessionState::cleanupTmpDir()
{
    tmpDir().deleteRecursively();
}
