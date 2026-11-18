// A small in-memory stand-in for Firestore, covering only what this app uses. It is used by the
// automated tests when the emulators aren't running, and by the quick-look demo (npm run demo).
// It enforces the Firestore behaviours that matter for correctness: create() fails if the document
// exists, update() fails if it doesn't, transactions must read before they write, documents must be
// under 1 MiB, and 'in' filters take at most 30 values. The real Firestore emulator remains the
// reference: `npm test` uses it whenever it is running.

const MAX_DOC_BYTES = 1048576;
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const err = (code, msg) => Object.assign(new Error(msg), { code });
const getField = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
let autoN = 0;
const autoId = () => (Date.now().toString(36) + (autoN++).toString(36) + Math.random().toString(36).slice(2, 10)).padEnd(20, '0').slice(0, 20);

function stripUndefined(v) {
  if (Array.isArray(v)) return v.map(stripUndefined);
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = stripUndefined(x); return o; }
  return v;
}
function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) deepMerge(target[k], v);
    else target[k] = clone(v);
  }
  return target;
}

class Snapshot {
  constructor(ref, data) { this.ref = ref; this.id = ref.id; this._d = data; this.exists = data !== undefined; }
  data() { return clone(this._d); }
  get(f) { return clone(getField(this._d, f)); }
}
class QuerySnapshot {
  constructor(docs) { this.docs = docs; this.size = docs.length; this.empty = docs.length === 0; }
  forEach(fn) { this.docs.forEach(fn); }
}

export class MemoryFirestore {
  constructor() { this.store = new Map(); this._lock = Promise.resolve(); }
  collection(path) { return new CollectionRef(this, path); }
  doc(path) { const i = path.lastIndexOf('/'); return new DocRef(this, path.slice(0, i), path.slice(i + 1)); }
  settings() {}
  async getAll(...refs) { return refs.map(r => new Snapshot(r, clone(this.store.get(r.path)))); }
  batch() { return new WriteBatch(this); }
  _write(op, ref, data, opts) {
    const cur = this.store.get(ref.path);
    if (op === 'create' && cur !== undefined) throw err(6, `ALREADY_EXISTS: ${ref.path}`);
    if (op === 'update' && cur === undefined) throw err(5, `NOT_FOUND: ${ref.path}`);
    if (op === 'delete') { this.store.delete(ref.path); return; }
    let next;
    data = stripUndefined(data);
    if (op === 'update') {
      next = clone(cur);
      for (const [k, v] of Object.entries(data)) {
        const parts = k.split('.'); let o = next;
        for (let i = 0; i < parts.length - 1; i++) { if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {}; o = o[parts[i]]; }
        o[parts[parts.length - 1]] = clone(v);
      }
    } else if (op === 'set' && opts && opts.merge && cur !== undefined) next = deepMerge(clone(cur), data);
    else next = clone(data);
    const nested = v => Array.isArray(v) ? v.some(x => Array.isArray(x) || nested(x)) : v && typeof v === 'object' ? Object.values(v).some(nested) : false;
    if (nested(next)) throw err(3, `INVALID_ARGUMENT: Firestore does not support arrays directly inside arrays (${ref.path})`);
    const size = Buffer.byteLength(JSON.stringify(next));
    if (size > MAX_DOC_BYTES) throw err(3, `INVALID_ARGUMENT: document ${ref.path} is ${size} bytes, over Firestore's 1 MiB limit`);
    this.store.set(ref.path, next);
  }
  _validate(op, ref, data, opts) {
    const cur = this.store.get(ref.path);
    if (op === 'create' && cur !== undefined) throw err(6, `ALREADY_EXISTS: ${ref.path}`);
    if (op === 'update' && cur === undefined) throw err(5, `NOT_FOUND: ${ref.path}`);
  }
  async runTransaction(fn) {
    // Transactions run one at a time, which gives the same outcome as Firestore's retry-on-conflict.
    const prev = this._lock; let release;
    this._lock = new Promise(r => { release = r; });
    await prev;
    try {
      const t = new Transaction(this);
      const out = await fn(t);
      for (const w of t.writes) this._validate(w[0], w[1], w[2], w[3]);
      for (const w of t.writes) this._write(...w);
      return out;
    } finally { release(); }
  }
}

