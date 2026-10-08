// Assegna a segnali, deviatoi e punti d'ingresso un identificativo breve
// da digitare nella barra comandi (come i pulsanti numerati di un banco ACEI).
import { Layout } from './layout';

const shortOk = (n: string | undefined, max: number) => !!n && n.length <= max && /^[\p{L}\p{N}._\-]+$/u.test(n);

export function assignLabels(L: Layout) {
  const used = new Set<string>();
  const take = (want: string | undefined, fallback: () => string): string => {
    if (want && !used.has(want.toLowerCase())) { used.add(want.toLowerCase()); return want; }
    let f = fallback();
    while (used.has(f.toLowerCase())) f = fallback();
    used.add(f.toLowerCase());
    return f;
  };
  // punti d'ingresso/uscita
  let pn = 1;
  for (const t of L.entryPoints().sort((a, b) => a.x - b.x || a.y - b.y))
    t.label = take(shortOk(t.name, 8) && !/^\d+$/.test(t.name!) ? t.name : undefined, () => 'P' + pn++);
  // segnali: nome breve se presente, altrimenti numero progressivo (ordinati da sinistra a destra)
  const sigs = [...L.signals].filter((s) => !s.hidden).sort((a, b) => a.x - b.x || a.y - b.y);
  const named = sigs.filter((s) => shortOk(s.name, 5) && /^\d+[a-z]?$/i.test(s.name!));
  for (const s of named) s.label = take(s.name, () => s.name!);
  let n = 1;
  for (const s of sigs) if (!s.label) s.label = take(undefined, () => String(n++));
  for (const s of L.signals) if (!s.label) s.label = take(undefined, () => 'h' + n++);
  // deviatoi: d1, d2, ... (le coppie collegate condividono il numero con suffisso)
  let d = 1;
  const sws = [...L.switches].sort((a, b) => a.x - b.x || a.y - b.y);
  for (const sw of sws) {
    if (sw.label) continue;
    const want = shortOk(sw.name, 5) && /^d?\d+[a-z]?$/i.test(sw.name!) ? (sw.name!.toLowerCase().startsWith('d') ? sw.name : 'd' + sw.name) : undefined;
    sw.label = take(want, () => 'd' + d++);
    const lk = sw.wlink ? L.trackAt(sw.wlink.x, sw.wlink.y) : undefined;
    if (lk && lk.kind === 'switch' && !lk.label) lk.label = take(sw.label + 'b', () => 'd' + d++);
  }
}
