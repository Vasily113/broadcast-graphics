import { create } from 'zustand';
import { temporal } from 'zundo';
import { Template, Layer, Variable, createDefaultTemplate } from './schema';

interface EditorState {
  template: Template;
  savedTemplate: Template;
  selectedLayerIds: string[];
  tool: 'select' | 'text' | 'rect' | 'image' | 'clock' | 'video';
  zoom: number;
  previewMode: 'design' | 'in' | 'out';

  setTemplate: (t: Template) => void;
  setTemplateName: (name: string) => void;
  markSaved: () => void;
  updateCanvas: (patch: Partial<Template['canvas']>) => void;

  addLayer: (layer: Layer) => void;
  addLayers: (layers: Layer[]) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  deleteLayer: (id: string) => void;
  reorderLayers: (from: number, to: number) => void;

  selectLayer: (id: string | null, multi?: boolean) => void;
  alignLayers: (type: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'hdistribute' | 'vdistribute') => void;
  shiftLayerOrder: (id: string, direction: 'up' | 'down') => void;
  setTool: (tool: EditorState['tool']) => void;
  setZoom: (zoom: number) => void;
  setPreviewMode: (mode: EditorState['previewMode']) => void;
  snapToGrid: boolean;
  gridSize: number;
  setSnapToGrid: (v: boolean) => void;
  setGridSize: (v: number) => void;

  addVariable: (variable: Variable) => void;
  updateVariable: (id: string, patch: Partial<Variable>) => void;
  deleteVariable: (id: string) => void;

  setTrack: (layerId: string, track: import('./schema').AnimationTrack | null) => void;
}

const defaultTemplate = createDefaultTemplate();

