// Lettura del file orario .sch (formato "#!trdir" di Train Director 3).

export interface Delay { seconds: number; prob: number }

export interface Stop {
  station: string;
  arrival: number;   // secondi dalla mezzanotte
  departure: number;
  minStop: number;   // 0 = transito senza fermata
  depDelay?: Delay[];
}

export interface TrainDef {
  name: string;
  type: number;        // 0-based
  entrance: string;
  altEntrances: string[];
  timeIn: number;
  entryDelay?: Delay[];
  exit: string;
  altExits: string[];
  timeOut: number;
  stops: Stop[];
  length: number;
  maxSpeed: number;
  accelRate: number;
  startDelay: number;
  waitFor?: string;
  waitTime: number;
  stock?: string;
  days: number;        // bitmask lun=1 ... dom=64, 0 = tutti i giorni
  notes: string[];
  power?: string;
  icons?: { w?: string; e?: string };
  script?: string;
}

export interface Schedule {
  start: number;
  trains: TrainDef[];
  typeStartDelay: number[];
  typeAccel: number[];
  typeIcons: ({ w: string; e: string } | undefined)[];
  today?: number;
  warnings: string[];
}

export function parseTime(s: string): { t: number; rest: string } {
  const m = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return { t: 0, rest: s };
  return { t: +m[1] * 3600 + +m[2] * 60 + (m[3] ? +m[3] : 0), rest: s.slice(m[0].length) };
}

export function formatTime(t: number, secs = false): string {
  t = ((Math.floor(t) % 86400) + 86400) % 86400;
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return secs ? `${p(h)}:${p(m)}:${p(s)}` : `${p(h)}:${p(m)}`;
}

function parseDelay(s: string): { d: Delay[]; rest: string } {
  const d: Delay[] = [];
  let rest = s;
  for (;;) {
    const m = /^(\d+)(?:\/(\d+))?/.exec(rest);
    if (!m) break;
    d.push({ seconds: +m[1], prob: m[2] ? +m[2] : 100 });
    rest = rest.slice(m[0].length);
    if (rest[0] !== ',' || !/^,\d/.test(rest)) break;
    rest = rest.slice(1);
  }
  return { d, rest };
}

const daysMask = (s: string) => {
  let l = 0;
  for (const ch of s.trim()) { if (ch >= '1' && ch <= '7') l |= 1 << (+ch - 1); else break; }
  return l;
};

export type IncludeResolver = (name: string) => string | undefined;

export function parseSch(text: string, include?: IncludeResolver): Schedule {
  const S: Schedule = { start: 0, trains: [], typeStartDelay: [], typeAccel: [], typeIcons: [], warnings: [] };
  parseInto(S, text, include, 0);
  S.trains = S.trains.filter((t) => t.entrance || t.stops.length);
  S.trains.sort((a, b) => a.timeIn - b.timeIn);
  return S;
}

