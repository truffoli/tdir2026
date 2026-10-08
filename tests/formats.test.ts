import { describe, expect, it } from 'vitest';
import { parseSch, parseTime, formatTime } from '../src/core/sch';
import { parseTrk, serializeTrk } from '../src/core/trk';
import { sameStation } from '../src/core/layout';
import { level2 } from '../src/scenarios/level2';

describe('orario .sch', () => {
  const S = parseSch(`#!trdir
Start: 05:50
Type: 3 +20
Train: R20374
     0:00,  5:32,  Voghera
Enter: 5:59, F2
     6:00, 6:01,  Spinetta
     6:07, -,  Alessandria
Stock: R20377
When: 167
Notes: Note relative al treno...
.
Train: R20377
  Wait: R20374 240
  Enter: 6:31!120/10,60/25 Alessandria@1|A2
     6:36:30, 6:37,  Spinetta
     +120+90, +60, Tortona
     6:58, -,  Voghera|V2
.
Train: "IC 9"
Wait: "R 1 2" 30
Enter: 7:00, A
  -, 7:05, B
  7:10, -, C
.
`);
  it('legge intestazione e treni', () => {
    expect(S.start).toBe(parseTime('05:50').t);
    expect(S.typeStartDelay[2]).toBe(20);
    expect(S.trains.map((t) => t.name)).toEqual(['R20374', 'R20377', '"IC 9"']);
  });
  it('ignora le fermate prima di Enter e legge giorni, materiale e note', () => {
    const t = S.trains[0];
    expect(t.entrance).toBe('F2');
    expect(t.stops.map((s) => s.station)).toEqual(['Voghera', 'Spinetta']);
    expect(t.exit).toBe('Alessandria');
    expect(t.stock).toBe('R20377');
    expect(t.days).toBe(1 | 32 | 64);
    expect(t.notes[0]).toContain('Note');
  });
  it('ritardi casuali, orari relativi, ingressi e uscite alternativi', () => {
    const t = S.trains[1];
    expect(t.waitFor).toBe('R20374');
    expect(t.waitTime).toBe(240);
    expect(t.entryDelay).toEqual([{ seconds: 120, prob: 10 }, { seconds: 60, prob: 25 }]);
    expect(t.entrance).toBe('Alessandria@1');
    expect(t.altEntrances).toEqual(['A2']);
    expect(formatTime(t.stops[0].arrival, true)).toBe('06:36:30');
    expect(formatTime(t.stops[1].arrival, true)).toBe('06:39:00');
    expect(formatTime(t.stops[1].departure, true)).toBe('06:40:30');
    expect(t.stops[1].minStop).toBe(90);
    expect(t.altExits).toEqual(['V2']);
    expect(t.stops[2]).toBeUndefined();
  });
  it('transiti senza fermata e Wait tra virgolette', () => {
    const t = S.trains[2];
    expect(t.waitFor).toBe('R 1 2');
    expect(t.stops[0].minStop).toBe(0);
  });
  it('stessa stazione ignorando il binario', () => {
    expect(sameStation('Milano@3', 'Milano')).toBe(true);
    expect(sameStation('Milano@3', 'Milano@4')).toBe(true);
    expect(sameStation('Milano', 'Monza')).toBe(false);
  });
});

describe('tracciato .trk', () => {
  it('rilegge ciò che scrive', () => {
    const L = parseTrk(level2.trk);
    const L2 = parseTrk(serializeTrk(L));
    expect(L2.elements.length).toBe(L.elements.length);
    expect(L2.signals.map((s) => [s.x, s.y, s.dir, s.fleeted, s.name])).toEqual(L.signals.map((s) => [s.x, s.y, s.dir, s.fleeted, s.name]));
  });
  it('legge segnali, scambi senza virgola, itinerari e attributi', () => {
    const L = parseTrk(`0,9,8,1,0,1,0,0,0,0,noname
0,10,8,1,1,300,0,0,0,0,@120/100,Stazione@1
1,11,8,2,0,0noname
0,12,8,1,0,50,0,0,0,0,noname
0,12,9,5,0,50,0,0,0,0,noname
2,10,7,2049,10,8,@rfi_avv_dev.tds
2,12,7,3,12,8,Prot. A
4,6,8,0,W,0,0,9,8
7,0,0,0,IT1,Prot. A,(20,20),@,11,8,1,
(attributes 12,7
departure 1
)
`);
    const sigs = L.signals;
    expect(sigs[0].approach).toBe(true);
    expect(sigs[0].noClickPenalty).toBe(true);
    expect(sigs[1].fleeted).toBe(true);
    expect(sigs[1].departure).toBe(true);
    expect(sigs[1].name).toBe('Prot. A');
    expect(L.trackAt(10, 8)!.speed).toEqual([120, 100]);
    expect(L.trackAt(11, 8)!.kind).toBe('switch');
    expect(L.itineraries[0]).toMatchObject({ name: 'IT1', startSignal: 'Prot. A', endSignal: '(20,20)', switches: [{ x: 11, y: 8, thrown: true }] });
    expect(L.entryPoints().map((e) => e.name)).toEqual(['W']);
  });
});
