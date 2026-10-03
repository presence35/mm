/*
 * Minimal in-memory IndexedDB.
 *
 * Test-only. Production code must not gain a port just so a fake can be
 * injected (architecture.md: two real implementations or none) — so the shim
 * installs a global instead, and the real store code runs unmodified.
 */
class Req {
  constructor() {
    this.onsuccess = null
    this.onerror = null
  }
  _ok(result) {
    queueMicrotask(() => {
      this.result = result
      this.onsuccess?.({ target: this })
    })
    return this
  }
  _err(error) {
    queueMicrotask(() => {
      this.error = error
      this.onerror?.({ target: this })
    })
    return this
  }
}

class Store {
  constructor(name, keyPath, data) {
    this.name = name
    this.keyPath = keyPath
    this.data = data
    this.rows = new Map()
  }
  put(row) {
    const key = row[this.keyPath]
    this.rows.set(key, structuredClone(row))
    return new Req()._ok(key)
  }
  get(key) {
    const row = this.rows.get(key)
    return new Req()._ok(row ? structuredClone(row) : undefined)
  }
  getAll() {
    return new Req()._ok([...this.rows.values()].map((r) => structuredClone(r)))
  }
  delete(key) {
    this.rows.delete(key)
    return new Req()._ok(undefined)
  }
  clear() {
    this.rows.clear()
    return new Req()._ok(undefined)
  }
  count() {
    return new Req()._ok(this.rows.size)
  }
}

function installIndexedDB() {
  const dbs = new Map()

  const makeReq = () => {
    const r = new Req()
    r.onupgradeneeded = null
    r.onblocked = null
    return r
  }

  const db = {
    objectStoreNames: {
      contains: (n) => (dbs.get(db.name)?.stores.has(n) ?? false),
      [Symbol.iterator]: function* () {
        yield* (dbs.get(db.name)?.stores.keys() ?? [])
      },
      get length() {
        return dbs.get(db.name)?.stores.size ?? 0
      },
    },
    createObjectStore(name, { keyPath }) {
      dbs.get(db.name).stores.set(name, new Store(name, keyPath))
      return dbs.get(db.name).stores.get(name)
    },
    transaction(names, mode) {
      const t = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore: (name) => dbs.get(db.name).stores.get(name),
      }
      /* A macrotask, not a microtask: every request the caller registers
         synchronously must have had its onsuccess fire first. Real IndexedDB
         does not complete until all of them have. */
      setTimeout(() => t.oncomplete?.(), 0)
      return t
    },
    close() {},
  }

  globalThis.indexedDB = {
    open(name, version) {
      const req = makeReq()
      queueMicrotask(() => {
        if (!dbs.has(name)) dbs.set(name, { name, version: 0, stores: new Map() })
        const rec = dbs.get(name)
        if (version && version > rec.version) {
          rec.version = version
          db.name = name
          req.result = db
          req.onupgradeneeded?.({ target: req })
        }
        req.result = db
        req.onsuccess?.({ target: req })
      })
      return req
    },
    deleteDatabase(name) {
      const req = makeReq()
      queueMicrotask(() => {
        dbs.delete(name)
        req.onsuccess?.({ target: req })
      })
      return req
    },
  }
}

export { installIndexedDB }