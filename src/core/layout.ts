import { SHAPES, SWITCH_SHAPES, TRACK_SHAPE, Shape, TD } from './geom';

export type Kind = 'track' | 'switch' | 'signal' | 'platform' | 'text' | 'image' | 'itin' | 'trigger';

/** Stato di un elemento di binario, come le "luci" di un banco ACEI. */
export type CellState = 'free' | 'route' | 'occupied' | 'shunt';

export interface Pt { x: number; y: number }

export interface Element {
  uid: number;
  kind: Kind;
  x: number;
  y: number;
  /** trkdir per binari/segnali, tipo 0..23 per gli scambi */
  dir: number;
  length: number;
  isStation: boolean;
  /** nome stazione/binario (es. "Centrale@3"), testo, o nome del segnale */
  name?: string;
  wlink?: Pt;
  elink?: Pt;
  speed: number[];
  km?: number;
  hidden?: boolean;
  power?: string;
  // ---- stato di simulazione ----
  switched: boolean;
  state: CellState;
  /** segnali che proteggono questo elemento (per marcia verso est / verso ovest) */
  esignal?: Signal;
  wsignal?: Signal;
  /** id visibile al giocatore (scambi: "d12", ingressi/uscite: "A") */
  label?: string;
  /** script originale (ignorato) */
  script?: string;
  /** immagine (.xpm) per gli elementi IMAGE */
  image?: string;
}

export interface Signal extends Element {
  kind: 'signal';
  /** segnale di blocco automatico (doppia luce) */
  fleeted: boolean;
  /** blocco automatico attivo */
  nowFleeted: boolean;
  fixedRed: boolean;
  noPenalty: boolean;
  noClickPenalty: boolean;
  /** segnale di avviso/ripetitore: non arresta i treni */
  approach: boolean;
  /** segnale di manovra (marmotta) */
  shunting: boolean;
  intermediate: boolean;
  departure: boolean;
  /** elemento protetto */
  controls?: Element;
  clear: boolean;
  /** aspetto calcolato: rosso, giallo (avviso a via impedita), verde */
  aspect: 'red' | 'yellow' | 'green' | 'white';
  scriptFile?: string;
  lockedBy?: string;
}

export interface Itinerary {
  name: string;
  startSignal: string;
  endSignal: string;
  next?: string;
  switches: { x: number; y: number; thrown: boolean }[];
}

export const key = (x: number, y: number) => x * 4096 + y;

export class Layout {
  elements: Element[] = [];
  tracks = new Map<number, Element>(); // binari e scambi
  texts = new Map<number, Element>();
  signals: Signal[] = [];
  switches: Element[] = [];
  itineraries: Itinerary[] = [];
  images: Element[] = [];
  info: string[] = [];
  width = 0;
  height = 0;
  private uid = 1;

  add(e: Omit<Element, 'uid' | 'switched' | 'state' | 'speed'> & Partial<Element>): Element {
    const el = { switched: false, state: 'free', speed: [], ...e, uid: this.uid++ } as Element;
    this.elements.push(el);
    return el;
  }

  /** Da chiamare una volta caricati tutti gli elementi. */
  finalize() {
    this.tracks.clear(); this.texts.clear();
    this.signals = []; this.switches = []; this.images = [];
    this.width = 0; this.height = 0;
    for (const e of this.elements) {
      this.width = Math.max(this.width, e.x + 1);
      this.height = Math.max(this.height, e.y + 1);
      if (e.kind === 'track' || e.kind === 'switch') this.tracks.set(key(e.x, e.y), e);
      if (e.kind === 'switch') this.switches.push(e);
      if (e.kind === 'text') this.texts.set(key(e.x, e.y), e);
      if (e.kind === 'signal') this.signals.push(e as Signal);
      if (e.kind === 'image') this.images.push(e);
    }
    for (const e of this.elements) e.esignal = e.wsignal = undefined;
    for (const s of this.signals) {
      s.controls = s.wlink ? this.trackAt(s.wlink.x, s.wlink.y) : undefined;
      if (!s.controls) continue;
      if (s.dir === TD.W_E || s.dir === TD.S_N) s.controls.esignal = s;
      else s.controls.wsignal = s;
    }
  }

  trackAt(x: number, y: number): Element | undefined { return this.tracks.get(key(x, y)); }
  textAt(x: number, y: number): Element | undefined { return this.texts.get(key(x, y)); }

  /** Forma corrente dell'elemento (tiene conto della posizione dello scambio). */
  shape(e: Element): Shape | undefined {
    if (e.kind === 'switch') {
      const s = SWITCH_SHAPES[e.dir];
      return s ? SHAPES[s[e.switched ? 1 : 0]] : undefined;
    }
    if (e.kind === 'track') {
      const n = TRACK_SHAPE[e.dir];
      return n ? SHAPES[n] : undefined;
    }
    return undefined;
  }

  shapeFor(e: Element, thrown: boolean): Shape | undefined {
    if (e.kind !== 'switch') return this.shape(e);
    const s = SWITCH_SHAPES[e.dir];
    return s ? SHAPES[s[thrown ? 1 : 0]] : undefined;
  }

  /** Punto di ingresso/uscita (testo) collegato a questo binario. */
  linkedText(x: number, y: number): Element | undefined {
    for (const t of this.texts.values()) {
      if ((t.wlink && t.wlink.x === x && t.wlink.y === y) || (t.elink && t.elink.x === x && t.elink.y === y))
        return t;
    }
    return undefined;
  }

  /** Testi collegati a un binario: sono gli ingressi/uscite del tracciato. */
  entryPoints(): Element[] {
    return [...this.texts.values()].filter((t) => (t.wlink && (t.wlink.x || t.wlink.y)) || (t.elink && (t.elink.x || t.elink.y)));
  }

  findEntries(name: string): Element[] {
    const n = name.trim();
    const ex = this.entryPoints().filter((t) => t.name === n);
    return ex.length ? ex : this.entryPoints().filter((t) => t.name?.toLowerCase() === n.toLowerCase());
  }

  findEntry(name: string): Element | undefined {
    const n = name.trim();
    return this.entryPoints().find((t) => t.name === n) ?? this.entryPoints().find((t) => t.name?.toLowerCase() === n.toLowerCase());
  }

  stationTracks(): Element[] { return this.elements.filter((e) => e.kind === 'track' && e.isStation && e.name); }

  /** Nomi di stazione (senza binario). */
  stationNames(): string[] {
    const s = new Set<string>();
    for (const t of this.stationTracks()) s.add(baseStation(t.name!));
    return [...s];
  }
}

export function baseStation(n: string): string {
  const i = n.indexOf('@');
  return (i >= 0 ? n.slice(0, i) : n).trim();
}

export function platformOf(n: string): string | undefined {
  const i = n.indexOf('@');
  return i >= 0 ? n.slice(i + 1).trim() : undefined;
}

/** Stessa stazione, a prescindere dal binario (come sameStation() dell'originale: il binario errato è una penalità a parte). */
export function sameStation(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return baseStation(a).toLowerCase() === baseStation(b).toLowerCase();
}
