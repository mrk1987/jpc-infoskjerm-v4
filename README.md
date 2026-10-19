# JPC Skullerud infoskjerm v4

Kioskskjerm for JPC-kontoret på Skullerud, bygget på nytt med mørkt kontrollrom-design og en
avgangstavle i LED-stil. Etterfølger av
[KrakenSaten/jpc-infoskjerm](https://github.com/KrakenSaten/jpc-infoskjerm) (v3, GitHub Pages).

**Live:** https://infoskjerm.kokkinos.no (Coolify, VM 201)

## Hva er nytt i v4

- **Server i stedet for ren nettleserapp.** En liten Node-server (null npm-avhengigheter) henter
  Entur, MET Norge (Yr), NRK, ITavisen og kontorfilene, cacher dem og leverer ferdige JSON-svar. Skjermen
  trenger ikke lenger CORS-triks eller rss2json, og alle skjermer deler samme cache.
- **Avgangstavle i LED-stil**, delt i «Mot sentrum» og «Mot Mortensrud». Minuttene telles ned
  hvert sekund fra forventet avgangstid, ikke bare ved hver henting. Forsinkelser og innstilte
  avganger vises i rødt, og avviksmeldinger fra Entur ruller nederst på tavla.
- **Været fra Yr (MET Norge)**: graf for neste 24 timer med temperatur, nedbør, natt og ikoner
  hver tredje time. Kommer det regn i løpet av halvannen time, står det under temperaturen
  («Regn om 15 min»), basert på METs radarbaserte korttidsvarsel (Nowcast).
- **Nyheter i to kolonner**, NRK til venstre og ITavisen til høyre. Hver kolonne viser én sak om gangen med ingress, og resten av plassen fylles med de neste sakene. Kolonnene bytter sak forskjøvet med seks sekunder.
- **Lunsj bytter til neste arbeidsdag** etter servering, og hopper over helg og helligdager.
- **Nedtelling nederst.** Er det satt en JPC-nedtelling i `config.js` som ikke har passert, vises
  den. Ellers telles det ned til neste røde dag (norske helligdager, de samme som på
  [rodedager.no](https://www.rodedager.no/)): faste datoer pluss dager regnet fra påske, beregnet
  lokalt uten ekstern tjeneste. På selve helligdagen telles det mot den neste.
  Sammenhengende fri pekes ut som på rodedager.no: «Langhelg: 3 dager fri (fredag–søndag)»,
  «5 dager fri på rad (torsdag–mandag)» i påsken, og inneklemte dager (én arbeidsdag mellom to
  fridager, f.eks. fredagen etter Kristi himmelfart): «Inneklemt fredag 15. mai: 4 dager fri med
  én feriedag». En inneklemt dag som er passert, nevnes ikke. Er det inneklemte dager på begge
  sider, nevnes begge med samlet antall fridager. «Langhelg» brukes bare når en helg er med.
- **JPCs egne fridager:** julaften og nyttårsaften er fri hos JPC selv om de ikke er røde dager
  (`JPC_DAYS_OFF` i `public/app.js`). De vises som «Neste fridag» og teller med i langhelger og
  inneklemte dager, men ikke i kantinens «Stengt, helligdag».
- **Automatisk omlasting** når en ny versjon deployes, og hver natt kl. 04.
- Fast lerret på 1080 × 1920 som skaleres til skjermen, slik at oppsettet er identisk overalt.

## Trykk for mer (berøringsskjerm)

Skjermen står på en Samsung Flip med berøring. Et trykk på et panel løfter det ut som et vindu
over resten av skjermen:

| Panel | Utvidet visning |
|---|---|
| T-bane | 8 avganger i hver retning, de neste 14 bussene (70, 76, 79, FB10 …) med plattform, og alle avvik |
| Vær | Nå-tilstand, føles som, vind og vindkast, sol opp/ned, nedbør hvert 5. minutt de neste 90 minuttene, animert nedbørsradar for Sørøst-Norge, graf for 48 timer og prognose for 7 dager |
| Lunsj | Hele ukemenyen, med dagens rett uthevet og passerte dager dempet |
| NRK / ITavisen | Valgt sak med bilde og hele teksten (ITavisen sender hele saken i RSS), QR-kode til saken, og resten av sakene under (trykk for å bytte) |

Vinduet lukkes med krysset, et trykk utenfor eller Esc. **Står det urørt i 3 minutter, lukkes det
av seg selv**; ringen rundt krysset viser tiden som er igjen, og hver berøring starter den på nytt.
Skjermen navigerer aldri bort fra seg selv: lenker til saker vises som QR-kode, ikke som klikkbare
lenker. Zoom, tekstmarkering og langt trykk er slått av, og bare innholdet i vinduet kan rulles.

### Nyhetskilder

Høyre kolonne var digi.no frem til 2026-10-19, men hele sakene der ligger bak betalingsmur
(innlogging via TU Media, `konto.tumedia.no`), så vinduet kunne bare vise ingressen. ITavisen er
gratis og har hele saken i RSS (`content:encoded`). Serveren fjerner innebygde tweets, skript og
reklamewidgeter, og filtrerer bort annonsørinnhold, som ITavisen merker med versaler foran kolon
(«TIDSBEGRENSET: …»). ITavisen heller mer mot forbrukerteknologi enn digi.no. Det finnes ingen
gratis norsk kilde med digi.nos B2B-vinkel og fulltekst.

### Værdata fra MET Norge

Været kom fra Open-Meteo frem til 2026-10-19 og hentes nå fra MET Norge, samme kilde som yr.no.
Dataene er lisensiert CC BY 4.0 og krediteres i værvinduet. METs vilkår følges: User-Agent med
kontaktinfo (repo-URL-en), koordinater med høyst fire desimaler, og `If-Modified-Since` slik at
uendrede prognoser bare gir et 304-svar. Radarbildet hentes én gang per oppdatering og deles av alle
skjermer. Ruten har ingen filendelse fordi Cloudflare ellers ville cachet bildet i fire timer.

METs symbolkoder oversettes til WMO-kodene som ikonene bygger på, og til Yrs ordlyd («Lette
regnbyger»). Soloppgang og solnedgang regnes ut lokalt (avviker høyst et par minutter fra METs
sunrise-API).

### Værbakgrunn

Bak panelene går en dempet animasjon som speiler været ute (`public/ambient.js`, ett lerret):

| Vær | Bakgrunn |
|---|---|
| Klart, dag | Varm solglød i hjørnet med stråler som dreier sakte |
| Klart, natt | Stjerner som blinker svakt, og en myk måneglød |
| Lettskyet, skyet | Myke skyer som driver forbi (mørkere når det regner) |
| Tåke | Brede tåkebånd som glir og pulserer |
| Regn, byger | Regnstriper, tettere jo kraftigere regnet er |
| Sludd | Regn og snø blandet |
| Snø | Snøfnugg som vugger ned |
| Torden | Kraftig regn og et sjeldent, svakt lysglimt |
| Bitende kulde | Rim på ruta: en ramme av rimbregner kryper inn fra kantene og glimter svakt. Dempet og bak teksten, så alt er lett å lese. |
| Vind uten nedbør (fra 8 m/s, eller kast fra ~13 m/s) | Blader som tumler forbi fra høyre mot venstre, og små virvler som snurrer og tones ut. Bladene følger årstiden: høstfarger sep–nov, grønne blader om sommeren, grønt med lyse blomsterblader om våren, og fint fokksnø i stedet for blader om vinteren. |
| Vind med regn, snø eller sludd | Ingen egne vindeffekter; nedbøren legger seg på skrå fra høyre mot venstre, mer jo sterkere det blåser: rett ned i stille vær, ~30° i frisk bris, ~50° i kuling, ~70° i sterk kuling og nesten vannrett i storm. Kompassretningen brukes ikke. |

**Alt styres av Yrs tall for Skullerud, ikke av faste nivåer:**

| Lag | Kilde | Eksempel |
|---|---|---|
| Regn, snø, sludd | Radarens mm/t akkurat nå (Nowcast). Viser radaren ingenting, brukes Yrs prognose for neste time. Typen kommer fra værsymbolet, eller temperaturen hvis bare radaren ser nedbør. | 0,5 mm/t gir noen få, korte dråper; 10 mm/t eller mer gir ~600 lange, raske striper. Snø teller 2,5 ganger så mye, fordi 1 mm/t snø allerede er kraftig snøvær. |
| Skyer | Yrs skydekke i prosent | 28 % gir noen svake skyer, 100 % tett, mørkt skydekke |
| Sol, stjerner | Det som er igjen av himmelen når skyer og tåke er trukket fra | 60 % skydekke gir sol med 40 % styrke |
| Tåke | Yrs tåkedekke i prosent | |
| Torden | Yrs sannsynlighet for torden neste time | 100 % gir et svakt lysglimt hvert 14.–40. sekund, 20 % omtrent hvert eller annet minutt |
| Rim | Den laveste av Yrs temperatur og føles-som-temperatur | Svakt fra −8 °C, tydelig rundt −14 °C, fullt fra −20 °C. Rimet kryper fram over ~8 sekunder når det blir kaldt nok. |
| Vind | Yrs middelvind og vindkast. Styrer vinkelen på regn og snø, og farten på skyer, blader og virvler; alt blåser fra høyre mot venstre. | Blader og virvler fra 8 m/s (eller kast fra ~13 m/s) når det er opphold, flere og raskere jo sterkere det blåser. Vinkelen på nedbøren øker jevnt opp til ~80° ved 24 m/s (storm). |

Styrken går fra 0 til 1 på en logaritmisk skala, så yr, jevnt regn og styrtregn ser tydelig
forskjellige ut. Endres været, glir lagene over til den nye styrken i løpet av noen sekunder: regnet
tiltar eller stilner i stedet for at bildet hopper. Lynet holder seg godt under grensene for
blinkende lys som kan utløse anfall, og med «redusert bevegelse» slått på i operativsystemet vises et
stillbilde i stedet for animasjon.

**Forhåndsvisning:** legg til `?vaer=` i adressen for å se et vær uten å vente på det, f.eks.
`https://infoskjerm.kokkinos.no/?vaer=snø,vind`. Lag: `sol`, `natt`, `skyer`, `tåke`, `regn`,
`sludd`, `snø`, `torden`, `vind`, kommaseparert. Styrke angis med kolon fra 0 til 1:
`?vaer=regn:1,vind:1` er styrtregn i storm (nesten vannrett), `?vaer=regn:0.15` er yr.
`&aarstid=vår|sommer|høst|vinter` viser bladene for en annen årstid, f.eks.
`?vaer=vind&aarstid=vinter` for fokksnø.

**Rimet er et ekte bilde.** `public/frost.webp` er laget av et bilde av en rimramme mot svart
bakgrunn i 9:16, levert av Andreas 2026-10-19. `tools/make_frost.py` gjør lysstyrken om til
dekkevne (svart blir klart glass, krystallene is) og farger det isblått. Rimet ligger bak panelene
og teksten med 85 % dekkevne; mens det ligger rim, får teksten en mørk glorie
(`.frosty` i `styles.css`). Generert rim (forgreinede streker, og en fasefelt-simulering av
krystallvekst) ble prøvd først og så ut som spindelvev eller papp. Forhåndsvis med `?vaer=frost`
eller `?vaer=frost,snø`.

### Kiosk-PC

Skjermen drives av en Windows 11-PC med Edge eller Chrome i fullskjerm, ikke Flip-skjermens
innebygde nettleser.

- **Start Edge i kioskmodus**, så ingen kan sveipe eller trykke seg ut av siden:
  `msedge --kiosk https://infoskjerm.kokkinos.no --edge-kiosk-type=fullscreen`
- **Slå av kantsveip i Windows.** Sveip inn fra kanten åpner varslingssenteret og widgeter, og det
  kan ikke en nettside stoppe. Gruppepolicy: *Datamaskinkonfigurasjon → Administrative maler →
  Windows-komponenter → Edge UI → Allow edge swipe = Deaktivert*, eller registerverdien
  `HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI\AllowEdgeSwipe = 0` (DWORD).
- Desktop-Chrome/Edge ignorerer `user-scalable=no`. Zoom stoppes i stedet av `touch-action: none`
  på lerretet, og sveip tilbake/frem av `overscroll-behavior: none`.

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
| `/api/weather` | MET Norge: Locationforecast og Nowcast, 59.8667, 10.8400, 7 dager | 5 min |
| `/api/radar` | MET Norge radar, `southeastern_norway`, animert GIF (~3,5 MB) | til `Expires` fra MET |
| `/api/news` | NRK siste nytt og ITavisen (RSS), hver strøm for seg | 5 min |
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
