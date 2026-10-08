// Geometria degli elementi di binario.
// Le direzioni "bussola" e le tabelle di instradamento seguono quelle di
// Train Director 3 (TrackShape.cpp), così i tracciati .trk originali
// si comportano esattamente come nel programma originale.

export const enum CD {
  NONE = 0, SW = 1, S = 2, SE = 3, W = 4, SPOT = 5, E = 6, NW = 7, N = 8, NE = 9,
}

export const DX = [0, -1, 0, 1, -1, 0, 1, -1, 0, 1];
export const DY = [0, 1, 1, 1, 0, 0, 0, -1, -1, -1];
export const OPPOSITE = [CD.NONE, CD.NE, CD.N, CD.NW, CD.E, CD.SPOT, CD.W, CD.SE, CD.S, CD.SW];
export const CD_NAMES = ['', 'SO', 'S', 'SE', 'O', '·', 'E', 'NO', 'N', 'NE'];

/** Direzioni del file .trk (trkdir). */
export const TD = {
  NODIR: 0, E_W: 0, W_E: 1, NW_SE: 2, SW_NE: 3, W_NE: 4, W_SE: 5, NW_E: 6, SW_E: 7, TRK_N_S: 8,
  SIG_W_FLEETED: 9, SIG_E_FLEETED: 10,
  SW_N: 11, NW_S: 12, SE_N: 13, NE_S: 14, N_S: 16, S_N: 17,
  SIG_S_FLEETED: 18, SIG_N_FLEETED: 19,
  XH_NW_SE: 20, XH_SW_NE: 21, X_X: 22, X_PLUS: 23, N_NE_S_SW: 24, N_NW_S_SE: 25,
} as const;

/** Tabella: direzione di marcia in ingresso -> direzione di marcia in uscita. */
export type Shape = Partial<Record<number, number>>;

const mk = (pairs: [number, number][]): Shape => {
  const s: Shape = {};
  for (const [a, b] of pairs) s[a] = b;
  return s;
};

export const SHAPES = {
  w_e: mk([[CD.E, CD.E], [CD.W, CD.W]]),
  n_s: mk([[CD.N, CD.N], [CD.S, CD.S]]),
  nw_se: mk([[CD.SE, CD.SE], [CD.NW, CD.NW]]),
  sw_ne: mk([[CD.NE, CD.NE], [CD.SW, CD.SW]]),
  nw_e: mk([[CD.SE, CD.E], [CD.W, CD.NW]]),
  sw_e: mk([[CD.NE, CD.E], [CD.W, CD.SW]]),
  w_ne: mk([[CD.E, CD.NE], [CD.SW, CD.W]]),
  w_se: mk([[CD.E, CD.SE], [CD.NW, CD.W]]),
  nw_s: mk([[CD.SE, CD.S], [CD.N, CD.NW]]),
  ne_s: mk([[CD.SW, CD.S], [CD.N, CD.NE]]),
  n_sw: mk([[CD.S, CD.SW], [CD.NE, CD.N]]),
  n_se: mk([[CD.S, CD.SE], [CD.NW, CD.N]]),
  diamond_x: mk([[CD.SE, CD.SE], [CD.NE, CD.NE], [CD.SW, CD.SW], [CD.NW, CD.NW]]),
  diamond_plus: mk([[CD.E, CD.E], [CD.W, CD.W], [CD.S, CD.S], [CD.N, CD.N]]),
  diamond_h_sw_ne: mk([[CD.E, CD.E], [CD.W, CD.W], [CD.NE, CD.NE], [CD.SW, CD.SW]]),
  diamond_h_nw_se: mk([[CD.E, CD.E], [CD.W, CD.W], [CD.SE, CD.SE], [CD.NW, CD.NW]]),
  diamond_v_sw_ne: mk([[CD.N, CD.N], [CD.S, CD.S], [CD.NE, CD.NE], [CD.SW, CD.SW]]),
  diamond_v_nw_se: mk([[CD.N, CD.N], [CD.S, CD.S], [CD.SE, CD.SE], [CD.NW, CD.NW]]),
  // scambi inglesi (a quattro vie)
  main_we_sw_ne: mk([[CD.E, CD.E], [CD.W, CD.W], [CD.NE, CD.NE], [CD.SW, CD.SW]]),
  branch_we_sw_ne: mk([[CD.E, CD.NE], [CD.W, CD.SW], [CD.SW, CD.W], [CD.NE, CD.E]]),
  main_we_nw_se: mk([[CD.E, CD.E], [CD.W, CD.W], [CD.SE, CD.SE], [CD.NW, CD.NW]]),
  branch_we_nw_se: mk([[CD.E, CD.SE], [CD.W, CD.NW], [CD.SE, CD.E], [CD.NW, CD.W]]),
  main_ns_nw_se: mk([[CD.N, CD.N], [CD.S, CD.S], [CD.SE, CD.SE], [CD.NW, CD.NW]]),
  branch_ns_nw_se: mk([[CD.N, CD.NW], [CD.S, CD.SE], [CD.NW, CD.N], [CD.SE, CD.S]]),
  main_ns_sw_ne: mk([[CD.N, CD.N], [CD.S, CD.S], [CD.SW, CD.SW], [CD.NE, CD.NE]]),
  branch_ns_sw_ne: mk([[CD.N, CD.NE], [CD.S, CD.SW], [CD.NE, CD.N], [CD.SW, CD.S]]),
};

