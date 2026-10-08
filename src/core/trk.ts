// Lettura/scrittura del formato tracciato .trk di Train Director 3.
import { Element, Itinerary, Layout, Pt, Signal } from './layout';
import { TD } from './geom';

class Cursor {
  constructor(public s: string, public i = 0) {}
  get ch() { return this.s[this.i] ?? ''; }
  eof() { return this.i >= this.s.length; }
  num(): number {
    const m = /^[ \t]*[-+]?\d+(\.\d+)?/.exec(this.s.slice(this.i));
    if (!m) return 0;
    this.i += m[0].length;
    return Number(m[0]);
  }
  comma() { if (this.ch === ',') this.i++; }
  rest() { return this.s.slice(this.i); }
  until(c: string): string {
    const j = this.s.indexOf(c, this.i);
    const r = j < 0 ? this.s.slice(this.i) : this.s.slice(this.i, j);
    this.i = j < 0 ? this.s.length : j;
    return r;
  }
}

const pt = (x: number, y: number): Pt | undefined => (x || y ? { x, y } : undefined);

function parseSpeeds(c: Cursor): number[] {
  const sp: number[] = [];
  if (c.ch !== '@') return sp;
  c.i++;
  sp.push(c.num());
  while ((c.ch as string) === '/') { c.i++; sp.push(c.num()); }
  c.comma();
  return sp;
}

function parseKm(c: Cursor): number | undefined {
  if (c.ch !== '>') return undefined;
  c.i++;
  const v = c.num();
  c.comma();
  return v;
}

/** Heuristica per gli scritti RFI che non possiamo eseguire: avvisi, ripetitori, e indicatori non arrestano i treni. */
export function isApproachScript(file: string | undefined, tds?: Map<string, string>): boolean {
  if (!file) return false;
  const f = file.toLowerCase();
  const src = tds?.get(f);
  if (src) {
    const actions = [...src.matchAll(/^\s*Action:\s*(\S+)/gim)].map((m) => m[1].toLowerCase());
    if (actions.length && actions.every((a) => a === 'none')) return true;
    if (actions.length && actions.some((a) => a === 'stop')) return false;
  }
  return /avv|avanz|rip|ind/.test(f) && !/prot|part|blocco|bl_/.test(f);
}

export interface TrkOptions { tds?: Map<string, string> }