export const useEditorStore = create<EditorState>()(
  temporal(
    (set, get) => ({
      template: defaultTemplate,
      savedTemplate: defaultTemplate,
      selectedLayerIds: [],
      tool: 'select',
      zoom: 0.5,
      previewMode: 'design',
      snapToGrid: false,
      gridSize: 20,

      setTemplate: (template) => set({ template, savedTemplate: template, selectedLayerIds: [] }),
      setTemplateName: (name) => set((s) => ({ template: { ...s.template, name } })),
      markSaved: () => set({ savedTemplate: get().template }),

      updateCanvas: (patch) =>
        set((s) => ({ template: { ...s.template, canvas: { ...s.template.canvas, ...patch } } })),

      addLayer: (layer) =>
        set((s) => ({ template: { ...s.template, layers: [layer, ...s.template.layers] } })),

      addLayers: (layers) =>
        set((s) => ({ template: { ...s.template, layers: [...layers, ...s.template.layers] } })),

      updateLayer: (id, patch) =>
        set((s) => ({
          template: {
            ...s.template,
            layers: s.template.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)),
          },
        })),

      deleteLayer: (id) =>
        set((s) => ({
          template: { ...s.template, layers: s.template.layers.filter((l) => l.id !== id) },
          selectedLayerIds: s.selectedLayerIds.filter((sid) => sid !== id),
        })),

      reorderLayers: (from, to) =>
        set((s) => {
          const layers = [...s.template.layers];
          const [item] = layers.splice(from, 1);
          layers.splice(to, 0, item);
          return { template: { ...s.template, layers } };
        }),

      selectLayer: (id, multi = false) =>
        set((s) => ({
          selectedLayerIds: id === null
            ? []
            : multi
            ? s.selectedLayerIds.includes(id)
              ? s.selectedLayerIds.filter((i) => i !== id)
              : [...s.selectedLayerIds, id]
            : [id],
        })),

      alignLayers: (type) =>
        set((s) => {
          const sel = s.template.layers.filter((l) => s.selectedLayerIds.includes(l.id));
          if (sel.length < 2) return {};
          const boxes = sel.map((l) => ({
            id: l.id,
            x: l.transform.x, y: l.transform.y,
            w: l.transform.width, h: l.transform.height,
          }));
          const minX = Math.min(...boxes.map((b) => b.x));
          const maxX = Math.max(...boxes.map((b) => b.x + b.w));
          const minY = Math.min(...boxes.map((b) => b.y));
          const maxY = Math.max(...boxes.map((b) => b.y + b.h));

          const updates: Record<string, { x?: number; y?: number }> = {};

          if (type === 'left') {
            boxes.forEach((b) => { updates[b.id] = { x: minX }; });
          } else if (type === 'right') {
            boxes.forEach((b) => { updates[b.id] = { x: maxX - b.w }; });
          } else if (type === 'hcenter') {
            const cx = (minX + maxX) / 2;
            boxes.forEach((b) => { updates[b.id] = { x: cx - b.w / 2 }; });
          } else if (type === 'top') {
            boxes.forEach((b) => { updates[b.id] = { y: minY }; });
          } else if (type === 'bottom') {
            boxes.forEach((b) => { updates[b.id] = { y: maxY - b.h }; });
          } else if (type === 'vcenter') {
            const cy = (minY + maxY) / 2;
            boxes.forEach((b) => { updates[b.id] = { y: cy - b.h / 2 }; });
          } else if (type === 'hdistribute') {
            const sorted = [...boxes].sort((a, b) => a.x - b.x);
            const totalW = sorted.reduce((s, b) => s + b.w, 0);
            const gap = (maxX - minX - totalW) / (sorted.length - 1);
            let cursor = minX;
            sorted.forEach((b) => { updates[b.id] = { x: cursor }; cursor += b.w + gap; });
          } else if (type === 'vdistribute') {
            const sorted = [...boxes].sort((a, b) => a.y - b.y);
            const totalH = sorted.reduce((s, b) => s + b.h, 0);
            const gap = (maxY - minY - totalH) / (sorted.length - 1);
            let cursor = minY;
            sorted.forEach((b) => { updates[b.id] = { y: cursor }; cursor += b.h + gap; });
          }

          return {
            template: {
              ...s.template,
              layers: s.template.layers.map((l) => {
                const u = updates[l.id];
                if (!u) return l;
                return { ...l, transform: { ...l.transform, ...u } };
              }),
            },
          };
        }),

      shiftLayerOrder: (id, direction) =>
        set((s) => {
          const idx = s.template.layers.findIndex((l) => l.id === id);
          if (idx === -1) return {};
          const newIdx = direction === 'up' ? idx - 1 : idx + 1;
          if (newIdx < 0 || newIdx >= s.template.layers.length) return {};
          const layers = [...s.template.layers];
          const [item] = layers.splice(idx, 1);
          layers.splice(newIdx, 0, item);
          return { template: { ...s.template, layers } };
        }),

      setTool: (tool) => set({ tool }),
      setZoom: (zoom) => set({ zoom }),
      setPreviewMode: (previewMode) => set({ previewMode }),
      setSnapToGrid: (snapToGrid) => set({ snapToGrid }),
      setGridSize: (gridSize) => set({ gridSize }),

      addVariable: (variable) =>
        set((s) => ({ template: { ...s.template, variables: [...s.template.variables, variable] } })),

      updateVariable: (id, patch) =>
        set((s) => ({
          template: {
            ...s.template,
            variables: s.template.variables.map((v) => (v.id === id ? { ...v, ...patch } : v)),
          },
        })),

      deleteVariable: (id) =>
        set((s) => ({
          template: { ...s.template, variables: s.template.variables.filter((v) => v.id !== id) },
        })),

      setTrack: (layerId, track) =>
        set((s) => {
          const tracks = s.template.tracks.filter((t) => t.layerId !== layerId);
          if (track) tracks.push(track);
          return { template: { ...s.template, tracks } };
        }),
    }),
    {
      limit: 50,
      partialize: (s) => ({
        template: s.template,
        selectedLayerIds: s.selectedLayerIds,
        // tool/zoom/previewMode/snapToGrid/gridSize excluded
      }),
    }
  )
);

export const selectIsDirty = (s: EditorState) =>
  JSON.stringify(s.template) !== JSON.stringify(s.savedTemplate);
