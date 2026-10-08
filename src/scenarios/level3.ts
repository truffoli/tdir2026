// Livello 3 — Porto Alba Marittima: stazione di testa con 8 binari tronchi.
// Tutti i treni terminano e il materiale riparte con un altro numero (inversione di marcia).
//
//   bin.1 ════════════╗
//   bin.2 ═════════════╬╗
//   bin.3 ══════════════╬╗
//   bin.4 ═══════════════╩══╦══╗ ══════════ E  (partenze)
//   bin.5 ═══════════════╦══╩══╝ ═══╦══════ E  (arrivi)
//   bin.6 ══════════════╬╝          ╚══════ M  (Marina, binario unico)
//   bin.7 ═════════════╬╝
//   bin.8 ════════════╝
import { TD } from '../core/geom';
import { TrkBuilder } from './builder';
import type { LevelDef } from './index';

const ST = 'Porto Alba Marittima';

function layout(): string {
  const b = new TrkBuilder();
  const rows: [number, number, number][] = [ // binario, y, x fine binario (prima della scala)
    [1, 2, 23], [2, 4, 25], [3, 6, 27], [4, 8, 29], [5, 10, 29], [6, 12, 27], [7, 14, 25], [8, 16, 23],
  ];
  for (const [n, y, xe] of rows) {
    b.platform(4, 19, y, `${ST}@${n}`, 260, 25, 40);
    for (let x = 20; x <= xe; x++) b.track(x, y, TD.W_E, { len: 30, speed: 40 });
    b.sig(20, n <= 4 ? y - 1 : y + 1, true, [20, y], String(10 + n)); // partenza
  }
  for (const y of [3, 7, 11, 15]) b.deco(5, 18, y);
  // scala superiore (binari 1-4 -> binario di partenza y=8)
  b.sw(30, 8, 1); b.track(29, 7, TD.NW_SE, { len: 40, speed: 30 });
  b.sw(28, 6, 7); b.track(27, 5, TD.NW_SE, { len: 40, speed: 30 });
  b.sw(26, 4, 7); b.track(25, 3, TD.NW_SE, { len: 40, speed: 30 });
  b.track(24, 2, TD.W_SE, { len: 40, speed: 30 });
  // scala inferiore (binari 5-8 -> binario di arrivo y=10)
  b.sw(30, 10, 3); b.track(29, 11, TD.SW_NE, { len: 40, speed: 30 });
  b.sw(28, 12, 5); b.track(27, 13, TD.SW_NE, { len: 40, speed: 30 });
  b.sw(26, 14, 5); b.track(25, 15, TD.SW_NE, { len: 40, speed: 30 });
  b.track(24, 16, TD.W_NE, { len: 40, speed: 30 });
  // comunicazioni tra i due binari
  b.h(31, 31, 8, { len: 30, speed: 60 }); b.h(31, 31, 10, { len: 30, speed: 60 });
  b.sw(32, 8, 2, 30); b.track(33, 9, TD.NW_SE, { len: 40, speed: 30 }); b.sw(34, 10, 1, 30);
  b.track(33, 8, TD.W_E, { len: 30, speed: 60 }); b.track(34, 8, TD.W_E, { len: 30, speed: 60 }); b.track(35, 8, TD.W_E, { len: 30, speed: 60 });
  b.track(32, 10, TD.W_E, { len: 30, speed: 60 }); b.track(33, 10, TD.W_E, { len: 30, speed: 60 }); b.track(35, 10, TD.W_E, { len: 30, speed: 60 });
  b.sw(36, 10, 0, 30); b.track(37, 9, TD.SW_NE, { len: 40, speed: 30 }); b.sw(38, 8, 3, 30);
  b.track(36, 8, TD.W_E, { len: 30, speed: 60 }); b.track(37, 8, TD.W_E, { len: 30, speed: 60 });
  b.track(37, 10, TD.W_E, { len: 30, speed: 60 }); b.track(38, 10, TD.W_E, { len: 30, speed: 60 }); b.track(39, 10, TD.W_E, { len: 30, speed: 60 });
  b.h(39, 41, 8, { len: 50, speed: 80 });
  // bivio per Marina
  b.sw(40, 10, 2, 30); b.track(41, 11, TD.NW_SE, { len: 40, speed: 30 }); b.track(42, 12, TD.NW_E, { len: 40, speed: 60 });
  b.track(41, 10, TD.W_E, { len: 50, speed: 80 });
  b.sig(42, 9, false, [41, 10], '2');                      // protezione da Valmora
  b.sig(43, 13, false, [43, 12], '3');                     // protezione da Marina
  // linea per Valmora (doppio binario)
  b.h(42, 56, 8, { len: 350, speed: 130 });
  b.h(42, 56, 10, { len: 350, speed: 130 });
  b.sig(52, 7, true, [52, 8], '103', { fleeted: true });
  b.sig(52, 11, false, [51, 10], '104', { fleeted: true });
  b.text(58, 8, 'E', { e: [56, 8] });
  b.text(58, 10, 'E', { w: [56, 10] });
  // linea per Marina (binario unico)
  b.h(43, 56, 12, { len: 300, speed: 100 });
  b.sig(50, 13, true, [50, 12], '105');
  b.sig(48, 11, false, [48, 12], '106');
  b.text(58, 12, 'M', { w: [56, 12] });
  // scritte
  b.text(6, 0, ST.toUpperCase() + '  —  fabbricato viaggiatori');
  b.text(44, 6, 'da/per Valmora');
  b.text(44, 14, 'da/per Marina');
  return b.toString();
}

