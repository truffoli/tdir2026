import { describe, expect, it } from 'vitest';
import { parseTrk } from '../src/core/trk';
import { parseSch } from '../src/core/sch';
import { assignLabels } from '../src/core/naming';
import { Simulation } from '../src/core/sim';
import { CommandInterpreter, CommandHost } from '../src/core/commands';
import { level1 } from '../src/scenarios/level1';

function setup() {
  const L = parseTrk(level1.trk);
  assignLabels(L);
  const S = parseSch(level1.sch);
  const sim = new Simulation(L, S, { randomDelays: false });
  const host: CommandHost = { sim, setRunning() {}, setSpeed() {}, skipToNext() {}, showHelp() {}, showTrain() {} };
  return { L, S, sim, cmd: new CommandInterpreter(host) };
}

const run = (sim: Simulation, until: string) => {
  const [h, m] = until.split(':').map(Number);
  while (sim.time < h * 3600 + m * 60) sim.step();
};

describe('livello 1', () => {
  it('carica tracciato e orario', () => {
    const { L, S } = setup();
    expect(L.signals.map((s) => s.label).sort()).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(L.switches.map((s) => s.label)).toEqual(['d1', 'd2']);
    expect(L.entryPoints().map((e) => e.label).sort()).toEqual(['E', 'O']);
    expect(S.trains.length).toBe(8);
    expect(S.start).toBe(7 * 3600);
  });

  it('forma itinerari con la barra comandi', () => {
    const { sim, cmd, L } = setup();
    const r = cmd.execute('4 6');
    expect(r.every((x) => x.ok)).toBe(true);
    expect(L.switches.find((s) => s.label === 'd2')!.switched).toBe(true);
    expect(L.signals.find((s) => s.label === '4')!.clear).toBe(true);
    // conflitto: 1 -> 3 passa su d1 (libero) ma non tocca il binario II
    expect(cmd.execute('1 3').every((x) => x.ok)).toBe(true);
    // 1 -> 5 è in conflitto con l'itinerario 4 -> 6 (binario II già impegnato)
    cmd.execute('x 1');
    const bad = cmd.execute('1 5');
    expect(bad[0].ok).toBe(false);
    expect(sim.perf.denied).toBeGreaterThan(0);
  });

  it('gioca l’orario senza errori se l’operatore instrada correttamente', () => {
    const { sim, cmd } = setup();
    const ok = (line: string) => { const r = cmd.execute(line); if (!r.every((x) => x.ok)) throw new Error(line + ': ' + r.map((x) => x.msg).join('; ')); };
    ok('4 6'); ok('1 3');
    run(sim, '07:07');
    expect(sim.trainNamed('R 2201')!.status).toBe('stopped');
    expect(sim.trainNamed('R 2202')!.status).toBe('stopped');
    ok('3 E'); ok('6 O');
    run(sim, '07:16');
    expect(sim.trainNamed('R 2201')!.status).toBe('exited');
    expect(sim.trainNamed('R 2202')!.status).toBe('exited');
    ok('4 2 O');
    run(sim, '07:26');
    ok('1 3 E');
    run(sim, '07:35');
    ok('4 6');
    run(sim, '07:39'); ok('6 O');
    run(sim, '07:45'); ok('1 5');
    run(sim, '07:52');
    expect(sim.trainNamed('R 2290')!.status).toBe('arrived');
    ok('1 3 E');
    run(sim, '07:59');
    const r91 = sim.trainNamed('R 2291')!;
    expect(r91.onLayout).toBe(true);
    expect(r91.stockFrom?.name).toBe('R 2290');
    ok('6 O');
    run(sim, '08:15');
    for (const t of sim.trains) expect([t.name, t.status]).toEqual([t.name, t.name === 'R 2290' ? 'exited' : 'exited']);
    expect(sim.perf.wrongDest).toBe(0);
    expect(sim.perf.wrongPlatform).toBe(0);
  });
});
