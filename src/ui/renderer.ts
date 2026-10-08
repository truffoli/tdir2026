// Disegno del quadro luminoso.
import { DX, DY, shapeSegments, SHAPES, SWITCH_SHAPES, TRACK_SHAPE, CD } from '../core/geom';
import { Element, Layout, Signal, platformOf } from '../core/layout';
import { Simulation, Train } from '../core/sim';
import { Preview } from '../core/commands';

export interface Theme {
  name: string;
  bg: string; grid: string; track: string; trackDim: string; route: string; occupied: string; shunt: string;
  text: string; textDim: string; platform: string; label: string; labelBg: string;
  red: string; yellow: string; green: string; white: string; preview: string; previewBad: string; mast: string;
}

export const THEMES: Record<string, Theme> = {
  acei: {
    name: 'ACEI', bg: '#161b1f', grid: '#1f262b', track: '#7d8a93', trackDim: '#3a454c', route: '#f4f1de', occupied: '#ff453a', shunt: '#64d2ff',
    text: '#d7dde2', textDim: '#8a979f', platform: '#2f3a41', label: '#9fb3c0', labelBg: 'rgba(22,27,31,.85)',
    red: '#ff453a', yellow: '#ffd60a', green: '#30d158', white: '#f4f1de', preview: '#0a84ff', previewBad: '#ff9f0a', mast: '#a8b4bc',
  },
  classico: {
    name: 'Classico', bg: '#c0c0c0', grid: '#b4b4b4', track: '#000000', trackDim: '#8c8c8c', route: '#00b000', occupied: '#ff7a00', shunt: '#ffffff',
    text: '#000000', textDim: '#404040', platform: '#8c8c8c', label: '#00007a', labelBg: 'rgba(192,192,192,.85)',
    red: '#e00000', yellow: '#ffd000', green: '#00c000', white: '#ffffff', preview: '#0050ff', previewBad: '#ff00a0', mast: '#000000',
  },
};

const TYPE_COLORS = ['#ff9f0a', '#64d2ff', '#30d158', '#bf5af2', '#ffd60a', '#ff375f', '#5e5ce6', '#ac8e68', '#66d4cf', '#e5e5ea'];

export class Renderer {
  G = 16;
  zoom = 1;
  ox = 20;
  oy = 20;
  theme: Theme = THEMES.acei;
  showLabels = true;
  showGrid = false;
  images = new Map<string, HTMLCanvasElement>();
  preview?: Preview;
  hover?: Element;
  focusTrain?: Train;
  flash = 0;
  private dpr = 1;

  constructor(public canvas: HTMLCanvasElement, public sim: Simulation) {}

  get layout(): Layout { return this.sim.layout; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
  }

  fit() {
    const r = this.canvas.getBoundingClientRect();
    const L = this.layout;
    let minx = Infinity, miny = Infinity, maxx = 0, maxy = 0;
    for (const e of L.elements) {
      if (e.kind === 'text' && !e.name) continue;
      if (e.hidden) continue;
      minx = Math.min(minx, e.x); miny = Math.min(miny, e.y);
      maxx = Math.max(maxx, e.x + (e.kind === 'text' ? Math.ceil((e.name?.length ?? 1) * 0.6) : 1));
      maxy = Math.max(maxy, e.y + 1);
    }
    if (!isFinite(minx)) return;
    const w = (maxx - minx + 2) * this.G, h = (maxy - miny + 2) * this.G;
    this.zoom = Math.max(0.15, Math.min(3, Math.min(r.width / w, r.height / h)));
    this.ox = (r.width - (maxx - minx) * this.G * this.zoom) / 2 - minx * this.G * this.zoom;
    this.oy = (r.height - (maxy - miny) * this.G * this.zoom) / 2 - miny * this.G * this.zoom;
  }

  toCell(px: number, py: number): { x: number; y: number } {
    return { x: Math.floor((px - this.ox) / (this.G * this.zoom)), y: Math.floor((py - this.oy) / (this.G * this.zoom)) };
  }

  zoomAt(px: number, py: number, f: number) {
    const nz = Math.max(0.1, Math.min(6, this.zoom * f));
    const k = nz / this.zoom;
    this.ox = px - (px - this.ox) * k;
    this.oy = py - (py - this.oy) * k;
    this.zoom = nz;
  }

  centerOn(x: number, y: number) {
    const r = this.canvas.getBoundingClientRect();
    this.ox = r.width / 2 - (x + 0.5) * this.G * this.zoom;
    this.oy = r.height / 2 - (y + 0.5) * this.G * this.zoom;
  }

  centerIfHidden(x: number, y: number) {
    const r = this.canvas.getBoundingClientRect();
    const px = this.ox + (x + 0.5) * this.G * this.zoom, py = this.oy + (y + 0.5) * this.G * this.zoom;
    if (px < 40 || py < 40 || px > r.width - 40 || py > r.height - 40) this.centerOn(x, y);
  }

