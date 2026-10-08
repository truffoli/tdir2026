// Importazione degli scenari originali (.zip oppure file sciolti).
import { unzipSync } from 'fflate';

export interface ScenarioFiles {
  name: string;
  trk: string;
  sch: string;
  tds: Map<string, string>;
  xpm: Map<string, string>;
  texts: Map<string, string>;
}

/** I file originali sono spesso in Windows-1252: usa UTF-8 solo se valido. */
export function decodeText(buf: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}

export async function readScenarioFiles(files: File[]): Promise<ScenarioFiles> {
  const entries = new Map<string, Uint8Array>();
  for (const f of files) {
    const buf = new Uint8Array(await f.arrayBuffer());
    if (f.name.toLowerCase().endsWith('.zip')) {
      const z = unzipSync(buf);
      for (const [n, data] of Object.entries(z)) if (data.length) entries.set(n.split('/').pop()!, data);
    } else entries.set(f.name, buf);
  }
  const texts = new Map<string, string>();
  const tds = new Map<string, string>();
  const xpm = new Map<string, string>();
  for (const [n, d] of entries) {
    const low = n.toLowerCase();
    if (low.endsWith('.trk') || low.endsWith('.sch') || low.endsWith('.pth') || low.endsWith('.tds') || low.endsWith('.xpm') || low.endsWith('.txt')) {
      const t = decodeText(d);
      texts.set(low, t);
      if (low.endsWith('.tds')) tds.set(low, t);
      if (low.endsWith('.xpm')) xpm.set(low, t);
    }
  }
  const trks = [...texts.keys()].filter((k) => k.endsWith('.trk'));
  if (!trks.length) throw new Error('Nessun file .trk trovato');
  // il tracciato principale è quello che ha un .sch con lo stesso nome, altrimenti il più grande
  const withSch = trks.filter((k) => texts.has(k.replace(/\.trk$/, '.sch')));
  const main = (withSch.length ? withSch : trks).sort((a, b) => texts.get(b)!.length - texts.get(a)!.length)[0];
  const schKey = main.replace(/\.trk$/, '.sch');
  const sch = texts.get(schKey) ?? [...texts.entries()].find(([k]) => k.endsWith('.sch'))?.[1];
  if (!sch) throw new Error('Nessun file orario .sch trovato');
  const name = [...entries.keys()].find((k) => k.toLowerCase() === main)?.replace(/\.trk$/i, '') ?? main;
  return { name, trk: texts.get(main)!, sch, tds, xpm, texts };
}
