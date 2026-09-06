// Die Spielversion. Sie steht im Startbildschirm und muss mit der Angabe in
// package.json übereinstimmen - dieselbe Zahl trägt auch das Desktop-Paket.
export const GAME_VERSION = '1.66.1';

// The grid comes from the geography, not the other way round: change the
// bounds or the tile size in geodata.js and everything here follows.
export { MAP_COLS, MAP_ROWS } from './geodata.js';

// Bewegung wird in Punkten gerechnet, nicht in Feldern: offene Ebene kostet 3,
// gebrochenes Gelände - Wald, Hügel, Wüste - das Doppelte, eine gepflasterte
// Straße 1. Eine Straße ist damit ein Drittel der Ebene wert und ein Sechstel
// des Waldes: wer sein Land mit Straßen überzieht, verschiebt seine Heere ein
// Vielfaches schneller als über freies Feld. Ein Heer hat 18 Punkte: sechs
// Felder Ebene, drei Felder Wald, achtzehn Felder Straße.
export const TILE_TYPES = {
  plains: { name: 'Ebene', cost: 3, defense: 0, elevation: 0, color: '#8fae5a', deco: null },
  forest: { name: 'Wald', cost: 6, defense: 1, elevation: 0.35, color: '#4c7a3f', deco: 'tree' },
  hills: { name: 'Hügel', cost: 6, defense: 2, elevation: 1, color: '#b3a06b', deco: null },
  desert: { name: 'Wüste', cost: 6, defense: 0, elevation: 0.08, color: '#d9c489', deco: null },
  mountain: {
    name: 'Gebirge', cost: 198, defense: 3, elevation: 2.6, color: '#8a8a8a',
    deco: 'peak', impassable: true,
  },
  // Impassable on foot; a fleet crosses it at the sea cost below.
  water: { name: 'Meer', cost: 198, defense: 0, elevation: -0.4, color: '#3f6fa8', deco: null, impassable: true },
};

// --- Höhe und Pässe -------------------------------------------------------
// Ein Feld Höhe entspricht ungefähr so vielen Metern - das ist es, was aus
// einer Zahl, die niemand liest, eine Höhe macht, die ein Spieler kennt.
export const METRES_PER_ELEVATION = 900;

// Bis hierher führt ein Weg über das Gebirge: ein Pass, mühsam, aber begehbar.
// Was höher liegt, ist Fels und Eis und für ein Heer keine Straße. Hannibal
// zog über den Alpenhauptkamm auf etwa dieser Höhe.
export const PASSABLE_ALTITUDE = 2000;
// Was ein solcher Übergang kostet: das Doppelte von gebrochenem Gelände. Ein
// Heer schafft in einer Runde gerade einen Pass und einen Schritt dahinter -
// und kommt erschöpft an, weil Erschöpfung je Bewegungspunkt anfällt.
export const MOUNTAIN_PASS_COST = 12;

// Wie hoch dieses Feld liegt, in Metern.
export function tileAltitude(tile) {
  return Math.round((tile.elevation ?? TILE_TYPES[tile.type].elevation) * METRES_PER_ELEVATION);
}

// Ob ein Heer hier überhaupt hindurchkommt. Das Gebirge ist nicht mehr
// pauschal gesperrt: es kommt auf die Höhe an.
export function tileImpassable(tile) {
  const def = TILE_TYPES[tile.type];
  if (!def.impassable) return false;
  if (tile.type !== 'mountain') return true;
  return tileAltitude(tile) > PASSABLE_ALTITUDE;
}

// Was ein Schritt auf dieses Feld kostet - für den Pass ein eigener Satz.
export function tileMoveCost(tile) {
  const def = TILE_TYPES[tile.type];
  if (tile.type === 'mountain' && !tileImpassable(tile)) return MOUNTAIN_PASS_COST;
  return def.cost;
}

// Drei Waffengattungen, überall dieselben - damit bleiben die Regeln ein
// einziger Satz. Was sich unterscheidet, ist, wer sie füllt: die römische
// Legion ist nicht der dakische Falxträger, auch wenn beide "Fußvolk" sind.
export const UNIT_ROLES = ['infantry', 'cavalry', 'ranged'];

export const ROLE_LABELS = {
  infantry: 'Fußvolk',
  cavalry: 'Reiterei',
  ranged: 'Fernkampf',
  watch: 'Stadtwache',
  ships: 'Kriegsschiffe',
};

// Die Stadtwache ist keine Feldtruppe: sie wird nicht ausgehoben, sie zieht
// nicht mit, sie steht. Jede Siedlung hat sie von sich aus, und sie wächst
// mit der Bevölkerung nach. Deshalb steht sie neben den drei Waffengattungen
// und nicht unter ihnen.
export const WATCH_ROLE = 'watch';
export const GARRISON_ROLES = [...UNIT_ROLES, WATCH_ROLE];

// Kriegsschiffe sind die vierte Truppengattung, und die einzige, die nur zur
// See etwas ausrichtet: sie werden in einer Hafenstadt gebaut, stehen nie in
// einer Garnison und gehen nie an Land.
export const SHIP_ROLE = 'ships';
// Alles, was in einer Schlacht vorkommen kann - Feldtruppen, Stadtwache,
// Schiffe. Die Kampfrechnung geht über diese Liste.
export const COMBAT_ROLES = [...GARRISON_ROLES, SHIP_ROLE];

// Eine Schiffsbesatzung samt Rammsporn: zur See stark, an Land nichts, weshalb
// eine Flotte auch nie einen Fuß dorthin setzt.
// Gezählt werden Schiffe, nicht Männer: ein Rammsporn wiegt eine ganze
// Abteilung auf, deshalb stehen die Werte je Schiff so hoch.
//
// Drei Bauarten, wie sie im 3. Jahrhundert v. Chr. tatsächlich nebeneinander
// fuhren: die schwere Fünfruderer-Flotte der Mittelmeermächte, der leichte
// Ruderer der Ägäis und der Adria, und das hochbordige Segelschiff des
// Nordens, dem der Rammsporn wenig anhaben konnte.
export const SHIP_TYPES = {
  quinquereme: {
    key: 'quinquereme',
    name: 'Quinqueremen',
    icon: '⛵',
    attack: 50, defense: 52, hp: 780, cost: 220, upkeep: 0.55,
    note: 'Fünfruderer mit Enterbrücke und Turm – schwer, teuer, im Rammstoß überlegen.',
  },
  triere: {
    key: 'triere',
    name: 'Trieren',
    icon: '🛶',
    attack: 46, defense: 45, hp: 690, cost: 190, upkeep: 0.47,
    note: 'Der Dreiruderer, das Arbeitspferd jeder Flotte – wendig genug zum Rammen, '
      + 'stark genug für die Linie.',
  },
  lembos: {
    key: 'lembos',
    name: 'Lemboi',
    icon: '🚣',
    attack: 44, defense: 36, hp: 540, cost: 150, upkeep: 0.38,
    note: 'Der illyrische Einruderer: schnell und billig, aber dünnwandig – gut zum '
      + 'Zusetzen, schlecht zum Standhalten.',
  },
  keltenschiff: {
    key: 'keltenschiff',
    name: 'Segelschiffe',
    icon: '⛵',
    attack: 36, defense: 54, hp: 760, cost: 195, upkeep: 0.5,
    note: 'Hochbordige Eichenrümpfe mit Ledersegel – schwer zu rammen, schwach im Angriff.',
  },
  // Das Schiff der Seeräuber: anderthalb Ruderreihen, kein Turm, kein Ballast.
  // Es holt jeden ein und hält nichts aus - deshalb greift es Transporter an
  // und nicht die Kriegsflotte.
  hemiolia: {
    key: 'hemiolia',
    name: 'Hemiolien',
    icon: '🏴',
    attack: 52, defense: 30, hp: 480, cost: 0, upkeep: 0,
    note: 'Anderthalbruderer der Seeräuber: das schnellste Schiff der See, '
      + 'im offenen Kampf das schwächste.',
  },
};

// Wer welche Bauarten fahren kann - bis zu drei je Fraktion, die erste ist
// die, mit der sie in den Krieg zieht. Rom lernte den Schiffbau von einer
// gestrandeten punischen Quinquereme; die Diadochenreiche bauten dieselben
// schweren Einheiten und daneben die Triere, die überall fuhr. Illyrer und
// Iberer fuhren leicht, die Stämme des Nordens und die Binnenvölker mit
// hochbordigen Seglern.
export const FACTION_SHIP_TYPES = {
  rom: ['quinquereme', 'triere', 'lembos'],
  karthago: ['quinquereme', 'triere', 'lembos'],
  seleukiden: ['quinquereme', 'triere'],
  ptolemaeer: ['quinquereme', 'triere', 'lembos'],
  pontus: ['quinquereme', 'triere', 'lembos'],
  // Athen war die Trierenmacht schlechthin; Sparta blieb auch nach Aigospotamoi
  // ein Landheer mit geliehenen Schiffen.
  athen: ['triere', 'quinquereme', 'lembos'],
  sparta: ['triere', 'lembos'],
  makedonien: ['quinquereme', 'triere', 'lembos'],
  // Syrakus baute die schwersten Schiffe des Westens - Hieron ließ sogar die
  // Syrakusia auf Kiel legen, das größte Schiff der Antike.
  syrakus: ['quinquereme', 'triere', 'lembos'],
  illyrer: ['lembos', 'triere'],
  iberer: ['lembos', 'triere'],
  numidien: ['lembos', 'triere'],
  parther: ['lembos'],
  armenien: ['lembos'],
  gallier: ['keltenschiff', 'lembos'],
  britannier: ['keltenschiff', 'lembos'],
  germanen: ['keltenschiff', 'lembos'],
  daker: ['keltenschiff', 'lembos'],
  sarmaten: ['keltenschiff', 'lembos'],
  neutral: ['lembos'],
  piraten: ['hemiolia'],
};

// Alle Bauarten, die diese Fraktion in ihren Werften bauen kann.
export function shipTypesOf(factionId) {
  const keys = FACTION_SHIP_TYPES[factionId] || FACTION_SHIP_TYPES.neutral;
  return keys.map((key) => SHIP_TYPES[key]).filter(Boolean);
}

// Eine Bauart am Namen, mit der Bauart der Fraktion als Rückfall.
export function shipTypeByKey(key, factionId = 'neutral') {
  return SHIP_TYPES[key] || shipTypesOf(factionId)[0] || SHIP_TYPES.lembos;
}

// Die Bauart, mit der eine Fraktion in den Krieg zieht: die erste ihrer Liste.
export function shipTypeOf(factionId) {
  return shipTypesOf(factionId)[0] || SHIP_TYPES.lembos;
}

// Auf der Mauer taugt sie, im offenen Feld wäre sie nichts - was sie nie ist.
export const WATCH_UNIT = {
  name: 'Stadtwache', icon: '🛡️', attack: 3, defense: 8, hp: 88, cost: 0, upkeep: 0,
};

// Ein Wächter je so vielen Einwohnern - die Sollstärke, auf die eine Wache
// nachwächst.
export const WATCH_POP_RATIO = 16;
// So viele Mann stellt eine Stadt je Runde nach: langsam genug, dass eine
// gestürmte Stadt nicht in zwei Runden wieder voll ist.
export const WATCH_GROWTH_MIN = 4;
export const WATCH_GROWTH_SHARE = 0.05;

export function watchTarget(city, faction) {
  const levy = factionGarrisonFactor(faction);
  return Math.round((city.population / WATCH_POP_RATIO) * levy);
}

export function watchGrowth(target) {
  return Math.max(WATCH_GROWTH_MIN, Math.round(target * WATCH_GROWTH_SHARE));
}

