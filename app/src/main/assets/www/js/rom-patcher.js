// ROM patcher: CRC32, BPS/IPS/UPS/PPF/APS/xdelta patching, the RAPatches search, and the
// "ROM Hacks" panel in the game modal. Needs helpers from the earlier scripts ($, imgUrl,
// saveRom/loadRom/deleteRom, ...), so load it after them.

  // Patch engine: CRC32, BPS, IPS, UPS.
  // BPS was designed by byuu and released public domain (spec:
  // https://www.romhacking.net/documents/746/). IPS is the long-standing de facto
  // standard. Both are written from their specs, not ported from any existing patcher
  // (RomPatcher.js included), to avoid reusing someone else's licensed code.
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

  // MD5 (RFC 1321). RA's hash database (API_GetGameHashes) is keyed by MD5, so this is
  // used to check a patched ROM against RA's known hash (see raRomHash and
  // verifyAgainstRaHash). Written from the RFC and checked against its test vectors.
  function md5Hex(bytes){
    function rotl(x, c){ return (x << c) | (x >>> (32 - c)); }
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

  // RA hashes some consoles differently from a plain whole-file MD5: it strips copier/dump
  // headers so a headered and a headerless dump of the same game match. Handles NES (iNES
  // header), SNES (512-byte copier header) and N64 (normalize to big-endian .z64).
  // Everything else is hashed as-is, like RA does.
  function raRomHash(consoleName, bytes){
    const norm = normalizeForMatch(consoleName);
    if(norm.includes('nintendo entertainment system') || norm.includes('famicom') || /(^| )nes( |$)/.test(norm)){
      if(bytes.length > 16 && bytes[0] === 0x4E && bytes[1] === 0x45 && bytes[2] === 0x53 && bytes[3] === 0x1A){
        return md5Hex(bytes.subarray(16));
      }
    }else if(norm.includes('super nintendo') || norm.includes('super famicom') || /(^| )snes( |$)/.test(norm)){
      if(bytes.length % 0x8000 === 512){
        return md5Hex(bytes.subarray(512));
      }
    }else if(norm.includes('nintendo 64') || /(^| )n64( |$)/.test(norm)){
      if(bytes.length >= 4){
        // Normalize to big-endian (.z64) byte order before hashing.
        if(bytes[0] === 0x37 && bytes[1] === 0x80 && bytes[2] === 0x40 && bytes[3] === 0x12){
          // .v64, byte-swapped every 2 bytes
          const out = new Uint8Array(bytes.length);
          for(let i = 0; i + 1 < bytes.length; i += 2){ out[i] = bytes[i+1]; out[i+1] = bytes[i]; }
          return md5Hex(out);
        }
        if(bytes[0] === 0x40 && bytes[1] === 0x12 && bytes[2] === 0x37 && bytes[3] === 0x80){
          // .n64, word-swapped every 4 bytes (little-endian)
          const out = new Uint8Array(bytes.length);
          for(let i = 0; i + 3 < bytes.length; i += 4){
            out[i] = bytes[i+3]; out[i+1] = bytes[i+2]; out[i+2] = bytes[i+1]; out[i+3] = bytes[i];
          }
          return md5Hex(out);
        }
      }
    }
    return md5Hex(bytes);
  }

  // N64 dumps exist in three byte orders: .z64 (big-endian, what patches and RetroAchievements
  // are built against), .v64 (every 2 bytes swapped) and .n64 (every 4 bytes reversed). The first
  // four bytes tell them apart. A .v64/.n64 dump is the right game with a "wrong" checksum, so it is
  // converted to .z64 order before any checksum or patching happens. Returns { bytes, converted }.
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

  // Runs after a successful patch, only for results tied to one RA game ID (the official
  // RA-linked patch and the "byId" group, i.e. RAPatches files named with this game's ID).
  // Compares the patched ROM against RA's known hashes via API_GetGameHashes, which is the
  // only way to verify an IPS result since IPS has no checksum. A failed lookup returns
  // "unknown" rather than a false mismatch.
  async function verifyAgainstRaHash(targetGameId, targetBytes, consoleName_){
    try{
      const data = await raFetch('API_GetGameHashes.php', { i: targetGameId });
      const list = (data && (data.Results || data.results)) || [];
      const known = list.map(r => String(r.MD5 || r.Md5 || r.Hash || r.hash || '').toLowerCase()).filter(Boolean);
      if(!known.length){
        return { cls: 'unknown', text: "RetroAchievements doesn't have a hash on file for this game to check against — patch applied, but the result wasn't verified." };
      }
      const hash = raRomHash(consoleName_, targetBytes);
      if(known.includes(hash)){
        return { cls: 'ok', text: 'Matches a hash RetroAchievements has on file for this game — achievements should unlock normally.' };
      }
      return { cls: 'mismatch', text: `Doesn't match any hash RetroAchievements has on file for this game (got ${hash}) — achievements may not unlock. This can happen with a different ROM revision/region than RA expects, or if this isn't quite the right patch.` };
    }catch(e){
      return { cls: 'unknown', text: "Couldn't check the result against RetroAchievements' hash database, so this wasn't verified." };
    }
  }

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

  // Applies a BPS patch to sourceBytes and returns the result plus whether the source and
  // target matched the checksums in the patch. The checks run before anything is written,
  // so a wrong base ROM fails with a clear message.
  function applyBps(patchBytes, sourceBytes){
    const p = patchBytes;
    if(p.length < 16 || p[0] !== 0x42 || p[1] !== 0x50 || p[2] !== 0x53 || p[3] !== 0x31){
      throw new Error('Not a valid BPS patch (missing "BPS1" header).');
    }
    const footerStart = p.length - 12;
    const readU32LE = (off) => (p[off] | (p[off+1] << 8) | (p[off+2] << 16) | (p[off+3] << 24)) >>> 0;
    const expectedSourceCrc = readU32LE(footerStart);
    const expectedTargetCrc = readU32LE(footerStart + 4);
    const expectedPatchCrc = readU32LE(footerStart + 8);

    if(crc32(p.subarray(0, footerStart + 8)) !== expectedPatchCrc){
      throw new Error('This patch file looks corrupted (patch checksum mismatch) — try re-downloading it.');
    }

    const pos = { i: 4 };
    readVLQ(p, pos); // source-size, not needed directly, sourceBytes.length is used instead
    const targetSize = readVLQ(p, pos);
    const metadataSize = readVLQ(p, pos);
    pos.i += metadataSize;

    const actualSourceCrc = crc32(sourceBytes);
    const sourceMatches = actualSourceCrc === expectedSourceCrc;

    const target = new Uint8Array(targetSize);
    let outOff = 0, srcRel = 0, tgtRel = 0;

    while(pos.i < footerStart){
      const data = readVLQ(p, pos);
      const action = data & 3;
      const length = (data >>> 2) + 1;
      if(outOff + length > targetSize) throw new Error('This patch is malformed (writes past the expected output size).');

      if(action === 0){ // SourceRead, same-position bytes copied straight from source
        if(outOff + length > sourceBytes.length) throw new Error("This patch doesn't match your base ROM (it reads past the end of it).");
        for(let n = 0; n < length; n++) target[outOff + n] = sourceBytes[outOff + n];
        outOff += length;
      }else if(action === 1){ // TargetRead, literal bytes embedded in the patch itself
        if(pos.i + length > footerStart) throw new Error('This patch is malformed (ran out of data).');
        for(let n = 0; n < length; n++) target[outOff + n] = p[pos.i + n];
        pos.i += length;
        outOff += length;
      }else if(action === 2){ // SourceCopy, relocatable read from source
        const rel = readVLQ(p, pos);
        srcRel += (rel & 1) ? -(rel >>> 1) : (rel >>> 1);
        if(srcRel < 0 || srcRel + length > sourceBytes.length) throw new Error("This patch doesn't match your base ROM (source offset out of range).");
        for(let n = 0; n < length; n++) target[outOff + n] = sourceBytes[srcRel + n];
        outOff += length;
        srcRel += length;
      }else{ // TargetCopy, self-referential, used for RLE-style runs
        const rel = readVLQ(p, pos);
        tgtRel += (rel & 1) ? -(rel >>> 1) : (rel >>> 1);
        if(tgtRel < 0 || tgtRel >= outOff) throw new Error('This patch is malformed (target offset out of range).');
        for(let n = 0; n < length; n++) target[outOff + n] = target[tgtRel++];
        outOff += length;
      }
    }

    if(outOff !== targetSize) throw new Error("This patch didn't produce the expected output size.");

    const actualTargetCrc = crc32(target);
    return {
      target, sourceMatches, actualSourceCrc, expectedSourceCrc,
      targetMatches: actualTargetCrc === expectedTargetCrc, actualTargetCrc, expectedTargetCrc,
    };
  }

  // IPS has no embedded checksums at all, there is nothing to verify a
  // base ROM against before applying one, unlike BPS above.
  function applyIps(patchBytes, sourceBytes){
    const p = patchBytes;
    if(p.length < 5 || String.fromCharCode(p[0], p[1], p[2], p[3], p[4]) !== 'PATCH'){
      throw new Error('Not a valid IPS patch (missing "PATCH" header).');
    }
    let target = new Uint8Array(sourceBytes); // IPS only overwrites/extends a copy of the source
    let i = 5;
    while(i + 3 <= p.length){
      const b0 = p[i], b1 = p[i+1], b2 = p[i+2];
      if(b0 === 0x45 && b1 === 0x4F && b2 === 0x46){ i += 3; break; } // "EOF"
      const offset = (b0 << 16) | (b1 << 8) | b2;
      i += 3;
      if(i + 2 > p.length) throw new Error('This patch is malformed (truncated record).');
      const length = (p[i] << 8) | p[i+1];
      i += 2;
      let endOffset;
      if(length === 0){ // RLE record
        if(i + 3 > p.length) throw new Error('This patch is malformed (truncated RLE record).');
        const rleLen = (p[i] << 8) | p[i+1];
        const value = p[i+2];
        i += 3;
        endOffset = offset + rleLen;
        if(endOffset > target.length){ const grown = new Uint8Array(endOffset); grown.set(target); target = grown; }
        target.fill(value, offset, endOffset);
      }else{
        if(i + length > p.length) throw new Error('This patch is malformed (truncated data record).');
        endOffset = offset + length;
        if(endOffset > target.length){ const grown = new Uint8Array(endOffset); grown.set(target); target = grown; }
        target.set(p.subarray(i, i + length), offset);
        i += length;
      }
    }
    if(i + 3 === p.length){ // optional trailing truncation length, rare, but part of the spec
      const truncTo = (p[i] << 16) | (p[i+1] << 8) | p[i+2];
      if(truncTo <= target.length) target = target.subarray(0, truncTo);
    }
    return { target };
  }

  // UPS carries embedded checksums like BPS does (source/target/patch CRC32
  // in a 12-byte footer), but its body is a much simpler format: a stream of
  // (gap, XOR-bytes-until-0x00) records applied on top of a copy of the
  // source, rather than BPS's four-action instruction set.
  function applyUps(patchBytes, sourceBytes){
    const p = patchBytes;
    if(p.length < 16 || p[0] !== 0x55 || p[1] !== 0x50 || p[2] !== 0x53 || p[3] !== 0x31){
      throw new Error('Not a valid UPS patch (missing "UPS1" header).');
    }
    const footerStart = p.length - 12;
    const readU32LE = (off) => (p[off] | (p[off+1] << 8) | (p[off+2] << 16) | (p[off+3] << 24)) >>> 0;
    const expectedSourceCrc = readU32LE(footerStart);
    const expectedTargetCrc = readU32LE(footerStart + 4);
    const expectedPatchCrc = readU32LE(footerStart + 8);

    if(crc32(p.subarray(0, footerStart + 8)) !== expectedPatchCrc){
      throw new Error('This patch file looks corrupted (patch checksum mismatch) — try re-downloading it.');
    }

    const pos = { i: 4 };
    readVLQ(p, pos); // source size, sourceBytes.length is used instead, same as BPS above
    const targetSize = readVLQ(p, pos);

    const actualSourceCrc = crc32(sourceBytes);
    const sourceMatches = actualSourceCrc === expectedSourceCrc;

    const target = new Uint8Array(targetSize);
    target.set(sourceBytes.subarray(0, Math.min(sourceBytes.length, targetSize)));

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

    const actualTargetCrc = crc32(target);
    return {
      target, sourceMatches, actualSourceCrc, expectedSourceCrc,
      targetMatches: actualTargetCrc === expectedTargetCrc, actualTargetCrc, expectedTargetCrc,
    };
  }

  // RAPatches repo search
  // Official repo: github.com/RetroAchievements/RAPatches. There is no API from an RA game
  // ID to its patches, and a hack does not have to be named after the base game, so
  // filename matching alone both misses real matches and surfaces unrelated ones.
  // RAPatches requires patches to target the canonical No-Intro/Redump dump, and BPS/UPS
  // footers embed that dump's CRC32, so the real test is whether a candidate's embedded
  // source checksum equals the CRC32 of the user's ROM. Filename search only narrows down
  // which files are worth checking.
  const RAPATCHES_OWNER = 'RetroAchievements';
  const RAPATCHES_REPO = 'RAPatches';

  // The file list is normally served pre-built: a GitHub Actions workflow
  // (.github/workflows/build-ra-index.yml) crawls RAPatches daily and commits
  // ra-patches-index.json, so Pages serves it same-origin. That avoids calling GitHub's
  // tree API from every visitor's browser (60 requests/hour per IP, which a shared or
  // carrier IP can burn through). If the file is missing or fails to load, fall back to
  // asking GitHub directly.
  async function getRAPatchesTree(){
    const cacheKey = 'rapatches-tree-cache-v3'; // v3: prefers the prebuilt static index
    try{
      const r = await window.storage.get(cacheKey, false);
      if(r && r.value){
        const cached = JSON.parse(r.value);
        if(Date.now() - cached.ts < 24 * 60 * 60 * 1000) return cached;
      }
    }catch(e){ /* not cached yet */ }

    try{
      const staticResp = await fetch('./ra-patches-index.json', { cache: 'no-store' });
      if(staticResp.ok){
        const data = await staticResp.json();
        if(Array.isArray(data.files) && data.files.length > 100){
          const cached = { branch: data.branch || 'main', files: data.files.map(p => ({ path: p })), ts: Date.now(), truncated: false, source: 'static' };
          try{ await window.storage.set(cacheKey, JSON.stringify(cached), false); }catch(e){ /* non-fatal */ }
          return cached;
        }
      }
    }catch(e){ /* fall through to the live API below */ }

    const metaResp = await fetch(`https://api.github.com/repos/${RAPATCHES_OWNER}/${RAPATCHES_REPO}`);
    if(!metaResp.ok) throw new Error(`Could not reach the RAPatches repo (${metaResp.status}).`);
    const meta = await metaResp.json();
    const branch = meta.default_branch || 'master';

    const treeResp = await fetch(`https://api.github.com/repos/${RAPATCHES_OWNER}/${RAPATCHES_REPO}/git/trees/${branch}?recursive=1`);
    if(!treeResp.ok) throw new Error(`Could not list RAPatches files (${treeResp.status}). GitHub's unauthenticated API is rate-limited — if this keeps happening, wait a while and try again.`);
    const treeData = await treeResp.json();
    const files = (treeData.tree || [])
      .filter(e => e.type === 'blob' && /\.(bps|ips|ups|ppf|aps|xdelta3?|vcdiff|vcd|zip|7z)$/i.test(e.path))
      .map(e => ({ path: e.path }));

    const cached = { branch, files, ts: Date.now(), truncated: !!treeData.truncated, source: 'live' };
    try{ await window.storage.set(cacheKey, JSON.stringify(cached), false); }catch(e){ /* non-fatal */ }
    return cached;
  }

  function normalizeForMatch(s){
    return String(s || '').toLowerCase().replace(/\[.*?\]|\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function searchRAPatches(files, title, cap){
    const titleWords = normalizeForMatch(title).split(' ').filter(w => w.length > 1);
    if(!titleWords.length) return [];
    const scored = files.map(f => {
      const base = f.path.split('/').pop().replace(/\.(bps|ips|ups|ppf|aps|xdelta3?|vcdiff|vcd|zip|7z)$/i, '');
      const norm = normalizeForMatch(base);
      const hits = titleWords.filter(w => norm.includes(w)).length;
      return { path: f.path, score: hits / titleWords.length };
    }).filter(f => f.score > 0);
    scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
    return scored.slice(0, cap || 15);
  }

  // Like the scoring above but keeps everything, even zero-overlap files. Only used to
  // decide checking order when the pool is too big to scan fully, so a hack that shares no
  // words with the base title still gets checked, just later.
  function scoreForOrdering(files, title){
    const titleWords = normalizeForMatch(title).split(' ').filter(w => w.length > 1);
    return files.map(f => {
      const base = f.path.split('/').pop().replace(/\.(bps|ips|ups|ppf|aps|xdelta3?|vcdiff|vcd|zip|7z)$/i, '');
      const norm = normalizeForMatch(base);
      const hits = titleWords.length ? titleWords.filter(w => norm.includes(w)).length / titleWords.length : 0;
      // RAPatches nests most patches under console/Category/<Game Title>/file, but the file is
      // usually named "<RA ID>-AbbreviatedName.ext" (e.g. "98765-SMWLearn2Kaizo.zip"), which
      // shares no words with the real title. The enclosing folder usually does, so check any
      // directory between the console folder and the file the same way the console folder is
      // matched.
      const segs = f.path.split('/').slice(1, -1);
      const segWords = normalizeForMatch(segs.join(' ')).split(' ').filter(Boolean);
      const inFolder = titleWords.length > 0 && segWords.length > 0
        && (containsWordSequence(segWords, titleWords) || containsWordSequence(titleWords, segWords));
      return { path: f.path, score: hits, inFolder };
    });
  }

  // RAPatches' top-level console folders don't always match RA's console names
  // (Genesis/Mega Drive -> "MD", PlayStation -> "PS1", Game Boy Advance -> "GBA"). This
  // resolves the name against the folders that exist in the fetched tree instead of
  // hardcoding a layout. Keys are checked longest-first so "Game Boy Advance" isn't
  // shadowed by "Game Boy".
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

  function consoleFolderCandidates(files, consoleName){
    const topDirs = new Map(); // spaced-normalized -> original
    for(const f of files){
      const idx = f.path.indexOf('/');
      if(idx > 0){
        const dir = f.path.slice(0, idx);
        topDirs.set(normalizeForMatch(dir), dir);
      }
    }
    const normConsole = normalizeForMatch(consoleName);
    const consoleWords = normConsole.split(' ').filter(Boolean);

    const aliasKey = CONSOLE_FOLDER_ALIAS_KEYS.find(k => normConsole.includes(k));
    const aliasCandidates = aliasKey ? CONSOLE_FOLDER_ALIASES[aliasKey] : [];

    const matchedDirs = [];
    const aliasDirs = [];
    for(const [normDirSpaced, origDir] of topDirs){
      if(!normDirSpaced) continue;
      const normDirJoined = normDirSpaced.replace(/\s+/g, '');
      const dirWords = normDirSpaced.split(' ').filter(Boolean);
      if(aliasCandidates.includes(normDirJoined)) aliasDirs.push(origDir);
      // Word-level containment only (not raw substring), "NES" must appear
      // as its own word, not as a false-positive infix of "Genesis"/"SNES".
      const isMatch = aliasCandidates.includes(normDirJoined)
        || containsWordSequence(consoleWords, dirWords) || containsWordSequence(dirWords, consoleWords);
      if(isMatch) matchedDirs.push(origDir);
    }
    // An exact alias hit is the precise answer ("Game Boy Advance" -> GBA); the loose
    // word matching would otherwise also drag in the plain "Game Boy" folder.
    if(aliasDirs.length) return files.filter(f => aliasDirs.includes(f.path.slice(0, f.path.indexOf('/'))));
    if(matchedDirs.length === 0) return null; // couldn't confidently resolve the folder

    const dirSet = new Set(matchedDirs);
    return files.filter(f => dirSet.has(f.path.slice(0, f.path.indexOf('/'))));
  }

  async function fetchRAPatchBytes(branch, path){
    const url = `https://raw.githubusercontent.com/${RAPATCHES_OWNER}/${RAPATCHES_REPO}/${branch}/${path.split('/').map(encodeURIComponent).join('/')}`;
    const resp = await fetch(url);
    if(!resp.ok) throw new Error(`Could not download that patch (${resp.status}).`);
    return new Uint8Array(await resp.arrayBuffer());
  }

  // Reads only the trailing 12-byte footer of a BPS/UPS file with an HTTP Range request, so
  // checking a candidate does not mean downloading the whole patch. If the CDN ignores
  // Range and sends the full file, that still works.
  async function fetchPatchSourceCrc32(branch, path){
    const url = `https://raw.githubusercontent.com/${RAPATCHES_OWNER}/${RAPATCHES_REPO}/${branch}/${path.split('/').map(encodeURIComponent).join('/')}`;
    const resp = await fetch(url, { headers: { Range: 'bytes=-12' } });
    if(!resp.ok && resp.status !== 206) throw new Error(`(${resp.status})`);
    const buf = new Uint8Array(await resp.arrayBuffer());
    if(buf.length < 12) return null;
    const footer = buf.subarray(buf.length - 12);
    return (footer[0] | (footer[1] << 8) | (footer[2] << 16) | (footer[3] << 24)) >>> 0; // sourceCRC32
  }

  // Runs async fn() over items with at most `limit` in flight at once,
  // keeps a checksum scan of dozens/hundreds of candidate files reasonably
  // fast without firing them all at the CDN simultaneously. onProgress(done,
  // total), if given, fires after each completed item.
  async function mapWithConcurrency(items, limit, fn, onProgress){
    const results = new Array(items.length);
    let next = 0, done = 0;
    async function worker(){
      while(next < items.length){
        const i = next++;
        try{ results[i] = await fn(items[i], i); }
        catch(e){ results[i] = undefined; }
        done++;
        if(onProgress) onProgress(done, items.length);
      }
    }
    await Promise.all(new Array(Math.min(limit, items.length)).fill(0).map(worker));
    return results;
  }

  // Deliberately a denylist, not an allowlist: an unlisted disc/computer
  // platform slipping through would wrongly show this button somewhere it
  // doesn't belong, but that's a much smaller problem than an unlisted
  // cartridge platform wrongly having the feature hidden from it entirely.
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

  // More patch formats: PPF, APS (N64 and GBA), xdelta/VCDIFF
  // Based on the approach in JoeyOS's RomPatcher.kt (used with Joey's permission), with the
  // public specs as reference (RFC 3284 for VCDIFF). Every read is bounds-checked because a
  // typed array returns 0 for an out-of-range read instead of failing.
  function makeCursor(bytes, pos){
    return {
      bytes, pos,
      u8(){ if(this.pos >= this.bytes.length) throw new Error('This patch is truncated.'); return this.bytes[this.pos++]; },
      u32le(){ const a = this.u8(), b = this.u8(), c = this.u8(), d = this.u8(); return (a | (b << 8) | (c << 16) | (d << 24)) >>> 0; },
      u32be(){ const a = this.u8(), b = this.u8(), c = this.u8(), d = this.u8(); return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0; },
      // VCDIFF's big-endian 7-bit continuation integer.
      read7Bit(){ let num = 0; for(;;){ const bits = this.u8(); num = num * 128 + (bits & 0x7f); if(!(bits & 0x80)) break; } return num; },
    };
  }
  const asciiAt = (b, i, str) => { for(let k = 0; k < str.length; k++) if(b[i + k] !== str.charCodeAt(k)) return false; return true; };

  // PPF (v1-3): overwrites runs of bytes at absolute offsets. No source checksum, so a wrong base
  // isn't caught. Undo data, if present, is skipped (this only ever patches forward).
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
      if(c.pos + 4 <= patch.length && asciiAt(patch, c.pos, '@BEG')) break; // FILE_ID.DIZ block ends the records
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

  // APS has two unrelated formats sharing an extension, told apart by their first bytes.
  function applyAps(patch, rom){
    if(asciiAt(patch, 0, 'APS10')) return applyApsN64(patch, rom);
    if(asciiAt(patch, 0, 'APS1')) return applyApsGba(patch, rom);
    throw new Error('This is not a valid APS patch.');
  }
  function applyApsN64(patch, rom){
    const c = makeCursor(patch, 5);
    const headerType = c.u8();
    c.pos += 1;  // encoding method
    c.pos += 50; // description
    if(headerType === 1) c.pos += 1 + 3 + 8 + 5; // N64 header: format, cartId, crc, pad
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
      c.pos += 4; // source and target CRC16, not verified
      for(let j = 0; j < block; j++){
        const base = offset + j < rom.length ? rom[offset + j] : 0;
        if(offset + j < out.length) out[offset + j] = base ^ patch[c.pos + j];
      }
      c.pos += block;
    }
    return { target: out };
  }

  // xdelta / VCDIFF (RFC 3284): windows of ADD / RUN / COPY instructions from the default code
  // table. No secondary compressor and no custom code table (what xdelta writes for ROM patches).
  // A window's Adler-32, when present, is checked, that's what catches a wrong base ROM.
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
    c.read7Bit(); // delta length, not needed
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
    if(headerIndicator & 0x04) h.pos += h.read7Bit();
    const headerEnd = h.pos;
    const damaged = () => new Error('This patch is damaged, or is not made for this ROM.');

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
          let size = inst.size;
          if(size === 0 && inst.type !== VCD_NOOP) size = instr.read7Bit();
          const at = windowPos + targetOffset;
          if(inst.type === VCD_NOOP) continue;
          if(at + size > out.length) throw damaged();
          if(inst.type === VCD_ADD){
            if(addRun.pos + size > patch.length) throw damaged();
            out.set(patch.subarray(addRun.pos, addRun.pos + size), at);
            addRun.pos += size; targetOffset += size;
          }else if(inst.type === VCD_RUN){
            const runByte = addRun.u8();
            out.fill(runByte, at, at + size);
            targetOffset += size;
          }else{ // COPY
            const addr = cache.decode(targetOffset + w.sourceLength, inst.mode);
            let abs, fromSource;
            if(addr < w.sourceLength){ abs = w.sourcePosition + addr; fromSource = !!(w.indicator & 0x01); }
            else{ abs = windowPos + (addr - w.sourceLength); fromSource = false; }
            if(fromSource && abs + size > rom.length) throw new Error('This patch is for a different ROM than the one chosen.');
            if(!fromSource && abs >= at) throw damaged();
            for(let n = 0; n < size; n++) out[at + n] = fromSource ? rom[abs + n] : out[abs + n];
            targetOffset += size;
          }
        }
      }
      if(w.adler !== -1 && adler32(out, windowPos, w.targetLength) !== w.adler) throw new Error('This patch is for a different ROM than the one chosen.');
      p.pos += w.addRunDataLength + w.instructionsLength + w.addressesLength;
      windowPos += w.targetLength;
    }
    return { target: out };
  }

  function patchKindFromName(name){
    const clean = String(name || '').split('?')[0].toLowerCase();
    if(/\.bps$/.test(clean)) return 'bps';
    if(/\.ips$/.test(clean)) return 'ips';
    if(/\.ups$/.test(clean)) return 'ups';
    if(/\.ppf$/.test(clean)) return 'ppf';
    if(/\.aps$/.test(clean)) return 'aps';
    if(/\.(xdelta3?|vcdiff|vcd)$/.test(clean)) return 'vcdiff';
    return null;
  }
  const PATCH_FILE_RE = /\.(bps|ips|ups|ppf|aps|xdelta3?|vcdiff|vcd)$/i;
  const readU32LEAt = (b, off) => (b[off] | (b[off+1] << 8) | (b[off+2] << 16) | (b[off+3] << 24)) >>> 0;

  // The one place a patch is applied. Refuses to produce a file when the ROM is provably
  // wrong (BPS/UPS carry the source checksum, VCDIFF and APS-GBA check it while patching)
  // or when the result does not match the checksum the patch promises.
  function applyPatchStrict(kind, patch, rom){
    const notes = [];
    let source = rom;
    if(kind === 'bps' || kind === 'ups'){
      if(patch.length < 16) throw new Error('This patch is truncated.');
      if(crc32(patch.subarray(0, patch.length - 4)) !== readU32LEAt(patch, patch.length - 4))
        throw new Error("This patch file is damaged: its download looks incomplete or corrupted. Download it again and retry.");
      const expected = readU32LEAt(patch, patch.length - 12);
      if(crc32(source) !== expected){
        // Old SNES dumps often carry a 512-byte copier header the patch doesn't expect.
        if(rom.length > 512 && crc32(rom.subarray(512)) === expected){
          source = rom.subarray(512);
          notes.push('This ROM had a 512-byte copier header, so it was removed before patching (the patch expects the headerless dump).');
        }else{
          throw new Error(`This patch is for a different version of this game than the ROM you chose. It needs a ROM with checksum ${expected.toString(16).padStart(8, '0')}, but yours is ${crc32Hex(rom)}. Nothing was patched.`);
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
    if(result.targetMatches === false) throw new Error("The patched ROM didn't match the checksum this patch promises, so it was discarded. The patch or the ROM is not what it should be.");
    return { target: result.target, notes };
  }

  // Minimal ZIP reader. RAPatches stores almost every patch as "<RA game ID>-<Title>.zip",
  // usually the patch plus a readme. Entries are stored or deflated and the browser can
  // inflate deflate data itself, so no library is needed. 7z (LZMA) can't be done in the
  // browser, so those still fall back to a download link.
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
      if(typeof DecompressionStream === 'undefined') throw new Error("this browser can't unpack zips");
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error('unsupported zip compression');
  }

  // ROM Hacks panel UI
  // romhack.ing search link with the Title filter prefilled. It is a plain <a> navigation
  // rather than a fetch(), so the CORS and robots.txt problems that ruled out live-fetching
  // a description do not apply. Filters are a base64-encoded JSON array rather than the
  // plain queryString param (which is not field-scoped): index 8 is
  // {field:"title", operator:"must", value:<name>}, index 9 is the fixed
  // {field:"categories", operator:"must", value:"Hack"}. The search is prefilled but not
  // guaranteed exact, so the user can refine it there.
  function romhackSearchUrl(label){
    // Only the hack's name goes in the Title field: anything in brackets after it (a version number,
    // "(v2.2)", "[Beta]", even one cut off before its closing bracket) is dropped.
    const baseName = String(label || '').replace(/\.(bps|ips|ups|ppf|aps|xdelta3?|vcdiff|vcd|zip|7z|rar)$/i, '').replace(/^\d+[-_]/, '');
    // File names often squash the hack's title into one word ("KirbysHalloweenAdventure-Hack"),
    // which romhack.ing can't match. So: drop a "-Hack" tag, then put a space before each capital letter.
    const spaceOut = (str) => str
      .replace(/[-_\s]+hack(?=$|[-_\s(\[])/gi, ' ')       // "-Hack" / "_hack" / " Hack" as its own word
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')              // KirbysHalloween -> Kirbys Halloween
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')           // SMWHack... / ABCDef -> ABC Def (keeps acronyms together)
      .replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim();
    // File names can't hold apostrophes, so "Kirby's Halloween Adventure" arrives as "KirbysHalloweenAdventure".
    // Put it back for a possessive-looking first word: a capitalised word ending in "s" followed by another
    // capitalised word. Common plural-style words (and -ss / -us endings) are skipped so titles like
    // "Dragons Lair" or "Days of Thunder" aren't mangled.
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
    const title = addPossessive(spaceOut(baseName.replace(/\s*[(\[][^)\]]*[)\]]?/g, '')) || spaceOut(baseName));
    const filters = [null, null, null, null, null, null, null, null,
      { field: 'title', operator: 'must', value: title },
      { field: 'categories', operator: 'must', value: 'Hack' }
    ];
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(filters))));
    return `https://romhack.ing/search/hack?page=0&sortField=releaseDate&sortDirection=desc&queryString=&filters=${encodeURIComponent(b64)}`;
  }

  // ROM patch panel
  function setupRomPatchUI(gameId, title, card, consoleName){
    const patchBtn = card.querySelector('#modal-patch-btn');
    const patchWrap = card.querySelector('#modal-patch-panel');
    if(!patchBtn || !patchWrap) return;

    let opened = false;
    let branch = null;
    let romBytes = null;
    let romFilename = null;
    let romFromStorage = false;
    let romConvertedFrom = null; // 'v64' | 'n64' when an N64 dump was converted to .z64 order on load
    let romUnzippedFrom = null;  // zip file name when the ROM was unpacked from a zip
    let romLoadError = null;
    // Every way of loading a ROM goes through here: unzips it if it's a zip (the checksum has to be of
    // the ROM inside, not of the zip file), then converts N64 dumps to .z64 byte order.
    async function setRom(bytes, filename){
      romLoadError = null; romUnzippedFrom = null; romConvertedFrom = null;
      if(bytes && bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && (bytes[2] === 0x03 || bytes[2] === 0x05)){
        try{
          const notRom = /\.(txt|nfo|md|diz|url|htm|html|pdf|jpe?g|png|gif|ini|sfv|md5|sha1|xml|db)$/i;
          const entries = readZipEntries(bytes)
            .filter(e => !/\/$/.test(e.name) && !/^__MACOSX\//.test(e.name) && !notRom.test(e.name))
            .sort((x, y) => y.csize - x.csize); // the ROM is the biggest file in the zip
          if(!entries.length) throw new Error('there is no ROM file inside it');
          bytes = await extractZipEntry(bytes, entries[0]);
          romUnzippedFrom = filename;
          filename = entries[0].name.split('/').pop();
        }catch(e){
          romBytes = null; romFilename = null;
          romLoadError = `Couldn't open ${filename}: ${(e && e.message) || 'unknown error'}. Try extracting the ROM from the zip yourself and selecting that file.`;
          return;
        }
      }
      const n = n64ToBigEndian(bytes);
      romBytes = n.bytes;
      romConvertedFrom = n.converted;
      romFilename = n.converted ? String(filename || '').replace(/\.(v64|n64)$/i, '.z64') : filename;
    }
    let romFileHandle = null; // FileSystemFileHandle for the loaded ROM, when the File System Access API is available, lets "Save Patched ROM" default to the same folder
    let rememberRom = false;
    let results = null; // { official: [...], verified: [...], unverified: [...] }

    // Android Chrome supports the File System Access API; where it's missing (the Android
    // WebView, for one) this falls back to the classic <input type="file"> picker and
    // a plain <a download> link, which the Thor app saves to Downloads.
    const supportsFSAccess = !!(window.showOpenFilePicker && window.showSaveFilePicker);

    async function init(){
      const saved = await loadRom(gameId);
      if(saved){ await setRom(saved.bytes, saved.filename); romFromStorage = !!romBytes; }
      if(saved && romBytes && supportsFSAccess) romFileHandle = await loadRomHandle(gameId); // folder the ROM came from, remembered earlier
      renderRomStage();
    }

    // Step 1: get the ROM whose hash we're matching against
    function renderRomStage(){
      if(!romBytes){
        patchWrap.innerHTML = `
          ${romLoadError ? `<div class="hash-status mismatch" style="margin-bottom:10px;">${romLoadError}</div>` : ''}
          <p style="font-size:0.7688rem;color:var(--muted);margin:0 0 10px;line-height:1.55;">Select the ROM file for this game. Its checksum is what gets matched against the patch repo, so the results are patches actually compatible with your exact dump — not just anything with a similar name.</p>
          <input type="file" id="patch-rom-input" style="display:none;">
          <button class="guide-btn guide-btn-primary" id="patch-rom-pick-btn">Select ROM File…</button>
        `;
        const input = patchWrap.querySelector('#patch-rom-input');
        patchWrap.querySelector('#patch-rom-pick-btn').addEventListener('click', async () => {
          if(supportsFSAccess){
            try{
              const [handle] = await window.showOpenFilePicker({ excludeAcceptAllOption: false });
              const file = await handle.getFile();
              await setRom(new Uint8Array(await file.arrayBuffer()), file.name);
              romFromStorage = false;
              romFileHandle = romBytes ? handle : null;
              renderRomStage();
            }catch(e){
              if(e && e.name !== 'AbortError') input.click(); // picker unavailable for some reason, fall back
            }
            return;
          }
          input.click();
        });
        input.addEventListener('change', async () => {
          const file = input.files && input.files[0];
          if(!file) return;
          await setRom(new Uint8Array(await file.arrayBuffer()), file.name);
          romFromStorage = false;
          romFileHandle = null;
          renderRomStage();
        });
        return;
      }
      patchWrap.innerHTML = `
        <div style="font-size:0.7688rem;color:var(--text);">Base ROM: <strong>${romFilename}</strong></div>
        <div style="font-size:0.675rem;color:var(--muted);margin-top:2px;">CRC32 ${crc32Hex(romBytes)}</div>
        ${romUnzippedFrom ? `<div style="font-size:0.675rem;color:var(--muted);margin-top:2px;">Unpacked from ${romUnzippedFrom}, so the checksum is of the ROM itself.</div>` : ''}
        ${romConvertedFrom ? `<div style="font-size:0.675rem;color:var(--muted);margin-top:2px;">Converted from .${romConvertedFrom} to .z64 byte order, which is what patches and RetroAchievements expect. The patched ROM will be saved as .z64.</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="guide-btn guide-btn-ghost" id="patch-rom-change-btn">Use a different file…</button>
          ${romFromStorage ? '<button class="guide-btn guide-btn-danger" id="patch-rom-forget-btn">Forget saved ROM</button>' : ''}
        </div>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.75rem;color:var(--text);margin-top:10px;">
          <input type="checkbox" id="patch-remember-checkbox" style="width:15px;height:15px;flex-shrink:0;">
          <span>Remember this ROM for future patches of this game</span>
        </label>
        <div id="patch-remember-status" style="font-size:0.675rem;margin-top:4px;min-height:1em;"></div>
        <button class="guide-btn guide-btn-primary" id="patch-search-btn" style="width:100%;margin-top:12px;">Search RA Patches</button>
      `;
      patchWrap.querySelector('#patch-rom-change-btn').addEventListener('click', () => {
        romBytes = null; romFilename = null; romFromStorage = false; romFileHandle = null; renderRomStage();
      });
      const forgetBtn = patchWrap.querySelector('#patch-rom-forget-btn');
      if(forgetBtn) forgetBtn.addEventListener('click', async () => {
        await deleteRom(gameId);
        romBytes = null; romFilename = null; romFromStorage = false; romFileHandle = null;
        renderRomStage();
      });
      const rememberCheckbox = patchWrap.querySelector('#patch-remember-checkbox');
      const rememberStatus = patchWrap.querySelector('#patch-remember-status');
      rememberCheckbox.addEventListener('change', async () => {
        rememberRom = rememberCheckbox.checked;
        if(rememberRom && !romFromStorage){
          rememberStatus.textContent = 'Saving…';
          try{
            await saveRom(gameId, romFilename, romBytes); await saveRomHandle(gameId, romFileHandle);
            romFromStorage = true;
            rememberStatus.textContent = 'Saved on this device.';
          }catch(e){
            rememberStatus.textContent = "Couldn't save — this ROM may be too large for storage.";
            rememberCheckbox.checked = false;
            rememberRom = false;
          }
        }else if(!rememberRom){
          rememberStatus.textContent = '';
        }
      });
      patchWrap.querySelector('#patch-search-btn').addEventListener('click', async () => {
        rememberRom = !!(rememberCheckbox && rememberCheckbox.checked);
        if(rememberRom && !romFromStorage){
          try{ await saveRom(gameId, romFilename, romBytes); await saveRomHandle(gameId, romFileHandle); romFromStorage = true; }catch(e){ /* non-fatal */ }
        }
        runSearch();
      });
    }

    // Step 2: search RA Patches by checksum, not filename.
    // 1) Ask RA for any patch it has linked to this exact game entry (API_GetGameHashes
    //    PatchUrl). Authoritative when present.
    // 2) Scan the RAPatches repo. Every BPS/UPS file under this game's console folder has its
    //    embedded source CRC32 read (a Range request for just the footer) and compared to this
    //    ROM's CRC32. Matches come back "Verified" whatever they are named.
    // IPS patches have no checksum, so they are listed separately as unverified, ranked by
    // filename relevance only.
    //
    // Hacks get their own checking budget. RAPatches only requires a hack patch to be named
    // after the hack (e.g. "SMW - Super Marina World (v2.2.01) (kona).bps"), so it may share
    // just one word with the base game's title, while the base game's own translations and
    // fixes score perfectly and short common words ("Super", "World") tie with real hack
    // candidates. With one pooled, title-scored, capped list, hacks were the first thing
    // crowded out. The ".../Hacks/..." folder is a more reliable signal than filename overlap,
    // so hacks are checked as their own category, sized generously since each check is one
    // 12-byte range request.
    const MAX_CHECKED_HACKS = 1500;
    const MAX_CHECKED_OTHER = 500;
    const isHacksPath = (p) => /(^|\/)hacks\//i.test(p);
    async function runSearch(){
      patchWrap.innerHTML = '<div class="achievements-list-loading">Checking RetroAchievements…</div>';
      try{
        const romCrc = crc32(romBytes);
        let official = await fetchOfficialPatches();

        patchWrap.innerHTML = '<div class="achievements-list-loading">Reading the RAPatches file list…</div>';
        const tree = await getRAPatchesTree();
        branch = tree.branch;

        // RA often links its patches through github.com (".../raw/main/..."), which redirects to
        // raw.githubusercontent.com but sends no CORS headers, so the browser refuses to fetch it
        // ("NetworkError"). When the linked file is one we can see in the RAPatches repo, point the
        // official entry at the raw.githubusercontent.com copy of that exact same file instead.
        official = official.map(o => {
          let decoded = o.url;
          try{ decoded = decodeURIComponent(o.url); }catch(e){}
          const hit = tree.files
            .filter(f => decoded.endsWith('/' + f.path) || decoded.endsWith(f.path))
            .sort((a, b) => b.path.length - a.path.length)[0];
          return hit ? { ...o, url: fetchRAPatchUrl(tree.branch, hit.path), path: hit.path } : o;
        });

        let pool = consoleFolderCandidates(tree.files, consoleName);
        let usedFallback = false;
        if(!pool || pool.length === 0){
          // Couldn't confidently resolve this console's folder, fall back
          // to the old filename-only search rather than showing nothing.
          pool = searchRAPatches(tree.files, title, 80).map(c => ({ path: c.path }));
          usedFallback = true;
        }

        // Files whose enclosing folder matches the game's title come first, that's the
        // strongest signal on a console with many unrelated games' patches, then by
        // filename word overlap, then shortest path as a final tiebreak.
        const ranked = scoreForOrdering(pool, title)
          .sort((a, b) => (b.inFolder - a.inFolder) || b.score - a.score || a.path.length - b.path.length);
        const bpsUpsAll = ranked.filter(c => /\.(bps|ups)$/i.test(c.path));
        const ipsAll = ranked.filter(c => /\.(ips|ppf|aps|xdelta3?|vcdiff|vcd)$/i.test(c.path)); // formats with no checksum to pre-check
        const zipAll = ranked.filter(c => /\.(zip|7z)$/i.test(c.path)); // most RAPatches files are zips; checked after download, not up front

        // Split into Hacks vs everything else *before* capping, so each
        // category draws from its own budget instead of competing for one
        // shared list of slots.
        const hacksAll = bpsUpsAll.filter(c => isHacksPath(c.path));
        const otherAll = bpsUpsAll.filter(c => !isHacksPath(c.path));
        const hacksCandidates = hacksAll.slice(0, MAX_CHECKED_HACKS);
        const otherCandidates = otherAll.slice(0, MAX_CHECKED_OTHER);
        const bpsUpsCandidates = hacksCandidates.concat(otherCandidates);
        const capped = hacksAll.length > hacksCandidates.length || otherAll.length > otherCandidates.length;

        const checked = await mapWithConcurrency(bpsUpsCandidates, 14, async (c) => {
          const srcCrc = await fetchPatchSourceCrc32(branch, c.path);
          return { path: c.path, matches: srcCrc !== null && srcCrc === romCrc };
        }, (done, total) => {
          patchWrap.innerHTML = `<div class="achievements-list-loading">Checking patch checksums… (${done}/${total})</div>`;
        });
        const verified = checked.filter(c => c && c.matches).map(c => ({
          label: c.path.split('/').pop(), path: c.path, url: fetchRAPatchUrl(branch, c.path),
        }));

        // RAPatches names its files "<RA game ID>-<Title>" (e.g. 12736-SMWLearn2Kaizo.zip), so
        // anything starting with this game's own ID is listed for exactly this game.
        // No checksum scan or console-folder guess is needed for that.
        const idPrefix = String(gameId) + '-';
        const isOfficialDup = (path) => official.some(o => {
          try{ return decodeURIComponent(o.url).endsWith(path); }catch(e){ return false; }
        });
        const byId = tree.files
          .filter(f => f.path.split('/').pop().startsWith(idPrefix) && !isOfficialDup(f.path))
          .map(f => ({ label: f.path.split('/').pop(), path: f.path, url: fetchRAPatchUrl(branch, f.path) }));
        const idPaths = new Set(byId.map(b => b.path));

        const officialPaths = new Set(official.map(o => o.url));
        const verifiedDeduped = verified.filter(v => !officialPaths.has(v.url) && !idPaths.has(v.path));

        // IPS/zip patches have no checksum, so filename/folder relevance is all that keeps
        // unrelated games' hacks (Metroid patches while searching for Mario) out of the list.
        // Require every word of the title in the filename (score === 1); one shared word like
        // "Super" would match every other "Super ___" game on the console. inFolder stands on
        // its own because the folder-per-game layout is reliable even when the file is just
        // "<RA ID>-Abbrev.ext".
        const noPreCheck = ipsAll.concat(zipAll).filter(c => c.inFolder || c.score === 1);
        const unverifiedPicks = noPreCheck.filter(c => !idPaths.has(c.path) && !officialPaths.has(fetchRAPatchUrl(branch, c.path)) && !isOfficialDup(c.path));

        const byLabel = (a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true });

        results = {
          official: official.slice().sort(byLabel),
          byId: byId.slice().sort(byLabel),
          verified: verifiedDeduped.slice().sort(byLabel),
          unverified: unverifiedPicks.map(c => ({ label: c.path.split('/').pop(), path: c.path, url: fetchRAPatchUrl(branch, c.path) })).sort(byLabel),
          usedFallback,
          capped,
        };
        renderResults();
      }catch(e){
        patchWrap.innerHTML = `<div class="achievements-list-loading">Search failed: ${e.message}</div><button class="guide-btn guide-btn-ghost" id="patch-retry-btn" style="margin-top:8px;width:100%;">Try again</button>`;
        patchWrap.querySelector('#patch-retry-btn').addEventListener('click', runSearch);
      }
    }

    async function fetchOfficialPatches(){
      try{
        const data = await raFetch('API_GetGameHashes.php', { i: gameId });
        const list = (data && (data.Results || data.results)) || [];
        return list
          .filter(r => (r.PatchUrl || r.patchUrl))
          .map(r => {
            let url = r.PatchUrl || r.patchUrl;
            if(url.startsWith('http://')) url = 'https://' + url.slice(7); // avoid a silent https-page-fetching-http block
            // github.com/<owner>/<repo>/(raw|blob)/<ref>/<path> -> raw.githubusercontent.com (which allows cross-origin fetches)
            const gh = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:raw|blob)\/(?:refs\/heads\/)?(.+)$/);
            if(gh) url = `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3].split('?')[0]}`;
            return { label: url.split('/').pop(), url };
          });
      }catch(e){
        return []; // non-fatal, the repo scan below still runs
      }
    }

    function fetchRAPatchUrl(branch_, path){
      return `https://raw.githubusercontent.com/${RAPATCHES_OWNER}/${RAPATCHES_REPO}/${branch_}/${path.split('/').map(encodeURIComponent).join('/')}`;
    }

    function patchKindFromUrl(url){
      return patchKindFromName(url) || 'archive'; // .zip, .7z, .rar, etc., needs unpacking first
    }

    function resultRow(entry, badge, idx, group){
      return `
        <div class="patch-result-row">
          <div class="info"><div class="fn">${entry.label}</div><div class="pth">${badge}</div></div>
          <a class="patch-info-link" href="${romhackSearchUrl(entry.label)}" target="_blank" rel="noopener">What does it do? ↗</a>
          <button data-group="${group}" data-idx="${idx}">Use</button>
        </div>
      `;
    }

    function renderResults(){
      const totalCount = results.official.length + results.byId.length + results.verified.length + results.unverified.length;
      const fallbackNote = (results.usedFallback && !results.byId.length)
        ? `<p style="font-size:0.6875rem;color:var(--muted);margin:0 0 8px;line-height:1.5;">Couldn't confidently identify this console's folder in the repo, so this fell back to a filename-only search — hacks with unrelated names may be missing.</p>`
        : '';
      const cappedNote = results.capped
        ? `<p style="font-size:0.6875rem;color:var(--muted);margin:0 0 8px;line-height:1.5;">This console has more patches than could be checked in one pass — up to ${MAX_CHECKED_HACKS} hacks and ${MAX_CHECKED_OTHER} other patches (translations, fixes, etc.) were checked. Try the manual browse link below if you don't see the one you're after.</p>`
        : '';
      if(totalCount === 0){
        patchWrap.innerHTML = `
          ${fallbackNote}${cappedNote}
          <p style="font-size:0.7688rem;color:var(--muted);margin:0 0 10px;line-height:1.55;">Nothing in the RAPatches repo is filed under this game's RetroAchievements ID, no loose patch matches this ROM's checksum, no zip for this game/console was found either, and RetroAchievements has nothing officially linked to this entry either. If you're after a specific hack, double check you're on that hack's own RetroAchievements game page rather than the base game's.</p>
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
        <div style="margin-top:10px;">${fallbackNote}${cappedNote}</div>
        <div id="patch-result-list-wrap"></div>
      `;
      patchWrap.querySelector('#patch-back-btn').addEventListener('click', renderRomStage);

      const listWrap = patchWrap.querySelector('#patch-result-list-wrap');
      const filterInput = patchWrap.querySelector('#patch-filter-input');

      function renderList(){
        const q = filterInput.value.trim().toLowerCase();
        const matches = (m) => !q || m.label.toLowerCase().includes(q);
        const officialRows = results.official.filter(matches);
        const byIdRows = results.byId.filter(matches);
        const verifiedRows = results.verified.filter(matches);
        const unverifiedRows = results.unverified.filter(matches);

        if(officialRows.length + byIdRows.length + verifiedRows.length + unverifiedRows.length === 0){
          listWrap.innerHTML = `<p style="font-size:0.7688rem;color:var(--muted);margin:8px 0 0;">No hacks match “${filterInput.value.trim()}”.</p>`;
          return;
        }

        listWrap.innerHTML = `
          <div class="patch-result-list">
            ${officialRows.map(m => resultRowByUrl(m, 'Official — linked by RetroAchievements', 'official')).join('')}
            ${byIdRows.map(m => resultRowByUrl(m, 'Listed for this exact game (RetroAchievements game ID)', 'byId')).join('')}
            ${verifiedRows.map(m => resultRowByUrl(m, 'Verified — checksum matches this ROM', 'verified')).join('')}
            ${unverifiedRows.map(m => resultRowByUrl(m, /\.(zip|7z)$/i.test(m.path) ? 'Not checked yet — matched by name; downloading it checks the patch(es) inside' : 'Unverified — this format has no checksum to check up front', 'unverified')).join('')}
          </div>
        `;
        listWrap.querySelectorAll('.patch-result-row button').forEach(btn => {
          btn.addEventListener('click', () => {
            const url = decodeURIComponent(btn.dataset.url);
            const group = btn.dataset.group;
            const entry = results[group].find(e => e.url === url);
            // Only "official" (RA-linked) and "byId" (filename tagged with this exact
            // RA game ID) unambiguously target this game's own gameId, "verified" and
            // "unverified" entries can belong to a hack with its own, different RA ID,
            // so there's nothing correct to check their result against here.
            const verifyGameId = (group === 'official' || group === 'byId') ? gameId : null;
            if(entry) selectAndApply(entry, verifyGameId);
          });
        });
      }

      filterInput.addEventListener('input', renderList);
      renderList();
    }

    // Same row markup as resultRow above, but keyed by URL instead of array
    // index, needed here because the visible rows are a filtered (searched)
    // subset of results[group], so their positions no longer match that
    // array's real indices.
    function resultRowByUrl(entry, badge, group){
      return `
        <div class="patch-result-row">
          <div class="info"><div class="fn">${entry.label}</div><div class="pth">${badge}</div></div>
          <a class="patch-info-link" href="${romhackSearchUrl(entry.label)}" target="_blank" rel="noopener">What does it do? ↗</a>
          <button data-group="${group}" data-url="${encodeURIComponent(entry.url)}">Use</button>
        </div>
      `;
    }

    // Steps 4-6: pick a result, patch it, hand back the file
    function showArchiveFallback(entry, reason){
      patchWrap.innerHTML = `
        <button class="guide-btn guide-btn-ghost" id="patch-back-btn">‹ Back to results</button>
        <p style="font-size:0.7688rem;color:var(--muted);margin:10px 0 0;line-height:1.55;">${reason} Only BPS, IPS, UPS, PPF, APS and xdelta patches are applied automatically here. You'll need a separate tool for this one.</p>
        <a class="guide-btn guide-btn-primary" style="margin-top:10px;" href="${entry.url}" download="${entry.label}">Download patch file</a>
      `;
      patchWrap.querySelector('#patch-back-btn').addEventListener('click', renderResults);
    }

    async function selectAndApply(entry, verifyGameId){
      patchWrap.innerHTML = '<div class="achievements-list-loading">Downloading patch…</div>';
      try{
        const kind = patchKindFromUrl(entry.url);
        const isZip = /\.zip$/i.test((entry.url || '').split('?')[0]);
        if(kind === 'archive' && !isZip){
          showArchiveFallback(entry, "This patch is packed in a 7z/rar archive, which isn't unpacked automatically here.");
          return;
        }

        const resp = await fetch(entry.url);
        if(!resp.ok) throw new Error(`Could not download that patch (${resp.status}).`);
        const bytes = new Uint8Array(await resp.arrayBuffer());

        if(isZip){ await applyFromZip(entry, bytes, verifyGameId); return; }
        await applyPatchBytes(entry.label, kind, bytes, verifyGameId);
      }catch(e){
        patchWrap.innerHTML = `<div class="achievements-list-loading">Could not apply that patch: ${e.message}</div><button class="guide-btn guide-btn-ghost" id="patch-back-btn" style="margin-top:8px;width:100%;">‹ Back to results</button>`;
        patchWrap.querySelector('#patch-back-btn').addEventListener('click', renderResults);
      }
    }

    // Opens a downloaded zip, finds the BPS/IPS/UPS patch(es) inside, and applies the one
    // that matches this ROM. If it can't tell (several patches, or IPS which has no
    // checksum), it lets the person pick.
    async function applyFromZip(entry, zipBytes, verifyGameId){
      let items = [];
      try{
        const entries = readZipEntries(zipBytes).filter(e =>
          PATCH_FILE_RE.test(e.name) && !/(^|\/)__MACOSX\//.test(e.name) && !e.name.endsWith('/'));
        if(!entries.length){
          showArchiveFallback(entry, "This zip doesn't contain a BPS, IPS or UPS patch that can be applied automatically.");
          return;
        }
        const romCrcs = [crc32(romBytes)];
        if(romBytes.length > 512) romCrcs.push(crc32(romBytes.subarray(512))); // headerless version of the same dump
        for(const pe of entries){
          const data = await extractZipEntry(zipBytes, pe);
          const kind = patchKindFromName(pe.name);
          let matches = null; // only BPS/UPS carry a checksum that can be compared up front
          if((kind === 'bps' || kind === 'ups') && data.length >= 12){
            matches = romCrcs.includes(readU32LEAt(data, data.length - 12));
          }
          items.push({ label: pe.name.split('/').pop(), kind, data, matches });
        }
      }catch(e){
        showArchiveFallback(entry, `Couldn't unpack this zip (${e.message}).`);
        return;
      }
      const matched = items.filter(i => i.matches === true);
      if(items.length === 1 || matched.length === 1){
        const pick = items.length === 1 ? items[0] : matched[0];
        await applyPatchBytes(pick.label, pick.kind, pick.data, verifyGameId);
        return;
      }
      items.sort((a, b) => (b.matches === true) - (a.matches === true));
      patchWrap.innerHTML = `
        <button class="guide-btn guide-btn-ghost" id="patch-back-btn">‹ Back to results</button>
        <p style="font-size:0.7688rem;color:var(--muted);margin:10px 0;line-height:1.55;">This zip has more than one patch. Pick the one to apply.</p>
        <div class="patch-result-list">
          ${items.map((m, idx) => resultRow(m,
            m.matches === true ? 'Checksum matches this ROM' : (m.matches === false ? "Checksum doesn't match this ROM" : 'No checksum to check up front'),
            idx, 'zip')).join('')}
        </div>
      `;
      patchWrap.querySelector('#patch-back-btn').addEventListener('click', renderResults);
      patchWrap.querySelectorAll('.patch-result-row button').forEach(btn => {
        btn.addEventListener('click', () => {
          const it = items[Number(btn.dataset.idx)];
          applyPatchBytes(it.label, it.kind, it.data, verifyGameId);
        });
      });
    }

    async function applyPatchBytes(label, kind, patchBytes, verifyGameId){
      try{
        patchWrap.innerHTML = '<div class="achievements-list-loading">Applying patch…</div>';
        await new Promise(r => setTimeout(r, 30)); // let the message paint before the heavy work
        const { target, notes } = applyPatchStrict(kind, patchBytes, romBytes);

        let raCheck = null;
        if(verifyGameId){
          patchWrap.innerHTML = '<div class="achievements-list-loading">Verifying against RetroAchievements…</div>';
          raCheck = await verifyAgainstRaHash(verifyGameId, target, consoleName);
        }

        const blob = new Blob([target], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const romExtMatch = /\.[^./\\]+$/.exec(romFilename || '');
        const romExt = romExtMatch ? romExtMatch[0] : '';
        const outName = (label.replace(PATCH_FILE_RE, '') || 'patched-rom') + romExt;

        if(rememberRom && !romFromStorage){
          try{ await saveRom(gameId, romFilename, romBytes); await saveRomHandle(gameId, romFileHandle); romFromStorage = true; }catch(e){ /* non-fatal */ }
        }

        const saveHint = supportsFSAccess && romFileHandle
          ? 'The save dialog opens in the same folder as the ROM you loaded.'
          : (supportsFSAccess ? 'Pick a folder to save it in.' : 'It downloads to your browser\'s default download folder.');

        patchWrap.innerHTML = `
          ${notes.map(n => `<div class="hash-status ok" style="margin-top:8px;">${n}</div>`).join('')}
          ${raCheck ? `<div class="hash-status ${raCheck.cls}" style="margin-top:8px;">${raCheck.text}</div>` : ''}
          <div class="hash-status ok" style="margin-top:8px;">Your ROM has been patched and saved as <strong>${outName}</strong>. Open it in your emulator to add this game to your RetroAchievements library.</div>
          <button class="guide-btn guide-btn-primary" id="patch-download-btn" style="margin-top:10px;width:100%;">${supportsFSAccess ? 'Save Patched ROM…' : 'Download Patched ROM'}</button>
          <div style="font-size:0.675rem;color:var(--muted);margin-top:4px;">${saveHint}</div>
          <button class="guide-btn guide-btn-ghost" id="patch-back-btn" style="width:100%;margin-top:8px;">‹ Back to results</button>
        `;
        patchWrap.querySelector('#patch-download-btn').addEventListener('click', async () => {
          if(supportsFSAccess){
            try{
              const pickerOpts = { suggestedName: outName };
              if(romExt){
                pickerOpts.types = [{ description: 'ROM file', accept: { 'application/octet-stream': [romExt] } }];
              }
              if(romFileHandle) pickerOpts.startIn = romFileHandle; // opens the picker in the same folder as the loaded ROM
              let handle;
              try{
                handle = await window.showSaveFilePicker(pickerOpts);
              }catch(err){
                // The remembered folder may have been moved/deleted, retry once without it
                // rather than falling through to a plain download.
                if(err && err.name !== 'AbortError' && pickerOpts.startIn){
                  delete pickerOpts.startIn;
                  handle = await window.showSaveFilePicker(pickerOpts);
                }else throw err;
              }
              const writable = await handle.createWritable();
              await writable.write(target);
              await writable.close();
              // No ROM folder known yet (e.g. a ROM remembered before folders were stored)? Use the
              // folder just saved to from now on, and keep it for next time.
              if(!romFileHandle){
                romFileHandle = handle;
                if(romFromStorage) await saveRomHandle(gameId, handle);
              }
              return;
            }catch(e){
              if(e && e.name === 'AbortError') return; // user cancelled the save dialog, not an error
              // Otherwise fall through to the classic download below.
            }
          }
          const a = document.createElement('a');
          a.href = url; a.download = outName;
          document.body.appendChild(a); a.click(); a.remove();
        });
        patchWrap.querySelector('#patch-back-btn').addEventListener('click', renderResults);
      }catch(e){
        patchWrap.innerHTML = `<div class="achievements-list-loading">Could not apply that patch: ${e.message}</div><button class="guide-btn guide-btn-ghost" id="patch-back-btn" style="margin-top:8px;width:100%;">‹ Back to results</button>`;
        patchWrap.querySelector('#patch-back-btn').addEventListener('click', renderResults);
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
