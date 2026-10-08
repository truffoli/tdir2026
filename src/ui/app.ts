import { parseTrk } from '../core/trk';
import { parseSch, formatTime } from '../core/sch';
import { assignLabels } from '../core/naming';
import { Simulation, Train, STATUS_IT, PERF_LABELS, Perf } from '../core/sim';
import { CommandInterpreter, CommandHost } from '../core/commands';
import { Element, Signal, baseStation, platformOf } from '../core/layout';
import { Renderer, THEMES, shortTrainName } from './renderer';
import { decodeXpm } from './xpm';
import { LEVELS, LevelDef } from '../scenarios';
import { readScenarioFiles } from './loader';
import { suggestions } from '../core/assist';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const DAYS = ['', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const SPEEDS = [1, 2, 5, 10, 20, 30, 60, 120];
const TYPE_COLORS = ['#ff9f0a', '#64d2ff', '#30d158', '#bf5af2', '#ffd60a', '#ff375f', '#5e5ce6', '#ac8e68', '#66d4cf', '#e5e5ea'];

interface LoadSpec { seed?: number; autoFleet?: boolean; name: string; trk: string; sch: string; tds?: Map<string, string>; xpm?: Map<string, string>; texts?: Map<string, string>; tutorial?: string[]; day?: number; delays?: boolean; autoAssign?: boolean; id?: string }

export class App implements CommandHost {
  sim!: Simulation;
  renderer!: Renderer;
  cmd!: CommandInterpreter;
  running = false;
  speed = 10;
  private acc = 0;
  private last = performance.now();
  private history: string[] = [];
  private histIdx = -1;
  private ttFilter = 'next';
  private selected?: Train;
  private sound = true;
  private audio?: AudioContext;
  private lastTT = 0;
  private sugg: { text: string; hint: string }[] = [];
  private spec?: LoadSpec;
  private log: { t: number; c: string }[] = [];
  private replaying = false;
  private lastSave = 0;
  private suggIdx = 0;

  constructor() {
    this.buildStatic();
    requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------ caricamento

  load(spec: LoadSpec) {
    const L = parseTrk(spec.trk, { tds: spec.tds });
    assignLabels(L);
    const S = parseSch(spec.sch, (n) => spec.texts?.get(n.trim().toLowerCase()) ?? spec.texts?.get(n.trim().toLowerCase() + '.sch'));
    spec.seed ??= (Math.random() * 1e9) | 0;
    this.spec = spec;
    this.log = [];
    this.sim = new Simulation(L, S, { day: spec.day, randomDelays: spec.delays ?? true, autoAssign: spec.autoAssign ?? true, seed: spec.seed });
    this.sim.listeners.push((a) => { this.pushAlert(a.time, a.text, a.level, a.train); if (a.level === 'bad') this.beep(220, 0.25); else if (a.level === 'warn') this.beep(520, 0.12); });
    this.sim.onTrainEnter = () => this.beep(880, 0.08);
    const canvas = $<HTMLCanvasElement>('board');
    if (!this.renderer) this.renderer = new Renderer(canvas, this.sim);
    this.renderer.sim = this.sim;
    this.renderer.preview = undefined;
    this.renderer.images.clear();
    for (const [k, v] of spec.xpm ?? []) { const img = decodeXpm(v); if (img) this.renderer.images.set(k, img); }
    this.cmd = new CommandInterpreter(this);
    if (spec.autoFleet) for (const s of L.signals) if (s.fleeted) this.sim.toggleFleet(s);
    this.renderer.resize();
    this.renderer.fit();
    $('scenarioName').textContent = spec.name;
    $('dayName').textContent = DAYS[this.sim.day] ?? '';
    $('alerts').innerHTML = '';
    for (const w of S.warnings) this.pushAlert(this.sim.time, w, 'warn');
    const skipped = L.signals.filter((s) => s.scriptFile).length;
    if (skipped && spec.tds !== undefined) this.pushAlert(this.sim.time, `Scenario importato: ${L.signals.length} segnali (${L.signals.filter((s) => s.approach).length} di avviso/indicatori), ${L.switches.length} deviatoi, ${L.itineraries.length} itinerari, ${this.sim.trains.filter((t) => t.status !== 'notToday').length} treni oggi.`, 'info');
    this.setRunning(false);
    this.selected = undefined;
    this.showTutorial(spec.tutorial);
    this.renderTimetable(true);
    $('startModal').hidden = true;
    $('cmd').focus();
    this.feedback('Pronto. Premi Invio a barra vuota (o ▶) per avviare il tempo.', 'pv');
  }

  loadLevel(l: LevelDef) {
    this.load({ id: l.id, name: l.title, trk: l.trk, sch: l.sch, tutorial: l.tutorial, delays: false, autoFleet: l.autoFleet });
  }

  // ------------------------------------------------------------ CommandHost

  setRunning(on: boolean) {
    if (this.replaying) return;
    this.running = on;
    const b = $('btnPlay');
    b.textContent = on ? '❚❚ Pausa' : '▶ Avvia';
    b.classList.toggle('primary', !on);
  }
  setSpeed(n: number) {
    if (this.replaying) return;
    this.speed = Math.max(1, Math.min(240, n));
    document.querySelectorAll('#speeds button').forEach((b) => b.classList.toggle('active', Number((b as HTMLElement).dataset.v) === this.speed));
  }
  skipToNext() {
    const dt = this.sim.nextEventIn();
    if (dt === 0) { this.feedback('Ci sono treni in movimento: impossibile saltare', 'bad'); return; }
    if (!isFinite(dt)) { this.feedback('Nessun altro evento in orario', 'bad'); return; }
    const n = Math.max(0, dt - 180);
    for (let i = 0; i < n; i++) this.sim.step();
  }
  showHelp() { if (!this.replaying) $('helpModal').hidden = false; }
  showTrain(t: Train) { if (!this.replaying) this.selectTrain(t, true); }

  /** Esegue un comando registrandolo per il salvataggio. */
  exec(line: string) {
    this.log.push({ t: this.sim.time, c: line });
    return this.cmd.execute(line);
  }

  // ------------------------------------------------------------ salvataggio (replay dei comandi)

  private save() {
    if (!this.sim || !this.spec || this.replaying) return;
    const sp = this.spec;
    const data = {
      v: 1, id: sp.id, name: sp.name, seed: sp.seed, day: this.sim.day, delays: sp.delays, autoAssign: sp.autoAssign, autoFleet: sp.autoFleet,
      time: this.sim.time, log: this.log, speed: this.speed,
      files: sp.id ? undefined : { trk: sp.trk, sch: sp.sch, tds: [...(sp.tds ?? [])], xpm: [...(sp.xpm ?? [])], texts: [...(sp.texts ?? [])].filter(([k]) => k.endsWith('.sch')) },
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); }
    catch {
      // spazio insufficiente: salva senza le icone
      try { if (data.files) data.files.xpm = []; localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* niente salvataggio */ }
    }
  }

  savedGame(): { name: string; time: number } | undefined {
    try { const d = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null'); return d ? { name: d.name, time: d.time } : undefined; } catch { return undefined; }
  }

  resume() {
    let d;
    try { d = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null'); } catch { d = null; }
    if (!d) return;
    const lv = LEVELS.find((l) => l.id === d.id);
    const spec: LoadSpec = lv
      ? { id: lv.id, name: lv.title, trk: lv.trk, sch: lv.sch, tutorial: undefined, delays: d.delays, autoFleet: lv.autoFleet, seed: d.seed, day: d.day }
      : { name: d.name, trk: d.files.trk, sch: d.files.sch, tds: new Map(d.files.tds), xpm: new Map(d.files.xpm), texts: new Map(d.files.texts), day: d.day, delays: d.delays, autoAssign: d.autoAssign, seed: d.seed };
    this.load(spec);
    const log: { t: number; c: string }[] = d.log ?? [];
    this.replaying = true;
    let i = 0;
    try {
      while (this.sim.time <= d.time) {
        while (i < log.length && log[i].t <= this.sim.time) { this.cmd.execute(log[i].c); i++; }
        if (this.sim.time === d.time) break;
        this.sim.step();
      }
    } finally { this.replaying = false; }
    this.log = log.slice(0, i);
    this.setSpeed(d.speed ?? 10);
    $('alerts').innerHTML = '';
    for (const a of this.sim.alerts.slice(-80)) this.pushAlert(a.time, a.text, a.level, a.train);
    this.feedback(`Partita ripresa alle ${formatTime(this.sim.time)}. Premi Invio per continuare.`, 'pv');
  }

  // ------------------------------------------------------------ ciclo

  private frame = (now: number) => {
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (this.sim && this.running) {
      this.acc += dt * this.speed;
      let n = Math.floor(this.acc);
      this.acc -= n;
      const t0 = performance.now();
      while (n-- > 0) { this.sim.step(); if (performance.now() - t0 > 40) { this.acc = 0; break; } }
    }
    if (this.sim) {
      this.renderer.flash = now / 1000;
      this.renderer.draw();
      $('clock').textContent = formatTime(this.sim.time, true);
      if (now - this.lastSave > 10000) { this.lastSave = now; this.save(); }
      if (now - this.lastTT > 500) { this.lastTT = now; this.renderTimetable(); this.renderStats(); this.renderHints(); if (this.selected && !$('trainInfo').hidden) this.renderTrainInfo(); }
    }
    requestAnimationFrame(this.frame);
  };

  // ------------------------------------------------------------ UI statica

  private buildStatic() {
    const sp = $('speeds');
    for (const v of SPEEDS) {
      const b = document.createElement('button');
      b.textContent = '×' + v; b.dataset.v = String(v);
      b.onclick = () => this.setSpeed(v);
      sp.appendChild(b);
    }
    this.setSpeed(this.speed);
    $('btnPlay').onclick = () => this.setRunning(!this.running);
    $('btnNext').onclick = () => this.skipToNext();
    $('btnHelp').onclick = () => this.showHelp();
    $('btnPerf').onclick = () => { this.renderPerf(); $('perfModal').hidden = false; };
    $('btnLevels').onclick = () => { this.setRunning(false); this.save(); this.refreshResume(); $('startModal').hidden = false; };
    $('btnTheme').onclick = () => {
      const light = !document.body.classList.contains('light');
      document.body.classList.toggle('light', light);
      if (this.renderer) this.renderer.theme = light ? THEMES.classico : THEMES.acei;
    };
    document.querySelectorAll('[data-close]').forEach((b) => ((b as HTMLElement).onclick = () => ((b.closest('.modal') as HTMLElement).hidden = true)));
    document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m && m.id !== 'startModal') (m as HTMLElement).hidden = true; }));
    $('helpBody').innerHTML = HELP_HTML;

    // livelli
    const ll = $('levelList');
    for (const l of LEVELS) {
      const b = document.createElement('button');
      b.className = 'level';
      b.innerHTML = `<span class="diff">${'●'.repeat(l.difficulty)}${'○'.repeat(Math.max(0, 3 - l.difficulty))}</span><h3>${esc(l.title)}</h3><div class="sub">${esc(l.subtitle)}</div><p>${esc(l.description)}</p>`;
      b.onclick = () => this.loadLevel(l);
      ll.appendChild(b);
    }
    window.addEventListener('beforeunload', () => this.save());
    $('btnResume').onclick = () => this.resume();
    this.refreshResume();
    // import
    const drop = $('drop');
    const handle = async (files: File[]) => {
      $('importMsg').textContent = 'Caricamento…';
      try {
        const sc = await readScenarioFiles(files);
        this.load({ name: sc.name, trk: sc.trk, sch: sc.sch, tds: sc.tds, xpm: sc.xpm, texts: sc.texts, day: Number($<HTMLSelectElement>('daySel').value), delays: $<HTMLInputElement>('optDelays').checked, autoAssign: $<HTMLInputElement>('optAssign').checked });
        $('importMsg').textContent = '';
      } catch (e) { $('importMsg').textContent = 'Errore: ' + (e as Error).message; }
    };
    $<HTMLInputElement>('fileInput').onchange = (e) => handle([...((e.target as HTMLInputElement).files ?? [])]);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handle([...(e.dataTransfer?.files ?? [])]); });
    $<HTMLSelectElement>('daySel').value = String(((new Date().getDay() + 6) % 7) + 1);

    // tabella orari
    document.querySelectorAll('#ttTabs button').forEach((b) => ((b as HTMLElement).onclick = () => {
      document.querySelectorAll('#ttTabs button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      this.ttFilter = (b as HTMLElement).dataset.f!;
      this.renderTimetable(true);
    }));
    $('ttSearch').oninput = () => this.renderTimetable(true);
    document.querySelectorAll('#sideTabs button').forEach((b) => ((b as HTMLElement).onclick = () => this.sideTab((b as HTMLElement).dataset.s!)));

    this.bindCommandBar();
    this.bindCanvas();
    window.addEventListener('resize', () => { if (this.renderer) this.renderer.resize(); });
    // divisore tra quadro e tabella orari
    const sp2 = $('splitter');
    sp2.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const move = (ev: MouseEvent) => {
        const h = Math.max(120, Math.min(window.innerHeight - 260, window.innerHeight - ev.clientY));
        document.documentElement.style.setProperty('--bottom-h', h + 'px');
        this.renderer?.resize();
      };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  private refreshResume() {
    const sg = this.savedGame();
    $('resumeBox').hidden = !sg;
    if (sg) $('resumeInfo').textContent = `${sg.name} — ${formatTime(sg.time)}`;
  }

  private sideTab(s: string) {
    document.querySelectorAll('#sideTabs button').forEach((x) => x.classList.toggle('active', (x as HTMLElement).dataset.s === s));
    $('alerts').hidden = s !== 'alerts';
    $('trainInfo').hidden = s !== 'train';
    if (s === 'train') this.renderTrainInfo();
  }

  // ------------------------------------------------------------ barra comandi

  private bindCommandBar() {
    const inp = $<HTMLInputElement>('cmd');
    const run = () => {
      const line = inp.value.trim();
      if (!this.sim) return;
      if (!line) { this.setRunning(!this.running); this.feedback(this.running ? 'Tempo avviato' : 'In pausa', 'pv'); return; }
      this.history.unshift(line); this.histIdx = -1;
      const res = this.exec(line);
      const bad = res.filter((r) => !r.ok);
      const msg = res.map((r) => r.msg).filter(Boolean).join(' · ');
      this.feedback(msg || 'OK', bad.length ? 'bad' : 'ok');
      if (bad.length) this.beep(180, 0.15); else this.beep(1200, 0.03);
      for (const r of res) if (r.msg) this.pushAlert(this.sim.time, '› ' + line + ' — ' + r.msg, r.ok ? 'info' : 'bad');
      inp.value = '';
      this.updatePreview();
    };
    $('cmdGo').onclick = run;
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); run(); }
      else if (e.key === 'Escape') { inp.value = ''; this.updatePreview(); }
      else if (e.key === 'Tab') {
        e.preventDefault();
        if (!this.sugg.length) return;
        if (!inp.value.trim()) { inp.value = this.sugg[0].text; this.updatePreview(); }
        else this.acceptSuggestion(this.sugg[this.suggIdx % this.sugg.length].text);
      }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (this.histIdx < this.history.length - 1) inp.value = this.history[++this.histIdx]; this.updatePreview(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (this.histIdx > 0) inp.value = this.history[--this.histIdx]; else { this.histIdx = -1; inp.value = ''; } this.updatePreview(); }
      else if (e.key === 'PageUp' || (e.key === '+' && e.altKey)) { e.preventDefault(); this.bumpSpeed(1); }
      else if (e.key === 'PageDown' || (e.key === '-' && e.altKey)) { e.preventDefault(); this.bumpSpeed(-1); }
    });
    inp.addEventListener('input', () => this.updatePreview());
    document.addEventListener('keydown', (e) => {
      if (e.target === inp || (e.target as HTMLElement).tagName === 'INPUT') return;
      if (!$('startModal').hidden) return;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) inp.focus();
    });
  }

  private bumpSpeed(d: number) {
    const i = SPEEDS.indexOf(this.speed);
    this.setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 3 : i) + d))]);
  }

  private acceptSuggestion(text: string) {
    const inp = $<HTMLInputElement>('cmd');
    inp.value = inp.value.replace(/[^\s;,]*$/, text) + ' ';
    inp.focus();
    this.updatePreview();
  }

  hints = true;
  private lastHints = '';

  /** Suggerimenti dell'assistente DM quando la barra è vuota. */
  private renderHints() {
    const inp = $<HTMLInputElement>('cmd');
    if (inp.value.trim() || !this.hints) { if (!inp.value.trim()) this.showSuggest([]); return; }
    const sg = suggestions(this.sim).slice(0, 6);
    const key = sg.map((x) => x.command + x.train.name + x.urgent).join('|');
    if (key === this.lastHints) return;
    this.lastHints = key;
    this.showSuggest(sg.map((x) => ({ text: x.command, hint: `${x.urgent ? '⚠ ' : ''}${x.why}` })), true);
  }

  private updatePreview() {
    if (!this.sim) return;
    const line = $<HTMLInputElement>('cmd').value;
    if (!line.trim()) { this.renderer.preview = undefined; this.lastHints = ''; this.showSuggest([]); this.renderHints(); return; }
    const pv = this.cmd.preview(line);
    this.renderer.preview = pv;
    if (pv.message) this.feedback(pv.message, pv.ok ? 'pv' : 'bad');
    this.showSuggest(this.cmd.suggest(line));
  }

  private showSuggest(s: { text: string; hint: string }[], hints = false) {
    this.sugg = s; this.suggIdx = 0;
    const box = $('suggest');
    box.hidden = !s.length;
    box.classList.toggle('hints', hints);
    box.innerHTML = hints && s.length ? '<span class="hint-title">Assistente DM</span>' : '';
    s.forEach((x, i) => {
      const b = document.createElement('button');
      if (i === 0) b.className = 'sel';
      b.innerHTML = `${esc(x.text)}<small>${esc(x.hint)}</small>`;
      b.onmousedown = (e) => { e.preventDefault(); if (hints) { $<HTMLInputElement>('cmd').value = x.text; this.updatePreview(); } else this.acceptSuggestion(x.text); };
      box.appendChild(b);
    });
  }

  private feedback(msg: string, cls: 'ok' | 'bad' | 'pv') {
    $('feedback').innerHTML = `<span class="${cls}">${esc(msg)}</span>`;
  }

  // ------------------------------------------------------------ quadro

  private bindCanvas() {
    const cv = $<HTMLCanvasElement>('board');
    let drag: { x: number; y: number; ox: number; oy: number; moved: boolean } | undefined;
    const pos = (e: MouseEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('mousedown', (e) => { const p = pos(e); drag = { ...p, ox: this.renderer.ox, oy: this.renderer.oy, moved: false }; });
    window.addEventListener('mouseup', (e) => {
      if (drag && !drag.moved && e.target === cv) this.click(pos(e), e);
      drag = undefined;
    });
    cv.addEventListener('mousemove', (e) => {
      if (!this.sim) return;
      const p = pos(e);
      if (drag && (Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y) > 4 || drag.moved)) {
        drag.moved = true;
        this.renderer.ox = drag.ox + p.x - drag.x; this.renderer.oy = drag.oy + p.y - drag.y;
        $('tooltip').hidden = true;
        return;
      }
      const el = this.renderer.pick(p.x, p.y);
      this.renderer.hover = el;
      const tip = $('tooltip');
      const txt = el ? this.describe(el) : '';
      tip.hidden = !txt;
      if (txt) { tip.textContent = txt; tip.style.left = Math.min(p.x + 14, cv.clientWidth - 300) + 'px'; tip.style.top = (p.y + 14) + 'px'; }
    });
    cv.addEventListener('mouseleave', () => { $('tooltip').hidden = true; this.renderer.hover = undefined; });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const p = pos(e); this.renderer.zoomAt(p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
    cv.addEventListener('dblclick', (e) => { const el = this.renderer.pick(pos(e).x, pos(e).y); if (el) this.direct(el); });
    $('zoomIn').onclick = () => { const r = cv.getBoundingClientRect(); this.renderer.zoomAt(r.width / 2, r.height / 2, 1.25); };
    $('zoomOut').onclick = () => { const r = cv.getBoundingClientRect(); this.renderer.zoomAt(r.width / 2, r.height / 2, 0.8); };
    $('zoomFit').onclick = () => this.renderer.fit();
    $('toggleLabels').onclick = () => { this.renderer.showLabels = !this.renderer.showLabels; $('toggleLabels').classList.toggle('on', !this.renderer.showLabels); };
    $('toggleHints').onclick = () => { this.hints = !this.hints; $('toggleHints').classList.toggle('on', !this.hints); this.lastHints = ''; this.updatePreview(); };
    $('toggleSound').onclick = () => { this.sound = !this.sound; $('toggleSound').classList.toggle('on', !this.sound); $('toggleSound').textContent = this.sound ? '♪' : '∅'; };
  }

  /** Click: aggiunge il "pulsante" alla barra comandi. Shift+click: azione diretta. */
  private click(p: { x: number; y: number }, e: MouseEvent) {
    const el = this.renderer.pick(p.x, p.y);
    if (!el) return;
    if (e.shiftKey) { this.direct(el); return; }
    const t = this.sim.trainAt(el);
    let token = '';
    if (el.kind === 'signal' && !(el as Signal).approach) token = el.label!;
    else if (el.kind === 'switch') token = el.label!;
    else if (el.kind === 'text' && el.label) token = el.label;
    else if (el.kind === 'itin' && el.name) token = el.name;
    if (t && (el.kind === 'track' || el.kind === 'switch')) { this.selectTrain(t, true); if (/^(inv|man|parti|ass|info)\s*$/i.test($<HTMLInputElement>('cmd').value.trim().split(/\s+/).pop() ?? '')) token = shortTrainName(t.name); else if (el.kind !== 'switch') return; }
    if (!token) return;
    const inp = $<HTMLInputElement>('cmd');
    inp.value = (inp.value.trimEnd() ? inp.value.trimEnd() + ' ' : '') + token + ' ';
    inp.focus();
    this.updatePreview();
  }

  /** Azione diretta (Shift+clic): passa comunque dalla barra comandi, così resta nel salvataggio. */
  private direct(el: Element) {
    let line = '';
    if (el.kind === 'signal' && !(el as Signal).approach) line = el.label!;
    else if (el.kind === 'switch') line = el.label!;
    else if (el.kind === 'itin' && el.name) line = el.name;
    if (!line) return;
    const r = this.exec(line);
    this.feedback(r.map((x) => x.msg).join(' · '), r.every((x) => x.ok) ? 'ok' : 'bad');
  }

  private describe(el: Element): string {
    const t = this.sim.trainAt(el);
    const lines: string[] = [];
    if (el.kind === 'signal') {
      const s = el as Signal;
      lines.push(`Segnale ${s.label}${s.name && s.name !== s.label ? ' — ' + s.name : ''}`);
      lines.push(s.approach ? 'Segnale di avviso / indicatore (non arresta)' : `${s.clear ? 'Via libera' : 'Via impedita'}${s.fleeted ? ' · blocco automatico ' + (s.nowFleeted ? 'attivo' : 'non attivo') : ''}`);
      if (!s.approach) lines.push('Clic: aggiungi alla barra · Shift+clic: apri/chiudi');
    } else if (el.kind === 'switch') {
      lines.push(`Deviatoio ${el.label} — ${el.switched ? 'rovescio' : 'normale'}`);
      lines.push(el.state === 'free' ? 'Libero · Shift+clic: manovra' : 'Bloccato (itinerario o treno)');
    } else if (el.kind === 'track') {
      if (el.isStation && el.name) lines.push(`Binario di stazione: ${el.name}${platformOf(el.name) ? ` (digita b${platformOf(el.name)})` : ''}`);
      lines.push(`Lunghezza ${el.length} m${el.speed.length ? ` · vel. ${el.speed.filter(Boolean).join('/')} km/h` : ''}`);
    } else if (el.kind === 'text') {
      if (el.label) lines.push(`Ingresso/uscita ${el.name}${el.label !== el.name ? ' (digita ' + el.label + ')' : ''}`);
      else return '';
    } else if (el.kind === 'itin') lines.push(`Itinerario ${el.name}`);
    if (t) lines.push(`Treno ${t.name} — ${STATUS_IT[t.status]} · ${Math.round(t.speed)} km/h`);
    return lines.join('\n');
  }

  // ------------------------------------------------------------ pannelli

  private selectTrain(t: Train, show: boolean) {
    this.selected = t;
    this.renderer.focusTrain = t;
    if (show) { this.sideTab('train'); if (t.occ[0]) this.renderer.centerIfHidden(t.occ[0].el.x, t.occ[0].el.y); }
    this.renderTimetable(true);
  }

  private pushAlert(time: number, text: string, level: string, train?: string) {
    const box = $('alerts');
    const d = document.createElement('div');
    d.className = 'alert ' + level;
    d.innerHTML = `<time>${formatTime(time)}</time><span>${esc(text)}</span>`;
    if (train) d.onclick = () => { const t = this.sim.trainNamed(train); if (t) this.selectTrain(t, true); };
    box.prepend(d);
    while (box.childElementCount > 300) box.lastElementChild!.remove();
  }

  private renderStats() {
    const c = this.sim.summary();
    const g = (k: string) => c[k] ?? 0;
    $('stats').innerHTML = `<span title="In marcia">R <b>${g('running') + g('starting')}</b></span><span title="Pronti a entrare / in ritardo">r <b>${g('ready') + g('delayed')}</b></span><span title="Fermi al segnale">w <b>${g('waiting')}</b></span><span title="In stazione">s <b>${g('stopped')}</b></span><span title="Arrivati / usciti">a <b>${g('arrived') + g('exited')}</b></span>`;
    $('score').textContent = String(this.sim.penaltyScore());
  }

  private stopInfo(t: Train): { station: string; plat: string; arr: string; dep: string } {
    const s = t.status === 'stopped' && t.outOf ? t.def.stops.find((x, i) => t.served.has(i) && t.served.get(i)!.arrival !== undefined && t.served.get(i)!.departure === undefined && x.minStop > 0) : t.nextStop();
    if (s) return { station: baseStation(s.station), plat: platformOf(s.station) ?? '', arr: formatTime(s.arrival), dep: formatTime(s.departure) };
    return { station: baseStation(t.def.exit), plat: platformOf(t.def.exit) ?? '', arr: formatTime(t.def.timeOut), dep: '' };
  }

  renderTimetable(force = false) {
    if (!this.sim) return;
    const now = this.sim.time;
    const q = $<HTMLInputElement>('ttSearch').value.trim().toLowerCase();
    let rows = this.sim.trains.filter((t) => t.status !== 'notToday');
    if (this.ttFilter === 'next') rows = rows.filter((t) => t.onLayout || t.status === 'delayed' || (t.status === 'ready' && t.def.timeIn - now < 3600));
    else if (this.ttFilter === 'active') rows = rows.filter((t) => t.onLayout || t.status === 'delayed');
    else if (this.ttFilter === 'done') rows = rows.filter((t) => t.status === 'exited' || t.status === 'arrived' || t.status === 'derailed');
    if (q) rows = rows.filter((t) => (t.name + ' ' + t.def.entrance + ' ' + t.def.exit + ' ' + t.def.stops.map((s) => s.station).join(' ')).toLowerCase().includes(q));
    if (rows.length > 400) rows = rows.slice(0, 400);
    void force;
    const tb = ($('tt') as HTMLTableElement).tBodies[0];
    const html = rows.map((t) => {
      const si = this.stopInfo(t);
      const d = t.delayMin(now);
      const soon = t.status === 'ready' && t.def.timeIn - now < 180 && t.def.timeIn >= now - 60;
      const cls = `st-${t.status}${this.selected === t ? ' sel' : ''}${soon ? ' soon' : ''}`;
      const real = t.status === 'stopped' || t.status === 'arrived' ? t.occ[0]?.el.name : undefined;
      const plat = real ? platformOf(real) ?? si.plat : si.plat;
      const wrongP = real && si.plat && platformOf(real) !== si.plat;
      return `<tr data-i="${t.idx}" class="${cls}"><td><span class="chip" style="background:${TYPE_COLORS[t.type % 10]}"></span><span class="tname">${esc(t.name)}</span></td>` +
        `<td class="t">${formatTime(t.def.timeIn)}</td><td>${esc(t.def.entrance)}</td><td>${esc(si.station)}</td><td class="mono${wrongP ? ' late' : ''}">${esc(plat)}</td>` +
        `<td class="t">${si.arr}</td><td class="t">${si.dep}</td><td class="t">${formatTime(t.def.timeOut)}</td><td>${esc(t.def.exit)}</td>` +
        `<td class="status">${STATUS_IT[t.status]}${t.status === 'running' || t.status === 'waiting' ? ` · ${Math.round(t.speed)} km/h` : ''}</td>` +
        `<td class="t ${d > 0 ? 'late' : d < 0 ? 'early' : ''}">${d > 0 ? '+' + d : d < 0 ? d : t.onLayout || ['exited', 'arrived'].includes(t.status) ? '0' : ''}</td></tr>`;
    }).join('');
    if (tb.dataset.h !== html) {
      tb.innerHTML = html; tb.dataset.h = html;
      tb.querySelectorAll('tr').forEach((tr) => ((tr as HTMLElement).onclick = () => {
        const t = this.sim.trains[Number((tr as HTMLElement).dataset.i)];
        this.selectTrain(t, true);
        if (t.occ[0]) this.renderer.centerOn(t.occ[0].el.x, t.occ[0].el.y);
      }));
    }
  }

  private renderTrainInfo() {
    const t = this.selected;
    const box = $('trainInfo');
    if (!t) { box.innerHTML = '<p>Seleziona un treno dalla tabella o dal quadro.</p>'; return; }
    const d = t.def;
    const fmt = (x?: number) => (x === undefined ? '' : formatTime(x));
    const rows = d.stops.map((s, i) => {
      const r = t.served.get(i);
      return `<tr><td>${esc(s.station)}</td><td class="t">${s.minStop ? fmt(s.arrival) : '—'}</td><td class="t">${fmt(s.departure)}</td><td class="t">${r ? fmt(r.arrival ?? r.departure) : ''}</td><td>${r?.platform ?? ''}</td></tr>`;
    }).join('');
    const sn = shortTrainName(t.name);
    box.innerHTML = `<div class="tinfo"><h3><span class="chip" style="background:${TYPE_COLORS[t.type % 10]}"></span>${esc(t.name)}</h3>
      <div class="kv"><div>Stato</div><div>${STATUS_IT[t.status]}${t.holding ? ' (attende segnale di partenza)' : ''}</div>
      <div>Velocità</div><div>${Math.round(t.speed)} km/h${d.maxSpeed ? ` (max ${d.maxSpeed})` : ''}</div>
      <div>Ingresso</div><div>${fmt(d.timeIn)} da <b>${esc(d.entrance)}</b>${d.altEntrances.length ? ' (alt. ' + esc(d.altEntrances.join(', ')) + ')' : ''}</div>
      <div>Uscita</div><div>${fmt(d.timeOut)} da <b>${esc(d.exit)}</b></div>
      <div>Lunghezza</div><div>${d.length ? d.length + ' m' : '—'} · tipo ${d.type + 1}</div>
      ${d.waitFor ? `<div>Materiale da</div><div>${esc(d.waitFor)}</div>` : ''}${d.stock ? `<div>Materiale per</div><div>${esc(d.stock)}</div>` : ''}
      ${t.status === 'stopped' ? `<div>Partenza</div><div>${fmt(t.timeDep)}</div>` : ''}
      <div>Ritardo</div><div>${t.delayMin(this.sim.time)}′</div>
      ${d.notes.length ? `<div>Note</div><div>${esc(d.notes.join(' '))}</div>` : ''}</div>
      <div class="actions"><button class="btn" data-c="inv ${esc(sn)}">Inverti</button><button class="btn" data-c="man ${esc(sn)}">Manovra</button><button class="btn" data-c="parti ${esc(sn)}">Parti ora</button><button class="btn" data-center="1">Centra</button></div>
      <table><thead><tr><th>Stazione</th><th>Arr.</th><th>Part.</th><th>Reale</th><th>Bin.</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    box.querySelectorAll('[data-c]').forEach((b) => ((b as HTMLElement).onclick = () => { const r = this.exec((b as HTMLElement).dataset.c!); this.feedback(r.map((x) => x.msg).join(' · '), r.every((x) => x.ok) ? 'ok' : 'bad'); }));
    const c = box.querySelector('[data-center]') as HTMLElement;
    c.onclick = () => { if (t.occ[0]) this.renderer.centerOn(t.occ[0].el.x, t.occ[0].el.y); };
  }

  private renderPerf() {
    const p = this.sim.perf;
    const rows = (Object.keys(PERF_LABELS) as (keyof Perf)[]).map((k) => {
      const [label, w] = PERF_LABELS[k];
      return `<tr><td>${label}</td><td class="n">${p[k]}</td><td class="n">${w ? p[k] * w : ''}</td></tr>`;
    }).join('');
    const done = this.sim.trains.filter((t) => t.status === 'exited' || t.status === 'arrived').length;
    const total = this.sim.trains.filter((t) => t.status !== 'notToday').length;
    $('perfBody').innerHTML = `<h2>Prestazioni — ${formatTime(this.sim.time)}</h2>
      <p>Treni conclusi: <b>${done}</b> su ${total}. Punti di penalità: <b>${this.sim.penaltyScore()}</b> (meno è meglio).</p>
      <table class="perf"><thead><tr><th>Voce</th><th>N.</th><th>Punti</th></tr></thead><tbody>${rows}<tr class="tot"><td>Totale</td><td></td><td class="n">${this.sim.penaltyScore()}</td></tr></tbody></table>`;
  }

  private showTutorial(steps?: string[]) {
    const box = $('tutorial');
    if (!steps?.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<button class="x" title="Chiudi">×</button><h3>Come si gioca</h3><ol>${steps.map((s) => `<li>${esc(s).replace(/"([^"]+)"/g, '<code>$1</code>')}</li>`).join('')}</ol>`;
    (box.querySelector('.x') as HTMLElement).onclick = () => (box.hidden = true);
  }

  private beep(freq: number, dur: number) {
    if (!this.sound) return;
    try {
      this.audio ??= new AudioContext();
      const o = this.audio.createOscillator(), g = this.audio.createGain();
      o.frequency.value = freq; o.type = 'sine';
      g.gain.setValueAtTime(0.06, this.audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, this.audio.currentTime + dur);
      o.connect(g).connect(this.audio.destination);
      o.start(); o.stop(this.audio.currentTime + dur);
    } catch { /* audio non disponibile */ }
  }
}