// attack   Angriffskraft je Mann
// defense  Verteidigungskraft je Mann
// hp       wie viel ein Mann aushält
// cost     Rekrutierungskosten je Trupp
// upkeep   Sold je Mann und Runde
export const FACTION_UNITS = {
  rom: {
    infantry: { name: 'Legionär', icon: '⚔️', attack: 6, defense: 10, hp: 105, cost: 110, upkeep: 0.055 },
    cavalry: { name: 'Equites', icon: '🐎', attack: 9, defense: 4, hp: 90, cost: 150, upkeep: 0.09 },
    ranged: { name: 'Veliten', icon: '🏹', attack: 5, defense: 3, hp: 70, cost: 115, upkeep: 0.06, ranged: true },
  },
  karthago: {
    infantry: { name: 'Libysche Speerträger', icon: '⚔️', attack: 6, defense: 9, hp: 100, cost: 100, upkeep: 0.05 },
    cavalry: { name: 'Punische Reiterei', icon: '🐎', attack: 11, defense: 3, hp: 85, cost: 145, upkeep: 0.09 },
    ranged: { name: 'Balearische Schleuderer', icon: '🪨', attack: 6, defense: 3, hp: 70, cost: 125, upkeep: 0.065, ranged: true },
  },
  // Numidien: leichtes Fußvolk, das nur die Reiter deckt - und die beste
  // leichte Reiterei der Karte, die niemand stellen kann.
  numidien: {
    infantry: { name: 'Numidische Speerträger', icon: '⚔️', attack: 6, defense: 6, hp: 90, cost: 90, upkeep: 0.045 },
    cavalry: { name: 'Numidische Reiter', icon: '🐎', attack: 12, defense: 3, hp: 85, cost: 145, upkeep: 0.09 },
    ranged: { name: 'Numidische Speerwerfer', icon: '🪶', attack: 6, defense: 3, hp: 70, cost: 105, upkeep: 0.055, ranged: true },
  },
  // Parthien kämpft zu Pferde: Fußvolk taugt nur zum Halten, die Entscheidung
  // fällt zwischen Panzerreitern und berittenen Bogenschützen.
  parther: {
    infantry: { name: 'Persisches Fußvolk', icon: '⚔️', attack: 5, defense: 7, hp: 95, cost: 95, upkeep: 0.05 },
    cavalry: { name: 'Kataphrakten', icon: '🐎', attack: 13, defense: 8, hp: 105, cost: 200, upkeep: 0.125 },
    ranged: { name: 'Berittene Bogenschützen', icon: '🏹', attack: 8, defense: 4, hp: 80, cost: 140, upkeep: 0.08, ranged: true },
  },
  // Armenien: schwere Reiterei aus dem Bergadel, dazu ein Fußvolk, das anders
  // als das parthische wirklich stehen kann.
  armenien: {
    infantry: { name: 'Armenische Speerträger', icon: '⚔️', attack: 6, defense: 9, hp: 100, cost: 105, upkeep: 0.055 },
    cavalry: { name: 'Armenische Kataphrakten', icon: '🐎', attack: 12, defense: 9, hp: 100, cost: 195, upkeep: 0.12 },
    ranged: { name: 'Armenische Bogenschützen', icon: '🏹', attack: 6, defense: 4, hp: 75, cost: 110, upkeep: 0.055, ranged: true },
  },
  // Pontus: hellenistische Phalanx im Zentrum, dazu Reiter aus dem Hinterland
  // und die Bogenschützen der Chalyber vom Schwarzen Meer.
  pontus: {
    infantry: { name: 'Pontische Phalangiten', icon: '🛡️', attack: 6, defense: 11, hp: 100, cost: 118, upkeep: 0.06 },
    cavalry: { name: 'Pontische Reiter', icon: '🐎', attack: 10, defense: 5, hp: 90, cost: 150, upkeep: 0.09 },
    ranged: { name: 'Chalybische Bogenschützen', icon: '🏹', attack: 7, defense: 3, hp: 70, cost: 120, upkeep: 0.06, ranged: true },
  },
  gallier: {
    infantry: { name: 'Schwertkämpfer', icon: '🗡️', attack: 8, defense: 7, hp: 105, cost: 105, upkeep: 0.055 },
    cavalry: { name: 'Edle Reiter', icon: '🐎', attack: 10, defense: 4, hp: 90, cost: 150, upkeep: 0.09 },
    ranged: { name: 'Bogenschützen', icon: '🏹', attack: 4, defense: 3, hp: 70, cost: 105, upkeep: 0.05, ranged: true },
  },
  // Athen: solides Bürgerfußvolk, eine Reiterei aus den Rittern des Zensus und
  // die Toxotai. Die Stärke der Stadt lag nie an Land - sie lag auf dem Wasser.
  athen: {
    infantry: { name: 'Athenische Hopliten', icon: '🛡️', attack: 6, defense: 10, hp: 100, cost: 112, upkeep: 0.058 },
    cavalry: { name: 'Athenische Ritter', icon: '🐎', attack: 9, defense: 5, hp: 90, cost: 150, upkeep: 0.09 },
    ranged: { name: 'Toxotai', icon: '🏹', attack: 6, defense: 4, hp: 74, cost: 115, upkeep: 0.06, ranged: true },
  },
  // Sparta: das beste Fußvolk der Karte, und sonst fast nichts. Der Spartiat
  // ist teuer, weil es wenige von ihnen gab - die Oliganthropie war Spartas
  // eigentliche Niederlage. Die Reiterei taugte nie, und geschleudert haben
  // die Periöken.
  sparta: {
    infantry: { name: 'Spartiaten', icon: '🛡️', attack: 6, defense: 13, hp: 104, cost: 132, upkeep: 0.07 },
    cavalry: { name: 'Lakedaimonische Reiter', icon: '🐎', attack: 7, defense: 4, hp: 86, cost: 145, upkeep: 0.085 },
    ranged: { name: 'Periöken-Schleuderer', icon: '🪨', attack: 4, defense: 3, hp: 68, cost: 95, upkeep: 0.045, ranged: true },
  },
  // Die Sarissenphalanx, das Vorbild, das alle anderen nachbauten: sie deckt
  // sich nicht so gut wie die Hoplitenwand der Griechen, aber sie greift an -
  // fünf Meter Speer reichen weiter als jeder Schild. Dazu die Hetairoi, mit
  // denen Alexander seine Schlachten entschied.
  makedonien: {
    infantry: { name: 'Sarissenphalanx', icon: '🛡️', attack: 7, defense: 11, hp: 104, cost: 122, upkeep: 0.063 },
    cavalry: { name: 'Hetairoi', icon: '🐎', attack: 12, defense: 6, hp: 96, cost: 170, upkeep: 0.1 },
    ranged: { name: 'Agrianische Speerwerfer', icon: '🎯', attack: 6, defense: 4, hp: 74, cost: 112, upkeep: 0.058, ranged: true },
  },
  // Syrakus kämpft griechisch und schießt sizilisch: solides Fußvolk, wenig
  // Reiterei, und die Schützen einer Stadt, in der das Geschütz erfunden
  // wurde.
  syrakus: {
    infantry: { name: 'Syrakusanische Hopliten', icon: '🛡️', attack: 6, defense: 10, hp: 100, cost: 112, upkeep: 0.057 },
    cavalry: { name: 'Syrakusanische Reiter', icon: '🐎', attack: 9, defense: 5, hp: 88, cost: 148, upkeep: 0.088 },
    ranged: { name: 'Sizilische Schützen', icon: '🏹', attack: 7, defense: 4, hp: 74, cost: 124, upkeep: 0.065, ranged: true },
  },
  germanen: {
    infantry: { name: 'Speerträger', icon: '⚔️', attack: 7, defense: 8, hp: 105, cost: 95, upkeep: 0.05 },
    cavalry: { name: 'Gefolgschaftsreiter', icon: '🐎', attack: 9, defense: 4, hp: 90, cost: 145, upkeep: 0.085 },
    ranged: { name: 'Wurfspeerträger', icon: '🎯', attack: 5, defense: 3, hp: 70, cost: 105, upkeep: 0.05, ranged: true },
  },
  britannier: {
    infantry: { name: 'Keltenkrieger', icon: '⚔️', attack: 7, defense: 8, hp: 100, cost: 100, upkeep: 0.05 },
    cavalry: { name: 'Streitwagen', icon: '🛞', attack: 12, defense: 4, hp: 95, cost: 165, upkeep: 0.1 },
    ranged: { name: 'Schleuderer', icon: '🪨', attack: 5, defense: 3, hp: 70, cost: 110, upkeep: 0.055, ranged: true },
  },
  iberer: {
    infantry: { name: 'Scutarii', icon: '⚔️', attack: 6, defense: 9, hp: 100, cost: 100, upkeep: 0.05 },
    cavalry: { name: 'Iberische Reiter', icon: '🐎', attack: 10, defense: 4, hp: 90, cost: 150, upkeep: 0.09 },
    ranged: { name: 'Caetrati', icon: '🎯', attack: 6, defense: 4, hp: 72, cost: 125, upkeep: 0.065, ranged: true },
  },
  daker: {
    infantry: { name: 'Falxträger', icon: '🪓', attack: 9, defense: 6, hp: 100, cost: 110, upkeep: 0.06 },
    cavalry: { name: 'Dakische Adelsreiter', icon: '🐎', attack: 10, defense: 6, hp: 95, cost: 165, upkeep: 0.095 },
    ranged: { name: 'Dakische Bogenschützen', icon: '🏹', attack: 5, defense: 3, hp: 70, cost: 110, upkeep: 0.055, ranged: true },
  },
  seleukiden: {
    infantry: { name: 'Silberschilde', icon: '🛡️', attack: 6, defense: 11, hp: 102, cost: 110, upkeep: 0.055 },
    // Die Elefanten stehen an der Stelle der Reiterei: wenige, teure, schwer
    // aufzuhaltende Tiere.
    cavalry: { name: 'Kriegselefanten', icon: '🐘', attack: 13, defense: 6, hp: 126, cost: 175, upkeep: 0.09 },
    ranged: { name: 'Kretische Bogenschützen', icon: '🏹', attack: 6, defense: 3, hp: 72, cost: 115, upkeep: 0.06, ranged: true },
  },
  ptolemaeer: {
    infantry: { name: 'Machimoi', icon: '⚔️', attack: 5, defense: 10, hp: 98, cost: 105, upkeep: 0.05 },
    cavalry: { name: 'Ptolemäische Reiter', icon: '🐎', attack: 9, defense: 5, hp: 92, cost: 150, upkeep: 0.09 },
    ranged: { name: 'Nubische Bogenschützen', icon: '🏹', attack: 7, defense: 3, hp: 70, cost: 120, upkeep: 0.062, ranged: true },
  },
  illyrer: {
    // Die Sica, das gekrümmte Messer der illyrischen Räuber: billig
    // aufzustellen und im Angriff gefährlich, in der Linie dünn.
    infantry: { name: 'Sicaträger', icon: '🗡️', attack: 8, defense: 6, hp: 96, cost: 95, upkeep: 0.05 },
    cavalry: { name: 'Illyrische Reiter', icon: '🐎', attack: 9, defense: 4, hp: 88, cost: 140, upkeep: 0.085 },
    ranged: { name: 'Illyrische Schleuderer', icon: '🪨', attack: 6, defense: 3, hp: 70, cost: 105, upkeep: 0.05, ranged: true },
  },
  sarmaten: {
    // Ein Reitervolk: das Fußvolk ist Beiwerk, die gepanzerte Lanzenreiterei
    // ist das Beste, was auf der Karte zu Pferde sitzt - und kostet danach.
    infantry: { name: 'Fußgefolge', icon: '⚔️', attack: 5, defense: 7, hp: 92, cost: 85, upkeep: 0.045 },
    cavalry: { name: 'Kataphrakten', icon: '🐎', attack: 11, defense: 7, hp: 102, cost: 190, upkeep: 0.12 },
    ranged: { name: 'Berittene Bogenschützen', icon: '🏹', attack: 7, defense: 3, hp: 76, cost: 140, upkeep: 0.08, ranged: true },
  },
  neutral: {
    infantry: { name: 'Stadtmiliz', icon: '⚔️', attack: 5, defense: 8, hp: 95, cost: 90, upkeep: 0.045 },
    cavalry: { name: 'Berittene Wache', icon: '🐎', attack: 8, defense: 4, hp: 85, cost: 140, upkeep: 0.085 },
    ranged: { name: 'Schleuderer', icon: '🪨', attack: 4, defense: 3, hp: 68, cost: 105, upkeep: 0.05, ranged: true },
  },
  // Ein wanderndes Volk führt keinen Feldzug: es zieht mit allem, was es hat.
  // Viel Fußvolk, dahinter die Reiter, und ein Bogen für jeden Dritten. Es
  // schlägt hart zu und hält wenig aus - es hat keine Mauer im Rücken.
  wanderer: {
    infantry: { name: 'Wehrhafte Männer', icon: '🪓', attack: 10, defense: 5, hp: 92, cost: 0, upkeep: 0 },
    cavalry: { name: 'Steppenreiter', icon: '🐎', attack: 13, defense: 5, hp: 96, cost: 0, upkeep: 0 },
    ranged: { name: 'Hornbogenschützen', icon: '🏹', attack: 9, defense: 3, hp: 70, cost: 0, upkeep: 0, ranged: true },
  },
};

// Die Wache ist überall dieselbe: sie kommt aus der Stadt, nicht aus dem Heer.
export function unitDefs(factionId) {
  const defs = FACTION_UNITS[factionId] || FACTION_UNITS.neutral;
  if (defs[WATCH_ROLE]) return defs;
  // Die Wache ist überall dieselbe, die Schiffe nicht: jede Fraktion fährt
  // die Bauart, die zu ihrer Küste gehört.
  const factionKey = Object.keys(FACTION_UNITS).find((id) => FACTION_UNITS[id] === defs);
  return Object.assign(defs, {
    [WATCH_ROLE]: WATCH_UNIT,
    [SHIP_ROLE]: shipTypeOf(factionKey || factionId),
  });
}

export function unitDef(factionId, role) {
  return unitDefs(factionId)[role] || FACTION_UNITS.neutral[role];
}

// Wer gespielt wird, steht nicht in dieser Tabelle: jede Fraktion außer den
// Unabhängigen ist spielbar, ausgewählt wird sie beim Spielstart.
export const DEFAULT_PLAYER_FACTION = 'rom';

// --- Was für ein Gebilde eine Fraktion ist ---------------------------------
// Jede Fraktion bekam lange gleich viel Land: Hauptstadt, Stadt, Dorf, drei
// Orte für alle, vom Diadochenreich bis zum Germanenstamm. Das war fair und
// falsch. Die Karte steht im Jahr 264 v. Chr., und in diesem Jahr war nichts
// gleich verteilt: das Seleukidenreich reichte von der Ägäis bis nach Medien,
// Rom hatte gerade ganz Italien unterworfen, Athen war eine Stadt.
//
// Deshalb steht die Zahl der Startorte nicht mehr in einer Regel, sondern in
// `CITY_DEFS`: dort ist eingetragen, wer 264 v. Chr. was hielt. Zwischen einem
// und sieben Orten. Diese Tabelle sagt nur noch, *was für ein Gebilde* eine
// Fraktion ist - das erklärt dem Spieler, was ihn erwartet, und ändert an den
// Regeln nichts.
export const FACTION_KINDS = {
  grossreich: {
    key: 'grossreich', label: 'Großreich',
    note: 'Ein Diadochenreich: viele Orte, weite Wege, Grenzen an allen Seiten. '
      + 'Wer so beginnt, kann alles verlieren, weil er überall etwas zu '
      + 'verlieren hat.',
  },
  republik: {
    key: 'republik', label: 'Republik',
    note: 'Ein geschlossenes Kernland mit einer Bürgerschaft dahinter. Kein '
      + 'Reich, aber der festeste Block auf der Karte.',
  },
  koenigreich: {
    key: 'koenigreich', label: 'Königreich',
    note: 'Ein Königtum mittlerer Größe zwischen den Großen: genug, um zu '
      + 'bestehen, zu wenig, um allein zu siegen.',
  },
  stadtstaat: {
    key: 'stadtstaat', label: 'Stadtstaat',
    note: 'Eine Stadt und ein Heer, und sonst nichts. Dieselben 500 Gold wie '
      + 'alle - aber kein Land dahinter, nicht einmal ein Dorf.',
  },
  stamm: {
    key: 'stamm', label: 'Stammesverband',
    note: 'Kein Staat, sondern Stämme unter einem Namen: wenige feste Orte, '
      + 'viel Land dazwischen, das niemandem gehört.',
  },
};

export const DEFAULT_FACTION_KIND = 'koenigreich';

// Was für ein Gebilde eine Fraktion ist, steht an ihr selbst.
export function factionKind(faction) {
  const key = (faction && faction.kind) || DEFAULT_FACTION_KIND;
  return FACTION_KINDS[key] || FACTION_KINDS[DEFAULT_FACTION_KIND];
}

export function isCityState(faction) {
  return factionKind(faction).key === 'stadtstaat';
}

// Wie viele Orte eine Fraktion zum Spielstart hält - gezählt, nicht gesetzt.
export function startingCityCount(factionId) {
  return CITY_DEFS.filter((c) => c.factionId === factionId).length;
}

export const FACTIONS = [
  { id: 'rom', kind: 'republik', name: 'Rom', color: '#c0392b' },
  // Karthago hält seit Generationen einen Brückenkopf in Iberien; dort steht
  // ein eigenes Heer, weil es von Afrika aus nicht zu verteidigen wäre.
  {
    id: 'karthago', kind: 'republik', name: 'Karthago', color: '#2c3e8c',
    startingArmies: [
      { units: { infantry: 300, cavalry: 120, ranged: 120 } },
      { units: { infantry: 160, cavalry: 60, ranged: 50 }, home: 'Karthago Nova' },
    ],
  },
  // Der keltische Ruf gründet auf dem Ansturm des Fußvolks mit dem langen
  // Schwert - viel Infanterie, wenig anderes.
  {
    id: 'gallier', kind: 'stamm', name: 'Gallier', color: '#27632a',
    // Gallien liegt am Kreuzweg: Germanen im Osten, Iberer im Süden,
    // Britannier über dem Kanal. Ein einziges Heer kann nur an einer Front
    // stehen - deshalb hebt der Heerbann zwei aus.
    startingArmies: [
      { infantry: 300, cavalry: 80, ranged: 40 },
      { infantry: 260, cavalry: 70, ranged: 30 },
    ],
    armyLabel: 'Heerbann',
  },
  // Numidien lebt vom Pferd: die berittenen Verbände, die Karthago jahrhunderte-
  // lang anwarb, stehen hier unter eigener Fahne.
  { id: 'numidien', kind: 'koenigreich', name: 'Numidien', color: '#c98a2e', armyLabel: 'Reiterheer' },
  // Die Parther: aus der Steppe nordöstlich des Seleukidenreichs, berittene
  // Bogenschützen und Panzerreiter - das Heer, an dem Rom später scheitert.
  { id: 'parther', kind: 'stamm', name: 'Parther', color: '#8c3f5c', armyLabel: 'Reiterheer' },
  // Armenien im Hochland zwischen Schwarzem und Kaspischem Meer: Panzerreiter
  // aus dem Bergadel, dazwischen ein Fußvolk, das die Pässe hält.
  { id: 'armenien', kind: 'koenigreich', name: 'Armenien', color: '#3f8c72', armyLabel: 'Königsheer' },
  // Pontus am Südufer des Schwarzen Meeres: ein hellenistisches Königreich
  // mit den Häfen der Küste im Rücken und den Bergen des Hinterlands davor.
  { id: 'pontus', kind: 'koenigreich', name: 'Pontus', color: '#6b6fc9' },
  // Das dritte Diadochenreich neben Seleukiden und Ptolemäern. Antigonos II.
  // hält Makedonien und dazu die Fesseln Griechenlands - Akrokorinth ist die
  // wichtigste davon, und sie liegt fünf Tagesmärsche von Pella entfernt.
  {
    id: 'makedonien', kind: 'koenigreich', name: 'Makedonien', color: '#2f5d7c',
    // Solange Korinth zu Makedonien gehörte, standen hier zwei Heere: eines in
    // Pella, eines als Besatzung auf Akrokorinth. Die Exklave ist mit der
    // Zwei-Felder-Regel weggefallen - sie lag Wand an Wand mit Athen und
    // Sparta -, und mit ihr der Grund für das zweite Heer.
    startingArmy: { infantry: 320, cavalry: 130, ranged: 90 },
    armyLabel: 'Königsheer',
  },
  // Syrakus unter Hieron II.: die reichste Stadt des griechischen Westens,
  // mit einer Flotte und mit den Werkstätten, in denen das Torsionsgeschütz
  // erfunden wurde. Um sie beginnt 264 v. Chr. der Krieg, an dem dieses Spiel
  // seinen ersten Monat hat.
  {
    id: 'syrakus', name: 'Syrakus', color: '#cfc07a', kind: 'stadtstaat',
    startingArmy: { infantry: 300, cavalry: 100, ranged: 140 },
    armyLabel: 'Stadtheer',
    // Wo Dionysios' Ingenieure das Katapult bauten, ist Gerät billiger. Das
    // ist der ganze Vorteil: eine stärkere Stadtwache dazu hatte Syrakus in
    // den Messungen zur ersten Macht der Karte gemacht - der Nachlass wirkt
    // einmal je Gerät, eine bessere Wache wirkt in jedem eroberten Ort noch
    // einmal, und das schaukelt sich auf.
    engineDiscount: 0.25,
  },
  // Athen und Sparta standen 264 v. Chr. im Chremonideischen Krieg zusammen -
  // und blieben doch zwei Staaten mit zwei Verfassungen und zwei Heeren. Als
  // eine Fraktion waren sie ein Sammelbecken; als zwei sind sie das, was sie
  // waren: zwei kleine Mächte, deren Land in einem Tagesmarsch zu Ende ist.
  { id: 'athen', name: 'Athen', color: '#7a4fae', kind: 'stadtstaat', armyLabel: 'Bürgerheer' },
  {
    id: 'sparta', name: 'Sparta', color: '#8c2b2b', kind: 'stadtstaat',
    // Wenige Bürger, aber jeder von Kindheit an Soldat: Sparta stellt ein
    // kleineres Heer als alle anderen - und das beste Fußvolk der Karte.
    startingArmy: { infantry: 260, cavalry: 70, ranged: 110 },
    armyLabel: 'Königsheer',
  },
  // The tribes field a great mass of foot: no siege train, few horse and
  // fewer bows, but more men in the line than anyone else brings.
  {
    id: 'germanen', kind: 'stamm', name: 'Germanen', color: '#1c8f93',
    // Same manpower as anyone else, arranged the tribal way: a great mass of
    // foot, with horse and bows as an afterthought.
    startingArmy: { infantry: 360, cavalry: 100, ranged: 80 },
    armyLabel: 'Heerhaufen',
  },
  // Auf der Insel, also von Anfang an auf Schiffe angewiesen. Ihre Stärke ist
  // der Streitwagen - im Spiel die Reiterei.
  {
    id: 'britannier', kind: 'stamm', name: 'Britannier', color: '#d97b2e',
    startingArmy: { infantry: 300, cavalry: 150, ranged: 90 },
    armyLabel: 'Kriegsschar',
  },
  // Die iberischen Stämme kämpfen aus der Ferne: Schleuderer und Speerwerfer
  // statt geschlossener Linie.
  {
    id: 'iberer', kind: 'stamm', name: 'Iberer', color: '#b5397f',
    startingArmy: { infantry: 250, cavalry: 100, ranged: 190 },
    armyLabel: 'Kriegerbund',
  },
  // Hinter den Karpaten, mit der Falx als Waffe und der Draco als Feldzeichen.
  {
    id: 'daker', kind: 'stamm', name: 'Daker', color: '#8a9a2b',
    startingArmy: { infantry: 320, cavalry: 130, ranged: 90 },
    armyLabel: 'Falxheer',
  },
  // Das Seleukidenreich: die makedonische Phalanx des Ostens, dazu die
  // Kriegselefanten, für die es berühmt ist.
  {
    id: 'seleukiden', kind: 'grossreich', name: 'Seleukiden', color: '#d8b12a',
    // Das größte der Diadochenreiche, und das mit den längsten Grenzen: es
    // stellt zwei Heere auf, weil es an zwei Fronten zugleich steht.
    startingArmies: [
      { infantry: 230, cavalry: 90, ranged: 70 },
      { infantry: 190, cavalry: 60, ranged: 60 },
    ],
    armyLabel: 'Königsheer',
  },
  // Ägypten unter den Ptolemäern: viel Fußvolk aus dem Niltal und die besten
  // Bogenschützen des Spiels, dafür wenig Reiterei.
  {
    id: 'ptolemaeer', kind: 'grossreich', name: 'Ptolemäer', color: '#12b5b0',
    startingArmy: { infantry: 300, cavalry: 90, ranged: 150 },
    armyLabel: 'Nilheer',
  },
  // Die Stämme der Adriaküste, berüchtigt für ihre Kaperfahrten: billige,
  // angriffslustige Kriegerscharen und lauter Häfen.
  {
    id: 'illyrer', kind: 'koenigreich', name: 'Illyrer', color: '#3aa0d6',
    startingArmy: { infantry: 320, cavalry: 90, ranged: 130 },
    armyLabel: 'Seeschar',
  },
  // Ein Reitervolk der Steppe nördlich des Schwarzen Meeres.
  {
    id: 'sarmaten', kind: 'stamm', name: 'Sarmaten', color: '#a3672e',
    startingArmy: { infantry: 120, cavalry: 320, ranged: 100 },
    armyLabel: 'Reiterschwarm',
  },
  { id: 'neutral', name: 'Unabhängig', color: '#7f7f7f', isNeutral: true },
  // Die Seeräuber sind keine Macht, mit der man verhandelt: kein Herrscher,
  // keine Stadt, kein Vertrag. Sie stehen mit jedem im Krieg, weil sie nie
  // Frieden geschlossen haben - und weil man mit ihnen keinen schließen kann.
  {
    id: 'piraten', name: 'Seeräuber', color: '#15161a',
    isNeutral: true, isPirate: true,
  },
  // Und die Völker aus der Steppe: auch mit ihnen wird nicht verhandelt. Sie
  // ziehen, bis sie Land finden, und dann sind sie keine Wanderer mehr.
  {
    id: 'wanderer', name: 'Wandernde Stämme', color: '#7a4a1e',
    isNeutral: true, isHorde: true,
  },
];

