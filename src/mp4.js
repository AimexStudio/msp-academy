// Reads a video's duration from its MP4/MOV header (the 'mvhd' box), so the server, not the
// browser, knows how long each training video is when it checks the 85% watch rule.
export function mp4Duration(buf) {
  const walk = (start, end, depth) => {
    let pos = start;
    while (pos + 8 <= end) {
      let size = buf.readUInt32BE(pos);
      const type = buf.toString('latin1', pos + 4, pos + 8);
      let header = 8;
      if (size === 1) { size = Number(buf.readBigUInt64BE(pos + 8)); header = 16; }
      else if (size === 0) size = end - pos;
      if (size < header) return null;
      if (type === 'moov' && depth === 0) return walk(pos + header, Math.min(pos + size, end), 1);
      if (type === 'mvhd' && depth === 1) {
        const b = pos + header;
        const v1 = buf[b] === 1;
        const timescale = v1 ? buf.readUInt32BE(b + 20) : buf.readUInt32BE(b + 12);
        const duration = v1 ? Number(buf.readBigUInt64BE(b + 24)) : buf.readUInt32BE(b + 16);
        return timescale ? duration / timescale : null;
      }
      pos += size;
    }
    return null;
  };
  try { return walk(0, buf.length, 0); } catch { return null; }
}
