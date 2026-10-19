# JPC Skullerud infoskjerm v4

Kioskskjerm for JPC-kontoret på Skullerud, bygget på nytt med mørkt kontrollrom-design og en
avgangstavle i LED-stil. Etterfølger av
[KrakenSaten/jpc-infoskjerm](https://github.com/KrakenSaten/jpc-infoskjerm) (v3, GitHub Pages).

**Live:** https://infoskjerm.kokkinos.no (Coolify, VM 201)

## Hva er nytt i v4

- **Server i stedet for ren nettleserapp.** En liten Node-server (null npm-avhengigheter) henter
  Entur, Open-Meteo, NRK og kontorfilene, cacher dem og leverer ferdige JSON-svar. Skjermen
  trenger ikke lenger CORS-triks eller rss2json, og alle skjermer deler samme cache.
- **Avgangstavle i LED-stil**, delt i «Mot sentrum» og «Mot Mortensrud». Minuttene telles ned
  hvert sekund fra forventet avgangstid, ikke bare ved hver henting. Forsinkelser og innstilte
  avganger vises i rødt, og avviksmeldinger fra Entur ruller nederst på tavla.
- **Værgraf for neste 24 timer** med temperatur, nedbør, natt og ikoner hver tredje time.
- **Nyheter i to kolonner**, NRK til venstre og digi.no til høyre. Hver kolonne viser én sak om gangen med ingress, og resten av plassen fylles med de neste sakene. Kolonnene bytter sak forskjøvet med seks sekunder.
- **Lunsj bytter til neste arbeidsdag** etter servering, og hopper over helg og helligdager.
- **Utløpt nedtelling skjules** i stedet for å stå på 00 00 00 00.
- **Automatisk omlasting** når en ny versjon deployes, og hver natt kl. 04.
- Fast lerret på 1080 × 1920 som skaleres til skjermen, slik at oppsettet er identisk overalt.

## Trykk for mer (berøringsskjerm)

Skjermen står på en Samsung Flip med berøring. Et trykk på et panel løfter det ut som et vindu
over resten av skjermen:

| Panel | Utvidet visning |
|---|---|
| T-bane | 8 avganger i hver retning, de neste 14 bussene (70, 76, 79, FB10 …) med plattform, og alle avvik |
| Vær | Nå-tilstand, føles som, vind, sol opp/ned, graf for 48 timer og prognose for 7 dager |
| Lunsj | Hele ukemenyen, med dagens rett uthevet og passerte dager dempet |
| NRK / digi.no | Valgt sak med bilde og hele teksten, QR-kode til saken, og resten av sakene under (trykk for å bytte) |

Vinduet lukkes med krysset, et trykk utenfor eller Esc. **Står det urørt i 3 minutter, lukkes det
av seg selv**; ringen rundt krysset viser tiden som er igjen, og hver berøring starter den på nytt.
Skjermen navigerer aldri bort fra seg selv: lenker til saker vises som QR-kode, ikke som klikkbare
lenker. Zoom, tekstmarkering og langt trykk er slått av, og bare innholdet i vinduet kan rulles.

QR-kodene lages av [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4
(MIT), lagt inn som `public/qrcode.js`.

## Ukemeny hentes automatisk fra intranettet

Kantinen legger ut ukemenyen på «Min side» på
[intranett.skullerudpark.no](https://intranett.skullerudpark.no/) bak innlogging. Serveren logger
inn og leser menyen selv:

- én gang ved oppstart
- deretter hver hele time fra **mandag 00:00** til menyen for inneværende uke er bekreftet;
  kommer den ikke på mandag, fortsetter forsøkene hver time utover uka
- når uka er bekreftet, står skraperen stille til neste mandag

Intranettet oppgir ikke allergener. Har `menu.csv` samme uke, hentes allergenene derfra. Ligger
`menu.csv` på en nyere uke enn intranettet, eller feiler innloggingen, brukes `menu.csv` som før.
`/healthz` viser hvilken uke som er hentet, når det sist ble sjekket og eventuell feil.

| Miljøvariabel | Innhold |
|---|---|
| `INTRANET_USER` | Brukernavn på intranettet (settes i Coolify, **aldri i repoet**) |
| `INTRANET_PASSWORD` | Passord (settes i Coolify, **aldri i repoet**) |
| `INTRANET_BUILDING` | Hvilket byggs meny som vises, `OH5` (standard) eller `OH6` |

Uten `INTRANET_USER`/`INTRANET_PASSWORD` brukes bare `menu.csv`.

## Annet innhold redigeres som før

Avstemning, kontorbeskjed, nedtelling og reservemenyen leses fortsatt fra **originalrepoet**
`KrakenSaten/jpc-infoskjerm`, på samme format som før:

| Innhold | Fil i originalrepoet |
|---|---|
| Ukens meny | `menu.csv` |
| Kontoravstemning | `poll.csv` |
| Kontorbeskjed | `index.html` (`id="notice"`, `notice-tag`, `notice-msg`) |
| Nedtelling | `config.js` (`jubileeDepartureDate`, `jubileeLabel`) |

Arbeidsflyten i Claude-prosjektet er derfor uendret. Serveren slår opp siste commit på `main` og
henter filene fra akkurat den commiten, så endringer vises innen 2–3 minutter uten å vente på
GitHubs CDN-cache. **R** på tastaturet henter alt på nytt med en gang.

Kilden kan overstyres med miljøvariablene `CONTENT_REPO` og `CONTENT_BRANCH`.

## API

| Rute | Kilde | Cache |
|---|---|---|
| `/api/departures` | Entur GraphQL, Skullerud (NSR:StopPlace:58227), T-bane og buss | 20 sek |
| `/api/weather` | Open-Meteo, 59.8667, 10.8400, 7 dager | 10 min |
| `/api/news` | NRK siste nytt og digi.no (RSS), hver strøm for seg | 5 min |
| `/api/office` | Meny, avstemning, beskjed og nedtelling fra originalrepoet | 3 min |
| `/api/version` | Hash av frontend-filene | — |
| `/healthz` | Helsesjekk for Docker og Coolify | — |

Feiler en kilde, leverer serveren siste gode verdi merket `stale: true`, og skjermen viser
«Viser sist kjente data» på panelet. Klienten har i tillegg sin egen kopi i `localStorage`.

## Kjøre lokalt

```bash
TZ=Europe/Oslo node server.js        # http://localhost:3000
```

Krever Node 22 eller nyere. Uten `TZ=Europe/Oslo` regnes værdøgnet i UTC.

## Deploy

Coolify bygger `Dockerfile` fra `main` og publiserer på `infoskjerm.kokkinos.no` via
cloudflared-wildcarden. Push til `main` og trykk Deploy i Coolify, eller la webhook gjøre det.

## Hurtigtaster

| Tast | Funksjon |
|---|---|
| R | Hent alle data på nytt |
| F | Fullskjerm |