// Was auf dem Auswahlbildschirm über eine Fraktion steht: wo sie beginnt,
// womit sie kämpft und woran sie krankt. Die Einschätzung stammt aus den
// Testläufen über je 120 Runden, nicht aus dem Bauchgefühl.
export const FACTION_PROFILES = {
  rom: {
    difficulty: 'mittel',
    blurb: 'Roma, Capua, Arretium, Ravenna und Tarent – ganz Italien südlich des '
      + 'Po, seit Tarent 272 gefallen ist. Der festeste Block auf der Karte, '
      + 'und noch kein einziges Schiff.',
    strength: 'Legionäre sind das zäheste Fußvolk der Karte.',
    weakness: 'Kein Kriegsschiff und keine Werft: Sizilien liegt in Sichtweite '
      + 'und ist doch unerreichbar, solange Karthago das Meer hält.',
  },
  karthago: {
    difficulty: 'leicht',
    blurb: 'Sieben Orte auf drei Erdteilen: Karthago und Hadrumetum in Afrika, '
      + 'Panormus auf Sizilien, Caralis auf Sardinien, Gades und Malaca in '
      + 'Iberien. Das größte Startreich des Westens – und das dünnste.',
    strength: 'Quinqueremen, Häfen ringsum und zwei Heere auf zwei Erdteilen.',
    weakness: 'Sieben Orte heißt sieben Grenzen: nichts davon liegt beieinander, '
      + 'jedes hängt am Meer, und Numidien sitzt im Rücken.',
  },
  numidien: {
    difficulty: 'schwer',
    blurb: 'Cirta als Königssitz, Hippo Regius am Meer, Siga weit im Westen – und '
      + 'Karthago als unmittelbarer Nachbar.',
    strength: 'Numidische Reiter: die schnellste und härteste leichte Reiterei der Karte.',
    weakness: 'Fußvolk, das nur die Reiter deckt, und Karthago als unmittelbarer Nachbar.',
  },
  parther: {
    difficulty: 'mittel',
    blurb: 'Ekbatana und Rhagae am Rand der Hochebene – zwei Orte. Die Parner '
      + 'sind 264 noch ein Reitervolk am Saum des Seleukidenreichs, kein Reich; '
      + 'was daraus wird, entscheidet dieser Feldzug.',
    strength: 'Kataphrakten und berittene Bogenschützen: das beste Reiterheer der Karte.',
    weakness: 'Zwei Orte, teure Truppen und das Seleukidenreich als unmittelbarer '
      + 'Nachbar – die härteste Ausgangslage außerhalb der Stadtstaaten.',
  },
  armenien: {
    difficulty: 'mittel',
    blurb: 'Artaxata am Ararat, Tigranokerta und Arsamosata im Süden – Berge nach '
      + 'allen Seiten.',
    strength: 'Kataphrakten und ein Fußvolk, das die Pässe wirklich halten kann.',
    weakness: 'Kein Meer, kein Hafen – und Seleukiden wie Parther als Nachbarn.',
  },
  pontus: {
    difficulty: 'mittel',
    blurb: 'Amaseia und Kabeira im Bergland, Trapezus am Wasser – die '
      + 'Königsburgen im Binnenland. Sinope und Amisos an der Küste sind freie '
      + 'Poleis und fielen erst achtzig Jahre später an Pontus.',
    strength: 'Phalangiten mit der zweitbesten Verteidigung und Quinqueremen im Schwarzen Meer.',
    weakness: 'Eine schmale Küste zwischen Bergen und Meer, Armenien und Seleukiden als Nachbarn.',
  },
  gallier: {
    difficulty: 'schwer',
    blurb: 'Alesia, Bibracte, Lutetia, Burdigala und Tolosa – fünf Stämme unter '
      + 'einem Namen, von der Garonne bis zur Seine. Volkreich, aber nirgends ein '
      + 'Staat. Der Heerbann hebt zwei Heere aus.',
    strength: 'Schwertkämpfer mit dem härtesten Angriff unter dem Fußvolk – und zwei Heere, um an zwei Fronten zu stehen.',
    weakness: 'Kein Hafen, wenig freies Land, Feinde an drei Seiten.',
  },
  athen: {
    difficulty: 'schwer',
    blurb: 'Athen. Ein Ort, mehr nicht – so stand es 264 auch da: eine Stadt '
      + 'unter makedonischer Aufsicht, deren Reich zweihundert Jahre vorbei war. '
      + 'Attika ist ein Feld breit; alles Weitere liegt über See.',
    strength: 'Trieren von der ersten Runde an und die Toxotai hinter der Linie.',
    weakness: 'Ein Ort. Wer ihn verliert, hat verloren.',
  },
  sparta: {
    difficulty: 'schwer',
    blurb: 'Sparta hinter dem Taygetos. Ein Ort, kein Hinterland, keine Mauer '
      + 'nötig – so hieß es jedenfalls. Die halbe Peloponnes liegt frei '
      + 'davor und gehört niemandem.',
    strength: 'Der Spartiat ist das beste Fußvolk der Karte – 13 Verteidigung, '
      + 'mehr hat niemand.',
    weakness: 'Wenige Bürger: das kleinste Startheer im Spiel, eine Reiterei, die '
      + 'nichts taugt, und ein Ort, der alles ist.',
  },
  makedonien: {
    difficulty: 'schwer',
    blurb: 'Pella als Königssitz, Amphipolis an der Küste, Larissa in Thessalien – '
      + 'die Küste des Thermäischen Golfs und der Weg nach Süden.',
    strength: 'Die Sarissenphalanx greift härter an als jede andere Phalanx, '
      + 'und die Hetairoi sind die beste Stoßreiterei außerhalb der Steppe.',
    weakness: 'Ein langgezogenes Land ohne Tiefe – Illyrer im Westen, Daker im '
      + 'Norden, Athen und Sparta im Süden.',
  },
  syrakus: {
    difficulty: 'schwer',
    blurb: 'Syrakus unter Hieron II. – ein Ort zwischen Rom im Norden und '
      + 'Karthago im Westen. In Messana sitzen die Mamertiner, und genau dort '
      + 'beginnt in diesem Frühjahr der Krieg.',
    strength: 'Belagerungsgerät zum Viertel billiger – und Quinqueremen von '
      + 'der ersten Runde an.',
    weakness: 'Ein Küstenstreifen ohne Hinterland – und beide Nachbarn sind '
      + 'Großmächte.',
  },
  germanen: {
    difficulty: 'schwer',
    blurb: 'Mattium, Treva und Calisia zwischen Rhein, Elbe und Weichsel, mitten im '
      + 'Herkynischen Wald.',
    strength: 'Der größte Heerhaufen und ein Wald, der jeden Angreifer bremst.',
    weakness: 'Arm, fast ohne Küste, ohne nennenswerte Reiterei.',
  },
  britannier: {
    difficulty: 'mittel',
    blurb: 'Camulodunum, Eburacum und Moridunum – die Insel gehört dir allein, und '
      + 'niemand kommt ohne Schiffe herüber.',
    strength: 'Streitwagen: die stärkste Reiterei der Karte, und eine sichere Heimat.',
    weakness: 'Abseits von allem, und jeder Krieg beginnt mit einer Überfahrt.',
  },
  iberer: {
    difficulty: 'leicht',
    blurb: 'Numantia, Tarraco und Olisipo – über die ganze Halbinsel verstreut, mit '
      + 'weiten Wegen dazwischen.',
    strength: 'Caetrati und Schleuderer: mehr Fernkampf als jede andere Fraktion.',
    weakness: 'Weite Wege zwischen den eigenen Orten – und Gades und Malaca als '
      + 'karthagische Pfähle im Fleisch der Halbinsel.',
  },
  daker: {
    difficulty: 'mittel',
    blurb: 'Sarmizegetusa in den Karpaten, Napoca im Norden, Serdica jenseits der '
      + 'Donau als Sprungbrett nach Süden.',
    strength: 'Die Falx schlägt härter zu als jedes andere Fußvolk, das Bergland deckt den Rücken.',
    weakness: 'Kein einziger Ort am Meer: Schiffe wirst du nie stellen können.',
  },
  seleukiden: {
    difficulty: 'schwer',
    blurb: 'Sieben Orte von Kilikien bis Susa: Antiochia am Orontes, Tarsos, '
      + 'Edessa, Damaskus, Dura Europos, Babylon. Das größte Reich der Karte – '
      + 'und zwei Heere, um es zu halten.',
    strength: 'Kriegselefanten und die Silberschilde-Phalanx.',
    weakness: 'Die längsten Grenzen der Karte und die Ptolemäer im Süden.',
  },
  ptolemaeer: {
    difficulty: 'leicht',
    blurb: 'Alexandria und Memphis am Nil, Kyrene in der Wüste, Salamis auf '
      + 'Zypern, Tyrus und Jerusalem in Koilesyrien – das reichste Tal der Welt '
      + 'und ein Kranz von Außenposten rings um das östliche Meer.',
    strength: 'Nubische Bogenschützen, die besten der Karte, und billiges Fußvolk in Masse.',
    weakness: 'Kaum Reiterei – und alles außerhalb des Niltals hängt am Schiff.',
  },
  illyrer: {
    difficulty: 'schwer',
    blurb: 'Scodra, Salona und Narona an der Adria, zwischen den Bergen und dem Meer '
      + 'eingeklemmt.',
    strength: 'Billige, angriffslustige Sicaträger – und fast jeder Ort liegt am Wasser.',
    weakness: 'Wenig Land, wenig Einkommen, und Rom, Griechen und Daker als Nachbarn.',
  },
  sarmaten: {
    difficulty: 'mittel',
    blurb: 'Tanais, Kremnoi und Amadoka in der Steppe nördlich des Schwarzen '
      + 'Meeres. Olbia und Chersonesos an der Küste sind freie griechische '
      + 'Städte – wer sie will, muss sie nehmen.',
    strength: 'Kataphrakten – die stärkste Reiterei der Karte – und berittene Bogenschützen dazu.',
    weakness: 'Teure Reiterei, schwaches Fußvolk und ein Land, das kaum etwas einbringt.',
  },
};

export function factionProfile(factionId) {
  return FACTION_PROFILES[factionId] || null;
}

// Alle spielbaren Fraktionen in der Reihenfolge der Tabelle.
export function playableFactions() {
  return FACTIONS.filter((f) => !f.isNeutral);
}

// Three settlement sizes. Everything that scales with a settlement's standing -
// its people, the garrison it can raise and feed, its income and how large it
// is drawn on the map - comes from this table, so the tiers stay consistent.
// Die Stärke der Wache steht nicht hier: sie folgt der Bevölkerung.
export const SETTLEMENT_TIERS = {
  large: {
    key: 'large',
    label: 'Große Stadt',
    incomeFactor: 1.7,
    population: 5200,
    populationCapital: 6400,
    populationNeutral: 3600,
    spread: 1.3,
  },
  city: {
    key: 'city',
    label: 'Stadt',
    incomeFactor: 1,
    population: 3500,
    populationCapital: 6000,
    populationNeutral: 2000,
    spread: 1,
  },
  village: {
    key: 'village',
    label: 'Dorf',
    incomeFactor: 0.5,
    population: 1400,
    populationCapital: 2600,
    populationNeutral: 900,
    spread: 0.68,
  },
};

// `spread` ist die Ausbreitung eines Orts auf der Karte: danach richten sich
// der Mauerring und die Ringe, auf denen die Häuser stehen - nicht die Größe
// der Häuser. Die ist überall dieselbe, damit ein Haus in der Metropole so
// groß ist wie eines im Weiler.

export const SETTLEMENT_ORDER = ['large', 'city', 'village'];
export const DEFAULT_SETTLEMENT_SIZE = 'city';

export function settlementTier(size) {
  return SETTLEMENT_TIERS[size] || SETTLEMENT_TIERS[DEFAULT_SETTLEMENT_SIZE];
}

