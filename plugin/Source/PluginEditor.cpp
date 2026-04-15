#include "PluginEditor.h"

CoHarmoAudioProcessorEditor::CoHarmoAudioProcessorEditor (CoHarmoAudioProcessor& p)
    : AudioProcessorEditor (&p),
      webView (juce::WebBrowserComponent::Options{}
                   .withNativeIntegrationEnabled (true))
{
    addAndMakeVisible (webView);
    setSize (800, 600);

    auto indexFile = juce::File::getSpecialLocation (juce::File::currentExecutableFile)
                         .getParentDirectory()
                         .getChildFile ("Resources/web/index.html");

    if (indexFile.existsAsFile())
        webView.goToURL ("file://" + indexFile.getFullPathName());
    else
        webView.goToURL ("about:blank");
}

CoHarmoAudioProcessorEditor::~CoHarmoAudioProcessorEditor() {}

void CoHarmoAudioProcessorEditor::paint (juce::Graphics& g)
{
    g.fillAll (juce::Colour (0xff1a1a2e));
}

void CoHarmoAudioProcessorEditor::resized()
{
    webView.setBounds (getLocalBounds());
}
