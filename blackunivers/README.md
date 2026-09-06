# Black Univers – Rundenstrategie im Kilrathi-Krieg

Ein rundenbasiertes Strategiespiel im Wing-Commander-Universum, gebaut nach dem
Vorbild von *Pax Aeterna*, das in diesem Verzeichnis nebenan liegt: dieselbe
Bauweise, dieselbe Handschrift – aber statt der Legionen des Mittelmeers führt
man Trägerkampfgruppen zwischen Sol und Kilrah.

Die Sternkarte des bekannten Raums wird in echtem 3D (Three.js/WebGL) aus einer
isometrischen Kameraperspektive dargestellt. Bewegung, Sprungpunkte,
Belagerungen und Gefechte finden **direkt auf dieser Karte** statt – es gibt
keinen zweiten Bildschirm für Schlachten.

## Die Karte liegt auf der Brücke

Der Feldzug wird nicht auf einer Karte gespielt, sondern **an einem
Kartentisch**: Die Sternkarte ist ein Hologramm auf dem Tisch der Flaggbrücke
eines Trägers. Ringsum ein Konsolenring, dahinter die Schotten mit ihren
Lichtbändern, dem Betrachter gegenüber der Kommandosessel auf seinem Podest,
links und rechts die Feldzeichen mit dem **Wappen der eigenen Flagge**. Wer die
Kamera tief stellt, sieht die Brücke; wer von oben schaut, sieht die Karte.

Auf einem eigenen Ständer steht der **Fluganzug** – das eine Stück auf der
Brücke, an dem man sieht, wessen Flotte man führt. Und an der Stirnseite liegt
das **Panoramafenster**: Was dahinter steht, richtet sich nach dem Umland der
eigenen Hauptwelt – eine Nebelbank, ein Gasriese mit Ring, ein Trümmerfeld,
zwei Sonnen, oder das eigene Flugdeck mit Landebahn und Positionslichtern.

Bevor der erste Zug fällt, meldet sich der Erste Offizier:
**„Ich grüße Sie an Bord. Die Karte liegt auf dem Tisch."**

## Was im Gefecht zu sehen ist

Ein Gefecht ist eine **Einstellung**, kein Zahlenblatt. Die Kamera fährt auf
das Feld, legt sich flach an den Horizont und zieht in großer Ruhe um die
Verbände - Runde für Runde ein Stück näher heran, bis man die Rümpfe erkennt
und nicht mehr die Marken. Zwei schwarze Balken oben und unten machen das
Bild breit, ein schwerer Einschlag rüttelt den Blick durch.

Der Ablauf ist bewusst **langsam zum Mitlesen**:

1. **Anflug** – beide Verbände kommen aus der Ferne aufeinander zu und
   schließen auf, ehe der erste Schuss fällt.
2. **Feuergefecht** – jedes Geschoss läuft sichtbar von Rohr zu Rumpf, mit
   Mündungsblitz am Geschütz und Funkenschlag am Ziel. Man sieht, wer wen
   aufs Korn nimmt. **Kreuzer und Träger kreisen nicht**: sie halten die
   Linie ein Feld hinter dem Getümmel, drehen dem Feind die Breitseite zu und
   legen jede zweite Salve als schwere, langsame Lage quer über das Feld.
   Die Bewegung machen die Jäger.
3. **Torpedos** – Bomber schießen nicht, sie **stoßen zu**: ein Stahlkörper
   mit Suchkopf, glühendem Zielring, vier Flossen und einem Triebwerk, das
   flackert. Er verlässt das Rohr mit einem Startblitz, rollt um die
   Längsachse, läuft dem Ziel nach, zieht ein Leuchtband und eine Rauchfahne
   hinter sich her und geht nach knapp zwei Sekunden hoch - gegen den
   Planetenschild, wenn eine Welt dahintersteht, sonst gegen den schwersten
   Kiel der Gegenseite.
4. **Schild** – die Kuppel wird Runde für Runde dünner; fällt sie, geht sie
   mit einer Druckwelle auf.