const S = (mins: number) => { const t = 7 * 60 + mins; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

interface Turn { arr: string; dep: string; type: number; len: number; speed: number; line: 'E' | 'M'; enter: number; plat: number; turn: number; notes: string }

// ogni riga: treno in arrivo e treno in partenza con lo stesso materiale
const turns: Turn[] = [
  { arr: 'R 4101', dep: 'R 4102', type: 3, len: 140, speed: 130, line: 'E', enter: 2, plat: 5, turn: 14, notes: 'Regionale da Valmora' },
  { arr: 'RM 8201', dep: 'RM 8202', type: 3, len: 70, speed: 100, line: 'M', enter: 4, plat: 8, turn: 12, notes: 'Navetta Marina' },
  { arr: 'IC 711', dep: 'IC 712', type: 2, len: 280, speed: 150, line: 'E', enter: 8, plat: 3, turn: 22, notes: 'Intercity: binari lunghi 3 o 4' },
  { arr: 'R 4103', dep: 'R 4104', type: 3, len: 140, speed: 130, line: 'E', enter: 14, plat: 6, turn: 15, notes: 'Regionale' },
  { arr: 'RM 8203', dep: 'RM 8204', type: 3, len: 70, speed: 100, line: 'M', enter: 18, plat: 7, turn: 12, notes: 'Navetta Marina' },
  { arr: 'FR 9601', dep: 'FR 9602', type: 1, len: 200, speed: 160, line: 'E', enter: 22, plat: 4, turn: 25, notes: 'Frecciarossa' },
  { arr: 'RV 3501', dep: 'RV 3502', type: 2, len: 170, speed: 150, line: 'E', enter: 28, plat: 2, turn: 18, notes: 'Regionale veloce' },
  { arr: 'R 4105', dep: 'R 4106', type: 3, len: 140, speed: 130, line: 'E', enter: 34, plat: 5, turn: 14, notes: 'Regionale' },
  { arr: 'RM 8205', dep: 'RM 8206', type: 3, len: 70, speed: 100, line: 'M', enter: 36, plat: 8, turn: 12, notes: 'Navetta Marina' },
  { arr: 'IC 713', dep: 'IC 714', type: 2, len: 280, speed: 150, line: 'E', enter: 42, plat: 3, turn: 20, notes: 'Intercity' },
  { arr: 'R 4107', dep: 'R 4108', type: 3, len: 140, speed: 130, line: 'E', enter: 48, plat: 1, turn: 16, notes: 'Regionale' },
  { arr: 'RM 8207', dep: 'RM 8208', type: 3, len: 70, speed: 100, line: 'M', enter: 52, plat: 7, turn: 12, notes: 'Navetta Marina' },
  { arr: 'RV 3503', dep: 'RV 3504', type: 2, len: 170, speed: 150, line: 'E', enter: 58, plat: 6, turn: 18, notes: 'Regionale veloce' },
];

function trains(): string {
  const out: string[] = [];
  for (const t of turns) {
    const where = `${ST}@${t.plat}`;
    const arrAt = t.enter + (t.line === 'E' ? 5 : 4);
    out.push([`Train: ${t.arr}`, `Type: ${t.type}`, `Length: ${t.len}`, `Speed: ${t.speed}`, `Enter: ${S(t.enter)}, ${t.line}`, `  ${S(arrAt)}, -, ${where}`, `Stock: ${t.dep}`, `Notes: ${t.notes} (termina, binario ${t.plat})`, '.'].join('\n'));
    const depAt = arrAt + t.turn;
    out.push([`Train: ${t.dep}`, `Type: ${t.type}`, `Length: ${t.len}`, `Speed: ${t.speed}`, `Wait: "${t.arr}" 360`, `Enter: ${S(depAt)}, ${where}`, `  ${S(depAt + 6)}, -, ${t.line}`, `Notes: ${t.notes} (materiale del ${t.arr})`, '.'].join('\n'));
  }
  return out.join('\n\n');
}

const schedule = `#!trdir
# Porto Alba Marittima - stazione di testa
Start: 07:00
Type: 1 +15
Type: 2 +15
Type: 3 +15

${trains()}
`;

export const level3: LevelDef = {
  id: 'porto-alba',
  title: 'Porto Alba Marittima',
  subtitle: 'Livello 3 · Stazione di testa, 8 binari tronchi',
  difficulty: 3,
  description:
    'Capolinea con otto binari tronchi, scala di deviatoi e due linee: doppio binario per Valmora e binario unico per Marina. Ogni treno arriva, inverte e riparte: scegli bene i binari per non bloccare la stazione.',
  trk: layout(),
  sch: schedule,
  autoFleet: true,
  tutorial: [
    'Arrivi: da Valmora al segnale 2, da Marina al 3. Destinazione: il binario, es. "2 b5" riceve sul binario 5 (i binari tronchi non hanno un segnale di fine itinerario).',
    'Il materiale arrivato riparte con un altro numero e inverte da solo la marcia; tu devi solo dare la via con il segnale di partenza del binario (11–18): "15 E" o "17 M".',
    'Ricorda che arrivi e partenze si incrociano sulle comunicazioni: prepara gli itinerari in anticipo, ma senza bloccare i treni in arrivo.',
  ],
};
