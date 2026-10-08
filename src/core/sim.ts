// Motore di simulazione: treni, segnali, scambi, penalità.
// Segue la logica di Train Director 3 (run.cpp) semplificandone la struttura.
import { CD, OPPOSITE, validEntry } from './geom';
import { Element, Layout, Signal, sameStation, platformOf, baseStation } from './layout';
import { BlockPath, Cell, blockPath, exitDir, findRoute, isStopSignal, RoutePlan, signalDirCompass, Target } from './paths';
import { Delay, Schedule, Stop, TrainDef, formatTime } from './sch';

export type TrainStatus =
  | 'ready' | 'delayed' | 'running' | 'waiting' | 'stopped' | 'starting' | 'arrived' | 'exited' | 'derailed' | 'notToday';

export const STATUS_IT: Record<TrainStatus, string> = {
  ready: 'In attesa', delayed: 'Ritardo ingresso', running: 'In marcia', waiting: 'Fermo al segnale',
  stopped: 'In stazione', starting: 'In partenza', arrived: 'Arrivato', exited: 'Uscito', derailed: 'Bloccato', notToday: 'Non circola',
};

export interface StopRecord { arrival?: number; departure?: number; lateMin: number; platform?: string; passed?: boolean }

export class Train {
  status: TrainStatus = 'ready';
  /** celle occupate, occ[0] = testa */
  occ: Cell[] = [];
  headPos = 0;
  path: Cell[] = [];
  pathIdx = 0;
  pathInfo?: BlockPath;
  speed = 0;
  limit = 0;
  outside = false;
  outDist = 0;
  timeDep = 0;
  shunting = false;
  outOf?: Element;
  served = new Map<number, StopRecord>();
  enteredAt?: number;
  exitedAt?: number;
  exitedVia?: string;
  delayEnterSec = 0;
  waitedSec = 0;
  lateMin = 0;
  gotEntryDelay = false;
  entryDelaySec = 0;
  startLeft = 0;
  wrongDest = false;
  wrongPlatform = false;
  missedStops = 0;
  turned = false;
  holding = false;
  /** distanza totale percorsa dalla testa (m) */
  odo = 0;
  /** punto di arresto in stazione già individuato (in coordinate odometro) */
  pendingStop?: { odo: number; el: Element; idx: number };
  arrivedAtStation?: Element;
  arrivedTime?: number;
  /** treno che ha ricevuto il materiale */
  assignedTo?: Train;
  stockFrom?: Train;
  constructor(public def: TrainDef, public idx: number) {}
  get name() { return this.def.name; }
  get type() { return this.def.type; }
  get length() { return this.def.length; }
  get head(): Cell | undefined { return this.outside ? undefined : this.occ[0]; }
  /** direzione bussola della marcia */
  get dir(): number { const h = this.occ[0]; return h ? h.dir : CD.E; }
  /** prossima fermata (stazione) */
  nextStop(): Stop | undefined {
    return this.def.stops.find((s, i) => s.minStop > 0 && !this.served.has(i));
  }
  get onLayout() { return this.occ.length > 0 || (this.outside && this.status !== 'exited'); }
  /** ritardo corrente in minuti */
  delayMin(now: number): number {
    let d = 0;
    if (this.status === 'ready' || this.status === 'delayed') d = Math.max(0, now - this.def.timeIn);
    for (const [i, r] of this.served) {
      const st = i < 0 ? { arrival: this.def.timeOut, departure: this.def.timeOut } : this.def.stops[i];
      if (r.departure !== undefined) d = r.departure - st.departure;
      else if (r.arrival !== undefined) d = r.arrival - st.arrival;
    }
    if (this.status === 'exited' && this.exitedAt) d = this.exitedAt - this.def.timeOut;
    return Math.round(d / 60);
  }
}

export interface Alert { time: number; text: string; level: 'info' | 'warn' | 'bad' | 'good'; train?: string; el?: Element }

export interface Perf {
  wrongDest: number; lateTrains: number; wrongPlatform: number; denied: number; waiting: number;
  turned: number; thrown: number; cleared: number; missedStops: number; wrongAssign: number;
  lateMinutes: number; delayMinutes: number; arrivedOnTime: number;
}

export const PERF_LABELS: Record<keyof Perf, [string, number]> = {
  wrongDest: ['Destinazione errata', 5],
  lateTrains: ['Treni in ritardo', 1],
  wrongPlatform: ['Binario errato', 2],
  denied: ['Comandi rifiutati', 1],
  waiting: ['Treni fermi al segnale', 1],
  turned: ['Inversioni inutili', 1],
  thrown: ['Scambi manovrati inutilmente', 1],
  cleared: ['Segnali aperti inutilmente', 1],
  missedStops: ['Fermate saltate', 3],
  wrongAssign: ['Materiale assegnato male', 2],
  lateMinutes: ['Minuti di ritardo totali', 0],
  delayMinutes: ['Minuti di attesa all’ingresso', 0],
  arrivedOnTime: ['Treni arrivati in orario', 0],
};

export interface Result { ok: boolean; msg: string }

const DECEL = 0.6; // m/s², come nel programma originale

function brakingSpeed(dist: number, target: number) {
  const v0 = target / 3.6;
  return Math.sqrt(Math.max(0, 2 * DECEL * dist + v0 * v0)) * 3.6;
}

export interface SimOptions { day?: number; randomDelays?: boolean; autoAssign?: boolean; seed?: number }

