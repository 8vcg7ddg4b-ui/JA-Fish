// --- Die Darstellung ------------------------------------------------------
// Die Sternkarte liegt als Hologramm auf dem Kartentisch der Flaggbrücke
// eines Trägers: Deck ringsum, Konsolen, der Kommandosessel, die Fahnen der
// eigenen Flagge an den Schotten - und ein Panoramafenster, hinter dem das
// Heimatsystem steht. Wer die Kamera tief stellt, sieht die Brücke; wer von
// oben schaut, sieht die Karte. Gekämpft wird auf dieser Karte.
import {
  TILE_TYPES, sizeTier, factionProfile, GREAT_WORKS,
} from './data.js';
import { GRID_COLS, GRID_ROWS, SECTORS, xOfCol, yOfRow } from './starchart.js';
import { tileAt } from './mapgen.js';
import {
  fleetTotalCount, factionById, systemAt, hasSeen, fleetsAt,
} from './state.js';
import { shipModel, flagshipRole, SHIP_LENGTH } from './ships3d.js';
import { drawFactionGlyph } from './emblems.js';
import { territoryMap } from './territory.js';

export const TILE_SIZE = 6;
const MAP_W = GRID_COLS * TILE_SIZE;
const MAP_H = GRID_ROWS * TILE_SIZE;

let renderer, scene, camera, canvasEl;
let mapGroup, holoGroup, entityGroup, overlayGroup, bridgeGroup, starGroup;
let mapTexture, mapMaterial;
let raycaster, pointerVec, mapPlane;
let stateRef = null;
// Die Nachbearbeitung hängt zwischen Szene und Schirm. Kommt sie nicht
// zustande, wird wie früher direkt gezeichnet.
let postFX = null;
let mapMode = 'normal';
let guidesVisible = true;
let bridgeVisible = true;
let starsVisible = true;
let animating = false;
let ceilingMesh = null;
let bordersVisible = true;
// Im Gefecht verschwindet das Kartenwerk: Namen, Zahlen, Reichweiten. Was
// bleibt, sind Welten, Sterne und die Schiffe, um die es gerade geht.
let battleMode = false;

// Die Kamera kreist um ihr Ziel. Azimut dreht sie um den Tisch, Polar ist die
// Höhe über der Tischplatte - flach heißt: man sieht die Brücke.
const DEFAULT_AZIMUTH = Math.PI / 4;
const DEFAULT_POLAR = Math.atan2(1.05, Math.SQRT2);
const MIN_POLAR = 0.22;
const MAX_POLAR = 1.42;
const BASE_DISTANCE = 210;
const MIN_ZOOM = 0.55;
// Ganz nah heran geht es nur im Gefecht - dort steht die Kamera zwischen
// den Verbänden, nicht über der Karte.
const MAX_ZOOM = 7.5;
// `lookY` hebt den Blickpunkt an: über der Karte liegt er auf der Platte,
// im Gefecht auf Höhe der Schiffe.
const cam = { col: GRID_COLS / 2, row: GRID_ROWS / 2, zoom: 1.25, azimuth: DEFAULT_AZIMUTH, polar: DEFAULT_POLAR, lookY: 0 };
// Die Brücke muss die Kamera umschließen, auch ganz herausgezoomt: halbe
// Tischdiagonale plus größter Kameraabstand.
const BRIDGE_RADIUS = 470;
const BRIDGE_HEIGHT = 420;

export function worldOfTile(col, row) {
  return {
    x: (col - (GRID_COLS - 1) / 2) * TILE_SIZE,
    z: (row - (GRID_ROWS - 1) / 2) * TILE_SIZE,
  };
}
export function tileOfWorld(x, z) {
  return {
    col: Math.round(x / TILE_SIZE + (GRID_COLS - 1) / 2),
    row: Math.round(z / TILE_SIZE + (GRID_ROWS - 1) / 2),
  };
}

export function initScene(canvas) {
  canvasEl = canvas;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  // Farbverwaltung: linear rechnen, in sRGB ausgeben, ACES für alles, was
  // heller als weiß ist. Muss vor der ersten Farbe stehen.
  if (window.__setupColorPipeline) window.__setupColorPipeline(renderer, 1.0, 'film');
  // Die Tonwerte macht ab jetzt der letzte Durchgang der Nachbearbeitung.
  if (window.__makePostFX) {
    postFX = window.__makePostFX(renderer, {
      kurve: 'aces',
      belichtung: 1.0,
      // Erst was heller als Weiß ist, blendet: die Sternkarte ist voll
      // heller Flächen, und bei 0,85 leuchtete sie als Ganzes.
      bloom: { schwelle: 1.3, staerke: 0.45, radius: 2.2 },
    });
    if (postFX) renderer.toneMapping = THREE.NoToneMapping;
  }
  renderer.setClearColor(0x04060c, 1);
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x04060c, 900, 2600);
  // Metallische Rümpfe brauchen etwas zum Spiegeln, sonst bleiben sie
  // schwarz - die Umgebungskarte ist gemalt, nicht geladen.
  if (window.__buildEnvMap) scene.environment = window.__buildEnvMap(renderer, 'raum');
  camera = new THREE.PerspectiveCamera(46, 1, 1, 3000);

  mapGroup = new THREE.Group();
  holoGroup = new THREE.Group();
  entityGroup = new THREE.Group();
  overlayGroup = new THREE.Group();
  bridgeGroup = new THREE.Group();
  starGroup = new THREE.Group();
  scene.add(mapGroup, holoGroup, entityGroup, overlayGroup, bridgeGroup, starGroup);

  // Licht: kaltes Deckenlicht von oben, ein warmer Schein aus dem Hologramm
  // selbst - die Karte leuchtet, nicht der Raum.
  scene.add(new THREE.AmbientLight(0x4a68c8, 1.15));
  scene.add(new THREE.HemisphereLight(0x9dc4ff, 0x0a1018, 0.5));
  const key = new THREE.DirectionalLight(0xbcdcff, 0.7);
  key.position.set(120, 260, 160);
  scene.add(key);
  // Zwei Deckenlampen über dem Tisch: sie geben der Brücke Tiefe, wenn die
  // Kamera flach steht.
  for (const [lx, lz] of [[-160, -120], [180, 140]]) {
    const lamp = new THREE.PointLight(0xa8ccff, 0.8, 700, 2);
    lamp.position.set(lx, 150, lz);
    scene.add(lamp);
  }
  const holoLight = new THREE.PointLight(0x6fa8ff, 1.5, 620, 2);
  holoLight.position.set(0, 26, 0);
  scene.add(holoLight);
  const rim = new THREE.PointLight(0xff9a5a, 0.5, 700, 2);
  rim.position.set(-220, 60, -180);
  scene.add(rim);

  raycaster = new THREE.Raycaster();
  pointerVec = new THREE.Vector2();
  mapPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  buildStarfield();
  resize();
  return { renderer, scene, camera };
}

// --- Der Sternenhintergrund ---------------------------------------------
function buildStarfield() {
  starGroup.clear();
  const geo = new THREE.BufferGeometry();
  const count = 1400;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Sterne liegen auf einer Kugel weit außen - sie drehen nicht mit der
    // Karte, sondern stehen still, wie Sterne das tun.
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 1200 + Math.random() * 500;
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = Math.abs(r * Math.cos(phi)) * 0.7;
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const warm = Math.random();
    col[i * 3] = 0.7 + warm * 0.3;
    col[i * 3 + 1] = 0.75 + Math.random() * 0.25;
    col[i * 3 + 2] = 0.85 + Math.random() * 0.15;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 4.5, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.9 });
  starGroup.add(new THREE.Points(geo, mat));
}