5. **Verluste** – kein Schiff verschwindet auf Zuruf. Es bricht aus der
   Formation, trudelt, verglüht und zerbricht in Trümmer.

Die Verbände fliegen dabei **langsam und geführt**: jedes Schiff hat seine
Bahn um seinen Platz im Verband, schwere Kiele halten die Linie, Jäger
kreisen eng, und wer an der Reihe ist, zieht einen **Anflug** auf den Gegner
und wieder zurück. Die Nase zeigt immer dorthin, wo das Schiff hinfliegt.

Während eines Gefechts steht **nur der Schauplatz** im Bild: die kämpfenden
Verbände, die Welt, um die es geht, eine Basis oder Boje daneben. Der Rest
der Galaxis – ferne Welten, Flottenmarken, Grenzen, Beschriftungen – wartet,
bis es vorbei ist.

Über dem Bild steht die **Gefechtsanzeige**: Runde, Stärke beider Seiten und
was gerade passiert. Wem das zu lang dauert, drückt **Esc**, **Leertaste**
oder die Schaltfläche unten rechts - der Bericht kommt trotzdem, denn
entschieden ist das Gefecht schon, bevor es gezeigt wird.

## Der Vorspann

Vor dem Startbild läuft ein kurzer Film (`video/vorspann.mp4`, dazu eine
WebM-Fassung für Browser ohne H.264). Er lässt sich mit Klick, Leertaste oder
Escape überspringen, endet von selbst und geht dann weich ins Startbild über.
In den Einstellungen kann man ihn abschalten. Fehlt oder stockt die Datei,
steht man nicht vor einer schwarzen Wand - das Startbild kommt trotzdem.

## Das Startbild

Es ist kein Bild, sondern ein **Gefecht**: der **Träger der gewählten Flagge**
treibt vor einer Nebelbank, darüber jagen die eigene Rotte und die Jäger des
Erzfeindes einander - mit Leuchtspuren zwischen den Maschinen, Torpedos, die
ihre Bahn ziehen, und Einschlägen, die aufgehen und vergehen. Eine **Rotte
Jäger** zieht durch das Bild,
darunter steht ein Planet mit Ring, und die Kamera folgt dem Mauszeiger ein
Stück weit. Wer in der Auswahl eine andere Flagge anklickt, sieht sofort deren
Schiff: der Bengal weicht dem Snakeir, das Blau dem Rot des Klans.

Geht WebGL nicht, bleibt die gezeichnete Tafel darunter stehen - sie ist der
Rückfall, nicht die Regel.

## Der Raum

Die Karte ist **echte Wing-Commander-Geografie**, gerastert auf 76 × 42 Felder:
Sol im Westen, Kilrah im Osten, dazwischen der Vega-Sektor, der Enigma-Sektor,
die Grenzwelten, der Gemini-Sektor, das Landreich und der Firekka-Rand –
**66 Sternsysteme** von Sol, Proxima und Vega über McAuliffe, Kurasawa, Enigma
und Ghorah Khar bis Vukar Tag, Baka Kar und Kilrah.

Ein Feld ist nicht wie das andere:

| Feld | Wirkung |
| --- | --- |
| **Offener Raum** | Flugkosten 1 |
| **Nebelbank** | Kosten 2, verbirgt Flotten – im Nebel sieht man nur, wer daneben steht |
| **Asteroidenfeld** | Kosten 3, kostet Maschinen beim Durchflug |
| **Strahlungszone** | Kosten 2, frisst Panzerung |
| **Gravitationsgraben** | Unpassierbar. Die Gebirge dieser Karte |

Nebel, Trümmer und Strahlung stehen **als Körper über der Platte**, nicht nur
als Farbe in der Karte: Schwaden, die zur Kamera schauen und langsam treiben,
Brocken in verschiedenen Höhen und Größen, und ein pulsender Schein über den
Strahlungszonen.

