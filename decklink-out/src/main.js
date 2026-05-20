/**
 * main.js — Electron main process
 *
 * Offscreen BrowserWindow 1920×1080 / 25 fps (1080i50),
 * feeds every paint event into the DeckLink addon (Fill+Key SDI output).
 */

'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');

// ---------------------------------------------------------------------------
// GPU / WebGL flags — must be set BEFORE app is ready
// Needed so PIXI.js WebGL works in offscreen (no physical display) mode.
// ---------------------------------------------------------------------------
app.commandLine.appendSwitch('use-gl', 'swiftshader');          // software WebGL
app.commandLine.appendSwitch('enable-webgl', 'true');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas', 'true');
app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');

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
const RENDERER_URL = process.env.RENDERER_URL || 'http://localhost:3001/renderer.html';
const TARGET_FPS   = 25;
const BACKEND_RETRY_MS = 3000;  // retry loading page if backend not ready yet

// ---------------------------------------------------------------------------
// Window + output lifecycle
// ---------------------------------------------------------------------------
let win         = null;
let outputOpen  = false;
let paintCount  = 0;
let lastPaintLog = 0;

function openDeckLink() {
    try {
        decklink.open();
        outputOpen = true;
        console.log('[DeckLink] Output started (1080i50, Fill+Key)');
    } catch (err) {
        console.error('[DeckLink] open() failed:', err.message);
    }
}

function createWindow() {
    win = new BrowserWindow({
        width:           1920,
        height:          1080,
        show:            false,
        transparent:     true,          // allow alpha channel through to offscreen bitmap
        backgroundColor: '#00000000',  // fully transparent default background
        webPreferences: {
            offscreen:            true,
            backgroundThrottling: false,
            contextIsolation:     true,
            webgl:                true,
        }
    });

    win.webContents.setFrameRate(TARGET_FPS);

    // ---- Page load success ----
    win.webContents.on('did-finish-load', () => {
        console.log('[DeckLink] Page loaded:', RENDERER_URL);
        if (!outputOpen) openDeckLink();
    });

    // ---- Page load failed (backend not ready yet?) — retry ----
    win.webContents.on('did-fail-load', (evt, code, desc, url) => {
        console.warn(`[DeckLink] Page load failed (${code} ${desc}) — retry in ${BACKEND_RETRY_MS}ms`);
        setTimeout(() => {
            if (win && !win.isDestroyed()) win.loadURL(RENDERER_URL);
        }, BACKEND_RETRY_MS);
    });

    // ---- Console messages from renderer (useful for PIXI init errors) ----
    win.webContents.on('console-message', (evt, level, msg) => {
        const prefix = ['[renderer:log]', '[renderer:warn]', '[renderer:error]', '[renderer:debug]'][level] || '[renderer]';
        console.log(prefix, msg);
    });

    // ---- Paint → DeckLink ----
    win.webContents.on('paint', (event, _dirty, image) => {
        if (!outputOpen) return;
        try {
            decklink.scheduleFrame(image.getBitmap());
        } catch (_) {}

        // Log frame rate every 5 seconds for diagnostics
        paintCount++;
        const now = Date.now();
        if (now - lastPaintLog >= 5000) {
            const fps = (paintCount / ((now - lastPaintLog || 5000) * 0.001)).toFixed(1);
            console.log(`[DeckLink] Sending frames: ~${fps} fps (total ${paintCount})`);
            paintCount  = 0;
            lastPaintLog = now;
        }
    });

    win.loadURL(RENDERER_URL);
}

// ---------------------------------------------------------------------------
// Electron lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
    lastPaintLog = Date.now();
    createWindow();
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
