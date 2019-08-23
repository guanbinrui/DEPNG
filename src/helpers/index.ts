export function fetchImage(url: string, options?: RequestInit) {
  return fetch(url, options)
    .then(result => {
      if (result.status > 299) {
        throw new Error('network error!');
      }
      return result.arrayBuffer();
    })
    .then(buf => new Uint8Array(buf));
}

export function parseIntFromBuffer(buf: ArrayBuffer, bits: 8 | 16 | 32 = 8) {
  switch (bits) {
    case 8:
      return new DataView(buf).getUint8(0);
    case 16:
      return new DataView(buf).getUint16(0);
    case 32:
      return new DataView(buf).getUint32(0);
  }
}

export function paethPredictor(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);

  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}