  draw() {
    const ctx = this.canvas.getContext('2d')!;
    const T = this.theme;
    const G = this.G;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const s = this.zoom * this.dpr;
    ctx.setTransform(s, 0, 0, s, this.ox * this.dpr, this.oy * this.dpr);
    const L = this.layout;
    // area visibile in celle
    const vx0 = Math.floor(-this.ox / (G * this.zoom)) - 2, vy0 = Math.floor(-this.oy / (G * this.zoom)) - 2;
    const vx1 = vx0 + Math.ceil(this.canvas.width / this.dpr / (G * this.zoom)) + 4, vy1 = vy0 + Math.ceil(this.canvas.height / this.dpr / (G * this.zoom)) + 4;
    const vis = (e: Element) => e.x >= vx0 - 30 && e.x <= vx1 && e.y >= vy0 && e.y <= vy1;

    if (this.showGrid) {
      ctx.strokeStyle = T.grid; ctx.lineWidth = 1 / this.zoom;
      ctx.beginPath();
      for (let x = Math.max(0, vx0); x <= vx1; x++) { ctx.moveTo(x * G, vy0 * G); ctx.lineTo(x * G, vy1 * G); }
      for (let y = Math.max(0, vy0); y <= vy1; y++) { ctx.moveTo(vx0 * G, y * G); ctx.lineTo(vx1 * G, y * G); }
      ctx.stroke();
    }

    // marciapiedi e immagini
    for (const e of L.elements) {
      if (!vis(e)) continue;
      if (e.kind === 'platform') {
        ctx.fillStyle = T.platform;
        if (e.dir === 1) ctx.fillRect(e.x * G, e.y * G + G * 0.3, G, G * 0.4);
        else ctx.fillRect(e.x * G + G * 0.3, e.y * G, G * 0.4, G);
      } else if (e.kind === 'image' && e.image) {
        const img = this.images.get(e.image.toLowerCase());
        if (img) { ctx.imageSmoothingEnabled = false; ctx.drawImage(img, e.x * G, e.y * G, img.width * G / 9, img.height * G / 9); }
      }
    }

    // anteprima itinerario (sotto i binari)
    const pvCells = new Set<Element>();
    if (this.preview) for (const p of this.preview.plans) for (const seg of p.segments) for (const c of seg.path.cells) pvCells.add(c.el);
    if (pvCells.size) {
      ctx.strokeStyle = this.preview?.ok ? T.preview : T.previewBad;
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(this.flash * 6);
      ctx.lineWidth = G * 0.55; ctx.lineCap = 'round';
      for (const el of pvCells) this.strokeShape(ctx, el, this.previewShape(el));
      ctx.globalAlpha = 1;
    }

    // binari
    ctx.lineCap = 'round';
    for (const e of L.tracks.values()) {
      if (!vis(e) || e.hidden) continue;
      const col = this.cellColor(e);
      if (e.kind === 'switch') {
        const sh = SWITCH_SHAPES[e.dir];
        if (!sh) continue;
        // ramo non attivo, tenue
        ctx.strokeStyle = T.trackDim; ctx.lineWidth = G * 0.14;
        this.strokeShape(ctx, e, SHAPES[sh[e.switched ? 0 : 1]]);
        ctx.strokeStyle = col; ctx.lineWidth = G * (e.state === 'free' ? 0.2 : 0.28);
        this.strokeShape(ctx, e, SHAPES[sh[e.switched ? 1 : 0]]);
      } else {
        const n = TRACK_SHAPE[e.dir];
        if (!n) continue;
        ctx.strokeStyle = col; ctx.lineWidth = G * (e.state === 'free' ? 0.2 : 0.28);
        this.strokeShape(ctx, e, SHAPES[n]);
      }
    }

    // testi
    ctx.textBaseline = 'middle';
    for (const t of L.texts.values()) {
      if (!vis(t) || !t.name || t.hidden) continue;
      const isEntry = (t.wlink && (t.wlink.x || t.wlink.y)) || (t.elink && (t.elink.x || t.elink.y));
      ctx.font = `${isEntry ? 600 : 500} ${G * 0.72}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = isEntry ? T.text : T.textDim;
      ctx.fillText(t.name, t.x * G, t.y * G + G / 2);
      if (isEntry && t.label && t.label !== t.name && this.showLabels) {
        const w = ctx.measureText(t.name).width;
        this.badge(ctx, t.label, t.x * G + w + 4, t.y * G + G / 2, T.preview);
      }
    }

    // numeri dei binari di stazione: targhetta sul binario
    if (this.showLabels && this.zoom > 0.35) {
      ctx.font = `700 ${G * 0.5}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textAlign = 'center';
      for (const e of L.stationTracks()) {
        if (!vis(e) || e.hidden || this.sim.trainAt(e)) continue;
        const p = platformOf(e.name!);
        if (!p) continue;
        const w = Math.max(G * 0.7, ctx.measureText(p).width + G * 0.3);
        ctx.fillStyle = T.bg; ctx.strokeStyle = e.state === 'free' ? T.track : this.cellColor(e); ctx.lineWidth = G * 0.08;
        roundRect(ctx, e.x * G + G / 2 - w / 2, e.y * G + G * 0.15, w, G * 0.7, G * 0.2);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = T.text;
        ctx.fillText(p, e.x * G + G / 2, e.y * G + G / 2 + 0.5);
      }
      ctx.textAlign = 'left';
    }

    // segnali
    for (const s of L.signals) {
      if (!vis(s) || s.hidden) continue;
      this.drawSignal(ctx, s);
    }

    // etichette deviatoi
    if (this.showLabels && this.zoom > 0.5) {
      ctx.font = `500 ${G * 0.45}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.fillStyle = T.label;
      for (const sw of L.switches) {
        if (!vis(sw) || !sw.label || sw.hidden) continue;
        const hl = this.preview?.switches.includes(sw);
        ctx.fillStyle = hl ? T.preview : T.label;
        ctx.fillText(sw.label, sw.x * G + G * 0.1, sw.y * G + G * 1.05);
      }
    }

    // pulsanti itinerario
    for (const e of L.elements) {
      if (e.kind !== 'itin' || !vis(e) || !e.name) continue;
      ctx.fillStyle = T.platform; ctx.strokeStyle = T.label; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(e.x * G + G / 2, e.y * G + G / 2, G * 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (this.zoom > 0.8) { ctx.font = `${G * 0.45}px Inter, sans-serif`; ctx.fillStyle = T.textDim; ctx.fillText(e.name, e.x * G + G, e.y * G + G / 2); }
    }

    // treni
    for (const t of this.sim.trains) if (t.occ.length) this.drawTrain(ctx, t);

    // evidenziazione
    if (this.hover) {
      ctx.strokeStyle = T.preview; ctx.lineWidth = 1.5 / this.zoom;
      ctx.strokeRect(this.hover.x * G, this.hover.y * G, G, G);
    }
  }

  private previewShape(el: Element) {
    for (const p of this.preview?.plans ?? []) {
      if (el.kind === 'switch' && p.switches.has(el)) return SHAPES[SWITCH_SHAPES[el.dir][p.switches.get(el) ? 1 : 0]];
    }
    return this.layout.shape(el)!;
  }

  private cellColor(e: Element): string {
    const T = this.theme;
    switch (e.state) {
      case 'route': return T.route;
      case 'occupied': return T.occupied;
      case 'shunt': return T.shunt;
      default: return T.track;
    }
  }

  private strokeShape(ctx: CanvasRenderingContext2D, e: Element, shape: Record<number, number | undefined> | undefined) {
    if (!shape) return;
    const G = this.G;
    const cx = e.x * G + G / 2, cy = e.y * G + G / 2;
    ctx.beginPath();
    for (const [a, b] of shapeSegments(shape)) {
      ctx.moveTo(cx + DX[a] * G / 2, cy + DY[a] * G / 2);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + DX[b] * G / 2, cy + DY[b] * G / 2);
    }
    ctx.stroke();
  }

  private badge(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
    const G = this.G;
    ctx.font = `700 ${G * 0.5}px "JetBrains Mono", ui-monospace, monospace`;
    const w = ctx.measureText(text).width + G * 0.35;
    ctx.fillStyle = color;
    roundRect(ctx, x, y - G * 0.34, w, G * 0.68, G * 0.18);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x + G * 0.17, y + 0.5);
  }

  private drawSignal(ctx: CanvasRenderingContext2D, s: Signal) {
    const T = this.theme, G = this.G;
    const cx = s.x * G + G / 2, cy = s.y * G + G / 2;
    // verso di marcia protetto: est = testa a destra
    const east = s.dir === 1, north = s.dir === 17, south = s.dir === 16;
    const vx = east ? 1 : north || south ? 0 : -1, vy = north ? -1 : south ? 1 : 0;
    const r = G * (s.approach ? 0.22 : 0.3);
    const hx = cx + vx * G * 0.18, hy = cy + vy * G * 0.18;
    const col = s.aspect === 'green' ? T.green : s.aspect === 'yellow' ? T.yellow : s.aspect === 'white' ? T.white : T.red;
    // palo
    ctx.strokeStyle = T.mast; ctx.lineWidth = G * 0.09;
    ctx.beginPath();
    ctx.moveTo(hx - vx * G * 0.62, hy - vy * G * 0.62); ctx.lineTo(hx - vx * r, hy - vy * r);
    if (vx) { ctx.moveTo(hx - vx * G * 0.62, hy - G * 0.22); ctx.lineTo(hx - vx * G * 0.62, hy + G * 0.22); }
    else { ctx.moveTo(hx - G * 0.22, hy - vy * G * 0.62); ctx.lineTo(hx + G * 0.22, hy - vy * G * 0.62); }
    ctx.stroke();
    // luce
    const hl = this.preview?.signals.includes(s) || this.preview?.plans.some((p) => p.segments.some((g) => g.signal === s));
    ctx.fillStyle = col;
    if (s.approach) { ctx.globalAlpha = 0.85; }
    ctx.beginPath();
    if (s.fixedRed) ctx.rect(hx - r, hy - r, 2 * r, 2 * r); else ctx.arc(hx, hy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (s.fleeted) {
      ctx.strokeStyle = s.nowFleeted ? T.green : T.mast; ctx.lineWidth = G * 0.07;
      ctx.beginPath(); ctx.arc(hx, hy, r + G * 0.1, 0, Math.PI * 2); ctx.stroke();
    }
    if (hl) {
      ctx.strokeStyle = T.preview; ctx.lineWidth = G * 0.1;
      ctx.beginPath(); ctx.arc(hx, hy, r + G * 0.2, 0, Math.PI * 2); ctx.stroke();
    }
    if (this.showLabels && s.label && !s.approach && this.zoom > 0.35) {
      ctx.font = `700 ${G * 0.5}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.fillStyle = hl ? T.preview : T.label;
      const w = ctx.measureText(s.label).width;
      const lx = east ? hx - G * 0.75 - w : hx + G * 0.75;
      ctx.fillText(s.label, vx ? lx : hx + G * 0.4, vx ? hy : hy);
    }
  }