Durch die Gräben führen **Sprungpunkte**: acht feste Paare, die in einem
Bewegungspunkt quer über die Karte bringen – der Enigma-Sprung nach K'tithrak
Mang, der Grabensprung von Tyr zum Höllenloch, der Firekka-Sprung. Sie
entscheiden, wo Feldzüge stattfinden.

Jedes Ende trägt eine **Sprungboje**: Schwimmkörper mit Warnkragen, Mast mit
blinkendem Feuer, drei Warnrippen und ein Kranz, der langsam mitdreht – ein
Seezeichen im Raum, das sich wiegt und blinkt, damit man es aus der Entfernung
an seinem Takt erkennt. Keine Boje liegt auf einer Welt oder daneben: wo die
Sollstelle besetzt ist, wandert der Punkt beim Aufbau der Karte auf das
nächste freie Feld. Ein Tor gehört in den freien Raum, nicht in einen Orbit.

## Was man führt

Fünf spielbare Flaggen, jede mit eigener Doktrin, eigenen Schiffsnamen und
eigenem Oberkommandierenden:

| Flagge | Herrscher | Doktrin |
| --- | --- | --- |
| **Terranische Konföderation** | Admiral Geoffrey Tolwyn | Träger sind billiger, Jäger starten erfahren |
| **Kilrathi-Imperium** | Kronprinz Thrakhath nar Kiranka | Jäger und Klauenkrieger schlagen härter, Rückzug kostet Moral |
| **Union der Grenzwelten** | Admiral Jacob Manley | Mehr Bewegung, geringerer Unterhalt |
| **Freie Republik Landreich** | Präsident Max Kruger | Mehr Beute aus Gefecht und Eroberung |
| **Firekkanische Konföderation** | Königin Rikik | Sehr billige Jäger, starke Planetenverteidigung |

Dazu der **Nephilim-Schwarm**, der nach vielen Zügen durch ein Tor am Rand der
Karte kommt und nicht verhandelt, sowie **Retros, Mandarine und Freibeuter**,
die aus Nebelbänken auftauchen und plündern.

### Wie sie aussehen

Jede Flotte auf der Karte zeigt ihr **schwerstes Schiff**: der Träger führt,
wenn einer dabei ist, sonst der Kreuzer, sonst die Korvette - und ganz unten
die Jägerstaffel allein. Zwei Begleiter fliegen daneben, wenn die Flotte auch
Jäger führt. Fällt das Flaggschiff, bekommt die Flotte ein neues Gesicht.

Die Modelle sind gebaut, nicht geladen – und zwar **nach den Entwürfen des
Films von 1999**, nicht nach den schlanken Pfeilen der frühen Spiele:

- **Rapier**: ein breiter, flacher Blechkasten mit tief sitzender Kanzel,
  kurzen gekappten Flügeln, dickem Vorderholm, zwei wuchtigen
  Triebwerksgondeln und nach außen geneigten Seitenleitwerken. Ein
  Arbeitsgerät, kein Sportwagen – mit Pilot im Sitz.
- **Tiger Claw** (Bengal-Klasse): ein langer, dunkler Stahlkasten. Das
  Flugdeck läuft über die ganze Länge, das Hangarmaul steht offen unter dem
  Bug und leuchtet von innen, der Brückenturm sitzt weit achtern auf dem
  Rücken, am Heck ein schwerer Block mit vier Düsen, die Flanken gerippt wie
  ein Schiffsrumpf.
- **Dralthi**: dunkle Bronze, ein breiter Flügel, der sich in drei Segmenten
  nach vorn krümmt, die Spitzen nach unten gebogen, dazwischen ein
  gedrungener Pod mit geteilter, bernsteinfarbener Kanzel.

Dazu der Snakeir als Klinge mit Rückenkamm, die Firekkaner mit gefächerten
Schwingen und leuchtenden Federkanten, der Schwarm gewachsen statt gebaut,
mit Adern und Beißzangen.

