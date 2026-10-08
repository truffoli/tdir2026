// Livello 2 — Valmora Centrale: grande stazione passante su linea a doppio binario
// con diramazione a binario unico per Lago.
//
//   y=2                                   ┌──────────── Lago (L)
//   y=4             ┌──── 1 ─────────────┤
//   y=6            ┌┴──── 2 ─────────────┐
//   y=8  O ══════╗╔╪───── 3 ─────────────╪╗╔═════ E      (dispari, verso Est)
//   y=10 O ══════╝╚╪───── 4 ─────────────╪╝╚═════ E      (pari, verso Ovest)
//   y=12           └┬──── 5 ─────────────┬┘
//   y=14            └──── 6 ─────────────┘
import { TD } from '../core/geom';
import { TrkBuilder } from './builder';
import type { LevelDef } from './index';

const ST = 'Valmora Centrale';
const P0 = 30, P1 = 46; // estensione dei binari di stazione

function layout(): string {
  const b = new TrkBuilder();
  // ---------------------------------------------------------- linea Ovest
  b.text(0, 8, 'O', { e: [2, 8] });          // ingresso treni da Ovest (binario dispari)
  b.text(0, 10, 'O', { w: [2, 10] });        // uscita verso Ovest (binario pari)
  b.h(2, 13, 8, { len: 400, speed: 140 });
  b.h(2, 13, 10, { len: 400, speed: 140 });
  b.sig(8, 7, true, [8, 8], '101', { fleeted: true });   // blocco automatico
  b.sig(7, 11, false, [7, 10], '102', { fleeted: true });
  b.h(14, 15, 8, { len: 50, speed: 100 });
  b.h(14, 17, 10, { len: 50, speed: 100 });
  b.sig(14, 7, true, [14, 8], '1');                    // protezione lato Ovest
  // comunicazione 8 -> 10 (discendente) e 10 -> 8 (ascendente)
  b.sw(16, 8, 2); b.track(17, 9, TD.NW_SE, { len: 40, speed: 60 }); b.sw(18, 10, 1);
  b.track(17, 8, TD.W_E, { len: 30 }).track(18, 8, TD.W_E, { len: 30 }).track(19, 8, TD.W_E, { len: 30 });
  b.track(19, 10, TD.W_E, { len: 30 });
  b.sw(20, 10, 0); b.track(21, 9, TD.SW_NE, { len: 40, speed: 60 }); b.sw(22, 8, 3);
  b.track(20, 8, TD.W_E, { len: 30 }).track(21, 8, TD.W_E, { len: 30 });
  b.track(21, 10, TD.W_E, { len: 30 }).track(22, 10, TD.W_E, { len: 30 }).track(23, 10, TD.W_E, { len: 30 });
  b.track(23, 8, TD.W_E, { len: 30 });
  // ventaglio Nord (binari 1, 2) e Sud (5, 6)
  b.sw(24, 8, 0); b.track(25, 7, TD.SW_NE, { len: 40, speed: 60 }); b.sw(26, 6, 4);
  b.track(27, 5, TD.SW_NE, { len: 40, speed: 60 }); b.track(28, 4, TD.SW_E, { len: 40, speed: 60 });
  b.sw(24, 10, 2); b.track(25, 11, TD.NW_SE, { len: 40, speed: 60 }); b.sw(26, 12, 6);
  b.track(27, 13, TD.NW_SE, { len: 40, speed: 60 }); b.track(28, 14, TD.NW_E, { len: 40, speed: 60 });
  b.h(25, 29, 8, { len: 30, speed: 100 }); b.h(25, 29, 10, { len: 30, speed: 100 });
  b.h(27, 29, 6, { len: 30, speed: 60 }); b.h(27, 29, 12, { len: 30, speed: 60 });
  b.track(29, 4, TD.W_E, { len: 30, speed: 60 }); b.track(29, 14, TD.W_E, { len: 30, speed: 60 });
  // ---------------------------------------------------------- binari di stazione
  const rows: [number, number, number][] = [[1, 4, 60], [2, 6, 60], [3, 8, 100], [4, 10, 100], [5, 12, 60], [6, 14, 60]];
  for (const [n, y, v] of rows) {
    b.platform(P0, P1, y, `${ST}@${n}`, 220, 25, v);
    b.sig(29, y + 1, false, [29, y], String(10 + n));     // partenza verso Ovest
    b.sig(P1 + 1, y - 1, true, [P1 + 1, y], String(20 + n)); // partenza verso Est
  }
  for (const y of [3, 5, 9, 11, 13, 15]) if (y !== 9) b.deco(P0, P1, y);
  // ---------------------------------------------------------- lato Est
  for (const y of [6, 8, 10, 12]) b.track(P1 + 1, y, TD.W_E, { len: 30, speed: y === 8 || y === 10 ? 100 : 60 });
  b.track(P1 + 1, 4, TD.W_E, { len: 30, speed: 60 });
  b.track(P1 + 1, 14, TD.W_E, { len: 30, speed: 60 });
  // binario 1: deviatoio per Lago (normale) o per la linea (rovescio)
  b.sw(48, 4, 10, 60);
  b.track(49, 3, TD.SW_NE, { len: 40, speed: 60 }); b.track(50, 2, TD.SW_E, { len: 40, speed: 60 });
  b.track(49, 5, TD.NW_SE, { len: 40, speed: 60 });
  b.track(48, 6, TD.W_E, { len: 30, speed: 60 }).track(49, 6, TD.W_E, { len: 30, speed: 60 });
  b.sw(50, 6, 7); b.track(51, 7, TD.NW_SE, { len: 40, speed: 60 }); b.sw(52, 8, 1);
  b.h(48, 51, 8, { len: 30, speed: 100 });
  b.track(48, 14, TD.W_NE, { len: 40, speed: 60 }); b.track(49, 13, TD.SW_NE, { len: 40, speed: 60 });
  b.track(48, 12, TD.W_E, { len: 30, speed: 60 }).track(49, 12, TD.W_E, { len: 30, speed: 60 });
  b.sw(50, 12, 5); b.track(51, 11, TD.SW_NE, { len: 40, speed: 60 }); b.sw(52, 10, 3);
  b.h(48, 51, 10, { len: 30, speed: 100 });
  b.h(53, 53, 8, { len: 30, speed: 100 }); b.h(53, 53, 10, { len: 30, speed: 100 });
  // comunicazioni lato Est
  b.sw(54, 10, 0); b.track(55, 9, TD.SW_NE, { len: 40, speed: 60 }); b.sw(56, 8, 3);
  b.track(54, 8, TD.W_E, { len: 30 }).track(55, 8, TD.W_E, { len: 30 }).track(57, 8, TD.W_E, { len: 30 });
  b.track(55, 10, TD.W_E, { len: 30 }).track(56, 10, TD.W_E, { len: 30 }).track(57, 10, TD.W_E, { len: 30 });
  b.sw(58, 8, 2); b.track(59, 9, TD.NW_SE, { len: 40, speed: 60 }); b.sw(60, 10, 1);
  b.track(58, 10, TD.W_E, { len: 30 }).track(59, 10, TD.W_E, { len: 30 });
  b.h(59, 60, 8, { len: 50, speed: 100 });
  b.track(61, 10, TD.W_E, { len: 50, speed: 100 });
  b.sig(61, 11, false, [61, 10], '2');                  // protezione lato Est
  b.h(61, 72, 8, { len: 400, speed: 140 });
  b.h(62, 72, 10, { len: 400, speed: 140 });
  b.sig(66, 7, true, [66, 8], '103', { fleeted: true });
  b.sig(67, 11, false, [66, 10], '104', { fleeted: true });
  b.text(74, 8, 'E', { e: [72, 8] });
  b.text(74, 10, 'E', { w: [72, 10] });
  // ---------------------------------------------------------- linea per Lago (binario unico)
  b.h(51, 72, 2, { len: 200, speed: 90 });
  b.sig(51, 3, false, [51, 2], '3');                    // protezione da Lago
  b.sig(62, 1, true, [62, 2], '105');                   // blocco linea Lago verso Lago
  b.sig(61, 3, false, [61, 2], '106');                  // blocco linea Lago verso Valmora
  b.text(74, 2, 'L', { w: [72, 2] });
  // ---------------------------------------------------------- scritte
  b.text(34, 0, ST.toUpperCase());
  b.text(3, 6, 'da/per Pianalto');
  b.text(62, 6, 'da/per Castelvecchio');
  b.text(63, 0, 'linea per Lago');
  return b.toString();
}

