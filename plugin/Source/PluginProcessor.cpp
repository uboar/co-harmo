#include "PluginProcessor.h"
#include "PluginEditor.h"
#if JUCE_WINDOWS
 #include <windows.h>
#else
 #include <unistd.h>
#endif

CoHarmoAudioProcessor::CoHarmoAudioProcessor()
    : AudioProcessor (BusesProperties()
                      .withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
                      .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      bridgeServer_ (sessionState_)
{
    bridgeServer_.start();
    writeBridgeJson();
}

CoHarmoAudioProcessor::~CoHarmoAudioProcessor()
{
    bridgeServer_.stop();
    deleteBridgeJson();
    sessionState_.cleanupTmpDir();
}

void CoHarmoAudioProcessor::prepareToPlay (double sampleRate, int)
{
    sessionState_.sampleRate = sampleRate;
}

void CoHarmoAudioProcessor::releaseResources() {}

void CoHarmoAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;
    buffer.clear();

    if (midi.isEmpty())
        return;

    // Gather playhead info (may be unavailable in some hosts).
    double bpm        = 120.0;
    int    timeSigNum = 4;
    int    timeSigDen = 4;
    double ppqPosition = 0.0;

    if (auto* ph = getPlayHead())
    {
        if (auto pos = ph->getPosition())
        {
            if (auto b = pos->getBpm())                      bpm        = *b;
            if (auto ts = pos->getTimeSignature()) { timeSigNum = ts->numerator; timeSigDen = ts->denominator; }
            if (auto p = pos->getPpqPosition())              ppqPosition = *p;
        }
    }

    const double samplesPerPpq = sessionState_.sampleRate / (bpm / 60.0 * 480.0);

    juce::MidiMessageSequence batch;
    for (auto meta : midi)
    {
        auto msg = meta.getMessage();
        // Convert sample offset to ppq tick (PPQ=480).
        double tick = ppqPosition * 480.0 + (double)meta.samplePosition / samplesPerPpq;
        msg.setTimeStamp (tick);
        batch.addEvent (msg);
    }
    batch.updateMatchedPairs();

    sessionState_.appendMidiEvents (batch, ppqPosition * 480.0, bpm, timeSigNum, timeSigDen);
}

juce::AudioProcessorEditor* CoHarmoAudioProcessor::createEditor()
{
    return new CoHarmoAudioProcessorEditor (*this);
}

void CoHarmoAudioProcessor::getStateInformation (juce::MemoryBlock&) {}
void CoHarmoAudioProcessor::setStateInformation (const void*, int) {}

// ── bridge.json ───────────────────────────────────────────────────────────────

static juce::File getBridgeJsonFile()
{
#if JUCE_MAC
    // userApplicationDataDirectory = ~/Library; spec requires ~/Library/Application Support
    auto base = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory)
                    .getChildFile ("Application Support");
#elif JUCE_WINDOWS
    auto base = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory); // %APPDATA%
#else
    auto base = juce::File::getSpecialLocation (juce::File::userHomeDirectory).getChildFile (".config");
#endif
    return base.getChildFile ("co-harmo/bridge.json");
}

void CoHarmoAudioProcessor::writeBridgeJson()
{
    auto file = getBridgeJsonFile();
    file.getParentDirectory().createDirectory();

    auto* obj = new juce::DynamicObject();
    obj->setProperty ("port",      bridgeServer_.getPort());
    obj->setProperty ("token",     bridgeServer_.getToken());
#if JUCE_WINDOWS
    obj->setProperty ("pid", (int)GetCurrentProcessId());
#else
    obj->setProperty ("pid", (int)getpid());
#endif
    obj->setProperty ("sessionId", sessionState_.sessionId);
    obj->setProperty ("startedAt", juce::Time::getCurrentTime().toISO8601 (true));

    file.replaceWithText (juce::JSON::toString (juce::var (obj)));
}

void CoHarmoAudioProcessor::deleteBridgeJson()
{
    getBridgeJsonFile().deleteFile();
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new CoHarmoAudioProcessor();
}
