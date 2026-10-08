// Barra comandi: il giocatore digita i "pulsanti" (segnali, deviatoi, uscite)
// separati da spazi. Esempi:
//   12 18        forma l'itinerario dal segnale 12 al segnale 18
//   12 18 E      ... e prosegue fino all'uscita E
//   12           apre/chiude il segnale 12
//   x 12         annulla (segnale 12 a via impedita)
//   d5 d7        manovra i deviatoi 5 e 7
//   a 31         blocco automatico sul segnale 31
//   inv 2241     inverte la marcia del treno 2241
import { Element, Signal } from './layout';
import { RoutePlan } from './paths';
import { Simulation, Train } from './sim';

export type Token =
  | { kind: 'signal'; s: Signal; raw: string }
  | { kind: 'switch'; e: Element; raw: string }
  | { kind: 'exit'; e: Element; raw: string }
  | { kind: 'itin'; name: string; raw: string }
  | { kind: 'train'; t: Train; raw: string }
  | { kind: 'verb'; v: Verb; raw: string }
  | { kind: 'number'; n: number; raw: string }
  | { kind: 'unknown'; raw: string };

export type Verb = 'cancel' | 'auto' | 'reverse' | 'shunt' | 'start' | 'assign' | 'info' | 'pause' | 'run' | 'speed' | 'help' | 'next' | 'switch';

const VERBS: Record<string, Verb> = {
  x: 'cancel', annulla: 'cancel', cancel: 'cancel', r: 'cancel', rosso: 'cancel',
  a: 'auto', auto: 'auto', ba: 'auto',
  inv: 'reverse', inverti: 'reverse', rev: 'reverse', reverse: 'reverse',
  man: 'shunt', manovra: 'shunt', shunt: 'shunt',
  parti: 'start', via: 'start', start: 'start',
  ass: 'assign', assegna: 'assign', assign: 'assign',
  info: 'info', i: 'info',
  pausa: 'pause', stop: 'pause', p: 'pause',
  go: 'run', avvia: 'run', play: 'run',
  v: 'speed', vel: 'speed', speed: 'speed',
  '?': 'help', aiuto: 'help', help: 'help',
  salta: 'next', avanti: 'next', next: 'next',
  dev: 'switch', d: 'switch',
};

export interface CommandHost {
  sim: Simulation;
  setRunning(on: boolean): void;
  setSpeed(n: number): void;
  skipToNext(): void;
  showHelp(): void;
  showTrain(t: Train): void;
}

export interface Preview {
  plans: RoutePlan[];
  signals: Signal[];
  switches: Element[];
  trains: Train[];
  message: string;
  ok: boolean;
}

export class CommandInterpreter {
  constructor(public host: CommandHost) {}

  get sim() { return this.host.sim; }

  resolve(raw: string, preferTrain = false): Token {
    const L = this.sim.layout;
    const low = raw.toLowerCase();
    if (!preferTrain) {
      if (VERBS[low] && !L.signals.some((s) => s.label?.toLowerCase() === low)) return { kind: 'verb', v: VERBS[low], raw };
      const s = L.signals.find((x) => x.label?.toLowerCase() === low);
      if (s) return { kind: 'signal', s, raw };
      const sw = L.switches.find((x) => x.label?.toLowerCase() === low);
      if (sw) return { kind: 'switch', e: sw, raw };
      const ex = L.entryPoints().find((x) => x.label?.toLowerCase() === low);
      if (ex) return { kind: 'exit', e: ex, raw };
      const it = L.itineraries.find((x) => x.name.toLowerCase() === low);
      if (it) return { kind: 'itin', name: it.name, raw };
    }
    const t = this.findTrain(raw);
    if (t) return { kind: 'train', t, raw };
    if (/^\d+$/.test(raw)) return { kind: 'number', n: +raw, raw };
    return { kind: 'unknown', raw };
  }

