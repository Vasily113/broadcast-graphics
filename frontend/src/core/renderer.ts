import * as PIXI from 'pixi.js';
import { gsap } from 'gsap';
import { Layer, Template, TextLayer, ImageLayer, RectLayer, ClockLayer, VideoLayer } from './schema';

export function formatClockValue(layer: ClockLayer): string {
  const now = Math.floor(Date.now() / 1000);
  let total: number;
  if (layer.mode === 'clock') {
    const d = new Date();
    total = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  } else if (layer.mode === 'countup') {
    total = Math.max(0, now - (layer.startTime ?? now));
  } else {
    total = Math.max(0, (layer.targetTime ?? now) - now);
  }
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return (layer.format || 'HH:mm:ss')
    .replace('HH', String(h).padStart(2, '0'))
    .replace('mm', String(m).padStart(2, '0'))
    .replace('ss', String(s).padStart(2, '0'));
}

const SYSTEM_FONTS = new Set(['Arial', 'Helvetica', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'sans-serif', 'serif', 'monospace']);
const loadedFonts = new Set<string>();

function ensureFonts(families: string[]): Promise<boolean> {
  const toLoad = families.filter(f => f && !SYSTEM_FONTS.has(f) && !loadedFonts.has(f));
  if (toLoad.length === 0) return Promise.resolve(false);
  toLoad.forEach(family => {
    loadedFonts.add(family);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;700&display=swap`;
    document.head.appendChild(link);
  });
  return Promise.all(toLoad.map(f => document.fonts.load(`bold 16px "${f}"`).catch(() => {})))
    .then(() => true);
}

export class TemplateRenderer {
  app: PIXI.Application;
  private layerMap = new Map<string, PIXI.DisplayObject>();
  private maskMap = new Map<string, PIXI.Graphics>();
  private videoMap = new Map<string, { el: HTMLVideoElement; src: string }>();
  private layerContainer: PIXI.Container;
  private clockTimer: ReturnType<typeof setInterval> | null = null;

  constructor(canvas: HTMLCanvasElement, width: number, height: number, extraOptions: Partial<PIXI.IApplicationOptions> = {}) {
    const baseOptions: Partial<PIXI.IApplicationOptions> = {
      view: canvas,
      width,
      height,
      backgroundAlpha: 0,
      resolution: 1,
      ...extraOptions,
    };
    if (extraOptions.forceCanvas) {
      this.app = new PIXI.Application(baseOptions);
    } else {
      try {
        this.app = new PIXI.Application({ ...baseOptions, antialias: true });
      } catch {
        this.app = new PIXI.Application({ ...baseOptions, forceCanvas: true });
      }
    }
    this.layerContainer = new PIXI.Container();
    this.app.stage.addChild(this.layerContainer);
  }

  syncTemplate(template: Template, variables: Record<string, string> = {}) {
    // Load Google Fonts for any custom font families; re-render when they arrive
    const families = [...new Set(
      template.layers
        .filter((l): l is TextLayer | ClockLayer => l.type === 'text' || l.type === 'clock')
        .map(l => l.style.fontFamily)
    )];
    ensureFonts(families).then(loaded => { if (loaded) this.syncTemplate(template, variables); });

    // Clock ticker — restart on every syncTemplate so layer refs stay fresh
    if (this.clockTimer) { clearInterval(this.clockTimer); this.clockTimer = null; }
    const clockLayers = template.layers.filter((l): l is ClockLayer => l.type === 'clock');
    if (clockLayers.length > 0) {
      this.clockTimer = setInterval(() => {
        clockLayers.forEach(layer => {
          const obj = this.layerMap.get(layer.id);
          if (obj instanceof PIXI.Text) obj.text = formatClockValue(layer);
        });
      }, 1000);
    }

    // Apply canvas background
    const bg = template.canvas.background;
    if (!bg || bg === 'transparent') {
      this.app.renderer.background.alpha = 0;
    } else {
      this.app.renderer.background.color = parseInt(bg.replace('#', ''), 16);
      this.app.renderer.background.alpha = 1;
    }

    const existingIds = new Set(this.layerMap.keys());

    // Рендерим в обратном порядке (нижние слои — в конце массива)
    const reversed = [...template.layers].reverse();

    reversed.forEach((layer, index) => {
      existingIds.delete(layer.id);
      let obj = this.layerMap.get(layer.id);

      if (!obj || obj.name !== layer.type) {
        if (obj) { this.layerContainer.removeChild(obj); obj.destroy(); }
        obj = this.createPixiObject(layer);
        obj.name = layer.type;
        this.layerMap.set(layer.id, obj);
        this.layerContainer.addChildAt(obj, index);
      }

      this.applyLayer(obj, layer, variables);
      this.layerContainer.setChildIndex(obj, index);
    });

    // Удаляем лишние
    existingIds.forEach((id) => {
      const obj = this.layerMap.get(id);
      if (obj) { this.layerContainer.removeChild(obj); obj.destroy(); }
      this.layerMap.delete(id);
      const mask = this.maskMap.get(id);
      if (mask) { this.layerContainer.removeChild(mask); mask.destroy(); this.maskMap.delete(id); }
      const vid = this.videoMap.get(id);
      if (vid) { try { vid.el.pause(); vid.el.removeAttribute('src'); vid.el.load(); } catch (e) {} this.videoMap.delete(id); }
    });
  }

  private resolveValue(value: string | { type: 'variable'; variableId: string }, variables: Record<string, string>, fallback = '') {
    if (!value) return fallback;
    if (typeof value === 'string') return value;
    if (value.type === 'variable') return variables[value.variableId] ?? fallback;
    return fallback;
  }

  private createPixiObject(layer: Layer): PIXI.DisplayObject {
    switch (layer.type) {
      case 'text':
      case 'clock':  return new PIXI.Text('');
      case 'image':
      case 'video':  return new PIXI.Sprite();
      case 'rect':   return new PIXI.Graphics();
      default:       return new PIXI.Container();
    }
  }

  private applyLayer(obj: PIXI.DisplayObject, layer: Layer, variables: Record<string, string>) {
    const t = layer.transform;
    obj.x = t.x;
    obj.y = t.y;
    obj.rotation = (t.rotation * Math.PI) / 180;
    obj.alpha = layer.visible ? layer.opacity : 0;
    (obj as PIXI.Sprite).blendMode = PIXI.BLEND_MODES[layer.blendMode.toUpperCase() as keyof typeof PIXI.BLEND_MODES] ?? PIXI.BLEND_MODES.NORMAL;

    if (layer.type === 'text' || layer.type === 'clock') {
      const text = obj as PIXI.Text;
      const l = layer as TextLayer | ClockLayer;
      const fill = this.resolveValue(l.style.fill as string, variables, '#ffffff');
      text.text = layer.type === 'clock'
        ? formatClockValue(layer as ClockLayer)
        : this.resolveValue((l as TextLayer).content, variables, 'Текст');
      text.style = new PIXI.TextStyle({
        fontFamily: l.style.fontFamily || 'Arial',
        fontSize: l.style.fontSize || 48,
        fontWeight: l.style.fontWeight as any || 'bold',
        fill,
        align: l.style.align,
        lineHeight: l.style.lineHeight,
        letterSpacing: l.style.letterSpacing,
        stroke: l.style.strokeColor,
        strokeThickness: l.style.strokeWidth,
        dropShadow: l.style.dropShadow,
        dropShadowBlur: l.style.dropShadowBlur,
        dropShadowColor: l.style.dropShadowColor,
        dropShadowDistance: l.style.dropShadowDistance,
        wordWrap: true,
        wordWrapWidth: t.width,
      });
    }

    if (layer.type === 'rect') {
      const g = obj as PIXI.Graphics;
      const l = layer as RectLayer;
      const fill = this.resolveValue(l.fill, variables, '#3a3a3a');
      const rw = t.width;
      const rh = t.height;
      g.clear();
      if (l.borderWidth > 0) {
        g.lineStyle(l.borderWidth, parseInt(l.borderColor.replace('#', '0x')), 1);
      }
      g.beginFill(parseInt(fill.replace('#', '0x')));
      if (l.cornerRadius > 0) {
        g.drawRoundedRect(0, 0, rw, rh, l.cornerRadius);
      } else {
        g.drawRect(0, 0, rw, rh);
      }
      g.endFill();
    }

    if (layer.type === 'image') {
      const sprite = obj as PIXI.Sprite;
      const l = layer as ImageLayer;
      const src = this.resolveValue(l.src, variables, '');
      const currentSrc = sprite.texture?.textureCacheIds?.[0] ?? '';
      if (src && currentSrc !== src) {
        PIXI.Texture.fromURL(src).then((tex) => {
          sprite.texture = tex;
          this.applyImageFit(sprite, l);
        }).catch((err) => console.warn('Image load failed:', src, err));
      }
      this.applyImageFit(sprite, l);
    }

    if (layer.type === 'video') {
      const sprite = obj as PIXI.Sprite;
      const l = layer as VideoLayer;
      if (l.src) {
        const existing = this.videoMap.get(layer.id);
        if (!existing || existing.src !== l.src) {
          if (existing) { try { existing.el.pause(); existing.el.removeAttribute('src'); existing.el.load(); } catch (e) {} }
          const el = document.createElement('video');
          el.src = l.src;
          el.loop = l.loop;
          el.muted = true;
          el.autoplay = true;
          el.playsInline = true;
          el.crossOrigin = 'anonymous';
          el.play().catch(() => {});
          this.videoMap.set(layer.id, { el, src: l.src });
          sprite.texture = PIXI.Texture.from(el);
        } else {
          existing.el.loop = l.loop;
        }
      } else {
        sprite.texture = PIXI.Texture.EMPTY;
      }
      this.applyVideoFit(sprite, l);
    }
  }

  private applyVideoFit(sprite: PIXI.Sprite, layer: VideoLayer) {
    const t = layer.transform;
    const fit = layer.fit ?? 'stretch';
    const entry = this.videoMap.get(layer.id);
    const nw = entry?.el.videoWidth ?? 0;
    const nh = entry?.el.videoHeight ?? 0;
    const loaded = nw > 0 && nh > 0;

    if (!loaded || fit === 'stretch') {
      sprite.x = t.x; sprite.y = t.y;
      sprite.width = t.width; sprite.height = t.height;
      return;
    }

    const scale = fit === 'contain'
      ? Math.min(t.width / nw, t.height / nh)
      : Math.max(t.width / nw, t.height / nh);
    const sw = nw * scale, sh = nh * scale;
    sprite.x = t.x + (t.width - sw) / 2;
    sprite.y = t.y + (t.height - sh) / 2;
    sprite.width = sw; sprite.height = sh;

    // Cover needs a mask
    let mask = this.maskMap.get(layer.id);
    if (fit === 'cover') {
      if (!mask) {
        mask = new PIXI.Graphics();
        this.layerContainer.addChild(mask);
        this.maskMap.set(layer.id, mask);
        sprite.mask = mask;
      }
      mask.clear();
      mask.beginFill(0xffffff);
      mask.drawRect(t.x, t.y, t.width, t.height);
      mask.endFill();
    } else if (mask) {
      sprite.mask = null;
      this.layerContainer.removeChild(mask);
      mask.destroy();
      this.maskMap.delete(layer.id);
    }
  }

  private applyImageFit(sprite: PIXI.Sprite, layer: ImageLayer) {
    const t = layer.transform;
    const fit = layer.fit ?? 'stretch';
    const tex = sprite.texture;
    const loaded = tex && tex !== PIXI.Texture.EMPTY && tex.valid && tex.orig.width > 0;

    if (!loaded || fit === 'stretch') {
      sprite.x = t.x;
      sprite.y = t.y;
      sprite.width = t.width;
      sprite.height = t.height;
    } else {
      const nw = tex.orig.width;
      const nh = tex.orig.height;
      const scale = fit === 'contain'
        ? Math.min(t.width / nw, t.height / nh)
        : Math.max(t.width / nw, t.height / nh);
      const sw = nw * scale;
      const sh = nh * scale;
      sprite.x = t.x + (t.width - sw) / 2;
      sprite.y = t.y + (t.height - sh) / 2;
      sprite.width = sw;
      sprite.height = sh;
    }

    // Cover mode needs a mask to clip overflow
    let mask = this.maskMap.get(layer.id);
    if (fit === 'cover' && loaded) {
      if (!mask) {
        mask = new PIXI.Graphics();
        this.layerContainer.addChild(mask);
        this.maskMap.set(layer.id, mask);
        sprite.mask = mask;
      }
      mask.clear();
      mask.beginFill(0xffffff);
      mask.drawRect(t.x, t.y, t.width, t.height);
      mask.endFill();
    } else if (mask) {
      sprite.mask = null;
      this.layerContainer.removeChild(mask);
      mask.destroy();
      this.maskMap.delete(layer.id);
    }
  }

  getObject(id: string) { return this.layerMap.get(id); }

  playIn(template: Template, onComplete?: () => void) {
    const tl = gsap.timeline({ onComplete });
    template.tracks.forEach((track) => {
      const obj = this.layerMap.get(track.layerId);
      if (!obj || track.inKeyframes.length === 0) return;
      const fromState: Record<string, number> = { alpha: 0 };
      track.inKeyframes.forEach((kf) => {
        if (kf.fromProperties) Object.assign(fromState, kf.fromProperties);
      });
      gsap.set(obj, fromState);
      track.inKeyframes.forEach((kf) => {
        tl.to(obj, { duration: kf.time / 1000, ease: kf.easing, ...kf.properties }, 0);
      });
    });
  }

  playOut(template: Template, onComplete?: () => void) {
    const tl = gsap.timeline({ onComplete });
    template.tracks.forEach((track) => {
      const obj = this.layerMap.get(track.layerId);
      if (!obj || track.outKeyframes.length === 0) return;
      track.outKeyframes.forEach((kf) => {
        tl.to(obj, { duration: kf.time / 1000, ease: kf.easing, ...kf.properties }, 0);
      });
    });
  }

  resize(width: number, height: number) {
    this.app.renderer.resize(width, height);
  }

  destroy() {
    if (this.clockTimer) { clearInterval(this.clockTimer); this.clockTimer = null; }
    this.videoMap.forEach(({ el }) => { try { el.pause(); } catch (e) {} });
    this.maskMap.forEach((mask) => mask.destroy());
    this.maskMap.clear();
    try { this.app.destroy(true); } catch (e) { console.warn('PIXI destroy:', e); }
    this.videoMap.forEach(({ el }) => { try { el.removeAttribute('src'); el.load(); } catch (e) {} });
    this.videoMap.clear();
  }
}