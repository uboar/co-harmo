#include "PluginProcessor.h"
#include "PluginEditor.h"

CoHarmoAudioProcessor::CoHarmoAudioProcessor()
    : AudioProcessor (BusesProperties()
                      .withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
                      .withOutput ("Output", juce::AudioChannelSet::stereo(), true))
{
}

CoHarmoAudioProcessor::~CoHarmoAudioProcessor() {}

void CoHarmoAudioProcessor::prepareToPlay (double, int) {}
void CoHarmoAudioProcessor::releaseResources() {}

void CoHarmoAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    buffer.clear();
}

juce::AudioProcessorEditor* CoHarmoAudioProcessor::createEditor()
{
    return new CoHarmoAudioProcessorEditor (*this);
}

void CoHarmoAudioProcessor::getStateInformation (juce::MemoryBlock&) {}
void CoHarmoAudioProcessor::setStateInformation (const void*, int) {}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new CoHarmoAudioProcessor();
}