const T = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const S = (mins: number) => T(6 + Math.floor((30 + mins) / 60), (30 + mins) % 60);

interface Run { name: string; type: number; len: number; speed: number; from: string; to: string; enter: number; plat?: number; arr?: number; dep?: number; pass?: number; terminate?: boolean; stock?: string; wait?: string; waitSec?: number; notes: string; exitAt?: number }

function trainText(r: Run): string {
  const L: string[] = [`Train: ${r.name}`, `Type: ${r.type}`, `Length: ${r.len}`, `Speed: ${r.speed}`];
  if (r.wait) L.push(`Wait: "${r.wait}" ${r.waitSec ?? 300}`);
  const where = r.plat ? `${ST}@${r.plat}` : ST;
  if (r.from === 'stazione') L.push(`Enter: ${S(r.enter)}, ${where}`);
  else L.push(`Enter: ${S(r.enter)}, ${r.from}`);
  if (r.terminate) L.push(`  ${S(r.arr!)}, -, ${where}`);
  else {
    if (r.arr !== undefined) L.push(`  ${S(r.arr)}, ${S(r.dep!)}, ${where}`);
    if (r.pass !== undefined) L.push(`  -, ${S(r.pass)}, ${where}`);
    L.push(`  ${S(r.exitAt!)}, -, ${r.to}`);
  }
  if (r.stock) L.push(`Stock: ${r.stock}`);
  L.push(`Notes: ${r.notes}`, '.');
  return L.join('\n');
}