export function parseTrk(text: string, opts: TrkOptions = {}): Layout {
  const L = new Layout();
  const lines = text.replace(/\r/g, '').split('\n');
  const byXY = new Map<string, Element>();
  const find = (x: number, y: number) => byXY.get(x + ',' + y);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (!line) continue;
    if (line.startsWith('(script ')) {
      const c = new Cursor(line, 8);
      const x = c.num(); c.comma(); const y = c.num();
      const body: string[] = [];
      while (++li < lines.length && !lines[li].startsWith(')')) body.push(lines[li]);
      const t = find(x, y);
      if (t) t.script = body.join('\n');
      continue;
    }
    if (line.startsWith('(attributes ')) {
      const c = new Cursor(line, 12);
      const x = c.num(); c.comma(); const y = c.num();
      const t = find(x, y) as Signal | undefined;
      while (++li < lines.length && !lines[li].startsWith(')')) {
        const a = lines[li].trim();
        if (!t) continue;
        if (a === 'hidden') t.hidden = true;
        else if (a.startsWith('intermediate')) { t.intermediate = /\d/.test(a) ? Number(a.slice(12)) !== 0 : true; if (t.intermediate) t.fleeted = false; }
        else if (a.startsWith('departure')) t.departure = /\d/.test(a) ? Number(a.slice(9)) !== 0 : true;
        else if (a.startsWith('locked')) t.lockedBy = a.slice(6).trim();
        else if (a.startsWith('power:')) t.power = a.slice(6).trim();
      }
      continue;
    }
    if (line.startsWith('(zones') ) {
      while (++li < lines.length && !lines[li].startsWith(')'));
      continue;
    }
    if (line.startsWith('(')) {
      // (switchboard ...) e altre estensioni: ignorate
      if (!line.includes(')')) while (++li < lines.length && !lines[li].startsWith(')'));
      continue;
    }
    const type = line[0];
    if (!/[0-9]/.test(type)) continue;
    const c = new Cursor(line, 1);
    c.comma();
    const x = c.num(); c.comma();
    const y = c.num(); c.comma();
    const dir = c.num(); c.comma();
    let e: Element | undefined;
    switch (type) {
      case '0': {
        const isStation = c.num() !== 0; c.comma();
        const length = c.num() || 1; c.comma();
        const wx = c.num(); c.comma(); const wy = c.num(); c.comma();
        const ex = c.num(); c.comma(); const ey = c.num(); c.comma();
        const speed = parseSpeeds(c);
        const km = parseKm(c);
        let name: string | undefined = c.rest();
        if (!name || name === 'noname') name = undefined;
        e = L.add({ kind: 'track', x, y, dir, length, isStation: isStation && !!name, name, wlink: pt(wx, wy), elink: pt(ex, ey), speed, km });
        break;
      }
      case '1': {
        // 1,x,y,tipo,linkx,linky[@vel][,]nome
        const c2 = new Cursor(line, 1); c2.comma(); c2.num(); c2.comma(); c2.num(); c2.comma(); c2.num(); c2.comma();
        const wx = c2.num(); c2.comma(); const wy = c2.num();
        const speed = parseSpeeds(c2);
        c2.comma();
        const km = parseKm(c2);
        let name: string | undefined = c2.rest();
        if (!name || name === 'noname') name = undefined;
        e = L.add({ kind: 'switch', x, y, dir, length: 1, isStation: false, name, wlink: pt(wx, wy), speed, km });
        break;
      }
      case '2': {
        let l = dir;
        const fleeted = (l & 2) !== 0; l &= ~2;
        const fixedRed = (l & 0x100) !== 0, noPenalty = (l & 0x200) !== 0, noClickPenalty = (l & 0x800) !== 0;
        l &= ~0xf00;
        let sdir: number = l === 1 ? TD.W_E : l === 0 ? TD.E_W : l;
        const wx = c.num(); c.comma(); const wy = c.num(); c.comma();
        let scriptFile: string | undefined;
        if (c.ch === '@') { c.i++; scriptFile = c.until(','); c.comma(); }
        let name: string | undefined = c.rest() || undefined;
        const s = L.add({ kind: 'signal', x, y, dir: sdir, length: 1, isStation: false, name, wlink: pt(wx, wy) }) as Signal;
        Object.assign(s, {
          fleeted, nowFleeted: false, fixedRed, noPenalty, noClickPenalty, intermediate: false, departure: false,
          clear: false, aspect: 'red', scriptFile, shunting: false,
          approach: isApproachScript(scriptFile, opts.tds),
        });
        e = s;
        break;
      }
      case '3':
        e = L.add({ kind: 'platform', x, y, dir: dir === 0 ? TD.W_E : TD.N_S, length: 1, isStation: false });
        break;
      case '4': {
        const name = c.until(','); c.comma();
        const wx = c.num(); c.comma(); const wy = c.num(); c.comma();
        const ex = c.num(); c.comma(); const ey = c.num();
        const km = parseKm(c);
        e = L.add({ kind: 'text', x, y, dir, length: 1, isStation: false, name, wlink: pt(wx, wy), elink: pt(ex, ey), km });
        break;
      }
      case '5': {
        let link: Pt | undefined;
        if (c.ch === '@') { c.i++; const lx = c.num(); c.comma(); const ly = c.num(); c.comma(); link = pt(lx, ly); }
        e = L.add({ kind: 'image', x, y, dir, length: 1, isStation: false, image: c.rest(), wlink: link });
        break;
      }
      case '6':
        L.info.push(line.slice(line.indexOf(',', 1) + 1));
        break;
      case '7': {
        const it = parseItinerary(c.rest());
        if (it) L.itineraries.push(it);
        break;
      }
      case '8':
        e = L.add({ kind: 'itin', x, y, dir, length: 1, isStation: false, name: c.rest() });
        break;
      case '9': {
        const wx = c.num(); c.comma(); const wy = c.num(); c.comma();
        const ex = c.num(); c.comma(); const ey = c.num(); c.comma();
        e = L.add({ kind: 'trigger', x, y, dir, length: 1, isStation: false, wlink: pt(wx, wy), elink: pt(ex, ey), name: c.rest().replace(/^[\d/]*,/, '') });
        break;
      }
    }
    if (e && e.kind !== 'text' && e.kind !== 'image') byXY.set(x + ',' + y, e);
    else if (e) { if (!byXY.has(x + ',' + y)) byXY.set(x + ',' + y, e); }
  }
  L.finalize();
  return L;
}