Aus der Nähe zählt das Kleinzeug: **Geschütztürme** mit Sockel, drehbarem Kopf
und Doppelrohr statt Würfel mit Stäbchen, **Kühlerflügel** mit glühender Kante
an den Flanken der großen Kiele, **Masten** mit Rahmenantenne und Blinkfeuer,
**Düsenkränze**, die den Rohren Tiefe geben, und eine zweite, hellere
Plattenfarbe, damit große Flächen nicht wie ein Block wirken. Bomber tragen
ihre **Torpedos sichtbar**: zwei in der Wanne des Broadsword, zwei in den
Klauen des Paktahn. Der Rumpf trägt die Farbe der Flagge gedämpft, hell wird
nur, was leuchtet - Düsen, Landebahn, Kennstreifen. Auf der weiten Karte fällt
das Kleinzeug weg, im Gefecht ist alles da.

### Wo Staffeln starten

Jäger und Bomber haben keine Sprungtriebwerke und keine Vorräte für Wochen.
Sie brauchen ein **Deck in Reichweite**:

| Startdeck | Reichweite |
| --- | --- |
| **Träger** in der eigenen Flotte | immer |
| **Eigene Welt** | das Feld und die acht daneben |
| **Militärbasis** in einem Trümmerfeld | zwei Felder |

Fehlt alles davon, hängen die Maschinen in der Leere und leisten **nur die
Hälfte**. Die Angriffsvorschau sagt vorher, von wo gestartet wird – oder dass
kein Deck da ist.

Die Basen sind in Fels gehauen: im freien Raum steht nichts, was nicht selbst
fliegt. Sie stehen von Beginn an auf der Karte – je Reich eine im nächsten
Trümmerfeld, dazu ein paar herrenlose Brocken. Sie gehören dem Reich, dessen
**Grenze um sie herum verläuft** – fällt die Welt daneben, wechselt die Basis
den Besitzer, ganz ohne eigene Eroberungsregel.

### Verbände

Eine Flotte führt **je Art einen Verband**, nicht drei nebeneinander: zwei
Rapier-Staffeln stehen als eine Staffel mit doppelter Sollstärke in der Liste
(24/24 statt zweimal 12/12). Das liest sich schneller, und gerechnet wird
ohnehin über die Zahl der Maschinen. Beim Zusammenlegen zweier Flotten und
beim Laden alter Feldzüge geschieht dasselbe.

Sechs Rollen, die einander im Kreis schlagen: **Jäger** fangen **Bomber**,
Bomber knacken **Kreuzer** und **Korvetten**, Großkampfschiffe zerfetzen Jäger.
Ein Jäger kommt an der Flak eines Kreuzers **nicht** vorbei – Bomber bleiben
der einzige Weg, einen schweren Kiel zu knacken. Panzerung zählt dabei auch
beim Sterben: ein Kreuzer verträgt ein Vielfaches, ehe er ausfällt, und nach
fünf Runden entscheidet der **Gefechtswert**, nicht die Stückzahl – zwei
Kreuzer sind mehr als zwanzig angeschlagene Jäger.
**Träger** tragen keine Waffe, die zählt – sie machen die Jäger neben sich
stärker. **Landungstruppen** nehmen Welten; ohne sie fällt keine.

Die Namen richten sich nach der Werft: Rapier, Broadsword, Tallahassee und
Bengal bei der Konföderation, Dralthi, Paktahn, Kamekh, Fralthi und Snakeir
beim Imperium, Banshee und Kormoran bei den Grenzwelten, Sabre und Longbow beim
Landreich.

### Erfahrung

Ein Verband lernt in jedem Gefecht dazu - **fünf Stufen** vom Neuling über
Erfahren, Veteranen, Asse und Elite bis zur **Legende**, jede ein Stern auf
dem Staffelschild und bis zu 35 % mehr Durchschlag. Wer aufgefrischt wird,
verliert einen Teil davon: neue Piloten senken den Schnitt.

### Asse