function parseInto(S: Schedule, text: string, include: IncludeResolver | undefined, depth: number) {
  let t: TrainDef | undefined;
  let curType = 0;
  const lines = text.replace(/\r/g, '').split('\n');
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li].replace(/\t/g, ' ').replace(/\s+$/, '');
    if (line.startsWith('.')) { t = undefined; continue; }
    if (!line || line.startsWith('#')) continue;
    let p = line.trimStart();
    const kw = (k: string) => {
      if (p.startsWith(k)) { p = p.slice(k.length).trimStart(); return true; }
      return false;
    };
    if (kw('Include:')) {
      const inc = include?.(p);
      if (inc && depth < 8) parseInto(S, inc, include, depth + 1);
      else S.warnings.push(`File incluso non trovato: ${p}`);
      t = undefined; continue;
    }
    if (kw('Cancel:')) { S.trains = S.trains.filter((x) => x.name !== p); t = undefined; continue; }
    if (kw('Today:')) { S.today = daysMask(p); continue; }
    if (kw('Start:')) { S.start = parseTime(p).t; continue; }
    if (kw('Requires:') || kw('Encoding:') || kw('Folders:') || kw('DefaultSpeed:') || kw('RequiresSignals:') || kw('Routes:') || kw('GTFS:')) continue;
    if (kw('Train:')) {
      t = S.trains.find((x) => x.name === p);
      if (t) continue;
      t = {
        name: p, type: curType, entrance: '', altEntrances: [], timeIn: 0, exit: '', altExits: [], timeOut: 0,
        stops: [], length: 0, maxSpeed: 0, accelRate: 0, startDelay: 0, waitTime: 60, days: 0, notes: [],
      };
      S.trains.push(t);
      continue;
    }
    if (!t) {
      if (kw('Type:')) {
        const m = /^(\d+)\s*(.*)$/.exec(p);
        if (!m) continue;
        const ty = +m[1] - 1;
        if (ty < 0 || ty >= 10) continue;
        curType = ty;
        let r = m[2];
        const sd = /^\+(\d+)\s*/.exec(r); if (sd) { S.typeStartDelay[ty] = +sd[1]; r = r.slice(sd[0].length); }
        const ac = /^>([\d.]+)\s*/.exec(r); if (ac) { S.typeAccel[ty] = +ac[1]; r = r.slice(ac[0].length); }
        const ic = r.split(/\s+/).filter(Boolean);
        if (ic.length >= 2) S.typeIcons[ty] = { w: ic[0], e: ic[1] };
      }
      continue;
    }
    if (kw('Wait:')) {
      let name: string, rest: string;
      if (p[0] === '"' || p[0] === "'") {
        const q = p[0]; const j = p.indexOf(q, 1);
        name = p.slice(1, j < 0 ? undefined : j); rest = j < 0 ? '' : p.slice(j + 1);
      } else {
        const j = p.indexOf(' ');
        name = j < 0 ? p : p.slice(0, j); rest = j < 0 ? '' : p.slice(j);
      }
      t.waitFor = name; t.waitTime = rest.trim() ? parseInt(rest) || 60 : 60;
      continue;
    }
    if (kw('StartDelay:')) { t.startDelay = parseInt(p) || 0; continue; }
    if (kw('AccelRate:')) { t.accelRate = parseFloat(p) || 0; continue; }
    if (kw('Power:')) { t.power = p; continue; }
    if (kw('Gauge:')) continue;
    if (kw('When:')) { t.days = daysMask(p); continue; }
    if (kw('Speed:')) { t.maxSpeed = parseInt(p) || 0; continue; }
    if (kw('Type:')) {
      const m = /^(\d+)\s*(.*)$/.exec(p);
      if (m) {
        t.type = Math.min(9, Math.max(0, +m[1] - 1));
        const ic = m[2].split(/\s+/).filter(Boolean);
        if (ic.length >= 2) t.icons = { w: ic[0], e: ic[1] };
      }
      continue;
    }
    if (kw('Stock:')) { t.stock = p; continue; }
    if (kw('Length:')) { t.length = parseInt(p) || 0; continue; }
    if (kw('Notes:')) { if (t.notes.length < 6) t.notes.push(p); continue; }
    if (kw('Script:')) {
      const body: string[] = [];
      while (++li < lines.length && lines[li].trim() !== 'EndScript') body.push(lines[li]);
      t.script = body.join('\n');
      continue;
    }
    if (kw('Enter:')) {
      const r = parseTime(p);
      t.timeIn = r.t; p = r.rest;
      if (p[0] === '!') { const d = parseDelay(p.slice(1)); t.entryDelay = d.d; p = d.rest; }
      p = p.replace(/^\s*,?\s*/, '');
      const [ent, ...alts] = p.split('|');
      t.entrance = ent.trim(); t.altEntrances = alts.flatMap((a) => a.split(',')).map((a) => a.trim()).filter(Boolean);
      continue;
    }
    // riga di fermata: arrivo, partenza, stazione
    const stp: Stop = { station: '', arrival: 0, departure: 0, minStop: 30 };
    let arr = 0;
    if (p[0] === '-') { p = p.slice(1).trimStart(); stp.minStop = 0; }
    else if (p[0] === '+') {
      const m = /^\+(\d+)/.exec(p)!; p = p.slice(m[0].length);
      arr = +m[1] + (t.stops.length ? t.stops[t.stops.length - 1].departure : t.timeIn);
    } else { const r = parseTime(p); if (r.rest === p) continue; arr = r.t; p = r.rest; }
    if (p[0] === '+') { const m = /^\+(\d+)/.exec(p)!; stp.minStop = +m[1]; p = p.slice(m[0].length); }
    p = p.replace(/^,?\s*/, '');
    if (p[0] === '-') {
      if (t.exit) continue;
      t.timeOut = arr;
      p = p.slice(1).replace(/^\s*,?\s*/, '');
      const [ex, ...alts] = p.split('|');
      t.exit = ex.trim(); t.altExits = alts.flatMap((a) => a.split(',')).map((a) => a.trim()).filter(Boolean);
      continue;
    }
    if (p[0] === '+') {
      const m = /^\+(\d+)/.exec(p)!; p = p.slice(m[0].length);
      let dep = Math.max(+m[1], stp.minStop);
      if (!stp.minStop) arr = t.stops.length ? t.stops[t.stops.length - 1].departure : t.timeIn;
      stp.departure = arr + dep;
    } else { const r = parseTime(p); stp.departure = r.t; p = r.rest; }
    if (!stp.minStop) stp.arrival = stp.departure;
    else {
      stp.arrival = arr;
      if (stp.departure === stp.arrival) stp.departure = stp.arrival + stp.minStop;
      else if (stp.minStop > stp.departure - stp.arrival && stp.departure > stp.arrival) stp.minStop = stp.departure - stp.arrival;
    }
    if (p[0] === '!') { const d = parseDelay(p.slice(1)); stp.depDelay = d.d; p = d.rest; }
    stp.station = p.replace(/^\s*,?\s*/, '').trim();
    t.stops.push(stp);
  }
}