class Query {
  constructor(db, path, filters = [], order = null, lim = null) { this.db = db; this.path = path; this.filters = filters; this.order = order; this.lim = lim; }
  where(field, op, value) {
    if ((op === 'in' || op === 'array-contains-any') && (!Array.isArray(value) || value.length > 30)) throw err(3, "'in' filters take 1 to 30 values");
    return new Query(this.db, this.path, [...this.filters, [field, op, value]], this.order, this.lim);
  }
  orderBy(field, dir = 'asc') { return new Query(this.db, this.path, this.filters, [field, dir], this.lim); }
  limit(n) { return new Query(this.db, this.path, this.filters, this.order, n); }
  async get() {
    const prefix = this.path + '/';
    let docs = [];
    for (const [p, d] of this.db.store) {
      if (!p.startsWith(prefix) || p.slice(prefix.length).includes('/')) continue;
      if (this.filters.every(([f, op, v]) => match(getField(d, f), op, v))) docs.push(new Snapshot(new DocRef(this.db, this.path, p.slice(prefix.length)), clone(d)));
    }
    if (this.order) {
      const [f, dir] = this.order;
      docs = docs.filter(s => getField(s._d, f) !== undefined)
        .sort((a, b) => { const x = getField(a._d, f), y = getField(b._d, f); return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1); });
    }
    if (this.lim != null) docs = docs.slice(0, this.lim);
    return new QuerySnapshot(docs);
  }
}
function match(a, op, v) {
  switch (op) {
    case '==': return JSON.stringify(a) === JSON.stringify(v);
    case '!=': return a !== undefined && JSON.stringify(a) !== JSON.stringify(v);
    case '<': return a !== undefined && a < v;
    case '<=': return a !== undefined && a <= v;
    case '>': return a !== undefined && a > v;
    case '>=': return a !== undefined && a >= v;
    case 'in': return v.some(x => JSON.stringify(x) === JSON.stringify(a));
    case 'array-contains': return Array.isArray(a) && a.some(x => JSON.stringify(x) === JSON.stringify(v));
    default: throw err(3, `Unsupported operator ${op}`);
  }
}
class CollectionRef extends Query {
  constructor(db, path) { super(db, path); this.id = path.split('/').pop(); }
  doc(id) { return new DocRef(this.db, this.path, id || autoId()); }
  async add(data) { const r = this.doc(); this.db._write('create', r, data); return r; }
}
class DocRef {
  constructor(db, parent, id) { this.db = db; this.parentPath = parent; this.id = id; this.path = `${parent}/${id}`; }
  collection(name) { return new CollectionRef(this.db, `${this.path}/${name}`); }
  async get() { return new Snapshot(this, clone(this.db.store.get(this.path))); }
  async set(d, o) { this.db._write('set', this, d, o); }
  async create(d) { this.db._write('create', this, d); }
  async update(d) { this.db._write('update', this, d); }
  async delete() { this.db._write('delete', this); }
}
class Transaction {
  constructor(db) { this.db = db; this.writes = []; }
  async get(refOrQuery) {
    if (this.writes.length) throw err(3, 'Firestore transactions require all reads to be executed before all writes.');
    return refOrQuery instanceof DocRef ? refOrQuery.get() : refOrQuery.get();
  }
  async getAll(...refs) { if (this.writes.length) throw err(3, 'Firestore transactions require all reads to be executed before all writes.'); return this.db.getAll(...refs); }
  set(r, d, o) { this.writes.push(['set', r, d, o]); return this; }
  create(r, d) { this.writes.push(['create', r, d]); return this; }
  update(r, d) { this.writes.push(['update', r, d]); return this; }
  delete(r) { this.writes.push(['delete', r]); return this; }
}
class WriteBatch {
  constructor(db) { this.db = db; this.writes = []; }
  set(r, d, o) { this.writes.push(['set', r, d, o]); return this; }
  create(r, d) { this.writes.push(['create', r, d]); return this; }
  update(r, d) { this.writes.push(['update', r, d]); return this; }
  delete(r) { this.writes.push(['delete', r]); return this; }
  async commit() { for (const w of this.writes) this.db._validate(w[0], w[1], w[2], w[3]); for (const w of this.writes) this.db._write(...w); }
}