/** Divide sulla virgola rispettando le parentesi, come il programma originale. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseItinerary(rest: string): Itinerary | undefined {
  const f = splitTop(rest);
  if (f.length < 3) return undefined;
  const it: Itinerary = { name: f[0], startSignal: f[1], endSignal: f[2], switches: [] };
  let i = 3;
  if (f[i]?.startsWith('@')) { const n = f[i].slice(1); if (n) it.next = n; i++; }
  for (; i + 2 < f.length; i += 3) {
    if (f[i] === '' ) break;
    it.switches.push({ x: Number(f[i]), y: Number(f[i + 1]), thrown: Number(f[i + 2]) !== 0 });
  }
  return it;
}

// ------------------------------------------------------------------ scrittura

export function serializeTrk(L: Layout): string {
  const out: string[] = [];
  const P = (p?: Pt) => (p ? `${p.x},${p.y}` : '0,0');
  const sp = (e: Element) => (e.speed.length ? '@' + e.speed.join('/') + ',' : '');
  for (const e of L.elements) {
    switch (e.kind) {
      case 'track':
        out.push(`0,${e.x},${e.y},${e.dir},${e.isStation ? 1 : 0},${e.length},${P(e.wlink)},${P(e.elink)},${sp(e)}${e.name ?? 'noname'}`);
        break;
      case 'switch':
        out.push(`1,${e.x},${e.y},${e.dir},${P(e.wlink)}${e.speed.length ? '@' + e.speed.join('/') + ',' : ''}${e.name ?? 'noname'}`);
        break;
      case 'signal': {
        const s = e as Signal;
        let d = s.dir === TD.W_E ? 1 : s.dir === TD.E_W ? 0 : s.dir;
        if (s.fleeted) d |= 2;
        if (s.fixedRed) d |= 0x100;
        if (s.noPenalty) d |= 0x200;
        if (s.noClickPenalty) d |= 0x800;
        out.push(`2,${s.x},${s.y},${d},${P(s.wlink)}${s.scriptFile ? ',@' + s.scriptFile : ''}${s.name ? ',' + s.name : ''}`);
        break;
      }
      case 'platform': out.push(`3,${e.x},${e.y},${e.dir === TD.W_E ? 0 : 1}`); break;
      case 'text': out.push(`4,${e.x},${e.y},${e.dir},${e.name ?? ''},${P(e.wlink)},${P(e.elink)}`); break;
      case 'image': out.push(`5,${e.x},${e.y},0,${e.image ?? ''}`); break;
      case 'itin': out.push(`8,${e.x},${e.y},0,${e.name ?? ''}`); break;
    }
  }
  for (const it of L.itineraries) {
    const sw = it.switches.map((s) => `${s.x},${s.y},${s.thrown ? 1 : 0},`).join('');
    out.push(`7,0,0,0,${it.name},${it.startSignal},${it.endSignal},@${it.next ?? ''},${sw}`);
  }
  for (const s of L.signals) {
    const attrs: string[] = [];
    if (s.intermediate) attrs.push('intermediate 1');
    if (s.departure) attrs.push('departure 1');
    if (s.hidden) attrs.push('hidden');
    if (attrs.length) out.push(`(attributes ${s.x},${s.y}`, ...attrs, ')');
  }
  return out.join('\n') + '\n';
}
