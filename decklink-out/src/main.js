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
  app.commandLine.appendSwitch('enable-webgl', 'true');
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
const BACKEND_URL   = process.env.BACKEND_URL || 'http://localhost:4001';

// Linux capture modes (best → fallback):
//   default (blit)       — WebGL→Canvas2D blit + offscreen paint (~50 fps, correct alpha/key)
//   DECKLINK_USE_CAPTURE=1 — capturePage (~17 fps, key broken — opaque alpha)
//   DECKLINK_USE_IPC=1     — readPixels IPC (~1 fps, diagnostic)
const USE_IPC_FRAMES      = process.env.DECKLINK_USE_IPC === '1';
const USE_LINUX_CAPTURE   = process.env.DECKLINK_USE_CAPTURE === '1' && !USE_IPC_FRAMES;
const USE_LINUX_BLIT      = process.platform === 'linux' && !USE_IPC_FRAMES && !USE_LINUX_CAPTURE;
const USE_OFFSCREEN_PAINT = USE_LINUX_BLIT || process.platform === 'win32';

const RENDERER_URL  = process.env.RENDERER_URL ||
  (CHANNEL_ID
    ? `${BACKEND_URL}/renderer.html?channel=${encodeURIComponent(CHANNEL_ID)}${USE_LINUX_BLIT ? '&decklinkBlit=1' : ''}${USE_IPC_FRAMES ? '&decklinkIpc=1' : ''}`
    : `${BACKEND_URL}/renderer.html${USE_LINUX_BLIT ? '?decklinkBlit=1' : ''}${USE_IPC_FRAMES ? (USE_LINUX_BLIT ? '&decklinkIpc=1' : '?decklinkIpc=1') : ''}`);
const BACKEND_RETRY_MS = 3000;
const PAINT_FPS_OVERRIDE = Number(process.env.DECKLINK_PAINT_FPS);

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
let statsTimer       = null;
let exactSizeCount   = 0;
let paddedSizeCount  = 0;
let oddSizeCount     = 0;
let paintSpikeCount  = 0;
let lastFeedTsMs     = 0;
let blankFrameStreak = 0;
let suppressedBlankFrames = 0;

const STATS_INTERVAL_MS = Number(process.env.DECKLINK_STATS_INTERVAL) || 30000;

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
        lastCount = count;
        lastTime = now;
        lastExact = exactSizeCount;
        lastPadded = paddedSizeCount;
        lastOdd = oddSizeCount;
        lastSpikes = paintSpikeCount;
        lastSuppressedBlank = suppressedBlankFrames;
        if (dt <= 0) return;
        const fps = (frames / (dt * 0.001)).toFixed(1);
        const sdiFps = deriveFps(displayMode);
        if (USE_LINUX_BLIT) {
            logStatsAsync(
                `[DeckLink] Paint capture: ~${fps} fps  |  SDI output: ${sdiFps} Hz  |  size exact=${exact} pad1px=${padded} odd=${odd}  |  dt spikes=${spikes} blank-suppressed=${suppressedBlank}`,
            );
        } else {
            logStatsAsync(`[DeckLink] Sending frames: ~${fps} fps`);
        }
    }, STATS_INTERVAL_MS);
}

function looksLikeBlankFrame(buffer, width, height) {
    if (!buffer || buffer.length < 4 || width <= 0 || height <= 0) return false;
    // Sample a small grid instead of scanning all pixels.
    const cols = 8;
    const rows = 8;
    for (let ry = 0; ry < rows; ry++) {
        const y = Math.min(height - 1, Math.floor((ry * (height - 1)) / (rows - 1)));
        for (let rx = 0; rx < cols; rx++) {
            const x = Math.min(width - 1, Math.floor((rx * (width - 1)) / (cols - 1)));
            const i = (y * width + x) * 4;
            const b = buffer[i + 0];
            const g = buffer[i + 1];
            const r = buffer[i + 2];
            const a = buffer[i + 3];
            // Any clearly non-empty sample means this is a real frame.
            if (a > 8 || r > 8 || g > 8 || b > 8) return false;
        }
    }
    return true;
}