export class Simulation {
  time: number;
  trains: Train[] = [];
  alerts: Alert[] = [];
  perf: Perf = { wrongDest: 0, lateTrains: 0, wrongPlatform: 0, denied: 0, waiting: 0, turned: 0, thrown: 0, cleared: 0, missedStops: 0, wrongAssign: 0, lateMinutes: 0, delayMinutes: 0, arrivedOnTime: 0 };
  day: number;
  randomDelays: boolean;
  autoAssign: boolean;
  owner = new Map<Element, Train>();
  /** segnali aperti dal giocatore senza che un treno li abbia ancora impegnati */
  private pendingClear = new Set<Signal>();
  private thrownSince = new Set<Element>();
  private rnd: () => number;
  listeners: ((a: Alert) => void)[] = [];
  onTrainEnter?: (t: Train) => void;

  constructor(public layout: Layout, public schedule: Schedule, opts: SimOptions = {}) {
    this.time = schedule.start;
    this.day = opts.day ?? schedule.today ?? 1;
    this.randomDelays = opts.randomDelays ?? true;
    this.autoAssign = opts.autoAssign ?? true;
    let seed = opts.seed ?? 12345;
    this.rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    schedule.trains.forEach((d, i) => {
      normalizeTimes(d);
      const t = new Train(d, i);
      if (d.days && !(d.days & (1 << (this.day - 1)))) t.status = 'notToday';
      else if (d.timeIn < schedule.start && !d.waitFor) t.status = 'notToday';
      this.trains.push(t);
    });
    for (const s of layout.signals) { s.clear = false; s.aspect = 'red'; s.nowFleeted = false; }
    for (const e of layout.elements) { e.state = 'free'; }
    this.updateAspects();
  }

  // ------------------------------------------------------------ utilità

  alert(text: string, level: Alert['level'] = 'info', train?: Train, el?: Element) {
    const a: Alert = { time: this.time, text, level, train: train?.name, el };
    this.alerts.push(a);
    if (this.alerts.length > 500) this.alerts.shift();
    for (const l of this.listeners) l(a);
  }

  trainNamed(n: string): Train | undefined { return this.trains.find((t) => t.name === n); }
  trainAt(el: Element): Train | undefined { return this.owner.get(el); }

  penaltyScore(): number {
    let s = 0;
    for (const k of Object.keys(PERF_LABELS) as (keyof Perf)[]) s += this.perf[k] * PERF_LABELS[k][1];
    return s;
  }

  private cellFree(el: Element, except?: Train): boolean {
    if (el.kind === 'text') return true;
    const o = this.owner.get(el);
    if (o && o !== except) return false;
    if (el.state === 'route' || el.state === 'shunt') return false;
    if (el.state === 'occupied' && (!o || o !== except)) return false;
    return true;
  }

  pathBusy(cells: Cell[], except?: Train): Element | undefined {
    for (const c of cells) if (!this.cellFree(c.el, except)) return c.el;
    return undefined;
  }

  private colorPath(cells: Cell[], state: 'route' | 'free') {
    for (const c of cells) {
      if (c.el.kind === 'text') continue;
      if (state === 'free') { if (c.el.state === 'route' || c.el.state === 'shunt') c.el.state = 'free'; }
      else if (!this.owner.has(c.el)) c.el.state = state;
    }
  }

  // ------------------------------------------------------------ segnali

  signalPath(s: Signal): BlockPath | null {
    if (!s.controls) return null;
    return blockPath(this.layout, s.controls, signalDirCompass(s));
  }

  clearSignal(s: Signal, auto = false): Result {
    if (s.fixedRed) { if (!auto) this.deny(); return { ok: false, msg: `Il segnale ${s.label} è sempre a via impedita` }; }
    if (s.clear) return { ok: true, msg: `Segnale ${s.label} già a via libera` };
    if (s.approach) return { ok: false, msg: `${s.label} è un segnale di avviso: si dispone da solo` };
    const p = this.signalPath(s);
    if (!p) { if (!auto) this.deny(); return { ok: false, msg: `Nessun percorso valido dal segnale ${s.label}: controlla gli scambi` }; }
    if (p.deadEnd && p.cells.length && !p.exit && !p.cells.some((c) => c.el.isStation)) {
      // percorso verso un tronchino senza stazione: consentito (manovra)
    }
    const busy = this.pathBusy(p.cells);
    if (busy) {
      if (!auto) this.deny();
      const who = this.owner.get(busy);
      return { ok: false, msg: who ? `Sezione occupata dal treno ${who.name}` : `Itinerario in conflitto con un altro già formato` };
    }
    this.colorPath(p.cells, 'route');
    s.clear = true;
    if (!auto) this.pendingClear.add(s);
    this.updateAspects();
    return { ok: true, msg: `Segnale ${s.label} a via libera` };
  }

  closeSignal(s: Signal): Result {
    if (!s.clear) return { ok: true, msg: `Segnale ${s.label} già a via impedita` };
    const p = this.signalPath(s);
    // se un treno ha già impegnato la sezione, non liberare le sue celle
    if (p) this.colorPath(p.cells, 'free');
    s.clear = false;
    if (this.pendingClear.has(s) && !s.noClickPenalty) this.perf.cleared++;
    this.pendingClear.delete(s);
    if (!s.intermediate) s.nowFleeted = false;
    this.updateAspects();
    return { ok: true, msg: `Segnale ${s.label} a via impedita` };
  }

  toggleSignal(s: Signal): Result { return s.clear ? this.closeSignal(s) : this.clearSignal(s); }

  toggleFleet(s: Signal): Result {
    if (!s.fleeted) return { ok: false, msg: `Il segnale ${s.label} non è di blocco automatico` };
    if (s.nowFleeted) { s.nowFleeted = false; return { ok: true, msg: `Blocco automatico ${s.label} disattivato` }; }
    if (!s.clear) { const r = this.clearSignal(s); if (!r.ok) return r; }
    s.nowFleeted = true;
    this.updateAspects();
    return { ok: true, msg: `Blocco automatico ${s.label} attivo` };
  }

