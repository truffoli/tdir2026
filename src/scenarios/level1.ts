// Livello 1 — Borgo San Rocco: stazione di incrocio su linea a binario unico.
import { TD } from '../core/geom';
import { TrkBuilder } from './builder';
import type { LevelDef } from './index';

function layout(): string {
  const b = new TrkBuilder();
  const ST = 'Borgo San Rocco';
  // linea verso Ovest (O)
  b.text(0, 10, 'O', { e: [2, 10] });
  b.h(2, 13, 10, { len: 350, speed: 120 });
  b.track(14, 10, TD.W_E, { len: 50, speed: 120 });
  b.sig(14, 9, true, [14, 10], '1');
  b.sw(15, 10, 2, 60); // d1: corretto = binario I, rovescio = binario II
  b.track(16, 10, TD.W_E, { len: 30, speed: 100 });
  b.sig(16, 9, false, [16, 10], '2');
  // binario I (corretto tracciato)
  b.platform(17, 27, 10, `${ST}@1`, 200, 30, 100);
  b.track(28, 10, TD.W_E, { len: 30, speed: 100 });
  b.sig(28, 9, true, [28, 10], '3');
  b.sw(29, 10, 3, 60); // d2
  b.track(30, 10, TD.W_E, { len: 50, speed: 120 });
  b.sig(30, 11, false, [30, 10], '4');
  b.h(31, 42, 10, { len: 350, speed: 120 });
  b.text(44, 10, 'E', { w: [42, 10] });
  // binario II (deviato)
  b.track(16, 11, TD.NW_SE, { len: 30, speed: 60 });
  b.track(17, 12, TD.NW_E, { len: 30, speed: 60 });
  b.platform(18, 26, 12, `${ST}@2`, 200, 30, 60);
  b.track(27, 12, TD.W_NE, { len: 30, speed: 60 });
  b.track(28, 11, TD.SW_NE, { len: 30, speed: 60 });
  b.sig(17, 13, false, [17, 12], '6');
  b.sig(27, 13, true, [27, 12], '5');
  // marciapiedi
  b.deco(17, 27, 9);
  b.deco(18, 26, 11);
  b.deco(18, 26, 13);
  b.text(19, 7, 'Borgo San Rocco');
  b.text(6, 12, '→ verso Ovest');
  b.text(34, 12, 'verso Est →');
  return b.toString();
}

const schedule = `#!trdir
# Borgo San Rocco - orario del mattino
Start: 07:00

Type: 1
Type: 2
Type: 3
Type: 4

Train: R 2201
Type: 3
Length: 110
Speed: 120
Enter: 07:03, O
  07:07, 07:08, Borgo San Rocco@1
  07:11, -, E
Notes: Regionale Pianalto - Valmora
.

Train: R 2202
Type: 3
Length: 110
Speed: 120
Enter: 07:04, E
  07:08, 07:10, Borgo San Rocco@2
  07:13, -, O
Notes: Regionale Valmora - Pianalto. Incrocia il 2201.
.

Train: MRS 53110
Type: 4
Length: 380
Speed: 80
Enter: 07:18, E
  -, 07:23, Borgo San Rocco
  07:28, -, O
Notes: Merci (non ferma)
.

Train: IC 581
Type: 1
Length: 250
Speed: 140
Enter: 07:27, O
  -, 07:30, Borgo San Rocco@1
  07:33, -, E
Notes: Intercity, transita sul binario di corsa
.

Train: R 2203
Type: 3
Length: 110
Speed: 120
Enter: 07:34, E
  07:38, 07:40, Borgo San Rocco@2
  07:43, -, O
Notes: Deve dare precedenza all'IC 581? No: incrocia in stazione.
.

Train: R 2290
Type: 3
Length: 110
Speed: 120
Enter: 07:45, O
  07:49, -, Borgo San Rocco@2
Stock: R 2291
Notes: Termina a Borgo San Rocco: il materiale riparte come R 2291
.

Train: R 2291
Type: 3
Length: 110
Speed: 120
Wait: "R 2290" 300
Enter: 07:58, Borgo San Rocco@2
  08:02, -, O
Notes: Materiale dell'R 2290 (inversione automatica)
.

Train: MRS 53113
Type: 4
Length: 380
Speed: 80
Enter: 07:52, O
  -, 07:57, Borgo San Rocco
  08:02, -, E
Notes: Merci verso Est
.
`;

export const level1: LevelDef = {
  id: 'borgo-san-rocco',
  title: 'Borgo San Rocco',
  subtitle: 'Livello 1 · Stazione di incrocio su binario unico',
  difficulty: 1,
  description:
    'Linea a binario unico con una stazione a due binari. Fai incrociare i regionali, lascia transitare il merci e l’Intercity, gestisci un treno che termina e riparte in senso opposto.',
  trk: layout(),
  sch: schedule,
  tutorial: [
    'Il treno R 2202 arriva da Est alle 07:04: forma l’itinerario dal segnale 4 al binario II digitando "4 6" e premi Invio.',
    'L’R 2201 arriva da Ovest: digita "1 3" per riceverlo sul binario I.',
    'Per farli ripartire: "3 E" (binario I verso Est) e "6 O" (binario II verso Ovest).',
    'Puoi concatenare: "1 3 E" porta un treno da Ovest a Est passando dal binario I.',
  ],
};
