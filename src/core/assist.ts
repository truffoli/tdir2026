// Assistente del dirigente movimento: propone il prossimo comando per un treno.
import { Signal, sameStation, platformOf } from './layout';
import { RoutePlan } from './paths';
import { Simulation, Train } from './sim';

export interface Suggestion { train: Train; command: string; plan: RoutePlan; urgent: boolean; why: string }

/** Prossima destinazione del treno: binario della prossima fermata oppure uscita. */
export function nextTarget(t: Train): string {
  const ns = t.def.stops.find((s, i) => s.minStop > 0 && !t.served.has(i));
  if (ns) return ns.station;
  // transiti in stazione con binario indicato
  const tr = t.def.stops.find((s, i) => !t.served.has(i) && platformOf(s.station));
  if (tr && !t.served.has(-1)) return tr.station;
  return t.def.exit;
}

export function suggestFor(sim: Simulation, t: Train): Suggestion | undefined {
  const info = t.pathInfo;
  const sig = info?.endSignal;
  if (!sig || sig.clear || !t.onLayout || t.outside) return undefined;
  if (t.status === 'arrived') return undefined;
  const target = nextTarget(t);
  const L = sim.layout;
  const exits = L.findEntries(target);
  let plan: RoutePlan | null = null;
  let dest = '';
  const viaStop = t.def.stops.find((s, i) => !t.served.has(i) && platformOf(s.station) && s.station === target);
  if (exits.length) {
    plan = sim.planRoute(sig, { exit: exits[0] }, true);
    dest = exits[0].label ?? target;
  } else {
    plan = sim.planRoute(sig, { station: target }, true);
    // se non c'è il binario richiesto, prova qualunque binario della stazione
    // solo se il binario indicato è irraggiungibile in assoluto si ripiega su un altro binario
    if (!plan && target.includes('@') && !sim.reachable(sig, { station: target })) plan = sim.planRoute(sig, { station: target.split('@')[0] }, true);
    const last = plan?.segments[plan.segments.length - 1];
    dest = last?.path.endSignal?.label ?? (last?.path.exit?.label ?? '');
  }
  void viaStop;
  if (!plan) return undefined;
  const lastSeg = plan.segments[plan.segments.length - 1];
  if (!exits.length) {
    const pl = platformOf(target);
    // se l'itinerario passa per altri segnali o termina su un tronchino, si indica il binario
    if (pl && (plan.segments.length > 1 || !lastSeg.path.endSignal)) dest = 'b' + pl;
    else if (lastSeg.path.endSignal) dest = lastSeg.path.endSignal.label!;
  }
  const cmd = `${sig.label} ${dest}`.trim();
  const urgent = t.status === 'waiting' || t.status === 'delayed' || (t.status === 'stopped' && t.timeDep - sim.time < 60);
  return { train: t, command: cmd, plan, urgent, why: `${t.name} → ${target}` };
}

/** Suggerimenti per tutti i treni che stanno per incontrare un segnale rosso. */
export function suggestions(sim: Simulation, horizonM = 3000): Suggestion[] {
  const out: Suggestion[] = [];
  for (const t of sim.trains) {
    if (!t.onLayout || t.outside || !t.pathInfo?.endSignal || t.pathInfo.endSignal.clear) continue;
    if (t.status === 'stopped' && t.timeDep - sim.time > 120) continue;
    if (t.status === 'running') {
      // distanza dal segnale
      let d = (t.path[t.pathIdx]?.el.length ?? 0) - t.headPos;
      for (let k = t.pathIdx + 1; k < t.path.length; k++) d += t.path[k].el.length;
      if (d > horizonM) continue;
    }
    const s = suggestFor(sim, t);
    if (s) out.push(s);
  }
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent));
}

export { sameStation };
export type { Signal };
