#include "PluginEditor.h"

CoHarmoAudioProcessorEditor::CoHarmoAudioProcessorEditor (CoHarmoAudioProcessor& p)
    : AudioProcessorEditor (&p),
      processor_ (p),
      webView (juce::WebBrowserComponent::Options{}
                   .withNativeIntegrationEnabled (true)
                   .withNativeFunction (
                       "startMidiDrag",
                       [this] (const juce::Array<juce::var>& args,
                               juce::WebBrowserComponent::NativeFunctionCompletion completion)
                       {
                           juce::String token = args.isEmpty() ? juce::String() : args[0].toString();
                           juce::String path  = processor_.getSessionState().getTempMidiPath (token);

                           if (path.isNotEmpty() && juce::File (path).existsAsFile())
                           {
                               juce::StringArray files;
                               files.add (path);
                               juce::DragAndDropContainer::performExternalDragDropOfFiles (files, false);
                               completion (juce::var (true));
                           }
                           else
                           {
                               completion (juce::var (false));
                           }
                       }))
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