Eine Flotte kann ein **Ass** tragen – Christopher „Maverick" Blair, „Maniac"
Marshall, „Angel" Devereaux, „Hunter", „Iceman", „Paladin", auf der anderen
Seite Ralgha „Hobbes" nar Hhallas, Baron Jukaga, „Blutklaue" Kur'utak. Ein Ass
verstärkt seine Rolle, hebt die Moral oder gibt einen Bewegungspunkt. Fällt die
Flotte, kann das Ass mit ihr fallen – dann steht sein Name in der Chronik und
nie wieder auf der Karte.

## Was auf der Karte steht

Die Namen stehen als **Sprites im Raum**, unter ihrer Welt, mit dem Farbstrich
der Flagge, einem Stern für Hauptwelten und einer Raute für Große Werke. Sie
werden bei jedem Bild auf gleichbleibende Bildschirmgröße gerechnet - also
weder winzig noch riesig, egal wie nah die Kamera steht - und sie weichen
einander aus: wo zwei Namen kollidieren, bleibt der wichtigere stehen. Je
weiter die Kamera zurückgeht, desto weniger Namen bleiben; aus der Ferne
stehen nur noch Sol, Vega, Kilrah und ihresgleichen. Die Stärke einer Flotte
steht als Schild über dem Verband.

Jeder Name trägt das **Wappen seiner Flagge** - man sieht, wem eine Welt
gehört, ohne die Farbe deuten zu müssen.

Jede Welt steht in einem Orbit über der Platte, hoch genug, dass ihr
**Deflektornetz** rundherum Platz hat: eine Blase mit einem Netz darüber, das
sich langsam dreht und die Welt **vollständig umschließt** – vorher schnitt die
Tischkante die Blase unten ab. Fällt der Schild, färbt sich das Netz warm.
Der Werftring liegt flach im Orbit und bleibt damit innerhalb des Schildes,
unter der Welt liegt ihre Flagge als Scheibe auf der Platte.

**Grenzen:** Jede Welt greift in den Raum um sich aus, große weiter als kleine,
Hauptwelten am weitesten; ein Feld gehört der Welt, die ihm am nächsten liegt.
Daraus wird eine Fläche in der Farbe der Flagge und eine Linie dort, wo zwei
Reiche aneinanderstoßen. Ein Zeichen in der Kopfleiste schaltet beides ab und
an, und im Reichsfenster steht, wie viele Felder das eigene Reich hält.

Angeklickt wird, was man sieht: an jeder Welt und jedem Verband sitzt ein
unsichtbarer Fangkörper. Wer auf einen Planeten oder ein Schiff zeigt, wählt
dessen Feld - und nicht das Feld dahinter, auf das der Strahl sonst fiele.

### Wie eine Flotte fliegt

Ein Weg über ein Gitter ist eine **Treppe**: rechts, hoch, rechts, hoch. Wer
so fliegt, zappelt. Also wird der Weg vor dem Start geglättet – erst werden
Zwischenpunkte eingeschoben, dann die Ecken in fünf Durchgängen weggemittelt,
Anfang und Ende bleiben, wo sie sind. Darüber läuft eine weiche Kurve, und die
Nase des Verbands richtet sich nach der **tatsächlichen Bewegung**, nicht nach
der Tangente – weich nachgezogen und in die Kurve gelegt. Aus der Treppe wird
eine Bahn.

## Wie eine Welt fällt

Eine Welt fällt erst, wenn drei Dinge zusammenkommen:

1. Die **Planetenwache** ist geschlagen,
2. der **Planetenschild** ist niedergedrückt – dafür braucht es Bomber,
3. und es sind **Landungstruppen** dabei.

Wer nichts davon hat, kann eine Welt **einschließen**: Die Belagerung zehrt
Wache und Schild auf, bis die Welt von selbst fällt. Oder man **blockiert** sie:
Dann bleiben ihre Kassen leer.

Fünf Schildstufen vom Deflektornetz bis zum Zitadellenschild, sieben Ausbauten
(Orbitalwerft, Bergbauring, Handelsstation, Sensorphalanx, Geschützplattformen,
Flugakademie, Terraformer), drei Techniklinien (Triebwerke, Waffen, Schilde) mit
je drei Stufen und acht Schlachtordnungen – vom Zangenangriff über den
Torpedolauf bis zum Nebelhinterhalt, den es nur in der Bank gibt.