  findTrain(raw: string): Train | undefined {
    const low = raw.toLowerCase();
    const tr = this.sim.trains.filter((t) => t.status !== 'notToday');
    const exact = tr.find((t) => t.name.toLowerCase() === low);
    if (exact) return exact;
    const first = tr.filter((t) => t.name.toLowerCase().split(/\s+/)[0] === low);
    const pick = (arr: Train[]) => arr.find((t) => t.onLayout) ?? arr.find((t) => ['ready', 'delayed'].includes(t.status)) ?? arr[0];
    if (first.length) return pick(first);
    const num = tr.filter((t) => new RegExp(`(^|\\D)${escapeRe(low)}(\\D|$)`).test(t.name.toLowerCase()));
    if (num.length) return pick(num);
    return undefined;
  }

  /** Suddivide in comandi separati da ";" o ",". */
  split(line: string): string[][] {
    return line.split(/[;,]/).map((c) => c.trim().split(/\s+/).filter(Boolean)).filter((c) => c.length);
  }

  /** Anteprima (senza modificare lo stato) per l'evidenziazione sul quadro. */
  preview(line: string): Preview {
    const pv: Preview = { plans: [], signals: [], switches: [], trains: [], message: '', ok: true };
    const msgs: string[] = [];
    for (const words of this.split(line)) {
      const toks = words.map((w, i) => this.resolve(w, i > 0 && this.isTrainVerb(words[0])));
      const unknown = toks.find((t) => t.kind === 'unknown');
      if (unknown) { pv.ok = false; msgs.push(`"${unknown.raw}" non riconosciuto`); continue; }
      const head = toks[0];
      if (head.kind === 'verb') {
        const args = toks.slice(1);
        for (const a of args) { if (a.kind === 'train') pv.trains.push(a.t); if (a.kind === 'signal') pv.signals.push(a.s); if (a.kind === 'switch') pv.switches.push(a.e); }
        msgs.push(verbDesc(head.v, args));
        continue;
      }
      if (head.kind === 'signal' && toks.length > 1) {
        const r = this.planChain(toks);
        if ('error' in r) { pv.ok = false; msgs.push(r.error); }
        else { pv.plans.push(...r.plans); msgs.push(r.desc); }
        continue;
      }
      for (const t of toks) {
        if (t.kind === 'signal') { pv.signals.push(t.s); msgs.push(`${t.s.clear ? 'chiude' : 'apre'} il segnale ${t.s.label}`); }
        else if (t.kind === 'switch') { pv.switches.push(t.e); msgs.push(`manovra il deviatoio ${t.e.label}`); }
        else if (t.kind === 'itin') msgs.push(`itinerario ${t.name}`);
        else if (t.kind === 'train') { pv.trains.push(t.t); msgs.push(`treno ${t.t.name}`); }
        else if (t.kind === 'exit') msgs.push(`uscita ${t.e.label}`);
      }
    }
    pv.message = msgs.join(' · ');
    return pv;
  }

  private isTrainVerb(w: string) {
    const v = VERBS[w.toLowerCase()];
    return v === 'reverse' || v === 'shunt' || v === 'start' || v === 'assign' || v === 'info';
  }

  /** Pianifica una catena "S1 S2 S3 ... [uscita]". */
  planChain(toks: Token[]): { plans: RoutePlan[]; desc: string } | { error: string } {
    const plans: RoutePlan[] = [];
    let from = (toks[0] as { s: Signal }).s;
    const names: string[] = [from.label!];
    for (let i = 1; i < toks.length; i++) {
      const t = toks[i];
      let plan: RoutePlan | null = null;
      if (t.kind === 'signal') plan = this.sim.planRoute(from, { signal: t.s });
      else if (t.kind === 'exit') plan = this.sim.planRoute(from, { exit: t.e });
      else return { error: `"${t.raw}" non è un segnale né un'uscita` };
      if (!plan) return { error: `Nessun itinerario possibile da ${from.label} a ${t.raw}` };
      plans.push(plan);
      names.push(t.raw);
      if (t.kind === 'exit') break;
      from = t.s;
    }
    const nsw = plans.reduce((n, p) => n + [...p.switches].filter(([sw, pos]) => sw.switched !== pos).length, 0);
    return { plans, desc: `itinerario ${names.join(' → ')}${nsw ? ` · ${nsw} deviatoi da manovrare` : ''}` };
  }

