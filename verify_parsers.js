// Mirror the parsers from index.html exactly, then drive them with the
// same fixture files that backed the (now-closed) frontend PRs #12114
// and #12115 plus the fresh #653 audio-mux outputs. Exercising the same
// shapes end-users will see.

"use strict";

const fs = require("fs");

// --- copy of index.html's parsers, verbatim ----------------------------------

const ASCII_OPEN_BRACE = 0x7b;
const ASCII_QUOTE = 0x22;
const ASCII_NULL = 0;
const BOX = {
  USER_DATA: [0x75, 0x64, 0x74, 0x61], META_DATA: [0x6d, 0x65, 0x74, 0x61],
  ITEM_LIST: [0x69, 0x6c, 0x73, 0x74], KEYS: [0x6b, 0x65, 0x79, 0x73],
  DATA: [0x64, 0x61, 0x74, 0x61], MOVIE: [0x6d, 0x6f, 0x6f, 0x76],
};
const SIZE = { HEADER: 8, VERSION: 4, LOCALE: 4, ITEM_MIN: 8 };

function bufMatches(data, pos, target) {
  if (pos + target.length > data.length) return false;
  for (let i = 0; i < target.length; i++) if (data[pos + i] !== target[i]) return false;
  return true;
}
function readU32(data, pos) {
  if (pos + 4 > data.length) return 0;
  return ((data[pos] << 24) | (data[pos+1] << 16) | (data[pos+2] << 8) | data[pos+3]) >>> 0;
}
function findBox(data, start, end, target) {
  for (let pos = start; pos < end - 8; pos++) {
    const size = readU32(data, pos);
    if (size < SIZE.ITEM_MIN) continue;
    if (bufMatches(data, pos + 4, target)) return { start: pos + SIZE.HEADER, end: pos + size };
    if (pos + size > end) return null;
    pos += size - 1;
  }
  return null;
}
function readUtf8(data, start, end) { return new TextDecoder().decode(data.subarray(start, end)); }
function unwrapStringifiedJson(text) {
  if (!text.startsWith("\"")) return null;
  try {
    const inner = JSON.parse(text);
    if (typeof inner !== "string") return null;
    const parsed = JSON.parse(inner);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch { return null; }
}
function extractIsobmffJson(data, start, end) {
  let p = start;
  while (p < end && data[p] !== ASCII_OPEN_BRACE && data[p] !== ASCII_QUOTE) p++;
  if (p >= end) return null;
  try {
    const text = new TextDecoder().decode(data.subarray(p, end));
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") {
      const inner = JSON.parse(parsed);
      return typeof inner === "object" && inner !== null ? inner : null;
    }
    return parsed;
  } catch { return null; }
}
function parseKeysBox(data, start, end) {
  const map = new Map();
  let p = start + SIZE.VERSION;
  if (p + 4 > end) return map;
  const count = readU32(data, p);
  p += 4;
  for (let i = 1; i <= count; i++) {
    if (p + SIZE.HEADER > end) break;
    const sz = readU32(data, p);
    p += SIZE.HEADER;
    const nameEnd = p + sz - SIZE.HEADER;
    if (sz < SIZE.ITEM_MIN || nameEnd > end) break;
    map.set(i, readUtf8(data, p, nameEnd));
    p = nameEnd;
  }
  return map;
}
function parseIsobmffMetadata(data) {
  let udta = findBox(data, 0, data.length, BOX.USER_DATA);
  if (!udta) {
    const moov = findBox(data, 0, data.length, BOX.MOVIE);
    if (moov) udta = findBox(data, moov.start, moov.end, BOX.USER_DATA);
  }
  if (!udta) return {};
  const meta = findBox(data, udta.start, udta.end, BOX.META_DATA);
  if (!meta) return {};
  const metaContent = meta.start + SIZE.VERSION;
  const keysBox = findBox(data, metaContent, meta.end, BOX.KEYS);
  if (!keysBox) return {};
  const keysMap = parseKeysBox(data, keysBox.start, keysBox.end);
  const ilstBox = findBox(data, metaContent, meta.end, BOX.ITEM_LIST);
  if (!ilstBox) return {};
  const out = {};
  let p = ilstBox.start;
  while (p < ilstBox.end - SIZE.HEADER) {
    const itemSize = readU32(data, p);
    if (itemSize <= SIZE.HEADER || p + itemSize > ilstBox.end) break;
    const itemStart = p, itemEnd = p + itemSize;
    const idx = readU32(data, itemStart + 4);
    const name = keysMap.get(idx);
    if (name) {
      const dataBox = findBox(data, itemStart + SIZE.HEADER, itemEnd, BOX.DATA);
      if (dataBox) {
        const valStart = dataBox.start + SIZE.VERSION + SIZE.LOCALE;
        if (valStart < dataBox.end) {
          const value = extractIsobmffJson(data, valStart, dataBox.end);
          if (value !== null) out[name.toLowerCase()] = value;
        }
      }
    }
    p += itemSize;
  }
  return out;
}

