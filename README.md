# Skånekoll

Ett kartspel om skånska tätorter – öva själv som i Seterra eller tävla mot kompisar om vem som kommer närmast.

## Lägen

- **Hitta orten** – alla orter syns som prickar, klicka på rätt prick (som Seterra). Tre fel så blinkar rätt svar.
- **Gissa var** – tom karta, klicka där du tror att orten ligger. Poäng efter hur nära du kommer (max 1000 per runda).
- **Skapa rum / Gå med i rum** – 2–10 spelare på varsin mobil. Värden får en fyrbokstavskod (eller delar en länk), alla gissar samtidigt med tidsgräns och den som kommer närmast får mest poäng.
- **Samma enhet** – 2–10 spelare turas om på en och samma telefon/dator.

Svårighetsgrader: kommunhuvudorter (33), större orter (≥ 2 000 invånare) eller alla 165 orter i datan.

## Köra

Helt statisk sajt – inget bygge behövs. Öppna `index.html` via valfri webbserver, t.ex.

```sh
python3 -m http.server 8080
```

eller slå på **GitHub Pages** (Settings → Pages → Deploy from branch, rot-mappen).

Online-läget kopplar spelarna direkt till varandra med WebRTC via [PeerJS](https://peerjs.com) och deras gratis signalserver, så ingen egen server behövs. För att testa mot en egen PeerJS-server: lägg till `?peerhost=127.0.0.1&peerport=9000` i adressen.

## Filer

- `index.html`, `style.css`, `app.js` – själva appen
- `data.js` – Skånes gräns och alla orter (genererad från Natural Earth och GeoNames, se `vendor/LICENSES.md`)
- `vendor/` – Leaflet och PeerJS
