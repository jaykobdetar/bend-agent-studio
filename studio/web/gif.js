// GIF89a with a shared palette, changed rectangles and 12-bit LZW.
export class Gif {
  constructor(w, h, rgba) {
    this.width = w;
    this.height = h;
    this.bytes = [];
    this.lookup = new Int16Array(32768).fill(-1);
    const hist = new Map();
    for (let i = 0; i < rgba.length; i += 4) {
      const k = this.key(rgba, i);
      hist.set(k, (hist.get(k) ?? 0) + 1);
    }
    this.palette = [...hist.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 224)
      .map(([k]) => [(k >> 10) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4]);
    // Reserve broad colors for marks or objects appearing later in an episode.
    for (let i = 0; i < 32; i++)
      this.palette.push([((i >> 3) & 3) * 85, ((i >> 1) & 3) * 85, (i & 1) * 255]);
    while (this.palette.length < 256) this.palette.push([0, 0, 0]);
    this.ascii('GIF89a');
    this.word(w);
    this.word(h);
    this.bytes.push(247, 0, 0);
    for (const col of this.palette) this.bytes.push(...col);
    this.bytes.push(33, 255, 11);
    this.ascii('NETSCAPE2.0');
    this.bytes.push(3, 1, 0, 0, 0);
  }
  key(a, i) {
    return ((a[i] >> 3) << 10) | ((a[i + 1] >> 3) << 5) | (a[i + 2] >> 3);
  }
  ascii(s) {
    for (const c of s) this.bytes.push(c.charCodeAt(0));
  }
  word(x) {
    this.bytes.push(x & 255, x >> 8);
  }
  color(k) {
    if (this.lookup[k] >= 0) return this.lookup[k];
    const r = (k >> 10) * 8 + 4,
      g = ((k >> 5) & 31) * 8 + 4,
      b = (k & 31) * 8 + 4;
    let best = 0,
      dist = Infinity;
    for (let i = 0; i < 256; i++) {
      const p = this.palette[i],
        d = (r - p[0]) ** 2 + (g - p[1]) ** 2 + (b - p[2]) ** 2;
      if (d < dist) {
        best = i;
        dist = d;
        if (!d) break;
      }
    }
    this.lookup[k] = best;
    return best;
  }
  frame(rgba, delay) {
    const w = this.width,
      h = this.height,
      now = new Uint8Array(w * h);
    let x0 = w,
      y0 = h,
      x1 = -1,
      y1 = -1;
    for (let i = 0; i < now.length; i++) {
      const p = (now[i] = this.color(this.key(rgba, i * 4)));
      if (!this.prev || p !== this.prev[i]) {
        const x = i % w,
          y = Math.floor(i / w);
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
    if (x1 < 0) x0 = x1 = y0 = y1 = 0;
    this.bytes.push(33, 249, 4, 4);
    this.word(Math.max(2, Math.min(65535, Math.round(delay))));
    this.bytes.push(0, 0, 44);
    this.word(x0);
    this.word(y0);
    this.word(x1 - x0 + 1);
    this.word(y1 - y0 + 1);
    this.bytes.push(0, 8);
    const packed = [];
    let bits = 0,
      nBits = 0,
      size = 9,
      next = 258,
      dict = new Map(),
      prefix = -1;
    function emit(code) {
      bits |= code << nBits;
      nBits += size;
      while (nBits >= 8) {
        packed.push(bits & 255);
        bits >>>= 8;
        nBits -= 8;
      }
    }
    emit(256);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const v = now[y * w + x];
        if (prefix < 0) {
          prefix = v;
          continue;
        }
        const key = prefix * 256 + v,
          entry = dict.get(key);
        if (entry !== undefined) {
          prefix = entry;
          continue;
        }
        emit(prefix);
        if (next < 4096) {
          dict.set(key, next++);
          if (next > 1 << size && size < 12) size++;
        } else {
          emit(256);
          dict.clear();
          size = 9;
          next = 258;
        }
        prefix = v;
      }
    emit(prefix);
    if (next === 1 << size && size < 12) size++;
    emit(257);
    if (nBits) packed.push(bits & 255);
    for (let i = 0; i < packed.length; i += 255) {
      const chunk = packed.slice(i, i + 255);
      this.bytes.push(chunk.length, ...chunk);
    }
    this.bytes.push(0);
    this.prev = now;
  }
  finish() {
    return new Blob([Uint8Array.from([...this.bytes, 59])], {type: 'image/gif'});
  }
}