## Sechs Große Werke

Sie liegen fest auf der Karte und gehören dem, der das System hält: das
**Sprungtor von Sol** (+1 Bewegung), die **Werften von Vega** (kürzere
Bauzeiten), der **Große Basar** von New Detroit (Kredits), die **Klauenhalle**
von Kilrah (+15 % Angriff), der **Nesthort** von Firekka (Moral) und der
**Horchposten Enigma** (Sicht).

## Drei Ausgangslagen

* **Der Vega-Feldzug (2654)** – das Imperium hat McAuliffe überrannt.
* **Enigma 2667** – K'tithrak Mang ist gefallen, die Grenzwelten trauen niemandem.
* **Der Grenzkrieg (2673)** – Kilrah ist gefallen, der Krieg läuft zwischen Menschen.

Die Karte, die Flaggen und die Regeln bleiben gleich; was sich unterscheidet,
ist der erste Tag.

## Sieg

Nimm die Hauptwelt deines Erzfeindes – oder halte 28 Systeme. Verlierst du alle,
ist der Feldzug vorbei.

## Starten

Im Browser:

```bash
node server.js       # http://localhost:8090
```

Als Desktop-Anwendung (eigenes Fenster, eigenes Icon):

```bash
npm install
npm run desktop      # Electron
npm run dist:linux   # AppImage bauen (analog dist:win, dist:mac)
```

Der kleine Server wird gebraucht, weil Chromium ES-Module nicht von einer
`file://`-Adresse lädt.

## Als Artefakt

Das ganze Spiel passt in eine einzige HTML-Datei: der Bündler legt die zwanzig
Module, die Formatvorlage und Three.js zusammen.

```bash
npm run artifact     # dist/black-univers.html, rund 7 MB, ohne Nachladen
```

Die Aufnahme wandert dabei als Datenadresse mit in die Seite - deshalb die
sieben Megabyte, und deshalb klingt auch die einzelne Datei.

Die Datei läuft per Doppelklick im Browser und lässt sich als Artefakt
veröffentlichen. Der Spielstand liegt dann im Speicher des Browsers, in dem sie
geöffnet wurde.

## Steuerung

Die Regel: **Was zählt, steht da. Was nicht dasteht, ist einen Klick weit weg.**

**Die Kopfleiste** ist nicht nur Anzeige, sondern Bedienung: Kasse, Systeme,
Flotten und Technik sind Schaltflächen. Ein Klick auf die Kasse öffnet das
Reich, einer auf die Flotten springt zur nächsten mit Bewegung, einer auf die
Technik die Forschungstafel. Die Zeichen rechts führen zu Reich, Diplomatie,
Technik, Chronik, Grenzen, Flaggenansicht, **Hilfe**, Einstellungen und Menü –
jedes erklärt sich beim Überfahren **sofort**, ohne die Sekunde, die der
Browser sonst wartet.

**Vor jedem Angriff** steht die **Schlachtordnung** in der Vorschau selbst:
Zangenangriff, Panzerkeil, Schwarmangriff oder Torpedolauf, jede mit ihrer
Wirkung daneben. Ein Klick setzt sie, die Siegchance rechnet sofort neu, und
das Fenster bleibt stehen, bis man sich entschieden hat.

**Die Aufgabenleiste** darunter sagt, was in diesem Zug noch offen ist, und
jeder Punkt führt mit einem Klick zur Sache selbst:

| Punkt | Ein Klick bringt dich … |
| --- | --- |
| *n Flotten haben noch Bewegung* | zur nächsten Flotte, Karte fährt mit |
| *n Werften ohne Auftrag* | zur nächsten leeren Werft, Bautafel offen |
| *Keine Forschung in Arbeit* | in die Technik |
| *n Angebote liegen vor* | in die Diplomatie |
| *Welt steht unter Druck* | zur belagerten oder blockierten Welt |

