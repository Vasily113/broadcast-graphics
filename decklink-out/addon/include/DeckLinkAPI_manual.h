// DeckLinkAPI_manual.h
// Manual C++ translation of the DeckLink SDK 16.0 Windows interfaces.
// Only the interfaces used by decklink.cpp are defined here.
//
// SDK 16.0 BREAKING CHANGE vs v14_2_1:
//   GetBytes() was REMOVED from IDeckLinkVideoFrame and moved to a new
//   interface IDeckLinkVideoBuffer (GUID 81F03D70).
//   User-implemented frames must now implement BOTH interfaces.
#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#  define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#  define NOMINMAX
#endif
#include <windows.h>
#include <unknwn.h>
#include <cstdint>

// ---------------------------------------------------------------------------
// Scalar type aliases
// ---------------------------------------------------------------------------
typedef int64_t  BMDTimeValue;
typedef int64_t  BMDTimeScale;
typedef uint32_t BMDDisplayMode;
typedef uint32_t BMDPixelFormat;
typedef uint32_t BMDFrameFlags;
typedef uint32_t BMDTimecodeFormat;
typedef uint32_t BMDVideoConnection;
typedef uint32_t BMDVideoOutputFlags;
typedef uint32_t BMDVideoOutputConversionMode;
typedef uint32_t BMDSupportedVideoModeFlags;
typedef uint32_t BMDBufferAccessFlags;
typedef uint32_t BMDReferenceStatus;
typedef uint32_t BMDAudioSampleRate;
typedef uint32_t BMDAudioSampleType;
typedef uint32_t BMDAudioOutputStreamType;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------
typedef enum _BMDOutputFrameCompletionResult {
    bmdOutputFrameCompleted     = 0,
    bmdOutputFrameDisplayedLate = 1,
    bmdOutputFrameDropped       = 2,
    bmdOutputFrameFlushed       = 3
} BMDOutputFrameCompletionResult;

// ---------------------------------------------------------------------------
// Constants used by decklink.cpp
// (from DeckLinkAPIModes.idl and DeckLinkAPI.idl)
// ---------------------------------------------------------------------------
static const BMDDisplayMode              bmdModeHD1080p50              = 0x48703530u; // 'Hp50'
static const BMDPixelFormat              bmdFormat8BitARGB             = 32u;
static const BMDPixelFormat              bmdFormat8BitBGRA             = 0x42475241u; // 'BGRA'
static const BMDVideoOutputFlags         bmdVideoOutputFlagDefault     = 0u;
static const BMDFrameFlags               bmdFrameFlagDefault           = 0u;
static const BMDVideoConnection          bmdVideoConnectionUnspecified = 0u;
static const BMDVideoOutputConversionMode bmdNoVideoOutputConversion   = 0x6E6F6E65u; // 'none'
static const BMDSupportedVideoModeFlags  bmdSupportedVideoModeDefault  = 0u;
static const BMDBufferAccessFlags        bmdBufferAccessReadAndWrite   = 3u;
static const BMDBufferAccessFlags        bmdBufferAccessRead           = 1u;
static const BMDBufferAccessFlags        bmdBufferAccessWrite          = 2u;

// ---------------------------------------------------------------------------
// Helper macro: declares an interface with a __uuidof-compatible GUID
// ---------------------------------------------------------------------------
#define DL_IFACE(guid_str) \
    struct __declspec(uuid(guid_str)) __declspec(novtable)

// ---------------------------------------------------------------------------
// Forward declarations
// ---------------------------------------------------------------------------
DL_IFACE("50FB36CD-3063-4B73-BDBB-958087F2D8BA") IDeckLinkIterator;
DL_IFACE("C418FBDD-0587-48ED-8FE5-640F0A14AF91") IDeckLink;
DL_IFACE("5F227C95-39D7-46C7-8B7D-9C81795FBBE4") IDeckLinkOutput;
DL_IFACE("89AFCAF5-65F8-421E-98F7-96FE5F5BFBA3") IDeckLinkKeyer;
DL_IFACE("81F03D70-DE13-4B17-873A-C8AC9689C682") IDeckLinkVideoBuffer;
DL_IFACE("6502091C-615F-4F51-BAF6-45C4256DD5B0") IDeckLinkVideoFrame;
DL_IFACE("CF9EB134-0374-4C5B-95FA-1EC14819FF62") IDeckLinkMutableVideoFrame;
DL_IFACE("5BE6DF26-02CE-433E-99D9-9A87C3AC171F") IDeckLinkVideoOutputCallback;