const WEBM_SIGNATURE = [0x1a, 0x45, 0xdf, 0xa3];
const TAG_NAME = Uint8Array.from([0x45, 0xa3]);
const TAG_VALUE = Uint8Array.from([0x44, 0x87]);
const SIMPLE_TAG = Uint8Array.from([0x67, 0xc8]);
function hasWebmSig(data) { return WEBM_SIGNATURE.every((b, i) => data[i] === b); }
function firstSetBitPos(byte) {
  for (let mask = 0x80, pos = 1; mask !== 0; mask >>= 1, pos++) if ((byte & mask) !== 0) return pos;
  return 0;
}
function readVint(data, pos) {
  if (pos >= data.length) return null;
  const b = data[pos];
  if ((b & 0x80) === 0x80) return { value: b & 0x7f, length: 1 };
  const len = firstSetBitPos(b);
  if (len === 0 || pos + len > data.length) return null;
  let v = data[pos] & (0xff >> len);
  for (let i = 1; i < len; i++) v = (v << 8) | data[pos + i];
  return { value: v, length: len };
}
function matchesId(data, pos, id) {
  if (pos + id.length > data.length) return false;
  for (let i = 0; i < id.length; i++) if (data[pos + i] !== id[i]) return false;
  return true;
}
function findNull(data, start, maxLen) {
  const end = Math.min(start + maxLen, data.length);
  for (let p = start; p < end; p++) if (data[p] === ASCII_NULL) return p;
  return end;
}
function findJsonStart(data, start, len) {
  for (let p = start; p < start + len; p++) if (data[p] === ASCII_OPEN_BRACE) return p;
  return null;
}
function findJsonEnd(text) {
  let bc = 1, p = 1;
  while (bc > 0 && p < text.length) {
    if (text[p] === "{") bc++;
    if (text[p] === "}") bc--;
    p++;
  }
  return bc === 0 ? p : null;
}
function readEbmlJson(data, start, len) {
  if (len <= 0) return null;
  const nullEnd = findNull(data, start, len);
  const fullText = new TextDecoder().decode(data.subarray(start, nullEnd)).trim();
  const unwrapped = unwrapStringifiedJson(fullText);
  if (unwrapped !== null) return unwrapped;
  const jsStart = findJsonStart(data, start, nullEnd - start);
  if (jsStart === null) return null;
  const text = new TextDecoder().decode(data.subarray(jsStart, nullEnd));
  const jsEnd = findJsonEnd(text);
  if (jsEnd === null) return null;
  try { return JSON.parse(text.substring(0, jsEnd)); } catch { return null; }
}
function parseEbmlMetadata(data) {
  if (data.length < 4 || !hasWebmSig(data)) return {};
  const out = {};
  let pos = 0;
  while (pos < data.length - 4) {
    if (matchesId(data, pos, SIMPLE_TAG)) {
      pos += SIMPLE_TAG.length;
      const sz = readVint(data, pos); if (!sz) { pos++; continue; }
      pos += sz.length;
      const tagEnd = pos + sz.value;
      let name = null, valuePos = -1, valueLen = -1;
      while (pos < tagEnd - 2) {
        if (matchesId(data, pos, TAG_NAME)) {
          pos += TAG_NAME.length;
          const ln = readVint(data, pos); if (!ln) break;
          pos += ln.length;
          name = new TextDecoder().decode(data.subarray(pos, pos + ln.value)).trim();
          pos += ln.value;
        } else if (matchesId(data, pos, TAG_VALUE)) {
          pos += TAG_VALUE.length;
          const lv = readVint(data, pos); if (!lv) break;
          pos += lv.length;
          valuePos = pos; valueLen = lv.value;
          pos += lv.value;
        } else pos++;
      }
      if (name && valuePos >= 0) {
        const lower = name.toLowerCase();
        if (lower === "prompt" || lower === "workflow") {
          const parsed = readEbmlJson(data, valuePos, valueLen);
          if (parsed !== null) out[lower] = parsed;
        }
      }
      pos = tagEnd;
    } else pos++;
  }
  return out;
}

// --- fixtures ---------------------------------------------------------------

const FX_BASE = "C:/Users/cbosc/AppData/Local/Temp/comfy-frontend/src/scripts/metadata/__fixtures__";
const WORK = "C:/tmp/vhs-test";

const fixtures = [
  ["MP4 well-formed (current shape)",            `${FX_BASE}/with_metadata.mp4`,           "isobmff", { wantPrompt: true, wantWorkflow: true }],
  ["MP4 legacy double-stringified (pre-#672)",   `${WORK}/legacy.mp4`,                     "isobmff", { wantPrompt: true, wantWorkflow: true }],
  ["MP4 triple-encoded (should reject)",         `${WORK}/triple.mp4`,                     "isobmff", { wantPrompt: false, wantWorkflow: false }],
  ["WebM well-formed",                           `${FX_BASE}/with_metadata.webm`,          "ebml",    { wantPrompt: true, wantWorkflow: true }],
  ["WebM legacy double-stringified (pre-#672)",  `${FX_BASE}/with_legacy_metadata.webm`,   "ebml",    { wantPrompt: true, wantWorkflow: true }],
  ["MP4 no-audio intermediate (audio mux not yet run)", `${WORK}/653_no_audio.mp4`,        "isobmff", { wantPrompt: true, wantWorkflow: true }],
  ["MP4 with-audio PRE-#653 (atom stripped at write)",  `${WORK}/653_with_audio_prefix.mp4`,  "isobmff", { wantPrompt: false, wantWorkflow: false }],
  ["MP4 with-audio POST-#653 (atom preserved)",         `${WORK}/653_with_audio_postfix.mp4`, "isobmff", { wantPrompt: true, wantWorkflow: true }],
];

let failed = 0;
for (const [label, path, kind, expect] of fixtures) {
  if (!fs.existsSync(path)) { console.log(`  SKIP  ${label} (no fixture)`); continue; }
  const data = new Uint8Array(fs.readFileSync(path));
  const got = kind === "isobmff" ? parseIsobmffMetadata(data) : parseEbmlMetadata(data);
  const hasPrompt = !!got.prompt;
  const hasWorkflow = !!got.workflow;
  const ok = hasPrompt === expect.wantPrompt && hasWorkflow === expect.wantWorkflow;
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  console.log(`        prompt=${hasPrompt} (expect ${expect.wantPrompt})  workflow=${hasWorkflow} (expect ${expect.wantWorkflow})`);
}
process.exit(failed === 0 ? 0 : 1);
