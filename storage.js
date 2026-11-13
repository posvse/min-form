/* Min Form – lagring.
 *
 * IndexedDB är primär lagring (databasen "minform"). Appens data ligger kvar som ett
 * objekt i minnet (db), men varje toppnivånyckel sparas som en egen post i storen
 * "records", och bara de poster som ändrats skrivs. Alla skrivningar sker i en transaktion.
 *
 * Migrering: första gången läses den gamla localStorage-posten "minform_v01", valideras,
 * skrivs transaktionellt till IndexedDB och verifieras mot källan. Den gamla posten lämnas
 * orörd tills en säkerhetskopia har gjorts (se afterBackup). Om något misslyckas används
 * localStorage som reservläge och inget skrivs över.
 *
 * Om IndexedDB inte går att använda faller appen tillbaka på localStorage (mode "localstorage").
 */
(function (global) {
  "use strict";

  var DB_NAME = "minform";
  var DB_VERSION = 1;
  var LEGACY_KEY = "minform_v01";
  var OPEN_TIMEOUT_MS = 8000;
  var WRITE_DELAY_MS = 250;

  var S = {
    mode: "pending",      // "indexeddb" | "localstorage"
    idb: null,
    initialDb: null,
    lastJson: {},         // senast sparade JSON per toppnivånyckel
    meta: {},
    pending: null,        // db-objekt som väntar på att sparas
    timer: null,
    chain: Promise.resolve(),
    listeners: [],
    lastSaved: null,
    lastError: null
  };

  function reqP(r) {
    return new Promise(function (res, rej) {
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }

  function txDone(t) {
    return new Promise(function (res, rej) {
      t.oncomplete = function () { res(); };
      t.onerror = function () { rej(t.error); };
      t.onabort = function () { rej(t.error || new Error("Transaktionen avbröts")); };
    });
  }

  function openDb() {
    return new Promise(function (res, rej) {
      if (!global.indexedDB) return rej(new Error("IndexedDB stöds inte"));
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; rej(new Error("IndexedDB svarade inte")); }
      }, OPEN_TIMEOUT_MS);
      var r;
      try { r = global.indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { clearTimeout(timer); return rej(e); }
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains("settings")) d.createObjectStore("settings", { keyPath: "k" });
        if (!d.objectStoreNames.contains("records")) d.createObjectStore("records", { keyPath: "k" });
      };
      r.onsuccess = function () {
        clearTimeout(timer);
        if (done) { r.result.close(); return; }
        done = true;
        res(r.result);
      };
      r.onerror = function () {
        clearTimeout(timer);
        if (!done) { done = true; rej(r.error || new Error("Kunde inte öppna IndexedDB")); }
      };
    });
  }

  function toJsonMap(obj) {
    var map = {};
    Object.keys(obj).forEach(function (k) {
      var j = JSON.stringify(obj[k]);
      if (j !== undefined) map[k] = j;
    });
    return map;
  }

  function fromRecords(recs) {
    var o = {};
    var json = {};
    recs.forEach(function (r) { o[r.k] = JSON.parse(r.json); json[r.k] = r.json; });
    S.lastJson = json;
    return o;
  }

  function counts(obj) {
    return {
      keys: Object.keys(obj).length,
      history: Array.isArray(obj.history) ? obj.history.length : 0,
      meals: obj.food && Array.isArray(obj.food.entries) ? obj.food.entries.length : 0
    };
  }

  function putSetting(rec) {
    var t = S.idb.transaction("settings", "readwrite");
    t.objectStore("settings").put(rec);
    return txDone(t);
  }

  // Skriv över allt i en transaktion och verifiera sedan mot källan.
  async function migrate(parsed) {
    var json = toJsonMap(parsed);
    var meta = {
      k: "meta", migrated: true, migratedAt: new Date().toISOString(),
      source: "localStorage", schema: 1, counts: counts(parsed)
    };
    var t = S.idb.transaction(["records", "settings"], "readwrite");
    var rs = t.objectStore("records");
    rs.clear();
    Object.keys(json).forEach(function (k) { rs.put({ k: k, json: json[k] }); });
    t.objectStore("settings").put(meta);
    await txDone(t);

    var back = await reqP(S.idb.transaction("records").objectStore("records").getAll());
    var backMap = {};
    back.forEach(function (r) { backMap[r.k] = r.json; });
    var ok = Object.keys(json).length === back.length &&
      Object.keys(json).every(function (k) { return backMap[k] === json[k]; });
    if (ok) {
      var a = counts(parsed), b = counts(fromRecords(back));
      ok = a.keys === b.keys && a.history === b.history && a.meals === b.meals;
    }
    if (!ok) {
      var c = S.idb.transaction(["records", "settings"], "readwrite");
      c.objectStore("records").clear();
      c.objectStore("settings").delete("meta");
      await txDone(c).catch(function () {});
      throw new Error("Migreringen kunde inte verifieras");
    }
    S.meta = meta;
    return fromRecords(back);
  }

  function readLegacyRaw() {
    try { return global.localStorage.getItem(LEGACY_KEY); } catch (e) { return null; }
  }

  function isPlainObject(x) { return !!x && typeof x === "object" && !Array.isArray(x); }

  function fallbackToLocalStorage(err) {
    S.mode = "localstorage";
    S.lastError = err || null;
    S.idb = null;
    var raw = readLegacyRaw();
    if (raw) {
      try { var p = JSON.parse(raw); if (isPlainObject(p)) S.initialDb = p; } catch (e) { /* skadad post lämnas orörd tills ny data sparas */ }
    }
  }

  S.ready = (async function () {
    try {
      S.idb = await openDb();
      S.idb.onversionchange = function () { try { S.idb.close(); } catch (e) {} };
      var metaRec = await reqP(S.idb.transaction("settings").objectStore("settings").get("meta"));
      var recs = await reqP(S.idb.transaction("records").objectStore("records").getAll());

      if (metaRec && metaRec.migrated) {
        S.meta = metaRec;
        S.initialDb = recs.length ? fromRecords(recs) : null;
        S.mode = "indexeddb";
        return;
      }

      var raw = readLegacyRaw();
      if (raw) {
        var parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
        if (isPlainObject(parsed)) {
          S.initialDb = await migrate(parsed);
          S.mode = "indexeddb";
          return;
        }
        // Skadad gammal post: spara en kopia av råtexten så att inget går förlorat.
        await putSetting({ k: "corruptLegacy", raw: raw, at: new Date().toISOString() });
      }

      S.initialDb = recs.length ? fromRecords(recs) : null;
      S.mode = "indexeddb";
    } catch (e) {
      fallbackToLocalStorage(e);
    }
  })();

  function emit(status) {
    S.listeners.forEach(function (fn) { try { fn(status); } catch (e) {} });
  }

  async function writeDb(db) {
    var json = toJsonMap(db);
    var changed = Object.keys(json).filter(function (k) { return S.lastJson[k] !== json[k]; });
    var removed = Object.keys(S.lastJson).filter(function (k) { return !(k in json); });
    var needMeta = !S.meta.migrated;
    if (!changed.length && !removed.length && !needMeta) {
      S.lastSaved = Date.now(); S.lastError = null;
      emit({ ok: true, time: S.lastSaved });
      return;
    }
    var meta = needMeta
      ? { k: "meta", migrated: true, migratedAt: null, source: "fresh", schema: 1, createdAt: new Date().toISOString() }
      : null;
    var t = S.idb.transaction(["records", "settings"], "readwrite");
    var rs = t.objectStore("records");
    changed.forEach(function (k) { rs.put({ k: k, json: json[k] }); });
    removed.forEach(function (k) { rs.delete(k); });
    if (meta) t.objectStore("settings").put(meta);
    await txDone(t);
    changed.forEach(function (k) { S.lastJson[k] = json[k]; });
    removed.forEach(function (k) { delete S.lastJson[k]; });
    if (meta) S.meta = meta;
    S.lastSaved = Date.now(); S.lastError = null;
    emit({ ok: true, time: S.lastSaved });
  }

  function flush() {
    if (S.timer) { clearTimeout(S.timer); S.timer = null; }
    if (S.mode === "indexeddb" && S.pending) {
      var db = S.pending;
      S.pending = null;
      S.chain = S.chain.then(function () { return writeDb(db); }).catch(function (e) {
        S.lastError = e;
        emit({ ok: false, error: (e && e.message) || String(e) });
      });
    }
    return S.chain;
  }

  var MFStore = {
    ready: S.ready,
    get mode() { return S.mode; },
    get lastSaved() { return S.lastSaved; },
    get lastError() { return S.lastError; },
    get meta() { return S.meta; },
    initial: function () { var d = S.initialDb; S.initialDb = null; return d; },
    onStatus: function (fn) { S.listeners.push(fn); },
    flush: flush,
    // Anropas synkront av appen. I IndexedDB-läge sparas efter en kort fördröjning.
    save: function (db) {
      if (S.mode === "localstorage") {
        try {
          global.localStorage.setItem(LEGACY_KEY, JSON.stringify(db));
          S.lastSaved = Date.now(); S.lastError = null;
        } catch (e) { S.lastError = e; throw e; }
        return;
      }
      S.pending = db;
      if (!S.timer) S.timer = setTimeout(flush, WRITE_DELAY_MS);
    },
    // Den gamla localStorage-kopian tas bort först efter en lyckad säkerhetskopia.
    afterBackup: function () {
      if (S.mode !== "indexeddb" || !S.meta.migrated || S.meta.legacyRemoved) return;
      flush().then(function () {
        if (S.lastError || S.mode !== "indexeddb") return;
        try { if (global.localStorage.getItem(LEGACY_KEY) !== null) global.localStorage.removeItem(LEGACY_KEY); }
        catch (e) { return; }
        var m = {}; Object.keys(S.meta).forEach(function (k) { m[k] = S.meta[k]; });
        m.legacyRemoved = new Date().toISOString();
        S.meta = m;
        return putSetting(m);
      }).catch(function () {});
    },
    legacyRetained: function () { return readLegacyRaw() !== null; }
  };

  // Skriv direkt när appen göms eller stängs.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flush();
  });
  global.addEventListener("pagehide", flush);

  global.MFStore = MFStore;
})(window);
