# Min Form

Personlig app för träning, kost och hälsa. Appen är en PWA som fungerar i webbläsaren och kan läggas på hemskärmen.

All träning- och kostdata sparas bara på telefonen (IndexedDB), aldrig i det här projektet. Ta säkerhetskopior via Mer → Säkerhetskopiering och data. Du kan välja en krypterad kopia med lösenfras.

## Installera på iPhone

1. Öppna appens HTTPS-adress i **Safari**.
2. Tryck på **Dela** (rutan med pil upp).
3. Välj **Lägg till på hemskärmen**.
4. Öppna appen från den nya ikonen.

Appen fungerar även utan installation. Installerad körs den i helskärm och Safari kan skydda lagringen bättre. På Android/Chrome installerar du via menyn **Installera app**.

## Publicera

iPhone kräver HTTPS för service worker och installation. En OneDrive- eller SharePoint-länk fungerar inte som appadress. Publicera hela mappen på en statisk HTTPS-värd, till exempel GitHub Pages (`.nojekyll` finns redan), Azure Static Web Apps, Cloudflare Pages eller Netlify. Kontrollera att `.webmanifest`, `.js` och `.webp` skickas med rätt MIME-typ.

## Testa lokalt

```
python serve-local.py 8080
```

Öppna `http://localhost:8080/` på datorn. För att testa på en iPhone behövs en HTTPS-adress, till exempel en HTTPS-tunnel mot samma port.

## Filer

| Fil | Syfte |
| --- | --- |
| `index.html` | Layout, stil och startsekvens |
| `app.js` | Appens logik (laddas efter att lagringen är klar) |
| `storage.js` | IndexedDB-lagring, migrering från localStorage |
| `pwa.js` / `pwa.css` | Service worker-registrering, uppdateringsknapp, installationshjälp, offline-indikator, iPhone-anpassningar |
| `crypto-backup.js` | Krypterad säkerhetskopia |
| `sw.js` | Service worker (skal i cache, valfria bilder cachas var för sig) |

## Release

Vid varje release: höj `window.MF_VER` i `index.html` och `VERSION` i `sw.js` till samma värde. Installerade appar visar då knappen **Uppdatera**. Databasens schema (`schemaVersion`, `DB_VERSION` i `storage.js`) versioneras separat från appen.

## Testmatris före release (på en riktig iPhone)

- Ny installation online, Lägg till på hemskärmen, standalone-start, ikon och safe area.
- Flygplansläge: befintliga poster och kärnsidor fungerar, offline-indikatorn visas.
- Lägg till pass offline, stäng appen helt, starta om telefonen, öppna igen.
- Exportera (vanlig och krypterad), rensa webbplatsdata, återställ och jämför antal pass och måltider samt decimaler och å/ä/ö.
- Uppdatering: knappen Uppdatera visas och datan finns kvar efter uppdateringen.
- Tangentbord, textstorlek 200 % och VoiceOver.