// Opaque interfaces (only used as pointers, never called)
struct IDeckLinkDisplayMode;
struct IDeckLinkDisplayModeIterator;
struct IDeckLinkTimecode;
struct IDeckLinkVideoFrameAncillary;
struct IDeckLinkScreenPreviewCallback;
struct IDeckLinkAudioOutputCallback;

// ---------------------------------------------------------------------------
// IDeckLinkVideoBuffer  (SDK 16.0 — NEW interface for pixel buffer access)
// GUID: 81F03D70-DE13-4B17-873A-C8AC9689C682
// Source: DeckLinkAPI.idl lines 1189-1195
// ---------------------------------------------------------------------------
DL_IFACE("81F03D70-DE13-4B17-873A-C8AC9689C682")
IDeckLinkVideoBuffer : public IUnknown
{
    virtual HRESULT STDMETHODCALLTYPE GetBytes(void** buffer) = 0;
    virtual HRESULT STDMETHODCALLTYPE GetSize(ULONGLONG* size) = 0;
    virtual HRESULT STDMETHODCALLTYPE StartAccess(BMDBufferAccessFlags flags) = 0;
    virtual HRESULT STDMETHODCALLTYPE EndAccess(BMDBufferAccessFlags flags) = 0;
};

// ---------------------------------------------------------------------------
// IDeckLinkVideoFrame  (SDK 16.0 — NO GetBytes here; moved to IDeckLinkVideoBuffer)
// GUID: 6502091C-615F-4F51-BAF6-45C4256DD5B0
// Vtable: GetWidth, GetHeight, GetRowBytes, GetPixelFormat, GetFlags,
//         GetTimecode, GetAncillaryData   (7 methods, per DeckLinkAPI.idl lines 1204-1213)
// ---------------------------------------------------------------------------
DL_IFACE("6502091C-615F-4F51-BAF6-45C4256DD5B0")
IDeckLinkVideoFrame : public IUnknown
{
    virtual long           STDMETHODCALLTYPE GetWidth()       = 0;
    virtual long           STDMETHODCALLTYPE GetHeight()      = 0;
    virtual long           STDMETHODCALLTYPE GetRowBytes()    = 0;
    virtual BMDPixelFormat STDMETHODCALLTYPE GetPixelFormat() = 0;
    virtual BMDFrameFlags  STDMETHODCALLTYPE GetFlags()       = 0;
    virtual HRESULT        STDMETHODCALLTYPE GetTimecode(BMDTimecodeFormat format,
                                                         IDeckLinkTimecode** timecode) = 0;
    virtual HRESULT        STDMETHODCALLTYPE GetAncillaryData(IDeckLinkVideoFrameAncillary** ancillary) = 0;
};

// ---------------------------------------------------------------------------
// IDeckLinkMutableVideoFrame  (created by IDeckLinkOutput::CreateVideoFrame)
// GUID: CF9EB134-0374-4C5B-95FA-1EC14819FF62
// ---------------------------------------------------------------------------
DL_IFACE("CF9EB134-0374-4C5B-95FA-1EC14819FF62")
IDeckLinkMutableVideoFrame : public IDeckLinkVideoFrame
{
    virtual HRESULT STDMETHODCALLTYPE SetFlags(BMDFrameFlags newFlags) = 0;
    virtual HRESULT STDMETHODCALLTYPE SetTimecode(BMDTimecodeFormat format,
                                                   IDeckLinkTimecode* timecode) = 0;
    virtual HRESULT STDMETHODCALLTYPE SetTimecodeFromComponents(BMDTimecodeFormat format,
                                                                 unsigned char hours,
                                                                 unsigned char minutes,
                                                                 unsigned char seconds,
                                                                 unsigned char frames,
                                                                 uint32_t      flagsBMD) = 0;
    virtual HRESULT STDMETHODCALLTYPE SetAncillaryData(IDeckLinkVideoFrameAncillary* ancillary) = 0;
    virtual HRESULT STDMETHODCALLTYPE SetTimecodeUserBits(BMDTimecodeFormat format,
                                                           uint32_t userBits) = 0;
    virtual HRESULT STDMETHODCALLTYPE SetInterfaceProvider(REFIID iid, IUnknown* iface) = 0;
};

// ---------------------------------------------------------------------------
// IDeckLinkVideoOutputCallback
// GUID: 5BE6DF26-02CE-433E-99D9-9A87C3AC171F
// ---------------------------------------------------------------------------
DL_IFACE("5BE6DF26-02CE-433E-99D9-9A87C3AC171F")
IDeckLinkVideoOutputCallback : public IUnknown
{
    virtual HRESULT STDMETHODCALLTYPE ScheduledFrameCompleted(
        IDeckLinkVideoFrame* completedFrame,
        BMDOutputFrameCompletionResult result) = 0;
    virtual HRESULT STDMETHODCALLTYPE ScheduledPlaybackHasStopped() = 0;
};

// ---------------------------------------------------------------------------
// IDeckLink  (represents one DeckLink device)
// GUID: C418FBDD-0587-48ED-8FE5-640F0A14AF91
// ---------------------------------------------------------------------------
DL_IFACE("C418FBDD-0587-48ED-8FE5-640F0A14AF91")
IDeckLink : public IUnknown
{
    virtual HRESULT STDMETHODCALLTYPE GetModelName(BSTR* modelName) = 0;
    virtual HRESULT STDMETHODCALLTYPE GetDisplayName(BSTR* displayName) = 0;
};

// ---------------------------------------------------------------------------
// IDeckLinkIterator
// GUID: 50FB36CD-3063-4B73-BDBB-958087F2D8BA
// ---------------------------------------------------------------------------
DL_IFACE("50FB36CD-3063-4B73-BDBB-958087F2D8BA")
IDeckLinkIterator : public IUnknown
{
    virtual HRESULT STDMETHODCALLTYPE Next(IDeckLink** deckLinkInstance) = 0;
};

// ---------------------------------------------------------------------------
// IDeckLinkOutput  (SDK 16.0)
// GUID: 5F227C95-39D7-46C7-8B7D-9C81795FBBE4
// Full vtable from DeckLinkAPI.idl lines 1035-1079
// ---------------------------------------------------------------------------
DL_IFACE("5F227C95-39D7-46C7-8B7D-9C81795FBBE4")
IDeckLinkOutput : public IUnknown
{
    // Display mode support
    virtual HRESULT STDMETHODCALLTYPE DoesSupportVideoMode(
        BMDVideoConnection          connection,
        BMDDisplayMode              requestedMode,
        BMDPixelFormat              requestedPixelFormat,
        BMDVideoOutputConversionMode conversionMode,
        BMDSupportedVideoModeFlags  flags,
        BMDDisplayMode*             actualMode,
        BOOL*                       supported) = 0;
    virtual HRESULT STDMETHODCALLTYPE GetDisplayMode(
        BMDDisplayMode displayMode, IDeckLinkDisplayMode** resultDisplayMode) = 0;
    virtual HRESULT STDMETHODCALLTYPE GetDisplayModeIterator(
        IDeckLinkDisplayModeIterator** iterator) = 0;
    virtual HRESULT STDMETHODCALLTYPE SetScreenPreviewCallback(
        IDeckLinkScreenPreviewCallback* previewCallback) = 0;

    // Video output
    virtual HRESULT STDMETHODCALLTYPE EnableVideoOutput(
        BMDDisplayMode displayMode, BMDVideoOutputFlags flags) = 0;
    virtual HRESULT STDMETHODCALLTYPE DisableVideoOutput() = 0;
    virtual HRESULT STDMETHODCALLTYPE CreateVideoFrame(
        int width, int height, int rowBytes,
        BMDPixelFormat pixelFormat, BMDFrameFlags flags,
        IDeckLinkMutableVideoFrame** outFrame) = 0;
    virtual HRESULT STDMETHODCALLTYPE CreateVideoFrameWithBuffer(
        int width, int height, int rowBytes,
        BMDPixelFormat pixelFormat, BMDFrameFlags flags,
        IDeckLinkVideoBuffer* buffer,
        IDeckLinkMutableVideoFrame** outFrame) = 0;
    virtual HRESULT STDMETHODCALLTYPE RowBytesForPixelFormat(
        BMDPixelFormat pixelFormat, int width, int* rowBytes) = 0;
    virtual HRESULT STDMETHODCALLTYPE CreateAncillaryData(
        BMDPixelFormat pixelFormat, IDeckLinkVideoFrameAncillary** outBuffer) = 0;
    virtual HRESULT STDMETHODCALLTYPE DisplayVideoFrameSync(
        IDeckLinkVideoFrame* theFrame) = 0;
    virtual HRESULT STDMETHODCALLTYPE ScheduleVideoFrame(
        IDeckLinkVideoFrame* theFrame,
        BMDTimeValue displayTime, BMDTimeValue displayDuration,
        BMDTimeScale timeScale) = 0;
    virtual HRESULT STDMETHODCALLTYPE SetScheduledFrameCompletionCallback(
        IDeckLinkVideoOutputCallback* theCallback) = 0;
    virtual HRESULT STDMETHODCALLTYPE GetBufferedVideoFrameCount(
        unsigned int* bufferedFrameCount) = 0;

    // Audio output
    virtual HRESULT STDMETHODCALLTYPE EnableAudioOutput(
        BMDAudioSampleRate sampleRate, BMDAudioSampleType sampleType,
        unsigned int channelCount, BMDAudioOutputStreamType streamType) = 0;
    virtual HRESULT STDMETHODCALLTYPE DisableAudioOutput() = 0;
    virtual HRESULT STDMETHODCALLTYPE WriteAudioSamplesSync(
        void* buffer, unsigned int sampleFrameCount,
        unsigned int* sampleFramesWritten) = 0;
    virtual HRESULT STDMETHODCALLTYPE BeginAudioPreroll() = 0;
    virtual HRESULT STDMETHODCALLTYPE EndAudioPreroll() = 0;
    virtual HRESULT STDMETHODCALLTYPE ScheduleAudioSamples(
        void* buffer, unsigned int sampleFrameCount,
        BMDTimeValue streamTime, BMDTimeScale timeScale,
        unsigned int* sampleFramesWritten) = 0;
    virtual HRESULT STDMETHODCALLTYPE GetBufferedAudioSampleFrameCount(
        unsigned int* bufferedSampleFrameCount) = 0;
    virtual HRESULT STDMETHODCALLTYPE FlushBufferedAudioSamples() = 0;
    virtual HRESULT STDMETHODCALLTYPE SetAudioCallback(
        IDeckLinkAudioOutputCallback* theCallback) = 0;

    // Output control
    virtual HRESULT STDMETHODCALLTYPE StartScheduledPlayback(
        BMDTimeValue playbackStartTime, BMDTimeScale timeScale,
        double playbackSpeed) = 0;
    virtual HRESULT STDMETHODCALLTYPE StopScheduledPlayback(
        BMDTimeValue stopPlaybackAtTime, BMDTimeValue* actualStopTime,
        BMDTimeScale timeScale) = 0;
    virtual HRESULT STDMETHODCALLTYPE IsScheduledPlaybackRunning(BOOL* active) = 0;
    virtual HRESULT STDMETHODCALLTYPE GetScheduledStreamTime(
        BMDTimeScale desiredTimeScale, BMDTimeValue* streamTime,
        double* playbackSpeed) = 0;
    virtual HRESULT STDMETHODCALLTYPE GetReferenceStatus(
        BMDReferenceStatus* referenceStatus) = 0;

    // Hardware timing
    virtual HRESULT STDMETHODCALLTYPE GetHardwareReferenceClock(
        BMDTimeScale desiredTimeScale,
        BMDTimeValue* hardwareTime,
        BMDTimeValue* timeInFrame,
        BMDTimeValue* ticksPerFrame) = 0;
    virtual HRESULT STDMETHODCALLTYPE GetFrameCompletionReferenceTimestamp(
        IDeckLinkVideoFrame* theFrame, BMDTimeScale desiredTimeScale,
        BMDTimeValue* frameCompletionTimestamp) = 0;
};

// ---------------------------------------------------------------------------
// IDeckLinkKeyer
// GUID: 89AFCAF5-65F8-421E-98F7-96FE5F5BFBA3
// Source: DeckLinkAPI.idl lines 1613-1620
// ---------------------------------------------------------------------------
DL_IFACE("89AFCAF5-65F8-421E-98F7-96FE5F5BFBA3")
IDeckLinkKeyer : public IUnknown
{
    virtual HRESULT STDMETHODCALLTYPE Enable(BOOL isExternal) = 0;
    virtual HRESULT STDMETHODCALLTYPE SetLevel(unsigned char level) = 0;
    virtual HRESULT STDMETHODCALLTYPE RampUp(unsigned int numberOfFrames) = 0;
    virtual HRESULT STDMETHODCALLTYPE RampDown(unsigned int numberOfFrames) = 0;
    virtual HRESULT STDMETHODCALLTYPE Disable() = 0;
};

// ---------------------------------------------------------------------------
// CLSID for CDeckLinkIterator CoClass
// GUID: BA6C6F44-6DA5-4DCE-94AA-EE2D1372A676
// ---------------------------------------------------------------------------
static const CLSID CLSID_CDeckLinkIterator =
    { 0xBA6C6F44, 0x6DA5, 0x4DCE,
      { 0x94, 0xAA, 0xEE, 0x2D, 0x13, 0x72, 0xA6, 0x76 } };