  private deny() { this.perf.denied++; }

  /** Riapre i segnali di blocco automatico quando la sezione si libera. */
  private openFleeted() {
    for (const s of this.layout.signals) {
      if (!s.fleeted || !s.nowFleeted || s.clear) continue;
      if (s.controls && s.controls.state !== 'free') continue;
      this.clearSignal(s, true);
    }
  }

  updateAspects() {
    for (const s of this.layout.signals) {
      if (s.approach) continue;
      if (!s.clear) { s.aspect = 'red'; continue; }
      const p = this.signalPath(s);
      const nxt = p?.endSignal;
      s.aspect = nxt && !nxt.clear && !p?.exit ? 'yellow' : 'green';
    }
    // i segnali di avviso ripetono lo stato del segnale successivo
    for (const s of this.layout.signals) {
      if (!s.approach || !s.controls) continue;
      const p = blockPath(this.layout, s.controls, signalDirCompass(s));
      s.aspect = p?.endSignal ? (p.endSignal.clear ? 'green' : 'yellow') : 'green';
    }
  }

  // ------------------------------------------------------------ scambi

  throwSwitch(sw: Element, force?: boolean): Result {
    if (sw.kind !== 'switch') return { ok: false, msg: 'Non è uno scambio' };
    const linked = sw.wlink ? this.layout.trackAt(sw.wlink.x, sw.wlink.y) : undefined;
    const pair = linked && linked.kind === 'switch' ? [sw, linked] : [sw];
    for (const e of pair) {
      if (!this.cellFree(e)) {
        this.deny();
        const who = this.owner.get(e);
        return { ok: false, msg: who ? `Deviatoio ${e.label} occupato dal treno ${who.name}` : `Deviatoio ${e.label} bloccato da un itinerario` };
      }
    }
    for (const e of pair) {
      if (force === undefined || e.switched !== force) {
        e.switched = !e.switched;
        if (this.thrownSince.has(e)) this.perf.thrown++;
        this.thrownSince.add(e);
      }
    }
    this.updateAspects();
    return { ok: true, msg: `Deviatoio ${sw.label} ${sw.switched ? 'rovescio' : 'normale'}` };
  }

  setSwitch(sw: Element, thrown: boolean): Result {
    if (sw.switched === thrown) return { ok: true, msg: '' };
    return this.throwSwitch(sw, thrown);
  }

  // ------------------------------------------------------------ itinerari

  /** Cerca l'itinerario preferendo sezioni libere; se non ce ne sono, restituisce comunque il percorso (che verrà rifiutato con il motivo). */
  planRoute(from: Signal, target: Target, onlyFree = false): RoutePlan | null {
    const free = findRoute(this.layout, from, target, (sw) => this.cellFree(sw), 6, (bp, sig) => sig.clear || !this.pathBusy(bp.cells));
    if (free || onlyFree) return free;
    return findRoute(this.layout, from, target, (sw) => this.cellFree(sw));
  }

  /** Esiste un itinerario, a prescindere da occupazioni e bloccaggi? */
  reachable(from: Signal, target: Target): boolean {
    return !!findRoute(this.layout, from, target, () => true);
  }

  /** Forma l'itinerario completo (scambi + segnali) in modo atomico. */
  applyRoute(plan: RoutePlan): Result {
    // verifica preventiva di tutte le sezioni con gli scambi richiesti
    for (const seg of plan.segments) {
      if (seg.signal.clear) continue;
      const busy = this.pathBusy(seg.path.cells);
      if (busy) {
        this.deny();
        const who = this.owner.get(busy);
        return { ok: false, msg: who ? `Itinerario impegnato dal treno ${who.name}` : 'Itinerario in conflitto con un altro già formato' };
      }
    }
    for (const [sw, pos] of plan.switches) {
      const r = this.setSwitch(sw, pos);
      if (!r.ok) return r;
    }
    const opened: string[] = [];
    for (const seg of plan.segments) {
      if (seg.signal.clear) continue;
      const r = this.clearSignal(seg.signal);
      if (!r.ok) return { ok: false, msg: r.msg };
      opened.push(seg.signal.label ?? '');
    }
    const nSw = plan.switches.size;
    return { ok: true, msg: `Itinerario formato: ${opened.join(' → ')}${nSw ? ` (${nSw} ${nSw === 1 ? 'deviatoio' : 'deviatoi'})` : ''}` };
  }

  activateItinerary(name: string, depth = 0): Result {
    const it = this.layout.itineraries.find((i) => i.name === name) ?? this.layout.itineraries.find((i) => i.name.toLowerCase() === name.toLowerCase());
    if (!it) return { ok: false, msg: `Itinerario ${name} inesistente` };
    const sig = this.findSignalByName(it.startSignal);
    if (!sig) return { ok: false, msg: `Segnale di inizio ${it.startSignal} non trovato` };
    for (const s of it.switches) {
      const sw = this.layout.trackAt(s.x, s.y);
      if (!sw || sw.kind !== 'switch') continue;
      if (sw.switched !== s.thrown && !this.cellFree(sw)) { this.deny(); return { ok: false, msg: `Itinerario ${it.name}: deviatoio ${sw.label} bloccato` }; }
    }
    for (const s of it.switches) {
      const sw = this.layout.trackAt(s.x, s.y);
      if (sw && sw.kind === 'switch' && sw.switched !== s.thrown) this.throwSwitch(sw, s.thrown);
    }
    const r = this.clearSignal(sig);
    if (!r.ok) return { ok: false, msg: `Itinerario ${it.name}: ${r.msg}` };
    if (it.next && depth < 10) {
      const r2 = this.activateItinerary(it.next, depth + 1);
      if (!r2.ok) return { ok: true, msg: `Itinerario ${it.name} formato (successivo: ${r2.msg})` };
    }
    return { ok: true, msg: `Itinerario ${it.name} formato` };
  }

