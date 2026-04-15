#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"

class CoHarmoAudioProcessorEditor : public juce::AudioProcessorEditor
{
public:
    explicit CoHarmoAudioProcessorEditor (CoHarmoAudioProcessor&);
    ~CoHarmoAudioProcessorEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;

private:
    CoHarmoAudioProcessor& processor_;
    juce::WebBrowserComponent webView;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (CoHarmoAudioProcessorEditor)
};