type ShapeName = keyof typeof SHAPES;

/** Forma di un binario semplice, indicizzata per trkdir. */
export const TRACK_SHAPE: Record<number, ShapeName> = {
  [TD.W_E]: 'w_e', [TD.TRK_N_S]: 'n_s', [TD.NW_SE]: 'nw_se', [TD.SW_NE]: 'sw_ne',
  [TD.W_NE]: 'w_ne', [TD.W_SE]: 'w_se', [TD.NW_E]: 'nw_e', [TD.SW_E]: 'sw_e',
  [TD.NW_S]: 'nw_s', [TD.SW_N]: 'n_sw', [TD.NE_S]: 'ne_s', [TD.SE_N]: 'n_se',
  [TD.XH_NW_SE]: 'diamond_h_nw_se', [TD.XH_SW_NE]: 'diamond_h_sw_ne',
  [TD.X_X]: 'diamond_x', [TD.X_PLUS]: 'diamond_plus',
  [TD.N_NE_S_SW]: 'diamond_v_sw_ne', [TD.N_NW_S_SE]: 'diamond_v_nw_se',
  [TD.N_S]: 'n_s', [TD.S_N]: 'n_s',
};

/** Forme degli scambi: [corretto (normale), deviato (rovescio)], indicizzate per tipo 0..23. */
export const SWITCH_SHAPES: [ShapeName, ShapeName][] = [
  ['w_e', 'w_ne'], ['w_e', 'nw_e'], ['w_e', 'w_se'], ['w_e', 'sw_e'],
  ['sw_ne', 'sw_e'], ['sw_ne', 'w_ne'], ['nw_se', 'nw_e'], ['nw_se', 'w_se'],
  ['main_we_sw_ne', 'branch_we_sw_ne'], ['main_we_nw_se', 'branch_we_nw_se'],
  ['w_ne', 'w_se'], ['nw_e', 'sw_e'],
  ['n_s', 'n_sw'], ['n_s', 'n_se'], ['n_s', 'nw_s'], ['n_s', 'ne_s'],
  ['main_ns_sw_ne', 'branch_ns_sw_ne'], ['main_ns_nw_se', 'branch_ns_nw_se'],
  ['sw_ne', 'n_sw'], ['sw_ne', 'ne_s'], ['nw_se', 'n_se'], ['nw_se', 'nw_s'],
  ['ne_s', 'nw_s'], ['n_se', 'n_sw'],
];

export function shapeOf(name: ShapeName): Shape { return SHAPES[name]; }

/** Segmenti da disegnare per ciascuna forma: coppie di "lati" (direzione bussola verso il bordo). */
export function shapeSegments(shape: Shape): [number, number][] {
  const segs: [number, number][] = [];
  const seen = new Set<string>();
  for (const k of Object.keys(shape)) {
    const inDir = Number(k);
    const outDir = shape[inDir]!;
    const from = OPPOSITE[inDir];
    const key = [from, outDir].sort().join('-');
    if (seen.has(key)) continue;
    seen.add(key);
    segs.push([from, outDir]);
  }
  return segs;
}

/** Converte una direzione ambigua (es. "verso est") nella direzione di ingresso valida per la forma. */
export function validEntry(shape: Shape | undefined, amb: number): number {
  if (!shape) return amb;
  const pick = (...c: number[]) => c.find((d) => shape[d] !== undefined);
  let r: number | undefined;
  switch (amb) {
    case CD.W: r = pick(CD.W, CD.NW, CD.SW); break;
    case CD.E: r = pick(CD.E, CD.NE, CD.SE); break;
    case CD.N: r = pick(CD.N, CD.NW, CD.NE); break;
    case CD.S: r = pick(CD.S, CD.SW, CD.SE); break;
  }
  return r ?? amb;
}

/** Lato "est" (true) o "ovest" (false) della marcia, come nel programma originale. */
export function isEastbound(cd: number): boolean {
  return cd === CD.E || cd === CD.NE || cd === CD.SE || cd === CD.N;
}
