import { describe, expect, it } from 'vitest';
import { parseTrk } from '../src/core/trk';
import { parseSch, formatTime } from '../src/core/sch';
import { assignLabels } from '../src/core/naming';
import { Simulation } from '../src/core/sim';
import { suggestions } from '../src/core/assist';
import { LEVELS } from '../src/scenarios';

/** Un "dirigente automatico" che applica i suggerimenti dell'assistente. */
function autoplay(id: string, opts: { maxSteps?: number } = {}) {
  const lv = LEVELS.find((l) => l.id === id)!;
  const L = parseTrk(lv.trk);
  assignLabels(L);
  const sim = new Simulation(L, parseSch(lv.sch), { randomDelays: false });
  if (lv.autoFleet) for (const s of L.signals) if (s.fleeted) sim.toggleFleet(s);
  const log: string[] = [];
  const end = sim.time + (opts.maxSteps ?? 3 * 3600);
  while (sim.time < end) {
    for (const sg of suggestions(sim, 2500)) {
      if (sg.train.status === 'stopped' && sg.train.timeDep - sim.time > 45) continue;
      const r = sim.applyRoute(sg.plan);
      if (r.ok) log.push(`${formatTime(sim.time)} ${sg.command} (${sg.why})`);
    }
    sim.step();
    if (sim.trains.every((t) => ['exited', 'notToday', 'arrived'].includes(t.status) && !t.def.stock)) break;
    if (sim.trains.every((t) => ['exited', 'notToday'].includes(t.status) || (t.status === 'arrived' && !t.def.stock))) break;
  }
  return { sim, log };
}

describe('livelli integrati', () => {
  for (const lv of LEVELS) {
    it(`${lv.title}: tracciato coerente`, () => {
      const L = parseTrk(lv.trk);
      assignLabels(L);
      for (const s of L.signals) expect(s.controls, `segnale ${s.name} senza binario`).toBeTruthy();
      const labels = L.signals.map((s) => s.label);
      expect(new Set(labels).size).toBe(labels.length);
      const S = parseSch(lv.sch);
      for (const t of S.trains) {
        const ok = L.findEntries(t.entrance).length || L.stationTracks().some((e) => e.name === t.entrance);
        expect(ok, `${t.name}: ingresso ${t.entrance}`).toBeTruthy();
      }
    });

    it(`${lv.title}: risolvibile dall'assistente senza errori`, () => {
      const { sim, log } = autoplay(lv.id);
      const bad = sim.trains.filter((t) => !['exited', 'notToday'].includes(t.status) && !(t.status === 'arrived' && !t.def.stock));
      if (bad.length) console.log(log.join('\n'), '\n', sim.alerts.map((a) => formatTime(a.time) + ' ' + a.text).join('\n'));
      expect(bad.map((t) => `${t.name}:${t.status}`)).toEqual([]);
      expect(sim.perf.wrongDest).toBe(0);
      expect(sim.perf.wrongPlatform).toBe(0);
    });
  }
});
