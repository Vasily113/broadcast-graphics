'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let decklinkNative = null;
try {
  decklinkNative = require('../addon/build/Release/decklink.node');
} catch (_) {
  decklinkNative = null;
}

function shmNameFromChannelId(channelId) {
  let name = 'bgv13_';
  for (const c of (channelId || '')) {
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) name += c;
    else if (c === '-' || c === '_') name += '_';
  }
  if (name.length <= 6) name += 'default';
  return name;
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

contextBridge.exposeInMainWorld('decklinkOut', {
  sendFrameRgba: (uint8Array, flipY = true) => {
    ipcRenderer.send('decklink-frame-rgba', { data: uint8Array, flipY: !!flipY });
  },
  initNativeProducer: (width, height, slots = 4) => {
    if (!decklinkNative || typeof decklinkNative.shmProducerAttach !== 'function') {
      return { ok: false, reason: 'native addon unavailable in preload' };
    }
    const channelId = (process.env.CHANNEL_ID || 'default').trim();
    const shmName = (process.env.DECKLINK_SHM_NAME || shmNameFromChannelId(channelId)).trim();
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    const s = Math.max(2, slots | 0);
    try {
      const ok = !!decklinkNative.shmProducerAttach(shmName, w, h, s);
      return { ok, shmName, width: w, height: h, slots: s };
    } catch (err) {
      return { ok: false, reason: err?.message || String(err) };
    }
  },
  publishNativeFrame: (uint8Array, flipY = true) => {
    if (!decklinkNative || typeof decklinkNative.shmProducerPublish !== 'function') return false;
    const buffer = toBuffer(uint8Array);
    if (!buffer) return false;
    try {
      return !!decklinkNative.shmProducerPublish(buffer, !!flipY);
    } catch (_) {
      return false;
    }
  },
  closeNativeProducer: () => {
    if (!decklinkNative || typeof decklinkNative.shmProducerDetach !== 'function') return;
    try { decklinkNative.shmProducerDetach(); } catch (_) {}
  },
  initSharedFrames: async (width, height, slots = 3) => {
    if (typeof SharedArrayBuffer !== 'function') {
      return { ok: false, reason: 'SharedArrayBuffer unavailable in renderer context' };
    }
    const safeSlots = Math.max(2, slots | 0);
    const frameBytes = Math.max(1, (width | 0) * (height | 0) * 4);
    const frameSab = new SharedArrayBuffer(frameBytes * safeSlots);
    const metaSab = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 3);
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        ipcRenderer.removeAllListeners(`decklink-shm-init-reply-${requestId}`);
        resolve({ ok: false, reason: 'timeout waiting shm init reply' });
      }, 3000);
      ipcRenderer.once(`decklink-shm-init-reply-${requestId}`, (_event, payload) => {
        clearTimeout(timeout);
        resolve(payload || { ok: false, reason: 'empty shm init reply' });
      });
      ipcRenderer.postMessage('decklink-shm-init-msg', { requestId, width, height, slots: safeSlots, frameSab, metaSab, frameBytes });
    });
    if (!result?.ok) return result;
    return { ok: true, frameSab, metaSab, frameBytes, slotCount: safeSlots };
  },
});
