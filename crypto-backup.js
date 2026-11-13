/* Min Form – krypterad säkerhetskopia (AES-GCM, nyckel från lösenfras via PBKDF2). */
(function (global) {
  "use strict";

  var ITER = 250000;
  var enc = new TextEncoder();
  var dec = new TextDecoder();

  function b64(buf) {
    var bytes = new Uint8Array(buf), s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(str) {
    var s = atob(str), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function need() {
    if (!global.crypto || !global.crypto.subtle) throw new Error("Krypto stöds inte här (kräver HTTPS)");
  }
  async function keyFrom(pass, salt, iter) {
    var base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: salt, iterations: iter, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  async function encrypt(obj, pass) {
    need();
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var key = await keyFrom(pass, salt, ITER);
    var data = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, enc.encode(JSON.stringify(obj)));
    return {
      type: "minform-encrypted", v: 1, kdf: "PBKDF2-SHA-256", iter: ITER,
      salt: b64(salt), iv: b64(iv), data: b64(data)
    };
  }

  async function decrypt(file, pass) {
    need();
    if (!file || file.type !== "minform-encrypted" || file.v !== 1) throw new Error("Okänt format på krypterad fil");
    if (pass == null) pass = global.prompt("Skriv lösenfrasen för den krypterade säkerhetskopian:");
    if (!pass) throw new Error("Ingen lösenfras angavs");
    var iter = Number(file.iter);
    if (!(iter >= 100000 && iter <= 2000000)) throw new Error("Ogiltig krypterad fil");
    var key = await keyFrom(pass, unb64(file.salt), iter);
    var plain;
    try {
      plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(file.iv) }, key, unb64(file.data));
    } catch (e) {
      throw new Error("Fel lösenfras eller skadad fil");
    }
    return JSON.parse(dec.decode(plain));
  }

  // Knapp i "Din data": krypterad kopia via delningsmenyn eller som nedladdning.
  async function exportEncrypted() {
    try {
      var p1 = global.prompt("Välj en lösenfras (minst 8 tecken). Utan den går kopian inte att öppna, och den kan inte återskapas.");
      if (!p1) return;
      if (p1.length < 8) return global.alert("Lösenfrasen måste vara minst 8 tecken.");
      var p2 = global.prompt("Skriv lösenfrasen igen för att bekräfta:");
      if (p2 !== p1) return global.alert("Lösenfraserna var inte lika. Ingen kopia skapades.");
      var out = await encrypt(db, p1); // db är appens globala (let) variabel i app.js
      var json = JSON.stringify(out);
      var name = global.backupName().replace(/\.json$/, "-krypterad.json");
      var file = null;
      try { file = new File([json], name, { type: "application/json" }); } catch (e) {}
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "Min Form krypterad säkerhetskopia" });
          global.markBackup();
          return global.alert("Klart! Kopian är krypterad. Spara lösenfrasen på ett säkert ställe.");
        } catch (e) { if (e.name === "AbortError") return; }
      }
      var url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      var a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      global.markBackup();
      global.alert("Den krypterade filen har laddats ner. Spara lösenfrasen på ett säkert ställe.");
    } catch (e) {
      global.alert("Kunde inte skapa krypterad kopia: " + e.message);
    }
  }

  global.MFCrypto = { encrypt: encrypt, decrypt: decrypt };
  global.exportEncrypted = exportEncrypted;
})(window);
