// ROM Hacks: patch formats (BPS, IPS, UPS, PPF, APS, xdelta), the RAPatches search, and the panel
// in the game profile. Disc images are patched by the app itself (DiscPatcher.java).
// BPS and IPS are written from their specs; PPF, APS and xdelta follow JoeyOS's approach (used with
// Joey's permission) and RFC 3284.

// Checksums

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for(let n = 0; n < 256; n++){
    let c = n;
    for(let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes){
  let c = 0xFFFFFFFF;
  for(let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function crc32Hex(bytes){ return crc32(bytes).toString(16).padStart(8, '0'); }
const readU32LEAt = (b, off) => (b[off] | (b[off+1] << 8) | (b[off+2] << 16) | (b[off+3] << 24)) >>> 0;

// MD5 (RFC 1321), to compare a patched ROM with the hashes RetroAchievements knows.
function md5Hex(bytes){
  const rotl = (x, c) => (x << c) | (x >>> (32 - c));
  const s = [
    7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
    5, 9,14,20, 5, 9,14,20, 5, 9,14,20, 5, 9,14,20,
    4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
    6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21
  ];
  const K = new Int32Array(64);
  for(let i = 0; i < 64; i++) K[i] = (Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)) | 0;

  const msgLen = bytes.length;
  const padLen = Math.ceil((msgLen + 9) / 64) * 64;
  const padded = new Uint8Array(padLen);
  padded.set(bytes);
  padded[msgLen] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 8, (msgLen * 8) >>> 0, true);
  dv.setUint32(padLen - 4, Math.floor(msgLen / 0x20000000), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for(let off = 0; off < padLen; off += 64){
    const M = new Int32Array(16);
    for(let j = 0; j < 16; j++) M[j] = dv.getInt32(off + j*4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for(let i = 0; i < 64; i++){
      let F, g;
      if(i < 16){ F = (B & C) | (~B & D); g = i; }
      else if(i < 32){ F = (D & B) | (~D & C); g = (5*i + 1) % 16; }
      else if(i < 48){ F = B ^ C ^ D; g = (3*i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7*i) % 16; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, s[i])) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const toHexLE = (n) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, n, true);
    return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
  };
  return toHexLE(a0) + toHexLE(b0) + toHexLE(c0) + toHexLE(d0);
}

// N64 dumps come in three byte orders: .z64 (what patches and RA use), .v64 (every 2 bytes swapped)
// and .n64 (every 4 bytes reversed). Returns { bytes, converted } in .z64 order.
function n64ToBigEndian(bytes){
  if(!bytes || bytes.length < 4) return { bytes, converted: null };
  const [a, b, c, d] = bytes;
  if(a === 0x37 && b === 0x80 && c === 0x40 && d === 0x12){ // .v64
    const out = new Uint8Array(bytes.length);
    for(let i = 0; i + 1 < bytes.length; i += 2){ out[i] = bytes[i+1]; out[i+1] = bytes[i]; }
    if(bytes.length % 2) out[bytes.length - 1] = bytes[bytes.length - 1];
    return { bytes: out, converted: 'v64' };
  }
  if(a === 0x40 && b === 0x12 && c === 0x37 && d === 0x80){ // .n64
    const out = new Uint8Array(bytes.length);
    for(let i = 0; i + 3 < bytes.length; i += 4){ out[i] = bytes[i+3]; out[i+1] = bytes[i+2]; out[i+2] = bytes[i+1]; out[i+3] = bytes[i]; }
    for(let i = bytes.length - (bytes.length % 4); i < bytes.length; i++) out[i] = bytes[i];
    return { bytes: out, converted: 'n64' };
  }
  return { bytes, converted: null };
}

// RA's hash for a ROM: NES and SNES without their headers, N64 in .z64 order, anything else as is.
function raRomHash(consoleName, bytes){
  const norm = normalizeForMatch(consoleName);
  if(norm.includes('nintendo entertainment system') || norm.includes('famicom') || /(^| )nes( |$)/.test(norm)){
    if(bytes.length > 16 && bytes[0] === 0x4E && bytes[1] === 0x45 && bytes[2] === 0x53 && bytes[3] === 0x1A) return md5Hex(bytes.subarray(16));
  }else if(norm.includes('super nintendo') || norm.includes('super famicom') || /(^| )snes( |$)/.test(norm)){
    if(bytes.length % 0x8000 === 512) return md5Hex(bytes.subarray(512));
  }else if(norm.includes('nintendo 64') || /(^| )n64( |$)/.test(norm)){
    return md5Hex(n64ToBigEndian(bytes).bytes);
  }
  return md5Hex(bytes);
}

// Checks a patched ROM against RA's known hashes for the game. This is the only check an IPS result
// gets. A failed lookup reports "unknown", never a mismatch.
async function verifyAgainstRaHash(targetGameId, targetBytes, consoleName){
  try{
    const data = await raFetch('API_GetGameHashes.php', { i: targetGameId });
    const list = (data && (data.Results || data.results)) || [];
    const known = list.map(r => String(r.MD5 || r.Md5 || r.Hash || r.hash || '').toLowerCase()).filter(Boolean);
    if(!known.length){
      return { cls: 'unknown', text: "RetroAchievements has no hash on file for this game to check against, so the result wasn't verified." };
    }
    const hash = raRomHash(consoleName, targetBytes);
    if(known.includes(hash)){
      return { cls: 'ok', text: 'Matches a hash RetroAchievements has for this game, so achievements should unlock normally.' };
    }
    return { cls: 'mismatch', text: `Doesn't match any hash RetroAchievements has for this game (got ${hash}), so achievements may not unlock. This happens with a different revision or region than RA expects, or the wrong patch.` };
  }catch(e){
    return { cls: 'unknown', text: "Couldn't check the result against RetroAchievements, so it wasn't verified." };
  }
}

// Patch formats. Every function returns { target } (BPS and UPS add targetMatches).

function readVLQ(bytes, pos){
  let data = 0, shift = 1;
  for(;;){
    const x = bytes[pos.i++];
    if(x === undefined) throw new Error('Unexpected end of patch file.');
    data += (x & 0x7f) * shift;
    if(x & 0x80) break;
    shift <<= 7;
    data += shift;
  }
  return data;
}

function applyBps(p, source){
  if(p.length < 16 || p[0] !== 0x42 || p[1] !== 0x50 || p[2] !== 0x53 || p[3] !== 0x31){
    throw new Error('Not a valid BPS patch (missing "BPS1" header).');
  }
  const footerStart = p.length - 12;
  const pos = { i: 4 };
  readVLQ(p, pos); // source size
  const targetSize = readVLQ(p, pos);
  const metadataLength = readVLQ(p, pos);
  pos.i += metadataLength;

  const target = new Uint8Array(targetSize);
  let outOff = 0, srcRel = 0, tgtRel = 0;
  while(pos.i < footerStart){
    const data = readVLQ(p, pos);
    const action = data & 3;
    const length = (data >>> 2) + 1;
    if(outOff + length > targetSize) throw new Error('This patch is malformed (writes past the expected output size).');

    if(action === 0){ // same bytes from the source
      if(outOff + length > source.length) throw new Error("This patch doesn't match your base ROM (it reads past the end of it).");
      for(let n = 0; n < length; n++) target[outOff + n] = source[outOff + n];
    }else if(action === 1){ // bytes stored in the patch
      if(pos.i + length > footerStart) throw new Error('This patch is malformed (ran out of data).');
      for(let n = 0; n < length; n++) target[outOff + n] = p[pos.i + n];
      pos.i += length;
    }else if(action === 2){ // copy from elsewhere in the source
      const rel = readVLQ(p, pos);
      srcRel += (rel & 1) ? -(rel >>> 1) : (rel >>> 1);
      if(srcRel < 0 || srcRel + length > source.length) throw new Error("This patch doesn't match your base ROM (source offset out of range).");
      for(let n = 0; n < length; n++) target[outOff + n] = source[srcRel + n];
      srcRel += length;
    }else{ // copy from what's already written (can overlap, for runs)
      const rel = readVLQ(p, pos);
      tgtRel += (rel & 1) ? -(rel >>> 1) : (rel >>> 1);
      if(tgtRel < 0 || tgtRel >= outOff) throw new Error('This patch is malformed (target offset out of range).');
      for(let n = 0; n < length; n++) target[outOff + n] = target[tgtRel++];
    }
    outOff += length;
  }
  if(outOff !== targetSize) throw new Error("This patch didn't produce the expected output size.");
  return { target, targetMatches: crc32(target) === readU32LEAt(p, footerStart + 4) };
}

// IPS has no checksums, so a wrong base ROM can't be caught.
function applyIps(p, source){
  if(p.length < 5 || String.fromCharCode(p[0], p[1], p[2], p[3], p[4]) !== 'PATCH'){
    throw new Error('Not a valid IPS patch (missing "PATCH" header).');
  }
  let target = new Uint8Array(source);
  const grow = (end) => { if(end > target.length){ const g = new Uint8Array(end); g.set(target); target = g; } };
  let i = 5;
  while(i + 3 <= p.length){
    const b0 = p[i], b1 = p[i+1], b2 = p[i+2];
    if(b0 === 0x45 && b1 === 0x4F && b2 === 0x46){ i += 3; break; } // "EOF"
    const offset = (b0 << 16) | (b1 << 8) | b2;
    i += 3;
    if(i + 2 > p.length) throw new Error('This patch is malformed (truncated record).');
    const length = (p[i] << 8) | p[i+1];
    i += 2;
    if(length === 0){ // run of one byte
      if(i + 3 > p.length) throw new Error('This patch is malformed (truncated RLE record).');
      const runLen = (p[i] << 8) | p[i+1];
      const value = p[i+2];
      i += 3;
      grow(offset + runLen);
      target.fill(value, offset, offset + runLen);
    }else{
      if(i + length > p.length) throw new Error('This patch is malformed (truncated data record).');
      grow(offset + length);
      target.set(p.subarray(i, i + length), offset);
      i += length;
    }
  }
  if(i + 3 === p.length){ // optional size to cut the result to
    const truncTo = (p[i] << 16) | (p[i+1] << 8) | p[i+2];
    if(truncTo <= target.length) target = target.subarray(0, truncTo);
  }
  return { target };
}

// UPS: runs of XOR bytes on a copy of the source, with BPS's checksum footer.
function applyUps(p, source){
  if(p.length < 16 || p[0] !== 0x55 || p[1] !== 0x50 || p[2] !== 0x53 || p[3] !== 0x31){
    throw new Error('Not a valid UPS patch (missing "UPS1" header).');
  }
  const footerStart = p.length - 12;
  const pos = { i: 4 };
  readVLQ(p, pos); // source size
  const targetSize = readVLQ(p, pos);
  const target = new Uint8Array(targetSize);
  target.set(source.subarray(0, Math.min(source.length, targetSize)));

  let outOff = 0;
  while(pos.i < footerStart){
    outOff += readVLQ(p, pos);
    while(pos.i < footerStart){
      const b = p[pos.i++];
      if(b === 0){ outOff++; break; }
      if(outOff < target.length) target[outOff] ^= b;
      outOff++;
    }
  }
  return { target, targetMatches: crc32(target) === readU32LEAt(p, footerStart + 4) };
}

// Reads a patch with bounds checks (a typed array returns 0 past its end instead of failing).
function makeCursor(bytes, pos){
  return {
    bytes, pos,
    u8(){ if(this.pos >= this.bytes.length) throw new Error('This patch is truncated.'); return this.bytes[this.pos++]; },
    u32le(){ const a = this.u8(), b = this.u8(), c = this.u8(), d = this.u8(); return (a | (b << 8) | (c << 16) | (d << 24)) >>> 0; },
    u32be(){ const a = this.u8(), b = this.u8(), c = this.u8(), d = this.u8(); return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0; },
    read7Bit(){ let num = 0; for(;;){ const bits = this.u8(); num = num * 128 + (bits & 0x7f); if(!(bits & 0x80)) break; } return num; }, // VCDIFF integer
  };
}
const asciiAt = (b, i, str) => { for(let k = 0; k < str.length; k++) if(b[i + k] !== str.charCodeAt(k)) return false; return true; };

// PPF 1-3: bytes written at absolute offsets. No source checksum; undo data is skipped.
function applyPpf(patch, rom){
  if(patch.length < 58 || !asciiAt(patch, 0, 'PPF')) throw new Error('This is not a valid PPF patch.');
  const version = Math.floor(parseInt(String.fromCharCode(patch[3], patch[4]), 10) / 10);
  if(!version || version !== patch[5] + 1 || version > 3) throw new Error('This PPF version is not supported.');
  const c = makeCursor(patch, 6);
  c.pos += 50; // description
  let undoData = false, blockCheck = false;
  if(version === 3){ c.pos += 1; blockCheck = c.u8() !== 0; undoData = c.u8() !== 0; c.pos += 1; }
  else if(version === 2){ blockCheck = true; c.pos += 4; }
  if(blockCheck) c.pos += 1024;
  const records = [];
  let maxEnd = rom.length;
  while(c.pos + (version === 3 ? 9 : 5) <= patch.length){
    if(c.pos + 4 <= patch.length && asciiAt(patch, c.pos, '@BEG')) break; // FILE_ID.DIZ ends the records
    let offset;
    if(version === 3){ const lo = c.u32le(), hi = c.u32le(); offset = lo + hi * 0x100000000; }
    else offset = c.u32le();
    const len = c.u8();
    if(offset > 0x7fffffff) throw new Error('This PPF patch addresses past the supported size.');
    if(c.pos + len > patch.length) throw new Error('This PPF patch is truncated.');
    records.push({ offset, at: c.pos, len });
    c.pos += len;
    if(undoData) c.pos += len;
    maxEnd = Math.max(maxEnd, offset + len);
  }
  const out = new Uint8Array(maxEnd);
  out.set(rom);
  for(const r of records) out.set(patch.subarray(r.at, r.at + r.len), r.offset);
  return { target: out };
}

// APS: two unrelated formats share the extension (N64 and GBA).
function applyAps(patch, rom){
  if(asciiAt(patch, 0, 'APS10')) return applyApsN64(patch, rom);
  if(asciiAt(patch, 0, 'APS1')) return applyApsGba(patch, rom);
  throw new Error('This is not a valid APS patch.');
}
function applyApsN64(patch, rom){
  const c = makeCursor(patch, 5);
  const headerType = c.u8();
  c.pos += 1 + 50; // encoding, description
  if(headerType === 1) c.pos += 1 + 3 + 8 + 5; // format, cart id, crc, padding
  const outputSize = c.u32le();
  if(outputSize > 0x7fffffff) throw new Error('This APS patch is not supported.');
  const out = new Uint8Array(outputSize);
  out.set(rom.subarray(0, Math.min(rom.length, outputSize)));
  while(c.pos + 5 <= patch.length){
    const offset = c.u32le();
    const length = c.u8();
    if(length === 0){
      const value = c.u8(), runLength = c.u8();
      for(let i = 0; i < runLength; i++) if(offset + i < out.length) out[offset + i] = value;
    }else{
      for(let i = 0; i < length; i++) if(c.pos + i < patch.length && offset + i < out.length) out[offset + i] = patch[c.pos + i];
      c.pos += length;
    }
  }
  return { target: out };
}
function applyApsGba(patch, rom){
  const block = 0x10000, recordSize = 4 + 2 + 2 + block;
  if(patch.length < 12 + recordSize || (patch.length - 12) % recordSize !== 0) throw new Error('This APS patch is truncated.');
  const c = makeCursor(patch, 4);
  const sourceSize = c.u32le(), targetSize = c.u32le();
  if(rom.length !== sourceSize) throw new Error('This patch is for a different ROM than the one chosen.');
  const out = new Uint8Array(targetSize);
  out.set(rom.subarray(0, Math.min(rom.length, targetSize)));
  while(c.pos < patch.length){
    const offset = c.u32le();
    c.pos += 4; // CRC16s, not checked
    for(let j = 0; j < block; j++){
      const base = offset + j < rom.length ? rom[offset + j] : 0;
      if(offset + j < out.length) out[offset + j] = base ^ patch[c.pos + j];
    }
    c.pos += block;
  }
  return { target: out };
}

// xdelta / VCDIFF (RFC 3284) with the default code table and no extra compression. A window's
// Adler-32, when present, catches a wrong base ROM.
const VCD_NOOP = 0, VCD_ADD = 1, VCD_RUN = 2, VCD_COPY = 3;
const VCD_CODE_TABLE = (() => {
  const empty = { type: VCD_NOOP, size: 0, mode: 0 };
  const t = [];
  t.push([{ type: VCD_RUN, size: 0, mode: 0 }, empty]);
  for(let size = 0; size < 18; size++) t.push([{ type: VCD_ADD, size, mode: 0 }, empty]);
  for(let mode = 0; mode < 9; mode++){
    t.push([{ type: VCD_COPY, size: 0, mode }, empty]);
    for(let size = 4; size < 19; size++) t.push([{ type: VCD_COPY, size, mode }, empty]);
  }
  for(let mode = 0; mode < 6; mode++) for(let add = 1; add < 5; add++) for(let copy = 4; copy < 7; copy++)
    t.push([{ type: VCD_ADD, size: add, mode: 0 }, { type: VCD_COPY, size: copy, mode }]);
  for(let mode = 6; mode < 9; mode++) for(let add = 1; add < 5; add++)
    t.push([{ type: VCD_ADD, size: add, mode: 0 }, { type: VCD_COPY, size: 4, mode }]);
  for(let mode = 0; mode < 9; mode++)
    t.push([{ type: VCD_COPY, size: 4, mode }, { type: VCD_ADD, size: 1, mode: 0 }]);
  return t;
})();
function makeVcdAddressCache(){
  const nearSize = 4, sameSize = 3;
  const near = new Array(nearSize).fill(0), same = new Array(sameSize * 256).fill(0);
  let nextNear = 0, addr = null;
  return {
    reset(cursor){ nextNear = 0; near.fill(0); same.fill(0); addr = cursor; },
    decode(here, mode){
      let a;
      if(mode === 0) a = addr.read7Bit();
      else if(mode === 1) a = here - addr.read7Bit();
      else if(mode - 2 < nearSize) a = near[mode - 2] + addr.read7Bit();
      else a = same[(mode - (2 + nearSize)) * 256 + addr.u8()];
      if(!(a >= 0)) throw new Error('This xdelta patch is damaged.');
      near[nextNear] = a; nextNear = (nextNear + 1) % nearSize;
      same[a % (sameSize * 256)] = a;
      return a;
    },
  };
}
function adler32(data, offset, length){
  let a = 1, b = 0, i = 0;
  while(i < length){
    const n = Math.min(5552, length - i);
    for(let k = 0; k < n; k++){ a += data[offset + i + k]; b += a; }
    a %= 65521; b %= 65521; i += n;
  }
  return ((b << 16) | a) >>> 0;
}
function decodeVcdWindow(c){
  const indicator = c.u8();
  let sourceLength = 0, sourcePosition = 0;
  if(indicator & 0x03){ sourceLength = c.read7Bit(); sourcePosition = c.read7Bit(); }
  c.read7Bit(); // delta length
  const targetLength = c.read7Bit();
  if(c.u8() !== 0) throw new Error('This xdelta patch uses window compression, which is not supported.');
  const addRunDataLength = c.read7Bit(), instructionsLength = c.read7Bit(), addressesLength = c.read7Bit();
  const adler = (indicator & 0x04) ? c.u32be() : -1;
  return { indicator, sourceLength, sourcePosition, targetLength, addRunDataLength, instructionsLength, addressesLength, adler };
}
function applyVcdiff(patch, rom){
  if(patch.length < 5 || patch[0] !== 0xD6 || patch[1] !== 0xC3 || patch[2] !== 0xC4) throw new Error('This is not a valid xdelta (VCDIFF) patch.');
  const h = makeCursor(patch, 4);
  const headerIndicator = h.u8();
  if(headerIndicator & 0x01){ if(h.u8() !== 0) throw new Error('This xdelta patch uses a secondary compressor, which is not supported.'); }
  if(headerIndicator & 0x02){ if(h.read7Bit() !== 0) throw new Error('This xdelta patch uses a custom code table, which is not supported.'); }
  if(headerIndicator & 0x04){ const appHeaderLength = h.read7Bit(); h.pos += appHeaderLength; } // read first: h.pos += h.read7Bit() would lose the length's own bytes
  const headerEnd = h.pos;
  const damaged = () => new Error('This patch is damaged, or is not made for this ROM.');
  const wrongRom = () => new Error('This patch is for a different ROM than the one chosen.');

  let targetSize = 0;
  { const p = makeCursor(patch, headerEnd);
    while(p.pos < patch.length){ const w = decodeVcdWindow(p); targetSize += w.targetLength; p.pos += w.addRunDataLength + w.instructionsLength + w.addressesLength; } }
  if(targetSize > 0x7fffffff) throw damaged();

  const out = new Uint8Array(targetSize);
  const cache = makeVcdAddressCache();
  let windowPos = 0;
  const p = makeCursor(patch, headerEnd);
  while(p.pos < patch.length){
    const w = decodeVcdWindow(p);
    const addRun = makeCursor(patch, p.pos);
    const instr = makeCursor(patch, addRun.pos + w.addRunDataLength);
    const addresses = makeCursor(patch, instr.pos + w.instructionsLength);
    const addressesStart = addresses.pos;
    cache.reset(addresses);
    let targetOffset = 0;
    while(instr.pos < addressesStart){
      const idx = instr.u8();
      for(let i = 0; i < 2; i++){
        const inst = VCD_CODE_TABLE[idx][i];
        if(inst.type === VCD_NOOP) continue;
        const size = inst.size || instr.read7Bit();
        const at = windowPos + targetOffset;
        if(at + size > out.length) throw damaged();
        if(inst.type === VCD_ADD){
          if(addRun.pos + size > patch.length) throw damaged();
          out.set(patch.subarray(addRun.pos, addRun.pos + size), at);
          addRun.pos += size;
        }else if(inst.type === VCD_RUN){
          out.fill(addRun.u8(), at, at + size);
        }else{
          const addr = cache.decode(targetOffset + w.sourceLength, inst.mode);
          let abs, fromSource;
          if(addr < w.sourceLength){ abs = w.sourcePosition + addr; fromSource = !!(w.indicator & 0x01); }
          else{ abs = windowPos + (addr - w.sourceLength); fromSource = false; }
          if(fromSource && abs + size > rom.length) throw wrongRom();
          if(!fromSource && abs >= at) throw damaged();
          for(let n = 0; n < size; n++) out[at + n] = fromSource ? rom[abs + n] : out[abs + n];
        }
        targetOffset += size;
      }
    }
    if(w.adler !== -1 && adler32(out, windowPos, w.targetLength) !== w.adler) throw wrongRom();
    p.pos += w.addRunDataLength + w.instructionsLength + w.addressesLength;
    windowPos += w.targetLength;
  }
  return { target: out };
}

const PATCH_FILE_RE = /\.(bps|ips|ups|ppf|aps|xdelta3?|vcdiff|vcd)$/i;
function patchKindFromName(name){
  const m = /\.(bps|ips|ups|ppf|aps|xdelta3?|vcdiff|vcd)$/.exec(String(name || '').split('?')[0].toLowerCase());
  if(!m) return null;
  return /^(xdelta3?|vcdiff|vcd)$/.test(m[1]) ? 'vcdiff' : m[1];
}

// The one place a patch is applied. It refuses to make a file when the ROM is provably wrong
// (BPS and UPS name their source's checksum) or the result fails the checksum the patch promises.
function applyPatchStrict(kind, patch, rom){
  const notes = [];
  let source = rom;
  if(kind === 'bps' || kind === 'ups'){
    if(patch.length < 16) throw new Error('This patch is truncated.');
    if(crc32(patch.subarray(0, patch.length - 4)) !== readU32LEAt(patch, patch.length - 4))
      throw new Error("This patch file is damaged: the download looks incomplete. Download it again and retry.");
    const expected = readU32LEAt(patch, patch.length - 12);
    if(crc32(source) !== expected){
      // Old SNES dumps often have a 512-byte copier header the patch doesn't expect.
      if(rom.length > 512 && crc32(rom.subarray(512)) === expected){
        source = rom.subarray(512);
        notes.push('This ROM had a 512-byte copier header, so it was removed before patching (the patch expects the headerless dump).');
      }else{
        throw new Error(`This patch is for a different version of this game than your ROM. It needs a ROM with checksum ${expected.toString(16).padStart(8, '0')}, but yours is ${crc32Hex(rom)}. Nothing was patched.`);
      }
    }
  }
  const fn = { bps: applyBps, ups: applyUps, ips: applyIps, ppf: applyPpf, aps: applyAps, vcdiff: applyVcdiff }[kind];
  if(!fn) throw new Error('Unsupported patch format.');
  let result;
  try{ result = fn(patch, source); }
  catch(e){
    if(e instanceof RangeError) throw new Error('This patch is damaged, or is not made for this ROM.');
    throw e;
  }
  if(result.targetMatches === false) throw new Error("The patched ROM didn't match the checksum this patch promises, so it was thrown away. The patch or the ROM isn't what it should be.");
  return { target: result.target, notes };
}

// Zip reading. Nearly every RAPatches file is a zip holding the patch and a readme. Entries are
// stored or deflated, which the WebView can inflate itself. 7z can't be opened here.
function readZipEntries(bytes){
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for(let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--){
    if(dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  }
  if(eocd < 0) throw new Error('not a zip file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for(let n = 0; n < count; n++){
    if(p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) break;
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, csize, localOff, encrypted: !!(flags & 1) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
async function extractZipEntry(bytes, e){
  if(e.encrypted) throw new Error('this zip is password-protected');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lp = e.localOff;
  if(dv.getUint32(lp, true) !== 0x04034b50) throw new Error('zip entry is damaged');
  const start = lp + 30 + dv.getUint16(lp + 26, true) + dv.getUint16(lp + 28, true);
  const data = bytes.subarray(start, start + e.csize);
  if(e.method === 0) return data.slice();
  if(e.method === 8){
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error('unsupported zip compression');
}

// RAPatches

const RAPATCHES_OWNER = 'RetroAchievements';
const RAPATCHES_REPO = 'RAPatches';

// The romhack index (tools/build_rapatches.py, published to this repo's data branch by the
// "Romhack index" workflow): every RAPatches archive, the patches inside, and for BPS/UPS the
// checksum of the ROM each was made for. Resolves to null if it can't be loaded.
const ROMHACK_INDEX_URL = 'https://raw.githubusercontent.com/Gin649/Game-Log-Tracker-DS-Launcher/data/ra-patches/index.json';
let romhackIndexPromise = null;
function getRomhackIndex(){
  if(!romhackIndexPromise){
    romhackIndexPromise = (async () => {
      try{
        const r = await fetch(ROMHACK_INDEX_URL, { cache: 'no-cache' });
        if(!r.ok) return null;
        const d = await r.json();
        if(!d || !Array.isArray(d.patches) || d.patches.length < 100) return null;
        const byPath = new Map();
        for(const p of d.patches) byPath.set(p.p, p);
        return { branch: d.branch || 'main', patches: d.patches, byPath };
      }catch(e){ return null; }
    })().then(v => { if(!v) romhackIndexPromise = null; return v; }); // retry next time
  }
  return romhackIndexPromise;
}

// Without the index: the repo's file list from GitHub, cached for a day.
async function getRAPatchesTree(){
  const cacheKey = 'rapatches-tree-cache-v4';
  try{
    const r = await window.storage.get(cacheKey, false);
    if(r && r.value){
      const cached = JSON.parse(r.value);
      if(Date.now() - cached.ts < 24 * 60 * 60 * 1000) return cached;
    }
  }catch(e){}

  const metaResp = await fetch(`https://api.github.com/repos/${RAPATCHES_OWNER}/${RAPATCHES_REPO}`);
  if(!metaResp.ok) throw new Error(`Could not reach the RAPatches repo (${metaResp.status}).`);
  const meta = await metaResp.json();
  const branch = meta.default_branch || 'master';

  const treeResp = await fetch(`https://api.github.com/repos/${RAPATCHES_OWNER}/${RAPATCHES_REPO}/git/trees/${branch}?recursive=1`);
  if(!treeResp.ok) throw new Error(`Could not list RAPatches files (${treeResp.status}). GitHub limits how often this can be asked, so wait a while and try again.`);
  const treeData = await treeResp.json();
  const files = (treeData.tree || [])
    .filter(e => e.type === 'blob' && /\.(bps|ips|ups|ppf|aps|xdelta3?|vcdiff|vcd|zip|7z)$/i.test(e.path))
    .map(e => ({ path: e.path }));

  const cached = { branch, files, ts: Date.now() };
  try{ await window.storage.set(cacheKey, JSON.stringify(cached), false); }catch(e){}
  return cached;
}

function fetchRAPatchUrl(branch, path){
  return `https://raw.githubusercontent.com/${RAPATCHES_OWNER}/${RAPATCHES_REPO}/${branch}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function normalizeForMatch(s){
  return String(s || '').toLowerCase().replace(/\[.*?\]|\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}
const stripPatchExt = (name) => name.replace(/\.(bps|ips|ups|ppf|aps|xdelta3?|vcdiff|vcd|zip|7z)$/i, '');

function containsWordSequence(haystackWords, needleWords){
  if(needleWords.length === 0 || needleWords.length > haystackWords.length) return false;
  outer: for(let i = 0; i <= haystackWords.length - needleWords.length; i++){
    for(let j = 0; j < needleWords.length; j++){
      if(haystackWords[i+j] !== needleWords[j]) continue outer;
    }
    return true;
  }
  return false;
}

// score: share of the title's words in the file name (or the names of the patches inside it).
// inFolder: a folder between the console folder and the file matches the title, which is how
// RAPatches files hacks ("console/Hacks/<Game>/<id>-Abbrev.zip").
function scorePatchFiles(files, title){
  const titleWords = normalizeForMatch(title).split(' ').filter(w => w.length > 1);
  return files.map(f => {
    const norm = normalizeForMatch(stripPatchExt(f.path.split('/').pop()) + ' ' + (f.names ? f.names.join(' ') : ''));
    const score = titleWords.length ? titleWords.filter(w => norm.includes(w)).length / titleWords.length : 0;
    const segWords = normalizeForMatch(f.path.split('/').slice(1, -1).join(' ')).split(' ').filter(Boolean);
    const inFolder = titleWords.length > 0 && segWords.length > 0
      && (containsWordSequence(segWords, titleWords) || containsWordSequence(titleWords, segWords));
    return { path: f.path, score, inFolder };
  });
}

// RAPatches' console folders don't always use RA's names ("MD", "GBA", ...). Keys are checked
// longest first, so "game boy advance" isn't taken for "game boy".
const CONSOLE_FOLDER_ALIASES = {
  'game boy advance': ['gba'],
  'game boy color': ['gbc'],
  'game boy': ['gb'],
  'nintendo dsi': ['ndsi'],
  'nintendo ds': ['nds'],
  'nintendo 64': ['n64'],
  'virtual boy': ['vb'],
  'genesis mega drive': ['md', 'genesis', 'megadrive'],
  'sega mega drive': ['md', 'genesis', 'megadrive'],
  'playstation': ['ps1', 'psx'],
  'playstation portable': ['psp'],
  'pc engine turbografx 16': ['pce', 'tg16', 'turbografx16', 'turbografx'],
  'sega cd': ['segacd', 'scd'],
  'master system': ['sms', 'mastersystem'],
  'game gear': ['gg', 'gamegear'],
  'neo geo pocket': ['ngp', 'ngpc'],
  'wonderswan': ['ws', 'wonderswan'],
  '32x': ['sega32x'],
  'pc 8000': ['pc8801'],
  'wasm 4': ['wasm4'],
};
const CONSOLE_FOLDER_ALIAS_KEYS = Object.keys(CONSOLE_FOLDER_ALIASES).sort((a, b) => b.length - a.length);

// The files in this console's folder(s), or null if no folder clearly matches.
function consoleFolderCandidates(files, consoleName){
  const topDirs = new Map(); // normalized -> original
  for(const f of files){
    const idx = f.path.indexOf('/');
    if(idx > 0) topDirs.set(normalizeForMatch(f.path.slice(0, idx)), f.path.slice(0, idx));
  }
  const normConsole = normalizeForMatch(consoleName);
  const consoleWords = normConsole.split(' ').filter(Boolean);
  const aliasKey = CONSOLE_FOLDER_ALIAS_KEYS.find(k => normConsole.includes(k));
  const aliasCandidates = aliasKey ? CONSOLE_FOLDER_ALIASES[aliasKey] : [];

  const matchedDirs = [];
  const aliasDirs = [];
  for(const [normDir, origDir] of topDirs){
    if(!normDir) continue;
    const joined = normDir.replace(/\s+/g, '');
    const dirWords = normDir.split(' ').filter(Boolean);
    if(aliasCandidates.includes(joined)) aliasDirs.push(origDir);
    // Whole words only, so "NES" doesn't match inside "Genesis" or "SNES".
    if(aliasCandidates.includes(joined) || containsWordSequence(consoleWords, dirWords) || containsWordSequence(dirWords, consoleWords)) matchedDirs.push(origDir);
  }
  // An alias hit is exact ("Game Boy Advance" -> GBA); loose matching would add plain "Game Boy".
  const dirs = new Set(aliasDirs.length ? aliasDirs : matchedDirs);
  if(!dirs.size) return null;
  return files.filter(f => dirs.has(f.path.slice(0, f.path.indexOf('/'))));
}

// A denylist on purpose: hiding the button from a cartridge system by mistake is worse than showing it somewhere odd.
function isCartridgeConsole(consoleName){
  const denylist = [
    'playstation', 'ps2', 'psp', 'vita', 'saturn', 'dreamcast', 'sega cd', 'mega cd',
    'pc-fx', '3do', 'neo geo cd', 'pc engine cd', 'turbografx-cd', 'turbografx cd',
    'jaguar cd', 'cd-i', 'wii', 'gamecube', 'xbox', 'dos', 'windows', 'arcade',
    'pc-8000', 'pc-9800', 'msx', 'apple ii', 'commodore', 'colecovision', 'amiga',
  ];
  const n = String(consoleName || '').toLowerCase();
  return !denylist.some(d => n.includes(d));
}

// CD and DVD systems, patched by the app on storage (the images are too big for the page).
function isDiscConsole(consoleName){
  if(!thorBridge || typeof thorBridge.discPatchStart !== 'function') return false;
  const n = String(consoleName || '').toLowerCase();
  if(n.includes('vita') || n.includes('wii u')) return false;
  return ['playstation', 'ps2', 'psp', 'saturn', 'dreamcast', 'sega cd', 'mega cd', 'pc-fx', '3do', 'neo geo cd',
    'pc engine cd', 'turbografx-cd', 'turbografx cd', 'jaguar cd', 'cd-i', 'wii', 'gamecube'].some(d => n.includes(d));
}
function canPatchConsole(consoleName){
  return isCartridgeConsole(consoleName) || isDiscConsole(consoleName);
}

// "What does it do?"

// A hack's name from its file name, for a search: brackets dropped, "-Hack" removed, squashed words
// spaced out ("KirbysHalloweenAdventure" -> "Kirby's Halloween Adventure").
function titleFromFileName(label){
  const baseName = String(label || '').replace(/\.(bps|ips|ups|ppf|aps|xdelta3?|vcdiff|vcd|zip|7z|rar)$/i, '').replace(/^\d+[-_]/, '');
  const spaceOut = (str) => str
    .replace(/[-_\s]+hack(?=$|[-_\s(\[])/gi, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')    // KirbysHalloween -> Kirbys Halloween
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // ABCDef -> ABC Def
    .replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim();
  // File names can't hold apostrophes. Put one back in a first word that looks possessive,
  // skipping common plurals ("Dragons Lair", "Days of Thunder").
  const NOT_POSSESSIVE = /^(Days|Hours|Years|Lands|Worlds|Tales|Heroes|Games|Dreams|Legends|Kingdoms|Wars|Nights|Ways|Things|Times|Lives|Lords|Souls|Stars|Bros|Quests|Adventures|Genesis|Plus|Chaos|Pirates|Dragons|Knights|Monsters|Ghosts|Sisters|Brothers|Friends|Wings|Colors|Rules|Fantasies|Kids|Boys|Girls|Guys)$/;
  const addPossessive = (str) => {
    const words = str.split(' ');
    if(words.length < 2) return str;
    const first = words[0], next = words[1];
    if(/^[A-Z][a-z]{2,}s$/.test(first) && !/(ss|us)$/.test(first) && !NOT_POSSESSIVE.test(first)
       && /^[A-Z]/.test(next) && !/^(Of|The|And|In|On|To|For|Vs|A|An)$/.test(next)){
      words[0] = first.slice(0, -1) + "'s";
    }
    return words.join(' ');
  };
  return addPossessive(spaceOut(baseName.replace(/\s*[(\[][^)\]]*[)\]]?/g, '')) || spaceOut(baseName));
}

// romhack.ing's search with the title filter filled in (its filters are base64 JSON).
function romhackIngUrl(title){
  const filters = [null, null, null, null, null, null, null, null,
    { field: 'title', operator: 'must', value: title },
    { field: 'categories', operator: 'must', value: 'Hack' }
  ];
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(filters))));
  return `https://romhack.ing/search/hack?page=0&sortField=releaseDate&sortDirection=desc&queryString=&filters=${encodeURIComponent(b64)}`;
}

// The details panel under a patch row. The number in front of a RAPatches file name is the hack's
// RetroAchievements game, which gives its real title and its forum thread (where the notes are).
async function fillPatchInfo(panel, label){
  const m = String(label).match(/^(\d+)[-_]/);
  const raId = m ? Number(m[1]) : 0;
  let info = null;
  if(raId){
    try{ info = await getGameExtended(raId); }catch(e){ info = null; }
    if(info && !info.Title) info = null;
  }
  const title = info ? String(info.Title).replace(/^(?:~[^~]*~\s*)+/, '').trim() : titleFromFileName(label);
  const facts = [];
  if(info){
    if(info.ConsoleName) facts.push(info.ConsoleName);
    if(info.Developer) facts.push('by ' + info.Developer);
    if(info.Genre) facts.push(info.Genre);
    if(info.Released) facts.push(String(info.Released).slice(0, 10));
    if(Number(info.NumAchievements)) facts.push(info.NumAchievements + ' achievements');
  }
  const links = [];
  if(info && Number(info.ForumTopicID)) links.push(['RA forum thread: the hack\'s notes', `https://retroachievements.org/viewtopic.php?t=${Number(info.ForumTopicID)}`]);
  if(raId) links.push(['RetroAchievements page', `https://retroachievements.org/game/${raId}`]);
  links.push(['ROMhacking.net', `https://duckduckgo.com/?q=${encodeURIComponent('site:romhacking.net ' + title)}`]);
  links.push(['romhack.ing', romhackIngUrl(title)]);
  links.push(['Search the web', `https://duckduckgo.com/?q=${encodeURIComponent('"' + title + '" rom hack')}`]);
  panel.innerHTML = `
    <div class="patch-info-title">${esc(title)}</div>
    ${facts.length ? `<div class="patch-info-facts">${esc(facts.join(' · '))}</div>` : ''}
    <div class="patch-info-links">
      ${links.map(([text, href]) => `<a class="patch-info-btn" href="${href}" target="_blank" rel="noopener">${esc(text)} ↗</a>`).join('')}
    </div>`;
}

// The ROM Hacks panel

function bytesToBase64(u8){
  let bin = '';
  for(let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fmtSize(n){
  if(!(n > 0)) return '';
  return n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : Math.max(1, Math.round(n / 1048576)) + ' MB';
}

const loadingHtml = (text) => `<div class="achievements-list-loading">${text}</div>`;
const mutedP = (text, extra) => `<p style="font-size:0.7688rem;color:var(--muted);margin:${extra || '0 0 10px'};line-height:1.55;">${text}</p>`;
const smallNote = (text) => `<div style="font-size:0.675rem;color:var(--muted);margin-top:2px;">${text}</div>`;

function setupRomPatchUI(gameId, title, card, consoleName){
  const patchBtn = card.querySelector('#modal-patch-btn');
  const patchWrap = card.querySelector('#modal-patch-panel');
  if(!patchBtn || !patchWrap) return;

  // "What does it do?" opens or closes a details panel under its row.
  patchWrap.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.patch-info-link');
    const row = btn && btn.closest('.patch-result-row');
    if(!row) return;
    const next = row.nextElementSibling;
    if(next && next.classList.contains('patch-info-panel')){ next.remove(); return; }
    const panel = document.createElement('div');
    panel.className = 'patch-info-panel';
    panel.innerHTML = '<div class="patch-info-facts">Looking it up…</div>';
    row.insertAdjacentElement('afterend', panel);
    await fillPatchInfo(panel, decodeURIComponent(btn.getAttribute('data-info') || ''));
  });

  let opened = false;
  let branch = null;
  let results = null;
  let romBytes = null;
  let romFilename = null;
  let romFromStorage = false;
  let romConvertedFrom = null; // 'v64' | 'n64'
  let romUnzippedFrom = null;  // the zip's name, if the ROM came out of one
  let romLoadError = null;
  let romOnDevice = null;      // { name, folder, path } when the app found the ROM
  let romNotFound = false;
  let rememberRom = false;
  const deviceBridge = (thorBridge && typeof thorBridge.findRom === 'function') ? thorBridge : null;
  // Disc games stay on storage; the app patches them in pieces.
  const discMode = !isCartridgeConsole(consoleName) && !!deviceBridge && typeof deviceBridge.discPatchStart === 'function';
  let discInfo = null; // { name, folder, path, size, ok, message, note }

  const findOnDevice = () => {
    try{ return JSON.parse(deviceBridge.findRom(JSON.stringify({ title, console: consoleName }))); }catch(e){ return null; }
  };

  // Every way of loading a ROM ends here: a zip is unpacked (the checksum must be the ROM's),
  // then an N64 dump is put in .z64 order.
  async function setRom(bytes, filename){
    romLoadError = null; romUnzippedFrom = null; romConvertedFrom = null;
    if(bytes && bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && (bytes[2] === 0x03 || bytes[2] === 0x05)){
      try{
        const notRom = /\.(txt|nfo|md|diz|url|htm|html|pdf|jpe?g|png|gif|ini|sfv|md5|sha1|xml|db)$/i;
        const entries = readZipEntries(bytes)
          .filter(e => !/\/$/.test(e.name) && !/^__MACOSX\//.test(e.name) && !notRom.test(e.name))
          .sort((x, y) => y.csize - x.csize); // the ROM is the biggest file
        if(!entries.length) throw new Error('there is no ROM file inside it');
        bytes = await extractZipEntry(bytes, entries[0]);
        romUnzippedFrom = filename;
        filename = entries[0].name.split('/').pop();
      }catch(e){
        romBytes = null; romFilename = null;
        romLoadError = `Couldn't open ${esc(filename)}: ${esc((e && e.message) || 'unknown error')}. Extract the ROM from the zip yourself and pick that file.`;
        return;
      }
    }
    const n = n64ToBigEndian(bytes);
    romBytes = n.bytes;
    romConvertedFrom = n.converted;
    romFilename = n.converted ? String(filename || '').replace(/\.(v64|n64)$/i, '.z64') : filename;
  }

  // The ROM Play would start, read from the ROMs folder. The patched copy is saved next to it.
  async function loadRomFromDevice(){
    if(!deviceBridge) return false;
    const info = findOnDevice();
    if(!info || !info.found){ romNotFound = !!info; return false; }
    try{
      patchWrap.innerHTML = loadingHtml('Loading your ROM…');
      const resp = await fetch('/rom/' + info.token, { cache: 'no-store' });
      if(!resp.ok) throw new Error('read failed');
      await setRom(new Uint8Array(await resp.arrayBuffer()), info.name);
      if(!romBytes) return false;
      romOnDevice = { name: info.name, folder: info.folder, path: info.path };
      romFromStorage = false;
      return true;
    }catch(e){
      return false;
    }
  }

  function loadDiscFromDevice(){
    discInfo = null; romNotFound = false;
    const info = findOnDevice();
    if(!info || !info.found){ romNotFound = true; return; }
    let chk = { ok: true };
    try{ chk = JSON.parse(deviceBridge.discCheck(info.path)); }catch(e){}
    discInfo = { name: info.name, folder: info.folder, path: info.path, size: info.size, ok: chk.ok !== false, message: chk.message, note: chk.note };
  }

  // Writes the patched ROM next to the original. Returns { ok, name, path, message }.
  async function saveBesideRom(outName, bytes){
    let begin;
    try{ begin = JSON.parse(deviceBridge.romSaveBegin(romOnDevice.path, outName)); }catch(e){ return { ok: false, message: 'Could not reach the launcher.' }; }
    if(!begin || !begin.ok) return { ok: false, message: (begin && begin.message) || 'Could not create the file.' };
    const CHUNK = 786432;
    for(let i = 0; i < bytes.length; i += CHUNK){
      if(!deviceBridge.romSaveChunk(begin.id, bytesToBase64(bytes.subarray(i, Math.min(i + CHUNK, bytes.length))))){
        return { ok: false, message: 'Writing the file failed (is the storage full?).' };
      }
      await new Promise(r => setTimeout(r, 0));
    }
    let end;
    try{ end = JSON.parse(deviceBridge.romSaveEnd(begin.id)); }catch(e){ return { ok: false, message: 'Could not finish the file.' }; }
    return end && end.ok ? { ok: true, name: end.name, path: end.path } : { ok: false, message: (end && end.message) || 'Could not finish the file.' };
  }

  // RAPatches files start with the hack's own RA game ID.
  function patchGameIdFrom(label, verifyGameId){
    if(verifyGameId) return Number(verifyGameId);
    const m = /^(\d{1,7})-/.exec(String(label || ''));
    return m ? Number(m[1]) : null;
  }

  async function addGameToBacklog(raGameId, statusEl, btn){
    if(!raGameId) return;
    if(libraryData.some(x => Number(x.GameID) === Number(raGameId))){
      statusEl.textContent = 'This game is already in your library or backlog.';
      if(btn) btn.disabled = true;
      return;
    }
    statusEl.textContent = 'Adding…';
    try{
      const g = await raFetch('API_GetGameExtended.php', { i: raGameId });
      if(!g || !(g.ID || g.Title)) throw new Error('not found');
      await addManualGamesBulk([{ g: { ID: g.ID || raGameId, Title: g.Title, ConsoleName: g.ConsoleName, ImageIcon: g.ImageIcon, NumAchievements: g.NumAchievements }, consoleId: g.ConsoleID, consoleName: g.ConsoleName }]);
      statusEl.textContent = 'Added to your Backlog.';
      if(btn) btn.disabled = true;
    }catch(e){
      statusEl.textContent = "Couldn't add it to your backlog. Try again in a moment.";
    }
  }

  // The result after a patch: notes, Play, Add to backlog, Back.
  function showPatched(lines, savedName, folder, playPath, hackId){
    patchWrap.innerHTML = `
      ${lines.map(n => `<div class="hash-status ${n.cls || 'ok'}" style="margin-top:8px;">${esc(n.text)}</div>`).join('')}
      <div class="hash-status ok" style="margin-top:8px;">Patched and saved as <strong>${esc(savedName)}</strong> in your ${esc(folder)} folder.</div>
      <button class="guide-btn guide-btn-primary" id="patch-play-btn" style="margin-top:10px;width:100%;">▶ Play patched game</button>
      ${hackId ? '<button class="guide-btn guide-btn-outline" id="patch-backlog-btn" style="margin-top:8px;width:100%;">＋ Add to my backlog</button>' : ''}
      <div id="patch-after-msg" style="font-size:0.7188rem;color:var(--muted);margin-top:6px;min-height:1em;"></div>
      <button class="guide-btn guide-btn-ghost" id="patch-back-btn" style="width:100%;margin-top:8px;">‹ Back to results</button>
    `;
    const afterMsg = patchWrap.querySelector('#patch-after-msg');
    patchWrap.querySelector('#patch-play-btn').addEventListener('click', () => {
      let res;
      try{ res = JSON.parse(deviceBridge.launchFile(playPath)); }catch(e){ res = { ok: false, message: 'Could not reach the launcher.' }; }
      afterMsg.textContent = res.message || (res.ok ? 'Starting the game…' : 'Could not start the game.');
    });
    const blBtn = patchWrap.querySelector('#patch-backlog-btn');
    if(blBtn) blBtn.addEventListener('click', () => addGameToBacklog(hackId, afterMsg, blBtn));
    patchWrap.querySelector('#patch-back-btn').addEventListener('click', renderResults);
  }

  function showFailure(msg){
    patchWrap.innerHTML = `<div class="hash-status mismatch" style="margin-bottom:8px;">${esc(msg)}</div><button class="guide-btn guide-btn-ghost" id="patch-back-btn" style="width:100%;">‹ Back to results</button>`;
    patchWrap.querySelector('#patch-back-btn').addEventListener('click', renderResults);
  }

  async function init(){
    if(discMode){
      patchWrap.innerHTML = loadingHtml('Looking for your game…');
      loadDiscFromDevice();
    }else if(!(await loadRomFromDevice())){
      const saved = await loadRom(gameId);
      if(saved){ await setRom(saved.bytes, saved.filename); romFromStorage = !!romBytes; }
    }
    renderRomStage();
  }

  // Step 1: the ROM (or disc) to patch.
  function renderRomStage(){
    if(discMode){ renderDiscStage(); return; }
    if(!romBytes){
      patchWrap.innerHTML = `
        ${romLoadError ? `<div class="hash-status mismatch" style="margin-bottom:10px;">${romLoadError}</div>` : ''}
        ${romNotFound ? '<div class="hash-status mismatch" style="margin-bottom:10px;">No ROM for this game was found in your ROMs folder, so pick the file yourself.</div>' : ''}
        ${mutedP('Pick the ROM file for this game. Its checksum is matched against the patches, so the results are ones made for your exact dump.')}
        <input type="file" id="patch-rom-input" style="display:none;">
        <button class="guide-btn guide-btn-primary" id="patch-rom-pick-btn">Select ROM File…</button>
      `;
      const input = patchWrap.querySelector('#patch-rom-input');
      patchWrap.querySelector('#patch-rom-pick-btn').addEventListener('click', () => input.click());
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if(!file) return;
        await setRom(new Uint8Array(await file.arrayBuffer()), file.name);
        romFromStorage = false;
        renderRomStage();
      });
      return;
    }
    patchWrap.innerHTML = `
      <div style="font-size:0.7688rem;color:var(--text);">Base ROM: <strong>${esc(romFilename)}</strong></div>
      ${romOnDevice ? smallNote(`Found in your ${esc(romOnDevice.folder)} folder. The patched ROM is saved there too.`) : ''}
      ${smallNote('CRC32 ' + crc32Hex(romBytes))}
      ${romUnzippedFrom ? smallNote(`Unpacked from ${esc(romUnzippedFrom)}, so the checksum is the ROM's own.`) : ''}
      ${romConvertedFrom ? smallNote(`Converted from .${romConvertedFrom} to .z64 byte order, which patches and RetroAchievements expect. The patched ROM is saved as .z64.`) : ''}
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="guide-btn guide-btn-ghost" id="patch-rom-change-btn">Use a different file…</button>
        ${romFromStorage ? '<button class="guide-btn guide-btn-danger" id="patch-rom-forget-btn">Forget saved ROM</button>' : ''}
      </div>
      <label style="display:${romOnDevice ? 'none' : 'flex'};align-items:center;gap:8px;cursor:pointer;font-size:0.75rem;color:var(--text);margin-top:10px;">
        <input type="checkbox" id="patch-remember-checkbox" style="width:15px;height:15px;flex-shrink:0;">
        <span>Remember this ROM for future patches of this game</span>
      </label>
      <div id="patch-remember-status" style="font-size:0.675rem;margin-top:4px;min-height:1em;"></div>
      <button class="guide-btn guide-btn-primary" id="patch-search-btn" style="width:100%;margin-top:12px;">Search RA Patches</button>
    `;
    const forget = () => { romBytes = null; romFilename = null; romFromStorage = false; };
    patchWrap.querySelector('#patch-rom-change-btn').addEventListener('click', () => {
      forget(); romOnDevice = null; romNotFound = false; renderRomStage();
    });
    const forgetBtn = patchWrap.querySelector('#patch-rom-forget-btn');
    if(forgetBtn) forgetBtn.addEventListener('click', async () => {
      await deleteRom(gameId);
      forget(); renderRomStage();
    });
    const rememberCheckbox = patchWrap.querySelector('#patch-remember-checkbox');
    const rememberStatus = patchWrap.querySelector('#patch-remember-status');
    rememberCheckbox.addEventListener('change', async () => {
      rememberRom = rememberCheckbox.checked;
      if(!rememberRom){ rememberStatus.textContent = ''; return; }
      if(romFromStorage) return;
      rememberStatus.textContent = 'Saving…';
      try{
        await saveRom(gameId, romFilename, romBytes);
        romFromStorage = true;
        rememberStatus.textContent = 'Saved on this device.';
      }catch(e){
        rememberStatus.textContent = "Couldn't save it. The ROM may be too large for storage.";
        rememberCheckbox.checked = false;
        rememberRom = false;
      }
    });
    patchWrap.querySelector('#patch-search-btn').addEventListener('click', runSearch);
  }

  function renderDiscStage(){
    if(!discInfo){
      patchWrap.innerHTML = '<div class="hash-status mismatch">No disc image for this game was found in your ROMs folder. Put the game\'s disc image (.cue, .iso, .cso, .chd or .rvz) there, then open this again.</div>';
      return;
    }
    const isCue = /\.cue$/i.test(discInfo.name);
    patchWrap.innerHTML = `
      <div style="font-size:0.7688rem;color:var(--text);">Disc image: <strong>${esc(discInfo.name)}</strong></div>
      ${smallNote(`Found in your ${esc(discInfo.folder)} folder${isCue ? '' : ' (' + fmtSize(discInfo.size) + ')'}. The patched disc is saved next to it and your original isn't changed.`)}
      ${discInfo.ok
        ? `<div style="font-size:0.675rem;color:var(--muted);margin-top:6px;line-height:1.5;">Discs are patched straight from storage, so a big one can take a few minutes. Works with BIN/CUE, ISO, CSO, CHD and RVZ games, and IPS, PPF, BPS, UPS and xdelta patches. You'll need about as much free space as the game takes.${discInfo.note ? ' ' + esc(discInfo.note) : ''}</div>
           <button class="guide-btn guide-btn-primary" id="patch-search-btn" style="width:100%;margin-top:12px;">Search RA Patches</button>`
        : `<div class="hash-status mismatch" style="margin-top:8px;">${esc(discInfo.message || "This kind of disc image can't be patched here.")}</div>`}
    `;
    const sb = patchWrap.querySelector('#patch-search-btn');
    if(sb) sb.addEventListener('click', runSearch);
  }

  // RA's own patch links for this game entry (API_GetGameHashes PatchUrl).
  async function fetchOfficialPatches(){
    try{
      const data = await raFetch('API_GetGameHashes.php', { i: gameId });
      const list = (data && (data.Results || data.results)) || [];
      return list
        .filter(r => (r.PatchUrl || r.patchUrl))
        .map(r => {
          let url = r.PatchUrl || r.patchUrl;
          if(url.startsWith('http://')) url = 'https://' + url.slice(7);
          // github.com/<owner>/<repo>/(raw|blob)/<ref>/<path> -> raw.githubusercontent.com, which allows cross-origin requests
          const gh = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:raw|blob)\/(?:refs\/heads\/)?(.+)$/);
          if(gh) url = `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3].split('?')[0]}`;
          return { label: url.split('/').pop(), url };
        });
    }catch(e){
      return [];
    }
  }

  // Step 2: find patches for this game.
  // - RA's official links for the game entry.
  // - Files named "<this game's RA ID>-...".
  // - Patches whose BPS/UPS checksum says they were made for this exact ROM (from the index).
  // - Name matches: the title's words in the file name, or the game's folder (hacks are filed by game).
  async function runSearch(){
    if(rememberRom && !romFromStorage && romBytes){
      try{ await saveRom(gameId, romFilename, romBytes); romFromStorage = true; }catch(e){}
    }
    patchWrap.innerHTML = loadingHtml('Checking RetroAchievements…');
    try{
      let official = await fetchOfficialPatches();

      patchWrap.innerHTML = loadingHtml('Reading the RAPatches list…');
      const idx = await getRomhackIndex();
      const tree = idx
        ? { branch: idx.branch, files: idx.patches.map(p => ({ path: p.p, names: (p.i || []).map(x => x[0]) })) }
        : await getRAPatchesTree();
      branch = tree.branch;
      const toEntry = (path) => ({ label: path.split('/').pop(), path, url: fetchRAPatchUrl(branch, path) });

      // github.com links send no CORS headers, so point an official link at the same file in the repo.
      official = official.map(o => {
        let decoded = o.url;
        try{ decoded = decodeURIComponent(o.url); }catch(e){}
        const hit = tree.files
          .filter(f => decoded.endsWith('/' + f.path) || decoded.endsWith(f.path))
          .sort((a, b) => b.path.length - a.path.length)[0];
        return hit ? { ...o, url: fetchRAPatchUrl(branch, hit.path), path: hit.path } : o;
      });
      const isOfficial = (path) => official.some(o => {
        try{ return decodeURIComponent(o.url).endsWith(path); }catch(e){ return false; }
      });

      const idPrefix = String(gameId) + '-';
      const byId = tree.files.filter(f => f.path.split('/').pop().startsWith(idPrefix) && !isOfficial(f.path)).map(f => toEntry(f.path));
      const taken = new Set(byId.map(b => b.path));

      let verified = [];
      if(idx && !discMode){
        const crcs = new Set([crc32(romBytes)]);
        if(romBytes.length > 512) crcs.add(crc32(romBytes.subarray(512))); // the same dump without a copier header
        verified = idx.patches
          .filter(p => !taken.has(p.p) && !isOfficial(p.p) && (p.i || []).some(x => x[2] && crcs.has(parseInt(x[2], 16))))
          .map(p => toEntry(p.p));
        verified.forEach(v => taken.add(v.path));
      }
      // Every patch inside carries a checksum and none is this ROM's.
      const knownMismatch = (path) => {
        if(!idx || discMode) return false;
        const r = idx.byPath.get(path);
        return !!(r && r.i && r.i.length && r.i.every(x => x[2]));
      };

      let pool = consoleFolderCandidates(tree.files, consoleName);
      const usedFallback = !pool || pool.length === 0;
      if(usedFallback) pool = tree.files; // no clear console folder: match names across the repo
      // Every word of the title in the name (one shared word like "Super" matches too much), or the game's folder.
      const nameMatched = scorePatchFiles(pool, title)
        .filter(c => (c.inFolder || c.score === 1) && !taken.has(c.path) && !isOfficial(c.path)
          && !knownMismatch(c.path) && !(discMode && /\.aps$/i.test(c.path)))
        .map(c => toEntry(c.path));

      const byLabel = (a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true });
      const isTranslation = (e) => /^[^/]+\/Translation\//i.test(e.path || '');
      const tag = (list, how) => list.filter(isTranslation).map(e => ({ ...e, how }));
      const notTr = (list) => list.filter(e => !isTranslation(e)).sort(byLabel);
      results = {
        official: official.slice().sort(byLabel),
        byId: notTr(byId),
        verified: notTr(verified),
        unverified: notTr(nameMatched),
        translations: [...tag(byId, 'byId'), ...tag(verified, 'verified'), ...tag(nameMatched, 'unverified')].sort(byLabel),
        usedFallback,
      };
      renderResults();
    }catch(e){
      patchWrap.innerHTML = `${loadingHtml('Search failed: ' + esc(e.message))}<button class="guide-btn guide-btn-ghost" id="patch-retry-btn" style="margin-top:8px;width:100%;">Try again</button>`;
      patchWrap.querySelector('#patch-retry-btn').addEventListener('click', runSearch);
    }
  }

  function resultRow(entry, badge, group){
    return `
      <div class="patch-result-row">
        <div class="info"><div class="fn">${esc(entry.label)}</div><div class="pth">${badge}</div></div>
        <button type="button" class="patch-info-link" data-info="${encodeURIComponent(entry.label)}">What does it do?</button>
        <button type="button" data-group="${group}" data-key="${encodeURIComponent(entry.url || entry.label)}">Use</button>
      </div>
    `;
  }

  function unverifiedBadge(path){
    if(/\.(zip|7z)$/i.test(path)) return 'Not checked yet: matched by name, the patch inside is checked when downloaded';
    if(discMode || /\.(bps|ups)$/i.test(path)) return 'Matched by name: checked against your game when it is applied';
    return 'Unverified: this format has no checksum to check';
  }
  function translationBadge(m){
    const parts = (m.path || '').split('/');
    const how = m.how === 'verified' ? 'checksum matches this ROM' : (m.how === 'byId' ? 'listed for this exact game' : 'matched by name');
    return `Translation${parts.length > 3 ? ' (' + esc(parts[2]) + ')' : ''}: ${how}`;
  }

  function renderResults(){
    const groups = ['official', 'byId', 'verified', 'unverified', 'translations'];
    const total = groups.reduce((n, g) => n + results[g].length, 0);
    const fallbackNote = (results.usedFallback && !results.byId.length)
      ? `<p style="font-size:0.6875rem;color:var(--muted);margin:0 0 8px;line-height:1.5;">This console's folder in the repo couldn't be identified, so this is a name-only search and hacks with unrelated names may be missing.</p>`
      : '';
    if(total === 0){
      patchWrap.innerHTML = `
        ${fallbackNote}
        ${mutedP("No patches for this game were found in the RAPatches repo, and RetroAchievements has none linked to it. If you're after a particular hack, open that hack's own RetroAchievements game page rather than the base game's.")}
        <a class="guide-btn guide-btn-outline" href="https://github.com/${RAPATCHES_OWNER}/${RAPATCHES_REPO}" target="_blank" rel="noopener">Browse RAPatches on GitHub ↗</a>
        <button class="guide-btn guide-btn-ghost" id="patch-back-btn" style="width:100%;margin-top:8px;">‹ Back</button>
      `;
      patchWrap.querySelector('#patch-back-btn').addEventListener('click', renderRomStage);
      return;
    }
    patchWrap.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="guide-btn guide-btn-ghost" id="patch-back-btn" style="flex-shrink:0;">‹ Back</button>
        <input type="text" id="patch-filter-input" placeholder="Search hack name…" style="flex:1;min-width:0;padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--panel);color:var(--text);font-size:0.7812rem;">
      </div>
      <div style="margin-top:10px;">${fallbackNote}</div>
      <div id="patch-result-list-wrap"></div>
    `;
    patchWrap.querySelector('#patch-back-btn').addEventListener('click', renderRomStage);
    const listWrap = patchWrap.querySelector('#patch-result-list-wrap');
    const filterInput = patchWrap.querySelector('#patch-filter-input');

    function renderList(){
      const q = filterInput.value.trim().toLowerCase();
      const pick = (g) => results[g].filter(m => !q || m.label.toLowerCase().includes(q) || (m.path || '').toLowerCase().includes(q));
      const rows = Object.fromEntries(groups.map(g => [g, pick(g)]));
      const mainCount = rows.official.length + rows.byId.length + rows.verified.length + rows.unverified.length;
      if(mainCount + rows.translations.length === 0){
        listWrap.innerHTML = mutedP(`No hacks match “${esc(filterInput.value.trim())}”.`, '8px 0 0');
        return;
      }
      listWrap.innerHTML = `
        ${mainCount && rows.translations.length ? '<div class="patch-group-title">Hacks and other patches</div>' : ''}
        ${mainCount ? `<div class="patch-result-list">
          ${rows.official.map(m => resultRow(m, 'Official: linked by RetroAchievements', 'official')).join('')}
          ${rows.byId.map(m => resultRow(m, 'Listed for this exact game (RetroAchievements game ID)', 'byId')).join('')}
          ${rows.verified.map(m => resultRow(m, 'Verified: checksum matches this ROM', 'verified')).join('')}
          ${rows.unverified.map(m => resultRow(m, unverifiedBadge(m.path), 'unverified')).join('')}
        </div>` : ''}
        ${rows.translations.length ? `<div class="patch-group-title">Translations</div>
        <div class="patch-result-list">${rows.translations.map(m => resultRow(m, translationBadge(m), 'translations')).join('')}</div>` : ''}
      `;
      listWrap.querySelectorAll('button[data-group]').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = decodeURIComponent(btn.dataset.key);
          const group = btn.dataset.group;
          const entry = results[group].find(e => e.url === key);
          // Only the official and by-ID results are certainly this game, so only they are checked against its RA hashes.
          if(entry) selectAndApply(entry, (group === 'official' || group === 'byId') ? gameId : null);
        });
      });
    }
    filterInput.addEventListener('input', renderList);
    renderList();
  }

  // Step 3: download the patch and apply it.
  function showArchiveFallback(entry, reason){
    patchWrap.innerHTML = `
      <button class="guide-btn guide-btn-ghost" id="patch-back-btn">‹ Back to results</button>
      ${mutedP(reason + ' Only BPS, IPS, UPS, PPF, APS and xdelta patches are applied here, so this one needs a separate tool.', '10px 0 0')}
      <a class="guide-btn guide-btn-primary" style="margin-top:10px;" href="${entry.url}" download="${esc(entry.label)}">Download patch file</a>
    `;
    patchWrap.querySelector('#patch-back-btn').addEventListener('click', renderResults);
  }

  async function selectAndApply(entry, verifyGameId){
    patchWrap.innerHTML = loadingHtml('Downloading patch…');
    try{
      const kind = patchKindFromName(entry.url) || 'archive';
      const isZip = /\.zip$/i.test((entry.url || '').split('?')[0]);
      if(kind === 'archive' && !isZip){
        showArchiveFallback(entry, "This patch is packed in a 7z or rar archive, which can't be unpacked here.");
        return;
      }
      const resp = await fetch(entry.url);
      if(!resp.ok) throw new Error(`Could not download that patch (${resp.status}).`);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      if(isZip) await applyFromZip(entry, bytes, verifyGameId);
      else await applyPatchBytes(entry.label, kind, bytes, verifyGameId);
    }catch(e){
      showFailure('Could not apply that patch: ' + e.message);
    }
  }

  // Opens a zip and applies the patch inside that fits this ROM. If that can't be told (several
  // patches, or ones without a checksum), the person picks.
  async function applyFromZip(entry, zipBytes, verifyGameId){
    let items = [];
    try{
      const entries = readZipEntries(zipBytes).filter(e =>
        PATCH_FILE_RE.test(e.name) && !/(^|\/)__MACOSX\//.test(e.name) && !e.name.endsWith('/'));
      const romCrcs = discMode ? [] : [crc32(romBytes)];
      if(!discMode && romBytes.length > 512) romCrcs.push(crc32(romBytes.subarray(512)));
      for(const pe of entries){
        const data = await extractZipEntry(zipBytes, pe);
        const kind = patchKindFromName(pe.name);
        let matches = null; // only BPS and UPS can be checked up front
        if(!discMode && (kind === 'bps' || kind === 'ups') && data.length >= 12) matches = romCrcs.includes(readU32LEAt(data, data.length - 12));
        items.push({ label: pe.name.split('/').pop(), kind, data, matches });
      }
    }catch(e){
      showArchiveFallback(entry, `Couldn't unpack this zip (${esc(e.message)}).`);
      return;
    }
    if(discMode) items = items.filter(i => i.kind !== 'aps');
    if(!items.length){
      showArchiveFallback(entry, "This zip doesn't contain a patch that can be applied here.");
      return;
    }
    const matched = items.filter(i => i.matches === true);
    if(items.length === 1 || matched.length === 1){
      const pick = items.length === 1 ? items[0] : matched[0];
      await applyPatchBytes(pick.label, pick.kind, pick.data, verifyGameId);
      return;
    }
    items.sort((a, b) => (b.matches === true) - (a.matches === true));
    const badge = (m) => m.matches === true ? 'Checksum matches this ROM'
      : m.matches === false ? "Checksum doesn't match this ROM"
      : (discMode ? 'Checked against your disc when applied' : 'No checksum to check up front');
    patchWrap.innerHTML = `
      <button class="guide-btn guide-btn-ghost" id="patch-back-btn">‹ Back to results</button>
      ${mutedP('This zip has more than one patch. Pick the one to apply.', '10px 0')}
      <div class="patch-result-list">${items.map(m => resultRow({ label: m.label }, badge(m), 'zip')).join('')}</div>
    `;
    patchWrap.querySelector('#patch-back-btn').addEventListener('click', renderResults);
    patchWrap.querySelectorAll('button[data-group="zip"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const it = items.find(i => i.label === decodeURIComponent(btn.dataset.key));
        if(it) applyPatchBytes(it.label, it.kind, it.data, verifyGameId);
      });
    });
  }

  async function applyPatchBytes(label, kind, patchBytes, verifyGameId){
    if(discMode){ await applyDiscPatch(label, kind, patchBytes, verifyGameId); return; }
    try{
      patchWrap.innerHTML = loadingHtml('Applying patch…');
      await new Promise(r => setTimeout(r, 30)); // let the message show before the work
      const { target, notes } = applyPatchStrict(kind, patchBytes, romBytes);

      let raCheck = null;
      if(verifyGameId){
        patchWrap.innerHTML = loadingHtml('Verifying against RetroAchievements…');
        raCheck = await verifyAgainstRaHash(verifyGameId, target, consoleName);
      }
      const romExt = (/\.[^./\\]+$/.exec(romFilename || '') || [''])[0];
      const outName = (label.replace(PATCH_FILE_RE, '') || 'patched-rom') + romExt;
      const lines = notes.map(text => ({ text }));
      if(raCheck) lines.push({ cls: raCheck.cls, text: raCheck.text });

      if(romOnDevice && deviceBridge){
        patchWrap.innerHTML = loadingHtml('Saving the patched ROM…');
        const saved = await saveBesideRom(outName, target);
        if(saved.ok){
          showPatched(lines, saved.name, romOnDevice.folder, saved.path, patchGameIdFrom(label, verifyGameId));
          return;
        }
        lines.push({ text: "Couldn't save it next to your ROM (" + saved.message + '), so it is offered as a download instead.' });
      }

      // A ROM that was picked by hand: offered as a download (the app saves it to Downloads).
      patchWrap.innerHTML = `
        ${lines.map(n => `<div class="hash-status ${n.cls || 'ok'}" style="margin-top:8px;">${esc(n.text)}</div>`).join('')}
        <div class="hash-status ok" style="margin-top:8px;">Your ROM has been patched as <strong>${esc(outName)}</strong>. Open it in your emulator to add the game to your RetroAchievements library.</div>
        <button class="guide-btn guide-btn-primary" id="patch-download-btn" style="margin-top:10px;width:100%;">Download Patched ROM</button>
        <div style="font-size:0.675rem;color:var(--muted);margin-top:4px;">It is saved to your Downloads folder.</div>
        <button class="guide-btn guide-btn-ghost" id="patch-back-btn" style="width:100%;margin-top:8px;">‹ Back to results</button>
      `;
      const url = URL.createObjectURL(new Blob([target], { type: 'application/octet-stream' }));
      patchWrap.querySelector('#patch-download-btn').addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = url; a.download = outName;
        document.body.appendChild(a); a.click(); a.remove();
      });
      patchWrap.querySelector('#patch-back-btn').addEventListener('click', renderResults);
    }catch(e){
      showFailure('Could not apply that patch: ' + e.message);
    }
  }

  // Disc games: the (small) patch goes to the app, which patches the image on storage in the
  // background and reports progress.
  async function applyDiscPatch(label, kind, patchBytes, verifyGameId){
    if(!['ips', 'bps', 'ups', 'ppf', 'vcdiff'].includes(kind)){
      showFailure('Disc games can be patched with IPS, PPF, BPS, UPS and xdelta patches. This one is a .' + kind + ' patch.');
      return;
    }
    patchWrap.innerHTML = loadingHtml('Sending the patch to the launcher…');
    let jobId;
    try{
      const sid = deviceBridge.patchStageBegin();
      const CH = 786432;
      for(let i = 0; i < patchBytes.length; i += CH){
        if(!deviceBridge.patchStageChunk(sid, bytesToBase64(patchBytes.subarray(i, Math.min(i + CH, patchBytes.length))))) throw new Error('The patch could not be handed to the launcher.');
        await new Promise(r => setTimeout(r, 0));
      }
      const start = JSON.parse(deviceBridge.discPatchStart(discInfo.path, sid, (label.replace(PATCH_FILE_RE, '') || 'patched').trim()));
      if(!start || !start.ok) throw new Error((start && start.message) || 'Could not start patching.');
      jobId = start.job;
    }catch(e){
      showFailure(e.message || 'Could not start patching.');
      return;
    }
    patchWrap.innerHTML = `
      <div id="disc-phase" style="font-size:0.7688rem;color:var(--text);">Starting…</div>
      <div style="height:8px;border-radius:4px;background:var(--border);margin-top:8px;overflow:hidden;"><div id="disc-bar" style="height:100%;width:0;background:var(--gold, #d4a017);"></div></div>
      <div style="font-size:0.675rem;color:var(--muted);margin-top:6px;">Keep this screen open until it finishes.</div>
      <button class="guide-btn guide-btn-ghost" id="disc-cancel-btn" style="width:100%;margin-top:10px;">Cancel</button>
    `;
    patchWrap.querySelector('#disc-cancel-btn').addEventListener('click', () => { try{ deviceBridge.discPatchCancel(jobId); }catch(e){} });
    for(;;){
      await new Promise(r => setTimeout(r, 400));
      if(!document.body.contains(patchWrap)) return;
      let st;
      try{ st = JSON.parse(deviceBridge.discPatchStatus(jobId)); }catch(e){ st = { state: 'error', message: 'Lost contact with the launcher.' }; }
      if(st.state === 'running'){
        const phaseEl = patchWrap.querySelector('#disc-phase'), barEl = patchWrap.querySelector('#disc-bar');
        if(!phaseEl) return; // the panel moved on
        const pct = st.total > 0 ? Math.min(100, Math.round(st.done * 100 / st.total)) : 0;
        phaseEl.textContent = (st.phase || 'Working') + '… ' + (st.total > 0 ? pct + '%' : '');
        if(barEl) barEl.style.width = pct + '%';
        continue;
      }
      if(st.state !== 'done'){ showFailure(st.message || 'Patching failed.'); return; }
      const lines = String(st.notes || '').split('\n').filter(Boolean).map(text => ({ text }));
      showPatched(lines, st.name, discInfo.folder, st.path, patchGameIdFrom(label, verifyGameId));
      return;
    }
  }

  patchBtn.addEventListener('click', () => {
    const nowOpen = patchWrap.style.display === 'none';
    patchWrap.style.display = nowOpen ? 'block' : 'none';
    patchBtn.classList.toggle('open', nowOpen);
    if(nowOpen && !opened){
      opened = true;
      init();
    }
  });
}
