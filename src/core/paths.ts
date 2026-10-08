// Percorrenza dei binari e ricerca degli itinerari.
import { CD, DX, DY, OPPOSITE, validEntry, isEastbound, Shape } from './geom';
import { Element, Layout, Signal } from './layout';

export interface Cell { el: Element; dir: number }

export interface BlockPath {
  cells: Cell[];
  /** segnale che chiude la sezione (davanti all'ultimo elemento) */
  endSignal?: Signal;
  /** elemento successivo (protetto da endSignal) */
  nextEl?: Element;
  nextDir?: number;
  /** punto di uscita dal tracciato, se la sezione termina fuori impianto */
  exit?: Element;
  /** la sezione termina contro un paraurti / fine binario */
  deadEnd: boolean;
}

export function signalFor(el: Element, cd: number): Signal | undefined {
  return isEastbound(cd) ? el.esignal : el.wsignal;
}

/** Il segnale arresta i treni? (gli avvisi e le marmotte no) */
export function isStopSignal(s: Signal | undefined): s is Signal {
  return !!s && !s.approach;
}

export interface Step { x: number; y: number; dir: number; viaLink?: boolean }

/**
 * Uscita da un elemento: restituisce coordinate del prossimo elemento e direzione,
 * gestendo i collegamenti ("link") tra binari come il programma originale.
 */
export function walkTrack(L: Layout, el: Element, dir: number, shape?: Shape): Step | null {
  shape = shape ?? L.shape(el);
  if (!shape) return null;
  const out = shape[dir];
  if (out === undefined) return null;
  if (el.kind === 'track') {
    const westish = out === CD.W || out === CD.NW || out === CD.SW;
    const eastish = out === CD.E || out === CD.NE || out === CD.SE;
    let link = undefined as { x: number; y: number } | undefined, amb = 0;
    if ((out === CD.N && dir === CD.N) || westish) { link = el.wlink; amb = out === CD.N ? CD.N : CD.W; }
    else if ((out === CD.S && dir === CD.S) || eastish) { link = el.elink; amb = out === CD.S ? CD.S : CD.E; }
    if (link && link.x && link.y) {
      if (link.x === el.x && link.y === el.y) return null;
      const t = L.trackAt(link.x, link.y);
      if (!t) return null;
      return { x: link.x, y: link.y, dir: validEntry(L.shape(t), amb), viaLink: true };
    }
  }
  return { x: el.x + DX[out], y: el.y + DY[out], dir: out };
}

/**
 * Calcola la sezione di blocco che inizia con "start" percorso in direzione "dir":
 * prosegue fino al prossimo segnale (non di avviso) o fino all'uscita dal tracciato.
 * Restituisce null se il percorso non è percorribile (es. scambio tallonato).
 */
export function blockPath(L: Layout, start: Element, dir: number, switchOverride?: Map<Element, boolean>, maxLen = 5000): BlockPath | null {
  const cells: Cell[] = [];
  let el = start;
  let cd = validEntry(shapeWith(L, start, switchOverride), dir);
  for (let guard = 0; guard < maxLen; guard++) {
    cells.push({ el, dir: cd });
    const step = walkTrack(L, el, cd, shapeWith(L, el, switchOverride));
    if (!step) return null;
    const nxt = L.trackAt(step.x, step.y);
    if (!nxt) {
      const exit = L.linkedText(el.x, el.y);
      return { cells, exit, deadEnd: !exit };
    }
    let ndir = step.dir;
    if (!step.viaLink && nxt.kind === 'track') {
      // binari collegati a "U" (uscita opposta all'entrata)
      if (nxt.x === el.wlink?.x && nxt.y === el.wlink?.y && nxt.wlink?.x === el.x && nxt.wlink?.y === el.y)
        ndir = validEntry(L.shape(nxt), CD.E);
      if (nxt.x === el.elink?.x && nxt.y === el.elink?.y && nxt.elink?.x === el.x && nxt.elink?.y === el.y)
        ndir = validEntry(L.shape(nxt), CD.W);
    }
    const s = signalFor(nxt, ndir);
    if (isStopSignal(s)) return { cells, endSignal: s, nextEl: nxt, nextDir: ndir, deadEnd: false };
    // verifica che si possa entrare nel prossimo elemento in questa direzione
    const ns = shapeWith(L, nxt, switchOverride);
    if (!ns || ns[ndir] === undefined) {
      // scambio tallonato o fine binario: la sezione non è percorribile
      if (nxt.kind === 'switch') return null;
      return { cells, deadEnd: true };
    }
    el = nxt; cd = ndir;
  }
  return null;
}

function shapeWith(L: Layout, el: Element, ov?: Map<Element, boolean>): Shape | undefined {
  if (ov && el.kind === 'switch' && ov.has(el)) return L.shapeFor(el, ov.get(el)!);
  return L.shape(el);
}

export function pathLength(cells: Cell[]): number {
  return cells.reduce((s, c) => s + (c.el.length || 1), 0);
}

/** Direzione di uscita da un elemento dato l'ingresso. */
export function exitDir(L: Layout, el: Element, dir: number): number {
  const s = L.shape(el);
  return s?.[dir] ?? dir;
}