Ist nichts mehr offen, steht dort **„Alles erledigt – Zug beenden"**. Der
Knopf oben rechts trägt dieselbe Nachricht: `Zug beenden (2)` heißt, zwei
Flotten warten noch.

**Die Karte unter dem Zeiger**: Wer über eine Welt fährt, sieht ohne Klick
Name, Flagge, Ertrag, Schild und Wache; über einer Flotte Name, Flagge,
Maschinen und Moral; über leerem Raum die Art des Feldes und den Sprungpunkt.

**Die Übersichtskarte** unten rechts zeigt das ganze Sternenfeld: Welten in
der Farbe ihrer Flagge, eigene Verbände als helle Punkte, dazu der Rahmen
dessen, was gerade im Bild ist. Ein Klick hinein springt dorthin – niemand
muss quer über die Karte ziehen. `Ü` klappt sie weg.

| Eingabe | Wirkung |
| --- | --- |
| Linke Maustaste ziehen | Karte schwenken |
| **Mausrad gedrückt ziehen** | Kamera frei drehen und neigen (nach unten: hinunter zur Brücke) |
| **Rechte Maustaste** | Zurück: erst die offene Tafel schließen, dann die Auswahl aufheben – überall, auch über einer Tafel |
| Mausrad, `+` / `−` | Zoomen · Doppelklick holt ein Feld in die Mitte |
| Klick auf eigene Flotte | Auswählen – blaue Felder sind erreichbar, rote Rauten sind Ziele |
| Klick auf blaues Feld | Hinfliegen (der Weg wird beim Überfahren gezeigt) |
| Klick auf rotes Feld | Angreifen (mit Vorschau, bevor es ernst wird) |
| Klick in die Übersichtskarte | Dorthin springen |
| Pfeiltasten | Schwenken · `Q`/`E` drehen · `R` Kamera zurücksetzen |
| Leertaste / Eingabe | Zug beenden |
| `N` | Nächste Flotte mit Bewegung · `H` nach Hause |
| `I` / `D` / `T` / `C` | Reich · Diplomatie · Technik · Chronik |
| `B` / `M` / `Ü` | Grenzen · Flaggenansicht · Übersichtskarte |
| `F` | Vollbild ein und aus (der Feldzug startet von selbst darin) |
| `F1` oder `?` | Steuerung und Hilfe – alles auf einer Tafel |
| `Esc` | Auswahl aufheben · Tafel schließen · Gefecht überspringen |

## Aufbau des Codes

Reine ES-Module, keine Bauwerkzeuge, keine Abhängigkeiten außer Three.js
(r149, vom CDN; die mitgelieferte Fassung unter `js/vendor/` springt ein, wenn
das CDN nicht durchkommt).

Vor dem Spielcode laufen drei einfache Skripte unter `js/render/`, die beide
Spiele sich teilen. Sie sind bewusst keine Module: sie müssen stehen, ehe die
erste Farbe angelegt wird.

| Datei | Was sie tut |
| --- | --- |
| `envmap.js` | Malt eine kleine Himmelskugel in eine Leinwand und macht daraus eine Umgebungskarte. Ohne sie bleiben metallische Rümpfe fast schwarz – sie hätten nichts zum Spiegeln. |
| `colorpipeline.js` | Farbverwaltung an, Ausgabe in sRGB, ACES-Tonwerte. Dazu bekommt jede gemalte Leinwand den Vermerk sRGB – sonst kämen Beschriftungen und Flugdeck zu hell heraus. |
| `postfx.js` | Eigene Nachbearbeitung ohne fremde Bausteine: heller Auszug über einer Schwelle, zwei getrennte Unschärfen in halber Größe, Zusammensetzen mit Tonwerten. Die Tonwertabbildung wandert dabei aus dem Renderer in den letzten Durchgang – nur so wird das Leuchten addiert, **bevor** die Helligkeit zusammengedrückt wird. |

Im Gefecht wandert außerdem ein einzelnes Licht mit, das bei jedem Schuss und
jeder Explosion kurz aufflammt: Mündungsfeuer beleuchtet damit die Rümpfe
ringsum, statt nur selbst zu strahlen. Die **Geräusche werden gerechnet, nicht
geladen**: Funk, Triebwerke, Laser und Einschläge entstehen im Browser aus
Oszillatoren. Die **Musik ist eine Aufnahme**: „Black Hull Directive"
(`audio/black-hull-directive.mp3`) läuft im Startbild und tritt im Feldzug
hinter die Meldungen zurück; sie lässt sich in den Einstellungen abschalten.
Fehlt die Datei, springt der eingebaute Synthesizer-Marsch ein.

Sie **startet von selbst**. Browser lassen Ton erst nach einer Handlung des
Nutzers zu - deshalb besorgt sich das Spiel den Klick: ein ausgelöster Klick
beim Programmstart (den manche Browser gelten lassen), danach ein Pulsschlag,
der es alle drei Viertelsekunden erneut versucht, und ein Netz aus Lauschern
auf Zeiger, Taste, Rad und Berührung, das die allererste echte Handlung
abfängt. Läuft der Ton, hört alles davon von selbst wieder auf. Solange der
Vorspann läuft, bleibt die Musik aus - der Film bringt seinen eigenen Ton mit.

| Datei | Inhalt |
| --- | --- |
| `js/data.js` | Alle Zahlen: Flaggen, Rollen, Schiffe, Systeme, Ausbauten, Technik |
| `js/starchart.js` | Der Kartenausschnitt: Sektoren, Nebel, Trümmer, Gräben |
| `js/mapgen.js` | Aus den Zonen wird das Raster, dazu die Sprungpunkte |
| `js/state.js` | Der Weltzustand – ein Feldzug ist ein Objekt |
| `js/pathfind.js` | Wegfinder über Felder und Sprungpunkte |
| `js/combat.js` | Die Gefechtsrechnung, Runde für Runde |
| `js/actions.js` | Alle Züge: fliegen, angreifen, bauen, forschen, belagern, kassieren |
| `js/ai.js` | Die anderen Reiche – gleiche Regeln, keine Abkürzungen |
| `js/diplomacy.js` | Beziehungen, Verträge, Kriege, Angebote |
| `js/events.js` | Ereignisse, Freibeuter, der Schwarm |
| `js/pilots.js` | Herrscher, Eigenschaften, Asse |
| `js/ships3d.js` | Die Schiffsmodelle: Rapier, Broadsword, Bengal, Dralthi, Fralthi, Snakeir |
| `js/titlescene3d.js` | Das Startbild in Echtzeit: Träger, Rotte, Nebel, Planet |
| `js/territory.js` | Wem der Raum gehört: Reichweiten der Welten, Flächen, Grenzlinien |
| `js/scene3d.js` | Die Darstellung: Holotisch, Brücke, Karte, Flotten, Nebel des Krieges |
| `js/battle3d.js` | Das Gefecht auf der Karte |
| `js/ui.js` | Kopfleiste, Tafeln, Berichte |
| `js/input.js` | Maus, Finger, Tastatur |
| `js/main.js` | Startbild, Auswahl, Zugschleife – der Draht dazwischen |

## Prüfläufe

```bash
node test/smoke.mjs 80          # 80 Züge ohne Bildschirm, alle Regeln, alle Prüfungen
node test/smoke.mjs 60 enigma   # anderes Szenario
node test/browser.mjs           # echtes Chromium: klicken, fliegen, kämpfen, fotografieren
```

Der erste Lauf spielt einen ganzen Feldzug mit der KI auf allen Seiten und prüft
nach jedem Zug, ob die Welt in sich stimmt: keine Flotte im Graben, keine
negativen Kassen, keine leeren Verbände. Der zweite startet das Spiel in einem
echten Browser, klickt sich durch Fraktionswahl, Karte, Flug, Gefecht und fünf
Züge und meldet jeden Fehler in der Konsole.