// Settlements sit at the coordinates of the real towns; mapgen.js turns those
// into tiles. `size` picks a tier above; capitals are the seat of a faction
// and are fortified from the first turn.
//
// --- Die Orte, mit denen begonnen wird ------------------------------------
// **Die Startlage ist die des Jahres 264 v. Chr.**, nicht mehr eine Regel.
// Lange bekam jede Fraktion gleich viel: Hauptstadt, Stadt, Dorf - drei Orte
// für alle, für das Seleukidenreich wie für die Germanen. Das war gerecht und
// es war falsch. Im Frühjahr 264, als in Messana der Erste Punische Krieg
// beginnt, sieht die Welt so aus:
//
//   7  Karthago    Afrika, Westsizilien, Sardinien, der Brückenkopf in Iberien
//   7  Seleukiden  von Kleinasien über Syrien und Babylonien bis nach Susa
//   6  Ptolemäer   Ägypten, die Kyrenaika, Zypern, Koilesyrien
//   5  Rom         ganz Italien südlich des Po, seit Tarent 272 gefallen ist
//   5  Gallier     die großen Stämme zwischen Garonne und Seine
//   3  die mittleren Königreiche und Stammesverbände
//   2  Parther     die Parner sitzen noch am Rand der Hochebene
//   1  Athen · Sparta · Syrakus - eine Stadt, ein Heer, sonst nichts
//
// Wer als Karthago beginnt, hat sieben Orte und sieben Grenzen; wer als Athen
// beginnt, hat eine Stadt und muss sich alles nehmen. Das ist der Unterschied,
// den die Epoche macht, und er soll zu spüren sein.
//
// Was dabei **neutral wurde**, ist ebenso Absicht: **Sinope**, **Olbia** und
// **Chersonesos** waren 264 freie griechische Poleis, keine Untertanen von
// Pontus oder der Sarmaten (Sinope fiel erst 183 an Pontus). **Messana** liegt
// in der Hand der Mamertiner - eben deshalb beginnt dort der Krieg. Und
// **Massilia** war eine freie Stadt und blieb es.
//
// **Kein Ort steht neben einem anderen.** Zwischen zwei Siedlungen liegt
// mindestens ein freies Feld - bei 55 km je Feld heißt das rund hundert
// Kilometer. Vorher standen vierzehn Paare Wand an Wand, vor allem in
// Griechenland und auf Sizilien, und dort war die Karte kein Land mehr,
// sondern eine Häuserzeile. Wo zwei echte Städte in dasselbe Nachbarfeld
// fielen, musste eine weichen: Thessalonike neben Pella, Korinth zwischen
// Athen und Sparta, Eleusis vor Athen, Gytheion unter Sparta, Tauromenion
// zwischen Syrakus und Messana, dazu Dion, Ktesiphon, Naxuana und Azagarion.
//
// Alles Übrige auf der Karte ist unabhängig und wartet darauf, dass jemand
// danach greift - und das ist jetzt die Mehrheit der Orte.
//
// **Die Koordinaten sind die echten.** Sie wurden gegen die tatsächliche Lage
// nachgeprüft; sechs waren daneben und stehen jetzt richtig: Trapezus (Trabzon
// lag 42 km weiter südlich), Kabeira (Niksar, 30 km), Sarmizegetusa (die
// dakische Burg liegt bei Grădiștea Muncelului, nicht bei der römischen
// Nachfolgestadt, 40 km), Bibracte (Mont Beuvray, 19 km), Siga (an der Mündung
// der Tafna, 17 km) und Mattium (Altenburg bei Niedenstein, 11 km).
//
// Zwei Abweichungen bleiben mit Absicht:
//   - **Amisos** steht 26 km zu weit nördlich. Auf dem echten Platz (Samsun)
//     läge es Feld an Feld mit Amaseia, und die Zwei-Felder-Regel geht vor.
//   - Wo die Lage in der Forschung strittig ist, steht ein plausibler Punkt
//     aus der Spanne: **Tigranokerta** und **Zama Regia** sind bis heute nicht
//     sicher lokalisiert, und **Gelonos**, **Amadoka**, **Karrodounon**,
//     **Naubaris**, **Exopolis** und **Rha** sind Namen aus Herodot und
//     Ptolemaios, zu denen es keine Ausgrabung gibt.
export const CITY_DEFS = [
  // --- Rom: Italien südlich des Po, seit Tarent 272 gefallen ist ---------
  { name: 'Roma', lon: 12.48, lat: 41.90, factionId: 'rom', capital: true, size: 'large' },
  { name: 'Capua', lon: 14.25, lat: 41.08, factionId: 'rom', capital: false, size: 'city' },
  { name: 'Ravenna', lon: 12.20, lat: 44.42, factionId: 'rom', capital: false, size: 'village' },
  { name: 'Arretium', lon: 11.88, lat: 43.46, factionId: 'rom', capital: false, size: 'city' },
  { name: 'Tarentum', lon: 17.24, lat: 40.47, factionId: 'rom', capital: false, size: 'city' },
  // --- Karthago: Afrika, Westsizilien, Sardinien, die alten Kolonien -----
  { name: 'Karthago', lon: 10.32, lat: 36.85, factionId: 'karthago', capital: true, size: 'large' },
  { name: 'Leptis Magna', lon: 14.29, lat: 32.64, factionId: 'karthago', capital: false, size: 'village' },
  { name: 'Caralis', lon: 9.11, lat: 39.22, factionId: 'karthago', capital: false, size: 'village' },
  { name: 'Panormus', lon: 13.36, lat: 38.12, factionId: 'karthago', capital: false, size: 'village' },
  { name: 'Gades', lon: -6.29, lat: 36.53, factionId: 'karthago', capital: false, size: 'city' },
  { name: 'Malaca', lon: -4.42, lat: 36.72, factionId: 'karthago', capital: false, size: 'village' },
  { name: 'Hadrumetum', lon: 10.64, lat: 35.83, factionId: 'karthago', capital: false, size: 'city' },
  // --- Gallier: die großen Stämme zwischen Garonne und Seine -------------
  { name: 'Alesia', lon: 4.50, lat: 47.54, factionId: 'gallier', capital: true, size: 'large' },
  { name: 'Lutetia', lon: 2.35, lat: 48.86, factionId: 'gallier', capital: false, size: 'city' },
  { name: 'Tolosa', lon: 1.44, lat: 43.60, factionId: 'gallier', capital: false, size: 'village' },
  { name: 'Bibracte', lon: 4.03, lat: 46.92, factionId: 'gallier', capital: false, size: 'city' },
  { name: 'Burdigala', lon: -0.58, lat: 44.84, factionId: 'gallier', capital: false, size: 'village' },
  // --- Numidien: der Maghreb ---------------------------------------------
  { name: 'Cirta', lon: 6.61, lat: 36.37, factionId: 'numidien', capital: true, size: 'large' },
  { name: 'Hippo Regius', lon: 7.75, lat: 36.90, factionId: 'numidien', capital: false, size: 'city' },
  { name: 'Siga', lon: -1.45, lat: 35.30, factionId: 'numidien', capital: false, size: 'village' },
  // --- Parther: die Parner am Rand der iranischen Hochebene --------------
  { name: 'Ekbatana', lon: 48.52, lat: 34.80, factionId: 'parther', capital: true, size: 'large' },
  { name: 'Rhagae', lon: 51.43, lat: 35.59, factionId: 'parther', capital: false, size: 'city' },
  // --- Armenien: das Hochland --------------------------------------------
  { name: 'Artaxata', lon: 44.55, lat: 39.93, factionId: 'armenien', capital: true, size: 'large' },
  { name: 'Tigranokerta', lon: 40.95, lat: 37.85, factionId: 'armenien', capital: false, size: 'city' },
  { name: 'Arsamosata', lon: 39.20, lat: 38.60, factionId: 'armenien', capital: false, size: 'village' },
  // --- Pontus: die Königsburgen im Binnenland, nicht die freien Häfen ----
  { name: 'Amaseia', lon: 35.83, lat: 40.65, factionId: 'pontus', capital: true, size: 'large' },
  { name: 'Trapezus', lon: 39.72, lat: 41.00, factionId: 'pontus', capital: false, size: 'village' },
  { name: 'Kabeira', lon: 36.95, lat: 40.59, factionId: 'pontus', capital: false, size: 'village' },
  // --- Makedonien: Pella, die Küste und Thessalien -----------------------
  { name: 'Pella', lon: 22.52, lat: 40.76, factionId: 'makedonien', capital: true, size: 'large' },
  { name: 'Amphipolis', lon: 23.83, lat: 40.82, factionId: 'makedonien', capital: false, size: 'city' },
  { name: 'Larissa', lon: 22.42, lat: 39.64, factionId: 'makedonien', capital: false, size: 'village' },
  // --- Germanen: zwischen Rhein, Nordsee und Elbe ------------------------
  { name: 'Mattium', lon: 9.28, lat: 51.23, factionId: 'germanen', capital: true, size: 'large' },
  { name: 'Treva', lon: 9.99, lat: 53.55, factionId: 'germanen', capital: false, size: 'city' },
  { name: 'Calisia', lon: 18.08, lat: 51.76, factionId: 'germanen', capital: false, size: 'village' },
  // --- Britannier: die Insel ---------------------------------------------
  { name: 'Camulodunum', lon: 0.90, lat: 51.89, factionId: 'britannier', capital: true, size: 'large' },
  { name: 'Eburacum', lon: -1.08, lat: 53.96, factionId: 'britannier', capital: false, size: 'city' },
  { name: 'Moridunum', lon: -4.30, lat: 51.86, factionId: 'britannier', capital: false, size: 'village' },
  // --- Iberer: die Halbinsel ---------------------------------------------
  { name: 'Numantia', lon: -2.45, lat: 41.81, factionId: 'iberer', capital: true, size: 'large' },
  { name: 'Tarraco', lon: 1.25, lat: 41.12, factionId: 'iberer', capital: false, size: 'city' },
  { name: 'Olisipo', lon: -9.14, lat: 38.72, factionId: 'iberer', capital: false, size: 'village' },
  // --- Daker: die Karpaten -----------------------------------------------
  { name: 'Sarmizegetusa', lon: 23.31, lat: 45.62, factionId: 'daker', capital: true, size: 'large' },
  { name: 'Napoca', lon: 23.60, lat: 46.77, factionId: 'daker', capital: false, size: 'city' },
  { name: 'Serdica', lon: 23.32, lat: 42.70, factionId: 'daker', capital: false, size: 'village' },
  // --- Seleukiden: von Kilikien über Syrien bis nach Susa ----------------
  { name: 'Susa', lon: 48.25, lat: 32.19, factionId: 'seleukiden', capital: false, size: 'city' },
  { name: 'Antiochia', lon: 36.16, lat: 36.20, factionId: 'seleukiden', capital: true, size: 'large' },
  { name: 'Babylon', lon: 44.42, lat: 32.54, factionId: 'seleukiden', capital: false, size: 'city' },
  { name: 'Dura Europos', lon: 40.73, lat: 34.75, factionId: 'seleukiden', capital: false, size: 'village' },
  { name: 'Edessa', lon: 38.79, lat: 37.15, factionId: 'seleukiden', capital: false, size: 'village' },
  { name: 'Tarsos', lon: 34.90, lat: 36.92, factionId: 'seleukiden', capital: false, size: 'city' },
  { name: 'Damaskus', lon: 36.30, lat: 33.51, factionId: 'seleukiden', capital: false, size: 'city' },
  // --- Ptolemäer: Niltal, Kyrenaika, Zypern und Koilesyrien --------------
  { name: 'Alexandria', lon: 29.92, lat: 31.20, factionId: 'ptolemaeer', capital: true, size: 'large' },
  { name: 'Memphis', lon: 31.25, lat: 29.85, factionId: 'ptolemaeer', capital: false, size: 'city' },
  { name: 'Kyrene', lon: 21.86, lat: 32.82, factionId: 'ptolemaeer', capital: false, size: 'village' },
  { name: 'Salamis', lon: 33.90, lat: 35.18, factionId: 'ptolemaeer', capital: false, size: 'village' },
  { name: 'Tyrus', lon: 35.20, lat: 33.27, factionId: 'ptolemaeer', capital: false, size: 'village' },
  { name: 'Hierosolyma', lon: 35.22, lat: 31.78, factionId: 'ptolemaeer', capital: false, size: 'city' },
  // --- Illyrer: die Adria ------------------------------------------------
  { name: 'Scodra', lon: 19.51, lat: 42.07, factionId: 'illyrer', capital: true, size: 'large' },
  { name: 'Salona', lon: 16.44, lat: 43.51, factionId: 'illyrer', capital: false, size: 'city' },
  { name: 'Narona', lon: 17.62, lat: 43.05, factionId: 'illyrer', capital: false, size: 'village' },
  // --- Sarmaten: die Steppe - nicht die griechischen Hafenstädte ---------
  { name: 'Tanais', lon: 39.28, lat: 47.21, factionId: 'sarmaten', capital: true, size: 'large' },
  { name: 'Amadoka', lon: 34.50, lat: 48.00, factionId: 'sarmaten', capital: false, size: 'village' },
  { name: 'Kremnoi', lon: 37.50, lat: 47.40, factionId: 'sarmaten', capital: false, size: 'village' },
  // --- Athen (Stadtstaat): die Stadt und sonst nichts -----------
  { name: 'Athen', lon: 23.73, lat: 37.98, factionId: 'athen', capital: true, size: 'large' },
  // --- Sparta (Stadtstaat): die Stadt und sonst nichts ------
  { name: 'Sparta', lon: 22.43, lat: 37.07, factionId: 'sparta', capital: true, size: 'large' },
  // --- Syrakus (Stadtstaat): die Stadt und sonst nichts ----------------------
  { name: 'Syrakus', lon: 15.29, lat: 37.07, factionId: 'syrakus', capital: true, size: 'large' },
  // --- Unabhängig --------------------------------------------------------
  { name: 'Karthago Nova', lon: -0.98, lat: 37.60, factionId: 'neutral', capital: false, size: 'city' },
  { name: 'Arbela', lon: 44.01, lat: 36.19, factionId: 'neutral', capital: false, size: 'village' },
  { name: 'Sinope', lon: 35.15, lat: 42.03, factionId: 'neutral', capital: false, size: 'city' },
  { name: 'Olbia', lon: 31.90, lat: 46.63, factionId: 'neutral', capital: false, size: 'city' },
  { name: 'Chersonesos', lon: 33.49, lat: 44.61, factionId: 'neutral', capital: false, size: 'village' },
  // Die Mehrheit der Karte. Darunter alles, was den Reichen mit der neuen
  // Dreierregel aus der Hand fiel: Arretium und Tarent, Hadrumetum und
  // Tingis, Bibracte und Burdigala, Londinium und Isca - Städte mit Mauern
  // und Wachen, die niemandem gehören und auf den ersten warten, der
  // danach greift.
  { name: 'Amisia', lon: 7.20, lat: 53.35, factionId: 'neutral', capital: false, size: 'village' },
  { name: 'Londinium', lon: -0.13, lat: 51.51, factionId: 'neutral', capital: false, size: 'city' },
  { name: 'Asciburgium', lon: 6.63, lat: 51.45, factionId: 'neutral', capital: false, size: 'city' },
  { name: 'Gesoriacum', lon: 1.61, lat: 50.73, factionId: 'neutral', capital: false, size: 'village' },
  { name: 'Isca Dumnoniorum', lon: -3.53, lat: 50.72, factionId: 'neutral', capital: false, size: 'village' },
  { name: 'Karrodounon', lon: 31.50, lat: 50.50, factionId: 'neutral', capital: false, size: 'village' },
  { name: 'Gelonos', lon: 34.50, lat: 49.70, factionId: 'neutral', capital: false, size: 'city' },
  { name: 'Exopolis', lon: 47.00, lat: 49.50, factionId: 'neutral', capital: false, size: 'village' },
  { name: 'Argentorate', lon: 7.75, lat: 48.58, factionId: 'neutral', capital: false, size: 'village' },
  { name: 'Vindobona', lon: 16.37, lat: 48.21, factionId: 'neutral', capital: false, size: 'village' },
  { name: 'Naubaris', lon: 44.00, lat: 47.50, factionId: 'neutral', capital: false, size: 'village' },
  { name: 'Piroboridava', lon: 27.40, lat: 46.00, factionId: 'neutral', capital: false, size: 'village' },
  { name: 'Rha', lon: 47.00, lat: 46.00, factionId: 'neutral', capital: false, size: 'village' },
  { name: 'Aquileia', lon: 13.37, lat: 45.77, factionId: 'neutral', capital: false, size: 'village' },
  { name: 'Mediolanum', lon: 9.19, lat: 45.46, factionId: 'neutral', capital: false, size: 'city' },
  { name: 'Sirmium', lon: 19.61, lat: 44.97, factionId: 'neutral', capital: false, size: 'village' },
  { name: 'Sucidava', lon: 24.26, lat: 43.78, factionId: 'neutral', capital: false, size: 'city' },
  { name: 'Massilia', lon: 5.37, lat: 43.30, factionId: 'neutral', capital: false, size: 'large' },
  { name: 'Pityus', lon: 40.32, lat: 43.15, factionId: 'neutral', capital: false, size: 'village' },
  { name: 'Phasis', lon: 41.67, lat: 42.15, factionId: 'neutral', capital: false, size: 'city' },
  { name: 'Aleria', lon: 9.52, lat: 42.10, factionId: 'neutral', capital: false, size: 'village' },
  { name: 'Harmozica', lon: 44.72, lat: 41.85, factionId: 'neutral', capital: false, size: 'village' },
  { name: 'Amisos', lon: 36.33, lat: 41.52, factionId: 'neutral', capital: false, size: 'city' },
  { name: 'Epidamnos', lon: 19.45, lat: 41.32, factionId: 'neutral', capital: false, size: 'city' },
  { name: 'Byzantion', lon: 28.98, lat: 41.01, factionId: 'neutral', capital: false, size: 'city' },
  { name: 'Ankyra', lon: 32.86, lat: 39.93, factionId: 'neutral', capital: false, size: 'village' },
  { name: 'Palma', lon: 2.65, lat: 39.57, factionId: 'neutral', capital: false, size: 'village' },
  { name: 'Pergamon', lon: 27.18, lat: 39.13, factionId: 'neutral', capital: false, size: 'city' },
  { name: 'Tushpa', lon: 43.38, lat: 38.49, factionId: 'neutral', capital: false, size: 'city' },
  { name: 'Messana', lon: 15.55, lat: 38.19, factionId: 'neutral', capital: false, size: 'city' },
  { name: 'Ephesos', lon: 27.34, lat: 37.94, factionId: 'neutral', capital: false, size: 'city' },
  { name: 'Corduba', lon: -4.78, lat: 37.89, factionId: 'neutral', capital: false, size: 'city' },
  { name: 'Icosium', lon: 3.06, lat: 36.75, factionId: 'neutral', capital: false, size: 'city' },
  { name: 'Rhodos', lon: 28.22, lat: 36.43, factionId: 'neutral', capital: false, size: 'city' },
  { name: 'Zama Regia', lon: 9.45, lat: 36.05, factionId: 'neutral', capital: false, size: 'village' },
  { name: 'Tingis', lon: -5.81, lat: 35.78, factionId: 'neutral', capital: false, size: 'village' },
  { name: 'Knossos', lon: 25.16, lat: 35.30, factionId: 'neutral', capital: false, size: 'village' },
];

