import {
  TILE_TYPES, settlementTier, WALL_LEVELS, experienceStars, shipTypeOf, tileImpassable,
  MINE_RANGE, MINE_ORE, MINE_MIN_ORE, roadLevelOf,
} from './data.js';
import { unitTotalCount, factionById, harbourTile, isFleet, playerFaction } from './state.js';
import { atWar } from './diplomacy.js';
import { seaLane } from './actions.js';
import { territoryMap, claimableTile } from './territory.js';
import { emblemSVG } from './emblems.js';
import { climateBand } from './weather.js';
import { latOfRow } from './geodata.js';

export const TILE_SIZE = 6;
const ELEV_SCALE = 2.9;

let renderer, scene, camera;
let canvasEl;
let mapCols = 0;
let mapRows = 0;

// The camera orbits its target: azimuth turns it around the map, polar is the
// tilt above the horizon. The defaults reproduce the original fixed isometric
// direction (1, 1.05, 1).
const DEFAULT_AZIMUTH = Math.PI / 4;
const DEFAULT_POLAR = Math.atan2(1.05, Math.SQRT2);
const MIN_POLAR = 0.25;
const MAX_POLAR = 1.35;

const cam = { col: 0, row: 0, zoom: 1, azimuth: DEFAULT_AZIMUTH, polar: DEFAULT_POLAR };
const BASE_DISTANCE = 235;
// Das Zelt muss die Kamera umschließen, auch ganz herausgezoomt - deshalb
// hängen Zeltmaß und kleinster Zoom zusammen.
const MIN_ZOOM = 0.62;
const MAX_ZOOM = 4.5;
// Weit genug, dass die Kamera auch ganz herausgezoomt unter dem Tuch bleibt.
// Das Zelt muss den Kartentisch samt der Kamera fassen, die um ihn herumläuft:
// halbe Tischdiagonale plus der größte Kameraabstand, sonst stünde der Blick
// bei weit herausgezogener Sicht auf einmal draußen.
const TENT_RADIUS = 820;
const TENT_HEIGHT = 680;
const TENT_WALL = 170;
// So weit bleibt die Kamera von den Zeltbahnen weg.
const TENT_CAMERA_MARGIN = 60;

let terrainMesh = null;
let waterMesh = null;
let deepSeaMesh = null;
// Der Rand der Karte ist kein Meer, sondern das Blatt, auf dem sie liegt:
// vier Streifen zwischen dem letzten Feld und dem Rahmen.
let paperMesh = null;
const PAPER_COLOR = '#d9c69b';
let currentMap = null;
// Wo Straßen liegen - die Bauwerke im Umland weichen ihnen aus.
let currentRoads = {};
let propsGroup = null;
let roadsGroup = null;
let tableGroup = null;
let tentGroup = null;
let ambientLight = null;
let sunLight = null;

// The map is drawn either as the ground it is or as the political picture the
// player needs to plan: same relief, same tiles, different question answered.
let mapMode = 'terrain';
let terrainColors = null;
let tacticalColors = null;
let noiseTexture = null;

// Armies march tile by tile instead of teleporting. While an army is animating
// it owns its own position, so syncEntities must not snap it to the state's
// (already updated) destination, and must not despatch a group whose army was
// destroyed until it has finished walking up to the fight.
const armyAnimations = new Map();
const effects = [];
const completionQueue = [];
let animationFrameId = null;
const MARCH_TILES_PER_SECOND = 4.2;
// A multiplier the player sets; zero means the army is simply there.
let marchSpeedFactor = 1;

export function setMarchSpeed(factor) {
  marchSpeedFactor = Math.max(0, factor);
}

// --- Geteiltes Baumaterial -------------------------------------------------
// Manche Materialien und Texturen gehören nicht einem Bauwerk, sondern dem
// Modul: das dunkle Tischholz trägt Tisch, Zeltstangen und Zelttor zugleich,
// die Wappen hängen an Stadtfahne, Heeresfahne und Zeltbahn, und beide werden
// einmal angelegt und von jedem Feldzug weiterbenutzt.
//
// Wer eine Gruppe abräumt, muss sie deshalb stehen lassen. `dispose()` auf ein
// geteiltes Material zieht es allen anderen Meshes unter den Füßen weg: was
// three.js danach zeichnet, muss es sich neu übersetzen - ausgerechnet in dem
// Augenblick, in dem der Umbau hinter der Schwarzblende ruckelfrei sein soll.
// Diese Marke sagt: das hier gehört dir nicht, lass die Finger davon.
function geteilt(betriebsmittel) {
  betriebsmittel.userData.geteilt = true;
  return betriebsmittel;
}

function geteilteSammlung(sammlung) {
  for (const stueck of Object.values(sammlung)) geteilt(stueck);
  return sammlung;
}

const cityGroups = new Map(); // cityId -> { group, roof, flag, label }
const armyGroups = new Map(); // armyId -> THREE.Group
const highlightMeshes = [];
let selectionRing = null;

function worldX(col) {
  return (col - mapCols / 2) * TILE_SIZE;
}
function worldZ(row) {
  return (row - mapRows / 2) * TILE_SIZE;
}
function colFromWorldX(x) {
  return Math.round(x / TILE_SIZE + mapCols / 2);
}
function rowFromWorldZ(z) {
  return Math.round(z / TILE_SIZE + mapRows / 2);
}
function tileTopY(elevation) {
  return elevation * ELEV_SCALE;
}

// The sea is drawn as its own plane slightly above the sunken water tiles, so
// anything afloat has to sit on that plane rather than on the sea bed.
const SEA_LEVEL_Y = TILE_TYPES.water.elevation * ELEV_SCALE + 0.3;

// Die Höhe des Geländes an einer beliebigen Stelle - auch zwischen zwei
// Feldmitten. Das Gelände ist ein Netz aus Dreiecken, und genau dieselbe
// Dreiecksteilung wird hier nachgerechnet: sonst schwebt oder versinkt alles,
// was nicht genau auf einer Feldmitte steht - Bäume, Berge, eine marschierende
// Armee zwischen zwei Feldern.
function groundY(colF, rowF) {
  if (!currentMap) return 0;
  const { cols, rows, tiles } = currentMap;
  const c = Math.max(0, Math.min(cols - 2, Math.floor(colF)));
  const r = Math.max(0, Math.min(rows - 2, Math.floor(rowF)));
  const u = Math.max(0, Math.min(1, colF - c));
  const v = Math.max(0, Math.min(1, rowF - r));
  const h = (dc, dr) => tileTopY(tiles[r + dr][c + dc].elevation);
  // Die Quads sind entlang der Diagonale von (1,0) nach (0,1) geteilt.
  if (u + v <= 1) {
    const a = h(0, 0);
    return a + (h(1, 0) - a) * u + (h(0, 1) - a) * v;
  }
  const d = h(1, 1);
  return d + (h(1, 0) - d) * (1 - v) + (h(0, 1) - d) * (1 - u);
}

// The height an army, fleet or town actually stands at on a given tile.
// Waypoints may sit between tile centres (a repelled army lunges partway into
// the defender's tile), which is why the ground is sampled, not looked up.
function surfaceY(col, row) {
  if (!currentMap) return 0;
  const c = Math.max(0, Math.min(currentMap.cols - 1, Math.round(col)));
  const r = Math.max(0, Math.min(currentMap.rows - 1, Math.round(row)));
  if (currentMap.tiles[r][c].type === 'water') return SEA_LEVEL_Y;
  return groundY(col, row);
}

function makeLabelSprite(text, opts = {}) {
  const { fontSize = 46, color = '#ffffff', stroke = 'rgba(0,0,0,0.85)', scale = 1 } = opts;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `bold ${fontSize}px Georgia, serif`;
  const width = Math.ceil(ctx.measureText(text).width) + 24;
  canvas.width = width;
  canvas.height = fontSize + 24;
  ctx.font = `bold ${fontSize}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  const worldHeight = 2.6 * scale;
  sprite.scale.set((canvas.width / canvas.height) * worldHeight, worldHeight, 1);
  sprite.renderOrder = 10;
  return sprite;
}

const SKY_COLOR = '#bcd8ec';

export function initScene(canvas) {
  canvasEl = canvas;
  // Jede Partie baut eine neue Szene. Die Liste der Fahnen hängt am Modul und
  // müsste sonst noch die Banner der vorigen Partie ausrichten.
  billboards.length = 0;
  // Dasselbe gilt für die Ort- und Heeresgruppen: sie merken sich ihr
  // Objekt, um es nicht jede Runde neu zu bauen, und legen es deshalb nur an,
  // wenn noch keins in der Liste steht. Ohne diese Zeilen hielt die Liste die
  // Gruppen der vorigen Partie fest - sie hingen dann noch an der alten,
  // verworfenen Szene und wurden nie wieder zur neuen hinzugefügt: Orte und
  // Heere verschwanden beim Fortsetzen oder bei einer zweiten Partie
  // vollständig von der Karte, obwohl ihre Daten noch da waren.
  cityGroups.clear();
  armyGroups.clear();
  armyAnimations.clear();
  // Die verworfene Szene muss auch abgeräumt werden, nicht nur losgelassen:
  // Gelände, Requisiten, Straßen, Tisch, Orte und Heere liegen als Puffer auf
  // der Grafikkarte, und die gibt sie erst auf Geheiß wieder her. Eine zweite
  // Partie in derselben Sitzung legte sonst den ganzen Bestand der ersten
  // stillschweigend beiseite und baute daneben einen neuen auf.
  disposeGroup(scene);
  if (noiseTexture) noiseTexture.dispose();
  noiseTexture = null;
  terrainMesh = waterMesh = deepSeaMesh = paperMesh = null;
  tableGroup = tentGroup = propsGroup = roadsGroup = null;
  highlightMeshes.length = 0;
  // Der alte Renderer hält seine übersetzten Programme fest. Die Zeichenfläche
  // ist dieselbe und behält ihren Grafikkontext - abgeräumt wird deshalb vor
  // dem neuen Renderer, damit der sich seine Programme frisch anlegt.
  if (renderer) renderer.dispose();
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  // Für das Wetter: Regen und Schnee werden an der Tischkante beschnitten,
  // sonst fielen sie auch vor den Zeltbahnen herunter.
  renderer.localClippingEnabled = true;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(SKY_COLOR, BASE_DISTANCE * 2.6, BASE_DISTANCE * 8);

  camera = new THREE.PerspectiveCamera(40, 1, 0.5, 3000);

  ambientLight = new THREE.AmbientLight('#ffffff', 0.65);
  scene.add(ambientLight);
  sunLight = new THREE.DirectionalLight('#fff3d2', 1.05);
  sunLight.position.set(140, 220, 90);
  scene.add(sunLight);
}

function cameraDirection() {
  const horizontal = Math.cos(cam.polar);
  return new THREE.Vector3(
    Math.cos(cam.azimuth) * horizontal,
    Math.sin(cam.polar),
    Math.sin(cam.azimuth) * horizontal
  );
}

// Der Feldherr bleibt in seinem Zelt. Der Blick darf über die ganze Karte
// wandern, aber die Kamera nicht durch die Zeltbahnen: käme sie hinaus, wird
// der Blickpunkt so weit zurückgezogen, dass sie drinnen bleibt.
function keepCameraInsideTent() {
  if (!mapCols) return;
  // Erst bleibt der Blick über dem Tisch: von der Karte herunterzufahren hieße,
  // im leeren Zelt zu stehen und die Karte zu suchen.
  cam.col = Math.max(0, Math.min(mapCols - 1, cam.col));
  cam.row = Math.max(0, Math.min(mapRows - 1, cam.row));
  const direction = cameraDirection();
  const distance = BASE_DISTANCE / cam.zoom;
  const targetX = worldX(cam.col);
  const targetZ = worldZ(cam.row);
  const x = targetX + direction.x * distance;
  const z = targetZ + direction.z * distance;
  const radius = Math.hypot(x, z);
  const limit = TENT_RADIUS - TENT_CAMERA_MARGIN;
  if (radius <= limit) return;
  const pull = radius - limit;
  cam.col = (targetX - (x / radius) * pull) / TILE_SIZE + mapCols / 2;
  cam.row = (targetZ - (z / radius) * pull) / TILE_SIZE + mapRows / 2;
}

function applyCamera() {
  keepCameraInsideTent();
  updateWeatherForCamera();
  alignBillboards();
  const dist = BASE_DISTANCE / cam.zoom;
  const target = new THREE.Vector3(worldX(cam.col), 0, worldZ(cam.row));
  camera.position.copy(target).addScaledVector(cameraDirection(), dist);
  camera.lookAt(target);
  camera.up.set(0, 1, 0);
  camera.updateProjectionMatrix();
}

// Wo Norden auf dem Bildschirm liegt: der Winkel, um den eine Nadel aus der
// Senkrechten im Uhrzeigersinn gedreht werden muss, damit sie nach Norden
// zeigt. Norden ist -z; die Blickrichtung der Kamera steht in `cam.azimuth`.
// Dieselbe Rechnung dreht auch die Fahnentücher zur Kamera.
export function northOnScreen() {
  return Math.atan2(Math.cos(cam.azimuth), Math.sin(cam.azimuth));
}

export function rotateCamera(deltaAzimuth, deltaPolar = 0) {
  cam.azimuth += deltaAzimuth;
  cam.polar = Math.max(MIN_POLAR, Math.min(MAX_POLAR, cam.polar + deltaPolar));
  applyCamera();
}

// Die Eröffnung: der Blick, mit dem ein Feldzug beginnt. Die Kamera steht tief
// und weit hinten in der Mitte des Zelts, sodass der ganze Kartentisch im Bild
// liegt und dahinter der Thron mit den Feldzeichen. Erst wenn der Spieler die
// Ansprache wegklickt, geht es hinunter auf die Karte.
// Weiter draußen als der Spieler von Hand zoomen kann: nur so liegt der ganze
// Tisch im Bild und der Thron noch dahinter.
const OPENING_ZOOM = 0.55;
const OPENING_POLAR = 0.35;

export function setOpeningView() {
  cam.col = mapCols / 2;
  // Ein Stück in Richtung des Betrachters, damit der vordere Rand des Tisches
  // nicht aus dem Bild läuft.
  cam.row = mapRows / 2 + 2;
  cam.azimuth = DEFAULT_AZIMUTH;
  cam.polar = OPENING_POLAR;
  cam.zoom = OPENING_ZOOM;
  applyCamera();
}

// Zurück zur Ausgangsansicht: Blickwinkel, Neigung und Zoom wie beim Aufbau.
// Wohin die Kamera dabei blickt, entscheidet der Aufrufer - im Spiel ist das
// die eigene Hauptstadt.
export function resetCameraOrientation() {
  cam.azimuth = DEFAULT_AZIMUTH;
  cam.polar = DEFAULT_POLAR;
  cam.zoom = 1;
  applyCamera();
}

// Screen-relative panning: with a rotated camera, "up" on the D-pad has to
// mean away from the viewer, not north on the tile grid.
export function panCameraRelative(right, forward) {
  const sin = Math.sin(cam.azimuth);
  const cos = Math.cos(cam.azimuth);
  cam.col += right * sin + forward * cos;
  cam.row += -right * cos + forward * sin;
  applyCamera();
}

// Freies Verschieben mit gedrücktem Mausrad: Pixel werden in Weltmaß
// umgerechnet, damit die Karte unter dem Zeiger bleibt - nah herangezoomt
// bewegt derselbe Weg entsprechend weniger.
export function panCameraByScreen(dxPixels, dyPixels, viewHeightPx) {
  if (!camera || !viewHeightPx) return;
  const dist = BASE_DISTANCE / cam.zoom;
  const worldPerPixel = (2 * dist * Math.tan((camera.fov * Math.PI) / 360)) / viewHeightPx;
  // Die Kamera blickt schräg von oben: was am Bildschirm senkrecht ist, liegt
  // am Boden flacher, je flacher der Blickwinkel.
  const forwardScale = 1 / Math.max(0.35, Math.sin(cam.polar));
  panCameraRelative(
    (-dxPixels * worldPerPixel) / TILE_SIZE,
    (dyPixels * worldPerPixel * forwardScale) / TILE_SIZE
  );
}

export function resize(width, height) {
  if (!renderer) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  applyCamera();
}


export function panCameraByWorld(dx, dz) {
  cam.col += dx / TILE_SIZE;
  cam.row += dz / TILE_SIZE;
  applyCamera();
}

// Intersects the ray through the given NDC point with the y=planeY ground
// plane. Used for "grab the map and drag" panning, independent of terrain.
export function groundPointAt(ndcX, ndcY, planeY = 0) {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
  const point = new THREE.Vector3();
  return raycaster.ray.intersectPlane(plane, point) ? point : null;
}

export function centerOn(col, row) {
  cam.col = col;
  cam.row = row;
  applyCamera();
}

export function zoomCamera(factor) {
  cam.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom * factor));
  applyCamera();
}

export function cameraState() {
  return { col: cam.col, row: cam.row, zoom: cam.zoom, polar: cam.polar, azimuth: cam.azimuth };
}

// Der Blick springt nicht zur Schlacht, er zieht dorthin: ein weicher Schwenk
// über `duration` Sekunden, danach `onComplete` - so setzt der Zusammenprall
// erst ein, wenn die Kamera wirklich angekommen ist, statt mitten im Schwenk.
// `zoom` ist das Ziel selbst, kein Vielfaches wie bei `zoomCamera`. Anders als
// dort wird nach oben nicht auf `MAX_ZOOM` gedeckelt - der Schwenk zu einer
// Schlacht darf näher heran, als der Spieler von Hand kommt, genau wie die
// Eröffnung weiter hinaus darf, als er selbst zoomen könnte.
// `polar` ist optional: bleibt er aus, ändert der Schwenk nur Ort und Zoom,
// nicht die Neigung - so nutzt ihn jeder Aufrufer außer der Schlacht selbst.
// `azimuth` ebenso: bleibt er aus, dreht sich der Blickwinkel nicht mit - nur
// die Schlacht selbst schwenkt auch die Ausrichtung, auf kürzestem Dreh statt
// einmal ganz herum.
export function flyCameraTo(col, row, zoom, duration = 0.6, onComplete, polar, azimuth) {
  const startCol = cam.col;
  const startRow = cam.row;
  const startZoom = cam.zoom;
  const startPolar = cam.polar;
  const startAzimuth = cam.azimuth;
  const zielZoom = Math.max(MIN_ZOOM, zoom);
  const zielPolar = polar === undefined
    ? startPolar : Math.max(MIN_POLAR, Math.min(MAX_POLAR, polar));
  // Kürzester Weg: nie mehr als eine halbe Drehung, sonst schwenkte die Kamera
  // bei einem Ziel knapp jenseits von Nord einmal fast ganz herum.
  let azimuthDelta = 0;
  if (azimuth !== undefined) {
    azimuthDelta = azimuth - startAzimuth;
    while (azimuthDelta > Math.PI) azimuthDelta -= Math.PI * 2;
    while (azimuthDelta < -Math.PI) azimuthDelta += Math.PI * 2;
  }
  effects.push({
    elapsed: 0,
    duration,
    onComplete,
    update(t) {
      // Schnell los, weich am Ziel - kein hartes Anschlagen des Schwenks.
      const eased = 1 - (1 - Math.min(1, t)) ** 3;
      cam.col = startCol + (col - startCol) * eased;
      cam.row = startRow + (row - startRow) * eased;
      cam.zoom = startZoom + (zielZoom - startZoom) * eased;
      cam.polar = startPolar + (zielPolar - startPolar) * eased;
      if (azimuth !== undefined) cam.azimuth = startAzimuth + azimuthDelta * eased;
      applyCamera();
    },
    dispose() {},
  });
  startAnimationLoop();
}

// Baumarten je Klimazone: dieselben vier Bänder wie beim Wetter (weather.js) -
// im Norden Fichten, in der Mitte Laubbäume, am Mittelmeer Zypressen, im
// Wüstengürtel Palmen. Jede Art hat ihre eigene Stamm- und Kronengeometrie,
// aber bleibt im Maßstab der Häuser: ein Baum ist etwa doppelt so hoch wie ein
// Haus, nicht höher als ein ganzes Dorf (siehe TREE_HEIGHT weiter unten -
// hier absichtlich als Zahl wiederholt, weil diese Tabelle vor ihrer
// Definition im Quelltext steht).
const TREE_H = 2.2;

// Der Wedelschopf einer Palme: sieben Wedel, die vom selben Punkt ausgehen
// und schräg nach außen und unten hängen - eine einzige, feste Geometrie wie
// beim Erzhaufen, damit sie sich weiter über InstancedMesh zeichnen lässt.
// Jeder Wedel ist ein spitz zulaufender Kegel (Rautenquerschnitt) statt einer
// flachen Platte: eine dünne Platte verschwindet aus manchen Blickwinkeln
// fast vollständig, weil die Kamera meist aus einem festen Winkel auf die
// Karte schaut - ein Körper mit echtem Volumen bleibt aus jeder Richtung
// sichtbar.
function frondClusterGeometry() {
  const wedel = new THREE.ConeGeometry(0.2, 1, 4, 1);
  wedel.translate(0, 0.5, 0);
  const zahl = 7;
  const teile = [];
  for (let i = 0; i < zahl; i++) {
    // Reihenfolge wichtig: bei THREE.Euler steht die y-Drehung (Blickrichtung
    // rundherum) in der Mitte der Verkettung und bliebe wirkungslos, würde
    // sie auf einen bereits senkrecht gekippten Wedel angewandt (die
    // y-Achse dreht sich nicht um sich selbst). Deshalb kippt hier die
    // z-Drehung den Wedel zuerst zur Seite, danach verteilt die y-Drehung
    // die Wedel rundherum.
    teile.push(shapePart(wedel, 0, 0, 0, 0, (i / zahl) * Math.PI * 2, 2.15, 1, TREE_H * 0.5, 1));
  }
  const g = mergeShapes(teile);
  wedel.dispose();
  return g;
}

const TREE_KINDS = {
  nord: {
    trunk: () => new THREE.CylinderGeometry(0.08, 0.12, TREE_H * 0.30, 6),
    leaf: () => new THREE.ConeGeometry(TREE_H * 0.20, TREE_H * 0.95, 7),
    trunkColor: '#5b3a22', leafColor: '#2b5c33',
    trunkY: (TREE_H * 0.30) / 2,
    leafY: TREE_H * 0.30 + (TREE_H * 0.95) * 0.47,
  },
  mitte: {
    trunk: () => new THREE.CylinderGeometry(0.11, 0.16, TREE_H * 0.34, 6),
    leaf: () => new THREE.IcosahedronGeometry(TREE_H * 0.30, 0),
    trunkColor: '#5b3a22', leafColor: '#4f8a3a', leafFlat: true,
    trunkY: (TREE_H * 0.34) / 2,
    leafY: (TREE_H * 0.34) * 0.8 + TREE_H * 0.30,
  },
  sued: {
    trunk: () => new THREE.CylinderGeometry(0.055, 0.08, TREE_H * 0.16, 6),
    leaf: () => new THREE.ConeGeometry(TREE_H * 0.125, TREE_H * 1.25, 6),
    trunkColor: '#5b3a22', leafColor: '#2d5a45',
    trunkY: (TREE_H * 0.16) / 2,
    leafY: (TREE_H * 0.16) * 0.3 + (TREE_H * 1.25) / 2,
  },
  wueste: {
    trunk: () => new THREE.CylinderGeometry(0.07, 0.10, TREE_H * 0.85, 6),
    leaf: () => frondClusterGeometry(),
    trunkColor: '#8a6b3d', leafColor: '#7a9c4a',
    trunkY: (TREE_H * 0.85) / 2,
    leafY: (TREE_H * 0.85) * 0.94,
  },
};

// Props are collected as plain transforms first and drawn as instanced meshes
// afterwards. On a map this size there are thousands of them, and one draw
// call per tree would cost more than everything else on screen put together.
function collectTree(props, col, row, rng, streuung = 0.4) {
  const jx = (rng() - 0.5) * streuung;
  const jz = (rng() - 0.5) * streuung;
  const scale = 0.8 + rng() * 0.5;
  // Auf dem Boden dort, wo der Baum wirklich steht - nicht auf der Höhe der
  // Feldmitte, die am Hang mehrere Meter daneben liegt.
  const topY = groundY(col + jx, row + jz) - 0.1;
  const x = worldX(col) + jx * TILE_SIZE;
  const z = worldZ(row) + jz * TILE_SIZE;
  // Welche Art hier steht, entscheidet die Klimazone, nicht der Zufall.
  const kind = climateBand(latOfRow(row)).key;
  const def = TREE_KINDS[kind];
  props.trunks[kind].push({ x, y: topY + def.trunkY * scale, z, s: scale, r: 0 });
  props.leaves[kind].push({ x, y: topY + def.leafY * scale, z, s: scale, r: rng() * Math.PI });
}

// Peaks scale with how high the underlying crest already is, so a tile on the
// spine grows a tall cluster while a saddle only gets low rocks - the range
// then reads as a varied silhouette rather than a row of identical cones.
function collectPeak(props, col, row, elevation, rng) {
  const prominence = Math.min(1, Math.max(0, (elevation - 1.2) / 1.9));
  const count = 1 + Math.floor(rng() * 2 + prominence * 1.6);

  for (let i = 0; i < count; i++) {
    const jx = (rng() - 0.5) * 0.75;
    const jz = (rng() - 0.5) * 0.75;
    // Die Höhe trägt der Berg selbst - der Kegel ist nur seine Spitze und
    // steht im selben Maßstab wie alles andere.
    const height = (0.8 + prominence * 2.1) * (0.55 + rng() * 0.75);
    const snowy = prominence > 0.55 && rng() < 0.55 + prominence * 0.4;
    // Der Fuß des Kegels steckt ein Stück im Hang: am Rand eines Gebirgsfelds
    // fällt das Gelände steil ab, und ein Kegel auf der Höhe der Feldmitte
    // stünde dort in der Luft.
    const base = groundY(col + jx, row + jz) - height * 0.18;
    (snowy ? props.snowPeaks : props.rockPeaks).push({
      x: worldX(col) + jx * TILE_SIZE,
      y: base + height / 2,
      z: worldZ(row) + jz * TILE_SIZE,
      s: height,
      r: rng() * Math.PI * 2,
    });
  }
}

function addInstanced(geometry, material, transforms) {
  if (!transforms.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  transforms.forEach((t, i) => {
    position.set(t.x, t.y, t.z);
    quaternion.setFromAxisAngle(axis, t.r);
    scale.setScalar(t.s);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  propsGroup.add(mesh);
  return mesh;
}

// Cones and cylinders are authored at unit height so a single scale puts each
// instance at its own size.
// --- Erzvorkommen ----------------------------------------------------------
// Ein Bergwerk lohnt nur, wo etwas im Berg liegt, und das stand bisher nur als
// Zahl in der Stadtansicht. Jetzt liegt es auf der Karte: dort, wo Erz
// gefördert werden kann, steht ein aufgebrochener Fels mit heller Ader.
//
// Gezeichnet wird nur, was auch zählt - Gebirgs- und Hügelfelder im Umkreis
// eines Orts, dessen Umland zusammen genug hergibt. Alles andere wäre ein Wald
// aus Steinen über die halbe Karte.
function collectOre(state, props) {
  const { cols, rows, tiles } = state.map;
  const felder = new Map();
  for (const city of state.cities) {
    let erz = 0;
    const umland = [];
    for (let dr = -MINE_RANGE; dr <= MINE_RANGE; dr++) {
      for (let dc = -MINE_RANGE; dc <= MINE_RANGE; dc++) {
        const c = city.col + dc;
        const r = city.row + dr;
        if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
        const wert = MINE_ORE[tiles[r][c].type] || 0;
        if (!wert) continue;
        erz += wert;
        umland.push({ c, r, wert });
      }
    }
    if (erz < MINE_MIN_ORE) continue;
    for (const feld of umland) felder.set(`${feld.c},${feld.r}`, feld);
  }
  const rng = seededRandomFactory(23);
  for (const { c, r, wert } of felder.values()) {
    // Etwas neben der Feldmitte, damit der Haufen nicht im Gipfel steckt.
    const jx = (rng() - 0.5) * 0.5;
    const jz = (rng() - 0.5) * 0.5;
    const size = wert >= 2 ? 1.3 : 0.95;
    const y = groundY(c + jx, r + jz);
    // Der Haufen liegt auf dem Boden, nicht halb darin: sein Fuß ist die
    // Nullhöhe der Geometrie.
    props.oreRock.push({
      x: worldX(c) + jx * TILE_SIZE, y, z: worldZ(r) + jz * TILE_SIZE,
      s: size, r: rng() * Math.PI * 2,
    });
    props.oreVein.push({
      x: worldX(c) + jx * TILE_SIZE, y, z: worldZ(r) + jz * TILE_SIZE,
      s: size, r: rng() * Math.PI * 2,
    });
  }
}

// --- Der Erzhaufen ---------------------------------------------------------
// Vorher lag dort ein aufgebrochener Fels mit einer hellen Ader darin - aus
// der Feldherrnperspektive ein Stein wie jeder andere. Gemeint ist das, was
// gefördert wird, und das liegt auf Halde: ein Kegel aus gebrochenem Gestein,
// ein paar größere Brocken daneben, und obenauf glänzt, worauf es ankommt.
function oreHeapGeometry() {
  const kegel = new THREE.ConeGeometry(0.5, 0.42, 7);
  const brocken = new THREE.DodecahedronGeometry(0.16, 0);
  const teile = [shapePart(kegel, 0, 0.21, 0)];
  // Die Brocken liegen am Fuß der Halde, wie herabgerollt.
  const rundum = [
    [0.52, 0.08, 0.1, 1.0], [-0.44, 0.07, 0.34, 0.85], [0.1, 0.07, -0.55, 0.9],
    [-0.2, 0.26, -0.18, 0.7], [0.24, 0.3, 0.14, 0.6],
  ];
  for (const [x, y, z, gross] of rundum) {
    teile.push(shapePart(brocken, x, y, z, 0.4, 0.7, 0.2, gross, gross, gross));
  }
  const g = mergeShapes(teile);
  kegel.dispose();
  brocken.dispose();
  return g;
}

// Was in der Halde glänzt: zwei kantige Stücke obenauf.
function oreNuggetGeometry() {
  const stueck = new THREE.OctahedronGeometry(0.17, 0);
  const g = mergeShapes([
    shapePart(stueck, 0.05, 0.46, -0.04, 0.3, 0.5, 0.2),
    shapePart(stueck, -0.16, 0.32, 0.18, 0.1, 1.1, 0.4, 0.8, 0.8, 0.8),
    shapePart(stueck, 0.3, 0.14, 0.22, 0.6, 0.3, 0.9, 0.7, 0.7, 0.7),
  ]);
  stueck.dispose();
  return g;
}

function buildProps(props) {
  // Die Halde und das, was darauf glänzt.
  addInstanced(
    oreHeapGeometry(),
    new THREE.MeshStandardMaterial({ color: '#6a6157', flatShading: true, roughness: 1 }),
    props.oreRock
  );
  addInstanced(
    oreNuggetGeometry(),
    new THREE.MeshStandardMaterial({
      color: '#d8a441', flatShading: true, roughness: 0.35, metalness: 0.6,
      emissive: '#4a3208', emissiveIntensity: 0.4,
    }),
    props.oreVein
  );
  for (const [kind, def] of Object.entries(TREE_KINDS)) {
    addInstanced(
      def.trunk(),
      new THREE.MeshStandardMaterial({ color: def.trunkColor, roughness: 1 }),
      props.trunks[kind]
    );
    addInstanced(
      def.leaf(),
      new THREE.MeshStandardMaterial({ color: def.leafColor, roughness: 0.9, flatShading: !!def.leafFlat }),
      props.leaves[kind]
    );
  }
  const peakGeometry = new THREE.ConeGeometry(0.5, 1, 6);
  addInstanced(
    peakGeometry,
    new THREE.MeshStandardMaterial({ color: '#9c958a', flatShading: true, roughness: 0.95 }),
    props.rockPeaks
  );
  addInstanced(
    peakGeometry,
    new THREE.MeshStandardMaterial({ color: '#eef1f5', flatShading: true, roughness: 0.9 }),
    props.snowPeaks
  );
}

// --- Was auf der Karte lebt ------------------------------------------------
// Eine Karte, auf der sich nichts rührt als die eigenen Heere, ist ein Plan.
// Was aus ihr eine Welt macht, sind die Dinge, die ohne den Feldherrn
// geschehen: Fischschwärme, die über die Untiefen ziehen, Wale, die weit
// draußen auftauchen und blasen, Möwen über der Küste und Rotwild an den
// Waldrändern.
//
// Nichts davon greift in die Regeln ein - es ist Landschaft. Deshalb ist es
// billig gebaut: je Gattung eine Instanzenwolke, und bewegt wird nur fünfzehnmal
// je Sekunde. Wer es nicht mag, schaltet es in den Einstellungen ab; dann steht
// die Karte still wie zuvor.
const WILDLIFE_STEP = 1 / 15;   // so oft werden die Tiere bewegt
let wildlifeGroup = null;
let wildlifeAkku = 0;
let wildlifeEnabled = true;
// Je Gattung: die Instanzenwolken und die Tiere, die darin stecken.
const wildlife = [];

// Sichtbar ist, was lebt - aber nicht in der taktischen Sicht: dort geht es um
// Grenzen und Heere, und ein Rudel Rotwild sagt darüber nichts.
function zeigeWildlife() {
  if (!wildlifeGroup) return;
  wildlifeGroup.visible = wildlifeEnabled && mapMode !== 'tactical';
}

export function setWildlifeEnabled(flag) {
  wildlifeEnabled = !!flag;
  zeigeWildlife();
  if (wildlifeAlive()) startAnimationLoop();
  else render();
}

export function isWildlifeEnabled() {
  return wildlifeEnabled;
}

// Für die Prüfläufe: wie viele Tiere welcher Gattung auf der Karte stehen.
export function wildlifeProbe() {
  return {
    an: wildlifeEnabled,
    sichtbar: !!(wildlifeGroup && wildlifeGroup.visible),
    gattungen: wildlife.map((g) => ({
      zahl: g.tiere.length,
      blas: !!g.extra,
      // Wo die ersten stehen - damit ein Prüflauf die Kamera dorthin schwenken
      // kann, statt das Meer abzusuchen.
      // Wer einen Weg abfährt - Karren und Handelsschiffe -, hat keine feste
      // Mitte; dann zählt der Anfang seines Wegs.
      wo: g.tiere.slice(0, 3).map((t) => ({
        col: t.weg ? t.weg[0].col : colFromWorldX(t.mx),
        row: t.weg ? t.weg[0].row : rowFromWorldZ(t.mz),
        ueber: t.wo ? +(t.wo.y - SEA_LEVEL_Y).toFixed(2) : null,
        blas: t.blas ? +t.blas.toFixed(2) : 0,
      })),
    })),
  };
}

// Verschmilzt ein paar Teile zu einer Geometrie - vier Zeichenaufrufe je Hirsch
// wären vierhundert für die Karte. Nur Lage und Normale; eine Textur trägt
// keines dieser Tiere.
function mergeShapes(parts) {
  let laenge = 0;
  const fertig = parts.map(({ geometry, matrix }) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    g.applyMatrix4(matrix);
    laenge += g.attributes.position.count * 3;
    return g;
  });
  const lage = new Float32Array(laenge);
  const norm = new Float32Array(laenge);
  let versatz = 0;
  for (const g of fertig) {
    lage.set(g.attributes.position.array, versatz);
    norm.set(g.attributes.normal.array, versatz);
    versatz += g.attributes.position.count * 3;
    g.dispose();
  }
  const ganz = new THREE.BufferGeometry();
  ganz.setAttribute('position', new THREE.Float32BufferAttribute(lage, 3));
  ganz.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  return ganz;
}

function shapePart(geometry, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  matrix.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  return { geometry, matrix };
}

// --- Backen: aus vielen Meshes eines je Material ---------------------------
// Ein Ort wurde aus 60 bis 180 einzelnen Meshes gebaut, jedes mit eigener
// Geometrie - für die Grafikkarte 180 Zeichenaufrufe je Ort, für 107 Orte
// über zehntausend je Bild. Das ist der Grund, warum die Karte auf schwacher
// Hardware zäh war: nicht die Dreiecke, sondern die Zahl der Aufrufe.
//
// Gebacken wird, nachdem alles steht: alle Meshes einer Gruppe werden nach
// Material sortiert und je Material zu einem einzigen Mesh verschmolzen. Was
// sich noch bewegen oder ändern muss, bleibt draußen - die Fahne, die sich mit
// der Kamera dreht; das Schild; die Terrasse, deren Tiefe erst beim Setzen
// feststeht. Die Teile in der Fraktionsfarbe bekommen ein gemeinsames Material,
// damit ein Besitzerwechsel weiterhin nur eine Farbe setzt.
function bakeGroup(group, { keep = new Set(), tinted = null } = {}) {
  group.updateMatrixWorld(true);
  // Gerechnet wird relativ zur Gruppe, nicht in Weltkoordinaten: die Gruppe
  // kann beim Backen schon verschoben und skaliert sein (die Wunder sind es),
  // und ihre eigene Verschiebung darf nicht in die Scheitelpunkte wandern -
  // sonst wird sie beim Zeichnen ein zweites Mal angewandt, und das Modell
  // steht irgendwo, nur nicht dort, wo es hingehört.
  const inGruppe = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const unter = (obj, menge) => {
    for (let o = obj; o; o = o.parent) if (menge.has(o)) return true;
    return false;
  };
  const eimer = new Map();   // Materialschlüssel -> { material, teile: [{geometry, matrix}], quellen }
  const texturiert = (m) => !!(m.map || m.alphaMap || m.emissiveMap || m.normalMap
    || m.roughnessMap || m.bumpMap);
  group.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh || obj.isSprite) return;
    if (obj === group || unter(obj, keep)) return;
    if (Array.isArray(obj.material)) return;
    // Ein Stoff mit Muster braucht seine UV-Koordinaten; die trägt das Backen
    // nicht weiter. Was eine Textur trägt, bleibt ein eigenes Mesh.
    if (texturiert(obj.material)) return;
    const farbig = tinted && tinted.has(obj);
    const key = farbig ? '__tinted' : obj.material.uuid;
    let e = eimer.get(key);
    if (!e) {
      e = { material: farbig ? obj.material.clone() : obj.material, farbig, teile: [], quellen: [] };
      eimer.set(key, e);
    }
    e.teile.push({ geometry: obj.geometry, matrix: new THREE.Matrix4().multiplyMatrices(inGruppe, obj.matrixWorld) });
    e.quellen.push(obj);
  });
  const neueFarbige = [];
  for (const e of eimer.values()) {
    if (!e.teile.length) continue;
    const ganz = mergeShapes(e.teile);
    const mesh = new THREE.Mesh(ganz, e.material);
    group.add(mesh);
    if (e.farbig) neueFarbige.push(mesh);
    for (const q of e.quellen) {
      q.parent.remove(q);
      q.geometry.dispose();
      // Ein Material, das nur diesem einen Teil gehörte, geht mit ihm.
      if (e.farbig) q.material.dispose();
    }
  }
  // Leer gewordene Untergruppen (der Tempel) fliegen mit heraus.
  const leer = [];
  group.traverse((obj) => {
    if (obj !== group && obj.isGroup && !obj.children.length && !unter(obj, keep)) leer.push(obj);
  });
  for (const g of leer) if (g.parent) g.parent.remove(g);
  return neueFarbige;
}


// Ein Anbau - Hafen, Kaserne, Acker, Stollen ... - wird wie ein Ort gebacken.
// Draußen bleibt die Fundamentplatte, weil `placeAt` sie erst beim Setzen an
// das Gelände anpasst, und was sich später ein- und ausschalten lässt (die
// Werft am Hafen, der Speicher am Acker); das wird für sich gebacken.
function bakeFeature(group) {
  const u = group.userData || {};
  const keep = new Set([u.fundament, u.werft, u.speicher].filter(Boolean));
  bakeGroup(group, { keep });
  for (const teil of [u.werft, u.speicher]) if (teil && teil.isGroup) bakeGroup(teil);
  return group;
}

// Ist `obj` ein Nachfahre von `wurzel`?
function stammtAus(wurzel, obj) {
  for (let o = obj; o; o = o.parent) if (o === wurzel) return true;
  return false;
}

// Ein Fisch, wie er von oben aussieht, wenn er dicht unter der Oberfläche
// steht: ein dunkler Rücken und eine Schwanzflosse.
function fishGeometry() {
  const ruecken = new THREE.SphereGeometry(0.3, 6, 4);
  const flosse = new THREE.ConeGeometry(0.16, 0.3, 3);
  const g = mergeShapes([
    shapePart(ruecken, 0, 0, 0, 0, 0, 0, 1.9, 0.5, 0.8),
    shapePart(flosse, -0.62, 0, 0, 0, 0, Math.PI / 2, 1, 1, 0.4),
  ]);
  ruecken.dispose();
  flosse.dispose();
  return g;
}

// Ein Wal: ein langer Rücken und die Fluke. Er ist groß - auf dieser Karte
// misst ein Feld gut fünfzig Kilometer, also ist jedes Tier ohnehin ein
// Sinnbild und kein Maßstab.
function whaleGeometry() {
  const leib = new THREE.SphereGeometry(0.5, 8, 6);
  const fluke = new THREE.ConeGeometry(0.34, 0.6, 3);
  const finne = new THREE.ConeGeometry(0.12, 0.28, 4);
  const g = mergeShapes([
    shapePart(leib, 0, 0, 0, 0, 0, 0, 3.1, 0.72, 1),
    shapePart(fluke, -1.6, 0.02, 0, 0, 0, Math.PI / 2, 1, 1, 0.35),
    shapePart(finne, -0.2, 0.34, 0, 0, 0, 0, 1, 1, 0.5),
  ]);
  leib.dispose();
  fluke.dispose();
  finne.dispose();
  return g;
}

// Der Blas: kein Kegel, sondern ein Busch. Ein Wal bläst nicht einen Strahl,
// sondern einen Strauß feiner Strahlen, die oben auseinandergehen und in
// Tropfen zerfallen - beim Grönlandwal sogar in zwei Bögen. Gebaut wird er
// mit dem Fuß auf der Nullhöhe, damit die Instanz ihn von unten wachsen lässt.
function spoutGeometry() {
  const strahl = new THREE.ConeGeometry(0.12, 1, 5);
  const tropfen = new THREE.SphereGeometry(0.07, 5, 4);
  const teile = [];
  // Zwei Bögen, jeder aus drei Strahlen, die nach außen kippen.
  for (const seite of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const neigung = seite * (0.12 + i * 0.16);
      const hoehe = 0.9 - i * 0.14;
      const dreh = seite * (i - 1) * 0.5;
      teile.push(shapePart(
        strahl,
        Math.sin(neigung) * hoehe * 0.5, hoehe * 0.5, Math.sin(dreh) * hoehe * 0.22,
        dreh * 0.5, 0, neigung,
        0.85 - i * 0.12, hoehe, 0.85 - i * 0.12
      ));
    }
  }
  // Und die Tropfen, die oben davonfliegen.
  for (const [x, y, z] of [[0.4, 0.98, 0.1], [-0.42, 0.92, -0.12], [0.12, 1.08, -0.3],
    [-0.16, 1.02, 0.28]]) {
    teile.push(shapePart(tropfen, x, y, z));
  }
  const g = mergeShapes(teile);
  strahl.dispose();
  tropfen.dispose();
  return g;
}

// Eine Möwe von unten: zwei Flügel und ein Rumpf dazwischen.
// Ein Handelsschiff, wie es zwischen den Häfen fuhr: bauchig, hochbordig, ein
// einziger Mast mit Rahsegel und Fracht an Deck. Kein Rammsporn, keine
// Ruderreihen - man soll es auf den ersten Blick von einer Kriegsflotte
// unterscheiden, die als eigenes Modell auf der Karte steht.
// Rumpf, Deck, Steven, Mast und Fracht - alles aus Holz, also eine Farbe.
function merchantHullGeometry() {
  const rumpf = new THREE.CylinderGeometry(0.34, 0.2, 1.5, 7, 1, false, 0, Math.PI);
  const deck = new THREE.BoxGeometry(1.44, 0.06, 0.6);
  const steven = new THREE.CylinderGeometry(0.04, 0.06, 0.4, 5);
  const mast = new THREE.CylinderGeometry(0.032, 0.045, 0.95, 5);
  const rah = new THREE.BoxGeometry(0.04, 0.04, 0.86);
  const fracht = new THREE.BoxGeometry(0.16, 0.14, 0.16);
  const teile = [
    // Der halbe Zylinder liegt längs: seine Achse zeigt von Haus aus nach oben,
    // eine Vierteldrehung um z legt sie nach vorn, und die offene Hälfte
    // (Theta 0 bis Pi, also die Seite nach +x) zeigt dabei nach unten - die
    // Wölbung des Rumpfs liegt im Wasser, das Deck oben.
    shapePart(rumpf, 0, 0.26, 0, 0, 0, -Math.PI / 2),
    shapePart(deck, 0, 0.24, 0),
    // Vorn und achtern ein hochgezogener Steven.
    shapePart(steven, 0.72, 0.36, 0, 0, 0, 0.35),
    shapePart(steven, -0.72, 0.38, 0, 0, 0, -0.5),
    shapePart(mast, -0.02, 0.72, 0),
    shapePart(rah, -0.02, 1.06, 0),
  ];
  for (const [x, z] of [[0.3, -0.12], [0.32, 0.13], [-0.3, 0.02]]) {
    teile.push(shapePart(fracht, x, 0.34, z));
  }
  const g = mergeShapes(teile);
  rumpf.dispose();
  deck.dispose();
  steven.dispose();
  mast.dispose();
  rah.dispose();
  fracht.dispose();
  return g;
}

// Das Rahsegel als eigene Wolke, damit es hell bleibt: eine Instanzenwolke
// trägt nur eine Farbe, und ein Segel in Rumpfbraun ist kein Segel.
function merchantSailGeometry() {
  const segel = new THREE.BoxGeometry(0.03, 0.52, 0.82);
  // Vor dem Mast, nicht in ihm: ein Rahsegel steht beim Vorwindkurs voraus,
  // und im Mast steckend sähe es aus, als wäre es aufgespießt.
  const g = mergeShapes([shapePart(segel, 0.05, 0.79, 0)]);
  segel.dispose();
  return g;
}

function gullGeometry() {
  const fluegel = new THREE.BoxGeometry(0.12, 0.05, 0.8);
  const leib = new THREE.SphereGeometry(0.13, 5, 4);
  const g = mergeShapes([
    shapePart(fluegel, 0, 0, 0.42, 0.35, 0, 0),
    shapePart(fluegel, 0, 0, -0.42, -0.35, 0, 0),
    shapePart(leib, 0, 0, 0, 0, 0, 0, 2.1, 1, 1),
  ]);
  fluegel.dispose();
  leib.dispose();
  return g;
}

// Rotwild: Leib, vier Läufe, Hals und Kopf. Das Geweih bleibt weg - aus der
// Feldherrnperspektive wäre es ein Pixel, und es kostet Dreiecke.
// Drei Gattungen Wild, und man soll sie auseinanderhalten können: der Hirsch
// zieht allein und trägt ein Geweih, Rehe stehen zu dritt und sind kleiner und
// zierlicher, Wildschweine ebenfalls zu dritt - gedrungen, mit Rüssel,
// Hauern und dem Kamm auf dem Rücken.

// Der gemeinsame Bau: Leib, vier Läufe, Hals, Kopf. Die Maße machen den
// Unterschied.
function huftierTeile({ leibLang, leibHoch, laufLang, halsLang, halsWinkel, kopfGross }) {
  const leib = new THREE.SphereGeometry(0.3, 6, 5);
  const lauf = new THREE.CylinderGeometry(0.05, 0.04, laufLang, 4);
  const hals = new THREE.CylinderGeometry(0.07, 0.09, halsLang, 4);
  const kopf = new THREE.SphereGeometry(0.11, 5, 4);
  const rumpfY = laufLang * 0.5 + 0.31 * leibHoch;
  const teile = [shapePart(leib, 0, rumpfY, 0, 0, 0, 0, leibLang, leibHoch, 0.9)];
  for (const x of [-0.28 * leibLang / 1.6, 0.26 * leibLang / 1.6]) {
    for (const z of [-0.14, 0.14]) teile.push(shapePart(lauf, x, laufLang / 2, z));
  }
  const halsX = 0.26 * leibLang / 1.6 + 0.16;
  const halsY = rumpfY + halsLang * 0.34;
  teile.push(shapePart(hals, halsX, halsY, 0, 0, 0, halsWinkel));
  const kopfX = halsX + Math.sin(-halsWinkel) * halsLang * 0.5;
  const kopfY = halsY + Math.cos(halsWinkel) * halsLang * 0.5;
  teile.push(shapePart(kopf, kopfX, kopfY, 0, 0, 0, 0, 1.5 * kopfGross, kopfGross, kopfGross));
  return {
    teile, kopfX, kopfY, rumpfY, leibLang,
    aufraeumen: () => { leib.dispose(); lauf.dispose(); hals.dispose(); kopf.dispose(); },
  };
}

// Der Hirsch: der größte von den dreien, aufrecht getragener Hals, und über
// dem Kopf das Geweih - zwei Stangen mit je drei Enden.
function stagGeometry() {
  const bau = huftierTeile({
    leibLang: 1.7, leibHoch: 0.92, laufLang: 0.48, halsLang: 0.4,
    halsWinkel: -0.35, kopfGross: 1.05,
  });
  const stange = new THREE.CylinderGeometry(0.022, 0.03, 0.34, 4);
  const ende = new THREE.CylinderGeometry(0.015, 0.02, 0.16, 4);
  for (const z of [-0.07, 0.07]) {
    bau.teile.push(shapePart(stange, bau.kopfX - 0.04, bau.kopfY + 0.19, z, 0, 0, z * 2.4));
    for (const [dx, dy, neig] of [[-0.1, 0.3, 1.0], [0.02, 0.34, 0.2], [0.1, 0.26, -0.8]]) {
      bau.teile.push(shapePart(ende, bau.kopfX - 0.04 + dx, bau.kopfY + dy, z * 1.5, 0, 0, neig));
    }
  }
  const g = mergeShapes(bau.teile);
  bau.aufraeumen();
  stange.dispose();
  ende.dispose();
  return g;
}

// Das Reh: kleiner, feiner, kein Geweih, der Hals beim Äsen nach vorn geneigt.
function roeGeometry() {
  const bau = huftierTeile({
    leibLang: 1.45, leibHoch: 0.78, laufLang: 0.36, halsLang: 0.26,
    halsWinkel: -0.72, kopfGross: 0.85,
  });
  const spiegel = new THREE.SphereGeometry(0.09, 5, 4);
  // Der weiße Spiegel am Hinterteil ist das, woran man ein Reh im Wald erkennt.
  bau.teile.push(shapePart(spiegel, -0.3, bau.rumpfY + 0.04, 0, 0, 0, 0, 0.6, 1, 0.9));
  const g = mergeShapes(bau.teile);
  bau.aufraeumen();
  spiegel.dispose();
  return g;
}

// Das Wildschwein: tief, breit, vorn schwerer als hinten, mit Rüssel, zwei
// Hauern und dem borstigen Kamm über dem Widerrist.
function boarGeometry() {
  const leib = new THREE.SphereGeometry(0.3, 6, 5);
  const lauf = new THREE.CylinderGeometry(0.05, 0.045, 0.26, 4);
  const kopf = new THREE.ConeGeometry(0.19, 0.44, 5);
  const ruessel = new THREE.CylinderGeometry(0.055, 0.07, 0.12, 5);
  const hauer = new THREE.ConeGeometry(0.022, 0.11, 4);
  const kamm = new THREE.ConeGeometry(0.035, 0.13, 4);
  const rumpfY = 0.13 + 0.25;
  const teile = [shapePart(leib, -0.04, rumpfY, 0, 0, 0, 0, 1.5, 0.95, 1.05)];
  for (const x of [-0.26, 0.2]) {
    for (const z of [-0.13, 0.13]) teile.push(shapePart(lauf, x, 0.13, z));
  }
  // Der Kopf sitzt ohne Hals am Rumpf und zeigt nach vorn unten.
  teile.push(shapePart(kopf, 0.36, rumpfY - 0.03, 0, 0, 0, -Math.PI / 2 - 0.25, 1, 1, 0.85));
  teile.push(shapePart(ruessel, 0.56, rumpfY - 0.12, 0, 0, 0, -Math.PI / 2));
  for (const z of [-0.06, 0.06]) {
    teile.push(shapePart(hauer, 0.52, rumpfY - 0.09, z, 0, 0, -0.9));
  }
  for (const [x, h] of [[0.14, 1], [0.02, 1.2], [-0.1, 0.9]]) {
    teile.push(shapePart(kamm, x, rumpfY + 0.24, 0, 0, 0, 0, 1, h, 1));
  }
  const g = mergeShapes(teile);
  leib.dispose();
  lauf.dispose();
  kopf.dispose();
  ruessel.dispose();
  hauer.dispose();
  kamm.dispose();
  return g;
}

// Legt eine Gattung an: eine Instanzenwolke und die Liste ihrer Tiere.
function addWildlife(geometry, material, tiere, aktualisieren, zusatz = null) {
  if (!tiere.length) return;
  const mesh = new THREE.InstancedMesh(geometry, material, tiere.length);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  wildlifeGroup.add(mesh);
  let extra = null;
  if (zusatz) {
    extra = new THREE.InstancedMesh(zusatz.geometry, zusatz.material, tiere.length);
    extra.frustumCulled = false;
    extra.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    wildlifeGroup.add(extra);
  }
  wildlife.push({ mesh, extra, tiere, aktualisieren });
}

// Ob ein Feld Wasser ist - und wie weit das offene Meer reicht.
function istWasser(col, row) {
  if (!currentMap) return false;
  if (col < 0 || col >= currentMap.cols || row < 0 || row >= currentMap.rows) return false;
  return currentMap.tiles[row][col].type === 'water';
}

function offenesMeer(col, row, weite) {
  for (let dr = -weite; dr <= weite; dr++) {
    for (let dc = -weite; dc <= weite; dc++) {
      if (!istWasser(col + dc, row + dr)) return false;
    }
  }
  return true;
}

function amUfer(col, row) {
  if (!istWasser(col, row)) return false;
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const c = col + dc;
    const r = row + dr;
    if (c < 0 || c >= currentMap.cols || r < 0 || r >= currentMap.rows) continue;
    if (currentMap.tiles[r][c].type !== 'water') return true;
  }
  return false;
}

// Ein Ochsenkarren, wie er von oben aussieht: zwei Zugtiere, die Deichsel,
// der Kastenwagen mit Plane darüber, zwei Räder. Er ist klein - auf dieser
// Karte misst ein Feld gut fünfzig Kilometer -, aber die Silhouette aus
// Gespann und Plane liest sich auch aus der Feldherrnhöhe.
function cartGeometry() {
  const leib = new THREE.SphereGeometry(0.16, 7, 5);
  const hals = new THREE.CylinderGeometry(0.05, 0.075, 0.2, 5);
  const kopf = new THREE.SphereGeometry(0.062, 6, 5);
  const schnauze = new THREE.SphereGeometry(0.045, 5, 4);
  const bein = new THREE.CylinderGeometry(0.026, 0.02, 0.22, 4);
  const schweif = new THREE.CylinderGeometry(0.018, 0.008, 0.18, 4);
  const joch = new THREE.BoxGeometry(0.05, 0.04, 0.42);
  const deichsel = new THREE.BoxGeometry(0.5, 0.04, 0.04);
  const kasten = new THREE.BoxGeometry(0.46, 0.16, 0.3);
  const plane = new THREE.CylinderGeometry(0.17, 0.17, 0.44, 7, 1, false, 0, Math.PI);
  const rad = new THREE.CylinderGeometry(0.12, 0.12, 0.04, 8);
  const speiche = new THREE.BoxGeometry(0.2, 0.03, 0.02);
  const teile = [];

  // Das Gespann zieht nach +X. Zwei Pferde nebeneinander, jedes mit Leib,
  // Hals, Kopf, vier Läufen und Schweif - vorher waren es zwei Kugeln auf je
  // zwei Stäbchen, und aus der Nähe sah das nach nichts aus.
  for (const z of [-0.11, 0.11]) {
    teile.push(shapePart(leib, 0.54, 0.27, z, 0, 0, 0, 1.75, 0.95, 0.9));
    // Der Hals steigt nach vorn an, der Kopf sitzt schräg darauf.
    teile.push(shapePart(hals, 0.72, 0.34, z, 0, 0, -0.62));
    teile.push(shapePart(kopf, 0.85, 0.4, z, 0, 0, -0.3, 1.3, 1, 1));
    teile.push(shapePart(schnauze, 0.93, 0.36, z));
    // Vorder- und Hinterläufe, die vorderen etwas vorgestellt.
    for (const [x, neigung] of [[0.68, -0.12], [0.62, 0.1], [0.42, -0.1], [0.36, 0.12]]) {
      teile.push(shapePart(bein, x, 0.12, z + (neigung > 0 ? 0.03 : -0.03), 0, 0, neigung));
    }
    teile.push(shapePart(schweif, 0.33, 0.25, z, 0, 0, 0.9));
  }
  // Das Joch quer über den Widerristen und die Deichsel zum Wagen.
  teile.push(shapePart(joch, 0.6, 0.38, 0));
  teile.push(shapePart(deichsel, 0.2, 0.19, 0));

  // Der Wagen: Kasten, Plane, zwei Speichenräder.
  teile.push(shapePart(kasten, -0.12, 0.22, 0));
  teile.push(shapePart(plane, -0.12, 0.3, 0, 0, 0, Math.PI / 2));
  for (const z of [-0.17, 0.17]) {
    teile.push(shapePart(rad, -0.12, 0.13, z, Math.PI / 2, 0, 0));
    for (let i = 0; i < 3; i++) {
      teile.push(shapePart(speiche, -0.12, 0.13, z, 0, 0, (i / 3) * Math.PI));
    }
  }

  const g = mergeShapes(teile);
  for (const teil of [leib, hals, kopf, schnauze, bein, schweif, joch, deichsel,
    kasten, plane, rad, speiche]) teil.dispose();
  return g;
}

// Die Straßen als zusammenhängende Wege: aus der Menge der Straßenfelder
// werden Ketten gesucht, an denen ein Karren entlangfahren kann. Ein Karren,
// der von Feld zu Feld springt, wäre kein Verkehr.
const CART_PATH_MAX = 40;

function roadPaths(roads) {
  const frei = new Set(Object.keys(roads || {}));
  const wege = [];
  const nachbarn = (key) => {
    const [col, row] = key.split(',').map(Number);
    return [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dc, dr]) => `${col + dc},${row + dr}`)
      .filter((k) => frei.has(k));
  };
  // Von den Enden her anfangen: ein Weg, der an einer Kreuzung beginnt, wird
  // kurz; einer, der an einem Ortsanschluss beginnt, läuft durch.
  const enden = [...frei].filter((k) => nachbarn(k).length === 1);
  for (const start of [...enden, ...frei]) {
    if (!frei.has(start)) continue;
    const weg = [];
    let hier = start;
    while (hier && frei.has(hier) && weg.length < CART_PATH_MAX) {
      frei.delete(hier);
      const [col, row] = hier.split(',').map(Number);
      weg.push({ col, row });
      const weiter = nachbarn(hier);
      hier = weiter.length ? weiter[0] : null;
    }
    if (weg.length >= 3) wege.push(weg);
  }
  return wege;
}

// Seewege für die Handelsschifffahrt. Gefahren wurde in der Antike nicht quer
// über die offene See, sondern an der Küste entlang, in Sichtweite des Landes:
// deshalb zählen nur Wasserfelder, die nicht weiter als drei Felder vom Ufer
// entfernt liegen. Aus diesen wird - wie bei den Straßen - eine Kette
// benachbarter Felder gezogen, und die ist der Weg.
function seaLanes(cols, rows, tiles) {
  const frei = new Set();
  const nahAmLand = (col, row) => {
    for (let dr = -3; dr <= 3; dr++) {
      for (let dc = -3; dc <= 3; dc++) {
        const t = tiles[row + dr] && tiles[row + dr][col + dc];
        if (t && t.type !== 'water') return true;
      }
    }
    return false;
  };
  for (let row = 2; row < rows - 2; row++) {
    for (let col = 2; col < cols - 2; col++) {
      if (tiles[row][col].type !== 'water') continue;
      // Direkt am Ufer nicht: dort läge das Schiff auf dem Strand.
      const amStrand = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => {
        const t = tiles[row + dr] && tiles[row + dr][col + dc];
        return t && t.type !== 'water';
      });
      if (!amStrand && nahAmLand(col, row)) frei.add(`${col},${row}`);
    }
  }
  const nachbarn = (key) => {
    const [col, row] = key.split(',').map(Number);
    return [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dc, dr]) => `${col + dc},${row + dr}`)
      .filter((k) => frei.has(k));
  };
  const wege = [];
  for (const start of [...frei]) {
    if (!frei.has(start)) continue;
    const weg = [];
    let hier = start;
    while (hier && frei.has(hier) && weg.length < SEA_LANE_MAX) {
      frei.delete(hier);
      const [col, row] = hier.split(',').map(Number);
      weg.push({ col, row });
      const weiter = nachbarn(hier);
      hier = weiter.length ? weiter[0] : null;
    }
    if (weg.length >= 6) wege.push(weg);
  }
  // Die längsten zuerst: auf einem langen Weg ist ein Segel länger zu sehen.
  wege.sort((x, y) => y.length - x.length);
  return wege;
}

// Wie viele es höchstens werden. Auf einer Karte mit fünftausend Feldern wären
// "alle Küstenfelder" ein Teppich - es geht um Leben, nicht um eine Zählung.
// Ein Wal ist ein seltenes Tier, und im Mittelmeer erst recht: ein Dutzend auf
// einer Karte machte aus ihm einen Fisch. Fünf, und die nur weit draußen.
const WILDLIFE_MAX = { fische: 44, wale: 5, moewen: 70, wild: 90, wagen: 70, schiffe: 26 };
// So lang wird ein Seeweg höchstens - lang genug, dass ein Schiff eine Weile
// unterwegs ist, kurz genug, dass es nicht quer über das Mittelmeer zieht.
const SEA_LANE_MAX = 26;
// So viele Rücken hat ein Schwarm. Vorher waren es drei, die alle auf
// derselben Kreisbahn liefen - das sah aus wie eine Reihe, nicht wie ein
// Schwarm. Jetzt schwimmen sie nebeneinander.
const SCHWARM_GROESSE = 5;

function buildWildlife(state) {
  // Eine zweite Karte im selben Fenster erbt sonst die Tiere der ersten.
  disposeGroup(wildlifeGroup);
  wildlife.length = 0;
  wildlifeGroup = new THREE.Group();
  wildlifeGroup.name = 'Tiere';
  scene.add(wildlifeGroup);
  zeigeWildlife();
  const rng = seededRandomFactory(77);
  const { cols, rows, tiles } = state.map;

  const ufer = [];
  const tiefe = [];
  const waelder = [];
  for (let row = 1; row < rows - 1; row++) {
    for (let col = 1; col < cols - 1; col++) {
      const typ = tiles[row][col].type;
      if (typ === 'water') {
        if (amUfer(col, row)) ufer.push([col, row]);
        else if (offenesMeer(col, row, 4)) tiefe.push([col, row]);
      } else if (typ === 'forest' || (typ === 'hills' && rng() < 0.25)) {
        waelder.push([col, row]);
      }
    }
  }
  const auswahl = (liste, hoechstens) => {
    if (liste.length <= hoechstens) return liste;
    const schritt = liste.length / hoechstens;
    const raus = [];
    for (let i = 0; i < hoechstens; i++) raus.push(liste[Math.floor(i * schritt)]);
    return raus;
  };

  // --- Fischschwärme: dicht unter der Oberfläche, in engen Kreisen ----------
  // Ein Schwarm ist kein Gänsemarsch. Vorher saßen die Fische mit festem
  // Zeitversatz auf ein und derselben Kreisbahn und schwammen deshalb
  // hintereinander her. Jetzt hat der Schwarm eine Mitte, die den Kreis
  // zieht, und jeder Fisch einen festen Platz darin: `laengs` nach vorn,
  // `quer` zur Seite. Der Platz wird mit der Schwimmrichtung mitgedreht,
  // damit der Schwarm in der Kurve seine Form behält und nicht auseinanderfällt.
  const fische = [];
  for (const [col, row] of auswahl(ufer, WILDLIFE_MAX.fische)) {
    const mx = worldX(col) + (rng() - 0.5) * TILE_SIZE * 0.5;
    const mz = worldZ(row) + (rng() - 0.5) * TILE_SIZE * 0.5;
    const takt = 0.25 + rng() * 0.3;
    const start = rng() * Math.PI * 2;
    const weite = TILE_SIZE * (0.2 + rng() * 0.2);
    const streu = TILE_SIZE * 0.11;
    for (let i = 0; i < SCHWARM_GROESSE; i++) {
      fische.push({
        mx, mz, takt, weite, start,
        laengs: (rng() - 0.5) * streu * 1.6,
        quer: (rng() - 0.5) * streu * 2.2,
        // Ein bisschen Eigenleben, sonst steht der Schwarm wie angenagelt.
        zappel: rng() * Math.PI * 2,
        gross: 0.5 + rng() * 0.35,
      });
    }
  }
  addWildlife(
    fishGeometry(),
    new THREE.MeshStandardMaterial({ color: '#2a4a63', roughness: 0.55 }),
    fische,
    (tier, t, matrix, lage, dreh, mass) => {
      const winkel = tier.start + t * tier.takt;
      // Die Mitte des Schwarms auf ihrer Kreisbahn.
      const cx = tier.mx + Math.cos(winkel) * tier.weite;
      const cz = tier.mz + Math.sin(winkel) * tier.weite;
      // Die Schwimmrichtung ist die Tangente an den Kreis.
      const kurs = winkel + Math.PI / 2;
      const vx = Math.cos(kurs);
      const vz = Math.sin(kurs);
      // Der Platz des einzelnen Fisches, mitgedreht: längs nach vorn,
      // quer nach der Seite. Dazu ein leichtes Wandern, damit der Schwarm
      // atmet.
      const wandern = Math.sin(t * 0.8 + tier.zappel) * 0.12;
      const laengs = tier.laengs + wandern;
      const quer = tier.quer + Math.cos(t * 0.7 + tier.zappel) * 0.12;
      lage.set(
        cx + vx * laengs - vz * quer,
        SEA_LEVEL_Y + 0.02 + Math.sin(t * 1.4 + tier.zappel) * 0.05,
        cz + vz * laengs + vx * quer
      );
      dreh.setFromAxisAngle(WILDLIFE_ACHSE, -winkel - Math.PI / 2);
      mass.setScalar(tier.gross);
      matrix.compose(lage, dreh, mass);
    }
  );

  // --- Wale: weit draußen, tauchen auf und blasen ---------------------------
  const wale = [];
  for (const [col, row] of auswahl(tiefe, WILDLIFE_MAX.wale)) {
    wale.push({
      mx: worldX(col), mz: worldZ(row),
      takt: 0.05 + rng() * 0.05, weite: TILE_SIZE * (0.5 + rng() * 0.5),
      start: rng() * Math.PI * 2, zyklus: 9 + rng() * 6, versatz: rng() * 15,
      gross: 1.2 + rng() * 0.6,
    });
  }
  addWildlife(
    whaleGeometry(),
    new THREE.MeshStandardMaterial({ color: '#33414f', roughness: 0.6 }),
    wale,
    (tier, t, matrix, lage, dreh, mass) => {
      const winkel = tier.start + t * tier.takt;
      // Auftauchen und wieder weg: über den Zyklus liegt er meist unter Wasser
      // und hebt den Rücken nur für ein paar Sekunden heraus.
      const p = ((t + tier.versatz) % tier.zyklus) / tier.zyklus;
      const auf = p < 0.4 ? Math.sin(p / 0.4 * Math.PI) : 0;
      lage.set(
        tier.mx + Math.cos(winkel) * tier.weite,
        SEA_LEVEL_Y - 0.6 + auf * 1.0,
        tier.mz + Math.sin(winkel) * tier.weite
      );
      dreh.setFromAxisAngle(WILDLIFE_ACHSE, -winkel - Math.PI / 2);
      mass.setScalar(tier.gross);
      matrix.compose(lage, dreh, mass);
      tier.blas = p > 0.1 && p < 0.3 ? Math.sin((p - 0.1) / 0.2 * Math.PI) : 0;
      tier.wo = { x: lage.x, y: lage.y, z: lage.z, r: -winkel - Math.PI / 2 };
    },
    {
      geometry: spoutGeometry(),
      material: new THREE.MeshStandardMaterial({
        color: '#eef4f7', roughness: 0.4, transparent: true, opacity: 0.75,
      }),
    }
  );

  // --- Möwen: über der Küste, in weiten Kreisen -----------------------------
  const moewen = [];
  for (const [col, row] of auswahl(ufer, WILDLIFE_MAX.moewen)) {
    if (rng() < 0.45) continue;
    moewen.push({
      mx: worldX(col), mz: worldZ(row),
      takt: 0.4 + rng() * 0.4, weite: TILE_SIZE * (0.35 + rng() * 0.35),
      start: rng() * Math.PI * 2, hoehe: 2.2 + rng() * 2.2, gross: 0.55 + rng() * 0.3,
    });
  }
  addWildlife(
    gullGeometry(),
    new THREE.MeshStandardMaterial({ color: '#f2f4f2', roughness: 0.8 }),
    moewen,
    (tier, t, matrix, lage, dreh, mass) => {
      const winkel = tier.start + t * tier.takt;
      lage.set(
        tier.mx + Math.cos(winkel) * tier.weite,
        SEA_LEVEL_Y + tier.hoehe + Math.sin(t * 0.9 + tier.start) * 0.4,
        tier.mz + Math.sin(winkel) * tier.weite
      );
      dreh.setFromAxisAngle(WILDLIFE_ACHSE, -winkel - Math.PI / 2);
      // Der Flügelschlag steckt in der Höhe des Tieres, nicht in seiner Form:
      // ein bisschen gestaucht, ein bisschen gestreckt.
      mass.set(tier.gross, tier.gross * (0.7 + Math.abs(Math.sin(t * 4 + tier.start)) * 0.6),
        tier.gross);
      matrix.compose(lage, dreh, mass);
    }
  );

  // --- Wild an den Waldrändern ----------------------------------------------
  // Was an einem Waldrand steht, steht nicht als anonymes "Rotwild" da. Drei
  // Arten, und die Zahl gehört zur Art: ein **Hirsch** zieht allein, **Rehe**
  // stehen zu dritt, **Wildschweine** ebenfalls - eine Bache mit ihren
  // Frischlingen. Welche Art an einem Waldrand steht, entscheidet der Wurf;
  // Rehe sind am häufigsten, der einzelne Hirsch am seltensten.
  const hirsche = [];
  const rehe = [];
  const schweine = [];
  for (const [col, row] of auswahl(waelder, WILDLIFE_MAX.wild)) {
    const wurf = rng();
    const [liste, zahl, mass] = wurf < 0.2 ? [hirsche, 1, 0.62]
      : wurf < 0.68 ? [rehe, 3, 0.48]
        : [schweine, 3, 0.5];
    const boden = groundY(col, row);
    for (let i = 0; i < zahl; i++) {
      liste.push({
        mx: worldX(col) + (rng() - 0.5) * TILE_SIZE * 0.6,
        mz: worldZ(row) + (rng() - 0.5) * TILE_SIZE * 0.6,
        boden,
        takt: 0.05 + rng() * 0.06, weite: TILE_SIZE * (0.05 + rng() * 0.1),
        start: rng() * Math.PI * 2, gross: mass * (1 + (rng() - 0.5) * 0.24),
      });
    }
  }
  // --- Karren auf den Straßen ----------------------------------------------
  // Eine Straße, auf der nie etwas fährt, ist ein Strich. Auf jedem Weg von
  // einiger Länge zieht ein Ochsengespann hin und zurück - langsam, wie ein
  // Fuhrwerk zieht, und mit dem Boden auf und ab.
  const wagen = [];
  const wege = roadPaths(state.roads);
  for (const weg of wege) {
    if (wagen.length >= WILDLIFE_MAX.wagen) break;
    // Auf einen langen Weg gehören zwei Karren, auf einen kurzen einer.
    const zahl = 1 + Math.floor(weg.length / 16);
    for (let i = 0; i < zahl; i++) {
      wagen.push({
        weg,
        // Zwanzig Sekunden für ein Feld: ein Fuhrwerk, kein Bote.
        takt: 0.045 + rng() * 0.02,
        start: (i + rng()) / zahl,
        gross: 1.35 + rng() * 0.35,
      });
    }
  }
  addWildlife(
    cartGeometry(),
    new THREE.MeshStandardMaterial({ color: '#7a5a34', roughness: 0.95 }),
    wagen,
    (tier, t, matrix, lage, dreh, mass) => {
      const felder = tier.weg.length - 1;
      // Hin und zurück statt im Kreis: ein Karren, der am Ende des Wegs
      // verschwindet und am Anfang wieder auftaucht, springt.
      const roh = (tier.start + t * tier.takt) % 2;
      const anteil = (roh < 1 ? roh : 2 - roh) * felder;
      const i = Math.min(felder - 1, Math.floor(anteil));
      const rest = anteil - i;
      const a = tier.weg[i];
      const b = tier.weg[i + 1];
      const col = a.col + (b.col - a.col) * rest;
      const row = a.row + (b.row - a.row) * rest;
      const x = worldX(col);
      const z = worldZ(row);
      lage.set(x, bandY(x, z) + ROAD_LIFT, z);
      // Blickrichtung: die des Wegstücks, und auf dem Rückweg umgekehrt.
      const vor = roh < 1 ? 1 : -1;
      const winkel = Math.atan2(-(b.row - a.row) * vor, (b.col - a.col) * vor);
      dreh.setFromAxisAngle(WILDLIFE_ACHSE, winkel);
      mass.setScalar(tier.gross);
      matrix.compose(lage, dreh, mass);
    }
  );

  // Alle drei ziehen gleich: langsam im engen Kreis, mit dem Kopf voran.
  const aesen = (tier, t, matrix, lage, dreh, mass) => {
    const winkel = tier.start + t * tier.takt;
    lage.set(
      tier.mx + Math.cos(winkel) * tier.weite,
      tier.boden,
      tier.mz + Math.sin(winkel) * tier.weite
    );
    dreh.setFromAxisAngle(WILDLIFE_ACHSE, -winkel - Math.PI / 2);
    mass.setScalar(tier.gross);
    matrix.compose(lage, dreh, mass);
  };
  // --- Handelsschiffe auf der See -------------------------------------------
  // Was die Karren auf den Straßen sind, sind sie auf dem Wasser: Verkehr, der
  // ohne den Feldherrn stattfindet. Sie fahren dieselben Wege hin und zurück
  // und wenden am Ende - eine Fahrt quer über die Karte wäre in der Antike
  // ohnehin niemand gefahren.
  const schiffe = [];
  for (const weg of seaLanes(cols, rows, tiles)) {
    if (schiffe.length >= WILDLIFE_MAX.schiffe) break;
    schiffe.push({
      weg,
      takt: 0.012 + rng() * 0.01,
      start: rng() * 2,
      gross: 0.9 + rng() * 0.35,
    });
  }
  const segeln = (tier, t, matrix, lage, dreh, mass) => {
    const felder = tier.weg.length - 1;
    // Hin und zurück statt im Kreis, sonst springt das Schiff am Ende.
    const roh = (tier.start + t * tier.takt) % 2;
    const anteil = (roh < 1 ? roh : 2 - roh) * felder;
    const i = Math.min(felder - 1, Math.floor(anteil));
    const rest = anteil - i;
    const a = tier.weg[i];
    const b = tier.weg[i + 1];
    const col = a.col + (b.col - a.col) * rest;
    const row = a.row + (b.row - a.row) * rest;
    // Ein Schiff liegt im Wasser, nicht darauf: der Rumpf taucht ein, und der
    // Seegang hebt es kaum merklich.
    lage.set(worldX(col), SEA_LEVEL_Y - 0.06 + Math.sin(t * 0.9 + tier.start * 6) * 0.03,
      worldZ(row));
    const vor = roh < 1 ? 1 : -1;
    dreh.setFromAxisAngle(WILDLIFE_ACHSE,
      Math.atan2(-(b.row - a.row) * vor, (b.col - a.col) * vor));
    mass.setScalar(tier.gross);
    matrix.compose(lage, dreh, mass);
  };
  addWildlife(merchantHullGeometry(),
    new THREE.MeshStandardMaterial({ color: '#6b4a2c', roughness: 0.9 }), schiffe, segeln);
  addWildlife(merchantSailGeometry(),
    new THREE.MeshStandardMaterial({
      color: '#e0d3b4', roughness: 0.95, side: THREE.DoubleSide,
    }), schiffe, segeln);

  addWildlife(stagGeometry(),
    new THREE.MeshStandardMaterial({ color: '#8a5a30', roughness: 0.95 }), hirsche, aesen);
  addWildlife(roeGeometry(),
    new THREE.MeshStandardMaterial({ color: '#a97a4a', roughness: 0.95 }), rehe, aesen);
  addWildlife(boarGeometry(),
    new THREE.MeshStandardMaterial({ color: '#4c4038', roughness: 1 }), schweine, aesen);
}

const WILDLIFE_ACHSE = new THREE.Vector3(0, 1, 0);
const wildMatrix = new THREE.Matrix4();
const wildLage = new THREE.Vector3();
const wildDreh = new THREE.Quaternion();
const wildMass = new THREE.Vector3();
let wildlifeZeit = 0;

function wildlifeAlive() {
  return wildlifeEnabled && wildlife.length > 0 && mapMode !== 'tactical';
}

function advanceWildlife(dt) {
  wildlifeZeit += dt;
  const t = wildlifeZeit;
  for (const gattung of wildlife) {
    const { mesh, extra, tiere, aktualisieren } = gattung;
    for (let i = 0; i < tiere.length; i++) {
      aktualisieren(tiere[i], t, wildMatrix, wildLage, wildDreh, wildMass);
      mesh.setMatrixAt(i, wildMatrix);
      if (extra) {
        // Der Blas steht senkrecht über dem Rücken - und ist meist nicht da.
        const tier = tiere[i];
        const hoch = tier.blas || 0;
        // Am Kopf, nicht in der Mitte: die Blickrichtung steckt in der Drehung
        // des Tieres, und eine Drehung um die Hochachse schiebt das lokale
        // Vorn nach (cos, 0, -sin).
        const weit = 1.3 * (tier.gross || 1);
        wildLage.set(
          tier.wo.x + Math.cos(tier.wo.r) * weit,
          tier.wo.y + 0.3 * (tier.gross || 1),
          tier.wo.z - Math.sin(tier.wo.r) * weit
        );
        wildDreh.setFromAxisAngle(WILDLIFE_ACHSE, 0);
        const dick = hoch * (tier.gross || 1);
        // Breiter als hoch wächst er nicht: ein Blas steigt.
        wildMass.set(dick * 0.9, dick * 2.1, dick * 0.9);
        wildMatrix.compose(wildLage, wildDreh, wildMass);
        extra.setMatrixAt(i, wildMatrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (extra) extra.instanceMatrix.needsUpdate = true;
  }
}

function seededRandomFactory(seed) {
  let s = seed;
  return function seededRandom() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s % 10000) / 10000;
  };
}

// A small tileable speckle-noise texture, layered on top of the vertex
// colors to break up the flat, plasticky look of a pure color material.
function makeNoiseTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rng = seededRandomFactory(7);
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 205 + Math.floor(rng() * 50);
    image.data[i * 4] = v;
    image.data[i * 4 + 1] = v;
    image.data[i * 4 + 2] = v;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function colorFor(type, rng) {
  const c = new THREE.Color(TILE_TYPES[type].color);
  const jitter = 0.92 + rng() * 0.16;
  c.multiplyScalar(jitter);
  return c;
}

// Ein Blick in die Requisiten - nur für die Prüfläufe: welche Instanzgruppen
// stehen auf der Karte, in welcher Farbe, und wie viele Punkte trägt jede.
export function propsDebug(colorFilter = null) {
  if (!propsGroup) return [];
  const matrix = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  return propsGroup.children.map((m) => {
    const color = `#${m.material.color.getHexString()}`;
    const entry = { color, count: m.count, vertices: m.geometry.attributes.position.count };
    if (colorFilter && color === colorFilter) {
      entry.positions = [];
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, matrix);
        matrix.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());
        entry.positions.push({
          col: pos.x / TILE_SIZE + mapCols / 2,
          row: pos.z / TILE_SIZE + mapRows / 2,
        });
      }
    } else {
      m.getMatrixAt(0, matrix);
      matrix.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());
      entry.firstCol = pos.x / TILE_SIZE + mapCols / 2;
      entry.firstRow = pos.z / TILE_SIZE + mapRows / 2;
    }
    return entry;
  });
}

// Nur für die Prüfläufe: Zustand aller Ortsgruppen, um verschwundene oder
// falsch stehende Orte zu finden.
export function cityDebug() {
  return [...cityGroups.entries()].map(([id, entry]) => ({
    id,
    size: entry.size,
    pos: entry.group.position.toArray(),
    visible: entry.group.visible,
    inScene: entry.group.parent === scene,
    children: entry.group.children.length,
  }));
}

// Das Zeltlager während einer Schlacht: die Truppen stehen jetzt in der
// Schlachtreihe, nicht mehr am Lagerfeuer, also verschwinden Zelte und Wache
// dafür. Das Verstecken wirkt sofort; das Zeigen setzt nur die Sperre zurück
// und überlässt den nächsten `syncEntities`-Durchlauf (nach dem
// Zusammenprall ohnehin fällig) der eigentlichen Entscheidung - der weiß, ob
// das Heer inzwischen eingeschifft ist oder wieder marschiert.
export function setArmyCampHidden(armyId, hidden) {
  const entry = armyGroups.get(armyId);
  if (!entry) return;
  entry.group.userData.hiddenForBattle = hidden;
  if (hidden) {
    if (entry.group.userData.tents) entry.group.userData.tents.visible = false;
    if (entry.group.userData.garrison) entry.group.userData.garrison.visible = false;
  }
}

export function armyDebug(armyId) {
  const entry = armyGroups.get(armyId);
  if (!entry) return null;
  const { group } = entry;
  const garrison = group.userData.garrison;
  const column = group.userData.column;
  return {
    pos: group.position.toArray(),
    rotationY: group.rotation.y,
    tentsVisible: group.userData.tents ? group.userData.tents.visible : null,
    tentsScale: group.userData.tents ? group.userData.tents.scale.toArray() : null,
    hasGarrison: !!garrison,
    garrisonVisible: garrison ? garrison.visible : null,
    garrisonScale: garrison ? garrison.scale.toArray() : null,
    garrisonWachen: garrison ? garrison.userData.wachen.map((mann) => ({
      pos: mann.position.toArray(),
      rolle: mann.userData.rolle,
      teile: Object.fromEntries(Object.entries(mann.userData.teile)
        .map(([k, mesh]) => [k, mesh.visible])),
    })) : null,
    hasColumn: !!column,
    columnVisible: column ? column.visible : null,
    columnScale: column ? column.scale.toArray() : null,
    columnMarschierer: column ? column.userData.marschierer.map((mann) => ({
      visible: mann.visible,
      pos: mann.position.toArray(),
      rolle: mann.userData.rolle,
    })) : null,
  };
}

// Builds a single smooth, vertex-colored heightmap mesh for the whole map
// (one vertex per tile centre, so slopes blend naturally between tiles),
// a translucent sea surface, decorative props, and roads between cities.
export function buildMap(state) {
  mapCols = state.map.cols;
  mapRows = state.map.rows;
  currentMap = state.map;
  currentRoads = state.roads || {};
  const leereBaumarten = () => Object.fromEntries(Object.keys(TREE_KINDS).map((k) => [k, []]));
  const props = {
    trunks: leereBaumarten(), leaves: leereBaumarten(),
    rockPeaks: [], snowPeaks: [], oreRock: [], oreVein: [],
  };
  // Requisiten und Straßen der vorigen Karte gehen mit, ehe die neuen kommen -
  // sonst blieben sie in der Szene hängen, ohne dass noch jemand sie kennt.
  disposeGroup(propsGroup);
  disposeGroup(roadsGroup);
  propsGroup = new THREE.Group();
  propsGroup.name = 'Requisiten';
  roadsGroup = new THREE.Group();
  roadsGroup.name = 'Straßen';
  scene.add(propsGroup);
  scene.add(roadsGroup);
  const rng = seededRandomFactory(11);

  // Wo schon etwas steht, wächst kein Baum: die Orte selbst und ihre
  // unmittelbare Nachbarschaft (dort stehen Acker, Viadukt, Stollen und
  // Kaserne) und jedes Feld, über das eine Straße läuft.
  const besetzteFelder = new Set(Object.keys(currentRoads));
  for (const city of state.cities) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) besetzteFelder.add(`${city.col + dc},${city.row + dr}`);
    }
  }

  const positions = new Float32Array(mapCols * mapRows * 3);
  const colors = new Float32Array(mapCols * mapRows * 3);
  const uvs = new Float32Array(mapCols * mapRows * 2);
  const idx = (col, row) => row * mapCols + col;

  for (let row = 0; row < mapRows; row++) {
    for (let col = 0; col < mapCols; col++) {
      const tile = state.map.tiles[row][col];
      const i = idx(col, row);
      positions[i * 3] = worldX(col);
      positions[i * 3 + 1] = tileTopY(tile.elevation);
      positions[i * 3 + 2] = worldZ(row);
      const color = colorFor(tile.type, rng);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      uvs[i * 2] = col / 3;
      uvs[i * 2 + 1] = row / 3;

      if (tile.type !== 'water') {
        // Bäume: ein Wald ist ein Wald und nicht ein Baum je Feld. Auf einem
        // Waldfeld stehen vier bis sechs, und weil ein Land nicht an der
        // Waldgrenze aufhört, steht auch in der Ebene und auf den Hügeln hier
        // und da einer. Wo ein Ort oder eine Straße liegt, wächst keiner: eine
        // Eiche mitten auf dem Pflaster ist keine Landschaft, sondern ein
        // Versehen.
        const frei = !besetzteFelder.has(`${col},${row}`);
        if (TILE_TYPES[tile.type].deco === 'tree') {
          const zahl = frei ? 4 + Math.floor(rng() * 3) : 2;
          for (let i = 0; i < zahl; i++) collectTree(props, col, row, rng, 0.84);
        } else if (frei && tile.type === 'hills' && rng() < 0.5) {
          collectTree(props, col, row, rng, 0.7);
        } else if (frei && tile.type === 'plains' && rng() < 0.26) {
          // In der Ebene stehen sie in Gruppen, nicht einzeln verteilt.
          const zahl = rng() < 0.4 ? 2 : 1;
          for (let i = 0; i < zahl; i++) collectTree(props, col, row, rng, 0.55);
        }
        if (TILE_TYPES[tile.type].deco === 'peak') collectPeak(props, col, row, tile.elevation, rng);
      }
    }
  }

  const indices = [];
  for (let row = 0; row < mapRows - 1; row++) {
    for (let col = 0; col < mapCols - 1; col++) {
      const a = idx(col, row);
      const b = idx(col + 1, row);
      const c = idx(col, row + 1);
      const d = idx(col + 1, row + 1);
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // A copy, not the array itself: the attribute below keeps the original, and
  // the tactical view writes straight into it. Sharing them would mean the
  // first switch to the political map overwrites the ground colours, and the
  // way back would restore the tactical ones.
  terrainColors = Float32Array.from(colors);
  tacticalColors = new Float32Array(colors.length);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  noiseTexture = makeNoiseTexture();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: noiseTexture,
    roughness: 0.95,
  });
  terrainMesh = new THREE.Mesh(geometry, material);
  scene.add(terrainMesh);

  // Die Karte liegt auf einem Tisch, und was auf dem Tisch liegt, ist ein Blatt:
  // Zwischen dem letzten Feld und dem Rahmen ist kein Meer mehr, sondern das
  // Papier, auf das die Karte gezeichnet ist. Das Meer endet dort, wo die
  // Felder enden - sonst führe man am Rand über ein Wasser, das es nicht gibt.
  const boardW = mapCols * TILE_SIZE + TILE_SIZE * 2.9;
  const boardH = mapRows * TILE_SIZE + TILE_SIZE * 2.9;
  // Genau so weit wie die Felder: die Geländefläche spannt zwischen den
  // Mittelpunkten des ersten und des letzten Felds.
  const mapW = (mapCols - 1) * TILE_SIZE;
  const mapH = (mapRows - 1) * TILE_SIZE;
  const mapCx = -TILE_SIZE / 2;
  const mapCz = -TILE_SIZE / 2;

  // Der Rand ist ein Ring aus vier Streifen, keine Fläche unter der ganzen
  // Karte: so liegt das Papier über dem Wasserspiegel und ist vom Tischrand
  // aus zu sehen, ohne dass es das Meer verdeckt, wo Meer hingehört.
  // Die Faserung ist dasselbe Rauschen wie auf dem Gelände, nur eng gekachelt -
  // sonst sieht man einen Farbfleck und kein Blatt.
  const paperGrain = makeNoiseTexture();
  paperGrain.repeat.set(6, 6);
  const paperMaterial = new THREE.MeshStandardMaterial({
    color: PAPER_COLOR, roughness: 1, map: paperGrain,
  });
  paperMesh = new THREE.Group();
  const randX = (boardW - mapW) / 2;
  const randZ = (boardH - mapH) / 2;
  const paperY = SEA_LEVEL_Y + 0.12;
  const streifen = [
    // oben und unten über die ganze Breite, links und rechts dazwischen
    [boardW, randZ, mapCx, mapCz - mapH / 2 - randZ / 2],
    [boardW, randZ, mapCx, mapCz + mapH / 2 + randZ / 2],
    [randX, mapH, mapCx - mapW / 2 - randX / 2, mapCz],
    [randX, mapH, mapCx + mapW / 2 + randX / 2, mapCz],
  ];
  for (const [breite, tiefe, x, z] of streifen) {
    const blatt = new THREE.Mesh(new THREE.PlaneGeometry(breite, tiefe), paperMaterial);
    blatt.rotation.x = -Math.PI / 2;
    blatt.position.set(x, paperY, z);
    paperMesh.add(blatt);
  }
  scene.add(paperMesh);

  deepSeaMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(mapW, mapH),
    new THREE.MeshStandardMaterial({ color: '#1d3f66', roughness: 0.9 })
  );
  deepSeaMesh.rotation.x = -Math.PI / 2;
  deepSeaMesh.position.set(mapCx, tileTopY(TILE_TYPES.water.elevation) - 0.6, mapCz);
  scene.add(deepSeaMesh);

  waterMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(mapW, mapH),
    new THREE.MeshStandardMaterial({
      color: TILE_TYPES.water.color, transparent: true, opacity: 0.82, roughness: 0.25,
    })
  );
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.set(mapCx, SEA_LEVEL_Y, mapCz);
  scene.add(waterMesh);

  buildTable(boardW, boardH);
  buildTent(state);
  // Erst jetzt: die Erzfelder brauchen die fertige Geländehöhe.
  collectOre(state, props);
  buildProps(props);
  buildWonders(state);
  buildRoadNetwork(state);
  buildRivers(state);
  // Und zuletzt, was ohne den Feldherrn geschieht: Fische, Wale, Möwen, Wild.
  buildWildlife(state);
  roadVersionDrawn = state.roadVersion || 0;
  if (wildlifeAlive()) startAnimationLoop();
}

// --- Kartentisch und Feldherrnzelt ---------------------------------------
// Der Feldzug wird nicht aus dem Himmel betrachtet, sondern über einer Karte,
// die auf einem Tisch im eigenen Zelt liegt: Holzrahmen ringsum, Zeltbahnen
// darüber, in den Farben der eigenen Fraktion.

const TABLE_WOOD = geteilt(new THREE.MeshStandardMaterial({ color: '#5a3d24', roughness: 0.85 }));
const TABLE_WOOD_DARK = geteilt(new THREE.MeshStandardMaterial({ color: '#3f2a17', roughness: 0.9 }));
// Wie weit die Beine unter die Platte reichen. Der Zeltboden liegt tiefer,
// als man von der Karte aus sieht - sie dürfen ruhig lang sein.
const TABLE_LEG_HEIGHT = 42;

function buildTable(boardW, boardH) {
  // Wie beim Zelt: der alte Tisch wird abgeräumt, nicht nur beiseitegestellt.
  disposeGroup(tableGroup);
  tableGroup = new THREE.Group();
  tableGroup.name = 'Tisch';
  const rim = TILE_SIZE * 1.15;
  const rimTop = SEA_LEVEL_Y + 1.1;
  const rimHeight = 3.2;
  const slabY = tileTopY(TILE_TYPES.water.elevation) - 1.4;

  // Die Tischplatte unter der Karte, damit von unten nichts durchscheint.
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(boardW + rim * 2, 1.6, boardH + rim * 2),
    TABLE_WOOD_DARK
  );
  slab.position.y = slabY;
  tableGroup.add(slab);

  // Vier Leisten als Rahmen, an den Ecken überlappend.
  const beams = [
    [boardW + rim * 2, rim, 0, (boardH + rim) / 2],
    [boardW + rim * 2, rim, 0, -(boardH + rim) / 2],
    [rim, boardH + rim * 2, (boardW + rim) / 2, 0],
    [rim, boardH + rim * 2, -(boardW + rim) / 2, 0],
  ];
  for (const [w, d, x, z] of beams) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w, rimHeight, d), TABLE_WOOD);
    beam.position.set(x, rimTop - rimHeight / 2 + 1.4, z);
    tableGroup.add(beam);
  }

  // Vier Beine. Sie stehen ein Stück von der Ecke eingerückt, wie bei einem
  // Tisch, der etwas tragen soll, und laufen nach unten leicht zusammen -
  // gedrechselt, nicht gezimmert. Ohne sie schwebte die Platte im Zelt.
  const legRadius = TILE_SIZE * 0.62;
  const legHeight = TABLE_LEG_HEIGHT;
  const inset = rim * 1.6;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(legRadius * 0.78, legRadius, legHeight, 10),
        TABLE_WOOD_DARK
      );
      leg.position.set(
        sx * ((boardW + rim * 2) / 2 - inset),
        slabY - 0.8 - legHeight / 2,
        sz * ((boardH + rim * 2) / 2 - inset)
      );
      tableGroup.add(leg);
      // Ein Wulst oben am Bein, wo es die Platte trägt.
      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(legRadius * 1.15, legRadius * 1.15, TILE_SIZE * 0.5, 10),
        TABLE_WOOD
      );
      collar.position.set(leg.position.x, slabY - 0.8 - TILE_SIZE * 0.25, leg.position.z);
      tableGroup.add(collar);
      // Und ein breiter Fuß unten, damit er nicht einsinkt.
      const foot = new THREE.Mesh(
        new THREE.CylinderGeometry(legRadius * 1.35, legRadius * 1.5, TILE_SIZE * 0.55, 10),
        TABLE_WOOD
      );
      foot.position.set(leg.position.x, slabY - 0.8 - legHeight + TILE_SIZE * 0.27, leg.position.z);
      tableGroup.add(foot);
    }
  }

  scene.add(tableGroup);
}

// Zeltbahnen als Streifentuch: Leinen und die Farbe der eigenen Fraktion.
function tentFabric(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#cbb894';
  ctx.fillRect(0, 0, 128, 8);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  for (let x = 0; x < 128; x += 32) ctx.fillRect(x, 0, 13, 8);
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#000';
  for (let x = 0; x < 128; x += 8) ctx.fillRect(x, 0, 2, 8);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 1);
  return texture;
}

// Das Zeichen einer Fraktion als Textur: ein Tuch in ihrer Farbe, darauf das
// Wappen. Gezeichnet wird das SVG einmal in eine Leinwand - danach kostet es
// nichts mehr.
const emblemTextures = new Map();

// Auch das Schaubild der Schlacht hängt seine Fahnen daran - eine zweite
// Sammlung derselben Tücher wäre eine zu viel.
export function emblemTexture(factionId, colour) {
  const key = `${factionId}|${colour}`;
  if (emblemTextures.has(key)) return emblemTextures.get(key);

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 208;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Ein Saum oben und unten, damit das Tuch nicht wie ein Farbfeld wirkt.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.fillRect(0, 0, canvas.width, 10);
  ctx.fillRect(0, canvas.height - 16, canvas.width, 16);
  // Ein Wappen wird einmal gezeichnet und hängt danach an Stadtfahnen,
  // Heeresfahnen und Zeltbahnen zugleich - es gehört keinem davon allein.
  const texture = geteilt(new THREE.CanvasTexture(canvas));
  emblemTextures.set(key, texture);

  // Das Wappen kommt aus einem SVG und ist deshalb erst nach dem Laden da.
  const image = new Image();
  const svg = emblemSVG(factionId, { size: 116, color: '#f6ecd2' });
  image.onload = () => {
    ctx.drawImage(image, 6, 44, 116, 116);
    texture.needsUpdate = true;
    render();
  };
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return texture;
}

// --- Der Feldherrnsitz -----------------------------------------------------
// Hinter dem Kartentisch, dem Betrachter gegenüber, steht der Thron: das Zelt
// ist das Hauptquartier, und ein Hauptquartier hat einen Platz, an dem
// entschieden wird. Links und rechts die Feldzeichen, daneben zwei Stücke
// Ausstattung, die zur Fraktion passen - Schilde und Speere bei Rom,
// Elefantenzähne bei Karthago, Felle beim Norden, Palme bei den Ptolemäern.
//
// Gebaut wird in Throneinheiten (Sitzhöhe 1) und am Ende auf Zeltmaß
// hochskaliert; so bleiben die Maße hier lesbar.

const TENT_MATERIALS = geteilteSammlung({
  wood: new THREE.MeshStandardMaterial({ color: '#6b4a28', roughness: 0.9 }),
  darkWood: new THREE.MeshStandardMaterial({ color: '#432c17', roughness: 1 }),
  stone: new THREE.MeshStandardMaterial({ color: '#ded6c2', roughness: 0.7 }),
  gold: new THREE.MeshStandardMaterial({ color: '#d9b451', roughness: 0.4, metalness: 0.18 }),
  bronze: new THREE.MeshStandardMaterial({ color: '#b08040', roughness: 0.5, metalness: 0.15 }),
  fur: new THREE.MeshStandardMaterial({ color: '#7a6247', roughness: 1 }),
  clay: new THREE.MeshStandardMaterial({ color: '#a4633c', roughness: 0.95 }),
  ivory: new THREE.MeshStandardMaterial({ color: '#e9e2cc', roughness: 0.6 }),
  leaf: new THREE.MeshStandardMaterial({ color: '#3f7a3a', roughness: 0.9 }),
  ember: new THREE.MeshBasicMaterial({ color: '#ff9a3c' }),
});

function tentBox(group, material, w, h, d, x, y, z, rotation = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y + h / 2, z);
  mesh.rotation.y = rotation;
  group.add(mesh);
  return mesh;
}

// Drei Bauarten Thron: Roms Klappstuhl aus Elfenbein, der steinerne Sitz der
// hellenistischen Höfe, der geschnitzte Hochsitz des Nordens.
const THRONE_STYLE = {
  rom: 'curule', athen: 'stone', sparta: 'stone',
  seleukiden: 'stone', ptolemaeer: 'stone',
  makedonien: 'stone', syrakus: 'stone',
  karthago: 'stone', gallier: 'wood', germanen: 'wood', britannier: 'wood',
  iberer: 'wood', daker: 'wood', illyrer: 'wood', sarmaten: 'wood',
  numidien: 'wood', parther: 'stone', armenien: 'stone', pontus: 'stone',
};

// Zwei Stücke Ausstattung je Fraktion.
const TENT_FURNISHINGS = {
  rom: ['shields', 'spears'],
  karthago: ['tusks', 'amphorae'],
  gallier: ['pelts', 'spears'],
  athen: ['shields', 'amphorae'],
  sparta: ['spears', 'shields'],
  makedonien: ['spears', 'shields'],
  syrakus: ['amphorae', 'brazier'],
  germanen: ['pelts', 'spears'],
  britannier: ['shields', 'pelts'],
  iberer: ['spears', 'amphorae'],
  daker: ['spears', 'pelts'],
  seleukiden: ['tusks', 'brazier'],
  ptolemaeer: ['palm', 'amphorae'],
  illyrer: ['shields', 'brazier'],
  sarmaten: ['pelts', 'brazier'],
  numidien: ['spears', 'palm'],
  parther: ['brazier', 'pelts'],
  armenien: ['shields', 'brazier'],
  pontus: ['amphorae', 'shields'],
};

function buildThrone(style, colour) {
  const group = new THREE.Group();
  const frame = style === 'stone' ? TENT_MATERIALS.stone
    : style === 'curule' ? TENT_MATERIALS.ivory : TENT_MATERIALS.wood;
  const cushion = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.85 });

  // Podest, auf dem der Sitz steht - zwei Stufen, damit er über den Tisch sieht.
  tentBox(group, TENT_MATERIALS.darkWood, 4.2, 0.22, 3.4, 0, 0, 0);
  tentBox(group, TENT_MATERIALS.darkWood, 3.4, 0.22, 2.8, 0, 0.22, 0);
  const base = 0.44;

  if (style === 'curule') {
    // Der kurulische Stuhl: gekreuzte Beine, kein Rücken, ein Kissen darauf.
    for (const side of [-1, 1]) {
      for (const lean of [-1, 1]) {
        const leg = tentBox(group, frame, 0.16, 1.5, 0.16, side * 0.62, base, lean * 0.05);
        leg.rotation.z = lean * 0.42;
      }
    }
    tentBox(group, frame, 1.9, 0.16, 1.4, 0, base + 1.05, 0);
    tentBox(group, cushion, 1.75, 0.22, 1.25, 0, base + 1.21, 0);
  } else {
    for (const side of [-1, 1]) {
      tentBox(group, frame, 0.26, 1.1, 0.26, side * 0.78, base, 0.55);
      tentBox(group, frame, 0.26, 2.6, 0.26, side * 0.78, base, -0.62);
    }
    tentBox(group, frame, 1.95, 0.2, 1.5, 0, base + 1.1, 0);
    tentBox(group, cushion, 1.8, 0.24, 1.35, 0, base + 1.3, 0);
    // Rückenlehne mit Aufsatz
    tentBox(group, frame, 1.95, 1.7, 0.22, 0, base + 1.3, -0.62);
    tentBox(group, style === 'stone' ? TENT_MATERIALS.gold : TENT_MATERIALS.bronze,
      2.15, 0.2, 0.32, 0, base + 3.0, -0.62);
    // Armlehnen
    for (const side of [-1, 1]) {
      tentBox(group, frame, 0.22, 0.2, 1.5, side * 0.86, base + 1.75, 0);
    }
  }
  return group;
}

const FURNISHING_BUILDERS = {
  // Schilde, an den Bock gelehnt.
  shields(group, colour) {
    const face = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.85 });
    // Ein Balken auf zwei Böcken, dagegen lehnen die Schilde - sonst schweben
    // sie in der Luft.
    for (const side of [-1, 1]) {
      tentBox(group, TENT_MATERIALS.darkWood, 0.14, 0.95, 0.14, side * 1.25, 0, -0.35);
    }
    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 2.7, 6), TENT_MATERIALS.darkWood
    );
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, 0.95, -0.35);
    group.add(rail);
    for (let i = 0; i < 3; i++) {
      const lean = 0.32;
      const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.11, 16), face);
      shield.rotation.set(Math.PI / 2 - lean, 0, 0);
      shield.position.set((i - 1) * 0.78, 0.58, 0.05 + Math.sin(lean) * 0.55);
      group.add(shield);
      const boss = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), TENT_MATERIALS.bronze);
      boss.position.set((i - 1) * 0.78, 0.6, 0.2 + Math.sin(lean) * 0.55);
      group.add(boss);
    }
  },

  // Ein Speerbock: die Schäfte lehnen zusammen, die Spitzen nach oben.
  spears(group) {
    // Ein Speerbock: die Schäfte stehen fast aufrecht am Querbalken, die
    // Spitzen sitzen oben auf dem Schaft und nicht daneben.
    for (const side of [-1, 1]) {
      tentBox(group, TENT_MATERIALS.darkWood, 0.13, 1.3, 0.13, side * 1.1, 0, -0.3);
    }
    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.075, 2.4, 6), TENT_MATERIALS.darkWood
    );
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, 1.3, -0.3);
    group.add(rail);

    const length = 3.4;
    for (let i = 0; i < 5; i++) {
      const lean = (i - 2) * 0.055;
      const x = (i - 2) * 0.42;
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, length, 6), TENT_MATERIALS.wood
      );
      shaft.position.set(x, length / 2, 0);
      shaft.rotation.z = lean;
      group.add(shaft);
      // Die Spitze sitzt am oberen Ende des Schafts. Der Schaft dreht sich um
      // seine Mitte, also wird vom Mittelpunkt aus gerechnet und nicht vom
      // Boden - sonst steckt die Spitze auf halber Höhe im Holz.
      const reach = length / 2 + 0.22;
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.46, 6), TENT_MATERIALS.bronze);
      head.position.set(x - Math.sin(lean) * reach, length / 2 + Math.cos(lean) * reach, 0);
      head.rotation.z = lean;
      group.add(head);
    }
  },

  // Ein Kohlebecken auf Dreifuß, das noch glüht.
  brazier(group) {
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2;
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.08, 1.3, 5), TENT_MATERIALS.bronze
      );
      leg.position.set(Math.cos(angle) * 0.35, 0.65, Math.sin(angle) * 0.35);
      leg.rotation.set(Math.sin(angle) * 0.22, 0, -Math.cos(angle) * 0.22);
      group.add(leg);
    }
    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.72, 0.42, 0.42, 12), TENT_MATERIALS.bronze
    );
    bowl.position.y = 1.5;
    group.add(bowl);
    const coals = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 6), TENT_MATERIALS.ember);
    coals.scale.y = 0.3;
    coals.position.y = 1.68;
    group.add(coals);
  },

  // Amphoren im Ständer.
  amphorae(group) {
    for (let i = 0; i < 3; i++) {
      const jar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.42, 1.5, 10), TENT_MATERIALS.clay
      );
      jar.position.set((i - 1) * 0.72, 0.75, (i % 2) * 0.35);
      jar.rotation.z = (i - 1) * 0.1;
      group.add(jar);
      const neck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.16, 0.4, 8), TENT_MATERIALS.clay
      );
      neck.position.set((i - 1) * 0.72, 1.62, (i % 2) * 0.35);
      group.add(neck);
    }
  },

  // Felle über einem Gestell.
  pelts(group) {
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.11, 2.1, 6), TENT_MATERIALS.darkWood
      );
      post.position.set(side * 0.95, 1.05, 0);
      group.add(post);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.1, 6), TENT_MATERIALS.darkWood);
    bar.rotation.z = Math.PI / 2;
    bar.position.y = 2.05;
    group.add(bar);
    const hide = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.7, 4, 3), TENT_MATERIALS.fur);
    const pos = hide.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, Math.sin((pos.getX(i) + 0.9) * 2.6) * 0.12);
    }
    hide.geometry.computeVertexNormals();
    hide.material.side = THREE.DoubleSide;
    hide.position.set(0, 1.15, 0.06);
    group.add(hide);
  },

  // Zwei Stoßzähne, mit den Spitzen nach innen aufgestellt.
  tusks(group) {
    for (const side of [-1, 1]) {
      const tusk = new THREE.Mesh(
        new THREE.TorusGeometry(1.1, 0.13, 8, 14, Math.PI * 0.62), TENT_MATERIALS.ivory
      );
      tusk.position.set(side * 0.9, 0.15, 0);
      tusk.rotation.set(0, side > 0 ? 0 : Math.PI, side > 0 ? 0.35 : -0.35);
      group.add(tusk);
      tentBox(group, TENT_MATERIALS.darkWood, 0.5, 0.3, 0.5, side * 0.9, 0, 0);
    }
  },

  // Eine Dattelpalme im Kübel.
  palm(group) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.45, 0.7, 10), TENT_MATERIALS.clay);
    pot.position.y = 0.35;
    group.add(pot);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 2.6, 7), TENT_MATERIALS.wood);
    trunk.position.y = 2.0;
    group.add(trunk);
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2;
      const frond = new THREE.Mesh(new THREE.ConeGeometry(0.26, 1.7, 4), TENT_MATERIALS.leaf);
      frond.position.set(Math.cos(angle) * 0.62, 3.35, Math.sin(angle) * 0.62);
      frond.rotation.set(Math.sin(angle) * 1.15, 0, -Math.cos(angle) * 1.15);
      group.add(frond);
    }
  },
};

// Ein Feldzeichen: Stange, Querbalken, Tuch mit dem Wappen, vergoldete Spitze.
function buildFieldStandard(factionId, colour) {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 5.4, 7), TENT_MATERIALS.darkWood
  );
  pole.position.y = 2.7;
  group.add(pole);
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), TENT_MATERIALS.gold);
  finial.position.y = 5.5;
  group.add(finial);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.12, 0.12), TENT_MATERIALS.gold);
  bar.position.y = 5.05;
  group.add(bar);
  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 2.3),
    new THREE.MeshStandardMaterial({
      map: emblemTexture(factionId, colour), side: THREE.DoubleSide,
      roughness: 1, transparent: true,
    })
  );
  // Deutlich vor dem Mast, nicht in ihm: bei 0.03 steckte das Tuch innerhalb
  // des 0.09 dicken Schafts und tauchte, aus mancher Drehung der Kamera
  // gesehen, hinter ihm ab statt davor zu hängen.
  cloth.position.set(0, 3.85, 0.16);
  group.add(cloth);
  return group;
}

// --- Die Rüstung auf dem Bock ---------------------------------------------
// Im Zelt eines Feldherrn steht, was er trägt, wenn er hinausreitet: ein
// hölzerner Bock, darauf der Panzer, darüber der Helm, daneben Schild und
// Speer. Es ist das eine Stück im Zelt, an dem man sieht, wessen Heer man
// führt - der Thron sagt es nur über den Stil, das Feldzeichen nur über das
// Wappen.
//
// Fünf Rüstungen, nach dem, was die Völker wirklich trugen: die gegliederte
// Schiene Roms, der Bronzepanzer der hellenistischen Höfe, der Leinenpanzer
// des Westens, das Kettenhemd des Nordens und der Schuppenpanzer der Reiter
// aus der Steppe.
const ARMOUR_STYLE = {
  rom: 'schiene',
  athen: 'bronze', sparta: 'bronze', seleukiden: 'bronze', ptolemaeer: 'bronze',
  pontus: 'bronze', armenien: 'bronze', makedonien: 'bronze', syrakus: 'bronze',
  karthago: 'leinen', numidien: 'leinen', iberer: 'leinen',
  gallier: 'kette', germanen: 'kette', britannier: 'kette',
  daker: 'kette', illyrer: 'kette',
  sarmaten: 'schuppe', parther: 'schuppe',
};

const ARMOUR_METAL = geteilteSammlung({
  schiene: new THREE.MeshStandardMaterial({ color: '#b9bcc0', roughness: 0.45, metalness: 0.55 }),
  bronze: new THREE.MeshStandardMaterial({ color: '#c08b3e', roughness: 0.4, metalness: 0.55 }),
  leinen: new THREE.MeshStandardMaterial({ color: '#ded0a8', roughness: 0.95 }),
  kette: new THREE.MeshStandardMaterial({ color: '#8b8f94', roughness: 0.6, metalness: 0.4 }),
  schuppe: new THREE.MeshStandardMaterial({ color: '#7d6a4a', roughness: 0.55, metalness: 0.3 }),
});

function buildArmourStand(factionId, colour) {
  const art = ARMOUR_STYLE[factionId] || 'kette';
  const metall = ARMOUR_METAL[art];
  const group = new THREE.Group();
  const tuch = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9 });

  // Ein Podest wie unter dem Thron: ohne es steckt die Rüstung bis zur Brust
  // hinter dem Kartentisch, und zu sehen ist nur ein Helm.
  tentBox(group, TENT_MATERIALS.darkWood, 2.0, 0.24, 1.6, 0, 0, 0);
  tentBox(group, TENT_MATERIALS.darkWood, 1.6, 0.24, 1.3, 0, 0.24, 0);

  // --- Der Rüstungsständer -------------------------------------------------
  // Kein Pfahl mit einem Querholz, sondern ein Ständer, wie er in einer
  // Waffenkammer steht: dreibeiniger Fuß, gedrechselte Säule, darüber eine
  // hölzerne Büste - Brustform, Schultern, Halsklotz. Die Rüstung hängt nicht
  // in der Luft, sie steckt auf etwas.
  const teller = new THREE.Mesh(
    new THREE.CylinderGeometry(0.52, 0.6, 0.14, 12), TENT_MATERIALS.darkWood
  );
  teller.position.y = 0.55;
  group.add(teller);
  for (let i = 0; i < 3; i++) {
    const winkel = (i / 3) * Math.PI * 2 + 0.4;
    const fuss = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.07, 0.62, 5), TENT_MATERIALS.darkWood
    );
    fuss.position.set(Math.cos(winkel) * 0.34, 0.72, Math.sin(winkel) * 0.34);
    fuss.rotation.set(Math.sin(winkel) * -0.3, 0, Math.cos(winkel) * 0.3);
    group.add(fuss);
  }
  // Die Säule, in der Mitte durch einen Wulst geteilt.
  const saeule = new THREE.Mesh(
    new THREE.CylinderGeometry(0.085, 0.105, 1.5, 8), TENT_MATERIALS.wood
  );
  saeule.position.y = 1.45;
  group.add(saeule);
  const wulst = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.045, 6, 12), TENT_MATERIALS.wood);
  wulst.rotation.x = Math.PI / 2;
  wulst.position.y = 1.45;
  group.add(wulst);

  // Die Büste: eine Brustform, die sich nach oben verjüngt, mit zwei
  // Schulterstücken und einem Halsklotz für den Helm.
  const bueste = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.2, 1.1, 10), TENT_MATERIALS.wood
  );
  bueste.position.y = 2.72;
  group.add(bueste);
  for (const side of [-1, 1]) {
    const schulter = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), TENT_MATERIALS.wood);
    schulter.position.set(side * 0.29, 3.14, 0);
    schulter.scale.set(1, 0.75, 0.85);
    group.add(schulter);
  }
  const hals = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.15, 0.28, 8), TENT_MATERIALS.wood
  );
  hals.position.y = 3.32;
  group.add(hals);

  // Der Untergewand-Rock unter dem Panzer, in der Farbe des Reichs.
  const rock = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.44, 0.62, 10), tuch);
  rock.position.y = 2.02;
  group.add(rock);

  // Der Panzer selbst - dieselbe Grundform, verschieden ausgeführt.
  const panzer = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 1.05, 10), metall);
  panzer.position.y = 2.72;
  group.add(panzer);
  if (art === 'schiene') {
    // Drei Schienen um den Leib und die Schulterplatten darüber.
    for (const y of [2.4, 2.68, 2.96]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 5, 14), metall);
      band.rotation.x = Math.PI / 2;
      band.position.y = y;
      group.add(band);
    }
    for (const side of [-1, 1]) {
      const schulter = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 5, 10, Math.PI), metall);
      schulter.position.set(side * 0.36, 3.22, 0);
      schulter.rotation.set(0, 0, side * 0.5);
      group.add(schulter);
    }
  } else if (art === 'bronze') {
    // Der Muskelpanzer: eine angedeutete Brust, dazu der Schulterschutz.
    for (const side of [-1, 1]) {
      const brust = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), metall);
      brust.position.set(side * 0.16, 2.98, 0.28);
      brust.scale.set(1, 0.8, 0.5);
      group.add(brust);
    }
    tentBox(group, metall, 0.92, 0.15, 0.44, 0, 3.14, 0);
  } else if (art === 'schuppe') {
    // Schuppen: drei Reihen kleiner Plättchen über dem Panzer.
    for (let reihe = 0; reihe < 3; reihe++) {
      for (let i = 0; i < 10; i++) {
        const winkel = (i / 10) * Math.PI * 2;
        const platte = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.04), metall);
        platte.position.set(
          Math.sin(winkel) * 0.4, 2.4 + reihe * 0.28, Math.cos(winkel) * 0.4
        );
        platte.rotation.y = winkel;
        group.add(platte);
      }
    }
  } else if (art === 'kette') {
    // Das Kettenhemd hängt über die Hüfte und trägt eine Schulterlage.
    const saum = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.32, 10), metall);
    saum.position.y = 2.26;
    group.add(saum);
    const lage = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.38, 0.3, 10), metall);
    lage.position.y = 3.12;
    group.add(lage);
  } else {
    // Leinen: die Schulterlaschen, die über die Brust gebunden werden.
    for (const side of [-1, 1]) {
      const lasche = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.14), metall);
      lasche.position.set(side * 0.22, 3.12, 0.26);
      lasche.rotation.x = 0.3;
      group.add(lasche);
    }
    // Und der Zaddelsaum unten.
    for (let i = 0; i < 10; i++) {
      const winkel = (i / 10) * Math.PI * 2;
      const zaddel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.26, 0.06), metall);
      zaddel.position.set(Math.sin(winkel) * 0.42, 2.12, Math.cos(winkel) * 0.42);
      zaddel.rotation.y = winkel;
      group.add(zaddel);
    }
  }

  // Der Helm auf dem Ständer.
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    metall);
  helm.position.y = 3.42;
  group.add(helm);
  const rand = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.045, 5, 12), metall);
  rand.rotation.x = Math.PI / 2;
  rand.position.y = 3.42;
  group.add(rand);
  if (art === 'schiene') {
    // Der Querbusch des Zenturio - quer, nicht längs.
    const busch = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.1), tuch);
    busch.position.y = 3.74;
    group.add(busch);
    // Wangenklappen.
    for (const side of [-1, 1]) {
      const klappe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24, 0.2), metall);
      klappe.position.set(side * 0.25, 3.34, 0.06);
      group.add(klappe);
    }
  } else if (art === 'bronze') {
    // Der hohe Helmbusch, längs über den Scheitel.
    const busch = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.24, 0.66), tuch);
    busch.position.y = 3.76;
    group.add(busch);
    const nase = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24, 0.06), metall);
    nase.position.set(0, 3.34, 0.26);
    group.add(nase);
  } else if (art === 'schuppe') {
    // Die Spitzhaube der Steppe.
    const spitze = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.42, 8), metall);
    spitze.position.y = 3.62;
    group.add(spitze);
  } else if (art === 'kette') {
    // Eine schlichte Eisenkappe mit Nackenschutz.
    const nacken = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.16), metall);
    nacken.position.set(0, 3.36, -0.2);
    group.add(nacken);
  } else {
    // Der Kegelhelm des Westens mit einem Federbusch.
    const kegel = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.3, 8), metall);
    kegel.position.y = 3.56;
    group.add(kegel);
    const feder = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.07), tuch);
    feder.position.y = 3.86;
    group.add(feder);
  }

  // Der Schild lehnt am Bock, mit dem Wappen darauf. Rom trägt den langen
  // Scutum, der Norden den ovalen, der Süden und Osten den runden.
  const schildForm = art === 'schiene' ? 'lang' : art === 'kette' ? 'oval' : 'rund';
  const wappen = new THREE.MeshStandardMaterial({
    map: emblemTexture(factionId, colour), side: THREE.DoubleSide, roughness: 1,
  });
  let schild;
  if (schildForm === 'lang') {
    schild = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.5), wappen);
  } else if (schildForm === 'oval') {
    schild = new THREE.Mesh(new THREE.CircleGeometry(0.62, 20), wappen);
    schild.scale.set(0.72, 1.25, 1);
  } else {
    schild = new THREE.Mesh(new THREE.CircleGeometry(0.68, 20), wappen);
  }
  schild.position.set(-1.05, 2.3, 0.5);
  schild.rotation.set(-0.14, 0.42, 0.12);
  group.add(schild);

  // Und der Speer daneben, an das Querholz gelehnt.
  const schaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 3.4, 6), TENT_MATERIALS.wood
  );
  schaft.position.set(1.0, 2.35, -0.1);
  schaft.rotation.z = -0.16;
  group.add(schaft);
  const spitze = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 6), metall);
  spitze.position.set(1.28, 4.1, -0.1);
  spitze.rotation.z = -0.16;
  group.add(spitze);

  return group;
}

// Setzt den ganzen Hintergrund zusammen und stellt ihn dem Betrachter
// gegenüber - dorthin, wohin die Grundansicht der Kamera blickt.
function buildTentBackdrop(tent, state, colour, floorY) {
  const player = state.factions.find((f) => f.isPlayer);
  const id = player ? player.id : 'neutral';
  const stage = new THREE.Group();

  const throne = buildThrone(THRONE_STYLE[id] || 'wood', colour);
  throne.scale.setScalar(1.25);
  stage.add(throne);
  for (const side of [-1, 1]) {
    const standard = buildFieldStandard(id, colour);
    standard.position.set(side * 3.4, 0, -0.3);
    stage.add(standard);
  }
  // Die Rüstung des Reichs auf ihrem Bock, links neben dem Thron.
  const ruestung = buildArmourStand(id, colour);
  // Neben dem Thron, aber nicht davor: weiter hinten steht der Ständer höher
  // im Bild, und man sieht ihn ganz statt nur den Helm über der Tischkante.
  // Etwas größer als der Thron es vorgäbe - sie ist das Stück, an dem man
  // sieht, wessen Heer man führt, und war dafür eine Spur zu klein.
  ruestung.scale.setScalar(1.22);
  ruestung.position.set(-5.7, 0, -1.6);
  ruestung.rotation.y = 0.5;
  stage.add(ruestung);

  const furnishings = TENT_FURNISHINGS[id] || ['shields', 'spears'];
  furnishings.forEach((kind, index) => {
    const build = FURNISHING_BUILDERS[kind];
    if (!build) return;
    const piece = new THREE.Group();
    build(piece, colour);
    piece.position.set((index === 0 ? -1 : 1) * 5.8, 0, 1.1);
    piece.rotation.y = (index === 0 ? 1 : -1) * 0.42;
    stage.add(piece);
  });

  // Auf Zeltmaß bringen und in die Blickachse der Grundansicht stellen.
  const scale = 26;
  stage.scale.setScalar(scale);
  // Fester Abstand hinter dem Tisch, nicht am Zeltrand: sonst rückte der Thron
  // mit jeder Vergrößerung des Zelts weiter fort.
  const away = 380;
  stage.position.set(
    -Math.cos(DEFAULT_AZIMUTH) * away, floorY, -Math.sin(DEFAULT_AZIMUTH) * away
  );
  stage.rotation.y = Math.PI / 2 - DEFAULT_AZIMUTH;
  tent.add(stage);
  return stage;
}

// --- Der Zeltausgang -------------------------------------------------------
// Ein Zelt ohne Ausgang ist eine Kiste. Die Bahnen sind an einer Stelle
// zurückgeschlagen und mit Stricken an zwei Pfosten gebunden; dahinter steht
// das Tageslicht des Lagers. Hinausgehen kann man nicht - der Feldzug wird an
// diesem Tisch geführt -, aber man sieht, dass es ein Draußen gibt.
// Was draußen zu sehen ist, richtet sich danach, wo das Heer steht: das
// Umland der eigenen Hauptstadt. Gezählt werden die Felder in einem Umkreis
// von vier; was überwiegt, bestimmt das Bild vor dem Zelt.
const OUTSIDE_LOOKS = {
  plains: { boden: '#c3ad72', ferne: '#7d9455', art: 'baeume', himmel: '#a9cdec' },
  forest: { boden: '#94975e', ferne: '#3f6a37', art: 'wald', himmel: '#9dc4e4' },
  hills: { boden: '#bda872', ferne: '#7b8352', art: 'huegel', himmel: '#a9cdec' },
  mountain: { boden: '#a89f92', ferne: '#5d6472', art: 'berge', himmel: '#9cbfe4' },
  desert: { boden: '#e0c88a', ferne: '#c9a866', art: 'duenen', himmel: '#e6d9a8' },
  water: { boden: '#cbb98a', ferne: '#2f6f9c', art: 'kueste', himmel: '#a6cdea' },
};

// Nicht jedes Feld zählt gleich viel. Ebene ist der Regelfall und sagt am
// wenigsten; ein Gebirge, eine Wüste, ein Wald oder das Meer vor dem Zelt sagt
// alles. Ohne diese Gewichte sähen zwölf von sechzehn Fraktionen auf dieselbe
// Wiese hinaus, weil das Hinterland überall Ebene ist.
const OUTSIDE_WEIGHT = {
  water: 1.6, mountain: 2.4, desert: 2.0, forest: 1.6, hills: 1.5, plains: 1,
};

function outsideLook(state) {
  const spieler = state.factions.find((f) => f.isPlayer);
  const sitz = state.cities.find((c) => spieler && c.factionId === spieler.id && c.capital)
    || state.cities.find((c) => spieler && c.factionId === spieler.id);
  if (!sitz || !state.map) return { ...OUTSIDE_LOOKS.plains, sitz: null };
  const zaehler = {};
  const weite = 4;
  for (let dr = -weite; dr <= weite; dr++) {
    const row = state.map.tiles[sitz.row + dr];
    if (!row) continue;
    for (let dc = -weite; dc <= weite; dc++) {
      const tile = row[sitz.col + dc];
      if (!tile) continue;
      zaehler[tile.type] = (zaehler[tile.type] || 0) + (OUTSIDE_WEIGHT[tile.type] || 1);
    }
  }
  let art = 'plains';
  for (const typ of Object.keys(zaehler)) {
    if (zaehler[typ] > (zaehler[art] || 0)) art = typ;
  }
  const look = { ...(OUTSIDE_LOOKS[art] || OUTSIDE_LOOKS.plains), sitz };
  // Vor einer Küste liegt der Strand, und ein Strand hat die Farbe des Landes
  // dahinter: bei Alexandria Wüstensand, bei Camulodunum Gras.
  if (art === 'water') {
    let land = 'plains';
    for (const typ of Object.keys(zaehler)) {
      if (typ === 'water') continue;
      if (zaehler[typ] > (zaehler[land] || 0)) land = typ;
    }
    look.boden = (OUTSIDE_LOOKS[land] || OUTSIDE_LOOKS.plains).boden;
  }
  return look;
}

// Für die Prüfläufe: welche Landschaft draußen gewählt wurde.
let outsideChosen = null;
export function outsideProbe() {
  return outsideChosen;
}

// Die Landschaft vor dem Zeltausgang: drei Ebenen als Schattenriss - der
// Fernblick, ein mittlerer Streifen und das Lager davor. Alles flach und
// gestaffelt; von innen sieht man ohnehin nur den Ausschnitt der Tür.
function buildOutsideScenery(doorway, look, width, horizon, stoffe) {
  const fern = new THREE.MeshBasicMaterial({
    color: look.ferne, fog: false, side: THREE.DoubleSide,
  });
  const mittel = new THREE.MeshBasicMaterial({
    color: new THREE.Color(look.ferne).lerp(new THREE.Color('#1e3a1c'), 0.35), fog: false,
    side: THREE.DoubleSide,
  });

  // Vor der hellen Fläche heißt: in Richtung des Betrachters, und das ist im
  // Türrahmen die negative z-Achse - dieselbe, an der auch der Bodenstreifen
  // davor liegt. Flache Stücke, die dahinter lägen, wären schlicht unsichtbar.
  const setze = (mesh, x, y, tiefe) => {
    mesh.position.set(x, y, -tiefe);
    doorway.add(mesh);
    if (stoffe && !stoffe.includes(mesh.material)) stoffe.push(mesh.material);
  };

  if (look.art === 'berge') {
    // Zacken, dahinter Schnee auf den höchsten.
    const schnee = new THREE.MeshBasicMaterial({
      color: '#e8eef5', fog: false, side: THREE.DoubleSide,
    });
    for (const [x, breite, hoehe] of [[-104, 92, 72], [-34, 112, 96], [42, 96, 80],
      [108, 76, 62]]) {
      const berg = new THREE.Mesh(new THREE.ConeGeometry(breite * 0.6, hoehe, 3), fern);
      setze(berg, x, horizon * 0.86 + hoehe / 2, 0.6);
      berg.rotation.y = Math.PI / 6;
      const kappe = new THREE.Mesh(new THREE.ConeGeometry(breite * 0.24, hoehe * 0.34, 3), schnee);
      setze(kappe, x, horizon * 0.86 + hoehe - hoehe * 0.17, 0.7);
      kappe.rotation.y = Math.PI / 6;
    }
  } else if (look.art === 'huegel') {
    for (const [x, breite, hoehe] of [[-108, 150, 44], [-6, 190, 58], [104, 158, 48]]) {
      const kuppe = new THREE.Mesh(new THREE.CircleGeometry(breite / 2, 16, 0, Math.PI), fern);
      setze(kuppe, x, horizon * 0.84, 0.6);
      kuppe.scale.set(1, (hoehe / (breite / 2)), 1);
    }
  } else if (look.art === 'duenen') {
    for (const [x, breite, hoehe] of [[-112, 180, 30], [4, 220, 40], [116, 168, 34]]) {
      const duene = new THREE.Mesh(new THREE.CircleGeometry(breite / 2, 18, 0, Math.PI), fern);
      setze(duene, x, horizon * 0.82, 0.6);
      duene.scale.set(1, (hoehe / (breite / 2)), 1);
    }
  } else if (look.art === 'kueste') {
    // Ein Streifen Wasser bis zum Horizont, darauf ein Segel.
    const tiefe = horizon * 0.62;
    const see = new THREE.Mesh(new THREE.PlaneGeometry(width, tiefe), fern);
    setze(see, 0, horizon - tiefe / 2, 0.55);
    const segel = new THREE.Mesh(new THREE.ConeGeometry(13, 30, 3), new THREE.MeshBasicMaterial({
      color: '#f0e7cf', fog: false, side: THREE.DoubleSide,
    }));
    setze(segel, 74, horizon - tiefe * 0.4, 0.65);
    const rumpf = new THREE.Mesh(new THREE.BoxGeometry(38, 7, 2), new THREE.MeshBasicMaterial({
      color: '#5a3d24', fog: false, side: THREE.DoubleSide,
    }));
    setze(rumpf, 74, horizon - tiefe * 0.4 - 16, 0.66);
    // Und ein zweites, kleiner und weiter draußen.
    const segel2 = segel.clone();
    setze(segel2, -96, horizon - tiefe * 0.72, 0.6);
    segel2.scale.setScalar(0.6);
  } else {
    // Wald und Ebene: eine Reihe Bäume, im Wald dicht, in der Ebene vereinzelt.
    const wald = look.art === 'wald';
    const kuppe = new THREE.Mesh(new THREE.CircleGeometry(132, 18, 0, Math.PI), fern);
    setze(kuppe, -12, horizon * 0.84, 0.55);
    kuppe.scale.set(1, 0.28, 1);
    const stellen = wald
      ? [-152, -122, -92, -62, -32, -2, 28, 58, 88, 118, 148]
      : [-140, -78, -18, 44, 104, 158];
    stellen.forEach((x, i) => {
      const hoehe = wald ? 42 + (i % 3) * 11 : 38 + (i % 2) * 12;
      const baum = new THREE.Mesh(new THREE.ConeGeometry(hoehe * 0.26, hoehe, 5), mittel);
      setze(baum, x, horizon * 0.55 + hoehe / 2, 0.75);
      const stamm = new THREE.Mesh(new THREE.BoxGeometry(6, hoehe * 0.3, 3),
        new THREE.MeshBasicMaterial({ color: '#3f2d18', fog: false }));
      setze(stamm, x, horizon * 0.55, 0.76);
    });
  }
}

function buildTentExit(tent, state, colour, floorY) {
  const doorway = new THREE.Group();
  const width = 250;
  const height = TENT_WALL * 0.94;

  // Draußen: oben der Himmel, unten der Boden des Lagers. Eine einzelne helle
  // Fläche reichte nicht - die Zeltbahn ist selbst hell, und ohne den kühlen
  // Himmel darüber liest sich das Loch nicht als Ausgang, sondern als Fleck.
  const horizon = height * 0.42;
  // Welche Landschaft draußen liegt, sagt das Umland der eigenen Hauptstadt:
  // wer von Ägypten aus Krieg führt, soll aus dem Zelt in die Wüste sehen und
  // nicht auf dieselbe Wiese wie der Germane.
  const look = outsideLook(state);
  outsideChosen = { art: look.art, ort: look.sitz ? look.sitz.name : null };
  // Alles, was „draußen" ist, wird am Ende auf den Türausschnitt beschnitten -
  // ein Baum, der neben dem Rahmen im Zelt steht, ist kein Ausblick.
  const draussen = [];
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height - horizon),
    new THREE.MeshBasicMaterial({ color: look.himmel, side: THREE.DoubleSide, fog: false })
  );
  sky.position.y = horizon + (height - horizon) / 2;
  doorway.add(sky);
  draussen.push(sky.material);
  const outside = new THREE.Mesh(
    new THREE.PlaneGeometry(width, horizon),
    new THREE.MeshBasicMaterial({ color: look.boden, side: THREE.DoubleSide, fog: false })
  );
  outside.position.y = horizon / 2;
  doorway.add(outside);
  draussen.push(outside.material);

  // Und darauf die Landschaft: Berge, Hügel, Dünen, Wald oder eine Küste.
  buildOutsideScenery(doorway, look, width, horizon, draussen);

  // Ein Streifen Boden davor, damit der Ausgang nicht in der Luft hängt.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width, 46),
    new THREE.MeshBasicMaterial({ color: look.boden, side: THREE.DoubleSide, fog: false })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0.5, -22);
  doorway.add(ground);
  draussen.push(ground.material);

  // Das Lager draußen: ein paar Zeltspitzen als Schattenriss vor dem Licht.
  // Sie liegen dicht vor der hellen Fläche, nicht dahinter - was hinter der
  // Zeltwand steht, wäre von innen ohnehin verdeckt.
  const silhouette = new THREE.MeshBasicMaterial({ color: '#6f6144', fog: false });
  for (const [x, size] of [[-92, 30], [-30, 40], [40, 26], [96, 34]]) {
    const hut = new THREE.Mesh(new THREE.ConeGeometry(size * 0.62, size, 4), silhouette);
    hut.position.set(x, horizon * 0.3 + size / 2, -1.6);
    hut.rotation.y = Math.PI / 4;
    doorway.add(hut);
  }
  draussen.push(silhouette);
  // Zwei Wachen vor dem Zelt, in der Farbe des Reichs: Speer und Schild.
  const wacheTuch = new THREE.MeshBasicMaterial({ color: colour, fog: false });
  const wacheDunkel = new THREE.MeshBasicMaterial({ color: '#3a2c1c', fog: false });
  for (const [x, hoehe] of [[-118, 46], [122, 44]]) {
    const leib = new THREE.Mesh(new THREE.CylinderGeometry(6, 8, hoehe * 0.62, 5), wacheTuch);
    leib.position.set(x, horizon * 0.16 + hoehe * 0.31, -2.2);
    doorway.add(leib);
    const kopf = new THREE.Mesh(new THREE.SphereGeometry(5.5, 7, 6), wacheTuch);
    kopf.position.set(x, horizon * 0.16 + hoehe * 0.7, -2.2);
    doorway.add(kopf);
    const speer = new THREE.Mesh(new THREE.BoxGeometry(1.8, hoehe * 1.25, 1.8), wacheDunkel);
    speer.position.set(x + 9, horizon * 0.16 + hoehe * 0.55, -2.2);
    doorway.add(speer);
  }
  draussen.push(wacheTuch, wacheDunkel);

  // Pfosten und Sturz.
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(5, 6, height + 14, 7), TABLE_WOOD_DARK
    );
    post.position.set(side * (width / 2 + 5), (height + 14) / 2, 4);
    doorway.add(post);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(width + 26, 9, 9), TABLE_WOOD_DARK);
  lintel.position.set(0, height + 6, 4);
  doorway.add(lintel);

  // Die zurückgeschlagenen Bahnen links und rechts, in der Farbe des Zelts.
  const flapMaterial = new THREE.MeshStandardMaterial({
    map: tentFabric(colour), side: THREE.DoubleSide, roughness: 1, color: '#e8dcc0',
  });
  for (const side of [-1, 1]) {
    const flap = new THREE.Mesh(new THREE.PlaneGeometry(64, height), flapMaterial);
    flap.position.set(side * (width / 2 - 16), height / 2, 20);
    flap.rotation.y = side * 0.85;
    doorway.add(flap);
    // Der Strick, mit dem die Bahn zurückgebunden ist.
    const rope = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 34, 5),
      new THREE.MeshStandardMaterial({ color: '#b9a170', roughness: 1 })
    );
    rope.rotation.z = Math.PI / 2;
    rope.position.set(side * (width / 2 - 4), height * 0.55, 16);
    doorway.add(rope);
  }

  // Etwas Licht fällt herein.
  const glow = new THREE.PointLight('#ffeec4', 0.5, 420);
  glow.position.set(0, height * 0.6, 60);
  doorway.add(glow);

  // Quer zur Grundansicht, damit der Ausgang neben dem Thron im Bild liegt und
  // ihn nicht verdeckt.
  // Deutlich innerhalb des Zeltrands: die Wand ist ein Sechzehneck, ihre
  // Flächen liegen in der Mitte jedes Segments gut zehn Einheiten weiter innen
  // als der Radius - ein Ausgang direkt an der Radiuslinie verschwände bis auf
  // einen schmalen Streifen dahinter.
  const angle = DEFAULT_AZIMUTH - Math.PI / 2;
  const seat = TENT_RADIUS * Math.cos(Math.PI / 16) - 26;
  doorway.position.set(Math.cos(angle) * seat, floorY, Math.sin(angle) * seat);
  doorway.rotation.y = -angle + Math.PI / 2;
  tent.add(doorway);

  // Der Ausschnitt: vier Ebenen um die Türöffnung. Was draußen liegt, wird
  // daran beschnitten - ein Berg ist breiter als eine Tür, und eine Baumreihe
  // reicht weiter als der Rahmen. Vorher standen die Ausläufer neben dem
  // Rahmen mitten im Zelt.
  doorway.updateMatrixWorld(true);
  const punkt = (x, y) => doorway.localToWorld(new THREE.Vector3(x, y, 0));
  const achse = (x, y) => punkt(x, y).sub(punkt(0, 0)).normalize();
  const xAchse = achse(1, 0);
  const yAchse = achse(0, 1);
  const rand = width / 2;
  const schnitt = [
    new THREE.Plane().setFromNormalAndCoplanarPoint(xAchse.clone().negate(), punkt(rand, 0)),
    new THREE.Plane().setFromNormalAndCoplanarPoint(xAchse.clone(), punkt(-rand, 0)),
    new THREE.Plane().setFromNormalAndCoplanarPoint(yAchse.clone().negate(), punkt(0, height)),
    new THREE.Plane().setFromNormalAndCoplanarPoint(yAchse.clone(), punkt(0, 0)),
  ];
  for (const stoff of draussen) {
    stoff.clippingPlanes = schnitt;
    stoff.needsUpdate = true;
  }
}

// Eine Gruppe aus der Szene nehmen und alles darin freigeben - Geometrien
// und Materialien, die Three.js sonst im Speicher hielte, obwohl niemand mehr
// darauf zeigt.
function disposeGroup(group) {
  if (!group) return;
  if (group.parent) group.parent.remove(group);
  group.traverse((obj) => {
    // Geometrien gehören meist dem einen Mesh, für das sie gebaut wurden - drei
    // Ausnahmen gibt es: die Gestalten der Marschierer und alles sonst
    // Markierte gehören dem Modul, und jedes Schild (`Sprite`) teilt sich sein
    // Viereck mit allen anderen Schildern - das gehört three.js selbst, und
    // wer es abräumt, nimmt es auch jedem Namensschild auf der Karte weg.
    const eigeneGeometrie = obj.geometry && !obj.isSprite
      && !obj.userData.sharedGeom && !obj.geometry.userData.geteilt;
    if (eigeneGeometrie) obj.geometry.dispose();
    const materialien = Array.isArray(obj.material) ? obj.material
      : obj.material ? [obj.material] : [];
    for (const material of materialien) {
      // Was dem Modul gehört, bleibt stehen (siehe `geteilt`): das dunkle
      // Tischholz trägt auch den Tisch, die Wappen hängen auch an den Fahnen.
      if (material.userData.geteilt) continue;
      // Die Zeltbahn ihrerseits gehört dem Material, das sie trägt - sie wird
      // für jedes Zelt neu gemalt und ginge sonst als einziges nicht mit.
      for (const feld of ['map', 'alphaMap', 'emissiveMap', 'normalMap', 'roughnessMap', 'bumpMap']) {
        const textur = material[feld];
        if (textur && !textur.userData.geteilt) textur.dispose();
      }
      material.dispose();
    }
  });
}

function buildTent(state) {
  // Ein Zelt aus einem vorigen Feldzug in derselben Sitzung wird ganz
  // abgeräumt, nicht nur aus der Szene genommen - sonst hielte jeder neue
  // Feldzug das Geländer des alten mit im Speicher.
  disposeGroup(tentGroup);
  tentGroup = new THREE.Group();
  tentGroup.name = 'Zelt';
  const player = factionById(state, (state.factions.find((f) => f.isPlayer) || {}).id);
  const colour = player ? player.color : '#8a6134';
  const radius = TENT_RADIUS;
  const height = TENT_HEIGHT;

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 1.02, 32),
    new THREE.MeshStandardMaterial({ color: '#4a3b26', roughness: 1 })
  );
  floor.rotation.x = -Math.PI / 2;
  // Der Boden liegt so tief unter der Tischplatte, wie die Tischbeine lang
  // sind: nur dann steht der Tisch auf etwas, statt im Raum zu schweben.
  floor.position.y = tileTopY(TILE_TYPES.water.elevation) - 2.6 - TABLE_LEG_HEIGHT;
  tentGroup.add(floor);

  // Das Dach: ein Kegel von innen gesehen.
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(radius, height, 16, 1, true),
    new THREE.MeshStandardMaterial({
      map: tentFabric(colour), side: THREE.BackSide, roughness: 1,
    })
  );
  roof.position.y = floor.position.y + TENT_WALL + height / 2 - 8;
  tentGroup.add(roof);

  // Die Wände: ein niedriger Zylinder unter dem Dach, damit das Zelt steht
  // und nicht auf dem Boden aufsitzt.
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, TENT_WALL, 16, 1, true),
    new THREE.MeshStandardMaterial({
      map: tentFabric(colour), side: THREE.BackSide, roughness: 1, color: '#e8dcc0',
    })
  );
  wall.position.y = floor.position.y + TENT_WALL / 2;
  tentGroup.add(wall);

  // Fahnen an den Zeltbahnen: sie sagen auf einen Blick, wessen Zelt das ist -
  // in der Farbe der Fraktion und mit ihrem Zeichen darauf.
  const bannerMaterial = new THREE.MeshStandardMaterial({
    map: emblemTexture(player ? player.id : 'neutral', colour),
    side: THREE.DoubleSide,
    roughness: 1,
    transparent: true,
  });
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(58, 96), bannerMaterial);
    banner.position.set(
      Math.cos(angle) * (radius - 10), floor.position.y + TENT_WALL * 0.62, Math.sin(angle) * (radius - 10)
    );
    banner.rotation.y = -angle + Math.PI / 2;
    tentGroup.add(banner);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(66, 4, 4), TABLE_WOOD_DARK);
    bar.position.copy(banner.position);
    bar.position.y += 50;
    bar.rotation.y = banner.rotation.y;
    tentGroup.add(bar);
  }

  // Ein paar Stangen, damit man die Größe des Zelts sieht.
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 3.8, TENT_WALL, 6),
      TABLE_WOOD_DARK
    );
    pole.position.set(
      Math.cos(angle) * (radius - 5), floor.position.y + TENT_WALL / 2, Math.sin(angle) * (radius - 5)
    );
    tentGroup.add(pole);
  }

  // Thron, Feldzeichen und Ausrüstung: die Bühne der Ansprache. Sie bleibt ein
  // eigenes, unverbackenes Teilobjekt (siehe `keep` unten) - nur sie räumt
  // `hideTent` später ab, das Zelt selbst bleibt stehen.
  const stage = buildTentBackdrop(tentGroup, state, colour, floor.position.y);
  tentGroup.userData.stage = stage;
  buildTentExit(tentGroup, state, colour, floor.position.y);

  // Alles Holz und Metall im Zelt zu je einem Mesh; die Zeltbahnen mit ihrem
  // Stoffmuster bleiben eigene Meshes, und die Bühne bleibt unangetastet -
  // sie muss sich später als Ganzes wieder herauslösen lassen.
  bakeGroup(tentGroup, { keep: new Set([stage]) });
  scene.add(tentGroup);
}

// Die Bühne der Ansprache hat ihren Auftritt gehabt, sobald sie vorbei ist -
// stehen bliebe sie sonst für den Rest des Feldzugs mitten auf der Karte:
// Thron, Feldzeichen und die Schilde der Ausstattung stehen an einem festen
// Platz nahe der Kartenmitte, unabhängig davon, wo die eigene Hauptstadt
// liegt, und wer dorthin fährt, sähe sie zwischen den eigenen Feldern stehen.
// Das Zelt selbst - Wände, Dach, Boden, der Ausblick vor der Tür - bleibt
// stehen: es umschließt die Kamera nicht nur in der Eröffnungsansicht,
// sondern für den ganzen Feldzug, sooft man weit genug herauszoomt. Ohne das
// sähe man dort nur noch ins Leere, kaum anders als ein Loch im Himmel.
export function hideTent() {
  if (!tentGroup || !tentGroup.userData.stage) return;
  disposeGroup(tentGroup.userData.stage);
  tentGroup.userData.stage = null;
}

// Das Straßennetz als ein einziges Gitter: für jedes Straßenfeld ein Plättchen
// und je ein halber Balken zu jedem Straßennachbarn. Beide Hälften treffen
// sich in der Mitte, damit Kurven und Kreuzungen von selbst zusammenpassen.
let roadVersionDrawn = -1;

// Die Höhe an einer beliebigen Stelle des Geländes, nicht die der nächsten
// Feldmitte. Ein Band, das auf einer Feldgrenze liegt - und genau dort liegt
// ein Fluss -, bekäme sonst je Eckpunkt die Höhe irgendeines der vier
// angrenzenden Felder und liefe treppenförmig durchs Gelände.
function bandY(x, z) {
  const colF = x / TILE_SIZE + mapCols / 2;
  const rowF = z / TILE_SIZE + mapRows / 2;
  return Math.max(groundY(colF, rowF), SEA_LEVEL_Y);
}

// Ein Band mit Körper: die Oberseite und, wenn `schuerze` gesetzt ist, zwei
// Längsseiten, die an den Rändern in den Boden laufen.
//
// Ein Band aus einer einzigen Fläche ist ein Aufkleber. Von oben sieht das
// niemand, aber diese Karte wird schräg angesehen, und aus jeder anderen
// Richtung fehlt einem Aufkleber genau das, was ihn zu einem Weg macht: eine
// Kante. Straße und Fluss lagen deshalb wie aufgemalt auf dem Land, während
// Häuser, Bäume und Zelte danebenstanden - der Damm einer Straße und das Ufer
// eines Flusses gehören in dieselbe Perspektive wie alles andere.
function pushBand(positions, ax, az, bx, bz, halfWidth, lift = 0.18, schuerze = 0) {
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.hypot(dx, dz) || 1;
  const nx = (-dz / length) * halfWidth;
  const nz = (dx / length) * halfWidth;
  const corners = [
    [ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz],
  ];
  const oben = corners.map(([x, z]) => [x, bandY(x, z) + lift, z]);
  const dreieck = (p, q, r) => {
    positions.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
  };
  dreieck(oben[0], oben[1], oben[2]);
  dreieck(oben[0], oben[2], oben[3]);
  if (!schuerze) return;
  // Die beiden Längsseiten. Die Querseiten bleiben offen: dort stößt das
  // nächste Stück an, und an einem Ende sieht man sie im Schrägblick ohnehin
  // nicht.
  for (const [i, j] of [[0, 1], [2, 3]]) {
    const p = oben[i];
    const q = oben[j];
    const pu = [p[0], p[1] - schuerze, p[2]];
    const qu = [q[0], q[1] - schuerze, q[2]];
    dreieck(p, pu, q);
    dreieck(q, pu, qu);
  }
}

function pushQuad(positions, ax, az, bx, bz, halfWidth, lift = 0.18) {
  pushBand(positions, ax, az, bx, bz, halfWidth, lift, 0);
}

// --- Flüsse und Brücken ----------------------------------------------------
// Der Fluss läuft auf der Feldgrenze, nicht durch ein Feld: für jede Kante ein
// schmales Band entlang der gemeinsamen Kante, alle zu einer Geometrie
// verschmolzen. Wo eine Straße hinüberführt, liegt eine Brücke darüber - das
// ist genau die Stelle, an der ein Heer trockenen Fußes über den Fluss kommt.

let riversGroup = null;
// In so viele Stücke wird ein Uferstück zerlegt, und so hoch liegt es über
// dem Boden - hoch genug, dass ein Knick im Gelände es nicht verschluckt,
// flach genug, dass es nicht über der Landschaft schwebt.
const RIVER_PIECES = 5;
// Der Fluss **folgt dem Gelände**: jedes Uferstück wird in Teilstücke zerlegt,
// und jedes nimmt seine Höhe dort, wo es wirklich liegt. Eine Fassung lang lag
// die Wasserfläche stattdessen eben und über der höchsten Stelle ihrer Kante -
// gerade, aber im Hang wie ein Aquädukt aufgeständert. Ein Fluss läuft
// bergab, nicht waagerecht.
//
// **Wie breit, entscheidet das Land.** In der Ebene zieht ein Strom breit
// dahin; im Hügelland und im Gebirge steht der Fels bis ans Wasser, und der
// Lauf ist eingeengt und schmal. Uferstreifen aus Sand und Kies standen hier
// zweimal daneben - sie machten aus jedem Bach eine zweifarbige Trasse. Der
// Fluss ist Wasser und sonst nichts.
const RIVER_WIDTH_FLAT = 0.085;
const RIVER_WIDTH_STEEP = 0.052;
const RIVER_LIFT = 0.13;
const RIVER_SKIRT = 0.22;
// Steilland: dort ist der Lauf schmal.
const STEILES_LAND = new Set(['hills', 'mountain']);

// Die beiden Feldmitten einer Kante und der Punkt dazwischen.
function riverEdgeTiles(key, cols) {
  const [a, b] = key.split('|').map(Number);
  const ac = a % cols;
  const bc = b % cols;
  return {
    a: { col: ac, row: (a - ac) / cols },
    b: { col: bc, row: (b - bc) / cols },
  };
}

// --- Der Lauf als Linienzug ------------------------------------------------
// Ein Fluss wurde bisher Uferstück für Uferstück gezeichnet: für jede Feldkante
// ein eigenes Band, das ein Stück über die Ecke hinausragte, damit an den
// Knicken kein Zwickel offen blieb. Das ergab rechte Winkel - ein Fluss, der
// wie ein Straßenzug im Schachbrett abbiegt.
//
// Jetzt wird zuerst der **ganze Lauf** zusammengesetzt: aus den Kanten werden
// die Ecken des Rasters gewonnen, aus den Ecken ein Linienzug, und dessen
// Knicke werden **ausgerundet**. Gezeichnet wird danach ein durchgehendes Band
// entlang dieses Linienzugs - ohne Überlappungen, ohne Ecken.

// Die beiden Rasterecken, die ein Uferstück verbindet. Ecke (i, j) sitzt bei
// den Feldkoordinaten (i - 0,5 | j - 0,5).
function riverEdgeCorners(a, b) {
  if (a.row === b.row) {
    const i = Math.max(a.col, b.col);
    return [[i, a.row], [i, a.row + 1]];
  }
  const j = Math.max(a.row, b.row);
  return [[a.col, j], [a.col + 1, j]];
}

// Aus der Menge der Uferstücke die Linienzüge: erst ein Graph über die Ecken,
// dann von jedem freien Ende aus durchlaufen, und was danach übrig bleibt,
// sind Ringe.
// Aus einem Nachbarschaftsgraphen durchgehende Linienzüge machen. Dieselbe
// Arbeit für Flüsse wie für Straßen: beide sind im Kern ein Haufen einzelner
// Kanten, und beide sollen als *ein* Band gezeichnet werden, damit sie rund
// laufen und sich an den Knicken nicht überlappen.
//
// Die Knoten sind Zeichenketten "x,y"; der Aufrufer übersetzt sie danach in
// Weltpunkte. Zurück kommen Ketten von Knotennamen.
function zuegeAusGraph(graph) {
  const benutzt = new Set();
  const strichKey = (x, y) => (x < y ? `${x}>${y}` : `${y}>${x}`);
  const zuege = [];
  const punkt = (k) => k.split(',').map(Number);
  // An einer Gabelung geht es geradeaus weiter, nicht in den ersten besten
  // Ast: sonst bricht der Zug mitten im Lauf ab, und dort, wo zwei Züge
  // stumpf aneinanderstoßen, klafft im Band ein Keil.
  const geradeaus = (vorher, hier) => {
    const offenNach = (graph.get(hier) || []).filter((n) => !benutzt.has(strichKey(hier, n)));
    if (offenNach.length <= 1) return offenNach[0];
    const [hx, hy] = punkt(hier);
    const [vx, vy] = vorher ? punkt(vorher) : [hx, hy];
    const dx = hx - vx;
    const dy = hy - vy;
    let bester = offenNach[0];
    let bestes = -Infinity;
    for (const n of offenNach) {
      const [nx, ny] = punkt(n);
      const wert = (nx - hx) * dx + (ny - hy) * dy;
      if (wert > bestes) { bestes = wert; bester = n; }
    }
    return bester;
  };
  const laufe = (start) => {
    const zug = [start];
    let vorher = null;
    let hier = start;
    for (;;) {
      const weiter = geradeaus(vorher, hier);
      if (!weiter) break;
      benutzt.add(strichKey(hier, weiter));
      zug.push(weiter);
      vorher = hier;
      hier = weiter;
    }
    if (zug.length >= 2) zuege.push(zug);
  };
  // Erst von den freien Enden, dann von den Gabelungen, zuletzt aus Ringen:
  // ein Zug, der an einer Gabelung beginnt, wird sonst unnötig kurz.
  const offen = (ecke) => (graph.get(ecke) || [])
    .some((n) => !benutzt.has(strichKey(ecke, n)));
  for (const [ecke, nachbarn] of graph) if (nachbarn.length === 1) laufe(ecke);
  for (const [ecke, nachbarn] of graph) if (nachbarn.length > 2 && offen(ecke)) laufe(ecke);
  // Und dann so lange nachfassen, bis keine Kante mehr übrig ist. Ein einzelner
  // Durchlauf genügt nicht: eine Ecke, die beim Vorbeigehen noch geschlossen
  // war, kann später wieder offen sein, weil ein Zug an ihr abgebogen ist -
  // und genau diese eine Kante fehlte dann als Loch mitten im Band.
  for (;;) {
    let nachgefasst = false;
    for (const ecke of graph.keys()) {
      if (!offen(ecke)) continue;
      laufe(ecke);
      nachgefasst = true;
    }
    if (!nachgefasst) break;
  }
  return zuege;
}

function riverPolylines(rivers, cols) {
  const graph = new Map();
  const kante = (p, q) => {
    const pk = `${p[0]},${p[1]}`;
    const qk = `${q[0]},${q[1]}`;
    if (!graph.has(pk)) graph.set(pk, []);
    if (!graph.has(qk)) graph.set(qk, []);
    graph.get(pk).push(qk);
    graph.get(qk).push(pk);
  };
  for (const key of rivers) {
    const { a, b } = riverEdgeTiles(key, cols);
    const [p, q] = riverEdgeCorners(a, b);
    kante(p, q);
  }
  return zuegeAusGraph(graph).map((zug) => zug.map((k) => {
    const [i, j] = k.split(',').map(Number);
    return { x: worldX(i - 0.5), z: worldZ(j - 0.5) };
  }));
}

// Die Knicke ausrunden: an jedem Eckpunkt ein Stück zurück, ein Stück voraus,
// und dazwischen eine quadratische Bézierkurve durch die alte Ecke.
function roundPath(punkte, radius, stufen) {
  if (punkte.length < 3) return punkte.slice();
  const raus = [punkte[0]];
  const zwischen = (von, nach, weite) => {
    const dx = nach.x - von.x;
    const dz = nach.z - von.z;
    const len = Math.hypot(dx, dz) || 1;
    const t = Math.min(weite, len / 2) / len;
    return { x: von.x + dx * t, z: von.z + dz * t };
  };
  for (let i = 1; i < punkte.length - 1; i++) {
    const q = punkte[i];
    const ein = zwischen(q, punkte[i - 1], radius);
    const aus = zwischen(q, punkte[i + 1], radius);
    raus.push(ein);
    for (let k = 1; k < stufen; k++) {
      const t = k / stufen;
      const u = 1 - t;
      raus.push({
        x: u * u * ein.x + 2 * u * t * q.x + t * t * aus.x,
        z: u * u * ein.z + 2 * u * t * q.z + t * t * aus.z,
      });
    }
    raus.push(aus);
  }
  raus.push(punkte[punkte.length - 1]);
  return raus;
}

// Lange gerade Stücke unterteilen, damit das Band dem Gelände folgt.
function resamplePath(punkte, schritt) {
  const raus = [punkte[0]];
  for (let i = 1; i < punkte.length; i++) {
    const a = punkte[i - 1];
    const b = punkte[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const teile = Math.max(1, Math.ceil(len / schritt));
    for (let k = 1; k <= teile; k++) {
      const t = k / teile;
      raus.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return raus;
}

// Ein durchgehendes Band entlang eines Linienzugs. Die Breite darf sich von
// Punkt zu Punkt ändern - so läuft der Uferstreifen aus, wo der Fluss ins
// Bergland eintritt, statt abzubrechen.
function pushRibbon(positions, punkte, breiten, lift, schuerze) {
  const quer = [];
  for (let i = 0; i < punkte.length; i++) {
    const vor = punkte[Math.max(0, i - 1)];
    const nach = punkte[Math.min(punkte.length - 1, i + 1)];
    const dx = nach.x - vor.x;
    const dz = nach.z - vor.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * breiten[i];
    const nz = (dx / len) * breiten[i];
    const p = punkte[i];
    // Ein Wasserspiegel steht quer zum Lauf waagerecht - er kippt nicht mit
    // dem Ufer. Beide Ränder bekommen deshalb dieselbe Höhe, und zwar die
    // höchste des Querschnitts: sonst tauchte das Band dort, wo eine
    // Geländekante quer darunter durchläuft, in den Boden ein und riss ein
    // Loch mitten in den Fluss.
    const y = Math.max(
      bandY(p.x + nx, p.z + nz),
      bandY(p.x - nx, p.z - nz),
      bandY(p.x, p.z)
    ) + lift;
    quer.push([
      [p.x + nx, y, p.z + nz],
      [p.x - nx, y, p.z - nz],
    ]);
  }
  const dreieck = (a, b, c) => {
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  };
  for (let i = 1; i < quer.length; i++) {
    const [al, ar] = quer[i - 1];
    const [bl, br] = quer[i];
    dreieck(al, bl, br);
    dreieck(al, br, ar);
    if (!schuerze) continue;
    // Die Längsseiten, damit das Band im Schrägblick eine Kante hat.
    const senk = (p) => [p[0], p[1] - schuerze, p[2]];
    dreieck(al, senk(al), bl);
    dreieck(bl, senk(al), senk(bl));
    dreieck(ar, br, senk(ar));
    dreieck(br, senk(br), senk(ar));
  }
}

function buildRivers(state) {
  disposeGroup(riversGroup);
  riversGroup = new THREE.Group();
  riversGroup.name = 'Flüsse';
  scene.add(riversGroup);
  const rivers = state.map.rivers;
  if (!rivers || !rivers.size) return;

  const positions = [];
  const bridges = [];
  const half = TILE_SIZE / 2;
  const { cols, rows, tiles } = state.map;

  // Was für Land links und rechts des Laufs steht. Steht auch nur auf einer
  // Seite Fels, ist der Fluss eingeengt: schmal und ohne Uferstreifen.
  const feldBei = (x, z) => {
    const col = Math.round(x / TILE_SIZE + cols / 2);
    const row = Math.round(z / TILE_SIZE + rows / 2);
    return tiles[row] && tiles[row][col];
  };
  const istSteil = (p, nx, nz) => [1, -1].some((seite) => {
    const feld = feldBei(p.x + nx * seite * half, p.z + nz * seite * half);
    return feld && STEILES_LAND.has(feld.type);
  });
  const istWasser = (p) => {
    const feld = feldBei(p.x, p.z);
    return feld && feld.type === 'water';
  };

  // Wie weit die Mündung noch über die Küste hinausreicht - nur ein Saum, der
  // die Naht zum Meer schließt, keine ganze halbe Feldlänge. Der Linienzug
  // endet ohnehin schon an einer Rastercke, die selbst schon auf der
  // Küstenlinie liegt (Ecken der Wasserfelder, nicht ihre Mitte) - ein volles
  // halbes Feld darüber hinaus ließ den Fluss sichtbar als Zunge ins offene
  // Meer hineinragen, statt an seinem Rand zu enden.
  const muendungsSaum = half * 0.18;
  for (const roh of riverPolylines(rivers, cols)) {
    const zug = roh.slice();
    for (const ende of [0, 1]) {
      const i = ende ? zug.length - 1 : 0;
      const j = ende ? zug.length - 2 : 1;
      const p = zug[i];
      const q = zug[j];
      const dx = p.x - q.x;
      const dz = p.z - q.z;
      const len = Math.hypot(dx, dz) || 1;
      const weiter = { x: p.x + (dx / len) * muendungsSaum, z: p.z + (dz / len) * muendungsSaum };
      if (!istWasser(weiter)) continue;
      if (ende) zug.push(weiter); else zug.unshift(weiter);
    }
    // Ecken ausrunden, dann fein genug unterteilen fürs Gelände.
    const pfad = resamplePath(roundPath(zug, half * 0.8, 5), half * 0.3);
    // Für jeden Punkt die Breite - und danach geglättet, damit der Lauf sich
    // verengt statt abzusetzen, wo er ins Bergland eintritt.
    const rohBreiten = [];
    for (let i = 0; i < pfad.length; i++) {
      const vor = pfad[Math.max(0, i - 1)];
      const nach = pfad[Math.min(pfad.length - 1, i + 1)];
      const dx = nach.x - vor.x;
      const dz = nach.z - vor.z;
      const len = Math.hypot(dx, dz) || 1;
      const steil = istSteil(pfad[i], -dz / len, dx / len);
      rohBreiten.push(TILE_SIZE * (steil ? RIVER_WIDTH_STEEP : RIVER_WIDTH_FLAT));
    }
    const glatt = (werte) => werte.map((_, i) => {
      let summe = 0;
      let zahl = 0;
      for (let k = -2; k <= 2; k++) {
        const w = werte[i + k];
        if (w === undefined) continue;
        summe += w;
        zahl++;
      }
      return summe / zahl;
    });
    pushRibbon(positions, pfad, glatt(rohBreiten), RIVER_LIFT, RIVER_SKIRT);
  }

  const roads = state.roads || {};
  for (const key of rivers) {
    const { a, b } = riverEdgeTiles(key, cols);
    // Eine Brücke steht dort, wo eine Straße den Fluss quert - aber nicht am
    // Rand einer Stadt: dort führt der Weg durch den Ort, und ein Brückenbogen
    // stünde mitten in den Häusern. Für die Bewegung zählt der Übergang
    // trotzdem, die Stadt ist die Brücke.
    const amOrt = state.cities.some((city) => (city.col === a.col && city.row === a.row)
      || (city.col === b.col && city.row === b.row));
    if (amOrt) continue;
    if (!roads[`${a.col},${a.row}`] || !roads[`${b.col},${b.row}`]) continue;
    bridges.push({
      mx: (worldX(a.col) + worldX(b.col)) / 2,
      mz: (worldZ(a.row) + worldZ(b.row)) / 2,
      alongX: a.row === b.row,
    });
  }

  const bandMesh = (daten, material) => {
    if (!daten.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(daten), 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    riversGroup.add(mesh);
  };
  // Durchscheinend wie die See selbst (`waterMesh`, Deckkraft 0.82) - sonst
  // liegt an der Mündung ein blickdichter Flusslappen auf dem durchsichtigen
  // Meer, als Kante zu sehen, statt ineinander überzugehen.
  bandMesh(positions, new THREE.MeshStandardMaterial({
    color: '#3f7fb8', roughness: 0.35, side: THREE.DoubleSide,
    transparent: true, opacity: 0.82,
  }));

  for (const bridge of bridges) buildBridge(riversGroup, bridge);
}

// Eine Brücke, die den Namen verdient: ein leicht gewölbter Bogen von Ufer zu
// Ufer, das Geländer mit Pfosten, zwei Pfeiler im Wasser. Gebaut wird sie
// entlang der eigenen x-Achse und danach quer zum Fluss gedreht; die Höhe an
// beiden Enden kommt vom Gelände, damit sie an den Ufern aufsitzt und nicht
// darüber schwebt.
// Eine gerade Holzbrücke: ein flacher Bohlenbelag von Ufer zu Ufer, ein
// Geländer auf jeder Seite, Pfähle ins Flussbett gerammt. Kein Bogen, keine
// Wölbung - was ein Trupp Pioniere an einem Tag hinbekommt, und aus der
// Feldherrnperspektive auf Anhieb als Brücke zu lesen.
const BRIDGE_PILES = 3;

function buildBridge(parent, bridge) {
  const { mx, mz, alongX } = bridge;
  const dirX = alongX ? 1 : 0;
  const dirZ = alongX ? 0 : 1;
  const span = TILE_SIZE * 0.98;
  const half = span / 2;
  const bankA = bandY(mx - dirX * half, mz - dirZ * half);
  const bankB = bandY(mx + dirX * half, mz + dirZ * half);
  const base = Math.max(bankA, bankB);
  // Etwas breiter als die Straße, die darüber führt - eine Brücke, auf der
  // ein Karren gerade so Platz hat, ist keine.
  const width = ROAD_HALF * 2.4;
  // Knapp über dem Wasser: eine Holzbrücke steigt nicht an.
  const deck = 0.46;

  const group = new THREE.Group();

  // Der Belag - eine durchgehende Platte. Einzelne, gegeneinander gekippte
  // Bohlen lasen sich aus der Ferne als Schutthaufen und nicht als Brücke.
  const road = new THREE.Mesh(new THREE.BoxGeometry(span, 0.2, width), BRIDGE_TIMBER);
  road.position.y = deck - 0.1;
  group.add(road);

  // Zwei Querbalken unter dem Belag, auf denen er aufliegt.
  for (const side of [-1, 1]) {
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(span, 0.16, 0.16), BRIDGE_TIMBER_DARK
    );
    beam.position.set(0, deck - 0.26, side * width * 0.34);
    group.add(beam);
  }

  // Geländer: eine Latte auf Pfosten, auf beiden Seiten.
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(span, 0.09, 0.09), BRIDGE_TIMBER
    );
    rail.position.set(0, deck + 0.44, side * width * 0.44);
    group.add(rail);
    for (let i = 0; i <= BRIDGE_PILES + 1; i++) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.5, 0.11), BRIDGE_TIMBER_DARK
      );
      post.position.set(-half + (span / (BRIDGE_PILES + 1)) * i, deck + 0.2, side * width * 0.44);
      group.add(post);
    }
  }

  // Die Pfähle stehen im Wasser und tragen die Querbalken. Sie reichen unter
  // die Wasserlinie, damit sie nicht auf ihr aufzusitzen scheinen.
  const foot = Math.min(bankA, bankB) - base - 1.0;
  for (let i = 1; i <= BRIDGE_PILES; i++) {
    const x = -half + (span / (BRIDGE_PILES + 1)) * i;
    for (const side of [-1, 1]) {
      const height = deck - 0.26 - foot;
      const pile = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.12, height, 6), BRIDGE_TIMBER_DARK
      );
      pile.position.set(x, foot + height / 2, side * width * 0.34);
      group.add(pile);
    }
    // Eine Strebe quer, damit das Gerüst nicht wie aufgestellte Stäbe wirkt.
    const brace = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.09, width * 0.72), BRIDGE_TIMBER_DARK
    );
    brace.position.set(x, deck - 0.62, 0);
    group.add(brace);
  }

  // Die Auflager an den Ufern: ein Holzkasten, der den Belag abfängt.
  for (const [t, bank] of [[-1, bankA], [1, bankB]]) {
    const ground = bank - base - 0.4;
    const height = deck - 0.2 - ground;
    const sill = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, height, width * 1.06), BRIDGE_TIMBER_DARK
    );
    sill.position.set(t * (half - 0.25), ground + height / 2, 0);
    group.add(sill);
  }

  group.position.set(mx, base, mz);
  // Die Brücke liegt quer zum Fluss: läuft der Fluss in z-Richtung, führt sie
  // in x-Richtung darüber.
  group.rotation.y = alongX ? 0 : Math.PI / 2;
  parent.add(group);
}

const BRIDGE_TIMBER = geteilt(new THREE.MeshStandardMaterial({ color: '#a97c46', roughness: 0.95 }));
const BRIDGE_TIMBER_DARK = geteilt(new THREE.MeshStandardMaterial({ color: '#6f4d29', roughness: 1 }));

// Wie fein der Straßenzug unterteilt wird, damit das Band dem Gelände folgt,
// und wie weit die Kurven an den Knicken ausholen.
const ROAD_STEP = TILE_SIZE * 0.3;
const ROAD_ROUND = TILE_SIZE * 0.45;
const ROAD_ROUND_STUFEN = 5;
// Eine Straße ist so breit, dass zwei Karren aneinander vorbeikommen - also
// ungefähr so breit wie ein Haus lang ist, und nicht wie drei nebeneinander.
// Sie liegt auf einem Damm: die Schürze an den Rändern macht aus dem Band
// einen Körper, der von schräg oben eine Kante wirft.
const ROAD_HALF = TILE_SIZE * 0.105;
const ROAD_LIFT = 0.17;
const ROAD_SKIRT = 0.3;

// Straßen laufen in Kurven, nicht im Schachbrett. Sie wurden lange Feld für
// Feld gezeichnet - ein Kreuz je Feld und ein gerades Stück zum Nachbarn -,
// und dabei kam heraus, was dabei herauskommen muss: rechte Winkel. Eine
// römische Straße ist zwar berühmt gerade, aber sie knickt nicht alle 55 km um
// neunzig Grad.
//
// Jetzt wird derselbe Weg gegangen wie beim Fluss: aus den Straßenfeldern wird
// ein Graph, daraus werden durchgehende Züge, deren Knicke ausgerundet werden,
// und darauf liegt *ein* Band. Getrennt nach Ausbaustufe, damit das Pflaster
// dort endet, wo der Ausbau endet.
function roadPolylines(roads, stufe) {
  const graph = new Map();
  const gehoert = (key) => {
    const l = roadLevelOf(roads[key]);
    return l ? Math.min(3, l) : 0;
  };
  const kante = (a, b) => {
    if (!graph.has(a)) graph.set(a, []);
    if (!graph.has(b)) graph.set(b, []);
    graph.get(a).push(b);
    graph.get(b).push(a);
  };
  for (const key of Object.keys(roads)) {
    if (!gehoert(key)) continue;
    const [col, row] = key.split(',').map(Number);
    for (const [dc, dr] of [[1, 0], [0, 1]]) {
      const nachbarKey = `${col + dc},${row + dr}`;
      const nachbar = gehoert(nachbarKey);
      if (!nachbar) continue;
      // Ein Stück gehört der niedrigeren der beiden Stufen an seinen Enden.
      if (Math.min(gehoert(key), nachbar) !== stufe) continue;
      kante(key, nachbarKey);
    }
  }
  return zuegeAusGraph(graph).map((zug) => zug.map((k) => {
    const [col, row] = k.split(',').map(Number);
    return { x: worldX(col), z: worldZ(row) };
  }));
}

function buildRoadNetwork(state) {
  for (const stueck of [...roadsGroup.children]) disposeGroup(stueck);
  const roads = state.roads || {};
  // Drei Bänder: der Karrenweg in Erdfarbe, die Kiesstraße in mattem Grau,
  // die gepflasterte Straße in hellem Basalt.
  const bahnen = { 1: [], 2: [], 3: [] };
  const half = ROAD_HALF;

  for (const stufe of [1, 2, 3]) {
    for (const zug of roadPolylines(roads, stufe)) {
      const pfad = resamplePath(roundPath(zug, ROAD_ROUND, ROAD_ROUND_STUFEN), ROAD_STEP);
      pushRibbon(bahnen[stufe], pfad, pfad.map(() => half), ROAD_LIFT, ROAD_SKIRT);
    }
  }
  // Ein einzelnes Straßenfeld ohne Nachbarn steht in keinem Zug - es bekommt
  // trotzdem sein Stück Weg, sonst verschwände der erste Spatenstich.
  for (const key of Object.keys(roads)) {
    const stufe = roadLevelOf(roads[key]);
    if (!stufe) continue;
    const [col, row] = key.split(',').map(Number);
    const allein = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .every(([dc, dr]) => !roadLevelOf(roads[`${col + dc},${row + dr}`]));
    if (!allein) continue;
    const x = worldX(col);
    const z = worldZ(row);
    pushBand(bahnen[Math.min(3, stufe)], x - half, z, x + half, z, half, ROAD_LIFT, ROAD_SKIRT);
  }

  const ROAD_LOOK = {
    1: { color: '#94764b', roughness: 1 },
    2: { color: '#a99e88', roughness: 0.85 },
    3: { color: '#b8b0a1', roughness: 0.7 },
  };
  for (const [stufe, positions] of Object.entries(bahnen)) {
    if (!positions.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.computeVertexNormals();
    const look = ROAD_LOOK[stufe];
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      // Etwas dunkler als früher: eine helle Bahn quer über die grüne Karte
      // zog den Blick stärker auf sich als die Orte, die sie verbindet.
      color: look.color,
      roughness: look.roughness,
      side: THREE.DoubleSide,
    }));
    mesh.frustumCulled = false;
    roadsGroup.add(mesh);
  }
}

// One ring of fortification. `span` is the same for all three so a settlement
// keeps its footprint as it is upgraded; what changes is the material, the
// height and whether there are towers.
// --- Tore ------------------------------------------------------------------
// Eine Befestigung ohne Tor ist ein Sack. Jede Mauer und jede Palisade bekommt
// deshalb vier Tore, in allen Himmelsrichtungen - so, wie eine römische Anlage
// gebaut war: porta praetoria, principalis dextra und sinistra, decumana.
// Gebaut wird jedes Tor aus zwei Pfosten, einem Sturz darüber und zwei
// Torflügeln aus dunklem Holz dazwischen.
const GATE_TIMBER = geteilt(new THREE.MeshStandardMaterial({ color: '#4a3421', roughness: 1 }));

// Ein Punkt auf einer Seite der Anlage: `angle` ist die Seite, `t` die Stelle
// darauf, `half` der halbe Abstand der Seiten von der Mitte.
function sidePoint(angle, t, half) {
  return [
    Math.cos(angle) * t + Math.sin(angle) * half,
    -Math.sin(angle) * t + Math.cos(angle) * half,
  ];
}

// Setzt ein Tor in die Mitte einer Seite (oder, mit `t`, irgendwo darauf).
function addGate(ring, { angle, half, width, height, thickness, material, t = 0 }) {
  const posten = Math.max(0.09, thickness * 0.8);
  for (const seite of [-1, 1]) {
    const [x, z] = sidePoint(angle, t + seite * (width / 2 + posten / 2), half);
    const pfosten = new THREE.Mesh(
      new THREE.BoxGeometry(posten, height * 1.14, thickness * 1.5), material
    );
    pfosten.position.set(x, height * 0.57, z);
    pfosten.rotation.y = angle;
    ring.add(pfosten);
  }
  // Der Sturz über der Öffnung.
  const [sx, sz] = sidePoint(angle, t, half);
  const sturz = new THREE.Mesh(
    new THREE.BoxGeometry(width + posten * 2, height * 0.2, thickness * 1.5), material
  );
  sturz.position.set(sx, height * 0.98, sz);
  sturz.rotation.y = angle;
  ring.add(sturz);
  // Die beiden Torflügel.
  for (const seite of [-1, 1]) {
    const [fx, fz] = sidePoint(angle, t + seite * width / 4, half);
    const fluegel = new THREE.Mesh(
      new THREE.BoxGeometry(width / 2 - 0.02, height * 0.84, thickness * 0.7), GATE_TIMBER
    );
    fluegel.position.set(fx, height * 0.42, fz);
    fluegel.rotation.y = angle;
    ring.add(fluegel);
  }
}

// Steht nur ein Tor, dann auf dieser Seite. Seite 0 zeigt nach +z, also dem
// Betrachter entgegen - dieselbe Seite, auf der der Ring eines Dorfes seine
// Lücke hat (dort ist `tore` auf Math.PI/2 gesetzt, was über die Umrechnung
// angle = Math.PI/2 - t genau auf 0 führt).
const TOR_SEITE = 0;

// Ein Mauerring besteht aus dreißig bis sechzig Teilen - Pfähle, Spitzen,
// Wandstücke, Türme -, die alle stillstehen. Gebaut wird er wie bisher, und
// dann zu einem Mesh je Material gebacken.
function buildFortification(kind, scale, options = {}) {
  const ring = buildFortificationParts(kind, scale, options);
  bakeGroup(ring);
  return ring;
}

function buildFortificationParts(kind, scale, options = {}) {
  const ring = new THREE.Group();
  const span = 4.4 * scale;
  const half = span / 2;

  // Ein Dorf zieht keinen Wall im Geviert: es legt einen Ring um die Häuser,
  // so weit die Stämme reichen. Erst eine Stadt baut geradeaus und mit Ecken.
  if (kind === 'palisade' && options.round) {
    const wood = new THREE.MeshStandardMaterial({ color: '#7a5433', roughness: 1 });
    const height = 0.86 * scale;
    const radius = 0.12 * scale;
    const ringRadius = half * 0.92;
    // Die geschlossene Wand hinter den Stämmen, als offener Zylinder.
    // Vier Tore, in allen Himmelsrichtungen. Sie sind Lücken im Ring: die
    // geschlossene Wand läuft in vier Bögen dazwischen, und wo ein Tor steht,
    // steht kein Stamm.
    // Ein Dorf hat ein Tor, keine vier. Vier Tore sind eine Anlage, die
    // gebaut wurde, damit Truppen nach jeder Seite hinaus können - ein Dorf
    // hat einen Weg hinein, und mehr Stämme, als der Wald hergibt, hat es
    // ohnehin nicht. Die Wand läuft deshalb als ein einziger Bogen um den
    // Ring, mit einer Lücke nach Süden, wo der Weg ankommt.
    const torWinkel = 0.9 / ringRadius * scale;   // halbe Öffnung im Bogenmaß
    const tore = [Math.PI / 2];
    // Die geschlossene Wand hinter den Stämmen: von einem Tor bis zum nächsten,
    // bei nur einem Tor also einmal ganz herum. Der Zylinder zählt seinen
    // Winkel von +z aus, die Stämme von +x - daher die Umrechnung.
    const schritt = (Math.PI * 2) / tore.length;
    for (const t of tore) {
      const a1 = t + torWinkel;
      const a2 = t + schritt - torWinkel;
      const bogen = new THREE.Mesh(
        new THREE.CylinderGeometry(ringRadius - radius * 0.6, ringRadius - radius * 0.6,
          height * 0.84, Math.max(12, Math.round(24 / tore.length)), 1, true,
          Math.PI / 2 - a2, a2 - a1),
        wood
      );
      bogen.position.y = height * 0.42;
      ring.add(bogen);
    }
    // Steht dieser Winkel in einer Toröffnung? Dann bleibt der Stamm weg.
    const imTor = (a) => tore.some((t) => {
      const d = Math.abs(((a - t + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      return d < torWinkel;
    });
    const anzahl = Math.max(20, Math.round((2 * Math.PI * ringRadius) / (radius * 1.7)));
    for (let i = 0; i < anzahl; i++) {
      const angle = (i / anzahl) * Math.PI * 2;
      if (imTor(angle)) continue;
      const x = Math.cos(angle) * ringRadius;
      const z = Math.sin(angle) * ringRadius;
      const stake = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.82, radius, height, 5),
        wood
      );
      stake.position.set(x, height / 2, z);
      ring.add(stake);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(radius, 0.2 * scale, 5), wood);
      tip.position.set(x, height + 0.1 * scale, z);
      ring.add(tip);
    }
    // Und die vier Tore selbst - Pfosten, Sturz, zwei Flügel.
    for (const t of tore) {
      addGate(ring, {
        angle: Math.PI / 2 - t, half: ringRadius, width: 0.86 * scale,
        height, thickness: radius * 1.6, material: wood,
      });
    }
    return ring;
  }

  if (kind === 'palisade') {
    // Eine Palisade ist eine Wand, kein Zaun: die Stämme stehen dicht an
    // dicht, und dahinter läuft ein durchgehender Balken, damit zwischen den
    // Pfählen kein Tageslicht steht.
    const wood = new THREE.MeshStandardMaterial({ color: '#7a5433', roughness: 1 });
    const height = 0.92 * scale;
    const radius = 0.13 * scale;
    // So viele Stämme, dass sie sich berühren.
    const perSide = Math.max(12, Math.round(span / (radius * 1.7)));
    // In der Mitte jeder Seite steht ein Tor: dort bleibt die Wand offen und
    // kein Stamm steht im Weg. Ein Dorf bekommt nur eines, nach Süden.
    const torBreite = 0.95 * scale;
    for (let side = 0; side < 4; side++) {
      const angle = (side * Math.PI) / 2;
      const mitTor = !options.dorf || side === TOR_SEITE;
      // Der geschlossene Wall hinter den Stämmen - links und rechts des Tors.
      // Wo kein Tor steht, läuft er in einem Stück durch.
      const lauf = mitTor ? (span - torBreite) / 2 : span;
      for (const seite of (mitTor ? [-1, 1] : [0])) {
        const versatz = seite * (torBreite / 2 + lauf / 2);
        const [wx, wz] = sidePoint(angle, versatz, half);
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(lauf, height * 0.86, radius * 1.1),
          wood
        );
        wall.rotation.y = angle;
        wall.position.set(wx, height * 0.43, wz);
        ring.add(wall);
      }
      for (let i = 0; i < perSide; i++) {
        const t = (i / (perSide - 1) - 0.5) * span;
        if (mitTor && Math.abs(t) < torBreite / 2 + radius) continue;
        const [x, z] = sidePoint(angle, t, half);
        const stake = new THREE.Mesh(
          new THREE.CylinderGeometry(radius * 0.82, radius, height, 5),
          wood
        );
        stake.position.set(x, height / 2, z);
        ring.add(stake);
        const tip = new THREE.Mesh(
          new THREE.ConeGeometry(radius, 0.22 * scale, 5),
          wood
        );
        tip.position.set(x, height + 0.11 * scale, z);
        ring.add(tip);
      }
      if (mitTor) {
        addGate(ring, {
          angle, half, width: torBreite, height, thickness: radius * 1.8, material: wood,
        });
      }
    }
    return ring;
  }

  const stone = kind === 'stone';
  const material = new THREE.MeshStandardMaterial({
    color: stone ? '#b8ab90' : '#8a6134',
    roughness: stone ? 0.9 : 1,
  });
  const height = (stone ? 1.28 : 1.02) * scale;
  const thickness = (stone ? 0.28 : 0.22) * scale;

  // Auch die gemauerte Anlage hat vier Tore. Die Mauerläufe enden davor, der
  // Wehrgang darüber läuft durch - über einem Tor stand er auch wirklich.
  const torBreite = 1.05 * scale;
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    // Auch hier: ein Dorf, das sich eine Mauer leisten kann, bekommt trotzdem
    // nur ein Tor. Die übrigen drei Seiten stehen geschlossen.
    const mitTor = !options.dorf || i === TOR_SEITE;
    const lauf = mitTor ? (span - torBreite) / 2 : span;
    for (const seite of (mitTor ? [-1, 1] : [0])) {
      const [sx, sz] = sidePoint(angle, seite * (torBreite / 2 + lauf / 2), half);
      const segment = new THREE.Mesh(new THREE.BoxGeometry(lauf, height, thickness), material);
      segment.position.set(sx, height / 2, sz);
      segment.rotation.y = angle;
      ring.add(segment);
    }
    // The parapet a defender actually stands behind.
    const [wx, wz] = sidePoint(angle, 0, half);
    const walk = new THREE.Mesh(
      new THREE.BoxGeometry(span, 0.12 * scale, thickness * 1.7),
      material
    );
    walk.position.set(wx, height + 0.06 * scale, wz);
    walk.rotation.y = angle;
    ring.add(walk);
    if (mitTor) {
      addGate(ring, {
        angle, half, width: torBreite, height, thickness, material,
      });
    }
  }

  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    const tower = stone
      ? new THREE.Mesh(
        new THREE.CylinderGeometry(0.3 * scale, 0.34 * scale, height * 1.32, 8),
        material
      )
      : new THREE.Mesh(
        new THREE.BoxGeometry(0.54 * scale, height * 1.26, 0.54 * scale),
        material
      );
    tower.position.set(
      Math.cos(angle) * half * Math.SQRT2,
      height * (stone ? 0.66 : 0.63),
      Math.sin(angle) * half * Math.SQRT2
    );
    tower.rotation.y = angle;
    ring.add(tower);
  }
  return ring;
}

// --- Siedlungen ----------------------------------------------------------
// Ein Dorf, eine Stadt und eine große Stadt sollen sich schon an der
// Silhouette unterscheiden lassen, nicht erst am Maßstab: Rundhütten mit
// Strohdach, ein Rechteckbau mit Walmdach, ein Tempel mit Säulen und Giebel.

const CITY_MATERIALS = geteilteSammlung({
  plaster: new THREE.MeshStandardMaterial({ color: '#d8c9a3', roughness: 0.85 }),
  timber: new THREE.MeshStandardMaterial({ color: '#8a6a45', roughness: 1 }),
  thatch: new THREE.MeshStandardMaterial({ color: '#b39456', roughness: 1 }),
  marble: new THREE.MeshStandardMaterial({ color: '#eee6d2', roughness: 0.55 }),
  wood: new THREE.MeshStandardMaterial({ color: '#5a4127', roughness: 1 }),
  gold: new THREE.MeshStandardMaterial({ color: '#d9b451', roughness: 0.4, metalness: 0.35 }),
  // Bruchstein, wie er am Schacht aufgeschichtet wird.
  stone: new THREE.MeshStandardMaterial({ color: '#8e8577', roughness: 0.95 }),
  // Der gestampfte Untergrund, auf dem ein Ort steht.
  terrace: new THREE.MeshStandardMaterial({ color: '#93836a', roughness: 1 }),
  // Gestampfter Lehmziegel, wie er am Nil, am Euphrat und in Anatolien
  // gebrannt wurde - heller und rötlicher als der verputzte Stein im Westen.
  mudbrick: new THREE.MeshStandardMaterial({ color: '#c9a06a', roughness: 0.9 }),
});

// Drei Bauweisen, wie das Spiel die Fraktionen einteilt: die griechisch-
// römische Welt des Mittelmeers, der Osten von Anatolien bis zum Nil, und der
// Norden und Westen jenseits davon. Dieselbe Einteilung wie beim Thron im
// Feldherrnzelt (`THRONE_STYLE`) - nur dass der Osten dort noch mit dem
// Mittelmeer eine Gruppe bildet, hier aber eigene Bauformen bekommt: Der Bug
// war vorher, dass ein Haus in Pergamon genauso aussah wie eines in Rom oder
// in Mainz - nur das Dach war eingefärbt.
const CIVIC_STYLE = {
  rom: 'klassisch', athen: 'klassisch', sparta: 'klassisch', makedonien: 'klassisch',
  syrakus: 'klassisch', karthago: 'klassisch',
  seleukiden: 'oriental', ptolemaeer: 'oriental', parther: 'oriental',
  armenien: 'oriental', pontus: 'oriental',
  gallier: 'keltisch', germanen: 'keltisch', britannier: 'keltisch', iberer: 'keltisch',
  daker: 'keltisch', illyrer: 'keltisch', sarmaten: 'keltisch', numidien: 'keltisch',
};
function civicStyle(factionId) {
  return CIVIC_STYLE[factionId] || 'klassisch';
}

// Ein Haus mit Walmdach. Das Dach trägt die Fraktionsfarbe - es ist das, was
// aus der Vogelperspektive zu sehen ist.
// Ein Satteldach, das genau auf sein Haus passt. Vorher war es ein
// vierseitiger Kegel, um 45 Grad gedreht und danach entlang einer Achse
// gestaucht - die Stauchachse lag nach der Drehung schief zum Haus, und das
// Dach saß verkantet darauf. Hier wird die Form direkt aus den Maßen des
// Hauses gebaut: First entlang der langen Seite, Traufe mit etwas Überstand.
function makeGableRoof(width, depth, height) {
  const hw = (width / 2) * 1.12;
  const hd = (depth / 2) * 1.12;
  const alongX = width >= depth;
  const ridge = (alongX ? hw : hd) * 0.42;
  const v = alongX
    ? [
      [-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd],
      [-ridge, height, 0], [ridge, height, 0],
    ]
    : [
      [-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd],
      [0, height, -ridge], [0, height, ridge],
    ];
  // 0..3 Traufe im Uhrzeigersinn, 4/5 die Firstpunkte.
  const faces = alongX
    ? [[0, 1, 5], [0, 5, 4], [2, 3, 4], [2, 4, 5], [1, 2, 5], [3, 0, 4]]
    : [[1, 2, 5], [1, 5, 4], [3, 0, 4], [3, 4, 5], [2, 3, 5], [0, 1, 4]];
  const positions = [];
  for (const [a, b, c] of faces) {
    positions.push(...v[a], ...v[b], ...v[c]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// Ein Haus im Mittelmeerstil: verputzte Wände, Satteldach mit Ziegeln - das
// Bild Roms, Athens und Karthagos.
function addKlassischHouse(group, tinted, x, z, width, depth, height, rotation) {
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), CITY_MATERIALS.plaster);
  body.position.set(x, height / 2, z);
  body.rotation.y = rotation;
  group.add(body);

  const roof = new THREE.Mesh(
    makeGableRoof(width, depth, height * 0.55),
    // Each roof gets its own material: they are tinted per faction, and a
    // shared one would repaint every city on the map at once.
    new THREE.MeshStandardMaterial({
      color: '#b5432f', roughness: 0.6, side: THREE.DoubleSide,
    })
  );
  roof.position.set(x, height, z);
  roof.rotation.y = rotation;
  group.add(roof);
  tinted.push(roof);
  return roof;
}

// Ein Haus im Stil des Ostens: Lehmziegel statt Verputz, ein flaches Dach
// statt eines First - wie am Nil und am Euphrat, wo Regen die Ausnahme ist.
function addOrientalHouse(group, tinted, x, z, width, depth, height, rotation) {
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), CITY_MATERIALS.mudbrick);
  body.position.set(x, height / 2, z);
  body.rotation.y = rotation;
  group.add(body);

  // Das Flachdach ragt über die Wände hinaus wie ein Sonnensegel und trägt,
  // wie sonst die Ziegel, die Farbe der Fraktion.
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.1, height * 0.12, depth * 1.1),
    new THREE.MeshStandardMaterial({ color: '#b5432f', roughness: 0.6 })
  );
  roof.position.set(x, height + height * 0.06, z);
  roof.rotation.y = rotation;
  group.add(roof);
  tinted.push(roof);
  return roof;
}

// Ein Haus im Stil des Nordens: ein Rundhaus aus Holz und Reet, wie es
// Gallier, Germanen und Britannier bauten - kein First, keine Wandfarbe, dafür
// ein First-Knauf in der Farbe der Fraktion, der das Reetdach abschließt.
function addKeltischHouse(group, tinted, x, z, width, depth, height, rotation) {
  const radius = (width + depth) / 4;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.08, height, 9),
    CITY_MATERIALS.timber
  );
  body.position.set(x, height / 2, z);
  group.add(body);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(radius * 1.3, height * 1.05, 9),
    CITY_MATERIALS.thatch
  );
  roof.position.set(x, height + height * 0.52, z);
  group.add(roof);
  const knauf = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.22, 6, 5),
    new THREE.MeshStandardMaterial({ color: '#b5432f', roughness: 0.6 })
  );
  knauf.position.set(x, height + height * 1.05, z);
  group.add(knauf);
  tinted.push(knauf);
  return knauf;
}

const HOUSE_BUILDERS = {
  klassisch: addKlassischHouse,
  oriental: addOrientalHouse,
  keltisch: addKeltischHouse,
};

function addHouse(style, group, tinted, x, z, width, depth, height, rotation) {
  return (HOUSE_BUILDERS[style] || addKlassischHouse)(group, tinted, x, z, width, depth, height, rotation);
}

// Eine Rundhütte mit Strohdach - das Bild, das ein Dorf abgeben soll.
function addHut(group, x, z, radius, height) {
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.06, height, 8),
    CITY_MATERIALS.timber
  );
  body.position.set(x, height / 2, z);
  group.add(body);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(radius * 1.35, height * 0.95, 8),
    CITY_MATERIALS.thatch
  );
  roof.position.set(x, height + height * 0.47, z);
  group.add(roof);
}

// Podium, Säulen, Gebälk, Giebel: ein Tempel, der als Tempel zu erkennen ist -
// das Bild der großen Stadt am Mittelmeer.
function addKlassischTemple(group, tinted, x, z, width, rotation) {
  const temple = new THREE.Group();
  const depth = width * 0.62;
  const columnHeight = width * 0.52;

  const podium = new THREE.Mesh(
    new THREE.BoxGeometry(width, width * 0.14, depth),
    CITY_MATERIALS.marble
  );
  podium.position.y = width * 0.07;
  temple.add(podium);

  const columns = 6;
  const columnGeometry = new THREE.CylinderGeometry(width * 0.045, width * 0.05, columnHeight, 7);
  for (let i = 0; i < columns; i++) {
    const front = i < columns / 2;
    const along = (i % (columns / 2)) / (columns / 2 - 1) - 0.5;
    const column = new THREE.Mesh(columnGeometry, CITY_MATERIALS.marble);
    column.position.set(along * width * 0.72, width * 0.14 + columnHeight / 2,
      (front ? 1 : -1) * depth * 0.34);
    temple.add(column);
  }

  const entablature = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.92, width * 0.1, depth * 0.86),
    CITY_MATERIALS.marble
  );
  entablature.position.y = width * 0.14 + columnHeight + width * 0.05;
  temple.add(entablature);

  // Das Tempeldach: derselbe Satteldachschnitt wie über einem Haus, nur
  // breiter und flacher - der First läuft über die lange Seite.
  const pediment = new THREE.Mesh(
    makeGableRoof(width * 0.98, depth * 0.92, width * 0.26),
    new THREE.MeshStandardMaterial({
      color: '#c65a41', roughness: 0.6, side: THREE.DoubleSide,
    })
  );
  pediment.position.y = width * 0.14 + columnHeight + width * 0.1;
  temple.add(pediment);
  tinted.push(pediment);

  temple.position.set(x, 0, z);
  temple.rotation.y = rotation;
  group.add(temple);
}

// Ein Stufenheiligtum, wie es von Babylon bis Persepolis stand: Terrasse über
// Terrasse, jede schmaler als die vorige, ganz oben ein kleiner Schrein in
// der Farbe der Fraktion - kein Säulentempel, sondern ein Turm aus Absätzen.
function addOrientalShrine(group, tinted, x, z, width, rotation) {
  const shrine = new THREE.Group();
  const stufen = 3;
  let y = 0;
  for (let i = 0; i < stufen; i++) {
    const w = width * (1 - i * 0.24);
    const h = width * 0.16;
    const stufe = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, w * 0.86),
      CITY_MATERIALS.mudbrick
    );
    stufe.position.y = y + h / 2;
    shrine.add(stufe);
    y += h;
  }
  const schrein = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.3, width * 0.22, width * 0.26),
    new THREE.MeshStandardMaterial({ color: '#c65a41', roughness: 0.6 })
  );
  schrein.position.y = y + width * 0.11;
  shrine.add(schrein);
  tinted.push(schrein);

  shrine.position.set(x, 0, z);
  shrine.rotation.y = rotation;
  group.add(shrine);
}

// Die große Halle, wie sie im Norden an die Stelle des Tempels tritt: ein
// überhohes Rundhaus mit steilem Reetdach und einem First-Knauf in der Farbe
// der Fraktion - kein Podium, keine Säulen, aber von weitem ebenso zu sehen.
function addKeltischHall(group, tinted, x, z, width, rotation) {
  addKeltischHouse(group, tinted, x, z, width * 0.72, width * 0.72, width * 0.62, rotation);
}

const LANDMARK_BUILDERS = {
  klassisch: (group, tinted, x, z, width, rotation) => addKlassischTemple(group, tinted, x, z, width, rotation),
  oriental: addOrientalShrine,
  keltisch: addKeltischHall,
};

function addLandmark(style, group, tinted, x, z, width, rotation) {
  (LANDMARK_BUILDERS[style] || LANDMARK_BUILDERS.klassisch)(group, tinted, x, z, width, rotation);
}

// Ein Feldzeichen: Stange, Banner in der Fraktionsfarbe, vergoldete Spitze.
// --- Fahnen ---------------------------------------------------------------
// Eine Fahne ist eine Fläche, und eine Fläche verschwindet, sobald man von der
// Seite darauf sieht - beim Drehen der Karte wurde aus jedem Banner ein Strich.
// Die Tücher hängen deshalb in einer eigenen Gruppe, die sich mit der Kamera
// dreht: die Stange bleibt stehen, das Tuch zeigt immer zum Betrachter.
const billboards = [];

function alignBillboards() {
  const facing = Math.atan2(Math.cos(cam.azimuth), Math.sin(cam.azimuth));
  for (const group of billboards) group.rotation.y = facing;
}

// Ein Tuch mit Faltenwurf statt einer geraden Fläche: schmaler zum Mast hin,
// leicht gewellt, damit es auch im Streiflicht als Stoff zu erkennen ist.
function makeBannerCloth(width, height, material) {
  const geometry = new THREE.PlaneGeometry(width, height, 4, 1);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    // Am Mast (x = -width/2) liegt das Tuch an, außen weht es aus.
    const t = (x + width / 2) / width;
    position.setZ(i, Math.sin(t * Math.PI * 1.6) * height * 0.16);
    position.setY(i, position.getY(i) * (1 - t * 0.12));
  }
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.x = width / 2;
  return mesh;
}

function addStandard(group, tinted, height, bannerWidth) {
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, height, 6),
    CITY_MATERIALS.wood
  );
  pole.position.y = height / 2;
  group.add(pole);

  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), CITY_MATERIALS.gold);
  finial.position.y = height + 0.1;
  group.add(finial);

  const flag = new THREE.Group();
  flag.position.y = height - bannerWidth * 0.5;
  group.add(flag);
  billboards.push(flag);

  const banner = makeBannerCloth(
    bannerWidth, bannerWidth * 0.72,
    new THREE.MeshStandardMaterial({ color: '#999', side: THREE.DoubleSide, roughness: 0.85 })
  );
  flag.add(banner);
  tinted.push(banner);
  return banner;
}

// --- Wie groß ein Ort gezeichnet wird -------------------------------------
// Ein Haus ist ein Haus, ob es in einem Dorf oder in einer großen Stadt steht.
// Vorher wuchsen mit dem Rang eines Orts einfach alle Gebäude mit: dieselben
// vier Hütten, nur größer gezeichnet - eine große Stadt sah aus wie ein Dorf
// für Riesen, und zwei Orte nebeneinander waren nicht zu vergleichen.
//
// Jetzt hat jedes Gebäude überall dasselbe Maß, und zwar das des Dorfs. Der
// Rang eines Orts zeigt sich daran, WIE VIELE Häuser dort stehen und wie weit
// sie sich ausbreiten - ein Dorf hat vier, eine Stadt vierzehn, eine große
// Stadt sechsundzwanzig und dazu einen Tempel.
const BUILD_SCALE = 0.68;

// --- Der Maßstab der ganzen Welt ------------------------------------------
// Alles auf der Karte misst sich am selben Haus. Ein Haus ist rund eine
// Einheit hoch; daran hängen die übrigen Größen:
//
//   Haus / Hütte        1,0   (der Maßstab selbst)
//   Baum                2,2   - doppelt so hoch wie ein Haus
//   Zelt eines Heeres   0,8   - ein Zelt ist kein Haus
//   Mann in der Kolonne 0,5   - halb so hoch wie ein Haus
//   Erzbrocken          0,45  - ein Felsstück, kein Findling
//   Bergkegel           1..3  - der Berg selbst trägt die Höhe, nicht der Kegel
//
// Vorher hatte jede dieser Größen ihre eigene Geschichte: ein einzelner Baum
// war höher als ein ganzes Dorf, und ein Zelt überragte das Haus daneben.
const TREE_HEIGHT = 2.2;
const CAMP_TENT_HEIGHT = 0.8;
const MARCHER_HEIGHT = 0.5;

// Wie weit sich ein Ort ausbreitet, steht bei den Siedlungsstufen in data.js
// (`spread`): davon hängen der Mauerring, die Höhe des Namensschilds und die
// Ringe ab, auf denen die Häuser stehen - nicht die Größe der Häuser selbst.
// Der Mauerring hat die halbe Spannweite 2,2 · Ausbreitung; die Häuser müssen
// innerhalb davon bleiben, sonst stehen sie auf der Mauer.

// Die Ringe, auf denen die Häuser stehen: Radius (in Feldeinheiten, mal
// Ausbreitung) und wie viele Gebäude darauf Platz haben.
const SETTLEMENT_RINGS = {
  village: [{ r: 1.7, n: 3 }],
  city: [{ r: 1.15, n: 6 }, { r: 1.8, n: 9 }],
  large: [{ r: 1.35, n: 8 }, { r: 1.95, n: 12 }],
};

// Räumt einen Ort ab, wenn er neu gebaut werden muss - sonst hielte jeder
// gewachsene Ort seine alten Geometrien für den Rest des Feldzugs fest.
function disposeCityEntry(entry) {
  // Über `disposeGroup`, nicht von Hand: die Häuser eines Orts sind aus
  // `CITY_MATERIALS` gebaut, und das gehört allen Orten zugleich.
  disposeGroup(entry.group);
  // Was in dieser Gruppe hing - Namensschild, Fahne -, stand in der Liste der
  // mitgedrehten Tücher. Alles, was nach dem Entfernen nicht mehr an der Szene
  // hängt, fliegt daraus; sonst wüchse die Liste mit jedem gewachsenen Ort.
  for (let i = billboards.length - 1; i >= 0; i--) {
    let wurzel = billboards[i];
    while (wurzel.parent) wurzel = wurzel.parent;
    if (wurzel !== scene) billboards.splice(i, 1);
  }
}

function buildCityGroup(city) {
  const group = new THREE.Group();
  const spread = settlementTier(city.size).spread * (city.capital ? 1.05 : 1);
  const bau = BUILD_SCALE;
  // Das Fundament: die Terrasse, auf der der Ort steht. Alle Häuser stehen auf
  // der Höhe der Feldmitte, das Gelände darunter nicht - am Hang stand deshalb
  // die halbe Siedlung in der Luft oder steckte im Boden. Die Terrasse trägt
  // sie: ihre Oberkante liegt bei null, ihre Tiefe wird beim Setzen des Orts
  // an das Gelände darunter angepasst.
  const grundRadius = 2.2 * spread + 0.55;
  const rund = city.size === 'village';
  const fundament = new THREE.Mesh(
    rund
      ? new THREE.CylinderGeometry(grundRadius, grundRadius * 0.94, 1, 14)
      : new THREE.BoxGeometry(grundRadius * 2, 1, grundRadius * 2),
    CITY_MATERIALS.terrace
  );
  fundament.position.y = -0.5;
  group.add(fundament);
  const tinted = [];
  const rng = seededRandomFactory(city.col * 733 + city.row * 197 + 11);
  const ringe = SETTLEMENT_RINGS[city.size] || SETTLEMENT_RINGS.city;

  if (city.size === 'village') {
    // Ein Weiler: eine größere Hütte, ein paar kleinere darum. Dieses Bild ist
    // der Maßstab für alles andere.
    addHut(group, 0, 0, 0.85 * bau, 1.15 * bau);
    for (const ring of ringe) {
      for (let i = 0; i < ring.n; i++) {
        const angle = (i / ring.n) * Math.PI * 2 + rng() * 0.7;
        addHut(group, Math.cos(angle) * ring.r * spread, Math.sin(angle) * ring.r * spread,
          0.52 * bau, 0.78 * bau);
      }
    }
    // Am Dorf ist das Banner das Einzige, was die Zugehörigkeit zeigt - es
    // muss also von weitem zu sehen sein.
    addStandard(group, tinted, 3.6 * bau, 1.15 * bau);
  } else {
    const large = city.size === 'large';
    const style = civicStyle(city.factionId);
    // Die Halle in der Mitte, quer gestellt, damit sie nicht wie ein Würfel
    // wirkt - und nach hinten, damit der Tempel in der Standardansicht davor
    // steht und nicht dahinter verschwindet. Sie ist das einzige Gebäude, das
    // größer ist als ein Haus, und in jeder Stadt gleich groß.
    addHouse(style, group, tinted, 0, -0.9 * spread, 1.9 * bau, 1.25 * bau, 1.15 * bau, 0);
    for (const [nr, ring] of ringe.entries()) {
      for (let i = 0; i < ring.n; i++) {
        // Jeder Ring beginnt anderswo, sonst stehen die Häuser in Speichen.
        const angle = (i / ring.n) * Math.PI * 2 + (large ? 2.0 : 0.4) + nr * 0.55;
        const width = (0.78 + rng() * 0.34) * bau;
        addHouse(style, group, tinted,
          Math.cos(angle) * ring.r * spread, Math.sin(angle) * ring.r * spread,
          width, width * 0.72, (0.7 + rng() * 0.3) * bau, angle);
      }
    }
    // Das Wahrzeichen der großen Stadt steht nur dort - und richtet sich nach
    // der Bauweise der Fraktion: Tempel am Mittelmeer, Stufenheiligtum im
    // Osten, große Halle im Norden.
    if (large) addLandmark(style, group, tinted, 0, 0.7 * spread, 1.55 * bau, 0);
    addStandard(group, tinted, 4.0 * bau, 1.1 * bau);
  }

  // Alles Feste zu je einem Mesh je Material verschmelzen. Draußen bleiben
  // die Fahnen (sie drehen sich mit der Kamera) und die Terrasse (ihre Tiefe
  // wird erst beim Setzen des Orts an das Gelände angepasst).
  const keep = new Set(billboards.filter((b) => stammtAus(group, b)));
  keep.add(fundament);
  const farbigeTeile = new Set(tinted);
  const gebacken = bakeGroup(group, { keep, tinted: farbigeTeile });
  // Was in der Fraktionsfarbe bleibt: das gebackene Dachwerk und die Banner.
  const tintedNeu = [...gebacken, ...tinted.filter((t) => t.parent)];

  const label = makeLabelSprite(city.name, { scale: city.capital ? 1.15 : 0.95 });
  // Das Schild steht über dem höchsten Dach, nicht über einer gedachten Größe.
  label.position.y = (city.size === 'village' ? 2.9 : 3.4) * bau + 1.2 * spread;
  group.add(label);

  // Die Befestigungen entstehen erst, wenn sie gebaut sind: die meisten Orte
  // haben keine, und jedes ungenutzte Modell kostet Zeichenaufrufe.
  return {
    group, label, tinted: tintedNeu, scale: spread, bau, size: city.size,
    fundament, grundRadius,
    walls: [null, null, null], harbour: null,
  };
}

// --- Weltwunder und Wahrzeichen ------------------------------------------
// Die Bauwerke der Alten Welt stehen auf ihrem echten Feld. Teilt sich eines
// das Feld mit einer Stadt - der Parthenon mit Athen, der Jupitertempel mit
// Rom -, rückt es an den Rand des Felds und auf einen Felsen darüber: so
// steht es neben der Stadt statt zwischen ihren Dächern, und beim Kapitol und
// bei der Akropolis ist der Burgberg ohnehin der historische Ort.

const WONDER_MATERIALS = geteilteSammlung({
  limestone: new THREE.MeshStandardMaterial({ color: '#ded1ab', roughness: 0.9 }),
  sandstone: new THREE.MeshStandardMaterial({ color: '#cbb083', roughness: 0.95 }),
  marble: new THREE.MeshStandardMaterial({ color: '#f0ead8', roughness: 0.5 }),
  bronze: new THREE.MeshStandardMaterial({ color: '#c98f3e', roughness: 0.45, metalness: 0.12 }),
  gold: new THREE.MeshStandardMaterial({ color: '#e6c65c', roughness: 0.4, metalness: 0.15 }),
  roof: new THREE.MeshStandardMaterial({ color: '#b8503a', roughness: 0.7, side: THREE.DoubleSide }),
  rock: new THREE.MeshStandardMaterial({ color: '#8f8779', roughness: 1, flatShading: true }),
  fire: new THREE.MeshBasicMaterial({ color: '#ffcb6b' }),
});

function addBox(group, material, width, height, depth, x, y, z, rotation = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y + height / 2, z);
  mesh.rotation.y = rotation;
  group.add(mesh);
  return mesh;
}

// Eine Reihe Säulen auf einem Stufenbau, mit Gebälk und Satteldach darüber -
// der Bauplan, aus dem Ephesos, der Parthenon, Delphi und das Kapitol jeweils
// eine eigene Größe machen.
function makeColonnade(width, columnHeight, { columns = 6 } = {}) {
  const group = new THREE.Group();
  const depth = width * 0.6;
  addBox(group, WONDER_MATERIALS.marble, width, width * 0.09, depth, 0, 0, 0);
  addBox(group, WONDER_MATERIALS.marble, width * 0.9, width * 0.07, depth * 0.9, 0, width * 0.09, 0);
  const base = width * 0.16;

  const shaft = new THREE.CylinderGeometry(width * 0.035, width * 0.042, columnHeight, 8);
  for (let i = 0; i < columns; i++) {
    for (const side of [-1, 1]) {
      const along = (i / (columns - 1) - 0.5) * width * 0.78;
      const column = new THREE.Mesh(shaft, WONDER_MATERIALS.marble);
      column.position.set(along, base + columnHeight / 2, side * depth * 0.33);
      group.add(column);
    }
  }

  addBox(group, WONDER_MATERIALS.marble, width * 0.86, width * 0.08, depth * 0.78,
    0, base + columnHeight, 0);
  const pediment = new THREE.Mesh(
    makeGableRoof(width * 0.92, depth * 0.84, width * 0.22), WONDER_MATERIALS.roof
  );
  pediment.position.y = base + columnHeight + width * 0.08;
  group.add(pediment);
  return group;
}

// Ein stehender Mensch, grob aus Kästen - genug, um aus der Feldherrnperspektive
// als Statue durchzugehen.
function addFigure(group, material, height, { armUp = false, stride = 0.5 } = {}) {
  const unit = height / 8;
  // Die Beine stehen auseinander: aus der Feldherrnperspektive ist eine
  // einzelne Säule kein Mensch, zwei Beine mit Lücke dazwischen schon.
  for (const side of [-1, 1]) {
    addBox(group, material, unit * 0.62, unit * 3.3, unit * 0.7,
      side * unit * stride, 0, 0);
  }
  addBox(group, material, unit * 1.9, unit * 2.9, unit * 1.15, 0, unit * 3.3, 0);
  addBox(group, material, unit * 1.2, unit * 0.5, unit * 0.9, 0, unit * 6.2, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(unit * 0.8, 10, 8), material);
  head.position.y = unit * 7.1;
  group.add(head);
  for (const side of [-1, 1]) {
    const raised = armUp && side > 0;
    const arm = addBox(group, material, unit * 0.6, raised ? unit * 3.4 : unit * 2.8, unit * 0.6,
      side * unit * 1.3, raised ? unit * 4.9 : unit * 3.3, 0);
    if (raised) arm.rotation.z = -0.2;
  }
}

const WONDER_BUILDERS = {
  // Drei Pyramiden, die größte vorn, dazu ein Rest der Sphinx davor.
  pyramid(group) {
    const sizes = [[3.9, 3.6, 0, 0], [2.6, 2.4, -2.2, 1.0], [1.8, 1.6, 2.0, 1.3]];
    for (const [radius, height, x, z] of sizes) {
      const pyramid = new THREE.Mesh(
        new THREE.ConeGeometry(radius, height, 4), WONDER_MATERIALS.limestone
      );
      pyramid.position.set(x, height / 2, z);
      pyramid.rotation.y = Math.PI / 4;
      group.add(pyramid);
    }
    addBox(group, WONDER_MATERIALS.sandstone, 1.4, 0.5, 0.6, 0.4, 0, -2.3);
    addBox(group, WONDER_MATERIALS.sandstone, 0.5, 0.75, 0.5, 0.95, 0.5, -2.3);
  },

  // Der Pharos: quadratischer Unterbau, achteckiger Mittelteil, runder Turm,
  // und ganz oben das Feuer.
  lighthouse(group) {
    addBox(group, WONDER_MATERIALS.limestone, 2.6, 0.5, 2.6, 0, 0, 0);
    const lower = new THREE.Mesh(new THREE.BoxGeometry(1.9, 3.6, 1.9), WONDER_MATERIALS.limestone);
    lower.position.y = 2.3;
    group.add(lower);
    const middle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.72, 0.95, 2.4, 8), WONDER_MATERIALS.limestone
    );
    middle.position.y = 5.3;
    group.add(middle);
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.6, 1.2, 10), WONDER_MATERIALS.marble
    );
    top.position.y = 7.1;
    group.add(top);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.0, 7), WONDER_MATERIALS.fire);
    flame.position.y = 8.2;
    group.add(flame);
  },

  // Der Koloss, breitbeinig über dem Hafen, den Arm mit der Fackel erhoben.
  colossus(group) {
    addBox(group, WONDER_MATERIALS.marble, 3.0, 0.5, 3.0, 0, 0, 0);
    addBox(group, WONDER_MATERIALS.marble, 2.4, 0.5, 2.4, 0, 0.5, 0);
    const figure = new THREE.Group();
    figure.position.y = 1.0;
    // Breitbeinig über der Hafeneinfahrt, die Fackel im erhobenen Arm.
    addFigure(figure, WONDER_MATERIALS.bronze, 7.4, { armUp: true, stride: 0.85 });
    const torch = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.0, 6), WONDER_MATERIALS.fire);
    torch.position.set(1.55, 7.3, 0);
    figure.add(torch);
    group.add(figure);
  },

  // Das Mausoleum: Stufensockel, Säulenkranz, Stufenpyramide, Viergespann.
  mausoleum(group) {
    addBox(group, WONDER_MATERIALS.marble, 3.6, 1.5, 3.0, 0, 0, 0);
    addBox(group, WONDER_MATERIALS.marble, 3.2, 0.3, 2.6, 0, 1.5, 0);
    const shaft = new THREE.CylinderGeometry(0.16, 0.18, 2.2, 8);
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        const column = new THREE.Mesh(shaft, WONDER_MATERIALS.marble);
        column.position.set((i / 3 - 0.5) * 2.5, 2.9, side * 1.0);
        group.add(column);
      }
    }
    addBox(group, WONDER_MATERIALS.marble, 3.0, 0.28, 2.4, 0, 4.0, 0);
    for (let i = 0; i < 4; i++) {
      addBox(group, WONDER_MATERIALS.marble, 2.6 - i * 0.55, 0.3, 2.1 - i * 0.45,
        0, 4.28 + i * 0.3, 0);
    }
    addBox(group, WONDER_MATERIALS.gold, 1.0, 0.5, 0.6, 0, 5.48, 0);
  },

  // Die Hängenden Gärten: Terrassen über Terrassen, jede schmaler als die
  // darunter, jede bewachsen - und ein Schöpfwerk an der Seite, das das Wasser
  // aus dem Euphrat nach oben bringt.
  gardens(group) {
    const green = new THREE.MeshStandardMaterial({ color: '#4f8a3c', roughness: 0.95 });
    const levels = 4;
    for (let i = 0; i < levels; i++) {
      const width = 5.2 - i * 1.0;
      const depth = 4.0 - i * 0.78;
      const y = i * 1.15;
      addBox(group, WONDER_MATERIALS.sandstone, width, 0.95, depth, 0, y, 0);
      // Der Bewuchs steht auf der Terrasse und hängt über ihre Kante.
      addBox(group, green, width * 0.94, 0.42, depth * 0.94, 0, y + 0.95, 0);
      for (let b = 0; b < 3; b++) {
        const bush = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), green);
        bush.scale.y = 0.75;
        bush.position.set((b - 1) * width * 0.3, y + 1.3, depth * 0.36);
        group.add(bush);
      }
      // Bögen entlang der Vorderkante
      for (let a = 0; a < 4; a++) {
        addBox(group, WONDER_MATERIALS.sandstone, 0.24, 0.95, 0.24,
          (a - 1.5) * width * 0.26, y, depth / 2 - 0.1);
      }
    }
    // Das Schöpfwerk: Rad und Rinne an der Flanke.
    const wheel = new THREE.Mesh(
      new THREE.TorusGeometry(0.9, 0.12, 6, 12), WONDER_MATERIALS.sandstone
    );
    wheel.position.set(-3.1, 1.0, 1.4);
    wheel.rotation.y = Math.PI / 2;
    group.add(wheel);
    addBox(group, WONDER_MATERIALS.sandstone, 0.2, 4.2, 0.2, -3.1, 0, 1.4);
  },

  // Ein Tempel - das Maß gibt der Aufrufer über die Skalierung vor.
  temple(group) {
    group.add(makeColonnade(4.4, 2.3, { columns: 7 }));
  },

  // Der Zeustempel von Olympia, und darin die Statue, die aus ihm herausragt.
  statue(group) {
    // Der Tempel steht hinten, die Statue davor: im Inneren wäre von zwölf
    // Metern Gold und Elfenbein nichts zu sehen als ein Dach.
    const temple = makeColonnade(4.6, 2.4, { columns: 6 });
    temple.position.z = -1.6;
    group.add(temple);
    const figure = new THREE.Group();
    figure.position.set(0, 0.4, 1.5);
    addBox(group, WONDER_MATERIALS.marble, 2.2, 0.4, 1.8, 0, 0, 1.5);
    addFigure(figure, WONDER_MATERIALS.gold, 4.6);
    group.add(figure);
  },

  // Zwei Felsen zu beiden Seiten der Meerenge.
  pillars(group) {
    for (const [x, z, height, radius] of [[-1.5, 0.8, 3.6, 1.0], [1.7, -1.0, 2.8, 0.85]]) {
      const rock = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.55, radius, height, 6, 1), WONDER_MATERIALS.rock
      );
      rock.position.set(x, height / 2, z);
      rock.rotation.y = x;
      group.add(rock);
    }
  },

  // Der Steinkreis: aufrechte Blöcke, über je zweien ein Deckstein.
  stones(group) {
    const count = 9;
    const radius = 2.1;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      addBox(group, WONDER_MATERIALS.rock, 0.75, 2.4, 0.45, x, 0, z, -angle);
      if (i % 2 === 0) {
        const next = ((i + 1) / count) * Math.PI * 2;
        addBox(group, WONDER_MATERIALS.rock, 1.5, 0.35, 0.45,
          (x + Math.cos(next) * radius) / 2, 2.4, (z + Math.sin(next) * radius) / 2,
          -(angle + next) / 2);
      }
    }
    for (const [x, z] of [[0, -0.7], [0, 0.7]]) {
      addBox(group, WONDER_MATERIALS.rock, 0.9, 3.1, 0.5, x, 0, z);
    }
  },
};

let wondersGroup = null;

function buildWonders(state) {
  wondersGroup = new THREE.Group();
  wondersGroup.name = 'Wunder';
  scene.add(wondersGroup);
  if (!state.wonders) return;

  const cityTiles = new Set(state.cities.map((c) => `${c.col},${c.row}`));
  for (const wonder of state.wonders) {
    const build = WONDER_BUILDERS[wonder.model];
    if (!build) continue;
    const group = new THREE.Group();
    build(group);

    // Ein Bauwerk, das sich sein Feld mit einer Stadt teilt, weicht nach
    // Nordwesten aus und steht auf einem Felsen darüber - beim Kapitol und
    // bei der Akropolis ist genau das der historische Ort, und in der
    // Draufsicht verschwindet es sonst zwischen den Dächern.
    // Quer zur Blickrichtung an den Rand des Felds: nach hinten gerückt
    // verschwände das Bauwerk hinter den Dächern, nach vorn verdeckte sein
    // Felsen die Stadt. So stehen beide nebeneinander.
    const shared = cityTiles.has(`${wonder.col},${wonder.row}`);
    // Nur wer auf einem Burgberg steht, bekommt einen: Kapitol und Akropolis.
    // Die Pyramiden liegen auf der Wüstenterrasse neben Memphis, nicht auf
    // einem Sockel mitten in der Stadt - sie rücken deshalb weiter zur Seite
    // und stehen auf dem Boden, auf dem sie stehen.
    const aufFels = shared && wonder.perch === 'fels';
    // Die Pyramiden sind kein einzelnes Gebäude, sondern drei nebeneinander
    // gestaffelte Kegel - ihr Umriss reicht deutlich weiter als der eines
    // gewöhnlichen Bauwerks und braucht darum mehr Abstand zur Stadt, sonst
    // ragt der mittlere oder kleinste Bau trotz Eckenausweichens noch in die
    // Dächer hinein.
    const weitläufig = wonder.id === 'gizeh';
    const abstand = aufFels ? 0.38 : shared ? (weitläufig ? 1.35 : 0.62) : 0;
    // Und in welche Ecke: in die, an der kein Fluss liegt. Die Pyramiden
    // rücken so nach Westen, weg vom Nil, statt auf ihm zu stehen.
    const ecke = wonder.versatz || { sx: 1, sz: -1 };
    const dx = abstand * ecke.sx;
    const dz = abstand * ecke.sz;
    const scale = wonder.wonder ? 0.72 : 0.58;
    // Hoch genug, um über die Dächer zu ragen: Kapitol und Akropolis sind
    // Burgberge, und nur so ist das Bauwerk in der Stadt überhaupt zu sehen.
    const lift = aufFels ? 3.4 : 0;
    if (aufFels) {
      const rock = new THREE.Mesh(
        new THREE.CylinderGeometry(2.5, 3.4, (lift + 3) / scale, 7, 1), WONDER_MATERIALS.rock
      );
      rock.position.y = -(lift + 3) / (2 * scale);
      group.add(rock);
    }
    group.position.set(
      worldX(wonder.col) + dx * TILE_SIZE,
      groundY(wonder.col + dx, wonder.row + dz) - 0.15 + lift,
      worldZ(wonder.row) + dz * TILE_SIZE
    );
    group.scale.setScalar(scale);

    // Über den Stadtnamen, sonst überschreiben sich beide.
    const label = makeLabelSprite(wonder.name, { scale: 0.78, color: '#ffe4a6' });
    label.position.y = aufFels ? 13.5 : 12;
    group.add(label);
    bakeGroup(group);
    wondersGroup.add(group);
  }
}

// Ein Hafen: Steg, Poller und ein vertäutes Boot. Er steht nicht in der
// Stadt, sondern am Wasser daneben - der Steg zeigt vom Ufer aufs Meer hinaus.
// Damit ist die Regel zu sehen: nur wo dieser Steg steht, geht eine Armee an
// Bord.
function buildHarbour(scale) {
  const harbour = new THREE.Group();
  const length = 3.4 * scale;

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(length, 0.2 * scale, 1.1 * scale),
    CITY_MATERIALS.wood
  );
  deck.position.set(length / 2, 0.35 * scale, 0);
  harbour.add(deck);

  for (let i = 0; i < 4; i++) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12 * scale, 0.14 * scale, 1.1 * scale, 6),
      CITY_MATERIALS.timber
    );
    post.position.set((0.35 + i * 0.95) * scale, 0.05 * scale, (i % 2 ? 0.5 : -0.5) * scale);
    harbour.add(post);
  }

  // Das Boot liegt am Kopf des Stegs, längs vertäut.
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(0.6 * scale, 0.4 * scale, 1.7 * scale),
    CITY_MATERIALS.timber
  );
  hull.position.set(length + 0.45 * scale, 0.25 * scale, 0);
  harbour.add(hull);
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06 * scale, 0.06 * scale, 1.6 * scale, 5),
    CITY_MATERIALS.wood
  );
  mast.position.set(length + 0.45 * scale, 1.2 * scale, 0);
  harbour.add(mast);

  // Die Werft gehört zum Hafen: sie liegt neben dem Steg, mit der Helling zum
  // Wasser. Ein Hafen ohne sie ist ein Kai; ein Hafen mit ihr ist ein Ort, an
  // dem Kriegsschiffe entstehen - und genau das soll man auf der Karte
  // unterscheiden können, ohne ein Fenster zu öffnen.
  // Neben dem äußeren Teil des Stegs, nicht an seiner Wurzel: dort steht die
  // Palisade des Orts im Weg, und aus der Feldherrnperspektive verschwand die
  // Helling hinter ihr.
  const werft = buildShipyard(scale * 1.3);
  werft.position.set(3 * scale, 0, -1.9 * scale);
  werft.visible = false;
  harbour.add(werft);
  harbour.userData = { werft };
  return bakeFeature(harbour);
}

// Das Bergwerk: ein Fördergerüst über dem Schacht, eine Halde daneben und ein
// Karren auf der Rampe. Es steht nicht in der Stadt, sondern am Hang daneben -
// so wie die Stollen im Berg liegen und nicht unter den Häusern.
function buildMine(scale) {
  const mine = new THREE.Group();

  // Der Schacht: ein dunkles Loch mit einem Kranz aus Bruchstein.
  const kranz = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62 * scale, 0.72 * scale, 0.32 * scale, 8),
    CITY_MATERIALS.stone
  );
  kranz.position.y = 0.16 * scale;
  mine.add(kranz);
  const schacht = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42 * scale, 0.42 * scale, 0.1 * scale, 8),
    new THREE.MeshStandardMaterial({ color: '#17130f', roughness: 1 })
  );
  schacht.position.y = 0.33 * scale;
  mine.add(schacht);

  // Das Gerüst: zwei schräge Balken und ein Querholz mit der Rolle.
  for (const side of [-1, 1]) {
    const balken = new THREE.Mesh(
      new THREE.BoxGeometry(0.14 * scale, 1.5 * scale, 0.14 * scale),
      CITY_MATERIALS.timber
    );
    balken.position.set(side * 0.5 * scale, 0.85 * scale, 0);
    balken.rotation.z = side * 0.28;
    mine.add(balken);
  }
  const quer = new THREE.Mesh(
    new THREE.BoxGeometry(1.1 * scale, 0.13 * scale, 0.13 * scale),
    CITY_MATERIALS.timber
  );
  quer.position.y = 1.6 * scale;
  mine.add(quer);
  const rolle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2 * scale, 0.2 * scale, 0.14 * scale, 8),
    CITY_MATERIALS.wood
  );
  rolle.rotation.x = Math.PI / 2;
  rolle.position.y = 1.6 * scale;
  mine.add(rolle);

  // Die Halde: taubes Gestein, das seit Jahren neben dem Schacht wächst.
  const halde = new THREE.Mesh(
    new THREE.ConeGeometry(0.75 * scale, 0.55 * scale, 7),
    new THREE.MeshStandardMaterial({ color: '#6b5f4e', roughness: 1 })
  );
  halde.position.set(1.15 * scale, 0.27 * scale, 0.55 * scale);
  mine.add(halde);

  addFoundation(mine);
  return bakeFeature(mine);
}

// Wohin das Bergwerk gehört: an den höchsten Punkt neben dem Ort - dorthin,
// wo das Erz liegt. Alles in lokalen Koordinaten der Stadtgruppe.
// --- Die Farm --------------------------------------------------------------
// Ackerland neben der Stadt: drei Schläge in zwei Grüntönen, dazwischen die
// Furchen, und am Rand ein Schuppen. Flach genug, dass die Stadt darüber
// stehen bleibt, und groß genug, dass man sie von oben sieht.
const FIELD_MATERIALS = geteilteSammlung({
  reif: new THREE.MeshStandardMaterial({ color: '#c9a83f', roughness: 1 }),
  gruen: new THREE.MeshStandardMaterial({ color: '#7a9b45', roughness: 1 }),
  furche: new THREE.MeshStandardMaterial({ color: '#8a7440', roughness: 1 }),
});

function buildFarm(scale) {
  const farm = new THREE.Group();
  const schlaege = [
    { w: 1.5, d: 1.05, x: -0.85, z: -0.55, material: FIELD_MATERIALS.reif },
    { w: 1.5, d: 1.05, x: 0.85, z: -0.55, material: FIELD_MATERIALS.gruen },
    { w: 3.1, d: 1.05, x: 0, z: 0.62, material: FIELD_MATERIALS.reif },
  ];
  for (const schlag of schlaege) {
    const acker = new THREE.Mesh(
      new THREE.BoxGeometry(schlag.w * scale, 0.08 * scale, schlag.d * scale),
      schlag.material
    );
    acker.position.set(schlag.x * scale, 0.04 * scale, schlag.z * scale);
    farm.add(acker);
    // Furchen: ein paar dünne Streifen längs über den Schlag.
    const streifen = Math.max(2, Math.round(schlag.w * 2));
    for (let i = 0; i < streifen; i++) {
      const furche = new THREE.Mesh(
        new THREE.BoxGeometry(0.05 * scale, 0.1 * scale, schlag.d * 0.92 * scale),
        FIELD_MATERIALS.furche
      );
      const t = (i + 0.5) / streifen - 0.5;
      furche.position.set((schlag.x + t * schlag.w) * scale, 0.05 * scale, schlag.z * scale);
      farm.add(furche);
    }
  }
  // Der Schuppen am Feldrand, damit es nach Hof aussieht und nicht nach Teppich.
  const schuppen = new THREE.Mesh(
    new THREE.BoxGeometry(0.5 * scale, 0.38 * scale, 0.42 * scale),
    CITY_MATERIALS.timber
  );
  schuppen.position.set(-1.5 * scale, 0.19 * scale, 0.62 * scale);
  farm.add(schuppen);
  const dach = new THREE.Mesh(
    new THREE.ConeGeometry(0.42 * scale, 0.3 * scale, 4),
    CITY_MATERIALS.thatch
  );
  dach.position.set(-1.5 * scale, 0.53 * scale, 0.62 * scale);
  dach.rotation.y = Math.PI / 4;
  farm.add(dach);

  // Der Kornspeicher steht am Rand desselben Ackers, dessen Ernte er hält.
  // Auch hier gilt: ein Feld und ein Feld mit Speicher sollen sich auf der
  // Karte unterscheiden.
  const speicher = buildGranary(scale * 0.72);
  speicher.position.set(1.95 * scale, 0, -0.55 * scale);
  speicher.visible = false;
  farm.add(speicher);
  farm.userData = { speicher };
  addFoundation(farm, 0.1);
  return bakeFeature(farm);
}



// Ein Fundament unter einem Bauwerk außerhalb des Orts - dieselbe Terrasse wie
// unter dem Ort selbst, nur klein. Auch ein Acker, eine Kaserne oder ein Forum
// steht auf der Höhe der Feldmitte, und auch unter ihnen fällt das Gelände:
// eine Ecke stand in der Luft, die andere im Boden.
//
// Die Grundfläche wird nicht abgezählt, sondern gemessen: die Hülle über alles,
// was zu diesem Bauwerk gehört, plus ein Rand. Wie tief die Platte reicht,
// entscheidet erst `placeAt` - da steht fest, wo im Gelände sie liegt.
// Wie weit ein Fundament aus dem Boden ragt. Der Ort selbst steht auf seiner
// eigenen Terrasse; die Werke ringsum bekommen dieselbe Handbreit.
const FUNDAMENT_SOCKEL = 0.34;

function addFoundation(group, rand = 0.24) {
  const box = new THREE.Box3().setFromObject(group);
  if (!Number.isFinite(box.min.x) || !Number.isFinite(box.min.z)) return null;
  const breite = (box.max.x - box.min.x) + rand * 2;
  const tiefe = (box.max.z - box.min.z) + rand * 2;
  const platte = new THREE.Mesh(
    new THREE.BoxGeometry(breite, 1, tiefe), CITY_MATERIALS.terrace
  );
  platte.position.set((box.max.x + box.min.x) / 2, -0.5, (box.max.z + box.min.z) / 2);
  group.add(platte);
  group.userData = Object.assign({}, group.userData, {
    fundament: platte, grundRadius: Math.max(breite, tiefe) / 2,
  });
  return platte;
}

// --- Kaserne, Speicher, Forum und Werft ------------------------------------
// Was ein Ort bauen kann, soll man ihm auch ansehen. Acker, Viadukt, Stollen
// und Hafensteg standen schon auf der Karte; Kaserne, Kornspeicher, Forum und
// Werft waren nur Zeilen in der Ortsansicht. Jetzt steht jedes gebaute Werk
// da, wo es hingehört: das Forum am Rand des Orts, die Kaserne davor, der
// Speicher am Acker, die Werft neben dem Steg.
//
// Alle im selben Maßstab wie die Häuser: das Haus ist die Eins.

// Satteldächer brauchen beide Seiten: die Dachflächen sind einzelne Dreiecke
// ohne Rückseite, und von der falschen Seite gesehen wäre das Dach nicht da.
const ROOF_TIMBER = geteilt(new THREE.MeshStandardMaterial({
  color: '#7a5a34', roughness: 0.9, side: THREE.DoubleSide,
}));
const ROOF_THATCH = geteilt(new THREE.MeshStandardMaterial({
  color: '#b39456', roughness: 1, side: THREE.DoubleSide,
}));

// Die Kaserne: eine lange Halle mit Satteldach, davor der Exerzierplatz mit
// Pfahlzaun und zwei Übungspfählen.
function buildBarracks(scale) {
  const kaserne = new THREE.Group();
  const halle = new THREE.Mesh(
    new THREE.BoxGeometry(2.2 * scale, 0.72 * scale, 0.9 * scale),
    CITY_MATERIALS.plaster
  );
  halle.position.set(0, 0.36 * scale, -0.8 * scale);
  kaserne.add(halle);
  const dach = new THREE.Mesh(
    makeGableRoof(2.2 * scale, 0.9 * scale, 0.5 * scale), ROOF_TIMBER
  );
  dach.position.set(0, 0.72 * scale, -0.8 * scale);
  kaserne.add(dach);

  // Der Zaun um den Exerzierplatz: kurze Pfähle in Abständen, keine Wand -
  // drei Seiten, denn die vierte ist die Halle.
  const zaun = [];
  for (let i = -3; i <= 3; i++) zaun.push([i * 0.37, 1.15]);
  for (let j = 0; j <= 3; j++) {
    zaun.push([-1.11, 1.15 - j * 0.42]);
    zaun.push([1.11, 1.15 - j * 0.42]);
  }
  for (const [x, z] of zaun) {
    const pfahl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05 * scale, 0.06 * scale, 0.44 * scale, 5),
      CITY_MATERIALS.wood
    );
    pfahl.position.set(x * scale, 0.22 * scale, z * scale);
    kaserne.add(pfahl);
  }
  // Zwei Übungspfähle auf dem Platz - daran erkennt man einen Exerzierplatz
  // und nicht einen Viehpferch.
  for (const x of [-0.55, 0.55]) {
    const pfahl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08 * scale, 0.09 * scale, 0.85 * scale, 6),
      CITY_MATERIALS.wood
    );
    pfahl.position.set(x * scale, 0.42 * scale, 0.35 * scale);
    kaserne.add(pfahl);
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.42 * scale, 0.07 * scale, 0.07 * scale),
      CITY_MATERIALS.wood
    );
    arm.position.set(x * scale, 0.74 * scale, 0.35 * scale);
    kaserne.add(arm);
  }
  addFoundation(kaserne);
  return bakeFeature(kaserne);
}

// Der Kornspeicher: ein Bau auf Stelzen, damit weder Nässe noch Ratten
// hinkommen - so stand ein Horreum, und so steht er hier.
function buildGranary(scale) {
  const speicher = new THREE.Group();
  for (const x of [-0.42, 0.42]) {
    for (const z of [-0.3, 0.3]) {
      const stelze = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07 * scale, 0.08 * scale, 0.34 * scale, 5),
        CITY_MATERIALS.stone
      );
      stelze.position.set(x * scale, 0.17 * scale, z * scale);
      speicher.add(stelze);
    }
  }
  const kasten = new THREE.Mesh(
    new THREE.BoxGeometry(1.15 * scale, 0.6 * scale, 0.82 * scale),
    CITY_MATERIALS.plaster
  );
  kasten.position.set(0, 0.64 * scale, 0);
  speicher.add(kasten);
  const dach = new THREE.Mesh(
    makeGableRoof(1.15 * scale, 0.82 * scale, 0.4 * scale), ROOF_THATCH
  );
  dach.position.set(0, 0.94 * scale, 0);
  speicher.add(dach);
  // Die Rampe hinauf zur Tür.
  const rampe = new THREE.Mesh(
    new THREE.BoxGeometry(0.3 * scale, 0.06 * scale, 0.62 * scale),
    CITY_MATERIALS.wood
  );
  rampe.position.set(0, 0.2 * scale, 0.62 * scale);
  rampe.rotation.x = -0.5;
  speicher.add(rampe);
  return bakeFeature(speicher);
}

// --- Fischerei -------------------------------------------------------------
// Was am Strand steht, wo ein Ort vom Fang lebt: eine Hütte mit Schilfdach,
// davor die Gestelle, an denen die Netze trocknen, und ein Boot, das halb aus
// dem Wasser gezogen ist. Kein Hafen - ein Hafen ist ein Kai für Schiffe, das
// hier ist ein Strand für Boote.
const NET_MATERIAL = geteilt(new THREE.MeshStandardMaterial({
  color: '#9a8f6d', roughness: 1, transparent: true, opacity: 0.75,
  side: THREE.DoubleSide,
}));

function buildFishery(scale) {
  const fischerei = new THREE.Group();
  // Die Hütte: klein, aus Holz, mit Schilfdach.
  const huette = new THREE.Mesh(
    new THREE.BoxGeometry(0.85 * scale, 0.46 * scale, 0.62 * scale),
    CITY_MATERIALS.timber
  );
  huette.position.set(-0.48 * scale, 0.23 * scale, 0);
  fischerei.add(huette);
  const dach = new THREE.Mesh(
    makeGableRoof(0.85 * scale, 0.62 * scale, 0.3 * scale), ROOF_THATCH
  );
  dach.position.set(-0.48 * scale, 0.46 * scale, 0);
  fischerei.add(dach);

  // Die Netzgestelle: zwei Böcke mit einem Netz dazwischen. Sie stehen quer
  // zum Wasser, damit man sie von der Seite sieht.
  for (const z of [-0.42, 0.42]) {
    for (const x of [0.15, 0.8]) {
      const pfosten = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045 * scale, 0.05 * scale, 0.5 * scale, 5),
        CITY_MATERIALS.wood
      );
      pfosten.position.set(x * scale, 0.25 * scale, z * scale);
      fischerei.add(pfosten);
    }
    const netz = new THREE.Mesh(
      new THREE.PlaneGeometry(0.65 * scale, 0.32 * scale), NET_MATERIAL
    );
    netz.position.set(0.475 * scale, 0.3 * scale, z * scale);
    fischerei.add(netz);
    const stange = new THREE.Mesh(
      new THREE.BoxGeometry(0.72 * scale, 0.04 * scale, 0.04 * scale),
      CITY_MATERIALS.wood
    );
    stange.position.set(0.475 * scale, 0.47 * scale, z * scale);
    fischerei.add(stange);
  }

  // Das Boot: ein flacher Kahn, halb an Land gezogen, mit zwei Rudern.
  const kahn = new THREE.Group();
  const rumpf = new THREE.Mesh(
    new THREE.BoxGeometry(1.05 * scale, 0.16 * scale, 0.34 * scale),
    CITY_MATERIALS.wood
  );
  rumpf.position.y = 0.1 * scale;
  kahn.add(rumpf);
  for (const x of [-0.6, 0.6]) {
    const steven = new THREE.Mesh(
      new THREE.ConeGeometry(0.17 * scale, 0.3 * scale, 4),
      CITY_MATERIALS.wood
    );
    steven.position.set(x * scale, 0.11 * scale, 0);
    steven.rotation.z = x > 0 ? -Math.PI / 2 : Math.PI / 2;
    kahn.add(steven);
  }
  for (const z of [-0.2, 0.2]) {
    const riemen = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025 * scale, 0.025 * scale, 0.7 * scale, 4),
      CITY_MATERIALS.wood
    );
    riemen.position.set(0.1 * scale, 0.2 * scale, z * scale);
    riemen.rotation.set(0, 0.25, Math.PI / 2);
    kahn.add(riemen);
  }
  kahn.position.set(0.22 * scale, 0.02 * scale, -0.72 * scale);
  kahn.rotation.y = 0.4;
  fischerei.add(kahn);

  addFoundation(fischerei, 0.12);
  fischerei.userData.werk = 'fischerei';
  return bakeFeature(fischerei);
}

// --- Jagdhütte -------------------------------------------------------------
// Am Waldrand: ein Blockhaus mit Schindeldach, davor das Gestell, an dem das
// Wild hängt, und ein Stapel Scheite. Sie steht auf Pfählen wie der Speicher -
// was an ihr hängt, soll kein Fuchs erreichen.
function buildHuntLodge(scale) {
  const jagd = new THREE.Group();
  // Das Blockhaus: Balkenlagen übereinander, damit es nicht wie ein Kasten
  // aussieht.
  const lagen = 4;
  for (let i = 0; i < lagen; i++) {
    const balken = new THREE.Mesh(
      new THREE.BoxGeometry(0.95 * scale, 0.13 * scale, 0.78 * scale),
      i % 2 ? CITY_MATERIALS.wood : CITY_MATERIALS.timber
    );
    balken.position.set(0, (0.09 + i * 0.13) * scale, 0);
    jagd.add(balken);
  }
  const dach = new THREE.Mesh(
    makeGableRoof(0.95 * scale, 0.78 * scale, 0.34 * scale), ROOF_TIMBER
  );
  dach.position.set(0, 0.6 * scale, 0);
  jagd.add(dach);

  // Das Gestell davor - zwei Gabeln und eine Stange, daran hängt der Fang.
  for (const z of [-0.42, 0.42]) {
    const gabel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045 * scale, 0.055 * scale, 0.62 * scale, 5),
      CITY_MATERIALS.wood
    );
    gabel.position.set(0.95 * scale, 0.31 * scale, z * scale);
    jagd.add(gabel);
  }
  const stange = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035 * scale, 0.035 * scale, 0.98 * scale, 5),
    CITY_MATERIALS.wood
  );
  stange.position.set(0.95 * scale, 0.6 * scale, 0);
  stange.rotation.x = Math.PI / 2;
  jagd.add(stange);
  // Was daran hängt: ein Stück Wild, dunkel, ohne Einzelheiten - aus der
  // Feldherrnperspektive ist es ein Fleck, und mehr braucht es nicht.
  const beute = new THREE.Mesh(
    new THREE.BoxGeometry(0.16 * scale, 0.36 * scale, 0.14 * scale),
    new THREE.MeshStandardMaterial({ color: '#6b4b2c', roughness: 1 })
  );
  beute.position.set(0.95 * scale, 0.4 * scale, 0.12 * scale);
  jagd.add(beute);

  // Der Holzstapel an der Wand.
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const scheit = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055 * scale, 0.055 * scale, 0.6 * scale, 5),
        CITY_MATERIALS.wood
      );
      scheit.position.set((-0.62 - j * 0.11) * scale, (0.06 + i * 0.11) * scale, 0);
      scheit.rotation.x = Math.PI / 2;
      jagd.add(scheit);
    }
  }

  addFoundation(jagd, 0.18);
  jagd.userData.werk = 'jagd';
  return bakeFeature(jagd);
}

// Das Forum: die Basilika des Orts - ein Säulenbau mit Giebel, kein
// gepflasterter Platz mit einem Geländer. Vorher stand hier eine niedrige
// Kolonnade um eine Rednerbühne; aus der Feldherrnperspektive sah das aus wie
// ein Zaun. Was gemeint ist, ist ein großes Säulengebäude, und so steht es
// jetzt da: Stufen, Säulen ringsum, Gebälk, Dach mit Giebel.
function buildForum(scale) {
  const forum = new THREE.Group();
  const breite = 2.4 * scale;
  const tiefe = 1.7 * scale;

  // Der Unterbau: zwei Stufen, auf denen das Haus steht.
  for (let i = 0; i < 2; i++) {
    const ueberstand = (0.34 - i * 0.17) * scale;
    const stufe = new THREE.Mesh(
      new THREE.BoxGeometry(breite + ueberstand, 0.13 * scale, tiefe + ueberstand),
      CITY_MATERIALS.marble
    );
    stufe.position.y = (0.065 + i * 0.13) * scale;
    forum.add(stufe);
  }

  // Die Cella: der geschlossene Kern zwischen den Säulen.
  const kern = new THREE.Mesh(
    new THREE.BoxGeometry(breite * 0.66, 0.95 * scale, tiefe * 0.6),
    CITY_MATERIALS.plaster
  );
  kern.position.y = 0.74 * scale;
  forum.add(kern);

  // Die Säulen: eine Reihe an jeder Längsseite, drei an jeder Schmalseite.
  const saeule = new THREE.CylinderGeometry(0.09 * scale, 0.1 * scale, 0.95 * scale, 7);
  const stellen = [];
  for (let i = -3; i <= 3; i++) {
    stellen.push([i * (breite / 7.4), tiefe / 2 - 0.1 * scale]);
    stellen.push([i * (breite / 7.4), -tiefe / 2 + 0.1 * scale]);
  }
  for (const seite of [-1, 1]) {
    stellen.push([seite * (breite / 2 - 0.1 * scale), 0]);
  }
  for (const [x, z] of stellen) {
    const s2 = new THREE.Mesh(saeule, CITY_MATERIALS.marble);
    s2.position.set(x, 0.74 * scale, z);
    forum.add(s2);
  }

  // Das Gebälk über den Säulen.
  const gebaelk = new THREE.Mesh(
    new THREE.BoxGeometry(breite + 0.12 * scale, 0.18 * scale, tiefe + 0.12 * scale),
    CITY_MATERIALS.marble
  );
  gebaelk.position.y = 1.31 * scale;
  forum.add(gebaelk);

  // Das Dach mit Giebel - dasselbe Satteldach wie über einem Haus, nur groß.
  const dach = new THREE.Mesh(
    makeGableRoof(breite + 0.2 * scale, tiefe + 0.2 * scale, 0.5 * scale),
    new THREE.MeshStandardMaterial({
      color: '#c8623f', roughness: 0.7, side: THREE.DoubleSide,
    })
  );
  dach.position.y = 1.4 * scale;
  forum.add(dach);
  addFoundation(forum);
  return bakeFeature(forum);
}

// Die Werft: die Helling mit dem halbfertigen Rumpf auf den Stapelblöcken und
// dem Kranbaum daneben. Sie steht am Ufer neben dem Steg - was hier vom
// Stapel läuft, liegt eine Runde später im Hafen.
function buildShipyard(scale) {
  const werft = new THREE.Group();
  // Die Helling: eine schiefe Ebene, die ins Wasser führt, auf Pfählen wie
  // der Steg daneben. Ohne die Pfähle stünde sie auf der Wasserlinie und
  // versänke am Ufer im Boden.
  const helling = new THREE.Mesh(
    new THREE.BoxGeometry(1.9 * scale, 0.1 * scale, 1.1 * scale),
    CITY_MATERIALS.wood
  );
  helling.position.set(0, 0.3 * scale, 0);
  helling.rotation.z = 0.12;
  werft.add(helling);
  for (const px of [-0.75, 0, 0.75]) {
    for (const pz of [-0.45, 0.45]) {
      const pfahl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08 * scale, 0.1 * scale, 1.2 * scale, 5),
        CITY_MATERIALS.timber
      );
      pfahl.position.set(px * scale, -0.25 * scale, pz * scale);
      werft.add(pfahl);
    }
  }
  // Der Rumpf im Bau: Kiel, Spanten, noch keine Beplankung.
  const kiel = new THREE.Mesh(
    new THREE.BoxGeometry(1.5 * scale, 0.13 * scale, 0.16 * scale),
    CITY_MATERIALS.timber
  );
  kiel.position.set(0, 0.54 * scale, 0);
  werft.add(kiel);
  for (let i = -2; i <= 2; i++) {
    const spant = new THREE.Mesh(
      new THREE.TorusGeometry(0.26 * scale, 0.035 * scale, 4, 8, Math.PI),
      CITY_MATERIALS.timber
    );
    spant.position.set(i * 0.3 * scale, 0.56 * scale, 0);
    spant.rotation.y = Math.PI / 2;
    spant.rotation.z = Math.PI;
    werft.add(spant);
  }
  // Der Kranbaum: ein schräger Mast mit Strebe, wie er zum Setzen der Spanten
  // gebraucht wurde.
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06 * scale, 0.08 * scale, 1.3 * scale, 5),
    CITY_MATERIALS.wood
  );
  mast.position.set(-0.85 * scale, 0.72 * scale, -0.5 * scale);
  mast.rotation.z = 0.28;
  werft.add(mast);
  const ausleger = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04 * scale, 0.05 * scale, 0.8 * scale, 4),
    CITY_MATERIALS.wood
  );
  ausleger.position.set(-0.6 * scale, 1.26 * scale, -0.5 * scale);
  ausleger.rotation.z = 1.15;
  werft.add(ausleger);
  return werft;
}

// --- Das Viadukt -----------------------------------------------------------
// Wasser über das Tal, auf Bögen, über Meilen: eine Reihe Pfeiler mit Bögen
// dazwischen und der Rinne obendrauf, die vom höchsten Nachbarfeld zur Stadt
// führt. Von oben ist es das, woran man ein römisches Land erkennt.
const VIADUCT_ARCHES = 5;

function buildViaduct(scale) {
  const viadukt = new THREE.Group();
  const spanne = 0.95 * scale;
  const hoehe = 1.35 * scale;
  for (let i = 0; i < VIADUCT_ARCHES; i++) {
    const x = (i - (VIADUCT_ARCHES - 1) / 2) * spanne;
    const pfeiler = new THREE.Mesh(
      new THREE.BoxGeometry(0.3 * scale, hoehe, 0.42 * scale),
      CITY_MATERIALS.stone
    );
    pfeiler.position.set(x, hoehe / 2, 0);
    viadukt.add(pfeiler);
    // Der Bogen: ein halber Ring zwischen zwei Pfeilern.
    if (i < VIADUCT_ARCHES - 1) {
      const bogen = new THREE.Mesh(
        new THREE.TorusGeometry(spanne * 0.36, 0.09 * scale, 6, 10, Math.PI),
        CITY_MATERIALS.stone
      );
      bogen.position.set(x + spanne / 2, hoehe - 0.02 * scale, 0);
      viadukt.add(bogen);
    }
  }
  // Die Rinne obendrauf, in der das Wasser läuft.
  const rinne = new THREE.Mesh(
    new THREE.BoxGeometry(VIADUCT_ARCHES * spanne, 0.26 * scale, 0.5 * scale),
    CITY_MATERIALS.marble
  );
  rinne.position.y = hoehe + 0.13 * scale;
  viadukt.add(rinne);
  const wasser = new THREE.Mesh(
    new THREE.BoxGeometry(VIADUCT_ARCHES * spanne * 0.94, 0.06 * scale, 0.22 * scale),
    new THREE.MeshStandardMaterial({
      color: '#4f92c4', roughness: 0.25, emissive: '#123249', emissiveIntensity: 0.35,
    })
  );
  wasser.position.y = hoehe + 0.26 * scale;
  viadukt.add(wasser);
  return bakeFeature(viadukt);
}

// Wo ein Bauwerk neben der Stadt steht: das höchste oder das flachste
// Nachbarfeld, und nie dasselbe zweimal.
// Ob auf diesem Feld überhaupt etwas stehen kann. Ohne diese Prüfung suchte
// die Farm sich das flachste Nachbarfeld - und das ist an jeder Küste das
// Meer: die Äcker lagen dann im Wasser, mitten auf dem Hafen. Fels und Eis
// scheiden aus demselben Grund aus.
function baugrund(col, row) {
  if (!currentMap) return false;
  if (col < 0 || col >= currentMap.cols || row < 0 || row >= currentMap.rows) return false;
  const tile = currentMap.tiles[row][col];
  if (tile.type === 'water' || tile.type === 'mountain') return false;
  // Und nicht auf der Straße: ein Acker quer über den gepflasterten Weg sieht
  // aus wie ein Versehen, und eines wäre es auch.
  if (currentRoads[`${col},${row}`]) return false;
  return true;
}

function neighbourSpot(city, prefer, taken = []) {
  const belegt = new Set(taken.map(([dc, dr]) => `${dc},${dr}`));
  let best = null;
  let bestY = prefer === 'high' ? -Infinity : Infinity;
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    if (belegt.has(`${dc},${dr}`)) continue;
    if (!baugrund(city.col + dc, city.row + dr)) continue;
    const y = surfaceY(city.col + dc, city.row + dr);
    if (!Number.isFinite(y)) continue;
    if (prefer === 'high' ? y <= bestY : y >= bestY) continue;
    bestY = y;
    best = [dc, dr];
  }
  // Eine Insel, um die herum nur Wasser liegt: dann steht das Bauwerk am Ort
  // selbst, nicht im Meer.
  if (!best) return { dir: null, y: surfaceY(city.col, city.row) };
  return { dir: best, y: bestY };
}

// `gerade` richtet das Bauwerk am Feldraster aus statt auf den Ort zu: ein
// Acker ist ein Viereck, und ein Viereck, das schräg im Gelände liegt, sieht
// aus wie hingeworfen. Die Häuser, die Straße und die Feldgrenzen laufen alle
// in denselben zwei Richtungen; die Schläge tun es jetzt auch.
// `quer` verschiebt zusätzlich seitwärts - so steht der Speicher am Rand
// desselben Ackers, auf dem die Schläge liegen.
function placeAt(group, city, cityY, spot, abstand = 1, optionen = {}) {
  const { gerade = false, quer = 0 } = optionen;
  if (!spot.dir) {
    // Kein Nachbarfeld, auf dem etwas stehen könnte - eine Insel, ein Ort
    // zwischen Fels und Wasser: dann drängt sich das Bauwerk an den Ort selbst,
    // statt ins Meer zu rutschen.
    group.position.set(TILE_SIZE * 0.34, 0, -TILE_SIZE * 0.34);
    group.rotation.y = Math.PI * 0.25;
    return;
  }
  const [dc, dr] = spot.dir;
  const laenge = Math.hypot(dc, dr) || 1;
  const winkel = Math.atan2(-dr, dc);
  // Quer zur Richtung: (dr, -dc), auf Länge eins gebracht.
  const lx = (dc / laenge) * TILE_SIZE * abstand + (dr / laenge) * quer;
  const lz = (dr / laenge) * TILE_SIZE * abstand - (dc / laenge) * quer;
  // Die Höhe wird am Boden genommen, nicht geschätzt: vorher stand hier die
  // halbe Höhendifferenz zum Nachbarfeld, und ein Bauwerk, das nicht genau
  // auf einer Feldmitte steht - am Ortsrand, am Feldrain -, stand damit im
  // Hang oder schwebte darüber.
  const wx = worldX(city.col) + lx;
  const wz = worldZ(city.row) + lz;
  const oben = bandY(wx, wz);
  // Jedes Werk außerhalb des Orts steht auf einem Sockel, nicht auf dem
  // blanken Gras: eine gestampfte Terrasse, die eine Handbreit aus dem Boden
  // ragt. Vorher füllte das Fundament nur die Mulde darunter aus und war von
  // oben gar nicht zu sehen - ein Acker, eine Kaserne, ein Forum sahen aus,
  // als lägen sie auf der Wiese.
  group.position.set(lx, oben - cityY + FUNDAMENT_SOCKEL, lz);
  // Und wie tief es reicht: bis unter die tiefste Stelle des Bodens, den es
  // überdeckt, plus den Sockel darüber. In der Ebene ist das eine Handbreit,
  // am Hang ein halber Meter.
  const platte = group.userData && group.userData.fundament;
  if (platte) {
    const r = group.userData.grundRadius;
    let tief = 0.3;
    for (const [dx, dz] of [[-r, -r], [r, -r], [-r, r], [r, r], [-r, 0], [r, 0],
      [0, -r], [0, r]]) {
      tief = Math.max(tief, oben - bandY(wx + dx, wz + dz) + 0.22);
    }
    tief += FUNDAMENT_SOCKEL;
    platte.scale.y = tief;
    platte.position.y = -tief / 2;
  }
  // Auf den rechten Winkel gerundet: das Bauwerk steht dann parallel zum
  // Feldraster, auch wenn es auf einem Eckfeld liegt.
  group.rotation.y = gerade
    ? Math.round(winkel / (Math.PI / 2)) * (Math.PI / 2)
    : winkel;
}

// Setzt den Steg ans Ufer zwischen Stadt und offenem Wasser, mit dem Kopf zum
// Meer. Alles in lokalen Koordinaten der Stadtgruppe.
function placeHarbour(harbour, city, sea, cityY) {
  const dx = sea.col - city.col;
  const dz = sea.row - city.row;
  const distance = Math.max(1, Math.abs(dx) + Math.abs(dz));
  // Am Ufer beginnen: ein halbes Feld vor dem Wasserfeld.
  const startX = (dx / distance) * TILE_SIZE * (distance - 0.5);
  const startZ = (dz / distance) * TILE_SIZE * (distance - 0.5);
  harbour.position.set(startX, SEA_LEVEL_Y - cityY, startZ);
  harbour.rotation.y = Math.atan2(-dz, dx);

  // Die Werft steht am Ufer und nicht auf der Wasserlinie: der Steg ist auf
  // Pfähle gebaut und darf über dem Wasser schweben, eine Helling liegt auf
  // dem Strand. Auf Meereshöhe gesetzt verschwand sie in der Uferböschung -
  // die Höhe kommt deshalb vom Boden an genau ihrer Stelle.
  const werft = harbour.userData && harbour.userData.werft;
  if (werft) {
    const winkel = harbour.rotation.y;
    const wx = worldX(city.col) + startX
      + werft.position.x * Math.cos(winkel) + werft.position.z * Math.sin(winkel);
    const wz = worldZ(city.row) + startZ
      - werft.position.x * Math.sin(winkel) + werft.position.z * Math.cos(winkel);
    werft.position.y = Math.max(0, bandY(wx, wz) - SEA_LEVEL_Y);
  }
}

// Setzt ein Bauwerk ans Ufer, aber an Land: dieselbe Richtung wie der Steg,
// nur ein Stück zurück und seitlich daneben. `rueck` ist der Abstand vom
// Wasserfeld in Feldern, `quer` die Verschiebung quer dazu in Welteinheiten.
function placeShore(group, city, sea, cityY, { rueck = 0.9, quer = 0 } = {}) {
  const dx = sea.col - city.col;
  const dz = sea.row - city.row;
  const distance = Math.max(1, Math.abs(dx) + Math.abs(dz));
  const nx = dx / distance;
  const nz = dz / distance;
  const lx = nx * TILE_SIZE * (distance - rueck) + nz * quer;
  const lz = nz * TILE_SIZE * (distance - rueck) - nx * quer;
  const wx = worldX(city.col) + lx;
  const wz = worldZ(city.row) + lz;
  // Nie unter die Wasserlinie: am flachen Ufer liegt der Boden dort schon
  // tiefer als das Meer, und die Hütte stünde bis zum Dach im Wasser.
  const oben = Math.max(bandY(wx, wz), SEA_LEVEL_Y + 0.05);
  group.position.set(lx, oben - cityY + FUNDAMENT_SOCKEL, lz);
  group.rotation.y = Math.atan2(-dz, dx);
  const platte = group.userData && group.userData.fundament;
  if (platte) {
    const tief = 0.6 + FUNDAMENT_SOCKEL;
    platte.scale.y = tief;
    platte.position.y = -tief / 2;
  }
}

// Das Nachbarfeld mit dem meisten Wald - dort gehört die Jagdhütte hin. Gibt
// es keines, bleibt es bei null, und der Aufrufer nimmt irgendein freies.
function waldSpot(city, taken = []) {
  if (!currentMap) return null;
  const belegt = new Set(taken.map(([dc, dr]) => `${dc},${dr}`));
  let best = null;
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    if (belegt.has(`${dc},${dr}`)) continue;
    const col = city.col + dc;
    const row = city.row + dr;
    if (!baugrund(col, row)) continue;
    if (currentMap.tiles[row][col].type !== 'forest') continue;
    best = { dir: [dc, dr], y: surfaceY(col, row) };
    break;
  }
  return best;
}

// Wie groß ein Heer auf der Karte erscheint. Ein Trupp von 80 Mann und ein
// Heer von 900 sollen sich schon von weitem unterscheiden - deshalb wächst
// beides: die Zahl der Zelte und die Größe des ganzen Lagers.
function tierForCount(count) {
  if (count >= 900) return 8;
  if (count >= 700) return 7;
  if (count >= 520) return 6;
  if (count >= 380) return 5;
  if (count >= 260) return 4;
  if (count >= 160) return 3;
  if (count >= 80) return 2;
  return 1;
}

// 0,68 für eine Handvoll Männer bis 1,45 für ein volles Heer.
function armyScale(count) {
  return 0.68 + Math.min(1, count / 850) * 0.77;
}

// A single ship: hull, mast and sail. The whole fleet is drawn as one vessel
// with the army's banner on it, the same way a camp stands in for an army.
// Drei Bauarten, wie sie das Spiel unterscheidet: die schwere Quinquereme mit
// Turm und Enterbrücke, der leichte Ruderer der Ägäis und der Adria, und das
// hochbordige Segelschiff des Nordens. Was eine Fraktion fährt, sagt data.js.
const SHIP_TIMBER = geteilt(new THREE.MeshStandardMaterial({
  color: '#6b4423', roughness: 0.85, side: THREE.DoubleSide,
}));
const SHIP_DECK = geteilt(new THREE.MeshStandardMaterial({ color: '#8a5c2e', roughness: 0.9 }));
const SHIP_MAST = geteilt(new THREE.MeshStandardMaterial({ color: '#4a3520' }));

function buildShip(color, kind = 'lembos') {
  const ship = new THREE.Group();
  const heavy = kind === 'quinquereme';
  const sailer = kind === 'keltenschiff';
  // Der Transporter ist kein Kriegsschiff: kurz, bauchig, hochbordig, ein
  // einziges Rahsegel und kein Rammsporn. Man erkennt ihn von oben daran,
  // dass er breiter aussieht, als er lang ist.
  const hulk = kind === 'transport';
  // Die Hemiolia der Seeräuber: anderthalb Ruderreihen, kein Turm, kein
  // Ballast - lang, schmal und tief im Wasser. Der Lembos ist ihr kleiner
  // Bruder, die Triere das Maß, an dem sich beide messen.
  const raider = kind === 'hemiolia';
  const light = raider || kind === 'lembos';
  const length = hulk ? 2.9 : heavy ? 4.2 : sailer ? 3.3 : raider ? 3.4 : light ? 2.9 : 3.6;
  const beam = hulk ? 0.92 : heavy ? 0.78 : sailer ? 0.86 : light ? 0.46 : 0.58;

  const hull = new THREE.Mesh(
    new THREE.CylinderGeometry(beam, beam * 0.55, length, 8, 1, false, 0, Math.PI),
    SHIP_TIMBER
  );
  hull.rotation.z = Math.PI / 2;
  hull.rotation.y = Math.PI / 2;
  hull.position.y = beam * 0.68;
  ship.add(hull);

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(beam * 1.85, 0.16, length * 0.94),
    SHIP_DECK
  );
  deck.position.y = beam + 0.06;
  ship.add(deck);

  if (hulk) {
    // Hohe Bordwände, ein gebogener Achtersteven und Fracht an Deck: Kisten,
    // Fässer, Zelte. Ein Heer reist mit allem, was es besitzt.
    for (const side of [-1, 1]) {
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(0.13, 0.5, length * 0.9),
        SHIP_TIMBER
      );
      board.position.set(side * beam * 0.92, beam + 0.3, 0);
      ship.add(board);
    }
    const steven = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.95, 0.28), SHIP_TIMBER);
    steven.position.set(0, beam + 0.5, length * 0.44);
    steven.rotation.x = -0.3;
    ship.add(steven);
    for (const [cx, cz, h] of [[-0.3, -0.5, 0.34], [0.28, -0.1, 0.28], [-0.1, 0.5, 0.3]]) {
      const cargo = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, h, 0.42),
        SHIP_DECK
      );
      cargo.position.set(cx, beam + 0.06 + h / 2, cz);
      cargo.rotation.y = cx * 1.4;
      ship.add(cargo);
    }
  } else if (sailer) {
    // Der Kelten-Segler: hohe Bordwände, keine Ruder, ein breites Ledersegel.
    for (const side of [-1, 1]) {
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.62, length * 0.9),
        SHIP_TIMBER
      );
      board.position.set(side * beam * 0.9, beam + 0.36, 0);
      ship.add(board);
    }
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.1, 0.3), SHIP_TIMBER);
    stem.position.set(0, beam + 0.6, -length * 0.46);
    ship.add(stem);
  } else {
    // Ruderer: eine Reihe Riemen je Seite, bei der Quinquereme zwei - und bei
    // der Hemiolia anderthalb, daher der Name: die obere Reihe reicht nur bis
    // zur Mitte, damit vorn Platz zum Entern bleibt.
    const banks = heavy || raider ? 2 : 1;
    for (let bank = 0; bank < banks; bank++) {
      for (const side of [-1, 1]) {
        for (let i = 0; i < 7; i++) {
          if (raider && bank === 1 && i > 3) continue;
          const oar = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 0.05, 0.95),
            SHIP_MAST
          );
          oar.position.set(
            side * (beam + 0.28), beam - 0.06 - bank * 0.2,
            -length * 0.34 + (i / 6) * length * 0.68
          );
          oar.rotation.y = side * 1.15;
          ship.add(oar);
        }
      }
    }
    // Der Rammsporn am Bug.
    const ram = new THREE.Mesh(
      new THREE.ConeGeometry(0.2, 0.9, 6),
      new THREE.MeshStandardMaterial({ color: '#7c6a4a', roughness: 0.6, metalness: 0.3 })
    );
    ram.rotation.x = -Math.PI / 2;
    ram.position.set(0, beam * 0.5, -length * 0.6);
    ship.add(ram);
  }

  if (heavy) {
    // Turm und Enterbrücke - was die römische Flotte aus einer Seeschlacht
    // eine Landschlacht machen ließ.
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), SHIP_DECK);
    tower.position.set(0, beam + 0.55, length * 0.22);
    ship.add(tower);
    const corvus = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 1.7), SHIP_TIMBER);
    corvus.position.set(0, beam + 0.28, -length * 0.42);
    corvus.rotation.x = 0.22;
    ship.add(corvus);
  }

  const mastHeight = hulk ? 2.2 : sailer ? 2.9 : 2.4;
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.09, mastHeight, 6),
    SHIP_MAST
  );
  mast.position.y = mastHeight / 2 + beam;
  ship.add(mast);

  const sail = new THREE.Mesh(
    new THREE.PlaneGeometry(hulk ? 1.9 : sailer ? 2.3 : 1.7, hulk ? 1.5 : sailer ? 1.9 : 1.4),
    new THREE.MeshStandardMaterial({ color, roughness: 0.75, side: THREE.DoubleSide })
  );
  sail.position.set(0, beam + mastHeight * 0.66, 0);
  sail.rotation.y = Math.PI / 2;
  ship.add(sail);
  ship.userData.sail = sail;

  // A wake, so a fleet at sea does not look like it is standing on glass.
  const wake = new THREE.Mesh(
    new THREE.RingGeometry(1.5, 2.4, 24),
    new THREE.MeshBasicMaterial({
      color: '#dff0ff', transparent: true, opacity: 0.3,
      side: THREE.DoubleSide, depthWrite: false,
    })
  );
  wake.rotation.x = -Math.PI / 2;
  wake.position.y = 0.06;
  ship.add(wake);

  if (raider) {
    // Der schwarze Wimpel: das Einzige, woran man sie von Weitem erkennt.
    const wimpel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.3),
      new THREE.MeshStandardMaterial({
        color: '#0b0b0d', roughness: 0.9, side: THREE.DoubleSide,
      })
    );
    wimpel.position.set(0.45, beam + mastHeight - 0.15, 0);
    wimpel.rotation.y = Math.PI / 2;
    ship.add(wimpel);
  }

  ship.userData.kind = kind;
  ship.userData.sails = [sail];
  return ship;
}

// Ein Heer auf See ist ein Geleitzug, kein einzelnes Schiff: drei Rümpfe in
// loser Kiellinie, damit auf der Karte zu sehen ist, dass hier eine Armee
// verschifft wird und keine Flotte kreuzt.
const CONVOY_OFFSETS = [[0, 0], [-0.95, 1.5], [0.9, -1.4]];

function buildConvoy(color) {
  const convoy = new THREE.Group();
  const sails = [];
  CONVOY_OFFSETS.forEach(([dx, dz], index) => {
    const hull = buildShip(color, 'transport');
    hull.position.set(dx, 0, dz);
    hull.rotation.y = (index - 1) * 0.16;
    hull.scale.setScalar(index === 0 ? 1 : 0.82);
    sails.push(...hull.userData.sails);
    convoy.add(hull);
  });
  convoy.userData.kind = 'transport';
  convoy.userData.sails = sails;
  return convoy;
}

function buildArmyGroup() {
  const group = new THREE.Group();
  const tents = new THREE.Group();
  group.add(tents);
  group.userData.tents = tents;

  // Welche Bauart gefahren wird, steht erst fest, wenn die Armee bekannt ist -
  // das Modell entsteht deshalb beim ersten Auslaufen.
  group.userData.ship = null;

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 3.2, 5),
    new THREE.MeshStandardMaterial({ color: '#3a2c1d' })
  );
  pole.position.y = 1.6;
  group.add(pole);
  group.userData.pole = pole;

  const flag = new THREE.Group();
  flag.position.set(0, 2.6, 0);
  group.add(flag);
  billboards.push(flag);
  group.userData.flag = flag;
  const banner = makeBannerCloth(
    1.3, 1.6,
    new THREE.MeshStandardMaterial({ color: '#999', side: THREE.DoubleSide })
  );
  flag.add(banner);
  group.userData.banner = banner;

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.9, 0.12, 8, 24),
    new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.15;
  group.add(ring);
  group.userData.ring = ring;

  // Wer im Krieg mit dir steht, bekommt einen Ring aus Rot um die Füße.
  // Die Fraktionsfarbe allein sagt, wer da steht, aber nicht, ob er auf dich
  // schießt: zwischen einem Verbündeten und einem Feind lag bisher nur die
  // Erinnerung an das Diplomatiefenster.
  const feindRing = new THREE.Mesh(
    new THREE.RingGeometry(1.55, 2.2, 28),
    new THREE.MeshBasicMaterial({
      color: '#c0392b', transparent: true, opacity: 0, side: THREE.DoubleSide,
    })
  );
  feindRing.rotation.x = -Math.PI / 2;
  feindRing.position.y = 0.1;
  group.add(feindRing);
  group.userData.feindRing = feindRing;

  return group;
}

// Graben, Wall und Palisade um die Zelte: ein Ring aus Erde mit angespitzten
// Stämmen darauf. Er entsteht erst, wenn ein Lager aufgeschlagen wird - die
// meisten Heere stehen im offenen Feld.
const CAMP_STAKES = 16;

function buildCampRing() {
  const ring = new THREE.Group();
  const wall = new THREE.Mesh(
    new THREE.TorusGeometry(2.5, 0.3, 6, 22),
    new THREE.MeshStandardMaterial({ color: '#6b5638', roughness: 0.95 })
  );
  wall.rotation.x = -Math.PI / 2;
  wall.position.y = 0.22;
  ring.add(wall);
  const stakeGeometry = new THREE.CylinderGeometry(0.06, 0.1, 0.9, 4);
  const stakeMaterial = new THREE.MeshStandardMaterial({ color: '#4a3a2a', roughness: 1 });
  for (let i = 0; i < CAMP_STAKES; i++) {
    const angle = (i / CAMP_STAKES) * Math.PI * 2;
    const stake = new THREE.Mesh(stakeGeometry, stakeMaterial);
    stake.position.set(Math.cos(angle) * 2.5, 0.62, Math.sin(angle) * 2.5);
    stake.rotation.z = (i % 2 ? 1 : -1) * 0.08;
    ring.add(stake);
  }
  return ring;
}

// --- Der Hinterhalt -------------------------------------------------------
// Ein lauerndes Heer sieht nur die eigene Seite - und die soll es auf einen
// Blick erkennen, ohne die Anzeige zu öffnen. Also duckt es sich hinter ein
// Gebüsch: ein Kranz niedriger, breitgedrückter Sträucher um die Zelte. Das
// Lager stellt einen Wall auf, der Hinterhalt zieht ein Dickicht zu.
const AMBUSH_BUSHES = 9;

function buildAmbushCover() {
  const busch = new THREE.Group();
  const laub = new THREE.MeshStandardMaterial({ color: '#3f6b34', roughness: 1 });
  const geometrie = new THREE.SphereGeometry(0.42, 6, 4);
  for (let i = 0; i < AMBUSH_BUSHES; i++) {
    const winkel = (i / AMBUSH_BUSHES) * Math.PI * 2;
    const strauch = new THREE.Mesh(geometrie, laub);
    const weite = 2.3 + (i % 3) * 0.22;
    strauch.position.set(Math.cos(winkel) * weite, 0.24, Math.sin(winkel) * weite);
    strauch.scale.set(1 + (i % 2) * 0.3, 0.62, 1 + (i % 3) * 0.2);
    busch.add(strauch);
  }
  return busch;
}

// --- Die Kolonne ----------------------------------------------------------
// Ein Heer, das marschiert, ist kein Zeltlager. Für die Dauer des Marsches
// treten die Zelte ab und eine Kolonne tritt an: eine Reihe von Gestalten
// hintereinander, versetzt wie eine Marschordnung, dazu vorneweg das
// Feldzeichen. Sie zeigt auch, wohin es geht - das Lager kann das nicht.
const COLUMN_MAX = 12;

// Die drei Waffengattungen, wie sie in der Kolonne aussehen. Vorher marschierte
// eine Reihe gleicher Kegel - ein Heer aus dreihundert Reitern sah aus wie ein
// Heer aus dreihundert Bogenschützen. Jetzt hat jede Gattung ihre Gestalt:
// das Fußvolk breit mit Schild und aufgesetztem Speer, die Reiterei hoch zu
// Pferd mit der Lanze, die Schützen schmal mit dem Bogen über der Schulter.
//
// Gebaut wird jede Gattung einmal als verschmolzene Geometrie; jeder Platz in
// der Kolonne bekommt alle drei und zeigt die, die dort marschiert.
function marcherGeometry(rolle) {
  const h = MARCHER_HEIGHT;
  const teile = [];
  if (rolle === 'cavalry') {
    // Das Pferd: Leib, Hals, Kopf, vier Läufe. Darüber der Reiter.
    const leib = new THREE.SphereGeometry(0.2, 7, 5);
    const lauf = new THREE.CylinderGeometry(0.04, 0.035, h * 0.5, 4);
    const hals = new THREE.CylinderGeometry(0.055, 0.075, h * 0.34, 5);
    const kopf = new THREE.SphereGeometry(0.075, 6, 5);
    const rumpf = new THREE.CylinderGeometry(0.1, 0.13, h * 0.5, 5);
    const haupt = new THREE.SphereGeometry(0.095, 6, 5);
    const lanze = new THREE.CylinderGeometry(0.018, 0.018, h * 1.5, 4);
    teile.push(shapePart(leib, 0, h * 0.62, 0, 0, 0, 0, 1.7, 0.85, 0.95));
    for (const x of [-0.2, 0.19]) {
      for (const z of [-0.1, 0.1]) teile.push(shapePart(lauf, x, h * 0.25, z));
    }
    teile.push(shapePart(hals, 0.28, h * 0.78, 0, 0, 0, -0.5));
    teile.push(shapePart(kopf, 0.42, h * 0.92, 0, 0, 0, 0, 1.5, 1, 1));
    teile.push(shapePart(rumpf, -0.02, h * 0.98, 0));
    teile.push(shapePart(haupt, -0.02, h * 1.3, 0));
    teile.push(shapePart(lanze, 0.12, h * 1.15, 0.13, 0, 0, 0.22));
    for (const g of [leib, lauf, hals, kopf, rumpf, haupt, lanze]) g.dispose();
  } else if (rolle === 'ranged') {
    // Schmal, ohne Schild, den Bogen quer über dem Rücken.
    const rumpf = new THREE.CylinderGeometry(0.11, 0.14, h * 0.74, 5);
    const haupt = new THREE.SphereGeometry(0.1, 6, 5);
    const bogen = new THREE.TorusGeometry(0.16, 0.022, 4, 10, Math.PI * 1.15);
    const koecher = new THREE.CylinderGeometry(0.05, 0.05, 0.24, 5);
    teile.push(shapePart(rumpf, 0, h * 0.37, 0));
    teile.push(shapePart(haupt, 0, h * 0.86, 0));
    teile.push(shapePart(bogen, -0.1, h * 0.52, 0.02, 0, Math.PI / 2, 0.5));
    teile.push(shapePart(koecher, -0.12, h * 0.62, -0.1, 0.4, 0, 0.35));
    for (const g of [rumpf, haupt, bogen, koecher]) g.dispose();
  } else {
    // Fußvolk: breiter Rumpf, Schild an der linken Seite, Speer aufgesetzt.
    const rumpf = new THREE.CylinderGeometry(0.17, 0.21, h * 0.74, 5);
    const haupt = new THREE.SphereGeometry(0.12, 6, 5);
    const schild = new THREE.BoxGeometry(0.05, h * 0.5, 0.22);
    const speer = new THREE.CylinderGeometry(0.02, 0.02, h * 1.6, 4);
    teile.push(shapePart(rumpf, 0, h * 0.37, 0));
    teile.push(shapePart(haupt, 0, h * 0.86, 0));
    teile.push(shapePart(schild, 0.16, h * 0.44, 0.1, 0, 0, 0.08));
    teile.push(shapePart(speer, -0.1, h * 0.78, -0.1, 0, 0, -0.12));
    for (const g of [rumpf, haupt, schild, speer]) g.dispose();
  }
  return mergeShapes(teile);
}

const COLUMN_ROLES = ['cavalry', 'infantry', 'ranged'];
let marcherGeometries = null;

function marcherShapes() {
  if (!marcherGeometries) {
    marcherGeometries = {};
    // Einmal gebaut, von jeder Kolonne und jeder Wache im Spiel benutzt: sie
    // gehören dem Modul, nicht dem Heer, das sie gerade trägt.
    for (const rolle of COLUMN_ROLES) marcherGeometries[rolle] = geteilt(marcherGeometry(rolle));
  }
  return marcherGeometries;
}

function buildColumn(color) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const formen = marcherShapes();
  const marschierer = [];
  for (let i = 0; i < COLUMN_MAX; i++) {
    const mann = new THREE.Group();
    const teile = {};
    for (const rolle of COLUMN_ROLES) {
      const stueck = new THREE.Mesh(formen[rolle], material);
      stueck.visible = false;
      mann.add(stueck);
      teile[rolle] = stueck;
    }
    // Zwei Reihen nebeneinander, Glied für Glied nach hinten versetzt.
    const glied = Math.floor(i / 2);
    const reihe = i % 2 ? 0.36 : -0.36;
    mann.position.set(reihe, 0, -0.6 - glied * 0.66);
    mann.userData = { phase: i * 0.7, teile, rolle: null };
    group.add(mann);
    marschierer.push(mann);
  }
  group.userData = { marschierer, material };
  return group;
}

// Wer in welcher Reihenfolge marschiert. Eine Marschordnung ist keine
// Zufallsmischung: die Reiterei zieht voraus und deckt die Spitze, dahinter
// geht das Fußvolk, und die Schützen gehen als Letzte - so stand es in jedem
// Handbuch, und so liest man auf der Karte auch ab, woraus ein Heer besteht.
function columnRoles(units, zahl) {
  const gesamt = COLUMN_ROLES.reduce((sum, r) => sum + (units[r] || 0), 0);
  if (!gesamt) return new Array(zahl).fill('infantry');
  // Jede Gattung, die es überhaupt gibt, bekommt mindestens einen Platz -
  // sonst verschwänden dreißig Reiter neben achthundert Mann Fußvolk, und
  // gerade das will man sehen.
  const plaetze = {};
  let vergeben = 0;
  for (const rolle of COLUMN_ROLES) {
    if (!units[rolle]) { plaetze[rolle] = 0; continue; }
    plaetze[rolle] = Math.max(1, Math.round((units[rolle] / gesamt) * zahl));
    vergeben += plaetze[rolle];
  }
  // Aufgerundet wird immer zu viel; abgezogen wird bei der größten Gattung.
  while (vergeben > zahl) {
    const groesste = COLUMN_ROLES.reduce((a, b) => (plaetze[b] > plaetze[a] ? b : a));
    if (plaetze[groesste] <= 1) break;
    plaetze[groesste] -= 1;
    vergeben -= 1;
  }
  const raus = [];
  for (const rolle of COLUMN_ROLES) {
    for (let i = 0; i < plaetze[rolle]; i++) raus.push(rolle);
  }
  while (raus.length < zahl) raus.push('infantry');
  return raus.slice(0, zahl);
}

// Wie viele Gestalten die Kolonne zeigt - sie wächst mit der Stärke, wie das
// Lager, aber sie zählt keine Mann: sie sagt "klein" oder "groß".
function columnLength(strength) {
  return Math.max(4, Math.min(COLUMN_MAX, Math.round(strength / 90) + 3));
}

// --- Die Wache im Lager -----------------------------------------------------
// Ein Zeltlager allein sagt nicht, dass dort ein Heer liegt - nur, dass dort
// jemand campiert. Zwei Gestalten vor den Zelten machen daraus, was es ist:
// dieselben Gattungen und Geometrien wie in der Kolonne, nur ruhig stehend
// statt im Marsch. Immer zwei, gleich groß oder klein das Heer dahinter ist -
// eine Wache zählt nicht mit, sie zeigt nur, dass dort eine ist.
const GARRISON_MAX = 2;
const GARRISON_RADIUS = 1.9;

function buildGarrison(color) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const formen = marcherShapes();
  const wachen = [];
  for (let i = 0; i < GARRISON_MAX; i++) {
    const mann = new THREE.Group();
    const teile = {};
    for (const rolle of COLUMN_ROLES) {
      const stueck = new THREE.Mesh(formen[rolle], material);
      stueck.visible = false;
      mann.add(stueck);
      teile[rolle] = stueck;
    }
    // Im Kreis um die Zelte verteilt, mit dem Blick nach außen - eine Wache,
    // kein Umzug.
    const winkel = (i / GARRISON_MAX) * Math.PI * 2 + 0.35;
    mann.position.set(Math.cos(winkel) * GARRISON_RADIUS, 0, Math.sin(winkel) * GARRISON_RADIUS);
    mann.rotation.y = winkel;
    mann.userData = { teile, rolle: null };
    group.add(mann);
    wachen.push(mann);
  }
  group.userData = { wachen, material };
  return group;
}

// --- Die Belagerung auf der Karte -----------------------------------------
// Ein eingeschlossener Ort sieht anders aus als einer, an dem ein Heer nur
// vorbeizieht: um ihn herum stehen Sturmpfähle und die Zelte des Belagerers.
// Der Ring bekommt die Farbe dessen, der davorliegt - man soll auf einen Blick
// sehen, wessen Belagerung das ist.
const SIEGE_STAKES = 22;
const SIEGE_TENTS = 6;

function buildSiegeWorks(scale, color) {
  const group = new THREE.Group();
  const radius = 3.4;
  const holz = new THREE.MeshStandardMaterial({ color: '#4a3a2a', roughness: 1 });
  const stakeGeometry = new THREE.CylinderGeometry(0.07, 0.11, 1.05, 4);
  for (let i = 0; i < SIEGE_STAKES; i++) {
    const winkel = (i / SIEGE_STAKES) * Math.PI * 2;
    const pfahl = new THREE.Mesh(stakeGeometry, holz);
    pfahl.position.set(Math.cos(winkel) * radius, 0.5, Math.sin(winkel) * radius);
    pfahl.rotation.z = (i % 2 ? 1 : -1) * 0.16;
    group.add(pfahl);
  }
  // Die Zelte der Belagerer: nur ein paar, und in der Farbe des Reichs.
  const tuch = new THREE.MeshStandardMaterial({ color });
  const zeltGeometry = new THREE.ConeGeometry(0.42, 0.86, 6);
  for (let i = 0; i < SIEGE_TENTS; i++) {
    const winkel = (i / SIEGE_TENTS) * Math.PI * 2 + 0.5;
    const zelt = new THREE.Mesh(zeltGeometry, tuch);
    zelt.position.set(Math.cos(winkel) * (radius + 0.9), 0.43, Math.sin(winkel) * (radius + 0.9));
    group.add(zelt);
  }
  group.userData = { tuch };
  group.scale.setScalar(scale);
  return group;
}

function syncArmyGroup(state, army, entry) {
  const { group } = entry;
  const faction = factionById(state, army.factionId);
  // Wo dieses Modell steht - für den Klick. Ein marschierendes Heer trägt das
  // Feld, auf das es zieht; wer es unterwegs anklickt, meint es und nicht den
  // Boden darunter.
  group.userData.tile = { col: army.col, row: army.row };
  if (!armyAnimations.has(army.id)) {
    group.position.set(worldX(army.col), surfaceY(army.col, army.row), worldZ(army.row));
  }

  // Auf See schlägt das Lager die Zelte ab und geht an Bord. Womit, hängt
  // davon ab, wer da fährt: ein Geschwader fährt seine eigenen Kriegsschiffe,
  // ein Landheer wird auf gecharterten Transportern übergesetzt.
  const afloat = !!army.embarked;
  const kind = isFleet(army) ? (army.shipKind || shipTypeOf(army.factionId).key) : 'transport';
  let ship = group.userData.ship;
  if (afloat && (!ship || ship.userData.kind !== kind)) {
    if (ship) group.remove(ship);
    ship = kind === 'transport' ? buildConvoy(faction.color) : buildShip(faction.color, kind);
    group.add(ship);
    group.userData.ship = ship;
  }
  if (ship) {
    ship.visible = afloat;
    for (const sail of ship.userData.sails) sail.material.color.set(faction.color);
  }
  // Das Lager: es steht um die Zelte, solange das Heer darin liegt.
  const camped = !!army.camp && !afloat;
  if (camped && !group.userData.camp) {
    group.userData.camp = buildCampRing();
    group.add(group.userData.camp);
  }
  if (group.userData.camp) group.userData.camp.visible = camped;

  // Und der Hinterhalt: das Gebüsch, hinter dem das Heer liegt. Es steht nur
  // bei den eigenen Heeren - fremde Lauernde sind gar nicht erst auf der Karte.
  const lauert = !!army.ambush && !afloat;
  if (lauert && !group.userData.ambush) {
    group.userData.ambush = buildAmbushCover();
    group.add(group.userData.ambush);
  }
  if (group.userData.ambush) group.userData.ambush.visible = lauert;

  // Marschiert das Heer gerade, tritt die Kolonne an die Stelle der Zelte.
  const marschiert = armyAnimations.has(army.id) && !afloat;
  if (marschiert && !group.userData.column) {
    group.userData.column = buildColumn(faction.color);
    group.add(group.userData.column);
  }
  if (group.userData.column) {
    const column = group.userData.column;
    column.visible = marschiert;
    column.userData.material.color.set(faction.color);
    const zahl = columnLength(unitTotalCount(army.units));
    // Welche Gattung an welchem Platz marschiert - Reiterei voran, dann das
    // Fußvolk, die Schützen zuletzt.
    const rollen = columnRoles(army.units || {}, zahl);
    column.userData.marschierer.forEach((mann, i) => {
      mann.visible = i < zahl;
      if (i >= zahl) return;
      const rolle = rollen[i] || 'infantry';
      if (mann.userData.rolle === rolle) return;
      mann.userData.rolle = rolle;
      for (const key of COLUMN_ROLES) mann.userData.teile[key].visible = key === rolle;
    });
  }

  group.userData.tents.visible = !afloat && !marschiert && !group.userData.hiddenForBattle;
  if (group.userData.pole) group.userData.pole.visible = !afloat;
  group.userData.flag.visible = !afloat;

  const strength = unitTotalCount(army.units);
  const tierCount = tierForCount(strength);
  const scale = armyScale(strength);
  const tents = group.userData.tents;
  while (tents.children.length < tierCount) {
    const idx = tents.children.length;
    // Das erste Zelt ist das Führungszelt in der Mitte, die übrigen stehen im
    // Ring darum - und je mehr es werden, desto weiter wird der Ring.
    const big = idx === 0;
    const tent = new THREE.Mesh(
      // Ein Zelt ist niedriger als ein Haus - vorher überragte es jedes Dach.
      new THREE.ConeGeometry(big ? 0.42 : 0.3,
        big ? CAMP_TENT_HEIGHT : CAMP_TENT_HEIGHT * 0.7, 6),
      new THREE.MeshStandardMaterial({ color: faction.color })
    );
    const angle = ((idx - 1) / 7) * Math.PI * 2 + 0.4;
    // 0,72 wäre genau die Summe beider Kegelradien (0,42 + 0,3) - die Zelte
    // berührten sich dann exakt an der Grundfläche, und die groben, nur
    // sechseckig facettierten Kegel trafen sich dort nie ganz sauber: ein
    // Spalt blieb offen, durch den man ins dunkle Nichts hinter dem Tuch sah,
    // als würde das Zelt dort innen verschwinden. Ein echter Abstand schließt
    // den Spalt.
    const radius = idx > 4 ? 1.2 : 0.88;
    tent.position.set(
      big ? 0 : Math.cos(angle) * radius,
      big ? CAMP_TENT_HEIGHT / 2 : (CAMP_TENT_HEIGHT * 0.7) / 2,
      big ? 0 : Math.sin(angle) * radius
    );
    tents.add(tent);
  }
  while (tents.children.length > tierCount) {
    tents.remove(tents.children[tents.children.length - 1]);
  }
  tents.children.forEach((tent) => { tent.material.color.set(faction.color); });
  group.userData.banner.material.color.set(faction.color);

  // Die Wache um die Zelte: sichtbar, solange die Zelte es sind, und in
  // derselben Zusammensetzung wie eine Kolonne - nur ruhig stehend.
  const bewacht = tents.visible;
  if (bewacht && !group.userData.garrison) {
    group.userData.garrison = buildGarrison(faction.color);
    group.add(group.userData.garrison);
  }
  if (group.userData.garrison) {
    const garrison = group.userData.garrison;
    garrison.visible = bewacht;
    garrison.userData.material.color.set(faction.color);
    const rollenWache = columnRoles(army.units || {}, GARRISON_MAX);
    garrison.userData.wachen.forEach((mann, i) => {
      const rolle = rollenWache[i] || 'infantry';
      if (mann.userData.rolle === rolle) return;
      mann.userData.rolle = rolle;
      for (const key of COLUMN_ROLES) mann.userData.teile[key].visible = key === rolle;
    });
  }

  // Das ganze Lager - Zelte, Stange, Banner, Schiff - wächst mit der Stärke.
  tents.scale.setScalar(scale);
  // Dieselbe Vergrößerung wie bei der Kolonne, aus demselben Grund: an einem
  // Zelt ist nichts zu erkennen, an einer Gestalt schon - Schild, Bogen oder
  // Pferd. Ohne sie verschwand die Wache bisher im Zeltring, kaum von den
  // Zelten selbst zu unterscheiden.
  if (group.userData.garrison) group.userData.garrison.scale.setScalar(scale * 1.45);
  // Die Kolonne bekommt noch etwas mehr: sie hat keine Zelte, in denen sie
  // untergehen könnte, dafür aber die ganze Karte als Hintergrund - und ein
  // Heer, das gerade über offenes Land zieht, soll man auch aus der
  // strategischen Kameraposition als das erkennen, was es ist.
  if (group.userData.column) group.userData.column.scale.setScalar(scale * 1.6);
  if (group.userData.camp) group.userData.camp.scale.setScalar(scale);
  if (ship) ship.scale.setScalar(0.8 + (scale - 0.68) * 0.55);
  if (group.userData.pole) {
    group.userData.pole.scale.set(1, scale, 1);
    group.userData.pole.position.y = 1.6 * scale;
  }
  group.userData.flag.scale.setScalar(scale);
  group.userData.flag.position.set(0, 2.6 * scale, 0);
  group.userData.ring.scale.setScalar(Math.max(1, scale));

  if (group.userData.label) group.remove(group.userData.label);
  // Strength, and the stars it has earned - both belong on the counter itself.
  const stars = experienceStars(army.experience);
  // Steht dieses Heer im Krieg mit dir, sagt es das Schild auch: zwei gekreuzte
  // Klingen vor der Zahl, und dazu der rote Ring am Boden.
  const feind = army.factionId !== playerFaction(state).id
    && atWar(state, playerFaction(state).id, army.factionId);
  const caption = `${feind ? '⚔ ' : ''}${unitTotalCount(army.units)}`
    + (stars ? ` ${'★'.repeat(stars)}` : '');
  const label = makeLabelSprite(caption, {
    fontSize: 40, scale: 0.85, color: feind ? '#ffb4a8' : stars ? '#ffe9a8' : '#ffffff',
  });
  label.position.y = (afloat ? 4.0 : 3.4) * scale + 0.5;
  group.add(label);
  group.userData.label = label;

  group.userData.ring.material.opacity = army.id === state.selectedArmyId ? 0.9 : 0;
  if (group.userData.feindRing) {
    group.userData.feindRing.material.opacity = feind ? 0.55 : 0;
    group.userData.feindRing.scale.setScalar(Math.max(1, scale));
  }
}

function clearHighlights() {
  // Die Felder einer Auswahl werden bei jedem Klick neu gebaut. Würden sie nur
  // aus der Szene genommen, bliebe von jeder Auswahl ein Satz Puffer auf der
  // Grafikkarte liegen - über einen Feldzug hinweg Tausende.
  for (const mesh of highlightMeshes) disposeGroup(mesh);
  highlightMeshes.length = 0;
}

function addHighlight(col, row, color) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(TILE_SIZE * 0.9, TILE_SIZE * 0.9),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(worldX(col), surfaceY(col, row) + 0.15, worldZ(row));
  scene.add(mesh);
  highlightMeshes.push(mesh);
}

// Called after every game-state change: syncs city ownership visuals, army
// groups (creating/removing as armies are raised or destroyed), and the
// green/red movement-range overlay for the currently selected army.
// --- Seewege ---------------------------------------------------------------
// Ein Handelsweg über See war bisher eine Zeile in der Stadtansicht und sonst
// nichts. Jetzt liegt er auf dem Wasser: eine Kette kleiner Bojen entlang des
// Kurses, den die Händler wirklich fahren, und in der Mitte ein Schiffszug,
// der ihn abfährt. Gezeichnet werden die eigenen Wege - fremde Ladung geht
// niemanden etwas an.
let laneGroup = null;
let laneSignature = '';

function buildTradeLanes(state) {
  disposeGroup(laneGroup);
  laneGroup = null;
  laneGroup = new THREE.Group();
  laneGroup.name = 'Handelswege';
  scene.add(laneGroup);
  const me = playerFaction(state).id;
  const bojenGeometrie = new THREE.SphereGeometry(0.34, 8, 6);
  const bojenMaterial = new THREE.MeshStandardMaterial({
    color: '#e8d9a8', roughness: 0.6, emissive: '#6b5c2a', emissiveIntensity: 0.35,
  });
  for (const route of state.tradeRoutes || []) {
    if (route.kind !== 'sea') continue;
    const a = state.cities.find((c) => c.id === route.aId);
    const b = state.cities.find((c) => c.id === route.bId);
    if (!a || !b) continue;
    if (a.factionId !== me && b.factionId !== me) continue;
    const lane = seaLane(state, a, b);
    if (!lane || lane.length < 2) continue;
    for (let i = 1; i < lane.length - 1; i += 2) {
      const buoy = new THREE.Mesh(bojenGeometrie, bojenMaterial);
      buoy.position.set(worldX(lane[i].col), SEA_LEVEL_Y + 0.2, worldZ(lane[i].row));
      laneGroup.add(buoy);
    }
    // Der Händler selbst, auf halbem Weg und in Fahrtrichtung.
    const mitte = lane[Math.floor(lane.length / 2)];
    const davor = lane[Math.max(0, Math.floor(lane.length / 2) - 1)];
    const convoy = buildConvoy('#d8c9a0');
    convoy.scale.setScalar(0.5);
    convoy.position.set(worldX(mitte.col), SEA_LEVEL_Y, worldZ(mitte.row));
    convoy.rotation.y = Math.atan2(mitte.col - davor.col, -(mitte.row - davor.row));
    laneGroup.add(convoy);
  }
}

// Was sich geändert haben muss, damit neu gezeichnet wird: welche Seewege es
// gibt und wem ihre Enden gehören.
function laneKey(state) {
  return (state.tradeRoutes || [])
    .filter((r) => r.kind === 'sea')
    .map((r) => `${r.id}:${(state.cities.find((c) => c.id === r.aId) || {}).factionId}`)
    .join('|');
}

export function syncEntities(state) {
  // Straßen kommen im Lauf des Feldzugs dazu; die Bauwerke im Umland richten
  // sich nach dem Stand von jetzt, nicht nach dem beim Kartenaufbau.
  currentRoads = state.roads || {};
  const lanes = laneKey(state);
  if (lanes !== laneSignature) {
    laneSignature = lanes;
    buildTradeLanes(state);
  }
  for (const city of state.cities) {
    let entry = cityGroups.get(city.id);
    // Ein Ort, der in den nächsten Rang hineingewachsen ist, wird neu gebaut:
    // aus vier Hütten werden Häuser um eine Halle, und der Mauerring wächst
    // mit. Alles, was daran hing - Steg, Acker, Viadukt, Stollen -, entsteht
    // im selben Durchlauf wieder aus den Merkmalen des Orts.
    if (entry && entry.size !== city.size) {
      disposeCityEntry(entry);
      cityGroups.delete(city.id);
      entry = null;
    }
    if (!entry) {
      entry = buildCityGroup(city);
      const r = entry.grundRadius;
      const boden = [[-r, -r], [r, -r], [-r, r], [r, r], [-r, 0], [r, 0], [0, -r], [0, r]]
        .map(([dx, dz]) => bandY(worldX(city.col) + dx, worldZ(city.row) + dz));
      // Der Ort steht auf der Höhe seiner eigenen Feldmitte, nicht höher - ein
      // Versuch, ihn bis über den höchsten Punkt in seinem Umkreis anzuheben,
      // ließ ihn wie auf einem eigenen Hügel stehen, sobald (wie am Kapitol)
      // ein einzelner Nachbarpunkt deutlich höher lag als der Ort selbst.
      const cityY = surfaceY(city.col, city.row);
      entry.group.position.set(worldX(city.col), cityY, worldZ(city.row));
      // Auf welchem Feld dieses Modell steht: `pickTile` braucht es, um einen
      // Klick auf Mauer oder Dach dem richtigen Feld zuzuordnen.
      entry.group.userData.tile = { col: city.col, row: city.row };
      // Wie tief die Terrasse reicht: bis unter die tiefste Stelle des Bodens,
      // den sie überdeckt. Am Hang ist das mehr als einen Meter, in der Ebene
      // fast nichts - und sichtbar ist ohnehin nur, was aus dem Boden ragt.
      let tief = 0.5;
      for (const b of boden) tief = Math.max(tief, cityY - b + 0.3);
      entry.fundament.scale.y = tief;
      entry.fundament.position.y = -tief / 2;
      scene.add(entry.group);
      cityGroups.set(city.id, entry);
    }
    const faction = factionById(state, city.factionId);
    // Roofs, pediments and banners all carry the owner's colour; the walls and
    // the stonework stay stone.
    for (const part of entry.tinted) part.material.color.set(faction.color);

    // Der Steg entsteht erst mit dem Hafen - die meisten Orte haben keinen.
    if (city.harbour && !entry.harbour) {
      const sea = harbourTile(state, city);
      if (sea) {
        // Ein Steg ist ein Steg - in jedem Ort derselbe.
        entry.harbour = buildHarbour(entry.bau);
        placeHarbour(entry.harbour, city, sea, surfaceY(city.col, city.row));
        entry.group.add(entry.harbour);
      }
    }
    if (entry.harbour) entry.harbour.visible = !!city.harbour;

    // Die Werft ist ein Teil des Hafens und wird mit ihm gezeigt.
    if (entry.harbour && entry.harbour.userData.werft) {
      entry.harbour.userData.werft.visible = !!city.shipyard;
    }

    // Die Belagerung: Pfähle und Zelte um den Ort, solange sie läuft.
    const belagert = !!city.siege;
    if (belagert && !entry.siege) {
      entry.siege = buildSiegeWorks(entry.scale, '#888888');
      entry.group.add(entry.siege);
    }
    if (entry.siege) {
      entry.siege.visible = belagert;
      if (belagert) {
        const feind = factionById(state, city.siege.by);
        entry.siege.userData.tuch.color.set(feind ? feind.color : '#888888');
      }
    }

    // Welche Nachbarfelder schon vergeben sind. Vorher führte jedes Bauwerk
    // seine eigene Liste, und sie waren nicht vollständig: das Viadukt kannte
    // die Kaserne nicht, der Stollen das Forum nicht - und zwei Werke standen
    // ineinander. Jetzt gibt es einen Merkzettel für alle.
    entry.belegt = entry.belegt || [];
    const freiesFeld = (prefer) => {
      const spot = neighbourSpot(city, prefer, entry.belegt);
      if (spot.dir) entry.belegt.push(spot.dir);
      return spot;
    };

    // Die Äcker entstehen mit der Farm - und verschwinden wieder, wenn eine
    // Eroberung sie niederbrennt.
    if (city.farm && !entry.farm) {
      entry.farm = buildFarm(entry.bau * 1.55);
      // Äcker liegen im flachsten Gelände, nicht am Hang - und nicht im
      // Wasser: das flachste Nachbarfeld einer Hafenstadt wäre das Meer.
      const flach = freiesFeld('low');
      // Und sie liegen gerade im Raster: ein Acker ist ein Viereck, und ein
      // schräg liegendes Viereck sieht aus, als hätte es jemand fallen lassen.
      placeAt(entry.farm, city, surfaceY(city.col, city.row), flach, 1.05,
        { gerade: true });
      entry.group.add(entry.farm);
    }
    if (entry.farm) entry.farm.visible = !!city.farm;

    // Der Kornspeicher gehört zum Acker und wird mit ihm gezeigt.
    if (entry.farm && entry.farm.userData.speicher) {
      entry.farm.userData.speicher.visible = !!city.granary;
    }

    // Das Viadukt läuft vom höchsten Nachbarfeld auf die Stadt zu - dort liegt
    // die Quelle, und dorthin gehören die Bögen.
    if (city.viaduct && !entry.viaduct) {
      entry.viaduct = buildViaduct(entry.bau * 1.25);
      // Auf dem Acker stehen die Bögen nicht: jedes Bauwerk bekommt sein
      // eigenes Feld, solange eines frei ist.
      const hoch = freiesFeld('high');
      placeAt(entry.viaduct, city, surfaceY(city.col, city.row), hoch, 1.0);
      entry.group.add(entry.viaduct);
    }
    if (entry.viaduct) entry.viaduct.visible = !!city.viaduct;

    // Das Fördergerüst entsteht mit dem Bergwerk und bleibt, solange es fördert.
    if (city.mine && !entry.mine) {
      // Etwas größer als die Häuser: ein Fördergerüst ist kein Schuppen, und
      // hinter der Palisade wäre es sonst nicht zu sehen.
      entry.mine = buildMine(entry.bau * 1.35);
      // Beide wollen die Höhe: steht das Viadukt schon auf dem höchsten
      // Nachbarfeld, nimmt der Schacht das zweithöchste.
      const hoch = freiesFeld('high');
      placeAt(entry.mine, city, surfaceY(city.col, city.row), hoch, 0.88);
      entry.group.add(entry.mine);
    }
    if (entry.mine) entry.mine.visible = !!city.mine;

    // Die Kaserne liegt vor dem Ort: ein Exerzierplatz gehört nicht zwischen
    // die Häuser.
    if (city.barracks && !entry.barracks) {
      entry.barracks = buildBarracks(entry.bau);
      const platz = freiesFeld('low');
      placeAt(entry.barracks, city, surfaceY(city.col, city.row), platz, 0.95,
        { gerade: true });
      entry.group.add(entry.barracks);
    }
    if (entry.barracks) entry.barracks.visible = !!city.barracks;

    // Das Forum steht auf dem eigenen Feld vor dem Ort - wie Acker, Stollen
    // und Kaserne. Am Mauerring selbst hatte es keinen Platz: dort fällt bei
    // einer Hafenstadt das Gelände schon zum Wasser ab, und der Marktplatz
    // stand knietief in der Brandung.
    if (city.forum && !entry.forum) {
      entry.forum = buildForum(entry.bau);
      const rand = freiesFeld('low');
      placeAt(entry.forum, city, surfaceY(city.col, city.row), rand, 0.92,
        { gerade: true });
      entry.group.add(entry.forum);
    }
    if (entry.forum) entry.forum.visible = !!city.forum;

    // Die Fischerei liegt am Wasser, nicht auf dem Acker: ein Strand mit
    // Netzen und einem Kahn. Sie sucht sich dasselbe Ufer wie der Hafen,
    // steht aber weiter oben und seitlich versetzt - Steg und Netzgestelle
    // teilen sich sonst denselben Meter Ufer.
    if (city.fishery && !entry.fishery) {
      const sea = harbourTile(state, city);
      entry.fishery = buildFishery(entry.bau * 1.05);
      if (sea) {
        placeShore(entry.fishery, city, sea, surfaceY(city.col, city.row),
          { rueck: 0.95, quer: TILE_SIZE * 0.42 });
      } else {
        placeAt(entry.fishery, city, surfaceY(city.col, city.row),
          freiesFeld('low'), 0.95, { gerade: true });
      }
      entry.group.add(entry.fishery);
    }
    if (entry.fishery) entry.fishery.visible = !!city.fishery;

    // Die Jagdhütte steht am Waldrand - auf dem Nachbarfeld, auf dem am
    // meisten Wald steht, sonst auf irgendeinem freien.
    if (city.hunt && !entry.hunt) {
      entry.hunt = buildHuntLodge(entry.bau * 1.05);
      const waldrand = waldSpot(city, entry.belegt);
      if (waldrand && waldrand.dir) entry.belegt.push(waldrand.dir);
      const platz = waldrand || freiesFeld('low');
      placeAt(entry.hunt, city, surfaceY(city.col, city.row), platz, 0.98,
        { gerade: true });
      entry.group.add(entry.hunt);
    }
    if (entry.hunt) entry.hunt.visible = !!city.hunt;

    // Only the stage that actually stands is built, and only when it is built.
    const level = city.wallLevel || 0;
    for (let index = 0; index < entry.walls.length; index++) {
      if (index + 1 === level && !entry.walls[index]) {
        entry.walls[index] = buildFortification(WALL_LEVELS[index].key, entry.scale,
          { round: city.size === 'village', dorf: city.size === 'village' });
        entry.group.add(entry.walls[index]);
      }
      if (entry.walls[index]) entry.walls[index].visible = index + 1 === level;
    }
  }

  const seenArmies = new Set();
  // Wer im Hinterhalt liegt, steht nicht auf der Karte - es sei denn, er
  // gehört einem selbst. Das ist die halbe Regel: der Überfall trifft nur,
  // weil man ihn nicht kommen sieht.
  const ich = playerFaction(state);
  for (const army of state.armies) {
    if (army.ambush && (!ich || army.factionId !== ich.id)) continue;
    seenArmies.add(army.id);
    let entry = armyGroups.get(army.id);
    if (!entry) {
      const group = buildArmyGroup();
      scene.add(group);
      entry = { group };
      armyGroups.set(army.id, entry);
    }
    syncArmyGroup(state, army, entry);
  }
  for (const [id, entry] of armyGroups) {
    // A destroyed army keeps its group until it has finished marching to the
    // battle; the animation's completion callback triggers the next sync.
    if (!seenArmies.has(id) && !armyAnimations.has(id)) {
      // Die Fahne der Armee war bei den mitgedrehten Tüchern angemeldet; sonst
      // wüchse die Liste mit jeder vernichteten Armee weiter.
      const flagIndex = billboards.indexOf(entry.group.userData.flag);
      if (flagIndex !== -1) billboards.splice(flagIndex, 1);
      disposeGroup(entry.group);
      armyGroups.delete(id);
    }
  }

  // Roads change rarely; the whole network is rebuilt only when one is
  // finished rather than on every state change.
  if (roadsGroup && (state.roadVersion || 0) !== roadVersionDrawn) {
    buildRoadNetwork(state);
    // Eine neue Straße kann eine neue Brücke bedeuten - die Flüsse werden
    // deshalb im selben Zug neu gezeichnet.
    buildRivers(state);
    // Und die Karren fahren auf den Straßen, die es jetzt gibt - eine neue
    // Straße ohne Verkehr wäre die einzige tote Straße der Karte.
    buildWildlife(state);
    roadVersionDrawn = state.roadVersion || 0;
  }

  if (mapMode === 'tactical') refreshTacticalColors(state);
  // Die Grenzen hängen an denselben Besitzverhältnissen wie die taktische
  // Sicht - fällt eine Stadt, verschiebt sich beides.
  if (bordersVisible) buildBorders(state);

  clearHighlights();
  if (state.reachable) {
    for (const [key, info] of state.reachable) {
      const [col, row] = key.split(',').map(Number);
      // A shore a fleet can land on is its own kind of move, and ground an
      // enemy army holds costs extra to enter - both deserve their own colour
      // so the player can read the cost before paying it.
      // Fremdes Land bekommt seine eigene Farbe: ein Schritt dorthin ist eine
      // Kriegserklärung, und das soll man sehen, bevor man klickt.
      // Ein Angriff auf ein Reich, mit dem man im Frieden steht, ist wie der
      // Schritt über seine Grenze eine Kriegserklärung - und trägt deshalb
      // dieselbe Farbe, nicht das Rot einer laufenden Fehde.
      const color = info.border || info.declare ? '#c07be0'
        : info.combat ? '#ff4d3d'
          : info.merge ? '#7ecbff'
            : info.landing ? '#ffd166'
              : info.contested ? '#ff8c42' : '#4dffa0';
      addHighlight(col, row, color);
    }
  }
}

// --- Taktische Sicht -----------------------------------------------------
// Who holds which ground: every passable tile takes the colour of the faction
// whose settlement is nearest by land. That is a sphere of influence rather
// than a border treaty, but it is the picture a commander plans from.
// Wem welches Feld gehört, rechnet territory.js - dieselbe Zahl, aus der auch
// die Grenzverletzung folgt. Die Karte färbt nur, was dort steht.
function claimable(tile) {
  return claimableTile(tile);
}

function computeTerritory(state) {
  return territoryMap(state).owner;
}

// --- Grenzen ---------------------------------------------------------------
// Dieselbe Einflussrechnung wie in der taktischen Sicht, aber als Linie auf
// der Geländekarte: überall dort, wo zwei Herrschaftsbereiche aneinander
// stoßen, liegt ein schmales Band in der Farbe dessen, dem das Feld gehört.
// Zwei halbe Bänder Rücken an Rücken - so hat jede Seite ihre eigene Farbe,
// und man sieht auf einen Blick, wessen Grenze man vor sich hat.
let bordersGroup = null;
let bordersVisible = false;
const BORDER_WIDTH = 0.13;
const BORDER_LIFT = 0.24;
const BORDER_PIECES = 4;

export function buildBorders(state) {
  disposeGroup(bordersGroup);
  bordersGroup = new THREE.Group();
  bordersGroup.name = 'Grenzen';
  bordersGroup.visible = bordersVisible;
  scene.add(bordersGroup);
  if (!state) return;

  const { cols, rows, tiles } = state.map;
  const owner = computeTerritory(state);
  // Je Fraktion ein eigener Satz Flächen, damit jede ihre Farbe behält.
  const byFaction = new Map();
  const half = TILE_SIZE / 2;
  const width = TILE_SIZE * BORDER_WIDTH;

  const grenzstueck = (index, col, row, dc, dr) => {
    const eigen = owner[index];
    if (!eigen) return;
    const c = col + dc;
    const r = row + dr;
    const drueben = c < 0 || c >= cols || r < 0 || r >= rows
      ? null : owner[r * cols + c];
    if (drueben === eigen) return;
    // Gegen das offene Meer und gegen den Fels zieht niemand eine Grenze.
    if (c >= 0 && c < cols && r >= 0 && r < rows) {
      // Gegen das offene Meer und gegen das Gebirge zieht niemand eine Grenze:
      // dort endet das Land, und eine Linie im Fels sagt nichts.
      if (!claimable(tiles[r][c])) return;
    } else {
      return;
    }
    const positions = byFaction.get(eigen) || byFaction.set(eigen, []).get(eigen);
    // Das Band liegt auf der eigenen Seite der Kante, nicht mittendrauf.
    const mx = worldX(col) + dc * (half - width);
    const mz = worldZ(row) + dr * (half - width);
    const alongX = dr !== 0;
    const from = alongX ? [mx - half, mz] : [mx, mz - half];
    const to = alongX ? [mx + half, mz] : [mx, mz + half];
    for (let piece = 0; piece < BORDER_PIECES; piece++) {
      const t0 = piece / BORDER_PIECES;
      const t1 = (piece + 1) / BORDER_PIECES;
      pushQuad(positions,
        from[0] + (to[0] - from[0]) * t0, from[1] + (to[1] - from[1]) * t0,
        from[0] + (to[0] - from[0]) * t1, from[1] + (to[1] - from[1]) * t1,
        width / 2, BORDER_LIFT);
    }
  };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      if (!owner[index]) continue;
      if (!claimable(tiles[row][col])) continue;
      grenzstueck(index, col, row, 1, 0);
      grenzstueck(index, col, row, -1, 0);
      grenzstueck(index, col, row, 0, 1);
      grenzstueck(index, col, row, 0, -1);
    }
  }

  for (const [factionId, positions] of byFaction) {
    if (!positions.length) continue;
    const faction = state.factions.find((f) => f.id === factionId);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: (faction && faction.color) || '#cccccc',
      roughness: 0.55, emissive: (faction && faction.color) || '#cccccc',
      emissiveIntensity: 0.35, side: THREE.DoubleSide,
    }));
    mesh.frustumCulled = false;
    bordersGroup.add(mesh);
  }
}

export function setBordersVisible(flag, state) {
  bordersVisible = !!flag;
  // Erst beim Einschalten gebaut: wer sie nie ansieht, zahlt auch nichts.
  if (bordersVisible && state && (!bordersGroup || !bordersGroup.children.length)) {
    buildBorders(state);
  }
  if (bordersGroup) bordersGroup.visible = bordersVisible;
  return bordersVisible;
}

export function areBordersVisible() {
  return bordersVisible;
}

const UNCLAIMED_COLOUR = new THREE.Color('#514d45');
const SEA_COLOUR = new THREE.Color('#243f5e');
const ROCK_COLOUR = new THREE.Color('#3e3c40');

function refreshTacticalColors(state) {
  if (!terrainMesh || !tacticalColors) return;
  const { cols, rows, tiles } = state.map;
  const owner = computeTerritory(state);
  const palette = new Map(state.factions.map((f) => [f.id, new THREE.Color(f.color)]));
  const colour = new THREE.Color();

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      const tile = tiles[row][col];
      if (tile.type === 'water') {
        colour.copy(SEA_COLOUR);
      } else if (!claimable(tile)) {
        colour.copy(ROCK_COLOUR);
      } else {
        colour.copy(palette.get(owner[index]) || UNCLAIMED_COLOUR);
        // A darker seam wherever two spheres of influence meet, so the
        // frontier is a line the eye follows rather than a colour change.
        const border = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => {
          const c = col + dc;
          const r = row + dr;
          if (c < 0 || c >= cols || r < 0 || r >= rows) return false;
          if (!claimable(tiles[r][c])) return false;
          return owner[r * cols + c] !== owner[index];
        });
        // Keep just enough relief shading that the mountains and coasts still
        // read through the political colour.
        colour.multiplyScalar((border ? 0.5 : 1) * (0.86 + Math.min(0.4, tile.elevation * 0.12)));
      }
      tacticalColors[index * 3] = colour.r;
      tacticalColors[index * 3 + 1] = colour.g;
      tacticalColors[index * 3 + 2] = colour.b;
    }
  }
  if (mapMode === 'tactical') applyTerrainColors(tacticalColors);
}

function applyTerrainColors(source) {
  const attribute = terrainMesh.geometry.getAttribute('color');
  attribute.array.set(source);
  attribute.needsUpdate = true;
}

export function getMapMode() {
  return mapMode;
}

// Switches the whole map between the ground and the political picture: the
// props that make terrain readable only clutter the tactical view, and flat
// light keeps the faction colours honest. Die Straßen bleiben, weil sie zum
// politischen Bild gehören - sie sagen, wie schnell wo ein Heer steht.
export function setMapMode(mode, state) {
  mapMode = mode === 'tactical' ? 'tactical' : 'terrain';
  const tactical = mapMode === 'tactical';
  if (propsGroup) propsGroup.visible = !tactical;
  zeigeWildlife();
  if (wildlifeAlive()) startAnimationLoop();
  // Straßen bleiben auch in der taktischen Sicht stehen: wer Grenzen liest,
  // will wissen, wo die Heere schnell hinkommen.
  if (roadsGroup) roadsGroup.visible = true;
  if (riversGroup) riversGroup.visible = !tactical;
  // Daylight adds up to about 1.7 and washes a flat colour out to near white.
  // The tactical view trades most of the sun for even light, keeping just
  // enough of it that the relief still shows.
  if (ambientLight) {
    ambientLight.intensity = tactical ? 0.78 : (weatherLook && weatherLook.ambient) || 0.65;
  }
  if (sunLight) {
    sunLight.intensity = tactical ? 0.32 : (weatherLook && weatherLook.sun) || 1.05;
  }
  if (terrainMesh) {
    terrainMesh.material.map = tactical ? null : noiseTexture;
    terrainMesh.material.needsUpdate = true;
    if (tactical && state) refreshTacticalColors(state);
    else if (terrainColors) applyTerrainColors(terrainColors);
  }
  // In the tactical view the sea is context, not subject: it steps back so
  // the faction colours are what the eye lands on.
  if (waterMesh) {
    waterMesh.material.opacity = tactical ? 0.95 : 0.82;
    waterMesh.material.color.set(tactical ? '#33506e' : TILE_TYPES.water.color);
  }
  if (deepSeaMesh) deepSeaMesh.material.color.set(tactical ? '#2b435c' : '#1d3f66');
  // In der taktischen Ansicht tritt auch das Papier zurück.
  // In der taktischen Ansicht tritt auch das Papier zurück. Alle vier
  // Streifen teilen sich ein Material - einer genügt.
  if (paperMesh && paperMesh.children.length) {
    paperMesh.children[0].material.color.set(tactical ? '#8d8570' : PAPER_COLOR);
  }
  return mapMode;
}

// --- Wetter --------------------------------------------------------------
// Über der ganzen Karte gleichzeitig Regen und Schnee zu zeichnen wäre weder
// machbar noch lesbar. Gezeigt wird deshalb das Wetter dort, wo die Kamera
// hinsieht - fährt man im Winter nach Norden, fängt es an zu schneien.

const WEATHER_LOOKS = {
  rain: {
    count: 2400, colour: '#bcd8f0', size: 0.5, fall: 78, drift: 10, streak: 3.4,
    sky: '#7d8b98', fog: 0.62, ambient: 0.5, sun: 0.55,
  },
  storm: {
    count: 3200, colour: '#d2e4f2', size: 0.55, fall: 96, drift: 30, streak: 4.6,
    sky: '#5c6873', fog: 0.5, ambient: 0.42, sun: 0.38, lightning: true,
  },
  snow: {
    count: 1900, colour: '#ffffff', size: 1.15, fall: 13, drift: 7, streak: 0,
    sky: '#c3ccd4', fog: 0.7, ambient: 0.82, sun: 0.6,
  },
  sand: {
    count: 3400, colour: '#f4dfae', size: 1.45, fall: 5, drift: 74, streak: 0,
    sky: '#c9a86a', fog: 0.34, ambient: 0.7, sun: 0.5,
  },
  fog: {
    count: 0, sky: '#c8ccc9', fog: 0.3, ambient: 0.85, sun: 0.35,
  },
  clouds: {
    count: 0, sky: '#a9bccb', fog: 1.35, ambient: 0.6, sun: 0.72,
  },
  heat: {
    count: 900, colour: '#fff0cc', size: 1.5, fall: -6, drift: 11, streak: 0,
    sky: '#d9c48d', fog: 0.85, ambient: 0.78, sun: 1.2,
  },
};

const WEATHER_VOLUME = 240;
// Flach über der Tischplatte: das Wetter gehört zur Karte, und ein Vorhang von
// hundert Metern Höhe stünde bei tiefer Kamera quer vor den Zeltbahnen.
const WEATHER_HEIGHT = 34;
let weatherPoints = null;
let weatherLook = null;
let weatherEffect = null;
let weatherVelocity = null;
let weatherVisible = true;
let weatherLookup = null;
let lightningTimer = 0;
let onWeatherChange = null;

export function setWeatherVisualsEnabled(enabled) {
  weatherVisible = !!enabled;
  if (!weatherVisible) applyWeatherEffect(null);
  else if (weatherLookup) updateWeatherForCamera();
}

export function setWeatherReporter(callback) {
  onWeatherChange = callback;
}

function disposeWeatherPoints() {
  if (!weatherPoints) return;
  scene.remove(weatherPoints);
  weatherPoints.geometry.dispose();
  weatherPoints.material.dispose();
  weatherPoints = null;
  weatherVelocity = null;
}

// Die Kanten der Tischplatte als Schnittebenen. Sie werden bei jedem Aufbau
// neu gerechnet, weil sie von der Größe der Karte abhängen, und sie wirken im
// Weltkoordinatensystem - das Verschieben und Skalieren der Wetterwolke mit
// der Kamera stört sie also nicht.
function boardClipPlanes() {
  const halfW = (mapCols * TILE_SIZE) / 2;
  const halfD = (mapRows * TILE_SIZE) / 2;
  return [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), halfW),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), halfW),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), halfD),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), halfD),
    // und ein Deckel darüber, damit auch nach oben nichts hinausragt
    new THREE.Plane(new THREE.Vector3(0, -1, 0), WEATHER_HEIGHT + 4),
  ];
}

// Rain falls as streaks and snow as flakes, which needs two different objects:
// a point cannot be stretched, and a line segment cannot be round. Everything
// else about them - the volume, the wrapping, the per-mote speed - is shared.
function buildWeatherPoints(look) {
  disposeWeatherPoints();
  if (!look.count) return;
  const streaked = look.streak > 0;
  const perMote = streaked ? 2 : 1;
  const positions = new Float32Array(look.count * perMote * 3);
  weatherVelocity = new Float32Array(look.count);
  const rng = seededRandomFactory(613);

  for (let i = 0; i < look.count; i++) {
    const x = (rng() - 0.5) * WEATHER_VOLUME;
    const y = rng() * WEATHER_HEIGHT;
    const z = (rng() - 0.5) * WEATHER_VOLUME;
    const base = i * perMote * 3;
    positions[base] = x;
    positions[base + 1] = y;
    positions[base + 2] = z;
    if (streaked) {
      positions[base + 3] = x + look.drift * 0.02;
      positions[base + 4] = y - look.streak;
      positions[base + 5] = z;
    }
    // Each mote falls at its own pace, which is what stops the curtain from
    // reading as one sheet coming down.
    weatherVelocity[i] = 0.65 + rng() * 0.7;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const shared = {
    color: look.colour, transparent: true, opacity: 0.7, depthWrite: false,
    // Das Wetter gehört zur Karte, nicht zum Zelt: vier Ebenen an den Kanten
    // des Tisches schneiden alles weg, was daneben fiele.
    clippingPlanes: boardClipPlanes(),
  };
  weatherPoints = streaked
    ? new THREE.LineSegments(geometry, new THREE.LineBasicMaterial(shared))
    : new THREE.Points(geometry, new THREE.PointsMaterial({
      ...shared, size: look.size, sizeAttenuation: true,
    }));
  weatherPoints.frustumCulled = false;
  scene.add(weatherPoints);
}

function applyWeatherEffect(effect) {
  if (weatherEffect === effect) return;
  weatherEffect = effect;
  const look = (effect && WEATHER_LOOKS[effect]) || null;
  weatherLook = look;
  buildWeatherPoints(look || { count: 0 });

  // Clear weather is the scene's own daylight; anything else tints the sky,
  // draws the fog in and takes the edge off the sun.
  const skyColour = look && look.sky ? look.sky : SKY_COLOR;
  scene.background = new THREE.Color(skyColour);
  const fogScale = look && look.fog ? look.fog : 1;
  scene.fog = new THREE.Fog(skyColour, BASE_DISTANCE * 2.6 * fogScale, BASE_DISTANCE * 8 * fogScale);
  if (ambientLight) {
    ambientLight.intensity = mapMode === 'tactical' ? 0.78 : (look && look.ambient ? look.ambient : 0.65);
  }
  if (sunLight) {
    sunLight.intensity = mapMode === 'tactical' ? 0.32 : (look && look.sun ? look.sun : 1.05);
  }
  if (weatherPoints || look) startAnimationLoop();
}

function updateWeatherForCamera() {
  if (!weatherLookup) return;
  const col = Math.max(0, Math.min(mapCols - 1, Math.round(cam.col)));
  const row = Math.max(0, Math.min(mapRows - 1, Math.round(cam.row)));
  const weather = weatherLookup(col, row);
  if (onWeatherChange) onWeatherChange(weather, col, row);
  applyWeatherEffect(weatherVisible ? weather.effect : null);
}

// The scene asks the game what the weather is rather than being told, so
// panning the camera is enough to change what falls out of the sky.
export function setWeatherSource(lookup) {
  weatherLookup = lookup;
  // Ohne Quelle - etwa nach dem Beenden eines Feldzugs - fällt nichts mehr vom
  // Himmel, statt dass die Szene ins Leere greift.
  if (!lookup) applyWeatherEffect(null);
  updateWeatherForCamera();
}

function advanceWeatherPoints(dt) {
  if (!weatherPoints || !weatherLook) return false;
  const positions = weatherPoints.geometry.attributes.position;
  const array = positions.array;
  const streaked = weatherLook.streak > 0;
  const perMote = streaked ? 2 : 1;
  const half = WEATHER_VOLUME / 2;
  const rising = weatherLook.fall < 0;

  for (let i = 0; i < weatherVelocity.length; i++) {
    const speed = weatherVelocity[i];
    const dx = weatherLook.drift * speed * dt;
    const dy = -weatherLook.fall * speed * dt;
    const dz = weatherLook.drift * 0.35 * speed * dt;
    const base = i * perMote * 3;

    for (let v = 0; v < perMote; v++) {
      array[base + v * 3] += dx;
      array[base + v * 3 + 1] += dy;
      array[base + v * 3 + 2] += dz;
    }

    const y = array[base + 1];
    if (rising ? y > WEATHER_HEIGHT : y < 0) {
      // Back to the other end of the volume, at a fresh spot, so the curtain
      // never thins out where the wind has been carrying it.
      const nx = (Math.random() - 0.5) * WEATHER_VOLUME;
      const nz = (Math.random() - 0.5) * WEATHER_VOLUME;
      const ny = rising ? 0 : WEATHER_HEIGHT;
      for (let v = 0; v < perMote; v++) {
        array[base + v * 3] = nx + (v ? weatherLook.drift * 0.02 : 0);
        array[base + v * 3 + 1] = ny - (v ? weatherLook.streak : 0);
        array[base + v * 3 + 2] = nz;
      }
      continue;
    }

    const x = array[base];
    const z = array[base + 2];
    const wrapX = x > half ? -WEATHER_VOLUME : x < -half ? WEATHER_VOLUME : 0;
    const wrapZ = z > half ? -WEATHER_VOLUME : z < -half ? WEATHER_VOLUME : 0;
    if (wrapX || wrapZ) {
      for (let v = 0; v < perMote; v++) {
        array[base + v * 3] += wrapX;
        array[base + v * 3 + 2] += wrapZ;
      }
    }
  }
  positions.needsUpdate = true;

  // The curtain travels with the view and widens as the camera pulls back, so
  // it covers what is on screen at any zoom without simulating the whole map.
  const spread = Math.max(1, Math.min(2.8, (BASE_DISTANCE / cam.zoom) / 180));
  weatherPoints.position.set(worldX(cam.col), 0, worldZ(cam.row));
  weatherPoints.scale.set(spread, 1, spread);

  if (weatherLook.lightning && sunLight) {
    lightningTimer -= dt;
    if (lightningTimer <= 0) {
      lightningTimer = 3 + Math.random() * 7;
      sunLight.intensity = 2.6;
    } else {
      sunLight.intensity += (weatherLook.sun - sunLight.intensity) * Math.min(1, dt * 6);
    }
  }
  return true;
}

export function render() {
  if (renderer) renderer.render(scene, camera);
}

// Ein Bild der Karte, wie sie in diesem Augenblick steht. Der Zeichenpuffer
// ist außerhalb des Zeichenaufrufs leer - deshalb wird hier neu gezeichnet und
// unmittelbar danach gelesen. Gebraucht wird das von den Prüfläufen: ein
// Bildschirmfoto von außen erwischt bei einer bewegten Karte leicht ein
// früheres Bild.
export function captureFrame() {
  if (!renderer) return null;
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/png');
}

function waypointVector(tile) {
  return new THREE.Vector3(worldX(tile.col), surfaceY(tile.col, tile.row), worldZ(tile.row));
}

// Wendet eine Kolonne allmählich statt schlagartig dem neuen Kurs zu. Ein
// Weg über die Karte knickt an jedem Feld; würde die Gruppe an jedem Knick
// hart auf den neuen Winkel springen, drehte sich ein Heer auf der Stelle
// wie ein Zeiger - eine Kolonne schwenkt stattdessen, mit einer Wendegeschwindigkeit,
// die für jede Wegbiegung reicht, ohne bei einer Kehrtwende zu übertreiben.
const COLUMN_TURN_RATE = Math.PI * 2.4;

function faceHeading(anim, dx, dz, dt) {
  if (Math.abs(dx) < 1e-5 && Math.abs(dz) < 1e-5) return;
  const ziel = Math.atan2(dx, dz);
  if (anim.heading === null) {
    anim.heading = ziel;
  } else {
    let delta = ziel - anim.heading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const max = COLUMN_TURN_RATE * dt;
    anim.heading += Math.max(-max, Math.min(max, delta));
  }
  anim.group.rotation.y = anim.heading;
}

function setMarchBob(group, height, elapsed = 0) {
  const tents = group.userData.tents;
  if (tents) tents.position.y = height;
  // In der Kolonne wippt nicht der ganze Zug, sondern jeder für sich - eine
  // Reihe, die im Gleichschritt auf und ab federt, sieht aus wie ein Brett.
  const column = group.userData.column;
  if (!column || !column.visible) return;
  for (const mann of column.userData.marschierer) {
    if (!mann.visible) continue;
    mann.position.y = Math.abs(Math.sin(elapsed * 9 + mann.userData.phase)) * 0.12;
  }
}

// Wie weit vor dem Start und vor dem Ziel gebremst bzw. angefahren wird - als
// Anteil der Gesamtstrecke, aber nie mehr als eine knappe Feldlänge, sonst
// kröche ein Marsch über zehn Felder ewig lang an, ehe er Fahrt aufnimmt.
const MARCH_RAMP_SHARE = 0.4;
const MARCH_RAMP_MAX = TILE_SIZE * 0.8;
// Unter diesem Tempo bliebe ein Heer am Wegrand fast stehen - ein Mindestmaß
// an Fahrt bleibt immer, das Anfahren bremst, es hält nicht an.
const MARCH_RAMP_FLOOR = 0.25;

function advanceAnimations(dt) {
  for (const [armyId, anim] of armyAnimations) {
    anim.elapsed += dt;

    // Sanftes An- und Abfahren statt eines Tempos, das aus dem Stand
    // schlagartig einsetzt und ebenso schlagartig endet - eine Kolonne
    // beschleunigt und bremst aus, ein Zeiger auf Schienen nicht.
    let tempo = 1;
    const rampe = Math.min(anim.totalLength * MARCH_RAMP_SHARE, MARCH_RAMP_MAX);
    if (rampe > 1e-4) {
      const anfahrt = Math.min(1, anim.traveled / rampe);
      const bremsweg = Math.min(1, (anim.totalLength - anim.traveled) / rampe);
      tempo = MARCH_RAMP_FLOOR + (1 - MARCH_RAMP_FLOOR) * Math.min(anfahrt, bremsweg);
    }

    let budget = MARCH_TILES_PER_SECOND * marchSpeedFactor * TILE_SIZE * dt * tempo;

    while (budget > 1e-6 && anim.segment < anim.points.length - 1) {
      const length = anim.segLengths[anim.segment];
      if (length < 1e-4) {
        anim.segment++;
        anim.progress = 0;
        continue;
      }
      const rest = (1 - anim.progress) * length;
      if (budget >= rest) {
        budget -= rest;
        anim.traveled += rest;
        anim.segment++;
        anim.progress = 0;
      } else {
        anim.progress += budget / length;
        anim.traveled += budget;
        budget = 0;
      }
    }

    if (anim.segment >= anim.points.length - 1) {
      anim.group.position.copy(anim.points[anim.points.length - 1]);
      setMarchBob(anim.group, 0);
      // Der Marsch ist zu Ende: die Kolonne schlägt ihr Lager auf.
      if (anim.group.userData.column) anim.group.userData.column.visible = false;
      if (anim.group.userData.tents) anim.group.userData.tents.visible = true;
      completionQueue.push(anim.onComplete);
      armyAnimations.delete(armyId);
    } else {
      const from = anim.points[anim.segment];
      const to = anim.points[anim.segment + 1];
      anim.group.position.lerpVectors(from, to, anim.progress);
      faceHeading(anim, to.x - from.x, to.z - from.z, dt);
      // Der Schritt federt mit dem Tempo mit - im Anfahren und Ausbremsen
      // trippelt die Kolonne nicht mit vollem Schwung weiter.
      setMarchBob(anim.group, Math.abs(Math.sin(anim.elapsed * 11)) * 0.28 * (0.5 + 0.5 * tempo), anim.elapsed);
    }
  }
  return armyAnimations.size > 0;
}

function advanceEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const effect = effects[i];
    // Ein paar Effekte lassen sich beschleunigen (der Zusammenprall, wer
    // nicht warten will) - `speed` skaliert dann sowohl die verstrichene
    // Zeit als auch das, was `update` an eigener Physik daraus macht, sonst
    // sprängen Funken und Staub nur zum Ziel, statt schneller hinzufliegen.
    const speed = effect.speed || 1;
    const schritt = dt * speed;
    effect.elapsed += schritt;
    effect.update(effect.elapsed / effect.duration, schritt);
    if (effect.elapsed >= effect.duration) {
      effect.dispose();
      completionQueue.push(effect.onComplete);
      effects.splice(i, 1);
    }
  }
  return effects.length > 0;
}

function startAnimationLoop() {
  if (animationFrameId !== null) return;
  let last = performance.now();
  const step = (now) => {
    // Cap the step so a stalled tab cannot jump an animation to its end, but
    // keep the cap loose enough that a slow GPU plays it at roughly the right
    // speed instead of in slow motion.
    const dt = Math.min(0.12, (now - last) / 1000);
    last = now;
    advanceAnimations(dt);
    advanceEffects(dt);
    const raining = advanceWeatherPoints(dt);
    // Was sich bewegt, muss auch gezeichnet werden. Die Tiere bewegen sich
    // langsam: fünfzehn Bilder je Sekunde genügen für sie, und dazwischen wird
    // gar nicht gezeichnet - sonst liefe die Karte für einen Fischschwarm
    // dauerhaft mit voller Bildrate.
    const lebt = wildlifeAlive();
    let zeichnen = armyAnimations.size > 0 || effects.length > 0 || raining;
    if (lebt) {
      wildlifeAkku += dt;
      if (wildlifeAkku >= WILDLIFE_STEP) {
        advanceWildlife(wildlifeAkku);
        wildlifeAkku = 0;
        zeichnen = true;
      }
    }
    if (zeichnen) render();

    // Fertige Märsche und Effekte melden sich sofort - noch in dem Bild, in
    // dem sie zu Ende gehen. Früher wurde die Warteschlange erst geleert,
    // wenn die Schleife ganz anhielt; bei Regen oder Schnee treiben aber
    // dauernd Tropfen über die Karte, die Schleife hielt nie an, und so
    // liefen der Marschton weiter und der Schlachtbericht kam erst mit dem
    // nächsten Wetterumschwung.
    // Ein Rückruf darf dabei die nächste Stufe starten (der Marsch, der in
    // einen Zusammenstoß mündet): animationFrameId steht noch, sein
    // startAnimationLoop() fällt also durch, und die Schleife läuft unten
    // ohnehin weiter.
    for (const done of completionQueue.splice(0)) if (done) done();

    if (armyAnimations.size > 0 || effects.length > 0 || raining || lebt) {
      animationFrameId = requestAnimationFrame(step);
      return;
    }
    animationFrameId = null;
  };
  animationFrameId = requestAnimationFrame(step);
}

export function isAnimating() {
  return armyAnimations.size > 0 || effects.length > 0;
}

export function effectsDebug() {
  return { marching: armyAnimations.size, effects: effects.length };
}

// Seit die Schlacht nicht mehr in einem eigenen Fenster nachgestellt wird,
// ist dieser eine Augenblick auf der Karte alles, was der Spieler vom
// Zusammenprall selbst zu sehen bekommt - er trägt jetzt das ganze Gewicht
// des Ereignisses, nicht mehr nur den kurzen Anstoß zu einem Schaubild.
// Länger, größer, mit einem zweiten, nachhallenden Stoß und Staub, der über
// dem Feld hängen bleibt, statt gleich mit den Funken zu verschwinden. Erst
// bei dieser Länge bleibt Zeit, überhaupt hinzusehen, ehe der Bericht kommt.
const CLASH_DURATION = 3.2;

// Wie viele Gestalten eine Schlachtreihe zeigt - dieselbe Rechnung wie bei
// der Kolonne, nur eine eigene Reihe: die Schlacht ist jetzt das, was der
// Spieler von einem Heer zu sehen bekommt, nicht mehr nur sein Zeltlager.
function battleLineCount(units) {
  const gesamt = COLUMN_ROLES.reduce((sum, r) => sum + ((units && units[r]) || 0), 0);
  return Math.max(6, Math.min(16, Math.round(gesamt / 45) + 5));
}

// Eine Schlachtreihe: dieselben Gattungsformen wie Kolonne und Wache, hier zu
// einer breiten Front aufgestellt statt zu einer Marschordnung oder einem
// Wachkreis. Blickt lokal nach +X - wer sie aufstellt, dreht die ganze Gruppe
// dorthin, wo der Gegner steht.
function buildBattleLine(units, color) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.8, transparent: true });
  const formen = marcherShapes();
  const count = battleLineCount(units);
  const roles = columnRoles(units || {}, count);
  const cols = Math.max(3, Math.min(7, Math.round(Math.sqrt(count * 2.4))));
  for (let i = 0; i < roles.length; i++) {
    const reihe = Math.floor(i / cols);
    const spalte = i % cols;
    const inDieserReihe = Math.min(cols, roles.length - reihe * cols);
    const mann = new THREE.Mesh(formen[roles[i]], material);
    mann.userData.sharedGeom = true;
    mann.position.set(-reihe * 0.42, 0, (spalte - (inDieserReihe - 1) / 2) * 0.4);
    group.add(mann);
  }
  group.userData = { material };
  return group;
}

// Welcher Zusammenprall gerade läuft - für den Überspringen-Knopf im
// Schlacht-HUD. Es kann immer nur einer laufen, ein neuer Angriff setzt erst
// ein, wenn der vorige abgeschlossen ist.
let activeClash = null;

// Der Spieler will nicht jedes Mal die volle Länge abwarten: Überspringen
// lässt beide Effekte (Zusammenprall und Kamera-Ruck) auf der Stelle enden -
// derselbe Weg, den sie ohnehin am Ende ihrer Laufzeit nähmen, nur sofort.
export function skipBattleClash() {
  if (!activeClash) return;
  for (const effect of activeClash) effect.elapsed = effect.duration;
  activeClash = null;
}

// Der Mittelweg zwischen abwarten und ganz überspringen: der Zusammenprall
// läuft weiter, nur schneller - wer zusehen will, sieht noch etwas, wer es
// eilig hat, muss nicht die volle Länge abwarten.
export function setBattleSpeed(factor) {
  if (!activeClash) return;
  for (const effect of activeClash) effect.speed = factor;
}

// A clash where the armies actually meet: two shockwave rings race outward
// along the ground moments apart, sparks are thrown up and fall back, dust
// billows and drifts, two battle lines of recognisable troops face off, and
// the camera itself takes a brief, decaying jolt.
export function playBattleClash(col, row, onComplete, options = {}) {
  if (!scene) {
    if (onComplete) onComplete();
    return;
  }
  // Zur See sieht ein Zusammenstoß anders aus: keine Funken und kein Staub,
  // sondern Gischt und Trümmer. Dieselbe Bewegung, andere Farben.
  const naval = !!options.naval;
  const centre = new THREE.Vector3(worldX(col), surfaceY(col, row), worldZ(row));
  const group = new THREE.Group();
  group.position.copy(centre);
  scene.add(group);

  // Zwei Schlachtreihen, einander zugewandt - der Angreifer auf der Seite, von
  // der er kam, der Verteidiger deutlich zu ihm hin gerückt. Bei einem Ort
  // steht sonst genau dort, wo der Verteidiger eigentlich stünde, die Mauer
  // und dahinter ein ganzes Häusergeviert - die Reihe muss vor die Mauer
  // heraustreten, um überhaupt zu sehen zu sein, nicht auf halbem Weg im Tor
  // stehen bleiben. Ohne Angaben zum Anmarsch oder zu den Truppen bleibt es
  // beim bloßen Zusammenprall - so ruft es die Vorschau-Anzeige und jeder
  // ältere Aufruf ohnehin nicht auf.
  let attackerLine = null;
  let defenderLine = null;
  if (options.attackerUnits && options.defenderUnits
    && options.approachCol !== undefined && options.approachRow !== undefined) {
    const lerp = (a, b, t) => a + (b - a) * t;
    const aCol = lerp(options.approachCol, col, 0.34);
    const aRow = lerp(options.approachRow, row, 0.34);
    const dCol = lerp(col, options.approachCol, 0.42);
    const dRow = lerp(row, options.approachRow, 0.42);
    const attackerPos = new THREE.Vector3(worldX(aCol), groundY(aCol, aRow), worldZ(aRow));
    const defenderPos = new THREE.Vector3(worldX(dCol), groundY(dCol, dRow), worldZ(dRow));
    const dx = attackerPos.x - defenderPos.x;
    const dz = attackerPos.z - defenderPos.z;
    // Die Grundform blickt nach lokal +X; um diese Achse auf eine
    // Weltrichtung (dx, dz) zu drehen, muss die Gruppe um genau diesen Winkel
    // gedreht werden (Rotation um die Hochachse in Three.js).
    const facing = (ddx, ddz) => Math.atan2(-ddz, ddx);

    attackerLine = buildBattleLine(options.attackerUnits, options.attackerColor || '#c0392b');
    attackerLine.position.copy(attackerPos).sub(centre);
    attackerLine.rotation.y = facing(-dx, -dz);
    group.add(attackerLine);

    defenderLine = buildBattleLine(options.defenderUnits, options.defenderColor || '#3f6fa8');
    defenderLine.position.copy(defenderPos).sub(centre);
    defenderLine.rotation.y = facing(dx, dz);
    group.add(defenderLine);
  }

  // Additiv gemischt, damit Ring, Blitz und Funken selbst gegen helles
  // Gelände als Licht aufleuchten statt als bloß eingefärbte Fläche zu
  // versinken - ein Zusammenprall muss auch auf sandiger Ebene oder hellem
  // Wasser als Ereignis auffallen, nicht nur auf dunklem Grund.
  const ringMat = () => new THREE.MeshBasicMaterial({
    color: naval ? '#cfe9ff' : '#ffd98a',
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  // Eine helle Kernscheibe für den ersten Sekundenbruchteil - der eigentliche
  // "Knall", ehe die Stoßwelle selbst zu sehen ist.
  const core = new THREE.Mesh(
    new THREE.CircleGeometry(0.6, 24),
    new THREE.MeshBasicMaterial({
      color: naval ? '#eaf7ff' : '#fff4d6', transparent: true,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  core.rotation.x = -Math.PI / 2;
  core.position.y = 0.22;
  group.add(core);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 1.15, 48), ringMat());
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.25;
  group.add(ring);
  // Der zweite Stoß: dasselbe noch einmal, eine halbe Sekunde später und
  // etwas kleiner - der Nachhall, wenn die zweite Reihe nachrückt.
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.95, 48), ringMat());
  ring2.rotation.x = -Math.PI / 2;
  ring2.position.y = 0.25;
  group.add(ring2);

  const flash = new THREE.PointLight(naval ? '#9fd8ff' : '#ffb347', 0, 40);
  flash.position.y = 3;
  group.add(flash);

  const rng = seededRandomFactory(col * 977 + row * 131 + 7);
  const sparks = [];
  for (let i = 0; i < 34; i++) {
    const spark = new THREE.Mesh(
      new THREE.TetrahedronGeometry(0.24 + rng() * 0.22),
      new THREE.MeshBasicMaterial({
        color: naval
          ? (rng() < 0.5 ? '#e8f4ff' : '#7fb2d8')
          : (rng() < 0.5 ? '#ffd27a' : '#e8663d'),
        transparent: true, blending: THREE.AdditiveBlending,
      })
    );
    const angle = rng() * Math.PI * 2;
    const speed = 4.5 + rng() * 6;
    spark.position.set(0, 0.6, 0);
    group.add(spark);
    sparks.push({
      mesh: spark,
      vx: Math.cos(angle) * speed,
      vz: Math.sin(angle) * speed,
      vy: 5 + rng() * 5.5,
      spin: (rng() - 0.5) * 12,
    });
  }

  // Staub, der aufsteigt und über dem Feld hängen bleibt, statt mit den
  // Funken gleich wieder zu verschwinden - bei einer Seeschlacht ist es
  // Gischt statt Staub, heller und kürzer.
  const dustColor = naval ? '#e4f1fb' : '#cbb281';
  const dust = [];
  const dustCount = naval ? 11 : 16;
  for (let i = 0; i < dustCount; i++) {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.5 + rng() * 0.5, 8, 6),
      new THREE.MeshBasicMaterial({ color: dustColor, transparent: true, opacity: 0 })
    );
    const angle = rng() * Math.PI * 2;
    const reach = 0.3 + rng() * 1.2;
    puff.position.set(Math.cos(angle) * reach * 0.3, 0.2, Math.sin(angle) * reach * 0.3);
    group.add(puff);
    dust.push({
      mesh: puff,
      vx: Math.cos(angle) * (0.5 + rng() * 0.8),
      vz: Math.sin(angle) * (0.5 + rng() * 0.8),
      vy: 0.5 + rng() * 0.6,
      delay: rng() * 0.3,
      growth: 0.8 + rng() * 1.0,
    });
  }

  const mainEffect = {
    elapsed: 0,
    duration: CLASH_DURATION,
    onComplete,
    update(t, dt) {
      // Die Schlachtreihen: rasch eingeblendet, ein kurzes Stück aufeinander
      // zu, dann stehen sie im Handgemenge, ehe sie mit dem Rest verblassen.
      if (attackerLine && defenderLine) {
        const vor = Math.min(1, t * 4);
        const advance = (1 - (1 - vor) ** 2) * 0.55;
        const opacity = t < 0.06 ? t / 0.06 : t > 0.82 ? Math.max(0, 1 - (t - 0.82) / 0.18) : 1;
        for (const [line, sign] of [[attackerLine, -1], [defenderLine, 1]]) {
          const vorwaerts = new THREE.Vector3(advance * sign, 0, 0)
            .applyEuler(new THREE.Euler(0, line.rotation.y, 0));
          line.position.x = line.userData.baseX ?? (line.userData.baseX = line.position.x);
          line.position.z = line.userData.baseZ ?? (line.userData.baseZ = line.position.z);
          line.position.x += vorwaerts.x;
          line.position.z += vorwaerts.z;
          line.userData.material.opacity = opacity;
        }
      }

      // Der Knall zuerst: hell auf, rasch wieder weg, ehe die Stoßwelle
      // selbst Fahrt aufnimmt.
      core.scale.setScalar(1 + Math.min(1, t * 5) * 1.3);
      core.material.opacity = Math.max(0, 0.9 * (1 - t * 5));

      const eased = Math.min(1, t * 1.1);
      ring.scale.setScalar(1 + eased * 4.3);
      ring.material.opacity = Math.max(0, 0.95 * (1 - eased));

      const t2 = Math.max(0, t - 0.42);
      const eased2 = Math.min(1, t2 * 1.3);
      ring2.scale.setScalar(1 + eased2 * 3.6);
      ring2.material.opacity = t2 > 0 ? Math.max(0, 0.75 * (1 - eased2)) : 0;

      // Zwei Lichtstöße statt einem: der Anprall, und der Nachhall des
      // zweiten Treffens kurz danach.
      flash.intensity = t < 0.28 ? 9 * (1 - t / 0.28)
        : (t > 0.42 && t < 0.68) ? 4.5 * (1 - (t - 0.42) / 0.26) : 0;

      for (const s of sparks) {
        s.vy -= 22 * dt;
        s.mesh.position.x += s.vx * dt;
        s.mesh.position.y += s.vy * dt;
        s.mesh.position.z += s.vz * dt;
        s.mesh.rotation.x += s.spin * dt;
        s.mesh.rotation.y += s.spin * dt;
        if (s.mesh.position.y < 0.1) {
          s.mesh.position.y = 0.1;
          s.vy = 0;
          s.vx *= 0.7;
          s.vz *= 0.7;
        }
        s.mesh.material.opacity = Math.max(0, 1 - t * 1.1);
      }

      for (const d of dust) {
        const dt2 = t - d.delay;
        if (dt2 <= 0) continue;
        d.mesh.position.x += d.vx * dt;
        d.mesh.position.y += d.vy * dt;
        d.mesh.position.z += d.vz * dt;
        d.vy *= 0.985;
        const grown = 1 + dt2 * d.growth;
        d.mesh.scale.setScalar(grown);
        // Rasch ein, langsam wieder aus - Staub setzt sich nicht ab wie ein
        // Funke, er verweht. `life` läuft von 0 bis 1 über den Rest der
        // Lebenszeit, die diesem Staubfetzen nach seiner eigenen Verzögerung
        // noch bleibt - beides in derselben, auf die Dauer normierten Einheit
        // wie `t` selbst, sonst bliebe die Deckkraft weit unter ihrem Ziel.
        const life = dt2 / (1 - d.delay);
        d.mesh.material.opacity = life < 0.2 ? (life / 0.2) * 0.5 : Math.max(0, 0.5 * (1 - (life - 0.2) / 0.8));
      }
    },
    dispose() {
      // Die Gestalten der Schlachtreihen teilen sich ihre Geometrie mit jeder
      // Kolonne und jeder Wache im Spiel (`marcherShapes()`, einmal gebaut und
      // immer wieder verwendet); `disposeGroup` lässt sie stehen.
      disposeGroup(group);
      if (activeClash) activeClash = null;
    },
  };
  effects.push(mainEffect);

  // Der kurze Ruck der Kamera im Augenblick des Anpralls - er klingt ab,
  // bevor die Kamera je merklich von der Stelle steht, an der sie stand.
  const shakeCol = cam.col;
  const shakeRow = cam.row;
  const shakeRng = seededRandomFactory(col * 401 + row * 89 + 3);
  const shakeEffect = {
    elapsed: 0,
    duration: 0.4,
    update(t) {
      const power = Math.max(0, 1 - t / 0.4) ** 1.6 * 0.1;
      cam.col = shakeCol + (shakeRng() - 0.5) * power;
      cam.row = shakeRow + (shakeRng() - 0.5) * power;
      applyCamera();
    },
    onComplete: () => {
      cam.col = shakeCol;
      cam.row = shakeRow;
      applyCamera();
    },
    dispose() {},
  };
  effects.push(shakeEffect);
  activeClash = [mainEffect, shakeEffect];
  startAnimationLoop();
}

// Walks an army's 3D group from where it currently stands through `tiles`.
// The caller composes the route, so an attack that gets repelled can march
// out, lunge at the defender and fall back.
export function animateArmyPath(armyId, tiles, onComplete) {
  const entry = armyGroups.get(armyId);
  if (!entry || !tiles || !tiles.length || marchSpeedFactor === 0) {
    if (onComplete) onComplete();
    return;
  }
  const points = [entry.group.position.clone(), ...tiles.map(waypointVector)];
  // Jede Teilstrecke wird einmal vermessen, nicht jedes Bild neu - bei einem
  // langen Zug über mehrere Felder und mehreren Heeren gleichzeitig auf
  // Marsch spart das die immer gleiche Wurzelrechnung aus dem Bewegungstakt.
  const segLengths = [];
  let totalLength = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const laenge = points[i].distanceTo(points[i + 1]);
    segLengths.push(laenge);
    totalLength += laenge;
  }
  armyAnimations.set(armyId, {
    group: entry.group,
    points,
    segLengths,
    totalLength,
    traveled: 0,
    segment: 0,
    progress: 0,
    elapsed: 0,
    heading: null,
    onComplete,
  });
  startAnimationLoop();
}

// Raycasts against whichever of the terrain or sea surface is closer to the
// camera, then derives the tile from the hit point (vertices sit exactly at
// tile centres, so a simple round-to-nearest is exact for the terrain and a
// good approximation for open water).
// Wie weit ein Modell von der getroffenen Bodenstelle entfernt sein darf, um
// beim Klick überhaupt in Betracht zu kommen. Eine Große Stadt ragt gut zwei
// Felder weit ins Bild; drei sind reichlich Rand.
const PICK_RANGE = 3;

// Steht auf diesem Feld ein Modell - ein Ort oder ein Heer?
function hasMarker(col, row) {
  for (const entry of cityGroups.values()) {
    const t = entry.group.userData.tile;
    if (t && t.col === col && t.row === row) return true;
  }
  for (const entry of armyGroups.values()) {
    const t = entry.group.userData.tile;
    if (t && t.col === col && t.row === row) return true;
  }
  return false;
}

// Was auf dem Boden steht, ist auch anzuklicken.
//
// Lange strahlte der Klick nur gegen Gelände und Wasser. Alles, was darüber
// steht - Mauern, Dächer, Zelte, die Zahl über einem Heer -, war damit
// unsichtbar für die Maus: der Strahl ging hindurch und traf den Boden
// *dahinter*, also ein Feld weiter hinten. Bei einem Dorf fiel das kaum auf,
// bei einer Großen Stadt lag zwischen dem, was man anklickte, und dem, was
// ausgewählt wurde, ein bis zwei Felder. Wer als Athen sein Heer in die Stadt
// zog, klickte danach auf ein Modell, das gar nichts auswählte - das Heer war
// nur noch über den schmalen Streifen Boden davor zu erreichen.
//
// Ein Modell darf einen Klick aber **nur dann** an sich ziehen, wenn dahinter
// **freies Land** liegt. Sonst nimmt eine hohe Stadt jedem Heer, das hinter
// ihr steht, den Klick weg - und der Fehler wäre nur umgezogen: statt der
// Stadt wäre nun das Heer dahinter nicht mehr anzuwählen. Wer auf ein Feld
// zielt, auf dem selbst etwas steht, meint das, was dort steht.
function pickMarker(raycaster, boden, bodenFeld) {
  if (bodenFeld && hasMarker(bodenFeld.col, bodenFeld.row)) return null;
  const kandidaten = [];
  const grenze = TILE_SIZE * PICK_RANGE;
  for (const map of [cityGroups, armyGroups]) {
    for (const entry of map.values()) {
      const group = entry.group;
      if (!group || !group.visible || !group.userData.tile) continue;
      if (boden && (Math.abs(group.position.x - boden.point.x) > grenze
        || Math.abs(group.position.z - boden.point.z) > grenze)) continue;
      kandidaten.push(group);
    }
  }
  if (!kandidaten.length) return null;
  const treffer = raycaster.intersectObjects(kandidaten, true);
  if (!treffer.length) return null;
  // Liegt der Boden davor, ist der Boden gemeint: ein Klick auf die Wiese vor
  // der Stadt wählt die Wiese.
  if (boden && boden.distance <= treffer[0].distance) return null;
  let obj = treffer[0].object;
  while (obj && !obj.userData.tile) obj = obj.parent;
  return obj && obj.userData.tile ? { ...obj.userData.tile } : null;
}

export function pickTile(ndcX, ndcY) {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);

  const candidates = [terrainMesh, waterMesh].filter(Boolean);
  const hits = raycaster.intersectObjects(candidates, false);
  const boden = hits.length ? hits[0] : null;

  let bodenFeld = null;
  if (boden) {
    const col = colFromWorldX(boden.point.x);
    const row = rowFromWorldZ(boden.point.z);
    if (col >= 0 && col < mapCols && row >= 0 && row < mapRows) bodenFeld = { col, row };
  }

  // Liegt hinter dem Klick freies Land, gilt das Modell davor.
  const marker = pickMarker(raycaster, boden, bodenFeld);
  if (marker && marker.col >= 0 && marker.col < mapCols
    && marker.row >= 0 && marker.row < mapRows) return marker;

  return bodenFeld;
}
