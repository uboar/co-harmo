cmake_minimum_required(VERSION 3.22)
project(co-harmo VERSION 0.1.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# CPM bootstrap
file(
    DOWNLOAD
    "https://github.com/cpm-cmake/CPM.cmake/releases/download/v0.40.2/CPM.cmake"
    "${CMAKE_BINARY_DIR}/cmake/CPM.cmake"
    EXPECTED_HASH SHA256=c8cdc32c03816538ce22781ed72964dc864b2a34a310d3b7104812a5ca2d835d
)
include("${CMAKE_BINARY_DIR}/cmake/CPM.cmake")

CPMAddPackage(
    NAME JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        8.0.7
    GIT_SHALLOW    TRUE
)

juce_add_plugin(co-harmo
    COMPANY_NAME            "co-harmo"
    PLUGIN_MANUFACTURER_CODE Coha
    PLUGIN_CODE             Cohn
    FORMATS                 VST3 AU Standalone
    PRODUCT_NAME            "co-harmo"
    IS_SYNTH                FALSE
    NEEDS_MIDI_INPUT        TRUE
    NEEDS_MIDI_OUTPUT       TRUE
    IS_MIDI_EFFECT          FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS FALSE
    COPY_PLUGIN_AFTER_BUILD FALSE
    VST3_CATEGORIES         "Fx" "Tools"
    AU_MAIN_TYPE            kAudioUnitType_MusicEffect
)

target_sources(co-harmo
    PRIVATE
        Source/PluginProcessor.cpp
        Source/PluginEditor.cpp
        Source/SessionState.cpp
        Source/LocalBridgeServer.cpp
)

target_compile_definitions(co-harmo
    PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_USE_CURL=0
        JUCE_VST3_CAN_REPLACE_VST2=0
        JUCE_DISPLAY_SPLASH_SCREEN=0
)

target_link_libraries(co-harmo
    PRIVATE
        juce::juce_audio_utils
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags
)

juce_generate_juce_header(co-harmo)