  /** Esegue una riga di comando. Restituisce i messaggi di esito. */
  execute(line: string): { ok: boolean; msg: string }[] {
    const out: { ok: boolean; msg: string }[] = [];
    for (const words of this.split(line)) out.push(...this.exec1(words));
    return out;
  }

  private exec1(words: string[]): { ok: boolean; msg: string }[] {
    const sim = this.sim;
    const toks = words.map((w, i) => this.resolve(w, i > 0 && this.isTrainVerb(words[0])));
    const unknown = toks.find((t) => t.kind === 'unknown');
    if (unknown) return [{ ok: false, msg: `"${unknown.raw}" non riconosciuto (digita ? per l'aiuto)` }];
    const head = toks[0];
    if (head.kind === 'verb') return this.execVerb(head.v, toks.slice(1));
    if (head.kind === 'signal' && toks.length > 1) {
      const r = this.planChain(toks);
      if ('error' in r) { sim.perf.denied++; return [{ ok: false, msg: r.error }]; }
      const res: { ok: boolean; msg: string }[] = [];
      for (const p of r.plans) {
        const x = sim.applyRoute(p);
        res.push(x);
        if (!x.ok) break;
      }
      return res;
    }
    const res: { ok: boolean; msg: string }[] = [];
    for (const t of toks) {
      if (t.kind === 'signal') res.push(sim.toggleSignal(t.s));
      else if (t.kind === 'switch') res.push(sim.throwSwitch(t.e));
      else if (t.kind === 'itin') res.push(sim.activateItinerary(t.name));
      else if (t.kind === 'train') { this.host.showTrain(t.t); res.push({ ok: true, msg: sim.describeTrain(t.t) }); }
      else if (t.kind === 'exit') res.push({ ok: false, msg: `${t.raw} è un'uscita: usala come destinazione (es. "12 ${t.raw}")` });
      else if (t.kind === 'number') res.push({ ok: false, msg: `Nessun segnale ${t.raw}` });
    }
    return res;
  }

  private execVerb(v: Verb, args: Token[]): { ok: boolean; msg: string }[] {
    const sim = this.sim;
    const trains = args.filter((a): a is Extract<Token, { kind: 'train' }> => a.kind === 'train').map((a) => a.t);
    const need = (what: string) => [{ ok: false, msg: `Specifica ${what}` }];
    switch (v) {
      case 'cancel': {
        const sigs = args.filter((a) => a.kind === 'signal') as Extract<Token, { kind: 'signal' }>[];
        if (!sigs.length) return need('il segnale da annullare (es. x 12)');
        return sigs.map((s) => sim.closeSignal(s.s));
      }
      case 'auto': {
        const sigs = args.filter((a) => a.kind === 'signal') as Extract<Token, { kind: 'signal' }>[];
        if (!sigs.length) return need('il segnale (es. a 31)');
        return sigs.map((s) => sim.toggleFleet(s.s));
      }
      case 'switch': {
        const out: { ok: boolean; msg: string }[] = [];
        for (const a of args) {
          if (a.kind === 'switch') out.push(sim.throwSwitch(a.e));
          else if (a.kind === 'number' || a.kind === 'signal') {
            const sw = sim.layout.switches.find((s) => s.label === 'd' + a.raw);
            out.push(sw ? sim.throwSwitch(sw) : { ok: false, msg: `Nessun deviatoio ${a.raw}` });
          }
        }
        return out.length ? out : need('il deviatoio (es. d 5)');
      }
      case 'reverse': return trains.length ? trains.map((t) => sim.reverseTrain(t)) : need('il treno (es. inv 2241)');
      case 'shunt': return trains.length ? trains.map((t) => sim.shuntTrain(t)) : need('il treno (es. man 2241)');
      case 'start': return trains.length ? trains.map((t) => sim.startNow(t)) : need('il treno');
      case 'assign': {
        if (trains.length < 2) {
          const t = trains[0];
          if (t && t.def.stock) { const to = sim.trainNamed(t.def.stock); if (to) return [sim.assign(t, to)]; }
          return need('treno arrivato e treno da formare (es. ass 2240 2243)');
        }
        return [sim.assign(trains[0], trains[1])];
      }
      case 'info': {
        if (!trains.length) return need('il treno');
        this.host.showTrain(trains[0]);
        return [{ ok: true, msg: sim.describeTrain(trains[0]) }];
      }
      case 'pause': this.host.setRunning(false); return [{ ok: true, msg: 'Simulazione in pausa' }];
      case 'run': this.host.setRunning(true); return [{ ok: true, msg: 'Simulazione avviata' }];
      case 'speed': {
        const n = args[0] && (args[0].kind === 'number' || args[0].kind === 'signal') ? parseInt(args[0].raw) : NaN;
        if (!n) return need('la velocità (es. v 10)');
        this.host.setSpeed(n);
        return [{ ok: true, msg: `Velocità ×${n}` }];
      }
      case 'next': this.host.skipToNext(); return [{ ok: true, msg: 'Avanzamento al prossimo evento' }];
      case 'help': this.host.showHelp(); return [{ ok: true, msg: '' }];
    }
  }

