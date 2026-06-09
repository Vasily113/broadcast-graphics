#!/usr/bin/env node
/**
 * Line protocol: one JSON object per line in, one JSON object per line out.
 * { "op":"prepare", "template":{...}, "frame": 42, "variables":{...} }
 * -> { "ok":true, "template":{...} }  (prepareTemplateForRender)
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

global.gsap = {
  parseEase(name) {
    if (name === 'linear') return (t) => t;
    if (name === 'power2.out') return (t) => 1 - (1 - t) * (1 - t);
    if (name === 'power2.in') return (t) => t * t;
    if (name === 'bounce.out') return (t) => {
      if (t < 1 / 2.75) return 7.5625 * t * t;
      if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
      if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
      return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
    };
    return (t) => t;
  },
};

const runtimePath = path.resolve(__dirname, '../../backend/public/timeline-runtime.js');
const runtimeCode = fs.readFileSync(runtimePath, 'utf8');
// eslint-disable-next-line no-eval
eval(runtimeCode);

const rl = readline.createInterface({ input: process.stdin, terminal: false });
const loadedTemplates = new Map();

function reply(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    if (msg.op === 'load') {
      if (!msg.id || !msg.template) {
        reply({ ok: false, error: 'load requires id and template' });
        return;
      }
      loadedTemplates.set(String(msg.id), msg.template);
      reply({ ok: true });
      return;
    }
    if (msg.op === 'unload') {
      if (msg.id) loadedTemplates.delete(String(msg.id));
      reply({ ok: true });
      return;
    }
    if (msg.op === 'prepare') {
      const frame = Number.isFinite(msg.frame) ? msg.frame : 0;
      const template = msg.template || (msg.id ? loadedTemplates.get(String(msg.id)) : null);
      if (!template) {
        reply({ ok: false, error: 'template not loaded' });
        return;
      }
      const prepared = TimelineRuntime.prepareTemplateForRender(template, frame);
      reply({ ok: true, template: prepared });
      return;
    }
    if (msg.op === 'ping') {
      reply({ ok: true, pong: true });
      return;
    }
    reply({ ok: false, error: 'unknown op' });
  } catch (e) {
    reply({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});
