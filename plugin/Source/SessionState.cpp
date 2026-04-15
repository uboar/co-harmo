#include "SessionState.h"

SessionState::SessionState()
{
    // Use JUCE's UUID for a random session ID.
    sessionId = juce::Uuid().toString();
}

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

    // Merge new events into the sequence.
    for (int i = 0; i < batch.getNumEvents(); ++i)
    {
        auto* e = batch.getEventPointer (i);
        clip_.events.addEvent (e->message);
    }
    clip_.events.updateMatchedPairs();
    clip_.events.sort();

    // Trim events older than maxBars.
    const double ppqPerBar    = 4.0 * clip_.ppq * (double)timeSigNum / (double)timeSigDen;
    const double windowPpq    = ppqPerBar * maxBars;

    double lastTick = 0.0;
    for (int i = clip_.events.getNumEvents() - 1; i >= 0; --i)
        lastTick = juce::jmax (lastTick, clip_.events.getEventPointer (i)->message.getTimeStamp());

    const double cutoff = lastTick - windowPpq;
    if (cutoff > 0.0)
    {
        for (int i = clip_.events.getNumEvents() - 1; i >= 0; --i)
            if (clip_.events.getEventPointer (i)->message.getTimeStamp() < cutoff)
                clip_.events.deleteEvent (i, true);
    }

    clip_.startPpq  = clipStartPpq;
    clip_.lengthPpq = lastTick - clipStartPpq;

    hasClip_ = true;
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