  /** Suggerimenti per il completamento dell'ultima parola. */
  suggest(line: string, max = 8): { text: string; hint: string }[] {
    const parts = line.split(/[;,]/);
    const cur = parts[parts.length - 1];
    const words = cur.trimStart().split(/\s+/);
    const last = (words[words.length - 1] ?? '').toLowerCase();
    const first = words[0]?.toLowerCase() ?? '';
    const sim = this.sim;
    const out: { text: string; hint: string }[] = [];
    const add = (text: string, hint: string) => { if (out.length < max && text.toLowerCase().startsWith(last) && text.toLowerCase() !== last) out.push({ text, hint }); };
    if (words.length > 1 && this.isTrainVerb(first)) {
      for (const t of sim.trains) if (t.onLayout || t.status === 'delayed' || t.status === 'ready') add(t.name.split(/\s+/).find((x) => /\d/.test(x)) ?? t.name, t.def.entrance + ' → ' + t.def.exit);
      return out;
    }
    if (!last) return out;
    if (words.length > 1) {
      const prev = this.resolve(words[words.length - 2]);
      if (prev.kind === 'signal' && prev.s.controls) {
        // destinazioni raggiungibili dal segnale precedente
        for (const s of sim.layout.signals) if (s !== prev.s && !s.approach && s.label) add(s.label, 'segnale');
        for (const e of sim.layout.entryPoints()) add(e.label!, 'uscita');
        return out;
      }
    }
    for (const s of sim.layout.signals) if (!s.approach && s.label) add(s.label, s.clear ? 'segnale (verde)' : 'segnale');
    for (const sw of sim.layout.switches) add(sw.label!, sw.switched ? 'deviatoio (rovescio)' : 'deviatoio');
    for (const it of sim.layout.itineraries) add(it.name, 'itinerario');
    for (const e of sim.layout.entryPoints()) add(e.label!, 'uscita');
    for (const [w] of Object.entries(VERBS)) if (w.length > 2) add(w, 'comando');
    return out;
  }
}

function verbDesc(v: Verb, args: Token[]) {
  const a = args.map((x) => x.raw).join(' ');
  const d: Record<Verb, string> = {
    cancel: 'annulla', auto: 'blocco automatico', reverse: 'inverte la marcia di', shunt: 'manovra', start: 'partenza anticipata di',
    assign: 'assegna materiale', info: 'informazioni su', pause: 'pausa', run: 'avvia', speed: 'velocità', help: 'aiuto', next: 'salta al prossimo evento', switch: 'deviatoio',
  };
  return `${d[v]} ${a}`.trim();
}

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