// --- Die Karte als Textur ------------------------------------------------
// Nebel, Trümmer, Strahlung, Gräben, Sektorgrenzen und das Raster werden in
// eine Leinwand gezeichnet und auf die Tischplatte gelegt. Das ist billiger
// als tausende Felder aus Geometrie - und es sieht aus wie eine Seekarte,
// was es ja auch ist.
function drawMapTexture(state) {
  const scale = 12;
  const cv = document.createElement('canvas');
  cv.width = GRID_COLS * scale;
  cv.height = GRID_ROWS * scale;
  const g = cv.getContext('2d');

  g.fillStyle = '#050a14';
  g.fillRect(0, 0, cv.width, cv.height);

  // Sektorflächen: jeder Sektor bekommt einen Hauch eigener Farbe, damit man
  // auf der Karte sieht, wo man ist.
  const sectorTint = {
    sol: 'rgba(70,120,200,0.10)',
    vega: 'rgba(90,150,190,0.09)',
    enigma: 'rgba(120,100,200,0.09)',
    kilrah: 'rgba(200,80,60,0.10)',
    grenzwelten: 'rgba(60,170,150,0.09)',
    gemini: 'rgba(180,150,80,0.08)',
    landreich: 'rgba(200,170,60,0.08)',
    firekka: 'rgba(160,110,200,0.08)',
    tiefe: 'rgba(20,30,50,0.05)',
  };

  for (const tile of state.map.tiles) {
    const x = tile.col * scale;
    const y = tile.row * scale;
    g.fillStyle = sectorTint[tile.sector] || sectorTint.tiefe;
    g.fillRect(x, y, scale, scale);
    if (tile.type === TILE_TYPES.NEBULA) {
      const a = 0.18 + tile.density * 0.5;
      const grd = g.createRadialGradient(x + scale / 2, y + scale / 2, 1, x + scale / 2, y + scale / 2, scale);
      grd.addColorStop(0, `rgba(120,90,220,${a})`);
      grd.addColorStop(1, 'rgba(60,40,140,0)');
      g.fillStyle = grd;
      g.fillRect(x - scale, y - scale, scale * 3, scale * 3);
    } else if (tile.type === TILE_TYPES.ASTEROIDS) {
      g.fillStyle = 'rgba(90,80,70,0.4)';
      g.fillRect(x, y, scale, scale);
      g.fillStyle = 'rgba(180,170,150,0.75)';
      for (let i = 0; i < 5; i++) {
        const px = x + ((tile.speck * 977 * (i + 3)) % scale);
        const py = y + ((tile.speck * 613 * (i + 5)) % scale);
        g.fillRect(px, py, 1.6, 1.6);
      }
    } else if (tile.type === TILE_TYPES.RADIATION) {
      const grd = g.createRadialGradient(x + scale / 2, y + scale / 2, 1, x + scale / 2, y + scale / 2, scale);
      grd.addColorStop(0, 'rgba(255,170,60,0.34)');
      grd.addColorStop(1, 'rgba(255,90,30,0)');
      g.fillStyle = grd;
      g.fillRect(x - scale, y - scale, scale * 3, scale * 3);
    } else if (tile.type === TILE_TYPES.RIFT) {
      g.fillStyle = 'rgba(2,3,6,0.96)';
      g.fillRect(x, y, scale, scale);
      g.strokeStyle = 'rgba(90,40,120,0.5)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y + scale * (0.2 + tile.speck * 0.6));
      g.lineTo(x + scale, y + scale * (0.2 + ((tile.speck * 7) % 1) * 0.6));
      g.stroke();
    }
  }

  // Das Raster: dünn, damit es die Karte nicht erschlägt.
  g.strokeStyle = 'rgba(120,170,230,0.10)';
  g.lineWidth = 1;
  for (let c = 0; c <= GRID_COLS; c++) {
    g.beginPath();
    g.moveTo(c * scale, 0);
    g.lineTo(c * scale, cv.height);
    g.stroke();
  }
  for (let r = 0; r <= GRID_ROWS; r++) {
    g.beginPath();
    g.moveTo(0, r * scale);
    g.lineTo(cv.width, r * scale);
    g.stroke();
  }

  // Die Sektorgrenzen und ihre Namen - der Kartenrand einer Seekarte.
  g.font = `${scale * 1.1}px "Chakra Petch", "Eurostile", "Bahnschrift", system-ui, sans-serif`;
  for (const sector of SECTORS) {
    const x0 = (sector.x0 / 100) * cv.width;
    const x1 = (sector.x1 / 100) * cv.width;
    const y0 = (sector.y0 / 56) * cv.height;
    const y1 = (sector.y1 / 56) * cv.height;
    g.strokeStyle = 'rgba(140,190,255,0.22)';
    g.setLineDash([scale, scale]);
    g.lineWidth = 1.4;
    g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    g.setLineDash([]);
    g.fillStyle = 'rgba(170,205,255,0.24)';
    g.fillText(sector.name.toUpperCase(), x0 + scale, y0 + scale * 2.2);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
  tex.needsUpdate = true;
  return tex;
}

// --- Nebel, Trümmer, Strahlung in echt ----------------------------------
// Bisher waren die Bänke flache Scheiben und die Trümmerfelder nur Punkte in
// der Kartentextur. Jetzt steht beides über der Platte: Nebelschwaden als
// Schwebeteilchen, die immer zur Kamera schauen, und Brocken als Körper, die
// man aus jedem Winkel sieht.
let fieldsGroup = null;
let fieldsStamp = null;
let cloudTex = null;

function cloudTexture() {
  if (cloudTex) return cloudTex;
  cloudTex = paintCanvas(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 2, 64, 64, 62);
    grd.addColorStop(0, 'rgba(255,255,255,0.55)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.22)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    // Ein wenig Struktur, damit die Schwaden nicht wie Kreise aussehen.
    for (let i = 0; i < 26; i++) {
      const x = 20 + Math.random() * 88;
      const y = 20 + Math.random() * 88;
      const r = 6 + Math.random() * 22;
      const sub = g.createRadialGradient(x, y, 1, x, y, r);
      sub.addColorStop(0, 'rgba(255,255,255,0.16)');
      sub.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sub;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  });
  return cloudTex;
}

function buildSpaceFields(state) {
  const stamp = `${Object.keys(state.seen).length}`;
  if (fieldsGroup && fieldsStamp === stamp) return;
  fieldsStamp = stamp;
  if (fieldsGroup) {
    holoGroup.remove(fieldsGroup);
    fieldsGroup.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material && node.material.dispose) node.material.dispose();
    });
  }
  fieldsGroup = new THREE.Group();
  fieldsGroup.name = 'raumfelder';
  holoGroup.add(fieldsGroup);

  const rnd = (seed) => {
    let x = Math.sin(seed) * 43758.5453;
    return x - Math.floor(x);
  };

  // --- Nebel: Schwaden über der Bank -------------------------------------
  const nebulaMat = new THREE.SpriteMaterial({
    map: cloudTexture(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.5,
  });
  const rocks = [];
  const radiation = [];
  for (const tile of state.map.tiles) {
    if (!hasSeen(state, tile.col, tile.row)) continue;
    const { x, z } = worldOfTile(tile.col, tile.row);
    const seed = tile.col * 73.13 + tile.row * 31.7;
    if (tile.type === TILE_TYPES.NEBULA) {
      // Je dichter die Bank, desto mehr Schwaden - und nur auf jedem zweiten
      // Feld, sonst steht die halbe Karte im Rauch.
      const count = tile.density > 0.55 ? 2 : tile.density > 0.3 ? 1 : (rnd(seed) > 0.6 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const sprite = new THREE.Sprite(nebulaMat.clone());
        const size = TILE_SIZE * (1.6 + rnd(seed + i * 3.1) * 2.2);
        sprite.scale.set(size, size, 1);
        sprite.position.set(
          x + (rnd(seed + i) - 0.5) * TILE_SIZE * 1.6,
          4 + rnd(seed + i * 7.7) * 16,
          z + (rnd(seed + i * 2.3) - 0.5) * TILE_SIZE * 1.6,
        );
        sprite.material.color.set(new THREE.Color(0x6f4fd6).lerp(
          new THREE.Color(0x2f7fc0), rnd(seed + i * 5.5) * 0.35,
        ));
        sprite.material.opacity = 0.13 + tile.density * 0.2;
        sprite.userData.drift = 0.2 + rnd(seed + i * 11.3) * 0.6;
        fieldsGroup.add(sprite);
      }
    } else if (tile.type === TILE_TYPES.ASTEROIDS) {
      // Vier bis sieben Brocken je Feld, in verschiedenen Höhen.
      const count = 4 + Math.floor(rnd(seed) * 4);
      for (let i = 0; i < count; i++) {
        rocks.push({
          x: x + (rnd(seed + i * 1.7) - 0.5) * TILE_SIZE * 0.95,
          y: 1.5 + rnd(seed + i * 4.3) * 9,
          z: z + (rnd(seed + i * 3.9) - 0.5) * TILE_SIZE * 0.95,
          s: 0.35 + rnd(seed + i * 6.1) * 1.15,
          rx: rnd(seed + i * 8.9) * Math.PI,
          ry: rnd(seed + i * 12.7) * Math.PI,
          shade: 0.55 + rnd(seed + i * 2.9) * 0.45,
        });
      }
    } else if (tile.type === TILE_TYPES.RADIATION) {
      if (rnd(seed) > 0.45) radiation.push({ x, z, seed });
    }
  }

  // --- Trümmer: echte Körper, nicht nur Punkte ---------------------------
  if (rocks.length) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xb9ad99, roughness: 0.95, metalness: 0.08, flatShading: true,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, rocks.length);
    const dummy = new THREE.Object3D();
    const colour = new THREE.Color();
    rocks.forEach((rock, i) => {
      dummy.position.set(rock.x, rock.y, rock.z);
      dummy.rotation.set(rock.rx, rock.ry, rock.rx * 0.5);
      dummy.scale.set(rock.s, rock.s * (0.7 + rock.shade * 0.5), rock.s * 0.9);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, colour.setRGB(rock.shade * 0.62, rock.shade * 0.56, rock.shade * 0.48));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.name = 'truemmer';
    fieldsGroup.add(mesh);
  }

  // --- Strahlung: ein heißer Schein über dem Feld ------------------------
  for (const spot of radiation) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudTexture(),
      color: 0xffa54f,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.3,
    }));
    const size = TILE_SIZE * (1.4 + rnd(spot.seed) * 1.4);
    sprite.scale.set(size, size, 1);
    sprite.position.set(spot.x, 4 + rnd(spot.seed * 3.3) * 8, spot.z);
    sprite.userData.pulse = rnd(spot.seed * 5.1) * Math.PI * 2;
    fieldsGroup.add(sprite);
  }
}

// Nebel treibt, Strahlung pulst - langsam, damit die Karte ruhig bleibt.
// Die Sprungbojen leben: der Kranz dreht, das Feuer blinkt, das Fass wiegt
// sich leicht. Ein Seezeichen, das still steht, übersieht man.
function animateShields(time) {
  for (const net of shieldNets) {
    if (!net.visible) continue;
    net.rotation.y = time * 0.12;
    net.rotation.x = Math.sin(time * 0.2) * 0.12;
  }
}

function animateBuoys(time) {
  for (const buoy of jumpBuoys) {
    const ph = buoy.userData.phase || 0;
    buoy.position.y = Math.sin(time * 0.9 + ph) * 0.5;
    buoy.rotation.z = Math.sin(time * 0.6 + ph) * 0.05;
    const ring = buoy.getObjectByName('kranz');
    if (ring) ring.rotation.z += 0.006;
    const puls = 0.55 + Math.abs(Math.sin(time * 2.2 + ph)) * 0.45;
    const lamp = buoy.getObjectByName('feuer');
    if (lamp) lamp.material.opacity = 0.35 + puls * 0.6;
    const halo = buoy.getObjectByName('schein');
    if (halo) {
      halo.material.opacity = 0.1 + puls * 0.3;
      halo.scale.setScalar(0.9 + puls * 0.35);
    }
  }
}

function animateFields(time) {
  if (!fieldsGroup) return;
  for (const node of fieldsGroup.children) {
    if (node.userData.drift) {
      node.position.x += Math.sin(time * 0.00007 * node.userData.drift) * 0.006;
      node.position.y += Math.cos(time * 0.00005 * node.userData.drift) * 0.004;
    } else if (node.userData.pulse !== undefined) {
      node.material.opacity = 0.22 + Math.sin(time * 0.0012 + node.userData.pulse) * 0.1;
    }
  }
}

// --- Grenzen ------------------------------------------------------------
// Die Fläche in der Farbe der Flagge und die Linie dort, wo zwei Reiche
// aneinanderstoßen. Beides liegt flach auf der Platte, knapp über der Karte.
let territoryGroup = null;
let territoryStamp = null;

function buildTerritory(state) {
  const { owner, edges, stamp } = territoryMap(state);
  const seenStamp = `${stamp}|${Object.keys(state.seen).length}`;
  if (territoryGroup && territoryStamp === seenStamp) return;
  territoryStamp = seenStamp;
  if (territoryGroup) {
    mapGroup.remove(territoryGroup);
    territoryGroup.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) node.material.dispose();
    });
  }
  territoryGroup = new THREE.Group();
  territoryGroup.name = 'territorium';
  territoryGroup.visible = bordersVisible;
  mapGroup.add(territoryGroup);

  // Die Fläche: ein Feld je Instanz, eingefärbt nach Flagge. Was niemand
  // gesehen hat, bleibt leer.
  const tiles = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const id = owner[row * GRID_COLS + col];
      if (!id || id === 'neutral') continue;
      if (!hasSeen(state, col, row)) continue;
      tiles.push({ col, row, id });
    }
  }
  if (tiles.length) {
    const geo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.17, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, tiles.length);
    const dummy = new THREE.Object3D();
    const colour = new THREE.Color();
    tiles.forEach((tile, i) => {
      const { x, z } = worldOfTile(tile.col, tile.row);
      dummy.position.set(x, 1.05, z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, colour.set(factionProfile(tile.id).color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    territoryGroup.add(mesh);
  }

  // Die Linie: jede Kante ein Strich in der Farbe des Reiches, das dort
  // endet.
  const points = [];
  const colors = [];
  const half = TILE_SIZE / 2;
  const colour = new THREE.Color();
  for (const edge of edges) {
    if (!hasSeen(state, edge.col, edge.row)) continue;
    if (edge.factionId === 'neutral') continue;
    const { x, z } = worldOfTile(edge.col, edge.row);
    let a;
    let b;
    if (edge.side === 'ost') { a = [x + half, z - half]; b = [x + half, z + half]; }
    else if (edge.side === 'west') { a = [x - half, z - half]; b = [x - half, z + half]; }
    else if (edge.side === 'sued') { a = [x - half, z + half]; b = [x + half, z + half]; }
    else { a = [x - half, z - half]; b = [x + half, z - half]; }
    points.push(a[0], 1.9, a[1], b[0], 1.9, b[1]);
    colour.set(factionProfile(edge.factionId).color);
    colors.push(colour.r, colour.g, colour.b, colour.r, colour.g, colour.b);
  }
  if (points.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.9,
    }));
    territoryGroup.add(lines);
  }
}

