import { inflate } from 'pako';
import { parseIntFromBuffer, paethPredictor } from '../helpers';

enum CHUN_TYPE {
  IHDR = 'IHDR',
  gAMA = 'gAMA',
  PLTE = 'PLTE',
  cHRM = 'cHRM',
  tRNS = 'tRNS',
  bKGD = 'bKGD',
  tIME = 'tIME',
  IDAT = 'IDAT',
  tEXt = 'tEXt',
  IEND = 'IEND',
}

enum COLOR_TYPE {
  GRAY_SCALE = 0,
  TRUE_COLOR = 2,
  INDEXED = 3,
  GRAY_SCALE_ALPHA = 4,
  TRUE_COLOR_ALPHA = 6,
}

enum FILTER_TYPE {
  NONE = 0,
  SUB = 1,
  UP = 2,
  AVERAGE = 3,
  PEATH = 4,
}

interface Chunk {
  type: CHUN_TYPE;
  length: number;
  data: Uint8Array;
}

interface Pixel {
  color: Color;
  position: Position;
}

interface Position {
  x: number;
  y: number;
}

interface Color {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

type Scanline = [FILTER_TYPE, Uint8Array];

interface IHDRChunk {
  type: CHUN_TYPE.IHDR;
  width: number;
  height: number;
  depth: number;
  colorType: number;
  compression: number;
  filter: number;
  interlace: number;
  channels: number;
  bpp: number; // bytes per pixel
  bpl: number; // bytes per line
}

interface PLTEChunk {
  type: CHUN_TYPE.PLTE;
  entries: Color[];
}

interface IDATChunk {
  type: CHUN_TYPE.IDAT;
  lines: Scanline[];
}

// # Chunk
//
// | field  | bytes | description                               |
// |--------| ------|-------------------------------------------|
// | length | 4     | the number of bytes in chunk's data field |
// | type   | 4     | the identifier of the chunk in ASCII      |
// | data   | ?     | the data can be zero length               |
// | CRC    | 4     | error detection                           |
//
// Semantics of chunk identifier [\w\W{4}]:
//
// 1. \w: critical \W: ancillary
// 2. \w: public   \W: private
// 3. reserved
// 4. \w: unsafe to copy \W: safe to copy,
function decodeChunks(data: Uint8Array): Chunk[] {
  data = consume(data, 8); // consume header

  const chunks: Chunk[] = [];
  let previousType: CHUN_TYPE;

  while (previousType !== CHUN_TYPE.IEND) {
    const length = parseIntFromBuffer(peek(data, 0, 4).buffer, 32);
    const type = String.fromCharCode(...peek(data, 4, 8)) as CHUN_TYPE;

    chunks.push({
      length,
      type,
      data: peek(data, 8, 8 + length),
      // crc: peek(data, 8 + length, 12 + length),
    });
    data = consume(data, 12 + length);
    previousType = type;
  }
  return chunks;
}

// # IHDR chunk
//
// - the first chunk in png datastream
// - contains metadata about the png image in the fellow form:
//
// | name               | bytes | description                                                                              |
// |--------------------|-------|------------------------------------------------------------------------------------------|
// | width              | 4     | 0 is invalid value, valid value in range (0, 2^31]                                       |
// | height             | 4     | same as width                                                                            |
// | bit depth          | 1     | number of bits per sample or per palette index, valid values are 1, 2, 4, 8, 16          |
// | color type         | 1     | 1 (palettle used), 2(color used), 4 (alpha channel used), valid values are 0, 2, 3, 4, 6 |
// | compression method | 1     | only compression method 0 is defined                                                     |
// | filter method      | 1     | only filter method 0 is defined                                                          |
// | interlace method   | 1     | two values are currently defined: 0 (no interlace) or 1 (Adam7 interlace)                |
function decodeIHDR(chunk: Chunk): IHDRChunk {
  const width = parseIntFromBuffer(peek(chunk.data, 0, 4).buffer, 32);
  const height = parseIntFromBuffer(peek(chunk.data, 4, 8).buffer, 32);
  const depth = parseIntFromBuffer(peek(chunk.data, 8, 9).buffer, 8);
  const colorType = parseIntFromBuffer(
    peek(chunk.data, 9, 10).buffer,
    8
  ) as COLOR_TYPE;
  const compression = parseIntFromBuffer(peek(chunk.data, 10, 11).buffer, 8);
  const filter = parseIntFromBuffer(peek(chunk.data, 11, 12).buffer, 8);
  const interlace = parseIntFromBuffer(peek(chunk.data, 12, 13).buffer, 8);

  // computed
  const channels = (() => {
    switch (colorType) {
      case COLOR_TYPE.GRAY_SCALE:
        return 1;
      case COLOR_TYPE.GRAY_SCALE_ALPHA:
        return 2;
      case COLOR_TYPE.INDEXED:
        return 1;
      case COLOR_TYPE.TRUE_COLOR:
        return 3;
      case COLOR_TYPE.TRUE_COLOR_ALPHA:
        return 4;
    }
  })();
  const bpp = Math.max(1, (depth * channels) / 8);
  const bpl = bpp * width;

  return {
    type: chunk.type as CHUN_TYPE.IHDR,
    width,
    height,
    depth,
    colorType,
    compression,
    filter,
    interlace,
    channels,
    bpp,
    bpl,
  };
}

// # PLET chunk
//
// - must appear for color type 3 (indexed-color)
// - optional for color type 2 and 6 (truecolor and truecolor with alpha)
// - continas from 1 to 256 palette entries, each a three-byte series of the form:
//
// | color | bytes |
// |-------|-------|
// | red   | 1     |
// | green | 1     |
// | blue  | 1     |
//
// - uses 8 bits (1 byte) per sample regardless of the image bit depth
// - no requirement that the palette entries all be used by the image, nor that they all be different
function decodePLTE(palette: Chunk, tRNS: Chunk, IHDR: IHDRChunk): PLTEChunk {
  const entries: Color[] = [];

  for (let i = 0; i < palette.data.length / 3; i += 1) {
    entries.push({
      red: palette.data[i],
      green: palette.data[i + 1],
      blue: palette.data[i + 2],
      alpha: 1,
    });
  }
  return {
    type: palette.type as CHUN_TYPE.PLTE,
    entries,
  };
}

// Filter types:
//
// | type | name    | filter function               | reconstruction function         |
// | ---- | ------- | ----------------------------- | ------------------------------- |
// | 0    | none    | `Filt(x) = Orig(x)`           | `Recon(x) = Filt(x)`            |
// | 1    | sub     | `Filt(x) = Orig(x) - Orig(a)` | `Recon(x) = Filt(x) + Recon(a)` |
// | 2    | up      | `Filt(x) = Orig(x) - Orig(a)` | `Recon(x) = Filt(x) + Recon(a)` |
// | 3    | average | `Filt(x) = Orig(x) - Orig(a)` | `Recon(x) = Filt(x) + Recon(a)` |
// | 4    | peath   | `Filt(x) = Orig(x) - Orig(a)` | `Recon(x) = Filt(x) + Recon(a)` |
//
// Filters may use the original values of the following bytes to generate the new byte value:
//
// | c | b |
// | a | x |
//
// Filtering before & after:
//
// |   0 0 0 0 |
// | 0 0 0 0 0 |

function decodeIDAT(chunk: Chunk, IHDR: IHDRChunk): IDATChunk {
  const lines: Scanline[] = [];
  const { bpl, bpp, height } = IHDR;

  // break into scanlines
  for (let i = 0; i < height; i += 1) {
    const start = i * (bpl + 1) + 1;
    const end = start + bpl;

    lines.push([chunk.data[start - 1], chunk.data.slice(start, end)]);
  }

  // reconstruction scanlines
  lines.forEach(([type, line], i) => {
    line.forEach((x, j) => {
      // -1 indicate byte does not exists
      const a = j >= bpp ? line[j - bpp] : -1;
      const b = i > 0 ? lines[i - 1][1][j] : -1;
      const c = i > 0 && j >= bpp ? lines[i - 1][1][j - bpp] : -1;

      switch (type) {
        case FILTER_TYPE.NONE:
          break;
        case FILTER_TYPE.SUB:
          if (a !== -1) {
            line[j] = (x + a) & 0xff;
          }
          break;
        case FILTER_TYPE.UP:
          if (b !== -1) {
            line[j] = (x + b) & 0xff;
          }
          break;
        case FILTER_TYPE.AVERAGE:
          if (b === -1 && a !== -1) {
            line[j] = (x + (a >> 1)) & 0xff;
          } else if (b !== -1 && a === -1) {
            line[j] = (x + (b >> 1)) & 0xff;
          } else if (b !== -1 && a !== -1) {
            line[j] = (x + ((a + b) >> 1)) & 0xff;
          }
          break;
        case FILTER_TYPE.PEATH:
          if (b === -1 && a !== -1) {
            line[j] = (x + a) & 0xff;
          } else if (b !== -1 && a === -1) {
            line[j] = (x + b) & 0xff;
          } else if (b !== -1 && a !== -1) {
            line[j] = (x + paethPredictor(a, b, c)) & 0xff;
          }
          break;
      }
    });
  });
  return {
    type: chunk.type as CHUN_TYPE.IDAT,
    lines,
  };
}

export function png(data: Uint8Array) {
  const chunks = decodeChunks(data);
  const IHDRChunk = chunks[0];
  const PLTEChunk = chunks.find(c => c.type === CHUN_TYPE.PLTE);
  const tRNSChunk = chunks.find(c => c.type === CHUN_TYPE.tRNS);
  const IDATChunks = chunks.filter(c => c.type === CHUN_TYPE.IDAT);

  // decode chunks
  const IHDR = decodeIHDR(IHDRChunk);
  const IDAT = decodeIDAT(
    {
      type: CHUN_TYPE.IDAT,
      length: IDATChunks.reduce((acc, c) => acc + c.length, 0),
      data: inflate(
        IDATChunks.reduce((acc, c) => {
          const mergerd = new Uint8Array(acc.length + c.data.length);

          mergerd.set(acc);
          mergerd.set(c.data, acc.length);
          return mergerd;
        }, new Uint8Array(0))
      ),
    },
    IHDR
  );
  const PLTE = PLTEChunk ? decodePLTE(PLTEChunk, tRNSChunk, IHDR) : null;

  // construction pixels
  const { width, colorType, bpp } = IHDR;
  const { lines } = IDAT;
  const pixels: Pixel[] = [];

  lines.forEach(([_, line], row) => {
    for (let i = 0; i < width; i += 1) {
      const position = {
        x: i,
        y: row,
      };

      switch (colorType) {
        case COLOR_TYPE.GRAY_SCALE:
          const [gray] = line.slice(i, i + bpp);

          pixels.push({
            position,
            color: {
              red: gray,
              green: gray,
              blue: gray,
              alpha: 1,
            },
          });
          break;
        case COLOR_TYPE.INDEXED:
          pixels.push({
            color:
              PLTE.entries[
                parseIntFromBuffer(line.slice(i, i + bpp).buffer, 8)
              ],
            position,
          });
          break;
      }
    }
  });
  return {
    IHDR,
    IDAT,
    PLTE,
    pixels,
  };
}

// helpers
function consume(data: Uint8Array, length: number) {
  return data.length < length ? error() : data.slice(length);
}

function peek(data: Uint8Array, start: number, end: number) {
  if (start > end || end > data.length) {
    error();
  }
  return data.slice(start, end);
}

function error(msg: string = 'decode error'): never {
  throw new Error(msg);
}