// Morale and exhaustion scale a force's fighting power. Both are 0-100 and
// recover when an army rests, fastest inside a friendly city.
export const MORALE_MAX = 100;
export const MORALE_START = 85;
export const MORALE_AFTER_WIN = 12;
export const MORALE_AFTER_LOSS = -28;
export const MORALE_REST = 8;
export const MORALE_REST_IN_CITY = 16;
// Erschöpfung wird je Bewegungspunkt berechnet, nicht je Feld: auf der Straße
// kommt ein Heer für denselben Preis weiter als querfeldein. Der Satz ist so
// gewählt, dass ein voller Tagesmarsch (MAX_MOVEMENT Punkte) rund 22 kostet.
// Das klingt wenig, wiegt aber schwer: seit Angriff und Verteidigung nahe
// beieinander liegen, entscheidet schon ein kleiner Unterschied im Zustand die
// Schlacht. Ein Heer, das den ganzen Tag marschiert ist, greift damit noch mit
// etwa vier zu zehn an - zwei solche Märsche hintereinander laugen es aus.
export const EXHAUSTION_PER_MOVE = 1.2;
export const EXHAUSTION_REST = -8;
export const EXHAUSTION_REST_IN_CITY = -15;
export const EXHAUSTION_PER_BATTLE = 8;
// Garrisons sit behind their own walls and are neither marched nor routed,
// so they fight at a fixed, solid standard.
export const GARRISON_MORALE = 90;
export const GARRISON_EXHAUSTION = 0;

// Fortifications are built up in three stages, each bought only once the one
// before it stands. Every stage multiplies the defenders' fighting power.
export const WALL_LEVELS = [
  {
    key: 'palisade', name: 'Holzpalisade', icon: '🪵',
    cost: 200, turns: 3, defence: 1.3,
    note: 'Ein Ring aus angespitzten Stämmen – schnell errichtet, gegen einen entschlossenen Sturm aber wenig.',
  },
  {
    key: 'greatPalisade', name: 'Große Holzpalisade', icon: '🪓',
    cost: 450, turns: 4, defence: 1.6,
    note: 'Doppelte Wand mit Wehrgang und hölzernen Türmen.',
  },
  {
    key: 'stone', name: 'Steinmauer', icon: '🧱',
    cost: 900, turns: 6, defence: 2.0,
    note: 'Quadermauer mit Rundtürmen – ohne Belagerung kaum zu nehmen.',
  },
];

// --- Sturm auf eine Mauer --------------------------------------------------
// Eine Mauer stürmt man zu Fuß. Wer sitzen bleibt, kommt nicht über die
// Leiter, nicht durch die Bresche und nicht durchs Tor - ein Pferd nützt vor
// einer Palisade wenig und vor einer Quadermauer gar nichts. Vorher zählte
// die Reiterei mit ihrem vollen Angriffswert gegen jede Befestigung, und ein
// reines Reiterheer war das beste Sturmmittel des Spiels; das war der
// deutlichste Fehler in der Kampfrechnung.
//
// Die Bogenschützen behalten mehr: sie schießen auf den Wehrgang, auch wenn
// sie ihn nicht nehmen. Die Fußtruppen tragen den Sturm und bleiben, wie sie
// sind.
// Je Gattung zwei Zahlen: was vor der schwächsten Befestigung noch zählt, und
// was vor der stärksten übrig bleibt. Schon die einfache Palisade nimmt der
// Reiterei die Hälfte - ein Reiterheer soll auch vor einem Palisadendorf das
// falsche Werkzeug sein, nicht erst vor der Quadermauer.
export const WALL_ASSAULT_SCALE = {
  cavalry: { start: 0.55, full: 0.2 },
  ranged: { start: 0.9, full: 0.75 },
};

export function wallAssaultScale(role, wallMultiplier) {
  const stufe = WALL_ASSAULT_SCALE[role];
  if (!stufe || !(wallMultiplier > 1)) return 1;
  const hoechste = WALL_LEVELS[WALL_LEVELS.length - 1].defence;
  const anteil = Math.max(0, Math.min(1, (wallMultiplier - 1) / (hoechste - 1)));
  return stufe.start + (stufe.full - stufe.start) * anteil;
}

// --- Belagerungsgerät ------------------------------------------------------
// Eine Steinmauer verdoppelt die Kraft dessen, der dahintersteht. Dagegen half
// bisher nur, mehr Männer davorzustellen - und genau so wurden Belagerungen
// gewonnen: mit Masse. Das ist nicht, wie es war. Wer eine Mauer nehmen wollte,
// baute Gerät: einen Widder gegen das Tor, Katapulte gegen die Brüstung.
//
// Beides hängt am Heer, nicht am Ort: es wird in einer Stadt mit Kaserne
// gezimmert und zieht mit. Was es kostet, ist nicht nur Gold - ein Heer mit
// Gerät marschiert langsamer, weil ein Widder auf Rädern keine Tagesmärsche
// macht, und im Sturm geht ein Teil davon zu Bruch.
export const SIEGE_ENGINES = [
  {
    key: 'ram',
    name: 'Widder',
    icon: '🪵',
    cost: 240,
    upkeep: 5,
    // Was ein Stück von dem wegnimmt, was die Mauer über 1 hinaus trägt.
    bruch: 0.2,
    salve: 0,
    note: 'Ein eisenbeschlagener Balken unter einem Schutzdach: er geht gegen '
      + 'das Tor, und ein Tor ist die schwächste Stelle jeder Mauer.',
  },
  {
    key: 'catapult',
    name: 'Katapult',
    icon: '🎯',
    cost: 300,
    upkeep: 7,
    bruch: 0.12,
    // Und was es zur Eröffnungssalve beiträgt - ein Katapult schießt, ehe der
    // erste Mann die Leiter berührt.
    salve: 0.45,
    note: 'Wirft Steine über die Brüstung. Nimmt der Mauer weniger als der '
      + 'Widder, schießt dafür schon vor dem Sturm.',
  },
];

export function siegeEngineDef(key) {
  return SIEGE_ENGINES.find((e) => e.key === key) || null;
}

export const SIEGE_ENGINE_KEYS = SIEGE_ENGINES.map((e) => e.key);

// So viele Stücke trägt ein Heer höchstens mit sich - mehr wäre ein Tross,
// kein Heer.
export const SIEGE_ENGINE_MAX = 6;

// Und so viel kann Gerät von einer Mauer höchstens wegnehmen. Auch die beste
// Belagerung macht aus einer Quadermauer kein offenes Feld.
export const SIEGE_BREACH_CAP = 0.6;

// Wie weit ein Heer mit Gerät noch kommt: vier Fünftel seiner Marschleistung.
export const SIEGE_ENGINE_MOVE = 0.8;

// Wie viele Stücke ein Heer hat.
export function engineCount(engines) {
  if (!engines) return 0;
  return SIEGE_ENGINE_KEYS.reduce((sum, key) => sum + (engines[key] || 0), 0);
}

// Was das Gerät dieses Heeres von einer Mauer wegnimmt - 0 bis SIEGE_BREACH_CAP.
export function siegeBreach(engines) {
  if (!engines) return 0;
  const roh = SIEGE_ENGINES.reduce((sum, def) => sum + (engines[def.key] || 0) * def.bruch, 0);
  return Math.min(SIEGE_BREACH_CAP, roh);
}

// Und was es zur Eröffnungssalve beiträgt.
export function siegeVolley(engines) {
  if (!engines) return 0;
  return SIEGE_ENGINES.reduce((sum, def) => sum + (engines[def.key] || 0) * def.salve, 0);
}

// Was von einer Mauer übrig bleibt, wenn Gerät davorsteht. Unter 1 geht es
// nicht: eine Bresche macht aus der Mauer offenes Feld, nicht weniger.
export function breachedWall(wallMultiplier, engines) {
  if (!(wallMultiplier > 1)) return wallMultiplier;
  return 1 + (wallMultiplier - 1) * (1 - siegeBreach(engines));
}

// Was ein Stück Gerät diese Fraktion kostet. Wer die Werkstätten hat, in denen
// das Torsionsgeschütz gebaut wurde, zimmert billiger als einer, der seine
// Zimmerleute erst anwerben muss. Der Nachlass steht an der Fraktion, damit es
// nur eine Wahrheit über den Preis gibt - Knopf, KI und Abrechnung fragen hier.
export function engineCost(def, faction) {
  if (!def) return 0;
  const nachlass = (faction && faction.engineDiscount) || 0;
  return Math.round(def.cost * (1 - nachlass));
}

// Der Sold für das Gerät eines Heeres.
export function engineUpkeep(engines) {
  if (!engines) return 0;
  return SIEGE_ENGINES.reduce((sum, def) => sum + (engines[def.key] || 0) * def.upkeep, 0);
}

// --- Frontbreite ----------------------------------------------------------
// Eine Schlacht wird an einer Linie geschlagen, nicht als Haufen. Was über
// diese Zahl hinausgeht, steht in zweiter und dritter Reihe und wartet, bis
// vorne eine Lücke ist. Übermacht bleibt damit ein Vorteil - aber kein
// Freibrief: ein Heer von 2000 Mann trat vorher gegen 500 an, als kämpften
// alle 2000 auf einmal, und kam mit drei Prozent Verlust davon.
export const FRONTAGE_BASE = 900;
// Enges Gelände nimmt der Übermacht noch mehr davon: im Wald und in den
// Hügeln steht kein Heer in einer Linie. Gebirge fehlt hier, weil dort nicht
// gekämpft wird - es ist unpassierbar.
export const FRONTAGE_TERRAIN = { forest: 0.7, hills: 0.8 };

// Wie breit eine Seite auf diesem Gelände überhaupt aufmarschieren kann.
// `narrowBy` verengt die Front des Angreifers: vor einer Mauer kommt er nur
// an Tor und Bresche heran, und zwar umso weniger, je stärker sie ist.
export function frontageWidth(terrainType, narrowBy = 1) {
  return (FRONTAGE_BASE * (FRONTAGE_TERRAIN[terrainType] ?? 1)) / Math.max(1, narrowBy);
}

// Der Anteil einer Truppe, der gleichzeitig ins Gefecht kommt.
export function engagedShare(count, width) {
  return count > width ? width / count : 1;
}

// --- Schlachtordnungen ----------------------------------------------------
// Vor jeder Schlacht steht eine Entscheidung, die nichts mit der Zahl der
// Männer zu tun hat: wie sie stehen. Drei Ordnungen für den Angriff, drei für
// die Verteidigung, und jede hat ihren Preis.
//
// Was eine Ordnung bewirkt, steht in drei Zahlen:
//   eigen  wie hart die eigene Seite zuschlägt
//   gegen  wie hart die andere Seite zurückschlägt
//   front  wie breit die eigene Seite aufmarschiert - davon hängt ab, wie
//          viele von einer Übermacht überhaupt ins Gefecht kommen
//   salve  wie schwer die Eröffnung der eigenen Schützen wiegt
//
// Keine Ordnung ist ohne Nachteil, und keine ist immer richtig: der Keil
// bricht die Linie und öffnet die eigenen Flanken, die Umfassung braucht
// Reiterei, der Beschuss braucht Zeit und Schützen. Wer nichts wählt, ficht
// in der ersten - so wie ein Heer ohne Befehl in Linie antritt.
export const TACTICS = {
  angriff: [
    {
      key: 'keil', name: 'Keil', icon: '🔻',
      kurz: 'Die Spitze bricht die Linie.',
      note: 'Alles auf einen Punkt: die Spitze trifft hart, die Flanken liegen '
        + 'offen. Ein Heer, das ohnehin ganz ins Gefecht kommt, holt hier am '
        + 'meisten heraus – die Übermacht bringt sie nicht zur Geltung.',
      eigen: 1.09, gegen: 1.06, front: 1, salve: 1,
    },
    {
      key: 'umfassung', name: 'Umfassung', icon: '🪝',
      kurz: 'Die Reiterei geht um die Flanke.',
      note: 'Breit aufmarschieren und die Flügel schließen: mehr Männer kommen '
        + 'ins Gefecht, und darum lohnt sie erst bei Übermacht. Wer sich so weit '
        + 'öffnet, wird auch selbst getroffen. Ohne Reiterei ist es nur ein '
        + 'weiter Weg – erst ab einem Fünftel Reiterei trägt sie.',
      eigen: 1, gegen: 1.05, front: 1.07, salve: 1,
      reiterei: { anteil: 0.2, mit: 1.04, ohne: 0.97 },
    },
    {
      key: 'beschuss', name: 'Beschuss', icon: '🏹',
      kurz: 'Erst der Hagel, dann das Handgemenge.',
      note: 'Die Schützen bekommen ihre Zeit: die Eröffnung wiegt fast doppelt. '
        + 'Dafür geht das Fußvolk zögernd vor – und wo es keine Schützen gibt, '
        + 'ist es nur Zögern.',
      eigen: 0.97, gegen: 0.98, front: 1, salve: 1.3,
    },
    {
      key: 'schiefeSchlacht', name: 'Schiefe Schlachtordnung', icon: '📐',
      kurz: 'Ein Flügel schlägt, der andere hält zurück.',
      note: 'Epaminondas bei Leuktra: den einen Flügel bis zur Übermacht '
        + 'verstärken, den anderen zurückhalten. Wo geschlagen wird, wird hart '
        + 'geschlagen; überall sonst steht zu wenig. Eine Ordnung für ein Heer, '
        + 'das an einer Stelle gewinnen will, nicht auf ganzer Linie.',
      eigen: 1.13, gegen: 1.1, front: 0.9, salve: 1,
    },
    {
      key: 'sturmlauf', name: 'Sturmlauf', icon: '💨',
      kurz: 'Ohne Halt hinein.',
      note: 'Der ganze Haufen im Lauf, ehe der Gegner steht: das bricht eine '
        + 'wankende Linie und zerschellt an einer festen. Wer so anrennt, '
        + 'kommt außer Atem an - das kostet den Rest des Tages doppelt.',
      eigen: 1.11, gegen: 1.12, front: 1, salve: 0.6,
      erschoepfung: 6,
    },
    {
      key: 'scheinflucht', name: 'Scheinflucht', icon: '🎭',
      kurz: 'Weichen, bis er sich streckt.',
      note: 'Vorreiten, kehrtmachen, den Gegner aus seiner Ordnung locken und '
        + 'dann herumfahren. Die Reiterei muss es tragen - unter einem Drittel '
        + 'ist es keine Finte, sondern eine Flucht. Sie schont die eigene '
        + 'Truppe und entscheidet langsam.',
      eigen: 1.02, gegen: 0.9, front: 0.95, salve: 1,
      reiterei: { anteil: 0.33, mit: 1.09, ohne: 0.88 },
    },
  ],
  verteidigung: [
    {
      key: 'schildwall', name: 'Schildwall', icon: '🛡️',
      kurz: 'Stehen und aushalten.',
      note: 'Schild an Schild: der Stoß des Angreifers verpufft an der Wand. '
        + 'Aus einer Wand heraus schlägt niemand weit aus.',
      eigen: 0.975, gegen: 0.95, front: 0.985, salve: 1,
    },
    {
      key: 'breiteFront', name: 'Breite Front', icon: '📏',
      kurz: 'Jeden Mann in die Linie.',
      note: 'Die Linie so weit ziehen, wie das Gelände es hergibt: von einer '
        + 'Übermacht kommt viel mehr ins Gefecht. Dünn ist sie überall.',
      eigen: 0.985, gegen: 1.015, front: 1.08, salve: 1,
    },
    {
      key: 'gegenstoss', name: 'Gegenstoß', icon: '⚡',
      kurz: 'Nicht warten, sondern treffen.',
      note: 'Dem Angreifer entgegen, ehe er steht: das trifft hart und lässt '
        + 'die eigene Ordnung offen. Die Entscheidung fällt schnell – in die '
        + 'eine oder die andere Richtung.',
      eigen: 1.06, gegen: 1.03, front: 1, salve: 1,
    },
    {
      key: 'igel', name: 'Igel', icon: '🦔',
      kurz: 'Nach allen Seiten Spitzen.',
      note: 'Das Karree, die Speere nach außen: von keiner Seite ein Rücken. '
        + 'Reiterei bricht daran, und nichts kommt vorwärts - auch das eigene '
        + 'Heer nicht. Die letzte Ordnung eines Umzingelten.',
      eigen: 0.9, gegen: 0.86, front: 0.92, salve: 1,
    },
    {
      key: 'hoehenstellung', name: 'Höhenstellung', icon: '⛰️',
      kurz: 'Die Höhe halten und schießen lassen.',
      note: 'Den Hang im Rücken, die Schützen oben: wer heraufkommt, kommt '
        + 'langsam und einzeln. Am Hang trägt sie doppelt - in der Ebene ist '
        + 'sie nur eine schmale Linie.',
      eigen: 0.94, gegen: 0.93, front: 0.95, salve: 1.35,
      gelaende: { arten: ['hills', 'mountain', 'forest'], mit: 0.9, ohne: 1.04 },
    },
    {
      key: 'rueckzugsgefecht', name: 'Rückzugsgefecht', icon: '🏳️',
      kurz: 'Nicht siegen, sondern davonkommen.',
      note: 'Fechten, weichen, wieder fechten: nach der halben Schlacht setzt '
        + 'man sich ab. Das Feld bleibt dem Gegner - immer, auch die Stadt, '
        + 'vor der man steht. Dafür kostet die Niederlage nur halb so viele '
        + 'Männer wie jede andere Ordnung.',
      eigen: 0.82, gegen: 0.88, front: 0.9, salve: 1,
      schonung: 0.7, weichen: true,
    },
  ],
};