// --- Der Kartentisch und die Brücke -------------------------------------
function buildTable() {
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x1a2230, metalness: 0.7, roughness: 0.45 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x4f8fd6, transparent: true, opacity: 0.55 });

  // Die Platte selbst: die Karte liegt darauf.
  const top = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_W, MAP_H),
    mapMaterial,
  );
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0;
  mapGroup.add(top);

  // Der Rahmen ringsum - vier Balken aus gebürstetem Metall.
  const border = 7;
  const bars = [
    [MAP_W + border * 2, border, 0, (MAP_H + border) / 2],
    [MAP_W + border * 2, border, 0, -(MAP_H + border) / 2],
    [border, MAP_H + border * 2, (MAP_W + border) / 2, 0],
    [border, MAP_H + border * 2, -(MAP_W + border) / 2, 0],
  ];
  for (const [w, d, x, z] of bars) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 4, d), rimMat);
    bar.position.set(x, -2, z);
    mapGroup.add(bar);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(w * 0.98, 0.6, d * 0.35), glowMat);
    glow.position.set(x, 0.4, z);
    mapGroup.add(glow);
  }

  // Der Lichtsaum: ein Ring knapp über der Platte. Aus flacher Kamera ist er
  // das, was man vom Hologramm zuerst sieht.
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(MAP_W, MAP_H) * 0.52, Math.max(MAP_W, MAP_H) * 0.56, 64),
    new THREE.MeshBasicMaterial({ color: 0x4f9fd6, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 1.2;
  mapGroup.add(halo);

  // Der Sockel: ein Kasten unter der Platte, damit der Tisch ein Tisch ist.
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(MAP_W * 0.92, 26, MAP_H * 0.86),
    new THREE.MeshStandardMaterial({ color: 0x121821, metalness: 0.6, roughness: 0.6 }),
  );
  base.position.y = -16;
  mapGroup.add(base);

  // Vier Standfüße - man sieht sie nur aus flacher Kamera, und genau dann
  // sollen sie da sein.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 40, 10), rimMat);
    leg.position.set(sx * MAP_W * 0.4, -44, sz * MAP_H * 0.36);
    mapGroup.add(leg);
  }
}

function paintCanvas(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), cv);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

// Die Brücke: Deck, Konsolenring, Sessel, Fahnen, Fluganzug, Fenster. Sie
// wird einmal gebaut und bleibt stehen - was sich ändert, ist die Farbe der
// Flagge.
// Die Brücke ist ein Raum, kein Requisitenlager: Deck, Schott, Decke - und in
// das Schott eingelassen das Panoramafenster, hinter dem das Heimatsystem
// steht. Sonst steht hier nichts herum; was zählt, liegt auf dem Tisch.
function buildBridge(state) {
  bridgeGroup.clear();
  ceilingMesh = null;
  if (!bridgeVisible) return;
  const player = factionById(state, state.playerFactionId) || state.factions[0];
  const profile = factionProfile(player.id);

  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x1d2837, metalness: 0.45, roughness: 0.7, side: THREE.DoubleSide,
    emissive: 0x0d1622, emissiveIntensity: 0.85,
  });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x27313f, metalness: 0.8, roughness: 0.35 });

  // Das Deck: Platten mit Fugen, ein Ring aus Leuchtstreifen um den Tisch.
  const deckTex = paintCanvas(512, 512, (g) => {
    g.fillStyle = '#0a0f16';
    g.fillRect(0, 0, 512, 512);
    g.strokeStyle = 'rgba(90,120,160,0.18)';
    g.lineWidth = 2;
    for (let i = 0; i <= 512; i += 64) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke();
    }
  });
  deckTex.wrapS = THREE.RepeatWrapping;
  deckTex.wrapT = THREE.RepeatWrapping;
  deckTex.repeat.set(7, 7);
  const deck = new THREE.Mesh(
    new THREE.CircleGeometry(BRIDGE_RADIUS, 56),
    new THREE.MeshStandardMaterial({ map: deckTex, color: 0x1e2b3c, metalness: 0.3, roughness: 0.9 }),
  );
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = -66;
  bridgeGroup.add(deck);

  // Ein Lichtring auf dem Deck rings um den Tisch - er hält den Blick am
  // Tisch, statt ihn im dunklen Deck verlaufen zu lassen.
  const deckRing = new THREE.Mesh(
    new THREE.RingGeometry(MAP_W * 0.58, MAP_W * 0.6, 72),
    new THREE.MeshBasicMaterial({
      color: profile.color, transparent: true, opacity: 0.28, side: THREE.DoubleSide,
    }),
  );
  deckRing.rotation.x = -Math.PI / 2;
  deckRing.position.y = -65;
  bridgeGroup.add(deckRing);
  const outerRing = new THREE.Mesh(
    new THREE.RingGeometry(BRIDGE_RADIUS * 0.72, BRIDGE_RADIUS * 0.74, 72),
    new THREE.MeshBasicMaterial({ color: 0x6fb0ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide }),
  );
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.position.y = -65;
  bridgeGroup.add(outerRing);
  // Ein weiches Licht über dem Deck, damit der Boden Grund hat und nicht
  // schwarz ins Nichts läuft.
  const deckGlow = new THREE.PointLight(0x4f7ab0, 0.55, 900, 2);
  deckGlow.position.set(0, -30, 0);
  bridgeGroup.add(deckGlow);

  // Das Schott ringsum, innen sichtbar.
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(BRIDGE_RADIUS, BRIDGE_RADIUS, BRIDGE_HEIGHT, 56, 1, true),
    hullMat,
  );
  wall.position.y = BRIDGE_HEIGHT / 2 - 66;
  bridgeGroup.add(wall);

  // Spanten: senkrechte Rippen im Schott. Sie geben dem Raum Maßstab.
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(5, BRIDGE_HEIGHT * 0.9, 5), trimMat);
    rib.position.set(
      Math.cos(angle) * (BRIDGE_RADIUS - 4), BRIDGE_HEIGHT * 0.45 - 66, Math.sin(angle) * (BRIDGE_RADIUS - 4),
    );
    bridgeGroup.add(rib);
  }

  // Lichtbänder in zwei Höhen, die die Rundung nachzeichnen.
  for (const [y, opacity] of [[-24, 0.32], [70, 0.2]]) {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(BRIDGE_RADIUS - 1, BRIDGE_RADIUS - 1, 2.6, 56, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x6fb0ff, transparent: true, opacity, side: THREE.BackSide }),
    );
    band.position.y = y;
    bridgeGroup.add(band);
  }

  // Die Decke.
  const ceiling = new THREE.Mesh(
    new THREE.CircleGeometry(BRIDGE_RADIUS, 56),
    new THREE.MeshStandardMaterial({ color: 0x0c1219, metalness: 0.4, roughness: 0.8, side: THREE.DoubleSide }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = BRIDGE_HEIGHT - 66;
  ceiling.name = 'ceiling';
  ceilingMesh = ceiling;
  bridgeGroup.add(ceiling);
  for (let i = 0; i < 4; i++) {
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(BRIDGE_RADIUS * 1.6, 1.5, 7),
      new THREE.MeshBasicMaterial({ color: 0x8fc4ff, transparent: true, opacity: 0.26 }),
    );
    strip.position.y = BRIDGE_HEIGHT - 70;
    strip.rotation.y = (i / 4) * Math.PI;
    bridgeGroup.add(strip);
  }

  // --- Das Panoramafenster ------------------------------------------------
  // Es hängt nicht im Raum, sondern ist in das Schott eingelassen: derselbe
  // Radius, dieselbe Rundung, mit Rahmen oben und unten und Streben dazwischen.
  const winArc = Math.PI * 0.5;                 // ein Viertel des Rundgangs
  const winStart = Math.PI * 1.05;              // der Grundstellung der Kamera gegenüber
  const winHeight = 120;
  const winY = 24;
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(BRIDGE_RADIUS - 2, BRIDGE_RADIUS - 2, winHeight, 40, 1, true, winStart, winArc),
    new THREE.MeshBasicMaterial({ map: buildViewportTexture(state, profile), side: THREE.BackSide }),
  );
  glass.position.y = winY;
  bridgeGroup.add(glass);

  // Rahmen: zwei Ringsegmente und ein paar Streben.
  for (const y of [winY + winHeight / 2, winY - winHeight / 2]) {
    const edge = new THREE.Mesh(
      new THREE.CylinderGeometry(BRIDGE_RADIUS - 1, BRIDGE_RADIUS - 1, 7, 40, 1, true, winStart - 0.02, winArc + 0.04),
      trimMat,
    );
    edge.position.y = y;
    bridgeGroup.add(edge);
  }
  for (let i = 0; i <= 5; i++) {
    const angle = winStart + (i / 5) * winArc;
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(4, winHeight, 4), trimMat);
    mullion.position.set(
      Math.cos(angle) * (BRIDGE_RADIUS - 3), winY, Math.sin(angle) * (BRIDGE_RADIUS - 3),
    );
    mullion.rotation.y = -angle;
    bridgeGroup.add(mullion);
  }
  // --- Die Tür ------------------------------------------------------------
  // Jeder Raum hat einen Ausgang. Dieser hier ist ein Schott mit zwei
  // Flügeln, Rahmen und Warnlicht - geöffnet wird er nicht: der Feldzug wird
  // an diesem Tisch geführt.
  const doorAngle = Math.PI * 0.5;
  const doorW = 74;
  const doorH = 116;
  const doorR = BRIDGE_RADIUS - 3;
  const doorGroup = new THREE.Group();
  doorGroup.position.set(Math.cos(doorAngle) * doorR, -66 + doorH / 2, Math.sin(doorAngle) * doorR);
  doorGroup.rotation.y = -doorAngle + Math.PI / 2;

  // Die Nische: dunkler als das Schott, damit die Tür Tiefe bekommt.
  doorGroup.add(new THREE.Mesh(
    new THREE.BoxGeometry(doorW + 12, doorH + 12, 6),
    new THREE.MeshStandardMaterial({ color: 0x0c131c, metalness: 0.4, roughness: 0.8 }),
  ));
  // Zwei Flügel mit einer Fuge in der Mitte.
  for (const side of [-1, 1]) {
    const leaf = new THREE.Mesh(
      new THREE.BoxGeometry(doorW / 2 - 1.2, doorH, 4),
      new THREE.MeshStandardMaterial({ color: 0x223143, metalness: 0.65, roughness: 0.45 }),
    );
    leaf.position.set(side * (doorW / 4 + 0.6), 0, 3);
    doorGroup.add(leaf);
    // Griffleiste und Streben auf dem Flügel.
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(doorW / 2 - 10, 3, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x36465c, metalness: 0.8, roughness: 0.3 }),
    );
    bar.position.set(side * (doorW / 4 + 0.6), -8, 5.2);
    doorGroup.add(bar);
  }
  // Der Rahmen ringsum.
  for (const [w, h, x, y] of [[doorW + 14, 5, 0, doorH / 2 + 3], [doorW + 14, 5, 0, -doorH / 2 - 3],
    [5, doorH + 12, -doorW / 2 - 5, 0], [5, doorH + 12, doorW / 2 + 5, 0]]) {
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x415670, metalness: 0.8, roughness: 0.3,
      emissive: 0x16273a, emissiveIntensity: 0.7,
    });
    doorGroup.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, 8), frameMat).translateX(x).translateY(y).translateZ(2));
  }
  // Warnlicht und Kennung über der Tür.
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(26, 4, 2),
    new THREE.MeshBasicMaterial({ color: 0xffb765, transparent: true, opacity: 0.9 }),
  );
  lamp.position.set(0, doorH / 2 + 12, 4);
  doorGroup.add(lamp);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 15),
    new THREE.MeshBasicMaterial({
      map: paintCanvas(256, 64, (g) => {
        g.fillStyle = '#0a121c';
        g.fillRect(0, 0, 256, 64);
        g.fillStyle = '#8fc4ff';
        g.font = '600 34px "Chakra Petch", system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('FLUGDECK', 128, 34);
      }),
      transparent: true,
    }),
  );
  sign.position.set(0, doorH / 2 + 22, 4);
  doorGroup.add(sign);
  // Die Lichtschwelle: ein Streifen im Deck vor der Tür.
  const sill = new THREE.Mesh(
    new THREE.PlaneGeometry(doorW + 16, 26),
    new THREE.MeshBasicMaterial({ color: 0xffb765, transparent: true, opacity: 0.16 }),
  );
  sill.rotation.x = -Math.PI / 2;
  sill.position.set(Math.cos(doorAngle) * (doorR - 18), -65, Math.sin(doorAngle) * (doorR - 18));
  sill.rotation.z = -doorAngle + Math.PI / 2;
  bridgeGroup.add(sill);
  const doorLight = new THREE.PointLight(0xffb765, 0.5, 320, 2);
  doorLight.position.set(Math.cos(doorAngle) * (doorR - 40), -20, Math.sin(doorAngle) * (doorR - 40));
  bridgeGroup.add(doorLight);
  bridgeGroup.add(doorGroup);

  // Der Schein, den das Fenster ins Deck wirft.
  const spill = new THREE.PointLight(new THREE.Color(profile.color), 0.6, 900, 2);
  spill.position.set(
    Math.cos(winStart + winArc / 2) * (BRIDGE_RADIUS - 60), winY,
    Math.sin(winStart + winArc / 2) * (BRIDGE_RADIUS - 60),
  );
  bridgeGroup.add(spill);
}