  findSignalByName(n: string): Signal | undefined {
    const m = /^\((\d+),(\d+)\)$/.exec(n.trim());
    if (m) return this.layout.signals.find((s) => s.x === +m[1] && s.y === +m[2]);
    return this.layout.signals.find((s) => s.name === n);
  }

  // ------------------------------------------------------------ comandi ai treni

  reverseTrain(t: Train): Result {
    if (!t.onLayout || t.outside) return { ok: false, msg: `Il treno ${t.name} non è sul tracciato` };
    if (t.status === 'running' && t.speed > 0) { this.deny(); return { ok: false, msg: `Il treno ${t.name} è in movimento` }; }
    const tailCell = t.occ[t.occ.length - 1];
    const ndir = OPPOSITE[exitDir(this.layout, tailCell.el, tailCell.dir)];
    const p = blockPath(this.layout, tailCell.el, ndir);
    if (!p) { this.deny(); return { ok: false, msg: `Impossibile invertire ${t.name}: percorso non valido` }; }
    const busy = this.pathBusy(p.cells, t);
    if (busy) { this.deny(); return { ok: false, msg: `Impossibile invertire ${t.name}: binario occupato` }; }
    // libera il vecchio percorso davanti al treno
    this.releaseAhead(t);
    t.pendingStop = undefined;
    if (t.turned) this.perf.turned++;
    t.turned = true;
    // la testa diventa l'ultima carrozza: occ viene rovesciato e le direzioni invertite
    const n = t.occ.length;
    const cover = n === 1 ? Math.max(0, t.headPos - t.length) : this.tailCover(t);
    const newOcc: Cell[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const c = t.occ[i];
      newOcc.push({ el: c.el, dir: OPPOSITE[exitDir(this.layout, c.el, c.dir)] });
    }
    t.occ = newOcc;
    const hl = newOcc[0].el.length;
    t.headPos = n === 1 ? Math.max(0, hl - cover) : Math.min(hl, cover);
    t.path = p.cells;
    t.pathIdx = 0;
    t.pathInfo = p;
    // la cella di testa fa già parte del treno
    this.colorPath(p.cells.slice(1), 'route');
    t.speed = 0;
    if (t.status === 'waiting') t.status = 'running';
    if (t.status === 'arrived' || t.status === 'stopped') { /* resta fermo */ }
    this.markOcc(t);
    return { ok: true, msg: `Treno ${t.name}: marcia invertita` };
  }

  /** Lunghezza del treno che occupa l'ultima cella (per l'inversione). */
  private tailCover(t: Train): number {
    let rem = t.length - t.headPos;
    for (let i = 1; i < t.occ.length - 1; i++) rem -= t.occ[i].el.length;
    return Math.max(1, rem);
  }

  shuntTrain(t: Train): Result {
    if (!t.onLayout || t.outside) return { ok: false, msg: `Il treno ${t.name} non è sul tracciato` };
    if (!['stopped', 'arrived', 'waiting'].includes(t.status)) return { ok: false, msg: `Il treno ${t.name} non è fermo` };
    t.shunting = true;
    t.outOf = t.occ[0]?.el.isStation ? t.occ[0].el : undefined;
    if (t.status === 'arrived') t.status = 'waiting';
    else if (t.status === 'stopped') t.status = 'waiting';
    return { ok: true, msg: `Treno ${t.name} in manovra (max 30 km/h fino alla prossima stazione)` };
  }

  startNow(t: Train): Result {
    if (t.status !== 'stopped') return { ok: false, msg: `Il treno ${t.name} non è fermo in stazione` };
    t.timeDep = this.time;
    return { ok: true, msg: `Treno ${t.name}: partenza anticipata` };
  }

  assign(from: Train, to: Train): Result {
    if (from.status !== 'arrived' || !from.occ.length) return { ok: false, msg: `Il treno ${from.name} non è arrivato in stazione` };
    if (!['ready', 'delayed'].includes(to.status)) return { ok: false, msg: `Il treno ${to.name} non può ricevere materiale` };
    if (from.def.stock && from.def.stock !== to.name) { this.perf.wrongAssign++; }
    to.occ = from.occ; to.headPos = from.headPos; to.odo = from.odo;
    to.path = from.path; to.pathIdx = from.pathIdx; to.pathInfo = from.pathInfo;
    from.occ = []; from.path = []; from.pathInfo = undefined;
    for (const c of to.occ) this.owner.set(c.el, to);
    from.status = 'exited'; from.exitedAt = this.time; from.assignedTo = to; to.stockFrom = from;
    to.status = 'stopped';
    to.enteredAt = this.time;
    // come nell'originale: parte all'orario previsto, ma non prima di "waitTime" secondi dall'arrivo del materiale
    to.timeDep = Math.max(stationDeparture(to), (from.arrivedTime ?? this.time) + (to.def.waitTime || 60), this.time + 30);
    to.speed = 0;
    // sceglie il senso di marcia: inverte se il binario è tronco o se l'uscita è dall'altra parte
    const h = to.occ[0];
    const ahead = blockPath(this.layout, h.el, h.dir);
    const tail = to.occ[to.occ.length - 1];
    const back = blockPath(this.layout, tail.el, OPPOSITE[exitDir(this.layout, tail.el, tail.dir)]);
    const fwdOk = !!ahead && !(ahead.deadEnd && !ahead.exit) && this.leadsTo(ahead, to);
    const backOk = !!back && !(back.deadEnd && !back.exit) && this.leadsTo(back, to);
    if (!fwdOk && (backOk || !ahead || (ahead.deadEnd && !ahead.exit))) {
      this.reverseTrain(to);
      to.turned = false;
    } else if (ahead && !to.path.length) {
      to.path = ahead.cells; to.pathIdx = 0; to.pathInfo = ahead;
      this.colorPath(ahead.cells.slice(1), 'route');
    }
    this.markOcc(to);
    this.alert(`Materiale del ${from.name} assegnato al ${to.name}`, 'info', to);
    return { ok: true, msg: `Materiale assegnato a ${to.name}` };
  }