export const DEFAULT_TACTIC = { angriff: 'keil', verteidigung: 'schildwall' };

// Die Ordnungen einer Seite - `seite` ist 'angriff' oder 'verteidigung'.
export function tacticsFor(seite) {
  return TACTICS[seite] || TACTICS.angriff;
}

// Eine Ordnung am Namen, mit der ersten ihrer Seite als Rückfall: ein Heer
// ohne Befehl tritt in Linie an.
export function tacticByKey(seite, key) {
  const liste = tacticsFor(seite);
  return liste.find((t) => t.key === key) || liste[0];
}

// Was diese Ordnung für diese Truppe wirklich wiegt. Drei Ordnungen hängen an
// etwas, das nicht in der Zahl steht: die Umfassung und die Scheinflucht an
// der Reiterei, die Höhenstellung am Gelände. Alles andere gilt, wie es
// dasteht.
export function tacticEffect(seite, key, units = null, gelaende = null) {
  const t = tacticByKey(seite, key);
  const wirkung = {
    eigen: t.eigen, gegen: t.gegen, front: t.front, salve: t.salve,
    // Wie viel von den eigenen Verlusten am Ende wirklich anfällt. Nur das
    // Rückzugsgefecht setzt sie herab; alles andere lässt sie, wie sie ist.
    schonung: t.schonung || 1,
    weichen: !!t.weichen,
    // Was die Ordnung an Erschöpfung zusätzlich kostet.
    erschoepfung: t.erschoepfung || 0,
  };
  if (t.reiterei && units) {
    const mann = COMBAT_ROLES.reduce((sum, k) => sum + (units[k] || 0), 0);
    const reiter = units.cavalry || 0;
    const genug = mann > 0 && reiter / mann >= t.reiterei.anteil;
    wirkung.eigen *= genug ? t.reiterei.mit : t.reiterei.ohne;
    wirkung.reiterei = genug;
  }
  if (t.gelaende) {
    const passt = !!gelaende && t.gelaende.arten.includes(gelaende);
    wirkung.gegen *= passt ? t.gelaende.mit : t.gelaende.ohne;
    wirkung.gelaende = passt;
  }
  return wirkung;
}

export const MAX_WALL_LEVEL = WALL_LEVELS.length;
// Capitals are fortified from the first turn, but not to the last stage:
// there is still something left for their owner to build.
export const CAPITAL_WALL_LEVEL = 2;
// Kein Ort steht 264 v. Chr. offen in der Landschaft. Jede Siedlung einer
// Fraktion hat ihre Holzpalisade; die unabhängigen Städte, die niemanden über
// sich haben und sich selbst verteidigen müssen, haben die große. Ihre Dörfer
// kommen wie alle anderen mit der einfachen aus.
export const START_WALL_LEVEL = 1;
export const FREE_CITY_WALL_LEVEL = 2;

// Womit ein Ort in den Feldzug geht.
export function startingWallLevel(def) {
  if (def.capital) return CAPITAL_WALL_LEVEL;
  if (def.factionId === 'neutral') {
    return (def.size || DEFAULT_SETTLEMENT_SIZE) === 'village'
      ? START_WALL_LEVEL : FREE_CITY_WALL_LEVEL;
  }
  // Ein Dorf eines Reichs ist ein offener Weiler: Höfe, ein Speicher, kein
  // Wall. Wer es halten will, baut die Palisade selbst - das ist die erste
  // Entscheidung an jeder Grenze. Die unabhängigen Orte behalten ihre: sie
  // haben keinen Herrn, der ihnen ein Heer schickt, und stehen für sich.
  if ((def.size || DEFAULT_SETTLEMENT_SIZE) === 'village') return 0;
  return START_WALL_LEVEL;
}

// Level 0 is an open town; 1..3 index into WALL_LEVELS.
export function wallLevelInfo(level) {
  return level >= 1 && level <= WALL_LEVELS.length ? WALL_LEVELS[level - 1] : null;
}

export function wallLevelName(level) {
  const info = wallLevelInfo(level);
  return info ? info.name : 'keine Befestigung';
}

export function wallDefenceMultiplier(level) {
  const info = wallLevelInfo(level);
  return info ? info.defence : 1;
}

// --- Erfahrung -----------------------------------------------------------
// Armeen lernen im Feld. Fünf Sterne sind das Höchste; jeder Stern ist echte
// Kampfkraft, keine Verzierung.
export const EXPERIENCE_THRESHOLDS = [20, 55, 110, 190, 300];
export const MAX_STARS = EXPERIENCE_THRESHOLDS.length;
export const MAX_EXPERIENCE = EXPERIENCE_THRESHOLDS[MAX_STARS - 1];
export const EXPERIENCE_PER_BATTLE = 8;
export const EXPERIENCE_FOR_WIN = 8;
// Wie viel Kampfkraft ein Stern bringt.
export const EXPERIENCE_BONUS_PER_STAR = 0.12;

export const STAR_TITLES = [
  'Aushebung', 'Erprobt', 'Kampferfahren', 'Veteranen', 'Elitetruppen', 'Legenden',
];

export function experienceStars(experience) {
  let stars = 0;
  for (const threshold of EXPERIENCE_THRESHOLDS) {
    if ((experience || 0) >= threshold) stars++;
  }
  return stars;
}

export function experienceBonus(experience) {
  return 1 + experienceStars(experience) * EXPERIENCE_BONUS_PER_STAR;
}

export function starTitle(experience) {
  return STAR_TITLES[experienceStars(experience)];
}

// ★★☆ - gefüllte Sterne für das Erreichte, leere für das Mögliche.
export function starMarks(experience) {
  const stars = experienceStars(experience);
  return '★'.repeat(stars) + '☆'.repeat(MAX_STARS - stars);
}

// --- Hafenbau ------------------------------------------------------------
// Ohne Hafen kein Schiff: eine Armee geht nur dort an Bord, wo Kais, Werft
// und Vorräte stehen. Hauptstädte und Große Städte am Meer bringen ihren
// Hafen mit, jede andere Küstenstadt muss ihn bauen.
export const HARBOUR_COST = 300;
export const HARBOUR_TURNS = 3;
export const HARBOUR_NAME = 'Hafen';

// --- Kaserne und Verwaltung ------------------------------------------------
// Ein Reich baut nicht aus dem Nichts. Wer Truppen aushebt, braucht einen Ort,
// an dem sie ausgebildet und untergebracht werden; wer Straßen, Brücken und
// Stollen anlegt, braucht eine Verwaltung, die Vermessung, Fronarbeit und
// Abrechnung ordnet. Beides sind Bauwerke wie Mauer und Hafen - und beides
// heißt nicht überall gleich: was in Rom das Forum ist, ist bei den Griechen
// die Agora, bei den Germanen der Thingplatz und bei den Sarmaten das Zelt
// des Fürsten.
//
// Zu Spielbeginn steht die Kaserne nur in den Hauptstädten; eine Verwaltung
// hat niemand. Die erste Straße und das erste Bergwerk kosten deshalb einen
// Umweg - und die Entscheidung, wo dieser Umweg sich lohnt.
export const BARRACKS_COST = 250;
export const BARRACKS_TURNS = 3;
export const FORUM_COST = 300;
export const FORUM_TURNS = 3;

// Wie die Ausbildungsstätte einer Fraktion heißt.
export const BARRACKS_NAMES = {
  rom: 'Castra',
  karthago: 'Söldnerlager',
  numidien: 'Reiterhof',
  parther: 'Kataphraktenhof',
  armenien: 'Waffenhof',
  pontus: 'Exerzierplatz',
  gallier: 'Kriegerhalle',
  athen: 'Gymnasion',
  sparta: 'Agoge',
  makedonien: 'Phalangitenlager',
  syrakus: 'Waffenwerkstatt',
  germanen: 'Gefolgschaftshalle',
  britannier: 'Wagenhof',
  iberer: 'Kriegerhof',
  illyrer: 'Waffenhalle',
  sarmaten: 'Reiterlager',
  daker: 'Waffenplatz',
  seleukiden: 'Phalanxlager',
  // Die Ptolemäer siedelten ihre Soldaten auf Königsland an - der Kleruch war
  // Bauer und Phalangit in einem.
  ptolemaeer: 'Kleruchenland',
  neutral: 'Kaserne',
};

// Und wie ihr Verwaltungsbau heißt: das Haus oder der Platz, an dem entschieden
// wird, wo eine Straße langgeht und wer sie baut.
export const FORUM_NAMES = {
  rom: 'Forum',
  // Zwei Sufeten standen Karthago vor; in ihrem Haus wurde verwaltet.
  karthago: 'Suffetenhaus',
  numidien: 'Königshof',
  parther: 'Satrapensitz',
  armenien: 'Königshalle',
  pontus: 'Basilikon',
  gallier: 'Versammlungsplatz',
  athen: 'Agora',
  sparta: 'Gerusia',
  makedonien: 'Königshof',
  syrakus: 'Buleuterion',
  germanen: 'Thingplatz',
  britannier: 'Ratsplatz',
  iberer: 'Ältestenrat',
  illyrer: 'Fürstenhof',
  // Ein Volk, das nicht wohnt, verwaltet aus dem Zelt.
  sarmaten: 'Fürstenzelt',
  daker: 'Adelsrat',
  seleukiden: 'Satrapenpalast',
  ptolemaeer: 'Kanzlei',
  neutral: 'Ratshaus',
};

export function barracksName(factionId) {
  return BARRACKS_NAMES[factionId] || BARRACKS_NAMES.neutral;
}

export function forumName(factionId) {
  return FORUM_NAMES[factionId] || FORUM_NAMES.neutral;
}

// --- Werft -----------------------------------------------------------------
// Ein Hafen ist ein Kai, an dem etwas anlegt. Ein Kriegsschiff entsteht dort
// nicht: dafür braucht es eine Helling, Bauholz, Pech, Werg und Leute, die es
// können. Die Werft ist deshalb ein eigenes Bauwerk und Bedingung für jedes
// Schiff, das vom Stapel läuft - gechartertes Transportgut fährt weiter ab
// jedem Hafen, aber eine Flotte baut nur, wer eine Werft hat.
export const SHIPYARD_NAME = 'Werft';
export const SHIPYARD_COST = 350;
export const SHIPYARD_TURNS = 3;

// --- Bergwerk --------------------------------------------------------------
// Was ein Ort aus dem Boden holt, holt er nur einmal - und dafür braucht es
// einen Stollen, Werkzeug und Leute, die hinuntersteigen. Ein Bergwerk ist
// deshalb kein Geschenk der Lage, sondern ein Bauwerk: teuer, langsam, und
// danach die beste Einnahmequelle, die ein Ort haben kann.
//
// Es lohnt sich nur, wo etwas liegt. Im Gebirge liegt das Erz offen, im
// Hügelland muss man es suchen, in der Ebene gibt es keines - deshalb zählt
// nicht der Ort, sondern sein Umland.
export const MINE_NAME = 'Bergwerk';
export const MINE_COST = 400;
export const MINE_TURNS = 4;
// Wie weit die Stollen ins Umland reichen: zwei Felder, gut 110 km.
export const MINE_RANGE = 2;
// Was ein Feld hergibt.
export const MINE_ORE = { mountain: 2, hills: 1 };
// Darunter lohnt kein Stollen.
export const MINE_MIN_ORE = 3;
// Was ein Punkt Erz je Runde trägt, und wo auch der reichste Berg aufhört.
export const MINE_INCOME_PER_ORE = 4;
export const MINE_MAX_ORE = 12;

export function mineIncome(ore) {
  if (!ore || ore < MINE_MIN_ORE) return 0;
  return Math.min(MINE_MAX_ORE, ore) * MINE_INCOME_PER_ORE;
}

// --- Feld und Speicher -----------------------------------------------------
// Ein Ort lebt von dem, was um ihn herum wächst. Die Farm legt das Ackerland
// an, das ihn ernährt: mehr Kinder kommen durch, mehr Menschen bleiben. Der
// Kornspeicher kommt danach - er bewahrt die Ernte über den Winter, und erst
// dadurch kann ein Ort dauerhaft mehr Menschen tragen, als seine Felder in
// einem schlechten Jahr hergeben.
export const FARM_NAME = 'Farm';
export const FARM_COST = 180;
export const FARM_TURNS = 2;
export const GRANARY_NAME = 'Kornspeicher';
export const GRANARY_COST = 260;
export const GRANARY_TURNS = 3;

// --- Fischerei und Jagdhütte -----------------------------------------------
// Nicht jeder Ort lebt vom Acker. Wer am Wasser liegt, lebt vom Fang, und wer
// am Wald liegt, vom Wild. Beides ist billiger und kleiner als die Farm: eine
// Reihe Boote am Strand, eine Hütte am Waldrand. Beides trägt zweierlei -
// Nahrung, an der der Ort wächst, und ein wenig Geld aus dem, was übrig
// bleibt: gesalzener Fisch, Felle, Honig, Wachs.
//
// Sie schließen einander nicht aus und schließen die Farm nicht aus. Ein Ort,
// der Acker, Fang und Jagd hat, wächst schnell - er hat es dreifach bezahlt,
// und seine Obergrenze bleibt dieselbe.
export const FISHERY_NAME = 'Fischerei';
export const FISHERY_COST = 160;
export const FISHERY_TURNS = 2;
export const FISHERY_GROWTH = 0.3;
// Was der Fang je Runde einbringt. Er hängt nicht am Ort und nicht an seiner
// Größe: das Meer gibt, was es gibt.
export const FISHERY_INCOME = 14;

export const HUNT_NAME = 'Jagdhütte';
export const HUNT_COST = 140;
export const HUNT_TURNS = 2;
export const HUNT_GROWTH = 0.2;
// Wie weit die Jäger ziehen und was ein Feld hergibt. Im Wald steht das Wild,
// im Hügelland zieht es durch; in der Ebene und in der Wüste gibt es nichts,
// wovon eine Hütte leben könnte.
export const HUNT_RANGE = 2;
export const HUNT_GAME = { forest: 2, hills: 1 };
export const HUNT_MIN_GAME = 3;
export const HUNT_INCOME_PER_GAME = 2;
export const HUNT_MAX_GAME = 8;

export function huntIncome(wild) {
  if (!wild || wild < HUNT_MIN_GAME) return 0;
  return Math.min(HUNT_MAX_GAME, wild) * HUNT_INCOME_PER_GAME;
}

// --- Viadukt ---------------------------------------------------------------
// Wasser über das Tal, auf Bögen, über Meilen. Wo es ankommt, wächst der Ort
// schneller und hält eine größere Besatzung aus - Wasser ist das, woran eine
// Belagerung zuerst scheitert. Gebaut wird es nur, wo eine Verwaltung die
// Strecke vermisst.
export const VIADUCT_NAME = 'Viadukt';
export const VIADUCT_COST = 480;
export const VIADUCT_TURNS = 5;

// Was die drei Versorgungsbauten bewirken. Alles hängt an diesen drei Zahlen -
// sie stehen hier zusammen, damit man die Wirkung vergleichen kann, ohne drei
// Dateien aufzuschlagen.
export const FARM_GROWTH = 0.5;
export const VIADUCT_GROWTH = 0.25;
export const GRANARY_CEILING = 0.25;
export const VIADUCT_GARRISON = 0.2;

// Um wie viel schneller ein Ort wächst, als er es ohne Bauwerke täte.
export function growthFactor(city) {
  if (!city) return 1;
  return 1 + (city.farm ? FARM_GROWTH : 0) + (city.viaduct ? VIADUCT_GROWTH : 0)
    + (city.fishery ? FISHERY_GROWTH : 0) + (city.hunt ? HUNT_GROWTH : 0);
}

// --- Was eine Eroberung anrichtet ------------------------------------------
// Eine Stadt, die im Sturm genommen wird, ist danach keine heile Stadt. Die
// Mauer hat eine Bresche, das Tor liegt aus den Angeln, und was an Werkstätten,
// Speichern und Kais dranhing, ist geplündert oder verbrannt. Der neue Herr
// erbt Trümmer und muss sie erst wieder aufbauen - billiger als ein Neubau,
// denn die Grundmauern stehen noch, aber nicht umsonst.
//
// Das ist auch eine Regel gegen die Eroberungsspirale: wer eine Stadt nimmt,
// bekommt sie nicht als fertige Werkbank geschenkt.
export const CAPTURE_WALL_LOSS = 1;
export const CAPTURE_RUIN_CHANCE = 0.5;
// Was der Wiederaufbau aus Trümmern kostet, gemessen am Neubau.
export const REPAIR_FACTOR = 0.5;

export function repairCost(cost) {
  return Math.max(10, Math.round((cost * REPAIR_FACTOR) / 10) * 10);
}

export function repairTurns(turns) {
  return Math.max(1, Math.round(turns * REPAIR_FACTOR));
}

// --- Das Lager -------------------------------------------------------------
// Ein römisches Heer schlug jeden Abend ein Lager auf: Graben, Wall, Palisade,
// die Zelte in festen Gassen dahinter. Das kostet einen halben Tag Arbeit und
// gibt dafür drei Dinge - einen Ort, an dem sich das Heer erholt, einen Wall,
// hinter dem es sich verteidigt, und, vor einer fremden Stadt aufgeschlagen,
// die Belagerung selbst.
//
// Das Lager ist deshalb der Weg, eine Stadt zu nehmen, ohne sie zu stürmen:
// wer davor liegt, schneidet sie ab und wartet, bis der Hunger die Mauer
// öffnet, die kein Sturm geöffnet hätte.
// --- Der Hinterhalt --------------------------------------------------------
// Ein Heer im Wald, im Hügelland oder im Gebirge kann sich legen und warten.
// Solange es liegt, sieht der Feind es nicht - und wer daran vorbeimarschiert,
// bekommt es in die Flanke. Das ist die Schlacht, die Rom im Teutoburger Wald
// und am Trasimenischen See verloren hat, und die einzige Art, mit der ein
// kleines Heer ein großes schlägt, ohne eine Mauer im Rücken zu haben.
export const AMBUSH_NAME = 'Hinterhalt';
// Wo man sich legen kann. In der Ebene ist niemand zu verbergen.
export const AMBUSH_TERRAIN = new Set(['forest', 'hills', 'mountain']);
// Was der Überfall dem Angreifer bringt - ein Drittel mehr Schlagkraft.
export const AMBUSH_ATTACK = 1.35;
// Und was er dem Überfallenen nimmt: Ordnung und Mut. Der Abzug wird vor der
// Schlacht auf die Moral gerechnet, nicht erst danach.
export const AMBUSH_MORALE = 22;
// Der Bogen, in dem gelauert wird: ein Feld. Weiter reicht kein Überfall.
export const AMBUSH_RANGE = 1;

export const CAMP_NAME = 'Lager';
export const CAMP_COST = 90;
// Was der Wall im Gefecht trägt - weniger als eine Mauer, aber genug, dass ein
// Gegenangriff auf ein Lager teuer wird.
export const CAMP_DEFENCE = 1.4;
// Hinter dem Wall ruht es sich wie in der eigenen Stadt, und das Wetter kommt
// nur halb durch die Zeltbahnen.
export const CAMP_SHELTER = 0.5;
// Ein Belagerungslager wartet nicht drei Runden, bis der Hunger anfängt: es
// schneidet vom ersten Tag an ab, und es zehrt schneller.
export const CAMP_SIEGE_STARVE_AFTER = 1;
export const CAMP_SIEGE_ATTRITION = 0.1;
export const CAMP_SIEGE_POPULATION_LOSS = 0.02;

// --- Belagerung ------------------------------------------------------------
// Ein Ort ist belagert, sobald ein feindliches Heer unmittelbar neben ihm
// steht - und ein Hafenort auch dann, wenn eine feindliche Flotte vor ihm
// kreuzt. Es braucht keinen eigenen Befehl dafür: wer sich davorstellt,
// belagert. Was das bedeutet, steht in actions.js; hier stehen die Zahlen.
//
// Eine Belagerung nimmt dem Ort alles, was von draußen kommt: die Ernte, den
// Handel, das Erz, den Nachschub für die Wache und die Bautrupps. Und nach
// ein paar Runden fängt sie an zu zehren.
export const SIEGE_STARVE_AFTER = 3;
// Was der Hunger je Runde von der Besatzung nimmt - und von den Einwohnern.
export const SIEGE_ATTRITION = 0.06;
export const SIEGE_POPULATION_LOSS = 0.012;

// --- Die Bauwerke eines Orts ----------------------------------------------
// Alle Bauwerke in einer Liste, in der Reihenfolge, in der sie im Bauen-Reiter
// stehen. Jeder Eintrag sagt, was er kostet, wie lange er dauert, was er
// voraussetzt und was er danach kann. Der Reiter zeigt nur, was jetzt gebaut
// werden kann oder schon steht - die Liste entscheidet das, nicht sechs
// beinahe gleiche Funktionen in der Oberfläche.
//
// `requires` ist das Bauwerk, das vorher stehen muss; `site` eine Bedingung
// an den Ort selbst, die erst der Spielstand beantworten kann (Küste, Erz).
export const BUILDINGS = [
  {
    key: 'barracks',
    icon: '🛡️',
    cost: BARRACKS_COST,
    turns: BARRACKS_TURNS,
    name: barracksName,
    purpose: 'hier lassen sich Truppen ausheben',
    promise: 'ohne sie stellt dieser Ort keine Truppen',
  },
  {
    key: 'farm',
    icon: '🌾',
    cost: FARM_COST,
    turns: FARM_TURNS,
    name: () => FARM_NAME,
    purpose: `Ackerland: ${Math.round(FARM_GROWTH * 100)} % mehr Zuwachs`,
    promise: `${Math.round(FARM_GROWTH * 100)} % mehr Zuwachs; danach lässt sich `
      + `der ${GRANARY_NAME} bauen`,
  },
  {
    key: 'granary',
    icon: '🏺',
    cost: GRANARY_COST,
    turns: GRANARY_TURNS,
    requires: 'farm',
    name: () => GRANARY_NAME,
    purpose: `die Ernte hält über den Winter: ${Math.round(GRANARY_CEILING * 100)} % `
      + 'mehr Einwohner möglich',
    promise: `${Math.round(GRANARY_CEILING * 100)} % höhere Obergrenze für die Einwohner`,
  },
  {
    key: 'fishery',
    icon: '🐟',
    cost: FISHERY_COST,
    turns: FISHERY_TURNS,
    site: 'coast',
    name: () => FISHERY_NAME,
    purpose: `Fang aus dem Meer: ${Math.round(FISHERY_GROWTH * 100)} % mehr Zuwachs `
      + `und ${FISHERY_INCOME} Gold je Runde`,
    promise: `${Math.round(FISHERY_GROWTH * 100)} % mehr Zuwachs und `
      + `${FISHERY_INCOME} Gold je Runde`,
  },
  {
    key: 'hunt',
    icon: '🏹',
    cost: HUNT_COST,
    turns: HUNT_TURNS,
    site: 'game',
    name: () => HUNT_NAME,
    purpose: `Wild aus dem Umland: ${Math.round(HUNT_GROWTH * 100)} % mehr Zuwachs`,
    promise: `${Math.round(HUNT_GROWTH * 100)} % mehr Zuwachs, dazu Felle und Wachs`,
  },
  {
    key: 'forum',
    icon: '🏛️',
    cost: FORUM_COST,
    turns: FORUM_TURNS,
    name: forumName,
    purpose: 'von hier aus werden Viadukt und Stollen vermessen',
    promise: `Voraussetzung für ${VIADUCT_NAME} und ${MINE_NAME}`,
  },
  {
    key: 'viaduct',
    icon: '🌉',
    cost: VIADUCT_COST,
    turns: VIADUCT_TURNS,
    requires: 'forum',
    name: () => VIADUCT_NAME,
    purpose: `frisches Wasser: ${Math.round(VIADUCT_GROWTH * 100)} % mehr Zuwachs, `
      + `${Math.round(VIADUCT_GARRISON * 100)} % größere Garnison`,
    promise: `${Math.round(VIADUCT_GROWTH * 100)} % mehr Zuwachs und `
      + `${Math.round(VIADUCT_GARRISON * 100)} % mehr Platz für die Garnison`,
  },
  {
    key: 'mine',
    icon: '⛏️',
    cost: MINE_COST,
    turns: MINE_TURNS,
    requires: 'forum',
    site: 'ore',
    name: () => MINE_NAME,
    purpose: 'fördert Erz aus dem Umland',
    promise: 'die beste Einnahme, die ein Ort haben kann',
  },
  {
    key: 'harbour',
    icon: '⚓',
    cost: HARBOUR_COST,
    turns: HARBOUR_TURNS,
    site: 'coast',
    name: () => HARBOUR_NAME,
    purpose: 'Truppentransporte und Handelsschiffe laufen von hier aus',
    promise: 'Truppentransporte, Handelswege über See – und die Werft',
  },
  {
    key: 'shipyard',
    icon: '🔨',
    cost: SHIPYARD_COST,
    turns: SHIPYARD_TURNS,
    requires: 'harbour',
    name: () => SHIPYARD_NAME,
    purpose: 'hier laufen Kriegsschiffe vom Stapel',
    promise: 'ohne sie läuft hier kein Kriegsschiff vom Stapel',
  },
];

export const BUILDING_KEYS = BUILDINGS.map((b) => b.key);

export function buildingDef(key) {
  return BUILDINGS.find((b) => b.key === key) || null;
}

// Wie das Bauwerk in diesem Reich heißt - Kaserne und Verwaltung tragen in
// jeder Fraktion einen eigenen Namen, die übrigen überall denselben.
export function buildingName(key, factionId) {
  const def = buildingDef(key);
  return def ? def.name(factionId) : '';
}

// --- Bevölkerung ----------------------------------------------------------
// Orte wachsen. Nicht durch Zuzug oder Eroberung, sondern schlicht dadurch,
// dass mehr Kinder geboren werden als Menschen sterben - und das geht in
// Friedenszeiten schneller als in einem Jahr, in dem ein Heer vor dem Tor
// steht. Gerechnet wird je Runde, also je Monat.
//
// Der Satz ist bewusst klein: über ein Feldzugsjahr (zwölf Runden) wächst ein
// Ort um gut vier Prozent, über zehn Jahre um die Hälfte. Man sieht es nicht
// von Runde zu Runde, aber man sieht es.
export const BIRTH_RATE = 0.0035;
// Im Frühjahr und Sommer wird mehr geboren als im Winter.
export const BIRTH_SEASON = { fruehling: 1.3, sommer: 1.2, herbst: 0.9, winter: 0.6 };
// Steht ein fremdes Heer vor dem Ort, wächst nichts: die Felder liegen brach.
export const SIEGE_RANGE = 1;
// Wie weit ein Ort über die Einwohnerzahl seines Rangs hinauswächst, ehe er in
// den nächsten hineinwächst. Der Anteil bezieht sich auf die Einwohnerzahl,
// mit der ein Ort seines Rangs beginnt: ein Dorf bleibt ein Dorf, bis es keines
// mehr ist.
export const POPULATION_CEILING = 1.6;

// Ab wann ein Ort in den nächsten Rang hineinwächst: wenn er die Obergrenze
// seines jetzigen erreicht hat. Der Speicher zählt dabei nicht mit - er soll
// den gewachsenen Ort ernähren, nicht seinen Aufstieg erkaufen.
export function promotionThreshold(city) {
  const tier = settlementTier(city.size);
  const basis = city.capital ? tier.populationCapital : tier.population;
  return Math.round(basis * POPULATION_CEILING);
}

// Der nächste Rang über diesem - null für die große Stadt, über der es keinen
// gibt.
export function nextSettlementSize(size) {
  if (size === 'village') return 'city';
  if (size === 'city') return 'large';
  return null;
}

// Die Obergrenze eines Orts: sein Rang bestimmt sie, die Hauptstadt hat mehr.
export function populationCeiling(city) {
  const tier = settlementTier(city.size);
  const basis = city.capital ? tier.populationCapital : tier.population;
  // Wer die Ernte einlagert, ernährt auch die, die in einem mageren Jahr
  // sonst fortgezogen wären.
  const speicher = city.granary ? 1 + GRANARY_CEILING : 1;
  return Math.round(basis * POPULATION_CEILING * speicher);
}

// --- Aufgebot der freien Orte ---------------------------------------------
// Eine unabhängige Stadt hat keinen Herrn, der ihr ein Heer schickt. Steht ein
// Feind vor dem Tor, greift sie deshalb zu dem, was sie hat: ihren eigenen
// Leuten. Aus der Bevölkerung tritt ein Teil unter die Waffen - schlecht
// bewaffnet, aber zahlreich und auf der eigenen Mauer.
//
// Wie viele es sind: jeder achte Kopf, und in einer großen Stadt bis zu
// neunhundert. Das ist mehr, als ein Aufgebot in Ruhe zusammenbrächte - aber
// es geht nicht um Ruhe. Eine freie Stadt hat keinen Herrn, der ihr ein Heer
// schickt; steht der Feind vor dem Tor, greift jeder zu, der eine Sense halten
// kann. Vorher war es jeder sechzehnte und höchstens vierhundert, und ein
// unabhängiger Ort fiel dem ersten Heer zu, das vorbeikam.
export const LEVY_SHARE = 0.125;
// Mehr als so viele werden es nicht, auch in der größten Stadt nicht.
export const LEVY_MAX = 900;
// Und unter dieser Zahl lohnt es nicht - ein Dorf mit zwanzig Mann wehrt sich
// nicht anders als ohne sie.
export const LEVY_MIN = 40;

// Wie viele Bürger dieser Ort im Ernstfall aufbietet.
export function levyStrength(city) {
  if (!city || city.factionId !== 'neutral') return 0;
  const roh = Math.round(city.population * LEVY_SHARE);
  if (roh < LEVY_MIN) return 0;
  return Math.min(LEVY_MAX, roh);
}

// --- Seeräuber -------------------------------------------------------------
// Wo Handel fährt, fährt bald auch, wer ihn nimmt. Die Seeräuber sind keine
// Fraktion im eigentlichen Sinn: sie halten keine Stadt, sie erobern nichts
// und sie gewinnen das Spiel nie. Sie sind das Risiko, das auf dem Wasser
// liegt - eine Flotte, die kommt, wenn man keine eigene hat.
export const PIRATE_FACTION = 'piraten';
// Nicht in der ersten Runde: die Eröffnung gehört den Reichen.
export const PIRATE_FIRST_TURN = 8;
// Mehr als so viele Geschwader sind gleichzeitig nicht unterwegs.
export const PIRATE_MAX = 3;
// Wie wahrscheinlich in einer Runde ein neues ausläuft.
export const PIRATE_CHANCE = 0.16;
// Wie viele Schiffe ein Geschwader zählt, und wie groß es höchstens wird.
export const PIRATE_BATCH = 34;
export const PIRATE_MAX_SHIPS = 90;
// Sie fahren schneller als jede Kriegsflotte - das ist ihr ganzer Vorteil.
export const PIRATE_MOVEMENT = 36;
// Was in ihrem Lagerraum liegt, wenn sie jemand versenkt.
export const PIRATE_LOOT = 140;
// Wie weit ihr Schatten auf einen Seehandelsweg fällt und wie viel er davon
// schluckt: ein Geschwader vor der Küste halbiert, was der Weg abwirft.
export const PIRATE_BLOCKADE_RANGE = 2;
export const PIRATE_TOLL = 0.5;
// Bis hierhin suchen sie sich ein Ziel - weiter fahren sie nicht auf Verdacht.
export const PIRATE_HUNT_RANGE = 14;

// --- Wandernde Stämme ------------------------------------------------------
// Der Osten ist nicht der Rand der Welt, sondern ihre Tür. Dahinter liegt die
// Steppe, und alle paar Jahre setzt sich dort ein Volk in Bewegung: Weiber,
// Kinder, Karren, Herden - und zwischen alldem so viele wehrhafte Männer, wie
// kein Reich auf einmal ins Feld stellt.
//
// Ein solcher Zug hat kein Kriegsziel. Er hat eine Richtung: nach Westen, auf
// ein Reich zu, weil dort Land ist. Was ihm im Weg steht, überrennt er; nimmt
// er einen Ort, bleibt er dort - der Ort wird unabhängig und der Zug ist zu
// Ende. Er erobert nichts für niemanden und gewinnt nie.
export const HORDE_FACTION = 'wanderer';
// Nicht in den ersten Runden: die Eröffnung gehört den Reichen.
export const HORDE_FIRST_TURN = 18;
// Mehr als so viele Züge sind nie gleichzeitig unterwegs.
export const HORDE_MAX = 2;
// Wie wahrscheinlich sich in einer Runde eines aufmacht.
export const HORDE_CHANCE = 0.1;
// Aus welchem Streifen am Ostrand sie kommen.
export const HORDE_EDGE = 3;
// Ein Zug wandert weiter als ein Heer marschiert - er hat keine Nachschublinie
// zu halten und keinen Ort, in den er zurückkehrt.
export const HORDE_MOVEMENT = 21;
// Wie stark ein Zug ist. Der Zufall entscheidet, wie viele es sind.
export const HORDE_MIN_STRENGTH = 520;
export const HORDE_MAX_STRENGTH = 980;
// Wie er sich zusammensetzt - Anteile, die zusammen eins ergeben.
export const HORDE_SHARE = { infantry: 0.55, cavalry: 0.31, ranged: 0.14 };

// Die Völker, die aus dem Osten kamen, mit dem Namen, unter dem sie in den
// Quellen stehen.
export const HORDE_NAMES = [
  'Roxolanen', 'Alanen', 'Massageten', 'Jazygen', 'Bastarner',
  'Skiren', 'Aorsen', 'Daher', 'Sakaraukai', 'Kimmerier',
];

// --- Handel ---------------------------------------------------------------
// Jeder Ort bringt hervor, was sein Land hergibt. Zwei eigene Orte, die eine
// Straße verbindet oder die beide einen Hafen haben, können einen Handelsweg
// eröffnen: beide Seiten tragen dann Runde für Runde mehr, und am meisten,
// wenn sie Verschiedenes anzubieten haben - Salz gegen Wein lohnt, Getreide
// gegen Getreide kaum.
export const TRADE_GOODS = {
  getreide: { name: 'Getreide', icon: '🌾' },
  wein: { name: 'Wein', icon: '🍇' },
  oel: { name: 'Olivenöl', icon: '🫒' },
  salz: { name: 'Salz', icon: '🧂' },
  erz: { name: 'Erz', icon: '⛏️' },
  holz: { name: 'Holz', icon: '🪵' },
  pferde: { name: 'Pferde', icon: '🐎' },
  fisch: { name: 'Fisch und Purpur', icon: '🐟' },
};

// Was ein Handelsweg einmalig kostet und was er beiden Seiten je Runde bringt.
export const TRADE_ROUTE_COST = 200;
export const TRADE_BASE_INCOME = 3;
export const TRADE_VARIETY_BONUS = 4;
// Mehr als zwei Wege trägt ein Ort nicht: sonst hängt am Ende jede Stadt an
// jeder, und der Handel wäre nur noch eine Zahl, die immer weiter wächst.
export const TRADE_ROUTES_PER_CITY = 2;
// Weiter als das reicht kein regelmäßiger Warenverkehr.
export const TRADE_MAX_DISTANCE = 14;
// Zur See reicht ein Weg viel weiter als über Land - das ist der ganze Grund,
// warum die Antike ihre Waren übers Meer schickte: ein Schiff trägt in einer
// Fahrt, was hundert Karren nicht schaffen, und es fährt weiter. Ein Seeweg
// darf deshalb bis fast über das halbe Mittelmeer gehen und trägt mehr.
export const TRADE_SEA_DISTANCE = 26;
export const TRADE_SEA_BONUS = 1.4;

// Große Städte schlagen mehr um als ein Dorf.
export function tradeSizeFactor(size) {
  return size === 'large' ? 1.6 : size === 'village' ? 0.6 : 1;
}

// --- Straßenbau ----------------------------------------------------------
// Ein Karrenweg kostet zwei Drittel dessen, was offene Ebene kostet, und ein
// Drittel dessen, was Wald, Hügel oder Wüste kosten: ein Heer kommt auf ihm
// die Hälfte weiter als querfeldein (9 Felder statt 6 je Runde) und zehrt
// dabei weniger. Zieht es über die ganze Halbinsel, braucht es trotzdem mehr
// als eine Runde. Gebaut wird von Ort zu Ort, bezahlt nach Länge - die erste
// von drei Ausbaustufen, die Kiesstraße und die gepflasterte Straße folgen
// als spätere Ausbauten derselben Verbindung.
export const ROAD_MOVE_COST = 2;
export const ROAD_COST_PER_TILE = 30;
export const ROAD_TURNS_PER_TILE = 0.4;
export const ROAD_MIN_TURNS = 2;

// --- Die Kiesstraße ---------------------------------------------------------
// Die Zwischenstufe zwischen dem gefahrenen Karrenweg und der gepflasterten
// Straße: eine Schicht Kies auf dem festgetretenen Untergrund, ohne Wölbung
// und Gräben. Ein Heer marschiert auf ihr nicht schneller als auf dem
// Karrenweg - der Unterbau ist erst der halbe Weg zur Steinstraße, nicht
// schon ihre Geschwindigkeit. Wer aufschottert, zahlt beim Pflastern danach
// nur noch den Rest.
export const GRAVEL_ROAD_MOVE_COST = 2;
export const GRAVEL_COST_PER_TILE = 22;
export const GRAVEL_TURNS_PER_TILE = 0.3;
export const GRAVEL_MIN_TURNS = 2;

// --- Die Steinstraße -------------------------------------------------------
// Was Rom von einem Weg unterscheidet: Unterbau aus Schotter, Wölbung, Gräben
// zu beiden Seiten, oben Basaltplatten. Eine solche Straße ist bei jedem
// Wetter befahrbar, und ein Heer marschiert auf ihr doppelt so schnell wie auf
// einem festgefahrenen Weg - achtzehn Felder je Runde statt neun.
//
// Gebaut wird sie nicht ins Leere: ausgebaut wird eine Straße, die schon
// liegt, und nur von einem Ort mit Verwaltung aus - Vermessung, Fronarbeit,
// Abrechnung. Zur Steinstraße wird nur, was schon Kiesstraße ist - der
// Unterbau steht dann schon, und es fehlt nur noch das Pflaster.
export const STONE_ROAD_MOVE_COST = 1;
export const STONE_COST_PER_TILE = 45;
export const STONE_TURNS_PER_TILE = 0.5;
export const STONE_MIN_TURNS = 2;
export const ROAD_EARTH = 1;
export const ROAD_GRAVEL = 2;
export const ROAD_STONE = 3;

export function gravelRoadCost(length) {
  return Math.round(length * GRAVEL_COST_PER_TILE);
}

export function gravelRoadTurns(length) {
  return Math.max(GRAVEL_MIN_TURNS, Math.round(length * GRAVEL_TURNS_PER_TILE));
}

export function stoneRoadCost(length) {
  return Math.round(length * STONE_COST_PER_TILE);
}

export function stoneRoadTurns(length) {
  return Math.max(STONE_MIN_TURNS, Math.round(length * STONE_TURNS_PER_TILE));
}

// Ein Straßeneintrag war früher schlicht `true`; jetzt steht dort die Stufe.
// Beides muss dieselbe Antwort geben, sonst wären alte Spielstände und der
// halbe Zwischenspeicher falsch.
export function roadLevelOf(value) {
  if (value === true) return ROAD_EARTH;
  return Number(value) || 0;
}

export function roadStepCost(level) {
  if (level >= ROAD_STONE) return STONE_ROAD_MOVE_COST;
  if (level >= ROAD_GRAVEL) return GRAVEL_ROAD_MOVE_COST;
  return ROAD_MOVE_COST;
}

// Der Name einer Ausbaustufe, für Anzeige und Baumeldung - dieselben drei
// Stufen überall, damit Seitenleiste, Karte und Protokoll nicht auseinander-
// laufen.
export function roadLevelName(level) {
  if (level >= ROAD_STONE) return 'gepflasterte Straße';
  if (level >= ROAD_GRAVEL) return 'Kiesstraße';
  if (level >= ROAD_EARTH) return 'Karrenweg';
  return 'offenes Land';
}
// Wie viele Bauziele eine Stadt hat: die beiden nächstgelegenen eigenen Orte,
// zu denen noch keine Straße führt. Weiter reicht kein Straßenbau von einem
// Ort aus - eine Fernstraße entsteht Stück für Stück über die Orte dazwischen,
// nicht in einem Zug quer durchs Land.
export const ROAD_TARGET_CHOICES = 2;

// Was zu Spielbeginn schon gepflastert ist: die kurzen Wege von der
// Hauptstadt zu den eigenen Städten, mehr nicht. "Kurz" heißt hier acht
// Felder, gut 440 km - so weit reichte eine Straße, die eine Hauptstadt
// unterhalten konnte. Was weiter auseinanderliegt, verbindet keine Straße,
// sondern ein Marsch; was ein Meer trennt, ohnehin nur ein Schiff.
export const START_ROAD_MAX_TILES = 8;

export function roadCost(length) {
  return Math.round(length * ROAD_COST_PER_TILE);
}

export function roadTurns(length) {
  return Math.max(ROAD_MIN_TURNS, Math.round(length * ROAD_TURNS_PER_TILE));
}

// Was es kostet, einen Fluss zu überschreiten - Furt suchen, Wagen entladen,
// Pferde schwimmen lassen. Zwei Felder Ebene, jedes Mal. Wo eine Straße
// hinüberführt, steht eine Brücke, und dann kostet es nichts.
export const RIVER_CROSSING_COST = 6;

export const MAX_MOVEMENT = 18;

// What it costs to push into ground an enemy army holds. Together with the
// rule that forbids moving from one held tile straight into another, this is
// what makes an army a barrier rather than a piece to walk around.
export const ZOC_EXTRA_COST = 4;

// --- Seefahrt -------------------------------------------------------------
// An army takes ship in one of its own coastal settlements. At sea it travels
// further than on foot, but it fights badly: rowing benches are no battle
// line, and troops wading ashore meet a prepared enemy.
// Was die Überfahrt eines Landheeres kostet: gecharterte Transporter.
export const SHIP_COST = 250;
// Ein Heer fährt nicht auf seinen Kriegsschiffen - die Ruderbänke sind besetzt,
// und wer rudert, kämpft nicht. Es geht auf Transportschiffen an Bord: breite,
// bauchige Segler ohne Rammsporn, wie sie sonst Getreide und Öl fahren. Wie
// viele es sind, sagt die Stärke des Heeres; fünfzig Mann samt Gepäck gehen
// auf einen Rumpf.
export const TRANSPORT_NAME = 'Transportschiff';
export const TRANSPORT_CAPACITY = 50;

// Wie viele Rümpfe dieses Heer braucht.
export function transportCount(men) {
  return Math.max(1, Math.ceil((men || 0) / TRANSPORT_CAPACITY));
}
// Wie viele Schiffe ein Bautrupp umfasst; was sie kosten, sagt die Bauart.
export const WARSHIP_BATCH = 60;
export const NAVAL_MOVEMENT = 30;
export const SEA_MOVE_COST = 2;
// Eine Überfahrt zehrt weniger als ein Marsch - gerudert wird in Schichten -,
// aber eine volle Fahrt über 30 Punkte setzt der Mannschaft trotzdem zu.
export const EXHAUSTION_PER_SEA_MOVE = 0.6;
// Attacking straight off the ships.
export const AMPHIBIOUS_ATTACK_MULTIPLIER = 0.7;
// Auf einer Ruderbank ist ein Fußsoldat kein Fußsoldat: zur See zählt nur,
// was das Schiff kann. Landtruppen an Bord kämpfen deshalb stark gemindert,
// Bogenschützen noch am ehesten - sie können vom Deck aus schießen.
export const SEA_UNIT_SCALE = { infantry: 0.5, cavalry: 0.4, ranged: 0.8 };

// How many times a battle is played through for the forecast. Enough for a
// stable percentage, cheap enough to run on every click.
export const BATTLE_PREVIEW_SAMPLES = 60;

// --- Unabhängige Orte ------------------------------------------------------
// Eine Stadt, die keinem Staat gehört, ist nicht wehrlos: aus ihrer Wache
// bildet sich mit der Zeit eine Miliz. Nimmt die einem Staat einen Ort ab,
// rufen die Unabhängigen der Gegend ein eigenes Gemeinwesen aus - aus zwei
// Orten und einem Heer wird eine Fraktion, die von da an mitspielt.
// Nicht gleich in der ersten Runde: die Eröffnung gehört den zwölf Staaten.
export const MILITIA_FIRST_TURN = 10;
export const MILITIA_MIN_POPULATION = 800;
// Wie wahrscheinlich es ist, dass ein Ort in einer Runde eine Miliz aufstellt.
export const MILITIA_CHANCE = 0.022;
// Wie viele Milizen gleichzeitig unterwegs sein dürfen. Mehr wären keine
// Unabhängigen mehr, sondern ein dreizehnter Krieg.
export const MILITIA_MAX = 4;
// Eine Miliz ist in erster Linie bewaffnete Bürgerschaft; die Stadtwache gibt
// nur den Kern dazu und behält eine Reserve auf der Mauer.
export const MILITIA_PER_POPULATION = 12;
export const MILITIA_MIN_SIZE = 60;
export const MILITIA_MAX_SIZE = 280;
export const MILITIA_WATCH_SHARE = 0.4;
export const MILITIA_WATCH_RESERVE = 40;
// So viele freie Staaten können höchstens entstehen.
export const FREE_STATE_MAX = 2;

// Ein freier Staat heißt nach dem Ort, aus dem er sich erhebt - den Namen
// bringt er selbst mit. Aus dieser Liste kommt nur noch die Farbe, unter der
// er auf der Karte steht.
export const FREE_STATE_NAMES = [
  { name: 'Mauren', color: '#b06a3a' },
  { name: 'Thraker', color: '#7d4a8c' },
  { name: 'Ligurer', color: '#4f8a7a' },
  { name: 'Lusitaner', color: '#a8603c' },
  { name: 'Boier', color: '#6b8c3a' },
  { name: 'Veneter', color: '#3f7d9c' },
  { name: 'Bithynier', color: '#9c7b2f' },
  { name: 'Kappadokier', color: '#a0503f' },
  { name: 'Nabatäer', color: '#c2a24a' },
  { name: 'Pannonier', color: '#6a5b9c' },
  { name: 'Räter', color: '#8a8f5a' },
  { name: 'Aquitanier', color: '#4a6f9c' },
];

export const STARTING_GOLD = 500;
// Die Schatzkammer lebt von den Menschen, nicht von den Mauern: ein Ort wirft
// nichts dafür ab, dass es ihn gibt, sondern nur für die, die in ihm wohnen.
// Ein Gold je achtzig Einwohner und Runde - eine Große Stadt trägt damit
// achtzig, ein Dorf siebzehn, und wer seine Orte wachsen lässt, verdient
// daran. Vorher gab es dieselbe Abgabe je Ort, gleich wie viele darin lebten.
export const TAX_PER_INHABITANTS = 80;

// Was ein Ort an Steuer abwirft.
export function cityTax(population) {
  return Math.floor((population || 0) / TAX_PER_INHABITANTS);
}
// One garrison soldier is supportable per this many inhabitants, before a
// faction's own levy tradition is taken into account.
export const GARRISON_POP_RATIO = 8;

export function factionGarrisonFactor(faction) {
  return (faction && faction.garrisonFactor) || 1;
}

// How large a garrison a settlement can hold and feed.
export function garrisonCapacity(city, faction) {
  // Das Viadukt bringt das Wasser, an dem eine große Besatzung sonst scheitert.
  const wasser = city.viaduct ? 1 + VIADUCT_GARRISON : 1;
  return Math.floor((city.population / GARRISON_POP_RATIO)
    * factionGarrisonFactor(faction) * wasser);
}
export const RECRUIT_BATCH = 100;

// --- Was eine Aushebung den Ort kostet -------------------------------------
// Ein Soldat kommt nicht aus der Schatzkammer, sondern aus der Stadt: wer
// hundert Mann unter die Waffen stellt, hat hundert Bauern, Handwerker und
// Steuerzahler weniger - Mann für Mann. Das ist die zweite Rechnung neben dem
// Gold, und die härtere: Einwohner wachsen mit 0,35 % je Runde nach, Gold
// kommt jede Runde neu herein. Wer ohne Maß aushebt, hat bald ein großes Heer
// und ein leeres Land - weniger Steuer, weniger Nachwuchs und eine kleinere
// Wache, denn auch die stellt sich aus den Einwohnern nach.
// Gemessen über 120 Runden hält das die Karte im Gleichgewicht: die
// Gesamtbevölkerung steht die erste Hälfte still und wächst danach wieder.
export const RECRUIT_POP_SHARE = 1;
// Unter diese Grenze hebt niemand aus: ein Ort, aus dem der letzte Mann geht,
// ist kein Ort mehr.
export const RECRUIT_MIN_POPULATION = 300;

export function recruitPopCost(count = RECRUIT_BATCH) {
  return Math.round(count * RECRUIT_POP_SHARE);
}

// --- Die Ausbildung --------------------------------------------------------
// Eine Aushebung war bisher ein Kauf: Gold hin, hundert Mann her, in derselben
// Runde in der Wache und in der nächsten schon im Feld. Wer Gold hatte, hatte
// binnen drei Runden ein Heer, und die einzige Grenze war die Truhe. Ein
// Legionär entsteht aber nicht auf dem Markt, sondern auf dem Exerzierplatz.
//
// Zwei Bremsen greifen jetzt ineinander. Die erste ist die **Zeit**: was
// ausgehoben wird, geht in die Ausbildung und steht erst nach einigen Runden
// in der Wache. Die zweite ist der **Platz**: eine Kaserne bildet nur eine
// begrenzte Zahl Trupps gleichzeitig aus - und damit lässt sich je Runde auch
// nur so oft ausheben, wie ein Platz frei wird.
//
// Wie lange, hängt an der Waffengattung. Ein Bauer bekommt in zwei Runden
// Schild und Speer in die Hand; ein Bogenschütze muss treffen lernen; ein
// Reiter muss erst ein Pferd haben und dann darauf kämpfen können.
export const TRAINING_TURNS = { infantry: 2, ranged: 3, cavalry: 4 };
export const TRAINING_DEFAULT_TURNS = 2;

export function trainingTurns(role) {
  return TRAINING_TURNS[role] || TRAINING_DEFAULT_TURNS;
}

// Wie viele Trupps ein Ort gleichzeitig ausbilden kann. Ein Dorf hat einen
// Platz, eine Stadt zwei, eine Große Stadt drei - der Rang des Ortes ist die
// Größe seines Exerzierplatzes.
export const TRAINING_SLOTS = { large: 3, city: 2, village: 1 };
export const TRAINING_SLOTS_DEFAULT = 1;

export function trainingSlots(city) {
  return TRAINING_SLOTS[city && city.size] || TRAINING_SLOTS_DEFAULT;
}

// Wer eine Ausbildung abbricht, bekommt diesen Anteil des Goldes zurück - die
// Männer sind ohnehin schon aus der Stadt heraus und kehren nicht zurück.
export const TRAINING_REFUND = 0.5;
