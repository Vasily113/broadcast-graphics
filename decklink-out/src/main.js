/**
 * main.js — Electron main process
 *
 * Opens an offscreen BrowserWindow at 1920×1080 / 50 fps,
 * loads the broadcast-graphics renderer page, and feeds every
 * paint event into the DeckLink addon so it appears on SDI output.
 *
 * SDI wiring (DeckLink 8K Pro internal-keyer mode):
 *   SDI 1 → Fill
 *   SDI 2 → Key (alpha)
 */

'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');

// --------------------------------------------------------------------------
// Load the native addon
// --------------------------------------------------------------------------
let decklink;
try {
    decklink = require(path.join(__dirname, '../addon/build/Release/decklink.node'));
} catch (err) {
    console.error('[DeckLink] Failed to load native addon:', err.message);
    process.exit(1);
}

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------
const RENDERER_URL = process.env.RENDERER_URL || 'http://localhost:3001/renderer.html';
const TARGET_FPS   = 50;

// --------------------------------------------------------------------------
// Window + output lifecycle
// --------------------------------------------------------------------------
let win = null;
let outputOpen = false;

function createWindow() {
    win = new BrowserWindow({
        width:  1920,
        height: 1080,
        show:   false,          // offscreen — never shown on screen
        webPreferences: {
            offscreen:          true,
            backgroundThrottling: false,
            contextIsolation:   true,
        }
    });

    win.webContents.setFrameRate(TARGET_FPS);

    // Open DeckLink output once the page has finished loading
    win.webContents.on('did-finish-load', () => {
        console.log('[DeckLink] Page loaded:', RENDERER_URL);
        try {
            decklink.open();
            outputOpen = true;
            console.log('[DeckLink] Output started (1080p50, Fill+Key)');
        } catch (err) {
            console.error('[DeckLink] open() failed:', err.message);
        }
    });

    win.webContents.on('did-fail-load', (evt, code, desc) => {
        console.error(`[DeckLink] Page load failed (${code}): ${desc}`);
    });

    // Forward every painted frame to the DeckLink hardware
    win.webContents.on('paint', (event, _dirty, image) => {
        if (!outputOpen) return;
        try {
            decklink.scheduleFrame(image.getBitmap());
        } catch (err) {
            // Swallow scheduling errors (e.g. close() in progress)
        }
    });

    win.loadURL(RENDERER_URL);
}

function shutdown() {
    if (outputOpen) {
        try {
            decklink.close();
            outputOpen = false;
            console.log('[DeckLink] Output stopped');
        } catch (err) {
            console.error('[DeckLink] close() error:', err.message);
        }
    }
}

// --------------------------------------------------------------------------
// Electron lifecycle
// --------------------------------------------------------------------------
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    shutdown();
    app.quit();
});

process.on('SIGINT',  () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });
