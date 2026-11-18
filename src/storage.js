// PDFs, videos and signature images, stored by content hash and never overwritten,
// so a frozen document version always points at exactly the bytes staff saw.
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

const hashOf = buf => crypto.createHash('sha256').update(buf).digest('hex');

/** Cloud Storage (or its emulator). */
export function createBucketStorage(bucket) {
  return {
    async putBuffer(buf, contentType, prefix = 'files') {
      const sha256 = hashOf(buf);
      const key = `${prefix}/${sha256.slice(0, 2)}/${sha256}`;
      const f = bucket.file(key);
      const [exists] = await f.exists();
      if (!exists) await f.save(buf, { contentType, resumable: false, metadata: { cacheControl: 'private, max-age=3600' } });
      return { key, size: buf.length, sha256 };
    },
    read(key, range) { return bucket.file(key).createReadStream(range ? { start: range.start, end: range.end } : undefined); },
    async getBuffer(key) { const [b] = await bucket.file(key).download(); return b; },
  };
}

/** In memory, for the automated tests and the quick-look demo. Nothing is saved. */
export function createMemoryStorage() {
  const files = new Map();
  return {
    async putBuffer(buf, contentType, prefix = 'files') {
      const sha256 = hashOf(buf);
      const key = `${prefix}/${sha256.slice(0, 2)}/${sha256}`;
      if (!files.has(key)) files.set(key, Buffer.from(buf));
      return { key, size: buf.length, sha256 };
    },
    read(key, range) { const b = files.get(key); return Readable.from([range ? b.subarray(range.start, range.end + 1) : b]); },
    async getBuffer(key) { return files.get(key); },
  };
}