// tempi in minuti dalle 06:30
const runs: Run[] = [
  { name: 'R 3301', type: 3, len: 120, speed: 140, from: 'O', to: 'E', enter: 2, plat: 2, arr: 6, dep: 7, exitAt: 11, notes: 'Regionale Pianalto - Castelvecchio' },
  { name: 'R 3302', type: 3, len: 120, speed: 140, from: 'E', to: 'O', enter: 3, plat: 5, arr: 7, dep: 9, exitAt: 13, notes: 'Regionale Castelvecchio - Pianalto' },
  { name: 'RL 7101', type: 3, len: 60, speed: 90, from: 'L', to: '', enter: 5, plat: 1, arr: 10, terminate: true, stock: 'RL 7102', notes: 'Navetta Lago - Valmora (termina, il materiale riparte come RL 7102)' },
  { name: 'MRS 44201', type: 4, len: 450, speed: 100, from: 'E', to: 'O', enter: 12, plat: 4, pass: 16, exitAt: 21, notes: 'Merci container, transita sul binario 4' },
  { name: 'FR 9511', type: 1, len: 200, speed: 160, from: 'O', to: 'E', enter: 14, plat: 3, arr: 18, dep: 20, exitAt: 23, notes: 'Frecciarossa: binario 3, sosta 2 minuti' },
  { name: 'RL 7102', type: 3, len: 60, speed: 90, from: 'stazione', to: 'L', enter: 20, plat: 1, wait: 'RL 7101', waitSec: 240, exitAt: 25, notes: 'Navetta Valmora - Lago' },
  { name: 'IC 667', type: 2, len: 250, speed: 150, from: 'E', to: 'O', enter: 22, plat: 4, arr: 26, dep: 28, exitAt: 32, notes: 'Intercity Castelvecchio - Pianalto' },
  { name: 'R 3303', type: 3, len: 120, speed: 140, from: 'O', to: 'E', enter: 28, plat: 2, arr: 32, dep: 33, exitAt: 37, notes: 'Regionale' },
  { name: 'R 3360', type: 3, len: 120, speed: 140, from: 'O', to: '', enter: 30, plat: 6, arr: 34, terminate: true, stock: 'R 3361', notes: 'Termina a Valmora (binario 6)' },
  { name: 'R 3304', type: 3, len: 120, speed: 140, from: 'E', to: 'O', enter: 35, plat: 5, arr: 39, dep: 40, exitAt: 44, notes: 'Regionale' },
  { name: 'RL 7103', type: 3, len: 60, speed: 90, from: 'L', to: '', enter: 38, plat: 1, arr: 43, terminate: true, stock: 'RL 7104', notes: 'Navetta Lago - Valmora' },
  { name: 'MRS 44203', type: 4, len: 450, speed: 100, from: 'O', to: 'E', enter: 40, plat: 3, pass: 45, exitAt: 50, notes: 'Merci, transita sul binario 3' },
  { name: 'FR 9512', type: 1, len: 200, speed: 160, from: 'E', to: 'O', enter: 45, plat: 4, arr: 49, dep: 51, exitAt: 54, notes: 'Frecciarossa' },
  { name: 'R 3361', type: 3, len: 120, speed: 140, from: 'stazione', to: 'O', enter: 50, plat: 6, wait: 'R 3360', waitSec: 300, exitAt: 55, notes: 'Materiale del R 3360' },
  { name: 'RV 2471', type: 2, len: 160, speed: 150, from: 'O', to: 'E', enter: 48, plat: 2, arr: 52, dep: 54, exitAt: 58, notes: 'Regionale veloce' },
  { name: 'RL 7104', type: 3, len: 60, speed: 90, from: 'stazione', to: 'L', enter: 55, plat: 1, wait: 'RL 7103', waitSec: 240, exitAt: 60, notes: 'Navetta Valmora - Lago' },
  { name: 'R 3305', type: 3, len: 120, speed: 140, from: 'O', to: 'E', enter: 58, plat: 3, arr: 62, dep: 63, exitAt: 67, notes: 'Regionale' },
  { name: 'R 3306', type: 3, len: 120, speed: 140, from: 'E', to: 'O', enter: 60, plat: 5, arr: 64, dep: 65, exitAt: 69, notes: 'Regionale' },
  { name: 'RV 2472', type: 2, len: 160, speed: 150, from: 'E', to: 'O', enter: 66, plat: 4, arr: 70, dep: 72, exitAt: 76, notes: 'Regionale veloce' },
  { name: 'MRS 44205', type: 4, len: 450, speed: 100, from: 'E', to: 'O', enter: 72, plat: 5, pass: 77, exitAt: 82, notes: 'Merci: deve lasciare liberi i binari di corsa? Usa il 5' },
];

const schedule = `#!trdir
# Valmora Centrale - mattino feriale
Start: 06:30
Type: 1 +10
Type: 2 +10
Type: 3 +10
Type: 4 +20

${runs.map(trainText).join('\n\n')}
`;

export const level2: LevelDef = {
  id: 'valmora-centrale',
  title: 'Valmora Centrale',
  subtitle: 'Livello 2 · Grande stazione passante, 6 binari',
  difficulty: 2,
  description:
    'Doppio binario Pianalto–Castelvecchio con comunicazioni, sei binari di stazione e la diramazione a binario unico per Lago. Frecciarossa, merci in transito, navette che invertono la marcia.',
  trk: layout(),
  sch: schedule,
  autoFleet: true,
  tutorial: [
    'Da Ovest i treni arrivano al segnale 1, da Est al 2, da Lago al 3. Le partenze verso Ovest sono 11–16, verso Est 21–26 (il numero finale è il binario).',
    'Esempio: "1 22" riceve da Ovest sul binario 2; "22 E" lo fa partire verso Est.',
    'I segnali 101–106 sono di blocco automatico (anello verde): si riaprono da soli.',
    'Premi F1 o digita "?" per l’aiuto; "aiuto" nella barra mostra i suggerimenti del DM.',
  ],
};