function feedFrame(buffer, srcW, srcH) {
    if (!outputOpen) return;
    const nowMs = Date.now();
    if (lastFeedTsMs !== 0) {
        const deltaMs = nowMs - lastFeedTsMs;
        // For 50Hz we expect ~20ms cadence. >40ms means at least one frame interval lost.
        if (deltaMs > 40) paintSpikeCount++;
    }
    lastFeedTsMs = nowMs;

    const { w, h } = resolveResolution(win?._displayMode || 'HD1080i50');
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

    if (sw !== w || sh !== h) {
        if (Math.abs(sw - w) <= 1 && Math.abs(sh - h) <= 1) paddedSizeCount++;
        else oddSizeCount++;
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
        // Suppress short blank glitches (1-2 frames), keep previous stable frame in staging.
        if (blankFrameStreak <= 2) {
            suppressedBlankFrames++;
            return;
        }
    } else {
        blankFrameStreak = 0;
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

function countFrameFromRgba(buffer) {
    if (!outputOpen) return;

    const { w, h } = resolveResolution(win?._displayMode || 'HD1080i50');
    if (buffer.length !== w * h * 4) return;

    if (!firstFrameLogged) {
        firstFrameLogged = true;
        logStatsAsync('[DeckLink] First frame received — frames flowing to DeckLink output');
    }

    try {
        decklink.scheduleFrameRgba(buffer);
    } catch (err) {
        console.error('[DeckLink] scheduleFrameRgba error:', err.message);
    }

    paintCount++;
}

if (USE_IPC_FRAMES) {
    ipcMain.on('decklink-frame-rgba', (_event, buffer) => {
        countFrameFromRgba(buffer);
    });
}

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

function createWindow(displayMode) {
    const { w, h } = resolveResolution(displayMode);
    const fps = deriveFps(displayMode);
    const useHiddenWindow = USE_LINUX_CAPTURE || USE_IPC_FRAMES;

    win = new BrowserWindow({
        width:           w,
        height:          h,
        useContentSize:  true,
        frame:           false,
        show:            false,
        transparent:     !useHiddenWindow,
        backgroundColor: useHiddenWindow ? '#000000' : '#00000000',
        webPreferences: {
            offscreen:            USE_OFFSCREEN_PAINT,
            backgroundThrottling: false,
            contextIsolation:     true,
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
        if (USE_LINUX_CAPTURE) startCaptureLoop(fps);
    });

    win.webContents.on('did-fail-load', (evt, code, desc) => {
        console.warn(`[DeckLink] Page load failed (${code} ${desc}) — retry in ${BACKEND_RETRY_MS}ms`);
        setTimeout(() => {
            if (win && !win.isDestroyed()) win.loadURL(RENDERER_URL);
        }, BACKEND_RETRY_MS);
    });

    win.webContents.on('console-message', (evt, level, msg) => {
        const prefix = ['[renderer:log]', '[renderer:warn]', '[renderer:error]', '[renderer:debug]'][level] || '[renderer]';
        if (level >= 1 || msg.includes('[Renderer]') || msg.includes('WS') || msg.includes('channel')) {
            console.log(prefix, msg);
        }
    });

    if (USE_IPC_FRAMES) {
        console.log('[DeckLink] Using readPixels IPC (DECKLINK_USE_IPC=1, ~1 fps)');
    } else if (USE_LINUX_CAPTURE) {
        console.log('[DeckLink] Using capturePage (DECKLINK_USE_CAPTURE=1, no key alpha)');
    } else if (USE_LINUX_BLIT) {
        console.log('[DeckLink] Using Canvas2D blit + offscreen paint (Linux)');
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
    } else {
        openDeckLink(settings.device_index, settings.display_mode, settings.keyer_mode);
    }
    createWindow(settings.display_mode);
    startStatsLogging(settings.display_mode);
});

app.on('window-all-closed', shutdown);

function shutdown() {
    if (captureTimer) { clearInterval(captureTimer); captureTimer = null; }
    if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
    if (outputOpen) {
        try { decklink.close(); outputOpen = false; } catch (_) {}
        console.log('[DeckLink] Output stopped');
    }
    app.quit();
}

process.on('SIGINT',  () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });
