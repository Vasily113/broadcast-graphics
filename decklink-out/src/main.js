/**
 * main.js — Electron main process
 *
 * Reads display_mode and keyer_mode from /api/settings on startup,
 * then feeds every paint event into the DeckLink addon.
 */

'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');

// ---------------------------------------------------------------------------
// GPU / WebGL flags
// ---------------------------------------------------------------------------
app.commandLine.appendSwitch('use-gl', 'angle');
app.commandLine.appendSwitch('use-angle', 'd3d11');
app.commandLine.appendSwitch('enable-webgl', 'true');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas', 'true');
app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');
app.commandLine.appendSwitch('enable-features',
    'D3D11VideoDecoder,D3D11VideoDecoderDXVABlocks,PlatformHEVCDecoderSupport');

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
const RENDERER_URL  = process.env.RENDERER_URL ||
  (CHANNEL_ID ? `${BACKEND_URL}/renderer.html?channel=${encodeURIComponent(CHANNEL_ID)}`
              : `${BACKEND_URL}/renderer.html`);
const BACKEND_RETRY_MS = 3000;

// Resolution by display mode prefix
function resolveResolution(displayMode) {
    if (displayMode && displayMode.startsWith('HD720')) return { w: 1280, h: 720 };
    return { w: 1920, h: 1080 }; // default: all 1080 formats
}

// ---------------------------------------------------------------------------
// Fetch JSON from backend (with fallback)
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
    // Try channel-specific settings first
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
    // Fallback to global settings
    const data = await fetchJson(`${BACKEND_URL}/api/settings`);
    return {
        display_mode: data?.display_mode || 'HD1080i50',
        keyer_mode:   data?.keyer_mode   || 'external',
        device_index: data?.device_index  ?? 0,
    };
}

// ---------------------------------------------------------------------------
// Window + output lifecycle
// ---------------------------------------------------------------------------
let win        = null;
let outputOpen = false;
let paintCount = 0;
let lastPaintLog = 0;

function openDeckLink(deviceIndex, displayMode, keyerMode) {
    try {
        decklink.open(deviceIndex, displayMode, keyerMode);
        outputOpen = true;
        console.log(`[DeckLink] Output started — sub-device=${deviceIndex}  mode=${displayMode}  keyer=${keyerMode}`);
    } catch (err) {
        console.error('[DeckLink] open() failed:', err.message);
    }
}

function createWindow(displayMode) {
    const { w, h } = resolveResolution(displayMode);

    win = new BrowserWindow({
        width:           w,
        height:          h,
        show:            false,
        transparent:     true,
        backgroundColor: '#00000000',
        webPreferences: {
            offscreen:            true,
            backgroundThrottling: false,
            contextIsolation:     true,
            webgl:                true,
        }
    });

    // Derive target FPS from display mode string
    let fps = 25;
    if (displayMode) {
        if (displayMode.includes('p50') || displayMode.includes('i50')) fps = 50;
        else if (displayMode.includes('5994') || displayMode.includes('p5994')) fps = 60;
        else if (displayMode.includes('p6000') || displayMode.includes('i6000') || displayMode.includes('p60')) fps = 60;
        else if (displayMode.includes('p2997') || displayMode.includes('i5994')) fps = 30;
        else if (displayMode.includes('p30') || displayMode.includes('i6000')) fps = 30;
        else if (displayMode.includes('p25') || displayMode.includes('i50'))   fps = 25;
        else if (displayMode.includes('p2398')) fps = 24;
        else if (displayMode.includes('p24'))   fps = 24;
    }
    win.webContents.setFrameRate(fps);

    win.webContents.on('did-finish-load', () => {
        console.log('[DeckLink] Page loaded:', RENDERER_URL);
    });

    win.webContents.on('did-fail-load', (evt, code, desc) => {
        console.warn(`[DeckLink] Page load failed (${code} ${desc}) — retry in ${BACKEND_RETRY_MS}ms`);
        setTimeout(() => {
            if (win && !win.isDestroyed()) win.loadURL(RENDERER_URL);
        }, BACKEND_RETRY_MS);
    });

    win.webContents.on('console-message', (evt, level, msg) => {
        const prefix = ['[renderer:log]', '[renderer:warn]', '[renderer:error]', '[renderer:debug]'][level] || '[renderer]';
        // Only log warnings and errors to reduce noise; log WS status always
        if (level >= 1 || msg.includes('[Renderer]') || msg.includes('WS') || msg.includes('channel')) {
            console.log(prefix, msg);
        }
    });

    let firstPaint = true;
    win.webContents.on('paint', (event, _dirty, image) => {
        if (!outputOpen) return;

        if (firstPaint) {
            firstPaint = false;
            console.log('[DeckLink] First paint received — frames flowing to DeckLink output');
        }

        try {
            decklink.scheduleFrame(image.getBitmap());
        } catch (err) {
            console.error('[DeckLink] scheduleFrame error:', err.message);
        }

        paintCount++;
        const now = Date.now();
        if (now - lastPaintLog >= 5000) {
            const fps = (paintCount / ((now - lastPaintLog || 5000) * 0.001)).toFixed(1);
            console.log(`[DeckLink] Sending frames: ~${fps} fps`);
            paintCount  = 0;
            lastPaintLog = now;
        }
    });

    win.loadURL(RENDERER_URL);
}

// ---------------------------------------------------------------------------
// Electron lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
    lastPaintLog = Date.now();

    const settings = await getSettings();
    console.log(`[DeckLink] Settings: device=${settings.device_index}  mode=${settings.display_mode}  keyer=${settings.keyer_mode}`);

    if (settings.device_index === -1) {
        console.log('[DeckLink] SDI output disabled (device_index=-1) — renderer only, no DeckLink');
    } else {
        openDeckLink(settings.device_index, settings.display_mode, settings.keyer_mode);
    }
    createWindow(settings.display_mode);
});

app.on('window-all-closed', shutdown);

function shutdown() {
    if (outputOpen) {
        try { decklink.close(); outputOpen = false; } catch (_) {}
        console.log('[DeckLink] Output stopped');
    }
    app.quit();
}

process.on('SIGINT',  () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });
