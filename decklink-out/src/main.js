/**
 * main.js — Electron main process
 *
 * Reads display_mode and keyer_mode from /api/settings on startup,
 * then feeds frames into the DeckLink addon.
 */

'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');

// ---------------------------------------------------------------------------
// GPU / WebGL flags (platform-specific)
// ---------------------------------------------------------------------------
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'd3d11');
  app.commandLine.appendSwitch('enable-webgl', 'true');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-accelerated-2d-canvas', 'true');
  app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');
  app.commandLine.appendSwitch('enable-features',
    'D3D11VideoDecoder,D3D11VideoDecoderDXVABlocks,PlatformHEVCDecoderSupport');
} else if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('disable-http-cache');
  app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');
  app.commandLine.appendSwitch('enable-webgl', 'true');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-accelerated-2d-canvas', 'true');
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  if (process.env.ELECTRON_USE_SOFTWARE_GL === '1') {
    app.commandLine.appendSwitch('use-gl', 'egl-gles2');
  } else {
    app.commandLine.appendSwitch('use-gl', 'angle');
    app.commandLine.appendSwitch('use-angle', 'default');
  }
}

// ---------------------------------------------------------------------------
// Load the native DeckLink addon
// ---------------------------------------------------------------------------
let decklink;
try {
    decklink = require(path.join(__dirname, '../addon/build/Release/decklink.node'));
} catch (err) {
    console.error('[DeckLink] Failed to load addon:', err.message);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CHANNEL_ID    = (process.env.CHANNEL_ID || '').trim();
const BACKEND_URL   = process.env.BACKEND_URL || 'http://localhost:3001';

// Linux capture modes (best → fallback):
//   default (blit)       — WebGL→Canvas2D blit + direct IPC to main (~50 fps, correct alpha/key)
//   DECKLINK_USE_CAPTURE=1 — capturePage (~17 fps, key broken — opaque alpha)
//   DECKLINK_USE_IPC=1     — readPixels IPC (~1 fps, diagnostic)
const USE_NATIVE_PRODUCER = process.env.DECKLINK_NATIVE_PRODUCER === '1' && process.platform === 'linux';
const USE_IPC_FRAMES      = process.env.DECKLINK_USE_IPC === '1' && !USE_NATIVE_PRODUCER;
const USE_LINUX_CAPTURE   = process.env.DECKLINK_USE_CAPTURE === '1' && !USE_IPC_FRAMES && !USE_NATIVE_PRODUCER;
const USE_LINUX_BLIT      = process.platform === 'linux' && !USE_IPC_FRAMES && !USE_LINUX_CAPTURE;
const USE_SHARED_FRAMES   = process.env.DECKLINK_USE_SHM === '1' && USE_LINUX_BLIT && !USE_NATIVE_PRODUCER;
const USE_LINUX_BLIT_IPC  = USE_LINUX_BLIT && !USE_NATIVE_PRODUCER;
const USE_OFFSCREEN_WINDOW = USE_LINUX_BLIT || process.platform === 'win32';
const USE_OFFSCREEN_PAINT  = USE_OFFSCREEN_WINDOW && !USE_LINUX_BLIT_IPC && !USE_NATIVE_PRODUCER;

function buildRendererUrl() {
    if (process.env.RENDERER_URL) return process.env.RENDERER_URL;
    const url = new URL('/renderer.html', BACKEND_URL);
    if (CHANNEL_ID) url.searchParams.set('channel', CHANNEL_ID);
    if (USE_LINUX_BLIT || USE_NATIVE_PRODUCER) url.searchParams.set('decklinkBlit', '1');
    if (USE_NATIVE_PRODUCER) url.searchParams.set('decklinkNative', '1');
    if (USE_SHARED_FRAMES) url.searchParams.set('decklinkShm', '1');
    if (USE_IPC_FRAMES) url.searchParams.set('decklinkIpc', '1');
    url.searchParams.set('decklinkCacheBust', String(Date.now()));
    return url.toString();
}

const RENDERER_URL = buildRendererUrl();
const BACKEND_RETRY_MS = 3000;
const PAINT_FPS_OVERRIDE = Number(process.env.DECKLINK_PAINT_FPS);
const SYNC_PREFERENCE = (process.env.DECKLINK_SYNC_PREFERENCE || 'external_first').trim();
const DECKLINK_SHM_NAME = (process.env.DECKLINK_SHM_NAME || '').trim();

function shmNameFromChannelId(channelId) {
    let name = 'bgv13_';
    for (const c of channelId) {
        if (/[a-zA-Z0-9]/.test(c)) name += c;
        else if (c === '-' || c === '_') name += '_';
    }
    if (name.length <= 6) name += 'default';
    return name;
}

function resolveResolution(displayMode) {
    if (displayMode && displayMode.startsWith('HD720')) return { w: 1280, h: 720 };
    return { w: 1920, h: 1080 };
}

function deriveFps(displayMode) {
    if (!displayMode) return 25;
    if (displayMode.includes('p50') || displayMode.includes('i50')) return 50;
    if (displayMode.includes('5994') || displayMode.includes('p5994')) return 60;
    if (displayMode.includes('p6000') || displayMode.includes('i6000') || displayMode.includes('p60')) return 60;
    if (displayMode.includes('p2997') || displayMode.includes('i5994')) return 30;
    if (displayMode.includes('p30') || displayMode.includes('i6000')) return 30;
    if (displayMode.includes('p25') || displayMode.includes('i50')) return 25;
    if (displayMode.includes('p2398')) return 24;
    if (displayMode.includes('p24')) return 24;
    return 25;
}

// ---------------------------------------------------------------------------
// Fetch JSON from backend
// ---------------------------------------------------------------------------
function fetchJson(url) {
    return new Promise((resolve) => {
        const lib = url.startsWith('https') ? https : http;
        lib.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

async function getSettings() {
    if (CHANNEL_ID) {
        const ch = await fetchJson(`${BACKEND_URL}/api/channels/${CHANNEL_ID}`);
        if (ch && !ch.error) {
            console.log(`[DeckLink] Using channel settings for "${ch.name}"`);
            return {
                display_mode: ch.display_mode || 'HD1080i50',
                keyer_mode:   ch.keyer_mode   || 'external',
                device_index: ch.device_index  ?? 0,
            };
        }
        console.warn(`[DeckLink] Channel ${CHANNEL_ID} not found — falling back to global settings`);
    }
    const data = await fetchJson(`${BACKEND_URL}/api/settings`);
    return {
        display_mode: data?.display_mode || 'HD1080i50',
        keyer_mode:   data?.keyer_mode   || 'external',
        device_index: data?.device_index  ?? 0,
    };
}

// ---------------------------------------------------------------------------
// Frame pipeline
// ---------------------------------------------------------------------------
let win              = null;
let outputOpen       = false;
let paintCount       = 0;
let frameSizeWarned  = false;
let firstFrameLogged = false;
let captureTimer     = null;
let captureBusy      = false;
let invalidateTimer  = null;
let statsTimer       = null;
let exactSizeCount   = 0;
let paddedSizeCount  = 0;
let oddSizeCount     = 0;
let paintSpikeCount  = 0;
let lastFeedTsMs     = 0;
let blankFrameStreak = 0;
let suppressedBlankFrames = 0;
let suppressedOddFrames = 0;
let hasStableFrame = false;
let shmState = null;
let shmPumpTimer = null;
let rendererReadbackWarnings = 0;

const STATS_INTERVAL_MS = Number(process.env.DECKLINK_STATS_INTERVAL) || 30000;
const BLANK_SUPPRESS_MS = Number(process.env.DECKLINK_BLANK_SUPPRESS_MS) || 500;

function logStatsAsync(message) {
    setImmediate(() => console.log(message));
}

function startStatsLogging(displayMode) {
    if (statsTimer || STATS_INTERVAL_MS <= 0) return;
    let lastCount = 0;
    let lastTime = Date.now();
    let lastExact = 0;
    let lastPadded = 0;
    let lastOdd = 0;
    let lastSpikes = 0;
    let lastSuppressedBlank = 0;
    let lastSuppressedOdd = 0;
    let lastReadbackWarnings = 0;
    statsTimer = setInterval(() => {
        const now = Date.now();
        const count = paintCount;
        const dt = now - lastTime;
        const frames = count - lastCount;
        const exact = exactSizeCount - lastExact;
        const padded = paddedSizeCount - lastPadded;
        const odd = oddSizeCount - lastOdd;
        const spikes = paintSpikeCount - lastSpikes;
        const suppressedBlank = suppressedBlankFrames - lastSuppressedBlank;
        const suppressedOdd = suppressedOddFrames - lastSuppressedOdd;
        const readbackWarnings = rendererReadbackWarnings - lastReadbackWarnings;
        lastCount = count;
        lastTime = now;
        lastExact = exactSizeCount;
        lastPadded = paddedSizeCount;
        lastOdd = oddSizeCount;
        lastSpikes = paintSpikeCount;
        lastSuppressedBlank = suppressedBlankFrames;
        lastSuppressedOdd = suppressedOddFrames;
        lastReadbackWarnings = rendererReadbackWarnings;
        if (dt <= 0) return;
        const fps = (frames / (dt * 0.001)).toFixed(1);
        const sdiFps = deriveFps(displayMode);
        if (USE_LINUX_BLIT || USE_NATIVE_PRODUCER) {
            if (USE_NATIVE_PRODUCER) {
                // In direct native publish mode, renderer logs authoritative SHM publish fps.
                logStatsAsync(
                    `[DeckLink] Blit POSIX SHM (direct renderer publish)  |  SDI output: ${sdiFps} Hz  |  readback-warnings=${readbackWarnings}  |  see renderer log: "Native SHM publish"`,
                );
            } else {
                const captureLabel = (USE_SHARED_FRAMES && shmState) ? 'Blit SHM' : (USE_LINUX_BLIT_IPC ? 'Blit IPC' : 'Paint capture');
                logStatsAsync(
                    `[DeckLink] ${captureLabel}: ~${fps} fps  |  SDI output: ${sdiFps} Hz  |  size exact=${exact} pad1px=${padded} odd=${odd}  |  dt spikes=${spikes} blank-suppressed=${suppressedBlank} odd-suppressed=${suppressedOdd}`,
                );
            }
        } else {
            logStatsAsync(`[DeckLink] Sending frames: ~${fps} fps`);
        }
    }, STATS_INTERVAL_MS);
}

function looksLikeBlankFrame(buffer, width, height) {
    if (!buffer || buffer.length < 4 || width <= 0 || height <= 0) return false;
    // Scan a sparse but broad set of pixels. This catches small text/rect graphics
    // better than an 8x8 grid, while still being cheap enough at 50 fps.
    const pixelCount = width * height;
    const pixelStride = Math.max(1, Math.floor(pixelCount / 30000));
    for (let p = 0; p < pixelCount; p += pixelStride) {
        const i = p * 4;
        const b = buffer[i + 0];
        const g = buffer[i + 1];
        const r = buffer[i + 2];
        const a = buffer[i + 3];
        // Treat fully transparent and fully black frames as blank-like glitches.
        // Any color or partial alpha means this is real graphics content.
        if (r > 8 || g > 8 || b > 8 || (a > 8 && a < 248)) {
            return false;
        }
    }
    return true;
}

function feedFrame(buffer, srcW, srcH) {
    if (!outputOpen) return;
    const nowMs = Date.now();
    const displayMode = win?._displayMode || 'HD1080i50';
    if (lastFeedTsMs !== 0) {
        const deltaMs = nowMs - lastFeedTsMs;
        // For 50Hz we expect ~20ms cadence. >40ms means at least one frame interval lost.
        if (deltaMs > 40) paintSpikeCount++;
    }
    lastFeedTsMs = nowMs;

    const { w, h } = resolveResolution(displayMode);
    const sw = srcW ?? w;
    const sh = srcH ?? h;
    const expectedBytes = sw * sh * 4;

    if (buffer.length !== expectedBytes) {
        if (!frameSizeWarned) {
            frameSizeWarned = true;
            logStatsAsync(`[DeckLink] Unexpected buffer ${buffer.length} bytes (${sw}x${sh})`);
        }
        return;
    }

    const isPad1px = sw === w - 1 && sh === h - 1;
    const isExactSize = sw === w && sh === h;
    if (!isExactSize) {
        if (isPad1px) paddedSizeCount++;
        else {
            oddSizeCount++;
            // Do not let transient offscreen odd-size paints replace the last good SDI frame.
            // The native fallback path clears destination before copying, which can look like a black flash.
            if (hasStableFrame) {
                suppressedOddFrames++;
                return;
            }
        }
        if (!frameSizeWarned) {
            frameSizeWarned = true;
            logStatsAsync(`[DeckLink] Padding frame ${sw}x${sh} → ${w}x${h} (native, no resize)`);
        }
    } else {
        exactSizeCount++;
    }

    if (!firstFrameLogged) {
        firstFrameLogged = true;
        logStatsAsync('[DeckLink] First frame received — frames flowing to DeckLink output');
    }

    const blankLike = looksLikeBlankFrame(buffer, sw, sh);
    if (blankLike) {
        blankFrameStreak++;
        const maxSuppressedBlankFrames = Math.max(2, Math.ceil((deriveFps(win?._displayMode || 'HD1080i50') * BLANK_SUPPRESS_MS) / 1000));
        // Suppress blank/black glitches after real graphics have reached the output.
        // If the renderer intentionally clears, the blank is allowed through after the timeout.
        if (hasStableFrame && blankFrameStreak <= maxSuppressedBlankFrames) {
            suppressedBlankFrames++;
            return;
        }
        hasStableFrame = false;
    } else {
        blankFrameStreak = 0;
        hasStableFrame = true;
    }

    try {
        if (sw === w && sh === h) {
            decklink.scheduleFrame(buffer);
        } else {
            decklink.scheduleFrame(buffer, sw, sh);
        }
    } catch (err) {
        console.error('[DeckLink] scheduleFrame error:', err.message);
    }

    paintCount++;
}

function feedFrameFromImage(image) {
    const size = image.getSize();
    feedFrame(image.getBitmap(), size.width, size.height);
}

function startOffscreenInvalidation(fps) {
    if (invalidateTimer || !USE_OFFSCREEN_PAINT || !win || win.isDestroyed()) return;
    if (typeof win.webContents.invalidate !== 'function') {
        console.warn('[DeckLink] webContents.invalidate() unavailable — relying on Chromium paint cadence');
        return;
    }
    const intervalMs = Math.max(1, Math.round(1000 / fps));
    invalidateTimer = setInterval(() => {
        if (!win || win.isDestroyed()) return;
        try {
            win.webContents.invalidate();
        } catch {}
    }, intervalMs);
    console.log(`[DeckLink] Offscreen invalidate loop: ${fps} fps (${intervalMs} ms)`);
}

function attachNativeShmProducer(displayMode) {
    if (!USE_NATIVE_PRODUCER || typeof decklink.shmProducerAttach !== 'function') return false;
    const { w, h } = resolveResolution(displayMode);
    const shmName = DECKLINK_SHM_NAME || shmNameFromChannelId(CHANNEL_ID || 'default');
    try {
        const ok = decklink.shmProducerAttach(shmName, w, h, 4);
        if (ok) {
            console.log(`[DeckLink] Native SHM producer attached (/${shmName}, ${w}x${h})`);
        } else {
            console.error(`[DeckLink] Native SHM producer attach failed (/${shmName})`);
        }
        return !!ok;
    } catch (err) {
        console.error('[DeckLink] shmProducerAttach error:', err.message);
        return false;
    }
}

function countFrameFromRgba(buffer, flipY = true) {
    if (!outputOpen) return;
    if (!Buffer.isBuffer(buffer)) {
        if (ArrayBuffer.isView(buffer)) {
            buffer = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        } else {
            return;
        }
    }

    const { w, h } = resolveResolution(win?._displayMode || 'HD1080i50');
    if (buffer.length !== w * h * 4) return;

    exactSizeCount++;

    if (!firstFrameLogged) {
        firstFrameLogged = true;
        logStatsAsync('[DeckLink] First frame received — frames flowing to DeckLink output');
    }

    try {
        if (USE_NATIVE_PRODUCER && typeof decklink.shmProducerPublish === 'function') {
            decklink.shmProducerPublish(buffer, !!flipY);
        } else {
            decklink.scheduleFrameRgba(buffer, !!flipY);
        }
    } catch (err) {
        console.error('[DeckLink] frame publish error:', err.message);
    }

    paintCount++;
}

if (USE_LINUX_BLIT_IPC || USE_IPC_FRAMES || USE_NATIVE_PRODUCER) {
    ipcMain.on('decklink-frame-rgba', (_event, payload) => {
        if (!payload) return;
        if (Buffer.isBuffer(payload)) {
            countFrameFromRgba(payload, true);
            return;
        }
        if (payload.data) {
            countFrameFromRgba(payload.data, payload.flipY !== false);
        }
    });
}

function stopSharedFramePump() {
    if (shmPumpTimer) {
        clearInterval(shmPumpTimer);
        shmPumpTimer = null;
    }
}

function startSharedFramePump(displayMode) {
    stopSharedFramePump();
    if (!shmState) return;
    const fps = deriveFps(displayMode);
    const intervalMs = Math.max(1, Math.round(1000 / fps));
    shmPumpTimer = setInterval(() => {
        if (!shmState || !outputOpen) return;
        const seq = Atomics.load(shmState.meta, 0);
        if (seq <= shmState.lastSeq) return;
        const slot = Atomics.load(shmState.meta, 1);
        if (slot < 0 || slot >= shmState.slotCount) return;
        shmState.lastSeq = seq;
        const flipY = Atomics.load(shmState.meta, 2) !== 0;
        const offset = slot * shmState.frameBytes;
        const frameView = Buffer.from(shmState.frameSab, offset, shmState.frameBytes);
        countFrameFromRgba(frameView, flipY);
    }, intervalMs);
}

ipcMain.on('decklink-shm-init-msg', (event, payload) => {
    const replyChannel = `decklink-shm-init-reply-${payload?.requestId || 'unknown'}`;
    const reply = (msg) => {
        try { event.sender.send(replyChannel, msg); } catch {}
    };
    if (!USE_SHARED_FRAMES) return reply({ ok: false, reason: 'disabled' });
    const { w, h } = resolveResolution(win?._displayMode || 'HD1080i50');
    const width = Number(payload?.width) || w;
    const height = Number(payload?.height) || h;
    const slotCount = Math.max(2, Number(payload?.slots) || 3);
    if (width !== w || height !== h) {
        return reply({ ok: false, reason: `size mismatch ${width}x${height} expected ${w}x${h}` });
    }
    const frameBytes = width * height * 4;
    const frameSab = payload?.frameSab;
    const metaSab = payload?.metaSab;
    if (!(frameSab instanceof SharedArrayBuffer) || !(metaSab instanceof SharedArrayBuffer)) {
        return reply({ ok: false, reason: 'missing shared buffers' });
    }
    if (frameSab.byteLength < frameBytes * slotCount) {
        return reply({ ok: false, reason: `frameSab too small (${frameSab.byteLength})` });
    }
    if (metaSab.byteLength < Int32Array.BYTES_PER_ELEMENT * 3) {
        return reply({ ok: false, reason: `metaSab too small (${metaSab.byteLength})` });
    }
    const meta = new Int32Array(metaSab);
    meta[0] = 0;
    meta[1] = 0;
    meta[2] = 1;
    shmState = { frameSab, metaSab, meta, frameBytes, slotCount, lastSeq: 0 };
    startSharedFramePump(win?._displayMode || 'HD1080i50');
    return reply({ ok: true, frameBytes, slotCount });
});

function startCaptureLoop(fps) {
    const intervalMs = Math.max(1, Math.floor(1000 / fps));
    if (captureTimer) clearInterval(captureTimer);

    captureTimer = setInterval(async () => {
        if (!win || win.isDestroyed() || !outputOpen || captureBusy) return;
        captureBusy = true;
        try {
            feedFrameFromImage(await win.webContents.capturePage());
        } catch (err) {
            console.error('[DeckLink] capturePage error:', err.message);
        } finally {
            captureBusy = false;
        }
    }, intervalMs);
}

function openDeckLink(deviceIndex, displayMode, keyerMode) {
    try {
        decklink.open(deviceIndex, displayMode, keyerMode);
        outputOpen = true;
        console.log(`[DeckLink] Output started — sub-device=${deviceIndex}  mode=${displayMode}  keyer=${keyerMode}`);
    } catch (err) {
        const msg = err.message || String(err);
        console.error('[DeckLink] open() failed:', msg);
        if (msg.includes('Please restart this application') || msg.includes('profile changed')) {
            console.error('[DeckLink] Profile switch requested — exiting for restart');
            process.exit(42);
        }
    }
}

function selectAndLogSyncSource(displayMode) {
    const preferExternal = SYNC_PREFERENCE !== 'gpu_first';
    console.log(`[DeckLink][Sync] Preference: ${preferExternal ? 'external_first' : 'gpu_first'}`);
    let status = null;
    try {
        if (typeof decklink.getSyncStatus === 'function') {
            status = decklink.getSyncStatus();
        }
    } catch (err) {
        console.warn('[DeckLink][Sync] getSyncStatus failed:', err.message);
    }

    const externalLocked = !!status?.supported && !!status?.externalLocked;
    if (externalLocked) {
        console.log(`[DeckLink][Sync] External reference: LOCKED (mode=${displayMode})`);
        console.log('[DeckLink][Sync] Selected source: Blackmagic external reference');
        return 'external';
    }

    if (status?.supported) {
        console.log('[DeckLink][Sync] External reference: UNLOCKED');
    } else {
        console.log('[DeckLink][Sync] External reference status unavailable');
    }
    console.log('[DeckLink][Sync] Selected source: NVIDIA VSync fallback');
    return 'gpu';
}

function createWindow(displayMode) {
    const { w, h } = resolveResolution(displayMode);
    const fps = deriveFps(displayMode);
    const useHiddenWindow = USE_LINUX_CAPTURE || USE_IPC_FRAMES || USE_SHARED_FRAMES;

    win = new BrowserWindow({
        width:           w,
        height:          h,
        useContentSize:  true,
        frame:           false,
        show:            false,
        transparent:     !useHiddenWindow,
        backgroundColor: useHiddenWindow ? '#000000' : '#00000000',
        webPreferences: {
            offscreen:            USE_OFFSCREEN_WINDOW,
            backgroundThrottling: false,
            contextIsolation:     true,
            sandbox:              false,
            webgl:                true,
            preload:              path.join(__dirname, 'preload.js'),
        }
    });
    win._displayMode = displayMode;
    win.setContentSize(w, h);
    // Keep paint cadence aligned with SDI by default; override with DECKLINK_PAINT_FPS if needed.
    const paintFps = Number.isFinite(PAINT_FPS_OVERRIDE) && PAINT_FPS_OVERRIDE > 0
      ? Math.round(PAINT_FPS_OVERRIDE)
      : fps;
    win.webContents.setFrameRate(paintFps);
    console.log(`[DeckLink] Paint rate: ${paintFps} fps (SDI mode: ${fps} Hz)`);
    win.webContents.setZoomFactor(1.0);

    win.webContents.on('did-finish-load', () => {
        console.log('[DeckLink] Page loaded:', RENDERER_URL);
        if (USE_NATIVE_PRODUCER && !outputOpen) attachNativeShmProducer(displayMode);
        if (USE_LINUX_CAPTURE) startCaptureLoop(fps);
        if (USE_SHARED_FRAMES) startSharedFramePump(displayMode);
    });

    win.webContents.on('did-fail-load', (evt, code, desc) => {
        console.warn(`[DeckLink] Page load failed (${code} ${desc}) — retry in ${BACKEND_RETRY_MS}ms`);
        setTimeout(() => {
            if (win && !win.isDestroyed()) win.loadURL(RENDERER_URL);
        }, BACKEND_RETRY_MS);
    });

    win.webContents.on('console-message', (evt, level, msg) => {
        if (typeof msg === 'string' && msg.includes('READ-usage buffer was written, then fenced')) {
            rendererReadbackWarnings++;
            return;
        }
        const prefix = ['[renderer:log]', '[renderer:warn]', '[renderer:error]', '[renderer:debug]'][level] || '[renderer]';
        if (level >= 1 || msg.includes('[Renderer]') || msg.includes('WS') || msg.includes('channel')) {
            console.log(prefix, msg);
        }
    });

    if (USE_NATIVE_PRODUCER) {
        console.log('[DeckLink] Using Canvas2D blit + POSIX SHM (native-channel pipeline)');
    } else if (USE_SHARED_FRAMES) {
        console.log('[DeckLink] Using shared-memory frame transport (DECKLINK_USE_SHM=1)');
    } else if (USE_IPC_FRAMES) {
        console.log('[DeckLink] Using readPixels IPC (DECKLINK_USE_IPC=1, ~1 fps)');
    } else if (USE_LINUX_CAPTURE) {
        console.log('[DeckLink] Using capturePage (DECKLINK_USE_CAPTURE=1, no key alpha)');
    } else if (USE_LINUX_BLIT) {
        console.log(`[DeckLink] Using Canvas2D blit + ${USE_SHARED_FRAMES ? 'shared memory' : 'direct IPC'} (Linux)`);
    }

    if (USE_OFFSCREEN_PAINT) {
        win.webContents.on('paint', (_event, _dirty, image) => {
            feedFrameFromImage(image);
        });
    }

    win.loadURL(RENDERER_URL);
}

// ---------------------------------------------------------------------------
// Electron lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
    const settings = await getSettings();
    console.log(`[DeckLink] Settings: device=${settings.device_index}  mode=${settings.display_mode}  keyer=${settings.keyer_mode}`);

    if (settings.device_index === -1) {
        console.log('[DeckLink] SDI output disabled (device_index=-1) — renderer only, no DeckLink');
    } else if (USE_NATIVE_PRODUCER) {
        console.log('[DeckLink] Native-channel pipeline: Electron is SHM producer only (decklink-channeld owns SDI)');
        attachNativeShmProducer(settings.display_mode);
        outputOpen = true;
    } else {
        openDeckLink(settings.device_index, settings.display_mode, settings.keyer_mode);
        selectAndLogSyncSource(settings.display_mode);
    }
    createWindow(settings.display_mode);
    startStatsLogging(settings.display_mode);
});

app.on('window-all-closed', shutdown);

function shutdown() {
    if (captureTimer) { clearInterval(captureTimer); captureTimer = null; }
    if (invalidateTimer) { clearInterval(invalidateTimer); invalidateTimer = null; }
    if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
    stopSharedFramePump();
    if (outputOpen) {
        if (!USE_NATIVE_PRODUCER) {
            try { decklink.close(); } catch (_) {}
        }
        outputOpen = false;
        console.log('[DeckLink] Output stopped');
    }
    app.quit();
}

process.on('SIGINT',  () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });
