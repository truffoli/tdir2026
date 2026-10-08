// Decodifica minimale delle immagini XPM usate dagli scenari originali.
const NAMED: Record<string, string> = { none: 'transparent', black: '#000', white: '#fff', red: '#f00', green: '#0a0', blue: '#00f', yellow: '#ff0', gray: '#888', grey: '#888', orange: '#ffa500', cyan: '#0ff', magenta: '#f0f' };

export function decodeXpm(src: string): HTMLCanvasElement | undefined {
  const strs = [...src.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  if (!strs.length) return undefined;
  const [w, h, nc, cpp] = strs[0].trim().split(/\s+/).map(Number);
  if (!w || !h || !nc || !cpp || w > 2048 || h > 2048) return undefined;
  const colors = new Map<string, string>();
  for (let i = 1; i <= nc; i++) {
    const s = strs[i] ?? '';
    const code = s.slice(0, cpp);
    const m = /\bc\s+(#[0-9a-fA-F]+|\w+)/.exec(s.slice(cpp));
    let col = m ? m[1] : 'transparent';
    if (col.startsWith('#') && col.length === 13) col = '#' + col.slice(1, 3) + col.slice(5, 7) + col.slice(9, 11);
    colors.set(code, NAMED[col.toLowerCase()] ?? col);
  }
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const tmp = document.createElement('canvas').getContext('2d')!;
  const cache = new Map<string, number[]>();
  const rgba = (c: string) => {
    let v = cache.get(c);
    if (!v) {
      if (c === 'transparent') v = [0, 0, 0, 0];
      else { tmp.fillStyle = '#000'; tmp.fillStyle = c; const hx = tmp.fillStyle as string; v = hx.startsWith('#') ? [parseInt(hx.slice(1, 3), 16), parseInt(hx.slice(3, 5), 16), parseInt(hx.slice(5, 7), 16), 255] : [0, 0, 0, 255]; }
      cache.set(c, v);
    }
    return v;
  };
  for (let y = 0; y < h; y++) {
    const row = strs[1 + nc + y] ?? '';
    for (let x = 0; x < w; x++) {
      const c = colors.get(row.substr(x * cpp, cpp)) ?? 'transparent';
      const v = rgba(c);
      img.data.set(v, (y * w + x) * 4);
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
