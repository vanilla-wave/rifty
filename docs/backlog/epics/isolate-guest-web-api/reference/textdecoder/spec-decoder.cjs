// WHATWG Encoding Standard decoders (non-streaming decode + flush), written from the spec text over
// its pinned `indexes.json`; the probe's spec reference, not a candidate. `decode(name, bytes,
// fatal)` → string, or throws 'T' on the first error when fatal. BOM handling as TextDecoder.
'use strict';
const EOQ = -1;
const isAscii = (b) => b >= 0 && b <= 0x7f;

module.exports = function makeSpec(indexes) {
  const ranges = indexes['gb18030-ranges'];
  const rangesCodePoint = (pointer) => {
    if ((pointer > 39419 && pointer < 189000) || pointer > 1237575) return null;
    if (pointer === 7457) return 0xe7c7;
    if (pointer >= 189000) return 0x10000 + pointer - 189000;
    let lo = 0;
    for (let i = 0; i < ranges.length && ranges[i][0] <= pointer; i++) lo = i;
    return ranges[lo][1] + pointer - ranges[lo][0];
  };

  const singleByte = (index) => () => (b) => {
    if (b === EOQ) return 'finished';
    if (isAscii(b)) return [b];
    const cp = index[b - 0x80];
    return cp == null ? 'error' : [cp];
  };

  const factories = {
    'x-user-defined': () => (b) => {
      if (b === EOQ) return 'finished';
      return isAscii(b) ? [b] : [0xf780 + b - 0x80];
    },
    'utf-16le': () => utf16(false),
    'utf-16be': () => utf16(true),
    'euc-kr': () => {
      let lead = 0;
      return (b, q) => {
        if (b === EOQ && lead !== 0) {
          lead = 0;
          return 'error';
        }
        if (b === EOQ) return 'finished';
        if (lead !== 0) {
          const l = lead;
          lead = 0;
          const pointer = b >= 0x41 && b <= 0xfe ? (l - 0x81) * 190 + (b - 0x41) : null;
          const cp = pointer == null ? null : indexes['euc-kr'][pointer];
          if (cp != null) return [cp];
          if (isAscii(b)) q.unshift(b);
          return 'error';
        }
        if (isAscii(b)) return [b];
        if (b >= 0x81 && b <= 0xfe) {
          lead = b;
          return [];
        }
        return 'error';
      };
    },
    big5: () => {
      let lead = 0;
      return (b, q) => {
        if (b === EOQ && lead !== 0) {
          lead = 0;
          return 'error';
        }
        if (b === EOQ) return 'finished';
        if (lead !== 0) {
          const l = lead;
          let pointer = null;
          lead = 0;
          const offset = b < 0x7f ? 0x40 : 0x62;
          if ((b >= 0x40 && b <= 0x7e) || (b >= 0xa1 && b <= 0xfe))
            pointer = (l - 0x81) * 157 + (b - offset);
          if (pointer === 1133) return [0xca, 0x304];
          if (pointer === 1135) return [0xca, 0x30c];
          if (pointer === 1164) return [0xea, 0x304];
          if (pointer === 1166) return [0xea, 0x30c];
          const cp = pointer == null ? null : indexes.big5[pointer];
          if (cp != null) return [cp];
          if (isAscii(b)) q.unshift(b);
          return 'error';
        }
        if (isAscii(b)) return [b];
        if (b >= 0x81 && b <= 0xfe) {
          lead = b;
          return [];
        }
        return 'error';
      };
    },
    shift_jis: () => {
      let lead = 0;
      return (b, q) => {
        if (b === EOQ && lead !== 0) {
          lead = 0;
          return 'error';
        }
        if (b === EOQ) return 'finished';
        if (lead !== 0) {
          const l = lead;
          let pointer = null;
          lead = 0;
          const offset = b < 0x7f ? 0x40 : 0x41;
          const leadOffset = l < 0xa0 ? 0x81 : 0xc1;
          if ((b >= 0x40 && b <= 0x7e) || (b >= 0x80 && b <= 0xfc))
            pointer = (l - leadOffset) * 188 + b - offset;
          if (pointer != null && pointer >= 8836 && pointer <= 10715)
            return [0xe000 - 8836 + pointer];
          const cp = pointer == null ? null : indexes.jis0208[pointer];
          if (cp != null) return [cp];
          if (isAscii(b)) q.unshift(b);
          return 'error';
        }
        if (isAscii(b) || b === 0x80) return [b];
        if (b >= 0xa1 && b <= 0xdf) return [0xff61 - 0xa1 + b];
        if ((b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc)) {
          lead = b;
          return [];
        }
        return 'error';
      };
    },
    'euc-jp': () => {
      let lead = 0;
      let jis0212 = false;
      return (b, q) => {
        if (b === EOQ && lead !== 0) {
          lead = 0;
          return 'error';
        }
        if (b === EOQ) return 'finished';
        if (lead === 0x8e && b >= 0xa1 && b <= 0xdf) {
          lead = 0;
          return [0xff61 - 0xa1 + b];
        }
        if (lead === 0x8f && b >= 0xa1 && b <= 0xfe) {
          jis0212 = true;
          lead = b;
          return [];
        }
        if (lead !== 0) {
          const l = lead;
          lead = 0;
          let cp = null;
          if (l >= 0xa1 && l <= 0xfe && b >= 0xa1 && b <= 0xfe)
            cp = (jis0212 ? indexes.jis0212 : indexes.jis0208)[(l - 0xa1) * 94 + b - 0xa1];
          jis0212 = false;
          if (cp != null) return [cp];
          if (isAscii(b)) q.unshift(b);
          return 'error';
        }
        if (isAscii(b)) return [b];
        if (b === 0x8e || b === 0x8f || (b >= 0xa1 && b <= 0xfe)) {
          lead = b;
          return [];
        }
        return 'error';
      };
    },
    gb18030: () => {
      let first = 0;
      let second = 0;
      let third = 0;
      return (b, q) => {
        if (b === EOQ && first === 0 && second === 0 && third === 0) return 'finished';
        if (b === EOQ) {
          first = second = third = 0;
          return 'error';
        }
        if (third !== 0) {
          if (!(b >= 0x30 && b <= 0x39)) {
            q.unshift(second, third, b);
            first = second = third = 0;
            return 'error';
          }
          const cp = rangesCodePoint(
            (first - 0x81) * 12600 + (second - 0x30) * 1260 + (third - 0x81) * 10 + b - 0x30,
          );
          first = second = third = 0;
          return cp == null ? 'error' : [cp];
        }
        if (second !== 0) {
          if (b >= 0x81 && b <= 0xfe) {
            third = b;
            return [];
          }
          q.unshift(second, b);
          first = second = 0;
          return 'error';
        }
        if (first !== 0) {
          if (b >= 0x30 && b <= 0x39) {
            second = b;
            return [];
          }
          const l = first;
          let pointer = null;
          first = 0;
          const offset = b < 0x7f ? 0x40 : 0x41;
          if ((b >= 0x40 && b <= 0x7e) || (b >= 0x80 && b <= 0xfe))
            pointer = (l - 0x81) * 190 + (b - offset);
          const cp = pointer == null ? null : indexes.gb18030[pointer];
          if (cp != null) return [cp];
          if (isAscii(b)) q.unshift(b);
          return 'error';
        }
        if (isAscii(b)) return [b];
        if (b === 0x80) return [0x20ac];
        if (b >= 0x81 && b <= 0xfe) {
          first = b;
          return [];
        }
        return 'error';
      };
    },
    'iso-2022-jp': () => {
      let state = 'ascii';
      let outState = 'ascii';
      let lead = 0;
      let output = false;
      return (b, q) => {
        switch (state) {
          case 'ascii':
            if (b === 0x1b) {
              state = 'escStart';
              return [];
            }
            if (b >= 0 && b <= 0x7f && b !== 0x0e && b !== 0x0f) {
              output = false;
              return [b];
            }
            if (b === EOQ) return 'finished';
            output = false;
            return 'error';
          case 'roman':
            if (b === 0x1b) {
              state = 'escStart';
              return [];
            }
            if (b === 0x5c) {
              output = false;
              return [0xa5];
            }
            if (b === 0x7e) {
              output = false;
              return [0x203e];
            }
            if (b >= 0 && b <= 0x7f && b !== 0x0e && b !== 0x0f) {
              output = false;
              return [b];
            }
            if (b === EOQ) return 'finished';
            output = false;
            return 'error';
          case 'katakana':
            if (b === 0x1b) {
              state = 'escStart';
              return [];
            }
            if (b >= 0x21 && b <= 0x5f) {
              output = false;
              return [0xff61 - 0x21 + b];
            }
            if (b === EOQ) return 'finished';
            output = false;
            return 'error';
          case 'lead':
            if (b === 0x1b) {
              state = 'escStart';
              return [];
            }
            if (b >= 0x21 && b <= 0x7e) {
              output = false;
              lead = b;
              state = 'trail';
              return [];
            }
            if (b === EOQ) return 'finished';
            output = false;
            return 'error';
          case 'trail': {
            if (b === 0x1b) {
              state = 'escStart';
              return 'error';
            }
            if (b >= 0x21 && b <= 0x7e) {
              state = 'lead';
              const cp = indexes.jis0208[(lead - 0x21) * 94 + b - 0x21];
              return cp == null ? 'error' : [cp];
            }
            if (b === EOQ) {
              state = 'lead';
              q.unshift(EOQ);
              return 'error';
            }
            state = 'lead';
            return 'error';
          }
          case 'escStart':
            if (b === 0x24 || b === 0x28) {
              lead = b;
              state = 'esc';
              return [];
            }
            q.unshift(b);
            output = false;
            state = outState;
            return 'error';
          case 'esc': {
            const l = lead;
            lead = 0;
            let next = null;
            if (l === 0x28 && b === 0x42) next = 'ascii';
            else if (l === 0x28 && b === 0x4a) next = 'roman';
            else if (l === 0x28 && b === 0x49) next = 'katakana';
            else if (l === 0x24 && (b === 0x40 || b === 0x42)) next = 'lead';
            if (next !== null) {
              state = outState = next;
              const was = output;
              output = true;
              return was ? 'error' : [];
            }
            if (b === EOQ) q.unshift(l);
            else q.unshift(l, b);
            output = false;
            state = outState;
            return 'error';
          }
        }
        throw new Error('unreachable');
      };
    },
  };
  for (const name of Object.keys(indexes)) {
    if (/^(ibm866|iso-8859-|koi8-|macintosh|windows-|x-mac-cyrillic)/.test(name))
      factories[name] = singleByte(indexes[name]);
  }
  factories['iso-8859-8-i'] = singleByte(indexes['iso-8859-8']);
  factories.gbk = factories.gb18030;

  function utf16(be) {
    let leadByte = null;
    let leadSurrogate = null;
    return (b, q) => {
      if (b === EOQ && (leadByte !== null || leadSurrogate !== null)) {
        leadByte = leadSurrogate = null;
        return 'error';
      }
      if (b === EOQ) return 'finished';
      if (leadByte === null) {
        leadByte = b;
        return [];
      }
      const cu = be ? (leadByte << 8) + b : (b << 8) + leadByte;
      leadByte = null;
      if (leadSurrogate !== null) {
        const ls = leadSurrogate;
        leadSurrogate = null;
        if (cu >= 0xdc00 && cu <= 0xdfff) return [0x10000 + ((ls - 0xd800) << 10) + (cu - 0xdc00)];
        const b1 = cu >> 8;
        const b2 = cu & 0xff;
        if (be) q.unshift(b1, b2);
        else q.unshift(b2, b1);
        return 'error';
      }
      if (cu >= 0xd800 && cu <= 0xdbff) {
        leadSurrogate = cu;
        return [];
      }
      if (cu >= 0xdc00 && cu <= 0xdfff) return 'error';
      return [cu];
    };
  }

  return {
    names: Object.keys(factories),
    decode(name, bytes, fatal, ignoreBOM = false) {
      const handler = factories[name]();
      const q = Array.from(bytes);
      const out = [];
      for (;;) {
        const b = q.length ? q.shift() : EOQ;
        const r = handler(b, q);
        if (r === 'finished') break;
        if (r === 'error') {
          if (fatal) throw 'T';
          out.push(0xfffd);
        } else out.push(...r);
      }
      if (!ignoreBOM && /^utf-16/.test(name) && out[0] === 0xfeff) out.shift();
      return String.fromCodePoint(...out);
    },
  };
};