  /** La sezione porta (eventualmente attraverso altri segnali) alla prossima fermata o all'uscita del treno? */
  private leadsTo(bp: BlockPath, t: Train): boolean {
    const targets = [...t.def.stops.filter((s) => s.minStop > 0).map((s) => s.station), t.def.exit];
    const hit = (p: BlockPath) => (p.exit && targets.some((x) => sameStation(p.exit!.name, x))) || p.cells.some((c) => c.el.isStation && targets.some((x) => sameStation(c.el.name, x)) && c.el !== t.occ[0]?.el);
    if (hit(bp)) return true;
    if (!bp.endSignal) return false;
    for (const target of targets) {
      const ex = this.layout.findEntries(target)[0];
      const plan = ex ? findRoute(this.layout, bp.endSignal, { exit: ex }, () => true) : findRoute(this.layout, bp.endSignal, { station: baseStation(target) }, () => true);
      if (plan) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ ciclo

  /** Avanza di un secondo simulato. */
  step() {
    this.time += 1;
    for (const t of this.trains) {
      switch (t.status) {
        case 'ready': this.tryEnter(t); break;
        case 'delayed':
          // i treni in attesa d'ingresso riprovano ogni 3 secondi (risparmia calcoli negli scenari grandi)
          if (this.time % 3 === t.idx % 3) this.tryEnter(t);
          if (t.status === 'delayed') t.delayEnterSec++;
          break;
        case 'stopped': this.checkDeparture(t); break;
        case 'starting': if (--t.startLeft <= 0) { t.status = 'running'; this.run(t); } break;
        case 'waiting': this.run(t); if (t.status === 'waiting') t.waitedSec++; break;
        case 'running': this.run(t); break;
      }
    }
    if (this.time % 2 === 0) { this.openFleeted(); this.updateAspects(); }
  }

  /** Secondi al prossimo evento (ingresso o partenza), per l'avanzamento rapido. */
  nextEventIn(): number {
    let best = Infinity;
    for (const t of this.trains) {
      if (t.status === 'ready') best = Math.min(best, t.def.timeIn - this.time);
      if (t.status === 'stopped') best = Math.min(best, t.timeDep - this.time);
      if (['running', 'waiting', 'delayed', 'starting'].includes(t.status)) return 0;
    }
    return best;
  }

  private tryEnter(t: Train) {
    const d = t.def;
    if (this.time < d.timeIn) return;
    if (!t.gotEntryDelay) { t.gotEntryDelay = true; t.entryDelaySec = this.pickDelay(d.entryDelay); }
    if (this.time < d.timeIn + t.entryDelaySec) return;
    if (d.waitFor) {
      const w = this.trainNamed(d.waitFor);
      if (w && w.status === 'arrived' && w.occ.length) {
        if (!this.autoAssign) {
          if (t.status !== 'delayed') { t.status = 'delayed'; this.alert(`Assegna al ${t.name} il materiale del ${w.name} (comando: ass ${short(w.name)} ${short(t.name)})`, 'warn', t); }
          return;
        }
        if ((w.exitedAt ?? w.arrivedTime ?? 0) + d.waitTime > this.time) return;
        this.assign(w, t);
        return;
      }
      if (w && w.status !== 'exited' && w.status !== 'notToday' && w.status !== 'derailed') return; // il materiale non è ancora arrivato
      if (w && w.status === 'exited' && (w.exitedAt ?? 0) + d.waitTime > this.time) return;
    }
    // ingresso dal bordo del tracciato
    const names = [d.entrance, ...d.altEntrances];
    let firstErr = '';
    for (const n of names) {
      const r = this.entryFor(t, n);
      if (r === 'ok') return;
      if (!firstErr) firstErr = r;
    }
    if (t.status !== 'delayed') {
      t.status = 'delayed';
      this.alert(`Treno ${t.name} in attesa di entrare da ${d.entrance}${firstErr ? ' — ' + firstErr : ''}`, 'warn', t);
    }
  }

  private entryFor(t: Train, name: string): 'ok' | string {
    const L = this.layout;
    const txts = L.findEntries(name);
    let err = '';
    for (const txt of txts) {
      let start: Element | undefined, amb = CD.E;
      if (txt.elink && (txt.elink.x || txt.elink.y)) { start = L.trackAt(txt.elink.x, txt.elink.y); amb = CD.E; }
      else if (txt.wlink) { start = L.trackAt(txt.wlink.x, txt.wlink.y); amb = CD.W; }
      if (!start) { err ||= 'ingresso non collegato'; continue; }
      if (start.dir === 8 || (start.kind === 'switch' && start.dir >= 12 && start.dir <= 15)) amb = txt.y < start.y ? CD.S : CD.N;
      const p = blockPath(L, start, amb);
      if (!p) { err ||= 'percorso d’ingresso non valido (scambi)'; continue; }
      if (p.exit === txt || (p.exit && p.cells.length <= 1)) continue; // è un'uscita, non un ingresso
      if (this.pathBusy(p.cells)) { err = 'sezione d’ingresso occupata'; continue; }
      this.placeEntering(t, p);
      return 'ok';
    }
    if (txts.length) return err;
    // ingresso direttamente su un binario di stazione (materiale già presente)
    const st = L.stationTracks().find((s) => s.name === name) ?? L.stationTracks().find((s) => sameStation(s.name, name) && platformOf(s.name!) === platformOf(name));
    if (st) {
      if (!this.cellFree(st)) return 'binario occupato';
      for (const amb of [CD.E, CD.W, CD.N, CD.S]) {
        const p = blockPath(L, st, amb);
        if (!p || (p.deadEnd && !p.exit && p.cells.length < 2)) continue;
        if (this.pathBusy(p.cells)) continue;
        t.occ = [{ el: st, dir: p.cells[0].dir }];
        t.headPos = st.length / 2;
        t.path = p.cells; t.pathIdx = 0; t.pathInfo = p;
        this.colorPath(p.cells.slice(1), 'route');
        t.status = 'stopped'; t.enteredAt = this.time;
        t.timeDep = Math.max(this.time + 30, stationDeparture(t));
        this.markOcc(t);
        this.alert(`Treno ${t.name} pronto al binario ${st.name}`, 'info', t, st);
        return 'ok';
      }
      return 'nessuna via d’uscita dal binario';
    }
    return `punto d’ingresso "${name}" sconosciuto`;
  }

  private placeEntering(t: Train, p: BlockPath) {
    t.path = p.cells; t.pathIdx = 0; t.pathInfo = p;
    this.colorPath(p.cells, 'route');
    t.occ = [p.cells[0]];
    t.headPos = 0;
    t.outside = false;
    t.status = 'running';
    t.enteredAt = this.time;
    const sp = this.trackSpeed(p.cells[0].el, t);
    t.limit = sp || t.def.maxSpeed || 60;
    t.speed = Math.min(t.def.maxSpeed || 60, sp || 1e9, t.limit);
    if (t.delayEnterSec > 60) this.perf.delayMinutes += Math.round(t.delayEnterSec / 60);
    this.markOcc(t);
    this.alert(`Treno ${t.name} entra da ${t.def.entrance}`, 'info', t);
    this.onTrainEnter?.(t);
  }

  /** Limite di velocità dell'elemento (sugli scambi vale solo in posizione rovescia, come nell'originale). */
  private trackSpeed(el: Element, t: Train): number {
    if (el.kind === 'switch' && !el.switched) return 0;
    return el.speed[t.type] || el.speed[0] || 0;
  }

  private pickDelay(d?: Delay[]): number {
    if (!d || !this.randomDelays) return 0;
    for (const x of d) if (this.rnd() * 100 < x.prob) return x.seconds;
    return 0;
  }

  private checkDeparture(t: Train) {
    if (this.time < t.timeDep) return;
    // segnale di partenza
    const end = t.pathInfo?.endSignal;
    if (end && end.departure && !end.clear) { t.holding = true; return; }
    t.holding = false;
    const sd = t.def.startDelay || this.schedule.typeStartDelay[t.type] || 0;
    t.status = 'running';
    if (sd > 0) { t.status = 'starting'; t.startLeft = sd; }
    if (t.status === 'running') this.run(t);
  }

  /** Distanza dalla testa all'inizio della cella path[i]. */
  private distTo(t: Train, i: number): number {
    let d = (t.path[t.pathIdx]?.el.length ?? 0) - t.headPos;
    for (let k = t.pathIdx + 1; k < i; k++) d += t.path[k].el.length;
    return d;
  }

  /** Il treno deve fermarsi in questa stazione? Restituisce l'indice della fermata (o -1 per destinazione). */
  private stopIndexFor(t: Train, el: Element): number | undefined {
    if (!el.isStation || !el.name) return undefined;
    if (t.shunting) return el === t.outOf ? undefined : -2;
    const i = t.def.stops.findIndex((s, k) => s.minStop > 0 && !t.served.has(k) && sameStation(s.station, el.name));
    if (i >= 0) return i;
    if (sameStation(el.name, t.def.exit) && !t.served.has(-1)) return -1;
    return undefined;
  }

  private run(t: Train) {
    if (t.outside) { this.runOutside(t); return; }
    if (!t.path.length) { t.status = 'derailed'; return; }
    // ----- calcolo del punto di arresto e dei rallentamenti
    let stopDist = Infinity;
    let stopKind: 'station' | 'end' | null = null;
    let stopEl: Element | undefined;
    let stopIdx: number | undefined;
    const L2 = t.length;
    let acc = -t.headPos;
    let maxV = this.allowedSpeed(t);
    const pathEnd = this.distTo(t, t.path.length);
    if (t.pendingStop && this.stopIndexFor(t, t.pendingStop.el) !== t.pendingStop.idx) t.pendingStop = undefined;
    for (let i = t.pathIdx; i < t.path.length; i++) {
      const el = t.path[i].el;
      const startD = acc;
      acc += el.length;
      if (!t.pendingStop) {
        const si = this.stopIndexFor(t, el);
        if (si !== undefined && !(t.status === 'running' && el === t.outOf)) {
          // il treno si ferma con il centro sul binario di stazione (come nell'originale)
          const target = Math.min(startD + el.length / 2 + L2 / 2, Math.max(startD + el.length / 2, pathEnd));
          if (target >= -0.5) t.pendingStop = { odo: t.odo + Math.max(0, target), el, idx: si };
        }
      }
      if (i > t.pathIdx) {
        const sp = this.trackSpeed(el, t);
        if (sp && sp < maxV) maxV = Math.min(maxV, brakingSpeed(Math.max(0, startD), sp));
      }
    }
    const info0 = t.pathInfo;
    const endClear0 = info0?.exit ? true : !!info0?.endSignal?.clear;
    if (t.pendingStop) {
      stopDist = Math.max(0, endClear0 ? t.pendingStop.odo - t.odo : Math.min(t.pendingStop.odo - t.odo, pathEnd));
      stopKind = 'station'; stopEl = t.pendingStop.el; stopIdx = t.pendingStop.idx;
    }
    const endD = acc;
    const info = t.pathInfo;
    const endClear = info?.exit ? true : info?.endSignal ? info.endSignal.clear && this.nextBlockOk(info) : false;
    if (!endClear && endD < stopDist) { stopDist = endD; stopKind = 'end'; }
    if (t.shunting) maxV = Math.min(maxV, 30);
    if (stopKind) maxV = Math.min(maxV, brakingSpeed(stopDist, 5));
    // ----- velocità
    const acc_ = t.def.accelRate || this.schedule.typeAccel[t.type] || 1;
    if (t.speed > maxV) t.speed = maxV;
    else t.speed = Math.min(maxV, t.speed + acc_);
    if (t.speed < 1 && stopDist > 0.5) t.speed = Math.min(maxV, 5);
    let d = t.speed / 3.6;
    if (stopKind && d >= stopDist) {
      this.advance(t, stopDist);
      t.speed = 0;
      if (stopKind === 'station') { t.pendingStop = undefined; this.arriveAt(t, stopEl!, stopIdx!); }
      else this.stopAtEnd(t);
      return;
    }
    if (t.status === 'waiting') { t.status = 'running'; }
    this.advance(t, d);
  }

  private nextBlockOk(info: BlockPath): boolean {
    // il segnale è verde: la sezione successiva è già riservata
    return !!info.endSignal?.clear;
  }

  private allowedSpeed(t: Train): number {
    const max = t.def.maxSpeed || 0;
    const lim = t.limit || (max ? max : 60);
    return max ? Math.min(max, lim) : lim;
  }

  /** Sposta la testa di d metri lungo il percorso. */
  private advance(t: Train, d: number) {
    let guard = 0;
    while (d > 1e-9 && guard++ < 1000) {
      if (t.outside) { t.outDist += d; d = 0; break; }
      const head = t.path[t.pathIdx];
      const remain = head.el.length - t.headPos;
      if (d < remain) { t.headPos += d; t.odo += d; d = 0; break; }
      d -= remain; t.odo += remain; t.headPos = head.el.length;
      if (!this.nextCell(t)) { d = 0; break; }
    }
    this.markOcc(t);
  }

  /** Passa alla cella successiva; restituisce false se il treno si deve fermare. */
  private nextCell(t: Train): boolean {
    if (t.pathIdx + 1 < t.path.length) {
      t.pathIdx++;
      const c = t.path[t.pathIdx];
      t.occ.unshift(c);
      t.headPos = 0;
      const sp = this.trackSpeed(c.el, t);
      if (sp) t.limit = sp;
      if (c.el.isStation && c.el.name && !t.shunting) {
        t.def.stops.forEach((s, i) => { if (!s.minStop && !t.served.has(i) && sameStation(s.station, c.el.name)) t.served.set(i, { lateMin: Math.round((this.time - s.departure) / 60), passed: true, departure: this.time }); });
      }
      if (t.outOf && c.el !== t.outOf && !c.el.isStation) { /* lasciata la stazione */ }
      return true;
    }
    const info = t.pathInfo!;
    if (info.exit) { this.beginExit(t, info.exit); return true; }
    if (info.endSignal && info.endSignal.clear && info.nextEl) {
      const sig = info.endSignal;
      const np = blockPath(this.layout, info.nextEl, info.nextDir ?? CD.E);
      if (!np) { t.status = 'waiting'; return false; }
      sig.clear = false;
      this.pendingClear.delete(sig);
      t.path = np.cells; t.pathIdx = 0; t.pathInfo = np;
      t.occ.unshift(np.cells[0]);
      t.headPos = 0;
      const sp = this.trackSpeed(np.cells[0].el, t);
      if (sp) t.limit = sp;
      for (const e of np.cells) this.thrownSince.delete(e.el);
      this.updateAspects();
      return true;
    }
    return false;
  }

  private beginExit(t: Train, exitText: Element) {
    t.outside = true; t.outDist = 0;
    t.exitedVia = exitText.name;
    const ok = sameStation(exitText.name, t.def.exit) || t.def.altExits.some((a) => sameStation(a, exitText.name));
    if (!ok && !t.shunting) {
      t.wrongDest = true; this.perf.wrongDest++;
      this.alert(`Treno ${t.name} uscito da ${exitText.name} invece che da ${t.def.exit}!`, 'bad', t);
    }
    this.finishTrain(t, ok);
  }

  private runOutside(t: Train) {
    t.speed = Math.min(this.allowedSpeed(t), t.speed + 1);
    t.outDist += t.speed / 3.6;
    this.markOcc(t);
    if (!t.occ.length) { t.status = 'exited'; t.outside = false; }
  }

  private finishTrain(t: Train, correct: boolean, where = 'uscito') {
    t.exitedAt = this.time;
    const late = Math.round((this.time - t.def.timeOut) / 60);
    t.lateMin = Math.max(0, late);
    if (late > 0) { this.perf.lateTrains++; this.perf.lateMinutes += late; }
    else if (correct) this.perf.arrivedOnTime++;
    t.def.stops.forEach((s, i) => { if (s.minStop > 0 && !t.served.has(i) && this.layout.stationTracks().some((e) => sameStation(e.name, s.station))) { t.missedStops++; this.perf.missedStops++; } });
    if (correct) this.alert(`Treno ${t.name} ${where} ${late > 0 ? `con ${late}′ di ritardo` : 'in orario'}`, late > 0 ? 'warn' : 'good', t);
  }

  private stopAtEnd(t: Train) {
    const info = t.pathInfo;
    if (t.shunting && info?.deadEnd) { this.endShunt(t); return; }
    if (info?.deadEnd) {
      if (t.status !== 'waiting') this.alert(`Treno ${t.name} fermo a fine binario`, 'warn', t, t.occ[0]?.el);
      t.status = 'waiting';
      return;
    }
    if (t.status !== 'waiting') {
      const s = info?.endSignal;
      if (s && !s.noPenalty) this.perf.waiting++;
      this.alert(`Treno ${t.name} fermo al segnale ${s?.label ?? ''}`, 'warn', t, s);
    }
    t.status = 'waiting';
  }

  private endShunt(t: Train) {
    t.shunting = false;
    t.outOf = undefined;
    t.status = t.arrivedAtStation || t.served.has(-1) ? 'arrived' : 'stopped';
    t.timeDep = Math.max(t.timeDep, this.time + 30);
  }

  private arriveAt(t: Train, el: Element, idx: number) {
    if (idx === -2) { // fine manovra
      this.endShunt(t);
      const st = t.def.stops.findIndex((s, k) => !t.served.has(k) && sameStation(s.station, el.name));
      if (st >= 0) t.timeDep = Math.max(this.time + 30, t.def.stops[st].departure);
      if (sameStation(el.name, t.def.exit) && !t.def.stops.some((s, k) => s.minStop > 0 && !t.served.has(k))) this.arriveDestination(t, el);
      return;
    }
    if (idx === -1) { this.arriveDestination(t, el); return; }
    const s = t.def.stops[idx];
    const lateMin = Math.round((this.time - s.arrival) / 60);
    const rec: StopRecord = { arrival: this.time, lateMin, platform: platformOf(el.name!) };
    t.served.set(idx, rec);
    this.checkPlatform(t, s.station, el);
    t.status = 'stopped';
    const dep = s.departure < s.arrival ? s.departure + 86400 : s.departure;
    t.timeDep = Math.max(this.time + s.minStop, dep) + this.pickDelay(s.depDelay);
    t.outOf = el;
    this.alert(`Treno ${t.name} arrivato a ${el.name}${lateMin > 0 ? ` (+${lateMin}′)` : ''}`, 'info', t, el);
  }

  private checkPlatform(t: Train, wanted: string, el: Element) {
    const pw = platformOf(wanted);
    if (pw !== undefined && platformOf(el.name!) !== pw) {
      t.wrongPlatform = true; this.perf.wrongPlatform++;
      this.alert(`Treno ${t.name} al binario ${platformOf(el.name!) ?? '?'} invece del ${pw}`, 'bad', t, el);
    }
  }

  private arriveDestination(t: Train, el: Element) {
    t.served.set(-1, { arrival: this.time, lateMin: Math.round((this.time - t.def.timeOut) / 60) });
    this.checkPlatform(t, t.def.exit, el);
    t.status = 'arrived';
    t.arrivedAtStation = el;
    t.arrivedTime = this.time;
    this.finishTrain(t, true, `arrivato a destinazione (${el.name})`);
    t.exitedAt = undefined;
    // il materiale resta sul binario finché non viene riassegnato
  }

  /** Ricalcola le celle occupate dal corpo del treno. */
  markOcc(t: Train) {
    let rem = t.length;
    let keep: number;
    if (t.outside) {
      rem -= t.outDist;
      keep = 0;
      let i = 0;
      while (i < t.occ.length && rem > 0) { rem -= t.occ[i].el.length; i++; }
      keep = i;
    } else {
      rem -= t.headPos;
      let i = 1;
      while (i < t.occ.length && rem > 0) { rem -= t.occ[i].el.length; i++; }
      keep = Math.max(1, i);
    }
    for (let i = keep; i < t.occ.length; i++) {
      const el = t.occ[i].el;
      if (this.owner.get(el) === t) { this.owner.delete(el); el.state = 'free'; }
    }
    t.occ.length = Math.min(t.occ.length, keep);
    // celle uniche (un treno può passare due volte sulla stessa cella in un anello)
    for (const c of t.occ) { this.owner.set(c.el, t); c.el.state = 'occupied'; }
  }

  private releaseAhead(t: Train) {
    for (let i = t.pathIdx + 1; i < t.path.length; i++) {
      const el = t.path[i].el;
      if (this.owner.get(el) !== t && el.state === 'route') el.state = 'free';
    }
    t.path = []; t.pathIdx = 0; t.pathInfo = undefined;
  }

  // ------------------------------------------------------------ informazioni

  summary() {
    const c: Record<string, number> = {};
    for (const t of this.trains) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }

  describeTrain(t: Train): string {
    const d = t.def;
    const parts = [`${d.name} — ${STATUS_IT[t.status]}`, `Ingresso ${formatTime(d.timeIn)} da ${d.entrance}`, `Uscita ${formatTime(d.timeOut)} da ${d.exit}`];
    const ns = t.nextStop();
    if (ns) parts.push(`Prossima fermata ${ns.station} arr. ${formatTime(ns.arrival)} part. ${formatTime(ns.departure)}`);
    if (t.def.notes.length) parts.push(t.def.notes.join(' '));
    return parts.join(' · ');
  }
}

function stationDeparture(t: Train): number {
  const s = t.def.stops.find((x) => x.minStop >= 0);
  return s ? s.departure : t.def.timeIn;
}

function short(n: string) { const p = n.split(/\s+/); return p.find((x) => /\d/.test(x)) ?? p[0]; }

/** Porta tutti gli orari di un treno dopo l'ora d'ingresso (treni a cavallo della mezzanotte). */
function normalizeTimes(d: TrainDef) {
  const t0 = d.timeIn;
  const fix = (x: number) => (x < t0 - 6 * 3600 ? x + 86400 : x);
  for (const s of d.stops) { s.arrival = fix(s.arrival); s.departure = fix(s.departure); }
  d.timeOut = fix(d.timeOut);
}

export { baseStation, validEntry, isStopSignal };