function homeViewKind(state) {
  const player = state.playerFactionId;
  const home = state.systems.find((s) => s.factionId === player && s.capital)
    || state.systems.find((s) => s.factionId === player);
  if (!home) return 'flugdeck';
  let nebel = 0;
  let truemmer = 0;
  let strahlung = 0;
  for (let dr = -4; dr <= 4; dr++) {
    for (let dc = -4; dc <= 4; dc++) {
      const t = tileAt(state.map, home.col + dc, home.row + dr);
      if (!t) continue;
      if (t.type === TILE_TYPES.NEBULA) nebel += 1;
      else if (t.type === TILE_TYPES.ASTEROIDS) truemmer += 1;
      else if (t.type === TILE_TYPES.RADIATION) strahlung += 1;
    }
  }
  if (nebel > 12) return 'nebel';
  if (truemmer > 8) return 'truemmer';
  if (strahlung > 6) return 'doppelsonne';
  if (home.size >= 4) return 'gasriese';
  return 'flugdeck';
}

function buildViewportTexture(state, profile) {
  const kind = homeViewKind(state);
  return paintCanvas(1024, 256, (g) => {
    g.fillStyle = '#03060c';
    g.fillRect(0, 0, 1024, 256);
    // Sterne, immer.
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 256;
      g.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.7})`;
      g.fillRect(x, y, 1.4, 1.4);
    }
    if (kind === 'nebel') {
      const grd = g.createRadialGradient(520, 150, 20, 520, 150, 480);
      grd.addColorStop(0, `${profile.color}bb`);
      grd.addColorStop(1, 'rgba(10,14,30,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 1024, 256);
    } else if (kind === 'gasriese') {
      g.fillStyle = profile.colorDark;
      g.beginPath();
      g.arc(760, 230, 210, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = `${profile.accent}66`;
      g.lineWidth = 8;
      g.beginPath();
      g.ellipse(760, 230, 320, 42, -0.2, 0, Math.PI * 2);
      g.stroke();
    } else if (kind === 'truemmer') {
      for (let i = 0; i < 140; i++) {
        const x = Math.random() * 1024;
        const y = 90 + Math.random() * 160;
        g.fillStyle = `rgba(160,150,135,${0.3 + Math.random() * 0.6})`;
        g.fillRect(x, y, 2 + Math.random() * 5, 2 + Math.random() * 4);
      }
    } else if (kind === 'doppelsonne') {
      for (const [x, y, r, c] of [[300, 90, 46, '#ffd79a'], [420, 130, 24, '#ff9a6a']]) {
        const grd = g.createRadialGradient(x, y, 2, x, y, r * 4);
        grd.addColorStop(0, c);
        grd.addColorStop(0.25, `${c}66`);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.arc(x, y, r * 4, 0, Math.PI * 2);
        g.fill();
      }
    } else {
      // Das eigene Flugdeck: Landebahn, Positionslichter, ein Jäger im Anflug.
      g.fillStyle = '#0c131c';
      g.beginPath();
      g.moveTo(0, 200);
      g.lineTo(1024, 170);
      g.lineTo(1024, 256);
      g.lineTo(0, 256);
      g.closePath();
      g.fill();
      g.strokeStyle = `${profile.accent}88`;
      g.lineWidth = 4;
      g.setLineDash([28, 20]);
      g.beginPath();
      g.moveTo(40, 224);
      g.lineTo(984, 196);
      g.stroke();
      g.setLineDash([]);
      for (let i = 0; i < 10; i++) {
        g.fillStyle = i % 2 ? '#ffb765' : profile.accent;
        g.beginPath();
        g.arc(60 + i * 100, 240 - i * 2, 5, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#121b26';
      g.beginPath();
      g.moveTo(620, 110);
      g.lineTo(700, 128);
      g.lineTo(620, 146);
      g.lineTo(640, 128);
      g.closePath();
      g.fill();
      g.strokeStyle = profile.color;
      g.lineWidth = 2;
      g.stroke();
    }
  });
}

// --- Schrift auf der Karte ----------------------------------------------
// Die Namen stehen wieder als Sprites im Raum - aber sie werden bei jedem
// Bild auf gleichbleibende Bildschirmgröße gerechnet und weichen einander
// aus. So bleiben sie an ihrem Ort und trotzdem lesbar.
const labelCache = new Map();
function labelSprite(text, { size = 34, color = '#e6f0ff', weight = 600, glow = null, faction = null } = {}) {
  const key = `${text}|${size}|${color}|${weight}|${glow}|${faction}`;
  let entry = labelCache.get(key);
  if (!entry) {
    const scale = 2;                       // doppelt gezeichnet, damit es scharf bleibt
    const pad = 7 * scale;
    const cv = document.createElement('canvas');
    const probe = cv.getContext('2d');
    const font = `${weight} ${size * scale}px "Chakra Petch", "Eurostile", "Bahnschrift", system-ui, sans-serif`;
    probe.font = font;
    // Links vom Namen steht das Wappen der Flagge - so sieht man, wem die
    // Welt gehört, ohne die Farbe deuten zu müssen.
    const glyphSize = faction ? size * scale * 1.3 : 0;
    const w = Math.ceil(probe.measureText(text).width) + pad * 2 + glyphSize;
    const h = size * scale + pad * 1.1;
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');
    g.font = font;
    g.textBaseline = 'middle';
    // Ein dunkler Grund unter der Schrift: über einem hellen Nebel wäre sie
    // sonst nicht zu lesen.
    g.fillStyle = 'rgba(4,9,18,0.55)';
    g.fillRect(0, 0, w, h);
    if (glow) {
      g.fillStyle = glow;
      g.fillRect(0, 0, 4 * scale, h);
    }
    g.shadowColor = 'rgba(0,0,0,0.95)';
    g.shadowBlur = 6 * scale;
    const left = pad + (glow ? 6 * scale : 0);
    if (faction) {
      drawFactionGlyph(g, faction, left + glyphSize * 0.45, h / 2, glyphSize * 0.5,
        factionProfile(faction).accent || factionProfile(faction).color);
    }
    g.fillStyle = color;
    g.fillText(text, left + glyphSize, h / 2 + 1);
    const tex = new THREE.CanvasTexture(cv);
    tex.needsUpdate = true;
    entry = { tex, w: w / scale, h: h / scale };
    labelCache.set(key, entry);
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: entry.tex, transparent: true, depthTest: false, depthWrite: false,
  }));
  sprite.userData.px = { w: entry.w, h: entry.h };
  sprite.renderOrder = 10;
  return sprite;
}

// Alle Schriftzüge einmal je Bild: Größe nach Entfernung, Sichtbarkeit nach
// Rang und Platz. Der Rang entscheidet, wer stehen bleibt, wenn zwei Namen
// einander überdecken.
const labelEntries = [];
function registerLabel(sprite, rank) {
  sprite.userData.rank = rank;
  labelEntries.push(sprite);
}
function forgetLabels(group) {
  for (let i = labelEntries.length - 1; i >= 0; i--) {
    let node = labelEntries[i];
    while (node && node !== group) node = node.parent;
    if (node === group) labelEntries.splice(i, 1);
  }
}

const _labelPos = new THREE.Vector3();
function layoutLabels() {
  if (!camera || !canvasEl) return;
  const height = canvasEl.clientHeight || 1;
  const width = canvasEl.clientWidth || 1;
  const fovScale = 2 * Math.tan((camera.fov * Math.PI) / 180 / 2) / height;
  // Aus der Ferne bleiben nur die wichtigen Namen stehen.
  if (battleMode) {
    for (const sprite of labelEntries) sprite.visible = false;
    return;
  }
  const minRank = cam.zoom > 2.2 ? 0 : cam.zoom > 1.4 ? 22 : cam.zoom > 0.95 ? 38 : 58;
  const taken = [];
  const sorted = labelEntries
    .filter((s) => s.parent && s.parent.visible)
    .sort((a, b) => (b.userData.rank || 0) - (a.userData.rank || 0));
  for (const sprite of sorted) {
    const px = sprite.userData.px;
    if ((sprite.userData.rank || 0) < minRank) { sprite.visible = false; continue; }
    sprite.getWorldPosition(_labelPos);
    const dist = camera.position.distanceTo(_labelPos);
    const unit = dist * fovScale;              // Welteinheiten je Bildpunkt
    sprite.scale.set(px.w * unit, px.h * unit, 1);
    _labelPos.project(camera);
    if (_labelPos.z > 1) { sprite.visible = false; continue; }
    const sx = (_labelPos.x * 0.5 + 0.5) * width;
    const sy = (-_labelPos.y * 0.5 + 0.5) * height;
    if (sx < -80 || sy < -40 || sx > width + 80 || sy > height + 40) { sprite.visible = false; continue; }
    // `center` sagt, wo der Anker in der Schachtel sitzt - danach richtet
    // sich, welchen Platz sie auf dem Schirm belegt.
    const rect = {
      x: sx - px.w * sprite.center.x,
      y: sy - px.h * (1 - sprite.center.y),
      w: px.w,
      h: px.h + 2,
    };
    let blocked = false;
    for (const r of taken) {
      if (rect.x < r.x + r.w && rect.x + rect.w > r.x && rect.y < r.y + r.h && rect.y + rect.h > r.y) {
        blocked = true;
        break;
      }
    }
    sprite.visible = !blocked;
    if (!blocked) taken.push(rect);
  }
}

// --- Die Karte aufbauen --------------------------------------------------
export function buildMap(state) {
  stateRef = state;
  mapGroup.clear();
  holoGroup.clear();
  fogMesh = null;
  territoryGroup = null;
  territoryStamp = null;
  fieldsGroup = null;
  fieldsStamp = null;
  if (mapTexture) mapTexture.dispose();
  mapTexture = drawMapTexture(state);
  mapMaterial = new THREE.MeshBasicMaterial({ map: mapTexture });
  buildTable();
  buildJumpPoints(state);
  buildBases(state);
  buildSystems(state);
  buildBridge(state);
  centerOnFaction(state);
}

// --- Startbasen -----------------------------------------------------------
// Eine Militärbasis, in einen Brocken gehauen: Kuppel, Mast und zwei
// Startröhren im Fels. Von hier starten Staffeln, wenn kein Träger da ist.
const baseNodes = [];

function asteroidBaseModel(colour) {
  const g = new THREE.Group();
  const rock = new THREE.MeshStandardMaterial({
    color: 0x6d6154, roughness: 0.95, metalness: 0.05, flatShading: true,
  });
  const steel = new THREE.MeshStandardMaterial({
    color: 0x5d6672, metalness: 0.75, roughness: 0.4, flatShading: true,
  });
  const lit = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.85 });
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(2.1, 0), rock);
  body.scale.set(1.25, 0.8, 1);
  body.rotation.set(0.3, 0.7, 0.2);
  g.add(body);
  // Die Anlage obenauf: Kuppel, Mast, zwei Startröhren im Fels.
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel);
  dome.position.y = 1.4;
  g.add(dome);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.88, 0.16, 12), lit);
  band.position.y = 1.42;
  g.add(band);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.5, 6), steel);
  mast.position.y = 2.4;
  g.add(mast);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({
    color: 0xff5a4a, transparent: true, opacity: 0.9,
  }));
  beacon.position.y = 3.2;
  beacon.name = 'feuer';
  g.add(beacon);
  for (const side of [-1, 1]) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.5, 8, 1, true), steel);
    tube.rotation.set(Math.PI / 2, 0, 0);
    tube.position.set(side * 1.3, 0.35, 1.1);
    g.add(tube);
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.32, 10), lit);
    mouth.position.set(side * 1.3, 0.35, 1.86);
    g.add(mouth);
  }
  return g;
}

function buildBases(state) {
  baseNodes.length = 0;
  for (const base of state.bases || []) {
    const { x, z } = worldOfTile(base.col, base.row);
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const model = asteroidBaseModel(0xffc98a);
    model.position.y = 3.2;
    model.scale.setScalar(0.85);
    group.add(model);
    // Ein dünner Halt zur Platte, wie ihn auch die Flotten haben.
    const tether = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 3, 5),
      new THREE.MeshBasicMaterial({ color: 0x8fb6dc, transparent: true, opacity: 0.3 }),
    );
    tether.position.y = 1.5;
    group.add(tether);
    const label = labelSprite(`◆ ${base.name}`, {
      size: 15, color: '#cfe2ff', glow: '#7fd4ff',
    });
    label.position.set(0, 0.9, 0);
    label.center.set(0.5, 1);
    group.add(label);
    registerLabel(label, 70);
    group.userData.base = base;
    group.userData.model = model;
    holoGroup.add(group);
    baseNodes.push(group);
  }
}

function animateBases(time) {
  for (const node of baseNodes) {
    const model = node.userData.model;
    if (!model) continue;
    if (model.userData.spin) model.userData.spin.rotation.z += 0.004;
    const beacon = model.getObjectByName('feuer');
    if (beacon) beacon.material.opacity = 0.35 + Math.abs(Math.sin(time * 2.6)) * 0.6;
    model.position.y += Math.sin(time * 0.7 + node.position.x) * 0.004;
  }
}

// Eine Sprungboje: kein Ring auf der Platte, sondern ein Seezeichen im Raum -
// Schwimmkörper, Mast mit Blinkfeuer, drei Warnrippen und ein Kranz, der
// langsam mitdreht. Man erkennt sie aus der Entfernung an ihrem Takt.
const jumpBuoys = [];

function jumpBuoy() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({
    color: 0x5a6675, metalness: 0.8, roughness: 0.35, flatShading: true,
  });
  const warn = new THREE.MeshBasicMaterial({ color: 0xffb765, transparent: true, opacity: 0.9 });
  const glass = new THREE.MeshBasicMaterial({
    color: 0x9fe4ff, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });

  // Der Schwimmkörper: ein Fass mit Kragen.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.85, 2.4, 10), steel);
  body.position.y = 3.4;
  g.add(body);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.34, 10), warn);
  collar.position.y = 4.3;
  g.add(collar);
  const keel = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.6, 8), steel);
  keel.rotation.x = Math.PI;
  keel.position.y = 1.5;
  g.add(keel);

  // Der Mast mit dem Feuer obenauf.
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.6, 6), steel);
  mast.position.y = 5.9;
  g.add(mast);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), glass);
  lamp.position.y = 7.4;
  lamp.name = 'feuer';
  g.add(lamp);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1.25, 10, 8), new THREE.MeshBasicMaterial({
    color: 0x7ad4ff, transparent: true, opacity: 0.28,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  halo.position.y = 7.4;
  halo.name = 'schein';
  g.add(halo);

  // Drei Warnrippen rund um das Fass.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.9), warn);
    fin.position.set(Math.cos(a) * 1.25, 3.4, Math.sin(a) * 1.25);
    fin.rotation.y = -a;
    g.add(fin);
  }

  // Der Kranz: das Tor selbst, waagerecht um die Boje.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(TILE_SIZE * 0.4, 0.28, 8, 24),
    new THREE.MeshBasicMaterial({
      color: 0x7ad4ff, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 3.4;
  ring.name = 'kranz';
  g.add(ring);
  return g;
}

function buildJumpPoints(state) {
  const lineMat = new THREE.LineDashedMaterial({
    color: 0x4f9fd0, dashSize: 6, gapSize: 5, transparent: true, opacity: 0.45,
  });
  jumpBuoys.length = 0;
  for (const jp of state.map.jumpPoints) {
    const a = worldOfTile(jp.a.col, jp.a.row);
    const b = worldOfTile(jp.b.col, jp.b.row);
    for (const p of [a, b]) {
      const buoy = jumpBuoy();
      buoy.scale.setScalar(1.35);
      buoy.position.set(p.x, 0, p.z);
      buoy.userData.phase = Math.random() * Math.PI * 2;
      buoy.userData.col = p === a ? jp.a.col : jp.b.col;
      buoy.userData.row = p === a ? jp.a.row : jp.b.row;
      holoGroup.add(buoy);
      jumpBuoys.push(buoy);
    }
    // Die Verbindung der beiden Enden: eine gestrichelte Linie über der
    // Karte, damit man sieht, wohin der Sprung führt.
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a.x, 3, a.z),
      new THREE.Vector3((a.x + b.x) / 2, 16, (a.z + b.z) / 2),
      new THREE.Vector3(b.x, 3, b.z),
    ]);
    const line = new THREE.Line(geo, lineMat);
    line.computeLineDistances();
    holoGroup.add(line);
  }
}

const systemMeshes = new Map();
// Alles, was man anklicken können soll: unsichtbare Körper an Welten und
// Verbänden. Ohne sie träfe der Zeiger die Tischplatte hinter dem Objekt.
const pickTargets = [];

// Wie wichtig ein Name ist - danach entscheidet sich, wer stehen bleibt.
function systemRank(sys) {
  let rank = sys.size * 10;
  if (sys.capital) rank += 45;
  if (sys.greatWork) rank += 20;
  if (stateRef && sys.factionId === stateRef.playerFactionId) rank += 25;
  return rank;
}

// Die Netze über den Schilden drehen sich langsam - ein Deflektor steht
// nicht still.
const shieldNets = [];
// Im Gefecht treten die Schilde der Nachbarwelten zurück: sonst steht das
// halbe Sonnensystem vor den Schiffen.
const shieldDomes = [];

function buildSystems(state) {
  systemMeshes.clear();
  shieldNets.length = 0;
  shieldDomes.length = 0;
  pickTargets.length = 0;
  labelEntries.length = 0;
  for (const sys of state.systems) {
    const group = new THREE.Group();
    const { x, z } = worldOfTile(sys.col, sys.row);
    group.position.set(x, 0, z);
    const tier = sizeTier(sys.size);
    const radius = 1.4 + sys.size * 0.55;
    // Die Welt steht hoch genug über der Platte, dass ihr Schild rundherum
    // Platz hat - vorher schnitt die Tischkante die Blase unten ab.
    const orbit = radius + 4.4;

    // Der Planet: eine Kugel über der Platte, in der Farbe des Besitzers.
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 18, 14),
      new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.8, metalness: 0.1 }),
    );
    planet.position.y = orbit;
    planet.name = 'planet';
    group.add(planet);

    // Der Besitzring auf der Platte darunter - er ist die eigentliche Flagge.
    const disc = new THREE.Mesh(
      new THREE.RingGeometry(radius + 1.4, radius + 2.6, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.6;
    disc.name = 'owner';
    group.add(disc);

    // Die Lichtsäule: sie macht ein System auf der weiten Karte auffindbar.
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 14 + sys.size * 2, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 }),
    );
    beam.position.y = (14 + sys.size * 2) / 2;
    beam.name = 'beam';
    group.add(beam);

    // Der Planetenschild: eine Blase, die die Welt wirklich umschließt, und
    // ein Netz darüber, an dem man den Deflektor erkennt. Beide schreiben
    // keine Tiefe - sonst frisst die eigene Rückseite die Vorderseite auf.
    const shieldGeo = new THREE.SphereGeometry(radius + 2.4, 20, 16);
    const shield = new THREE.Mesh(shieldGeo, new THREE.MeshBasicMaterial({
      color: 0x7fd4ff, transparent: true, opacity: 0.14,
      side: THREE.DoubleSide, depthWrite: false,
    }));
    shield.position.y = orbit;
    shield.name = 'shield';
    group.add(shield);
    shieldDomes.push(shield);
    const net = new THREE.Mesh(shieldGeo.clone(), new THREE.MeshBasicMaterial({
      color: 0xbfeaff, transparent: true, opacity: 0.18,
      wireframe: true, depthWrite: false,
    }));
    net.position.y = orbit;
    net.name = 'shieldnet';
    net.scale.setScalar(1.02);
    group.add(net);
    shieldNets.push(net);

    // Werftring: eine Scheibe um den Planeten, wenn dort gebaut wird. Sie
    // liegt flach im Orbit und bleibt damit innerhalb des Schildes.
    const yard = new THREE.Mesh(
      new THREE.TorusGeometry(radius + 1.5, 0.2, 6, 24),
      new THREE.MeshBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0.6 }),
    );
    yard.rotation.x = -Math.PI / 2 + 0.32;
    yard.position.y = orbit;
    yard.name = 'yard';
    group.add(yard);

    // Der Name steht unter der Welt: Farbstrich der Flagge, Stern für die
    // Hauptwelt, Raute für ein Großes Werk.
    const work = sys.greatWork ? GREAT_WORKS.find((w) => w.id === sys.greatWork) : null;
    const text = `${sys.name}${sys.capital ? ' ★' : ''}${work ? ' ◆' : ''}`;
    const label = labelSprite(text, {
      size: sys.capital ? 21 : 18,
      glow: factionProfile(sys.factionId).color,
      faction: sys.factionId,
    });
    // Der Anker sitzt über dem Feld, die Schrift hängt darunter - so steht
    // sie unter der Welt, gleich aus welcher Richtung man schaut.
    label.position.set(0, 1.2, 0);
    label.center.set(0.5, 1);
    label.name = 'label';
    group.add(label);
    registerLabel(label, systemRank(sys));

    // Ein unsichtbarer Fangkörper um den Planeten: er macht die Welt
    // anklickbar, ohne dass das Bild etwas davon merkt.
    const grab = new THREE.Mesh(
      new THREE.SphereGeometry(radius + 2.4, 10, 8),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    grab.position.y = radius + 2.5;
    grab.userData.tile = { col: sys.col, row: sys.row };
    grab.name = 'grab';
    group.add(grab);
    pickTargets.push(grab);

    group.userData.system = sys;
    mapGroup.add(group);
    systemMeshes.set(sys.id, group);
  }
  updateSystems(state);
}

// Was sich an einem System ändern kann, ändert sich hier: Besitzer, Schild,
// Werft, Belagerung, Sichtbarkeit.
export function updateSystems(state) {
  for (const sys of state.systems) {
    const group = systemMeshes.get(sys.id);
    if (!group) continue;
    // Nach einer Eroberung trägt der Name das neue Wappen.
    if (group.userData.labelFor !== sys.factionId) {
      group.userData.labelFor = sys.factionId;
      const old = group.getObjectByName('label');
      if (old) {
        forgetLabels(old);
        group.remove(old);
      }
      const work = sys.greatWork ? GREAT_WORKS.find((w) => w.id === sys.greatWork) : null;
      const label = labelSprite(`${sys.name}${sys.capital ? ' ★' : ''}${work ? ' ◆' : ''}`, {
        size: sys.capital ? 21 : 18,
        glow: factionProfile(sys.factionId).color,
        faction: sys.factionId,
      });
      label.position.set(0, 1.2, 0);
      label.center.set(0.5, 1);
      label.name = 'label';
      group.add(label);
      registerLabel(label, systemRank(sys));
    }
    const profile = factionProfile(sys.factionId);
    const seen = hasSeen(state, sys.col, sys.row);
    const colour = new THREE.Color(profile.color);
    group.visible = seen && !battleMode;
    const planet = group.getObjectByName('planet');
    const owner = group.getObjectByName('owner');
    const beam = group.getObjectByName('beam');
    const shield = group.getObjectByName('shield');
    const yard = group.getObjectByName('yard');
    if (planet) {
      // Im Besitzmodus trägt der Planet die Farbe der Flagge, sonst seine
      // eigene - so kann man die Karte lesen wie eine politische Karte.
      planet.material.color.set(mapMode === 'besitz' ? colour
        : new THREE.Color().setHSL(((sys.name.length * 37) % 100) / 100, 0.32, 0.55));
      planet.material.emissive = new THREE.Color(profile.colorDark);
      planet.material.emissiveIntensity = sys.siege ? 0.9 : 0.35;
    }
    if (owner) owner.material.color.set(colour);
    if (beam) {
      beam.material.color.set(colour);
      beam.material.opacity = sys.capital ? 0.3 : 0.16;
    }
    if (shield) {
      shield.userData.want = sys.shield.level > 0;
      shield.visible = shield.userData.want && !battleMode;
      shield.material.opacity = Math.max(0.04, 0.16 * (1 - sys.shield.down))
        * (1 + sys.shield.level * 0.15);
      shield.material.color.set(sys.shield.down > 0.5 ? 0xff9a6a : 0x7fd4ff);
    }
    const net = group.getObjectByName('shieldnet');
    if (net) {
      net.userData.want = sys.shield.level > 0;
      net.visible = net.userData.want && !battleMode;
      net.material.opacity = Math.max(0.05, 0.2 * (1 - sys.shield.down));
      net.material.color.set(sys.shield.down > 0.5 ? 0xffc2a0 : 0xbfeaff);
    }
    if (yard) {
      const werft = sys.buildings.werft;
      yard.visible = !!(werft && werft.level);
      if (yard.visible) yard.material.opacity = 0.3 + (werft.level * 0.14);
    }
  }
}

// --- Flotten, Auswahl, Reichweiten --------------------------------------
const fleetMeshes = new Map();

// Wie lang ein Schiff auf dem Kartentisch liegt. Ein Jäger misst gut ein
// halbes Feld, ein Träger anderthalb - so sieht man an der Silhouette, was
// da fliegt, bevor man die Flotte anklickt.
const MAP_SHIP_LENGTH = {
  jaeger: 4.3, bomber: 4.6, korvette: 5.6, kreuzer: 7, traeger: 9.1, marines: 4.6, wache: 4.8,
};

function fleetMesh(fleet) {
  const profile = factionProfile(fleet.factionId);
  const group = new THREE.Group();
  const colour = new THREE.Color(profile.color);

  // Die Flotte zeigt ihr schwerstes Schiff: der Träger führt, wenn einer
  // dabei ist, sonst der Kreuzer, sonst die Korvette - und ganz unten die
  // Jägerstaffel allein.
  const role = flagshipRole(fleet);
  const scale = MAP_SHIP_LENGTH[role] / SHIP_LENGTH[role];
  const flagship = shipModel(profile.kind, role, profile.color, profile.accent, { scale });
  flagship.position.y = 5;
  flagship.name = 'flagship';
  group.add(flagship);
  group.userData.role = role;

  // Ein weicher Schein hinter dem Schiff: er macht den Verband auf der weiten
  // Karte auffindbar, ohne die Silhouette zu überstrahlen.
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(MAP_SHIP_LENGTH[role] * 0.42, 20),
    new THREE.MeshBasicMaterial({
      color: colour, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 3.6;
  group.add(halo);

  // Zwei Begleiter daneben, wenn die Flotte auch Jäger führt: ein Träger
  // fliegt nicht allein.
  const hasFighters = fleet.units.some((u) => (u.role === 'jaeger' || u.role === 'bomber') && u.count > 0);
  if (hasFighters && role !== 'jaeger') {
    const escortRole = fleet.units.some((u) => u.role === 'jaeger' && u.count > 0) ? 'jaeger' : 'bomber';
    const escortScale = (MAP_SHIP_LENGTH[escortRole] / SHIP_LENGTH[escortRole]) * 0.6;
    for (const side of [-1, 1]) {
      const escort = shipModel(profile.kind, escortRole, profile.color, profile.accent,
        { scale: escortScale, detail: 'low' });
      escort.position.set(side * 2.6, 4.2, -1.8);
      escort.rotation.y = side * 0.12;
      group.add(escort);
    }
  }

  // Ein dünner Halt zur Platte hinunter, damit man sieht, auf welchem Feld
  // der Verband steht.
  const tether = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 4.5, 5),
    new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.35 }),
  );
  tether.position.y = 2.4;
  group.add(tether);
  // Der Schatten auf der Platte: ein Ring, der sagt, auf welchem Feld die
  // Flotte steht.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(TILE_SIZE * 0.3, TILE_SIZE * 0.4, 20),
    new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.8;
  ring.name = 'ring';
  group.add(ring);

  const count = labelSprite(String(fleetTotalCount(fleet)), {
    size: 17, glow: profile.color, color: '#f2f7ff',
  });
  count.position.set(0, 9.5, 0);
  count.center.set(0.5, 0);
  count.name = 'count';
  group.add(count);
  // Flotten stehen über den Namen der Welten: man sucht auf der Karte nach
  // Verbänden, nicht nach Ortsnamen.
  registerLabel(count, 120);

  // Der Fangkörper der Flotte - groß genug für den Zeiger, klein genug, dass
  // er dem Nachbarfeld nichts wegnimmt.
  const grab = new THREE.Mesh(
    new THREE.SphereGeometry(3.4, 10, 8),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  grab.position.y = 5;
  grab.name = 'grab';
  group.add(grab);

  return group;
}

export function syncEntities(state, view = {}) {
  stateRef = state;
  const seenIds = new Set();
  for (const fleet of state.fleets) {
    // Fremde Flotten sieht man nur, wo die eigenen Sensoren hinreichen.
    const visible = fleet.factionId === state.playerFactionId
      || (view.visibleFleets ? view.visibleFleets.has(fleet.id) : hasSeen(state, fleet.col, fleet.row));
    let mesh = fleetMeshes.get(fleet.id);
    // Ist das Flaggschiff gefallen, wird das Modell neu gebaut: eine Flotte
    // ohne Träger soll auch keinen mehr zeigen.
    if (mesh && mesh.userData.role !== flagshipRole(fleet)) {
      entityGroup.remove(mesh);
      fleetMeshes.delete(fleet.id);
      mesh = null;
    }
    if (!mesh) {
      mesh = fleetMesh(fleet);
      // Ein neuer Verband liegt nicht auf Nordkurs, sondern schaut dorthin,
      // wo es etwas zu tun gibt: zur nächsten fremden Welt.
      const foe = state.systems
        .filter((sys) => sys.factionId !== fleet.factionId)
        .sort((a, b) => (Math.abs(a.col - fleet.col) + Math.abs(a.row - fleet.row))
          - (Math.abs(b.col - fleet.col) + Math.abs(b.row - fleet.row)))[0];
      if (foe) {
        const here = worldOfTile(fleet.col, fleet.row);
        const there = worldOfTile(foe.col, foe.row);
        mesh.rotation.y = Math.atan2(there.x - here.x, there.z - here.z);
        mesh.userData.heading = mesh.rotation.y;
      }
      fleetMeshes.set(fleet.id, mesh);
      entityGroup.add(mesh);
      const grab = mesh.getObjectByName('grab');
      if (grab) {
        grab.userData.tile = { col: fleet.col, row: fleet.row };
        pickTargets.push(grab);
      }
    }
    const grab = mesh.getObjectByName('grab');
    if (grab) grab.userData.tile = { col: fleet.col, row: fleet.row };
    seenIds.add(fleet.id);
    mesh.visible = visible;
    if (!visible) continue;
    const { x, z } = worldOfTile(fleet.col, fleet.row);
    // Steht die Flotte über einem System, rückt sie zur Seite: sonst
    // verschwindet der Verband im Planeten.
    const overSystem = systemAt(state, fleet.col, fleet.row);
    const shift = overSystem ? TILE_SIZE * 0.52 : 0;
    if (!mesh.userData.animating) mesh.position.set(x + shift, 0, z + shift);
    // Mehrere Flotten auf einem Feld stehen versetzt, sonst stecken sie
    // ineinander.
    const stack = fleetsAt(state, fleet.col, fleet.row);
    const idx = stack.indexOf(fleet);
    if (stack.length > 1 && !mesh.userData.animating) {
      mesh.position.x += (idx - (stack.length - 1) / 2) * 1.8;
      mesh.position.z += (idx % 2) * 1.6;
    }
    const total = fleetTotalCount(fleet);
    if (mesh.userData.count !== total) {
      mesh.userData.count = total;
      const old = mesh.getObjectByName('count');
      if (old) {
        forgetLabels(old);
        mesh.remove(old);
      }
      const count = labelSprite(String(total), {
        size: 17, glow: factionProfile(fleet.factionId).color, color: '#f2f7ff',
      });
      count.position.set(0, 9.5, 0);
      count.center.set(0.5, 0);
      count.name = 'count';
      mesh.add(count);
      registerLabel(count, 120);
    }
    const ring = mesh.getObjectByName('ring');
    if (ring) {
      const selected = view.selectedFleetId === fleet.id;
      ring.material.opacity = selected ? 1 : 0.5;
      ring.scale.setScalar(selected ? 1.25 : 1);
    }
    // Die Spitze zeigt, wohin die Flotte zuletzt flog - ein Verband hat eine
    // Richtung, auch wenn er steht.
    if (fleet.stance === 'belagern' || fleet.stance === 'blockade') {
      mesh.rotation.y += 0.004;
    }
  }
  for (const [id, mesh] of fleetMeshes) {
    if (seenIds.has(id)) continue;
    const grab = mesh.getObjectByName('grab');
    if (grab) {
      const idx = pickTargets.indexOf(grab);
      if (idx >= 0) pickTargets.splice(idx, 1);
    }
    forgetLabels(mesh);
    entityGroup.remove(mesh);
    fleetMeshes.delete(id);
  }
  updateSystems(state);
  buildTerritory(state);
  buildSpaceFields(state);
  updateFogOfWar(state);
  drawOverlay(state, view);
}

// Reichweite, Ziele, Fluglinie und die Marken für Belagerung und Blockade.
function drawOverlay(state, view) {
  overlayGroup.clear();
  if (!guidesVisible) return;

  if (view.reach && view.reach.size) {
    const geo = new THREE.PlaneGeometry(TILE_SIZE * 0.82, TILE_SIZE * 0.82);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x69b7ff, transparent: true, opacity: 0.3, depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, view.reach.size);
    const dummy = new THREE.Object3D();
    let i = 0;
    for (const key of view.reach.keys()) {
      const [col, row] = key.split(',').map(Number);
      const { x, z } = worldOfTile(col, row);
      dummy.position.set(x, 1.1, z);
      dummy.rotation.x = -Math.PI / 2;
      dummy.updateMatrix();
      mesh.setMatrixAt(i++, dummy.matrix);
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    overlayGroup.add(mesh);
  }

  if (view.attacks && view.attacks.size) {
    for (const key of view.attacks.keys()) {
      const [col, row] = key.split(',').map(Number);
      const { x, z } = worldOfTile(col, row);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(TILE_SIZE * 0.34, TILE_SIZE * 0.52, 4),
        new THREE.MeshBasicMaterial({ color: 0xff6b52, transparent: true, opacity: 0.92, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.rotation.z = Math.PI / 4;
      ring.position.set(x, 1.3, z);
      overlayGroup.add(ring);
    }
  }

  if (view.path && view.path.length > 1) {
    const points = view.path.map((p) => {
      const { x, z } = worldOfTile(p.col, p.row);
      return new THREE.Vector3(x, 3.4, z);
    });
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0.9 }),
    );
    overlayGroup.add(line);
    const last = points[points.length - 1];
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(TILE_SIZE * 0.24, TILE_SIZE * 0.34, 18),
      new THREE.MeshBasicMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(last.x, 1.5, last.z);
    overlayGroup.add(marker);
  }

  if (view.selectedTile) {
    const { x, z } = worldOfTile(view.selectedTile.col, view.selectedTile.row);
    const box = new THREE.Mesh(
      new THREE.RingGeometry(TILE_SIZE * 0.44, TILE_SIZE * 0.52, 4),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    box.rotation.x = -Math.PI / 2;
    box.rotation.z = Math.PI / 4;
    box.position.set(x, 1.6, z);
    overlayGroup.add(box);
  }

  // Belagerte und blockierte Systeme bekommen einen Ring aus Strichen.
  for (const sys of state.systems) {
    if (!sys.siege && !sys.blockade) continue;
    if (!hasSeen(state, sys.col, sys.row)) continue;
    const { x, z } = worldOfTile(sys.col, sys.row);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(TILE_SIZE * 0.55, TILE_SIZE * 0.66, 16, 1, 0, Math.PI * 1.6),
      new THREE.MeshBasicMaterial({
        color: sys.siege ? 0xff7a4f : 0xffd166, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 1.2, z);
    overlayGroup.add(ring);
  }
}

// --- Das Dunkel ----------------------------------------------------------
// Was die eigenen Sensoren nie erreicht haben, liegt unter einer schwarzen
// Decke: die Karte zeigt es erst, wenn jemand dort war.
let fogMesh = null;
export function updateFogOfWar(state) {
  if (!fogMesh) {
    const geo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x060c18, transparent: true, opacity: 0.76, depthWrite: false,
    });
    fogMesh = new THREE.InstancedMesh(geo, mat, GRID_COLS * GRID_ROWS);
    fogMesh.frustumCulled = false;
    mapGroup.add(fogMesh);
  }
  const dummy = new THREE.Object3D();
  let i = 0;
  for (const tile of state.map.tiles) {
    if (hasSeen(state, tile.col, tile.row)) continue;
    const { x, z } = worldOfTile(tile.col, tile.row);
    dummy.position.set(x, 0.9, z);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.updateMatrix();
    fogMesh.setMatrixAt(i++, dummy.matrix);
  }
  fogMesh.count = i;
  fogMesh.instanceMatrix.needsUpdate = true;
}

// Ein kurzes Aufblitzen auf einem Feld - für Treffer, Funde, Meldungen.
export function flashTile(col, row, color = 0xffd166) {
  const { x, z } = worldOfTile(col, row);
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(1, TILE_SIZE * 0.7, 20),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 2, z);
  overlayGroup.add(mesh);
  const start = performance.now();
  const step = () => {
    const t = (performance.now() - start) / 700;
    if (t >= 1) { overlayGroup.remove(mesh); return; }
    mesh.scale.setScalar(1 + t * 1.6);
    mesh.material.opacity = 0.9 * (1 - t);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// --- Die Kamera -----------------------------------------------------------
// Sie kreist um ein Feld der Karte. Flach heißt Brücke, steil heißt Karte;
// dazwischen liegt der Blick, in dem man beides sieht.
function applyCamera() {
  const dist = BASE_DISTANCE / cam.zoom;
  const target = worldOfTile(cam.col, cam.row);
  const sinP = Math.sin(cam.polar);
  camera.position.set(
    target.x + dist * sinP * Math.cos(cam.azimuth),
    dist * Math.cos(cam.polar) + 12,
    target.z + dist * sinP * Math.sin(cam.azimuth),
  );
  camera.lookAt(target.x, cam.lookY, target.z);
  // Steigt die Kamera über die Decke, wird sie ausgeblendet: sonst schaut man
  // von oben auf ein geschlossenes Dach und sieht seine eigene Karte nicht.
  if (ceilingMesh) ceilingMesh.visible = camera.position.y < ceilingMesh.position.y - 14;
}

export function centerOn(col, row, immediate = true) {
  cam.col = Math.max(0, Math.min(GRID_COLS - 1, col));
  cam.row = Math.max(0, Math.min(GRID_ROWS - 1, row));
  applyCamera();
}

export function centerOnFaction(state) {
  const home = state.systems.find((s) => s.factionId === state.playerFactionId && s.capital)
    || state.systems.find((s) => s.factionId === state.playerFactionId);
  if (home) centerOn(home.col, home.row);
  else centerOn(GRID_COLS / 2, GRID_ROWS / 2);
}

export function zoomCamera(factor) {
  cam.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom * factor));
  applyCamera();
}

export function rotateCamera(dAzimuth, dPolar) {
  cam.azimuth += dAzimuth;
  cam.polar = Math.max(MIN_POLAR, Math.min(MAX_POLAR, cam.polar + dPolar));
  applyCamera();
}

export function resetCameraOrientation() {
  cam.azimuth = DEFAULT_AZIMUTH;
  cam.polar = DEFAULT_POLAR;
  applyCamera();
}

// Schwenken in Bildschirmrichtung: was rechts liegt, kommt nach links,
// gleich wie die Kamera gedreht ist.
export function panCameraRelative(dx, dy) {
  const forward = new THREE.Vector3(Math.cos(cam.azimuth), 0, Math.sin(cam.azimuth));
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  const scale = 0.6 / cam.zoom;
  const worldDx = right.x * dx * scale + forward.x * dy * scale;
  const worldDz = right.z * dx * scale + forward.z * dy * scale;
  cam.col = Math.max(0, Math.min(GRID_COLS - 1, cam.col + worldDx / TILE_SIZE));
  cam.row = Math.max(0, Math.min(GRID_ROWS - 1, cam.row + worldDz / TILE_SIZE));
  applyCamera();
}

// Die Eröffnungsansicht: weit genug zurück, dass die ganze Brücke mit dem
// Tisch darin im Bild liegt - die erste Einstellung eines Feldzugs.
export function setOpeningView() {
  cam.zoom = MIN_ZOOM;
  cam.polar = 1.05;
  cam.azimuth = Math.PI / 2 + 0.35;
  cam.col = GRID_COLS / 2;
  cam.row = GRID_ROWS / 2;
  applyCamera();
}

export function cameraState() {
  return { ...cam };
}

// Die Kamera von außen setzen - dafür gibt es keinen Knopf im Spiel, aber
// ein Prüflauf muss einen bestimmten Blick einnehmen können.
export function setCamera({ azimuth, polar, zoom, col, row, lookY } = {}) {
  if (azimuth != null) cam.azimuth = azimuth;
  if (polar != null) cam.polar = Math.max(MIN_POLAR, Math.min(MAX_POLAR, polar));
  if (zoom != null) cam.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  if (col != null) cam.col = col;
  if (row != null) cam.row = row;
  if (lookY != null) cam.lookY = lookY;
  applyCamera();
}

// Für das Gefecht: die Kamera geht heran und danach wieder zurück.
export function zoomTo(value, ms = 400) {
  const from = cam.zoom;
  const to = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
  const start = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / ms);
      cam.zoom = from + (to - from) * (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
      applyCamera();
      render();
      if (t >= 1) { resolve(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// Wohin auf dem Bildschirm Norden zeigt - die Kompassrose hängt daran.
export function northOnScreen() {
  return -cam.azimuth - Math.PI / 2;
}

export function setMapMode(mode) {
  mapMode = mode;
  if (stateRef) updateSystems(stateRef);
}
export function getMapMode() { return mapMode; }

export function setGuidesVisible(on) { guidesVisible = !!on; }
// Der Gefechtsmodus: Beschriftungen und Kartenmarken aus, damit die
// Einstellung dem Gefecht gehört und nicht dem Atlas.
export function setBattleMode(on, focus = null) {
  battleMode = !!on;
  if (overlayGroup) overlayGroup.visible = !battleMode;
  if (territoryGroup) territoryGroup.visible = bordersVisible && !battleMode;
  // Die Flottenmarken der Karte treten ab: im Gefecht stehen die echten
  // Verbände auf dem Feld, und zwei Träger übereinander sieht niemand gern.
  for (const mesh of fleetMeshes.values()) mesh.visible = !battleMode;
  for (const mesh of [...shieldDomes, ...shieldNets]) {
    mesh.visible = !!mesh.userData.want && !battleMode;
  }
  // Im Gefecht bleibt nur der Schauplatz stehen: die Welt, um die gekämpft
  // wird, die Station daneben, die Boje im Feld - der Rest der Galaxis
  // wartet, bis es vorbei ist.
  const near = (col, row) => !focus
    || Math.max(Math.abs(col - focus.col), Math.abs(row - focus.row)) <= 2;
  for (const [, group] of systemMeshes) {
    const sys = group.userData.system;
    if (!sys) continue;
    const seen = stateRef ? hasSeen(stateRef, sys.col, sys.row) : true;
    group.visible = battleMode ? (seen && near(sys.col, sys.row)) : seen;
  }
  for (const node of baseNodes) {
    const base = node.userData.base;
    node.visible = !battleMode || near(base.col, base.row);
  }
  for (const buoy of jumpBuoys) {
    buoy.visible = !battleMode || near(buoy.userData.col, buoy.userData.row);
  }
  if (!battleMode) layoutLabels();
}

export function setBordersVisible(on) {
  bordersVisible = !!on;
  if (territoryGroup) territoryGroup.visible = bordersVisible;
}
export function areBordersVisible() { return bordersVisible; }
export function setStarsVisible(on) {
  starsVisible = !!on;
  if (starGroup) starGroup.visible = starsVisible;
}
export function setBridgeVisible(on) {
  bridgeVisible = !!on;
  if (bridgeGroup) bridgeGroup.visible = bridgeVisible;
  if (stateRef && bridgeVisible && bridgeGroup.children.length === 0) buildBridge(stateRef);
}
export function isBridgeVisible() { return bridgeVisible; }

// --- Zeigen und Treffen ---------------------------------------------------
// Vom Mauszeiger auf ein Feld: ein Strahl durch die Kamera auf die
// Tischplatte, und dann zurückgerechnet auf Spalte und Zeile.
export function pickTile(clientX, clientY) {
  if (!canvasEl || !camera) return null;
  const rect = canvasEl.getBoundingClientRect();
  pointerVec.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerVec.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerVec, camera);

  // Zwei Antworten kommen in Frage: das Feld, auf das der Strahl fällt, und
  // das Feld eines Objekts, das im Weg steht. Steht auf dem Feld unter dem
  // Zeiger selbst etwas - eine Welt, ein Verband -, dann ist es gemeint;
  // sonst gilt das Objekt, auf das man zeigt.
  const hits = raycaster.intersectObjects(pickTargets, false);
  let viaObject = null;
  for (const hit of hits) {
    const tile = hit.object.userData.tile;
    if (!tile) continue;
    if (hit.object.parent && hit.object.parent.visible === false) continue;
    viaObject = { col: tile.col, row: tile.row };
    break;
  }

  const point = new THREE.Vector3();
  const onPlane = raycaster.ray.intersectPlane(mapPlane, point)
    ? tileOfWorld(point.x, point.z) : null;
  const valid = (t) => t && t.col >= 0 && t.row >= 0 && t.col < GRID_COLS && t.row < GRID_ROWS;
  if (valid(onPlane) && stateRef) {
    const busy = systemAt(stateRef, onPlane.col, onPlane.row)
      || fleetsAt(stateRef, onPlane.col, onPlane.row).length;
    if (busy) return onPlane;
  }
  if (viaObject) return viaObject;
  return valid(onPlane) ? onPlane : null;
}

// Wo ein Feld auf dem Bildschirm liegt - für Beschriftungen im HUD.
export function tileToScreen(col, row) {
  if (!camera || !canvasEl) return null;
  const { x, z } = worldOfTile(col, row);
  const v = new THREE.Vector3(x, 0, z).project(camera);
  const rect = canvasEl.getBoundingClientRect();
  return {
    x: (v.x * 0.5 + 0.5) * rect.width,
    y: (-v.y * 0.5 + 0.5) * rect.height,
    behind: v.z > 1,
  };
}

export function resize() {
  if (!renderer || !camera || !canvasEl) return;
  const w = canvasEl.clientWidth || window.innerWidth;
  const h = canvasEl.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  applyCamera();
}

export function render() {
  if (!renderer || !scene || !camera) return;
  const now = performance.now();
  animateFields(now);
  animateBuoys(now / 1000);
  animateBases(now / 1000);
  animateShields(now / 1000);
  layoutLabels();
  if (postFX) postFX.render(scene, camera);
  else renderer.render(scene, camera);
}

export function captureFrame() {
  if (!renderer) return null;
  render();
  try {
    return renderer.domElement.toDataURL('image/png');
  } catch (err) {
    return null;
  }
}

export function isAnimating() {
  return animating;
}

// --- Der Flug -------------------------------------------------------------
// Eine Flotte zieht nicht von Feld zu Feld, sie fliegt: das Modell wandert
// den Weg entlang, dreht sich in die Flugrichtung, und am Sprungpunkt
// verschwindet es und kommt drüben wieder heraus.
function tileWorldPoint(step) {
  const { x, z } = worldOfTile(step.col, step.row);
  return new THREE.Vector3(x, 0, z);
}

// Ein Weg über ein Gitter ist eine Treppe: rechts, hoch, rechts, hoch. Wer
// so fliegt, zappelt. Also wird der Weg vorher geglättet - die Ecken werden
// in mehreren Durchgängen weggemittelt, Anfang und Ende bleiben, wo sie
// sind. Danach ist es eine Bahn und keine Treppe mehr.
function smoothPath(points, rounds = 4) {
  let out = points.map((p) => p.clone());
  for (let r = 0; r < rounds; r++) {
    const next = out.map((p) => p.clone());
    for (let i = 1; i < out.length - 1; i++) {
      next[i].set(
        (out[i - 1].x + out[i].x * 2 + out[i + 1].x) / 4,
        0,
        (out[i - 1].z + out[i].z * 2 + out[i + 1].z) / 4,
      );
    }
    out = next;
  }
  return out;
}

// Ein Flugabschnitt: der Verband folgt einer weichen Kurve durch den
// geglätteten Weg - und seine Nase zeigt dabei immer dorthin, wo er
// tatsächlich hinfliegt, nicht dorthin, wo die Kurve gerade zeigt.
function flyCurve(mesh, points, speed) {
  return new Promise((resolve) => {
    const raw = points.map(tileWorldPoint);
    // Zwischenpunkte einschieben: eine Treppe aus wenigen Stufen lässt sich
    // erst glätten, wenn sie genug Stützstellen hat.
    const dense = [];
    for (let i = 0; i < raw.length - 1; i++) {
      dense.push(raw[i]);
      dense.push(raw[i].clone().lerp(raw[i + 1], 0.5));
    }
    dense.push(raw[raw.length - 1]);
    const pts = smoothPath(dense, 5);
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const length = Math.max(1, curve.getLength());
    const duration = Math.max(320, (length * 26) / Math.max(0.2, speed));
    const start = performance.now();
    const pos = new THREE.Vector3();
    const prev = new THREE.Vector3();
    curve.getPointAt(0, prev);
    let yaw = mesh.rotation.y;
    let bank = 0;
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / duration);
      curve.getPointAt(t, pos);
      const dx = pos.x - prev.x;
      const dz = pos.z - prev.z;
      mesh.position.set(pos.x, Math.sin(t * Math.PI) * 1.2, pos.z);
      // Kurs aus der wirklichen Bewegung, weich nachgezogen. Ein Verband
      // dreht nicht auf der Stelle und schwenkt nicht hin und her.
      if (dx * dx + dz * dz > 1e-8) {
        const want = Math.atan2(dx, dz);
        let delta = want - yaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        yaw += delta * 0.1;
        bank += (Math.max(-0.4, Math.min(0.4, -delta * 9)) - bank) * 0.1;
        mesh.rotation.y = yaw;
        mesh.rotation.z = bank;
      }
      prev.copy(pos);
      render();
      if (t >= 1) {
        mesh.rotation.z = 0;
        mesh.rotation.y = yaw;
        mesh.userData.heading = yaw;
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// Der Sprungpunkt: klein werden, verschwinden, drüben wieder herauskommen.
function jumpLeg(mesh, target, speed) {
  return new Promise((resolve) => {
    const to = tileWorldPoint(target);
    const from = mesh.position.clone();
    const duration = 620 / Math.max(0.2, speed);
    const start = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / duration);
      if (t < 0.5) {
        mesh.scale.setScalar(Math.max(0.02, 1 - t * 2));
        mesh.position.copy(from);
      } else {
        mesh.scale.setScalar(Math.max(0.02, (t - 0.5) * 2));
        mesh.position.copy(to);
      }
      render();
      if (t >= 1) {
        mesh.scale.setScalar(1);
        mesh.position.copy(to);
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// --- Der Flug -------------------------------------------------------------
// Eine Flotte zieht nicht von Feld zu Feld, sie fliegt: eine Kurve durch die
// Felder ihres Weges, unterbrochen nur dort, wo ein Sprungpunkt sie
// versetzt.
export function animateFleet(fleetId, path, { speed = 1, onStep = null } = {}) {
  const mesh = fleetMeshes.get(fleetId);
  if (!mesh || !path || path.length < 2) return Promise.resolve();
  animating = true;
  mesh.userData.animating = true;

  // In Abschnitte zerlegen: ein Sprung unterbricht den Flug.
  const segments = [];
  let current = [path[0]];
  for (let i = 1; i < path.length; i++) {
    if (path[i].jump) {
      segments.push({ points: current, jumpTo: path[i] });
      current = [path[i]];
    } else {
      current.push(path[i]);
    }
  }
  segments.push({ points: current, jumpTo: null });

  const run = async () => {
    for (const seg of segments) {
      if (seg.points.length > 1) await flyCurve(mesh, seg.points, speed);
      if (seg.jumpTo) {
        await jumpLeg(mesh, seg.jumpTo, speed);
        if (onStep) onStep(seg.jumpTo);
      }
    }
    const last = path[path.length - 1];
    if (onStep) onStep(last);
    mesh.userData.animating = false;
    animating = false;
    render();
  };
  return run();
}

// Der Blick auf ein Feld, weich statt sprunghaft: die Kamera zieht hinüber.
export function glideTo(col, row, ms = 500) {
  return new Promise((resolve) => {
    const startCol = cam.col;
    const startRow = cam.row;
    const start = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / ms);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      cam.col = startCol + (col - startCol) * ease;
      cam.row = startRow + (row - startRow) * ease;
      applyCamera();
      render();
      if (t >= 1) { resolve(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export function sceneHandles() {
  return { scene, camera, renderer, entityGroup, overlayGroup, worldOfTile };
}
