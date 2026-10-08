// Piccolo costruttore di tracciati: produce testo .trk nel formato originale.
import { TD } from '../core/geom';

type XY = [number, number];
export interface TrackOpts { len?: number; station?: string; speed?: number | number[]; wl?: XY; el?: XY }

export class TrkBuilder {
  private lines: string[] = [];
  private attrs: string[] = [];
  defLen = 50;
  defSpeed: number | number[] = 0;

  private sp(speed?: number | number[]) {
    const s = speed ?? this.defSpeed;
    if (!s) return '';
    return '@' + (Array.isArray(s) ? s.join('/') : String(s)) + ',';
  }

  track(x: number, y: number, dir: number = TD.W_E, o: TrackOpts = {}) {
    const [wx, wy] = o.wl ?? [0, 0];
    const [ex, ey] = o.el ?? [0, 0];
    this.lines.push(`0,${x},${y},${dir},${o.station ? 1 : 0},${o.len ?? this.defLen},${wx},${wy},${ex},${ey},${this.sp(o.speed)}${o.station ?? 'noname'}`);
    return this;
  }

  /** Tratta orizzontale da x1 a x2 compresi. */
  h(x1: number, x2: number, y: number, o: TrackOpts = {}) {
    for (let x = x1; x <= x2; x++) this.track(x, y, TD.W_E, o);
    return this;
  }

  /** Binario di stazione: celle da x1 a x2, la cella centrale porta il nome. */
  platform(x1: number, x2: number, y: number, name: string, stationLen = 200, cellLen = 25, speed?: number) {
    const mid = Math.floor((x1 + x2) / 2);
    for (let x = x1; x <= x2; x++) this.track(x, y, TD.W_E, x === mid ? { len: stationLen, station: name, speed } : { len: cellLen, speed });
    return this;
  }

  /** Diagonale: n celle a partire da (x,y) verso SE (dir=NW_SE) o NE (dir=SW_NE). */
  diag(x: number, y: number, n: number, down: boolean, o: TrackOpts = {}) {
    for (let i = 0; i < n; i++) this.track(x + i, down ? y + i : y - i, down ? TD.NW_SE : TD.SW_NE, o);
    return this;
  }

  sw(x: number, y: number, type: number, speed: number = 60, linked?: XY) {
    const [lx, ly] = linked ?? [0, 0];
    this.lines.push(`1,${x},${y},${type},${lx},${ly}${speed ? '@' + speed + ',' : ''}noname`);
    return this;
  }

  /** Segnale: east = protegge la marcia verso est; controls = primo elemento protetto. */
  sig(x: number, y: number, east: boolean, controls: XY, name: string, o: { fleeted?: boolean; fixedRed?: boolean; noPenalty?: boolean; departure?: boolean } = {}) {
    let d = east ? 1 : 0;
    if (o.fleeted) d |= 2;
    if (o.fixedRed) d |= 0x100;
    if (o.noPenalty) d |= 0x200;
    this.lines.push(`2,${x},${y},${d},${controls[0]},${controls[1]},${name}`);
    if (o.departure) this.attrs.push(`(attributes ${x},${y}`, 'departure 1', ')');
    return this;
  }

  /** Testo; con link diventa un punto d'ingresso/uscita (w = collegato a ovest del testo, e = a est). */
  text(x: number, y: number, name: string, link?: { w?: XY; e?: XY }) {
    const [wx, wy] = link?.w ?? [0, 0];
    const [ex, ey] = link?.e ?? [0, 0];
    this.lines.push(`4,${x},${y},0,${name},${wx},${wy},${ex},${ey}`);
    return this;
  }

  deco(x1: number, x2: number, y: number) {
    for (let x = x1; x <= x2; x++) this.lines.push(`3,${x},${y},0`);
    return this;
  }

  toString() { return [...this.lines, ...this.attrs].join('\n') + '\n'; }
}