  private drawTrain(ctx: CanvasRenderingContext2D, t: Train) {
    const T = this.theme, G = this.G;
    const head = t.occ[0];
    const col = TYPE_COLORS[t.type % TYPE_COLORS.length];
    // freccia di direzione sulla testa
    const out = this.layout.shape(head.el)?.[head.dir] ?? head.dir;
    const cx = head.el.x * G + G / 2, cy = head.el.y * G + G / 2;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    const ax = DX[out], ay = DY[out];
    const n = Math.hypot(ax, ay) || 1;
    const ux = ax / n, uy = ay / n;
    ctx.moveTo(cx + ux * G * 0.42, cy + uy * G * 0.42);
    ctx.lineTo(cx - uy * G * 0.22, cy + ux * G * 0.22);
    ctx.lineTo(cx + uy * G * 0.22, cy - ux * G * 0.22);
    ctx.fill();
    // etichetta con il nome del treno
    if (this.zoom < 0.3) return;
    const name = shortTrainName(t.name);
    ctx.font = `700 ${G * 0.62}px "JetBrains Mono", ui-monospace, monospace`;
    const w = ctx.measureText(name).width + G * 0.5;
    const east = out === CD.E || out === CD.NE || out === CD.SE;
    const lx = east ? cx - w + G * 0.3 : cx - G * 0.3;
    const ly = cy - G * 1.25;
    const focused = this.focusTrain === t;
    ctx.fillStyle = t.status === 'waiting' ? T.red : focused ? T.preview : col;
    roundRect(ctx, lx, ly - G * 0.42, w, G * 0.84, G * 0.22);
    ctx.fill();
    if (focused) { ctx.strokeStyle = '#fff'; ctx.lineWidth = G * 0.08; ctx.stroke(); }
    ctx.fillStyle = '#0b0f12';
    ctx.fillText(name, lx + G * 0.25, ly + 0.5);
  }

  /** Elemento più rilevante sotto il puntatore (segnale, scambio, binario, testo). */
  pick(px: number, py: number): Element | undefined {
    const { x, y } = this.toCell(px, py);
    const L = this.layout;
    const s = L.signals.find((q) => q.x === x && q.y === y && !q.hidden);
    if (s) return s;
    const tr = L.trackAt(x, y);
    if (tr) return tr;
    for (const t of L.texts.values()) if (t.y === y && t.x <= x && x <= t.x + Math.ceil((t.name?.length ?? 1) * 0.55)) return t;
    // segnali adiacenti (tolleranza)
    return L.signals.find((q) => Math.abs(q.x - x) <= 0 && Math.abs(q.y - y) <= 1 && !q.hidden);
  }
}

/** Nome breve del treno da mostrare sul quadro: la parte con il numero. */
export function shortTrainName(n: string): string {
  const parts = n.split(/\s+/);
  return parts.find((p) => /\d/.test(p)) ?? parts[0];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