export function reverseDir(L: Layout, el: Element, dir: number): number {
  return OPPOSITE[exitDir(L, el, dir)];
}

// ------------------------------------------------------------- ricerca itinerari

export interface RouteSegment {
  signal: Signal;
  path: BlockPath;
}

export interface RoutePlan {
  segments: RouteSegment[];
  /** posizioni degli scambi richieste */
  switches: Map<Element, boolean>;
  target: Signal | Element;
}

export type Target = { signal: Signal } | { exit: Element } | { station: string };

/**
 * Ricerca "da segnale a destinazione" (entrata-uscita, come un banco ACEI):
 * trova la combinazione di scambi che porta dal segnale di partenza alla
 * destinazione, eventualmente attraversando altri segnali intermedi.
 * Preferisce gli scambi nella posizione attuale.
 */
export function findRoute(L: Layout, from: Signal, target: Target, canThrow: (sw: Element) => boolean, maxSignals = 6, isFree?: (bp: BlockPath, sig: Signal) => boolean): RoutePlan | null {
  if (!from.controls) return null;
  const ov = new Map<Element, boolean>();
  const segments: RouteSegment[] = [];
  const visited = new Set<string>();

  const matches = (bp: BlockPath): boolean => {
    if ('signal' in target) return bp.endSignal === target.signal;
    if ('exit' in target) return !!bp.exit && (bp.exit === target.exit || bp.exit.name === target.exit.name);
    return false;
  };

  // DFS su (segnale, scelte degli scambi). Per ogni sezione, enumeriamo le
  // combinazioni di scambi incontrate camminando.
  const dfsSection = (sig: Signal, depth: number): boolean => {
    if (!sig.controls) return false;
    const vkey = sig.uid + '';
    if (visited.has(vkey)) return false;
    visited.add(vkey);
    const res = walkChoices(sig.controls, signalDirCompass(sig), (bp) => {
      if (isFree && !isFree(bp, sig)) return false;
      segments.push({ signal: sig, path: bp });
      if (matches(bp)) return true;
      if ('station' in target && bp.cells.some((c) => c.el.isStation && c.el.name && stationMatch(c.el.name, target.station))) return true;
      if (bp.endSignal && depth + 1 < maxSignals && !bp.endSignal.fixedRed && dfsSection(bp.endSignal, depth + 1)) return true;
      segments.pop();
      return false;
    });
    visited.delete(vkey);
    return res;
  };

  // esplora tutte le posizioni degli scambi di una sezione
  const walkChoices = (start: Element, amb: number, onPath: (bp: BlockPath) => boolean): boolean => {
    const rec = (): boolean => {
      const bp = blockPath(L, start, amb, ov);
      // trova il primo scambio "da decidere" lungo il percorso
      const cells = bp ? bp.cells : partialCells(L, start, amb, ov);
      for (const c of cells) {
        if (c.el.kind !== 'switch' || ov.has(c.el)) continue;
        const cur = c.el.switched;
        const opts = canThrow(c.el) ? [cur, !cur] : [cur];
        for (const o of opts) {
          ov.set(c.el, o);
          if (rec()) return true;
          ov.delete(c.el);
        }
        return false;
      }
      if (!bp) return false;
      return onPath(bp);
    };
    return rec();
  };

  if (!dfsSection(from, 0)) return null;
  const switches = new Map<Element, boolean>();
  for (const seg of segments) for (const c of seg.path.cells) if (c.el.kind === 'switch' && ov.has(c.el)) switches.set(c.el, ov.get(c.el)!);
  return { segments, switches, target: 'signal' in target ? target.signal : 'exit' in target ? target.exit : from };
}

/** Il binario "a" soddisfa la destinazione "b" (con o senza indicazione del binario)? */
function stationMatch(a: string, b: string) {
  const n = (x: string) => x.toLowerCase().replace(/\s+/g, '');
  if (b.startsWith('@')) return a.includes('@') && n(a.slice(a.indexOf('@'))) === n(b);
  if (b.includes('@')) return n(a) === n(b);
  return n(a.split('@')[0]) === n(b);
}

/** Celle percorse finché il percorso è valido (per scoprire gli scambi anche quando la sezione fallisce). */
function partialCells(L: Layout, start: Element, amb: number, ov: Map<Element, boolean>): Cell[] {
  const cells: Cell[] = [];
  let el = start;
  let cd = validEntry(shapeWith(L, start, ov), amb);
  for (let g = 0; g < 2000; g++) {
    cells.push({ el, dir: cd });
    const step = walkTrack(L, el, cd, shapeWith(L, el, ov));
    if (!step) break;
    const nxt = L.trackAt(step.x, step.y);
    if (!nxt) break;
    if (isStopSignal(signalFor(nxt, step.dir))) break;
    el = nxt; cd = step.dir;
    if (el.kind === 'switch' && !ov.has(el)) { cells.push({ el, dir: cd }); break; }
  }
  return cells;
}

/** Direzione bussola "ambigua" della marcia protetta da un segnale. */
export function signalDirCompass(s: Signal): number {
  switch (s.dir) {
    case 1: return CD.E;      // W_E
    case 16: return CD.S;     // N_S
    case 17: return CD.N;     // S_N
    default: return CD.W;     // E_W
  }
}