const SAVE_KEY = 'td2026.save';

const HELP_HTML = `
<h2>La barra comandi</h2>
<p>Come sul banco ACEI premi i <b>pulsanti</b> d'inizio e fine itinerario: qui li digiti, separati da spazi. Mentre scrivi, l'itinerario viene <b>anteprimato in blu</b> sul quadro.</p>
<div class="help-grid">
  <code>1 3</code><div>Forma l'itinerario dal segnale 1 al segnale 3: manovra i deviatoi necessari e dispone il segnale 1 a via libera.</div>
  <code>3 E</code><div>Dal segnale 3 verso l'uscita E.</div>
  <code>1 3 E</code><div>Catena: 1→3 e poi 3→E in un colpo solo.</div>
  <code>2 b5</code><div>Riceve sul <b>binario 5</b> (indispensabile nelle stazioni di testa, dove il binario finisce contro il paraurti). Anche <code>2 @5</code>.</div>
  <code>1 b2 E</code><div>Attraversa la stazione passando dal binario 2 e prosegue verso l'uscita E.</div>
  <code>12</code><div>Apre (o chiude, se è verde) il solo segnale 12 con gli scambi come sono.</div>
  <code>x 12</code><div>Annulla: segnale 12 a via impedita, l'itinerario non impegnato si libera.</div>
  <code>a 31</code><div>Blocco automatico: il segnale si riapre da solo dopo il passaggio dei treni (solo segnali con doppio anello).</div>
  <code>d4 d5</code><div>Manovra i deviatoi 4 e 5 (anche <code>d 4 5</code>).</div>
  <code>BC-PN</code><div>Attiva un itinerario predefinito dello scenario (scenari importati).</div>
  <code>inv 2291</code><div>Inverte la marcia del treno (basta il numero).</div>
  <code>man 2291</code><div>Manovra: il treno procede a 30 km/h fino alla prossima stazione.</div>
  <code>parti 2291</code><div>Partenza anticipata. <code>ass 2290 2291</code>: assegna il materiale.</div>
  <code>info 2291</code><div>Scheda del treno.</div>
  <code>v 30</code><div>Velocità del tempo ×30. <code>pausa</code>, <code>avvia</code>, <code>salta</code> (al prossimo evento).</div>
  <code>1 3; 6 O</code><div>Più comandi in una riga, separati da <code>;</code></div>
</div>
<h2>Tastiera e mouse</h2>
<div class="help-grid">
  <kbd>Invio</kbd><div>Esegue. A barra vuota avvia/ferma il tempo.</div>
  <kbd>Tab</kbd><div>Completa con il primo suggerimento.</div>
  <kbd>↑ ↓</kbd><div>Cronologia comandi. <kbd>Esc</kbd> cancella.</div>
  <kbd>PagSu / PagGiù</kbd><div>Velocità del tempo.</div>
  <span>Clic</span><div>Su segnale, deviatoio o uscita: aggiunge il pulsante alla barra.</div>
  <span>Shift+clic</span><div>Azione diretta (come nel Train Director originale). Doppio clic idem.</div>
  <span>Rotella / trascina</span><div>Zoom e spostamento del quadro.</div>
</div>
<h2>Colori del quadro</h2>
<div class="help-grid">
  <span style="color:#f4f1de">━━ bianco</span><div>Itinerario formato (bloccato).</div>
  <span style="color:#ff453a">━━ rosso</span><div>Binario occupato da un treno.</div>
  <span style="color:#7d8a93">━━ grigio</span><div>Binario libero.</div>
  <span>● verde/giallo/rosso</span><div>Via libera · via libera con avviso di via impedita · via impedita. Il quadrato indica segnale sempre rosso.</div>
</div>
<h2>Penalità</h2>
<p>Destinazione o binario errati, ritardi, treni fermi ai segnali, comandi rifiutati, manovre inutili di scambi e segnali. Le vedi in <b>Prestazioni</b>.</p>`;
