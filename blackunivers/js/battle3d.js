// --- Das Gefecht auf der Karte -------------------------------------------
// Es gibt keinen zweiten Bildschirm: gekämpft wird dort, wo die Flotten
// stehen. Der Bericht aus `combat.js` ist die Partitur - jede Runde wird
// geflogen, und zwar langsam genug, dass man mitliest: Anflug, Leuchtspuren,
// Torpedoläufe, Einschläge, Wracks. Die Kamera geht dabei so dicht heran,
// dass man die Rümpfe erkennt, und zieht in großer Ruhe um das Feld.
import {
  sceneHandles, worldOfTile, TILE_SIZE, flashTile, glideTo, cameraState, setCamera,
  setBattleMode,
} from './scene3d.js';
import { factionProfile, ROLE_SHORT } from './data.js';
import { shipModel, torpedoModel, SHIP_LENGTH } from './ships3d.js';
import { sfx } from './audio.js';

let running = false;
let cancelled = false;
let group = null;
// Das eine Licht, das im Gefecht mitwandert und bei jedem Schuss aufflammt.
let battleLight = null;

function ensureGroup() {
  const { scene } = sceneHandles();
  if (!scene) return null;
  if (!group) {
    group = new THREE.Group();
    group.name = 'gefecht';
    scene.add(group);
  }
  return group;
}

// Geometrien, die in jedem Gefecht dutzendfach gebraucht werden, entstehen
// einmal und bleiben. Sie sind als `shared` gezeichnet, damit das Aufräumen
// sie in Ruhe lässt.
const geoCache = new Map();
function sharedGeo(key, make) {
  let geo = geoCache.get(key);
  if (!geo) {
    geo = make();
    geo.userData.shared = true;
    geoCache.set(key, geo);
  }
  return geo;
}

function disposeTree(node) {
  node.traverse((n) => {
    if (n.geometry && !n.geometry.userData.shared) n.geometry.dispose();
    if (n.material) {
      if (Array.isArray(n.material)) n.material.forEach((m) => m.dispose());
      else n.material.dispose();
    }
  });
}

// Ein Effekt räumt sich selbst ab: Netz raus, eigenes Material weg, geteilte
// Geometrie bleibt liegen.
function kill(node) {
  if (!node || !node.parent) return;
  node.parent.remove(node);
  disposeTree(node);
}

function clearGroup() {
  effects.length = 0;
  torpedoes.length = 0;
  if (battleLight) { battleLight.intensity = 0; battleLight = null; }
  if (!group) return;
  while (group.children.length) {
    const child = group.children.pop();
    // Schiffsmodelle sind Klone aus dem Zwischenspeicher: sie teilen sich
    // Geometrie und Werkstoff mit dem Original und dürfen nie freigegeben
    // werden, sonst steht das nächste Gefecht ohne Rümpfe da.
    if (child.userData && child.userData.ship) continue;
    disposeTree(child);
  }
}

// Wie groß ein Schiff im Gefecht auf der Karte steht. Die Kamera ist nah
// dran, also dürfen die Kiele Platz beanspruchen: ein Jäger misst ein halbes
// Feld, ein Träger anderthalb.
const FIGHT_LENGTH = {
  jaeger: 2.5, bomber: 3.0, korvette: 3.8, kreuzer: 5.1, traeger: 6.7, marines: 3.0, wache: 3.4,
};

// Ein Schiff im Gefecht. Es trägt dieselbe Silhouette wie auf der Karte -
// nur fliegt es hier seine eigene Bahn, und aus der Nähe zählt jedes Licht.
function makeFighter(kind, role, profile, heading) {
  const scale = FIGHT_LENGTH[role] / SHIP_LENGTH[role];
  const mesh = shipModel(kind, role, profile.color, profile.accent, { scale });
  mesh.rotation.y = heading;
  mesh.userData.ship = true;
  return mesh;
}

// Womit eine Seite ins Gefecht geht: die Verbände, die sie wirklich hat, vom
// schwersten zum leichtesten - Träger einmal, Jäger so oft wie nötig.
function battleRoles(units, slots) {
  const order = ['traeger', 'kreuzer', 'korvette', 'bomber', 'marines', 'jaeger', 'wache'];
  const present = order.filter((r) => units.some((u) => u.role === r && u.count > 0));
  if (!present.length) return new Array(slots).fill('jaeger');
  const out = [];
  for (const role of present) {
    // Große Kiele einmal, kleine nach Zahl - so steht ein Träger zwischen
    // seinen Staffeln und nicht zehnmal nebeneinander.
    const many = role === 'jaeger' || role === 'bomber' || role === 'marines';
    out.push(role);
    if (many) out.push(role, role);
  }
  while (out.length < slots) out.push(present[present.length - 1]);
  return out.slice(0, slots);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Effekte --------------------------------------------------------------
// Alles, was aufblitzt, fliegt und verglüht, hängt in dieser Liste und wird
// einmal je Bild weitergedreht. Kein Effekt hält den Ablauf auf.
const effects = [];

function addEffect(step) {
  const e = { step, done: false };
  effects.push(e);
  return e;
}

function stepEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.step(dt, e);
    if (e.done) effects.splice(i, 1);
  }
}

function glowMaterial(colour, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

// --- Das Licht des Gefechts ---------------------------------------------
// Mündungsfeuer und Explosionen waren bisher nur leuchtende Flächen: sie
// strahlten, aber sie beleuchteten nichts. Ein einziges Licht, das im
// Gefecht mitwandert und bei jedem Schuss kurz aufflammt, legt den Schein
// auf die Rümpfe ringsum.
function gefechtslicht(g) {
  if (!battleLight) {
    battleLight = new THREE.PointLight(0xffffff, 0, 60, 2);
    battleLight.name = 'gefechtslicht';
  }
  if (battleLight.parent !== g) g.add(battleLight);
  return battleLight;
}

function blitzlicht(g, pos, colour, staerke, dauer) {
  const light = gefechtslicht(g);
  light.position.copy(pos);
  light.color.set(colour);
  // Zwei Schüsse kurz nacheinander sollen einander nicht abdunkeln.
  if (staerke > light.intensity) light.intensity = staerke;
  let t = 0;
  addEffect((dt, e) => {
    t += dt;
    const rest = staerke * (1 - t / dauer);
    if (rest < light.intensity) light.intensity = Math.max(0, rest);
    if (t >= dauer) { light.intensity = 0; e.done = true; }
  });
}

// Der Mündungsblitz: ein kurzer Funke am Geschütz, damit man sieht, wer
// gerade feuert.
function muzzleFlash(g, pos, colour) {
  blitzlicht(g, pos, colour, 2.1, 0.14);
  const geo = sharedGeo('flash', () => new THREE.SphereGeometry(0.5, 8, 6));
  const mesh = new THREE.Mesh(geo, glowMaterial(colour, 0.9));
  mesh.position.copy(pos);
  g.add(mesh);
  let t = 0;
  addEffect((dt, e) => {
    t += dt;
    const k = t / 0.12;
    mesh.scale.setScalar(0.6 + k * 1.4);
    mesh.material.opacity = Math.max(0, 0.9 * (1 - k));
    if (k >= 1) { kill(mesh); e.done = true; }
  });
}

// Ein Einschlag am Rumpf: Funkenblitz plus ein paar Splitter. Klein, aber
// aus der Nähe der Unterschied zwischen Strich und Treffer.
function sparks(g, pos, colour, count = 4) {
  const geo = sharedGeo('shard', () => new THREE.TetrahedronGeometry(0.22));
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(geo, glowMaterial(colour, 0.95));
    mesh.position.copy(pos);
    const vel = new THREE.Vector3(
      (Math.random() - 0.5) * 9,
      (Math.random() - 0.5) * 7,
      (Math.random() - 0.5) * 9,
    );
    const spin = new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    g.add(mesh);
    let t = 0;
    addEffect((dt, e) => {
      t += dt;
      mesh.position.addScaledVector(vel, dt);
      vel.multiplyScalar(0.94);
      mesh.rotation.x += spin.x * dt;
      mesh.rotation.y += spin.y * dt;
      mesh.material.opacity = Math.max(0, 0.95 * (1 - t / 0.55));
      if (t >= 0.55) { kill(mesh); e.done = true; }
    });
  }
}

// Die Explosion in drei Lagen: Kern, Druckwelle, Trümmer. Je größer der
// Kiel, desto länger brennt es.
function explode(g, pos, { size = 2.4, colour = 0xffc27a, shards = 7, life = 0.8 } = {}) {
  const core = new THREE.Mesh(
    sharedGeo('boom', () => new THREE.SphereGeometry(1, 12, 10)),
    glowMaterial(0xfff2d0, 1),
  );
  core.position.copy(pos);
  core.scale.setScalar(size * 0.35);
  const shell = new THREE.Mesh(
    sharedGeo('boom', () => new THREE.SphereGeometry(1, 12, 10)),
    glowMaterial(colour, 0.5),
  );
  shell.position.copy(pos);
  const wave = new THREE.Mesh(
    sharedGeo('wave', () => new THREE.RingGeometry(0.86, 1, 32)),
    glowMaterial(colour, 0.7),
  );
  wave.position.copy(pos);
  g.add(core, shell, wave);
  blitzlicht(g, pos, 0xffdfa4, 3.4 + size * 0.5, life * 0.6);
  const view = sceneHandles().camera;
  let t = 0;
  addEffect((dt, e) => {
    t += dt;
    // Die Druckwelle steht immer quer zum Blick - flach gelegt sähe man aus
    // der Gefechtshöhe nur einen Strich.
    if (view) wave.lookAt(view.position);
    const k = Math.min(1, t / life);
    core.scale.setScalar(size * (0.35 + k * 0.9));
    core.material.opacity = Math.max(0, 1 - k * 2.2);
    shell.scale.setScalar(size * (0.5 + k * 2.1));
    shell.material.opacity = Math.max(0, 0.5 * (1 - k * 1.15));
    wave.scale.setScalar(size * (0.6 + k * 3.4));
    wave.material.opacity = Math.max(0, 0.7 * (1 - k * 1.3));
    if (k >= 1) { kill(core); kill(shell); kill(wave); e.done = true; }
  });
  sparks(g, pos, colour, shards);
}

// Das Ende eines Schiffs: es bricht aus der Formation, trudelt, verglüht.
// Erst danach ist es weg - kein Verschwinden auf Zuruf.
function shipDeath(g, ship, colour, speed) {
  const drift = new THREE.Vector3(
    (Math.random() - 0.5) * 5,
    (Math.random() - 0.5) * 3 + 0.6,
    (Math.random() - 0.5) * 5,
  );
  const spin = new THREE.Vector3(1.6 + Math.random(), 0.8 + Math.random(), 2.2 + Math.random());
  let t = 0;
  const life = 0.9 / Math.max(0.4, speed);
  explode(g, ship.position, { size: 1.5, colour, shards: 5, life: 0.6 });
  addEffect((dt, e) => {
    t += dt;
    const k = Math.min(1, t / life);
    ship.position.addScaledVector(drift, dt);
    ship.rotation.x += spin.x * dt;
    ship.rotation.z += spin.z * dt;
    ship.rotation.y += spin.y * dt;
    ship.scale.multiplyScalar(1 - dt * 0.6);
    if (k >= 1) {
      explode(g, ship.position, { size: 2.8, colour, shards: 9, life: 0.9 });
      sfx.explosion();
      shake(0.9);
      if (ship.parent) ship.parent.remove(ship);
      e.done = true;
    }
  });
}

// --- Leuchtspuren ---------------------------------------------------------
// Kein Strich, der aufblitzt und weg ist: ein Geschoss braucht seine Zeit von
// Rohr zu Rumpf. Erst dadurch sieht man, wer auf wen schießt.
function fireBolt(g, from, targetShip, colour, onHit, heavy = false) {
  const geo = heavy
    ? sharedGeo('boltHeavy', () => {
      const c = new THREE.CylinderGeometry(0.2, 0.2, 4.4, 8);
      c.rotateX(Math.PI / 2);
      return c;
    })
    : sharedGeo('bolt', () => {
      const c = new THREE.CylinderGeometry(0.085, 0.085, 2.2, 6);
      c.rotateX(Math.PI / 2);
      return c;
    });
  const bolt = new THREE.Mesh(geo, glowMaterial(colour, heavy ? 1 : 0.95));
  const start = from.clone();
  const aim = targetShip.position.clone();
  bolt.position.copy(start);
  bolt.lookAt(aim);
  g.add(bolt);
  muzzleFlash(g, start, colour);
  if (heavy) muzzleFlash(g, start, 0xfff2d0);
  // Ein schwerer Schuss braucht länger bis ins Ziel - man sieht ihn kommen.
  const dur = heavy
    ? (0.6 + start.distanceTo(aim) * 0.02)
    : (0.34 + start.distanceTo(aim) * 0.012);
  let t = 0;
  addEffect((dt, e) => {
    t += dt;
    const k = Math.min(1, t / dur);
    // Das Ziel fliegt weiter - das Geschoss zieht nach, aber nicht ganz.
    aim.lerp(targetShip.position, 0.12);
    bolt.position.lerpVectors(start, aim, k);
    bolt.lookAt(aim);
    if (k >= 1) {
      kill(bolt);
      e.done = true;
      if (onHit) onHit(bolt.position.clone());
    }
  });
}

// --- Torpedos -------------------------------------------------------------
// Bomber schießen nicht, sie stoßen zu: ein Torpedo braucht seine Zeit,
// zieht eine Spur und geht am Ende hoch. Das ist der Grund, warum Bomber
// mitfliegen - und warum Jäger sie abfangen sollen.
const torpedoes = [];

function launchTorpedo(g, from, to, colour, onHit, targetShip = null) {
  // Der Körper kommt aus der Werft wie jedes andere Schiff: Suchkopf,
  // Leuchtring, Flossen, Triebwerk.
  const torp = torpedoModel(colour);
  torp.scale.setScalar(1.05);
  torp.position.copy(from);
  torp.lookAt(to);
  g.add(torp);
  const flame = torp.getObjectByName('flamme');

  // Der Startblitz am Rohr.
  muzzleFlash(g, from.clone(), colour);
  muzzleFlash(g, from.clone(), 0xfff2d0);

  // Die Spur: ein Band aus den letzten Stellungen, das hinter dem Torpedo
  // herzieht und verglüht. Es sagt mehr über die Bahn als jede Fahne.
  const POINTS = 26;
  const trailGeo = new THREE.BufferGeometry();
  const trailPos = new Float32Array(POINTS * 3);
  for (let i = 0; i < POINTS; i++) {
    trailPos[i * 3] = from.x;
    trailPos[i * 3 + 1] = from.y;
    trailPos[i * 3 + 2] = from.z;
  }
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
    color: colour, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  g.add(trail);

  const start = from.clone();
  const target = to.clone();
  const dur = (1.6 + start.distanceTo(target) * 0.03);
  let t = 0;
  let puff = 0;
  const entry = {
    step(dt) {
      t += dt;
      const k = Math.min(1, t / dur);
      // Ein Torpedo läuft dem Ziel nach: die Bahn wird nachgeführt, solange
      // das Ziel noch fliegt.
      if (targetShip && targetShip.parent) target.lerp(targetShip.position, Math.min(1, dt * 1.2));
      torp.position.lerpVectors(start, target, k);
      // Er läuft nicht schnurgerade: erst steigen, dann ins Ziel fallen.
      torp.position.y += Math.sin(k * Math.PI) * 2.2;
      torp.position.x += Math.sin(t * 3.1) * 0.35 * (1 - k);
      torp.lookAt(target);
      // Um die Längsachse rollt er langsam - daran erkennt man ihn.
      torp.rotateZ(dt * 2.4);
      if (flame) {
        const pulse = 0.85 + Math.sin(t * 30) * 0.25;
        flame.scale.set(pulse, pulse, 1 + Math.sin(t * 21) * 0.4);
      }
      // Die Spur nachschieben: vorn die neue Stellung, hinten fällt eine raus.
      const arr = trailGeo.attributes.position.array;
      for (let i = POINTS - 1; i > 0; i--) {
        arr[i * 3] = arr[(i - 1) * 3];
        arr[i * 3 + 1] = arr[(i - 1) * 3 + 1];
        arr[i * 3 + 2] = arr[(i - 1) * 3 + 2];
      }
      arr[0] = torp.position.x;
      arr[1] = torp.position.y;
      arr[2] = torp.position.z;
      trailGeo.attributes.position.needsUpdate = true;
      // Rauch: alle paar Zehntel ein Fleck, der zurückbleibt und aufgeht.
      puff += dt;
      if (puff > 0.11) {
        puff = 0;
        const p = new THREE.Mesh(
          sharedGeo('puff', () => new THREE.SphereGeometry(0.34, 6, 5)),
          glowMaterial(colour, 0.32),
        );
        p.position.copy(torp.position);
        g.add(p);
        let pt = 0;
        addEffect((d2, e2) => {
          pt += d2;
          p.scale.setScalar(1 + pt * 2.4);
          p.material.opacity = Math.max(0, 0.32 * (1 - pt / 0.6));
          if (pt >= 0.6) { kill(p); e2.done = true; }
        });
      }
      if (k >= 1) {
        entry.done = true;
        kill(torp);
        // Die Spur verglüht noch einen Augenblick nach.
        let ft = 0;
        addEffect((d2, e2) => {
          ft += d2;
          trail.material.opacity = Math.max(0, 0.8 * (1 - ft / 0.45));
          if (ft >= 0.45) { kill(trail); e2.done = true; }
        });
        if (onHit) onHit(target);
      }
    },
    done: false,
  };
  torpedoes.push(entry);
  return entry;
}

function stepTorpedoes(dt) {
  for (let i = torpedoes.length - 1; i >= 0; i--) {
    torpedoes[i].step(dt);
    if (torpedoes[i].done) torpedoes.splice(i, 1);
  }
}

// --- Flugverhalten --------------------------------------------------------
// Wie ein Schiff im Gefecht fliegt: schwere Kiele halten die Linie und
// drehen kaum, Jäger kreisen eng. Alles bewusst gemächlich - man soll
// mitkommen, nicht Fliegen zählen.
const FLIGHT_STYLE = {
  jaeger: { radius: 3.6, speed: 0.95, weight: 1 },
  bomber: { radius: 3.0, speed: 0.66, weight: 2 },
  korvette: { radius: 2.3, speed: 0.46, weight: 3 },
  kreuzer: { radius: 1.6, speed: 0.3, weight: 4 },
  traeger: { radius: 1.0, speed: 0.18, weight: 5 },
  marines: { radius: 2.6, speed: 0.58, weight: 2 },
  wache: { radius: 2.1, speed: 0.5, weight: 2 },
};

// Ein Kreuzer kreist nicht. Großkampfschiffe halten die Linie im Rücken des
// Gefechts, drehen dem Gegner die Breitseite zu und schießen auf Distanz -
// die Jäger machen die Bewegung.
const HOLD_ROLES = new Set(['kreuzer', 'traeger']);

function setupFlight(ship, role, heading, home, entry) {
  const style = FLIGHT_STYLE[role] || FLIGHT_STYLE.jaeger;
  const d = ship.userData;
  d.role = role;
  // Wer die Linie hält, dreht sich nicht: er liegt quer zum Feind, damit
  // seine Türme tragen.
  d.hold = HOLD_ROLES.has(role);
  d.facing = heading;
  d.phase = Math.random() * Math.PI * 2;
  d.radius = style.radius * (0.8 + Math.random() * 0.4);
  d.speed = style.speed * (0.85 + Math.random() * 0.3);
  d.yaw = heading;
  d.runUntil = 0;
  d.station = home;
  d.entry = entry;
  ship.rotation.y = heading;
  ship.position.copy(entry);
}

// Wer im Gefecht ausbricht: alles, was wendig genug ist. Schwere Kiele
// halten die Linie.
const LIGHT_ROLES = new Set(['jaeger', 'bomber', 'marines', 'korvette', 'wache']);

// Ein Anflug: das Schiff zieht in einer Welle auf den Gegner zu und wieder
// zurück auf seinen Platz - bis auf Schussweite, nicht mitten hindurch.
function attackRun(ship, target, clock, span = 3.2) {
  ship.userData.runFrom = clock.t;
  ship.userData.runUntil = clock.t + span;
  ship.userData.runTarget = target.position.clone();
}

// --- Die Kamera im Gefecht ------------------------------------------------
// Sie zieht in großer Ruhe um das Feld und geht Runde für Runde näher heran.
// Ein schwerer Einschlag rüttelt sie kurz durch.
let shakeAmount = 0;
function shake(amount) {
  shakeAmount = Math.min(0.9, shakeAmount + amount);
}

// --- Die Anzeige über dem Gefecht ----------------------------------------
// Runde, Stärke, Verluste - und der Ausweg für alle, die es eilig haben.
let hudEl = null;

function openHud(report, attackerProfile, defenderProfile, onSkip) {
  closeHud();
  const el = document.createElement('div');
  el.className = 'battle-hud';
  el.innerHTML = `
    <div class="bh-bar">
      <div class="bh-side bh-left">
        <span class="bh-name"></span>
        <span class="bh-strength">—</span>
      </div>
      <div class="bh-round"><b>Gefecht</b><small>Anflug</small></div>
      <div class="bh-side bh-right">
        <span class="bh-name"></span>
        <span class="bh-strength">—</span>
      </div>
    </div>
    <button type="button" class="bh-skip">Gefecht überspringen ›</button>`;
  const names = el.querySelectorAll('.bh-name');
  names[0].textContent = attackerProfile.short || attackerProfile.name || 'Angreifer';
  names[1].textContent = defenderProfile.short || defenderProfile.name || 'Verteidiger';
  names[0].style.color = attackerProfile.color;
  names[1].style.color = defenderProfile.color;
  el.querySelector('.bh-skip').addEventListener('click', onSkip);
  document.body.appendChild(el);
  hudEl = el;
  return {
    round(round, total, text) {
      const box = el.querySelector('.bh-round');
      box.querySelector('b').textContent = `Runde ${round} / ${total}`;
      box.querySelector('small').textContent = text || '';
    },
    strength(a, d) {
      const s = el.querySelectorAll('.bh-strength');
      s[0].textContent = a;
      s[1].textContent = d;
    },
    note(text) {
      const box = el.querySelector('.bh-round');
      if (box) box.querySelector('small').textContent = text;
    },
  };
}

function closeHud() {
  if (hudEl && hudEl.parentNode) hudEl.parentNode.removeChild(hudEl);
  hudEl = null;
}

// --- Die Vorstellung -----------------------------------------------------
// `report` ist der fertige Bericht; hier wird er nur noch gezeigt. Das Spiel
// wartet darauf, aber es hängt nicht davon ab: wer abbricht, bekommt sofort
// das Ergebnis.
export async function playBattle(report, { speed = 1, onRound = null, render = null } = {}) {
  const g = ensureGroup();
  if (!g || !report) return;
  running = true;
  cancelled = false;
  clearGroup();
  shakeAmount = 0;

  const attackerProfile = factionProfile(report.attacker.factionId);
  const defenderProfile = factionProfile(report.defender.factionId);
  const attackerColour = new THREE.Color(attackerProfile.color);
  const defenderColour = new THREE.Color(defenderProfile.color);
  const centre = worldOfTile(report.col, report.row);
  const origin = new THREE.Vector3(centre.x, 5, centre.z);

  // Das Kartenwerk tritt zurück: keine Namen, keine Reichweiten, kein
  // Bedienfeld über dem Gefecht.
  setBattleMode(true, { col: report.col, row: report.row });
  document.body.classList.add('gefecht-laeuft');

  const skip = () => { cancelled = true; };
  const onKey = (ev) => {
    if (ev.key === 'Escape' || ev.key === ' ' || ev.key === 'Enter') skip();
  };
  window.addEventListener('keydown', onKey);
  const hud = openHud(report, attackerProfile, defenderProfile, skip);

  const camBefore = cameraState();
  let live = true;

  try {
    // Der Blick fährt auf das Feld, legt sich flach an den Horizont und geht
    // heran. Von hier aus sieht man Rümpfe, keine Marken.
    await glideTo(report.col, report.row, 520 / speed);

    // Die beiden Seiten kommen aus der Ferne aufeinander zu: Angreifer von
    // Westen, Verteidiger hält die Stellung.
    const attackers = [];
    const defenders = [];
    const attackerCount = Math.min(6, Math.max(3, Math.round(sumUnits(report.attacker.units) / 7)));
    const defenderCount = Math.min(6, Math.max(3, Math.round(sumUnits(report.defender.units) / 7)));
    const attackerRoles = battleRoles(report.attacker.units, attackerCount);
    const defenderRoles = battleRoles(report.defender.units, defenderCount);
    for (let i = 0; i < attackerCount; i++) {
      const f = makeFighter(attackerProfile.kind, attackerRoles[i], attackerProfile, Math.PI / 2);
      const angle = (i / attackerCount) * Math.PI - Math.PI / 2;
      // Schwere Kiele stehen ein Feld weiter hinten - sie schießen auf
      // Distanz, statt in den Nahkampf zu fahren.
      const back = HOLD_ROLES.has(attackerRoles[i]) ? TILE_SIZE * 1.3 : 0;
      const home = new THREE.Vector3(
        origin.x - TILE_SIZE * 2.9 - back + Math.cos(angle) * 3.0,
        6 + Math.sin(angle) * 3.2,
        origin.z + Math.sin(angle) * TILE_SIZE * 1.25,
      );
      const entry = home.clone();
      entry.x -= TILE_SIZE * 4.2;
      setupFlight(f, attackerRoles[i], Math.PI / 2, home, entry);
      g.add(f);
      attackers.push(f);
    }
    for (let i = 0; i < defenderCount; i++) {
      const f = makeFighter(defenderProfile.kind, defenderRoles[i], defenderProfile, -Math.PI / 2);
      const angle = (i / defenderCount) * Math.PI + Math.PI / 2;
      const back = HOLD_ROLES.has(defenderRoles[i]) ? TILE_SIZE * 1.3 : 0;
      const home = new THREE.Vector3(
        origin.x + TILE_SIZE * 2.7 + back + Math.cos(angle) * 3.0,
        6 + Math.sin(angle) * 3.2,
        origin.z + Math.sin(angle) * TILE_SIZE * 1.25,
      );
      const entry = home.clone();
      entry.x += TILE_SIZE * 3.4;
      setupFlight(f, defenderRoles[i], -Math.PI / 2, home, entry);
      g.add(f);
      defenders.push(f);
    }

    // Steht ein System dahinter, wird der Schild sichtbar: eine Kuppel, die
    // Runde für Runde dünner wird, mit einem Netz darüber, das bei jedem
    // Einschlag aufleuchtet.
    let shieldMesh = null;
    let shieldNet = null;
    if (report.shield && report.shield.level > 0) {
      const geo = new THREE.SphereGeometry(TILE_SIZE * 0.85, 20, 16);
      shieldMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0x7fd4ff, transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false,
      }));
      shieldMesh.position.set(origin.x + TILE_SIZE * 0.5, 6, origin.z);
      shieldNet = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({
        color: 0xbfeaff, transparent: true, opacity: 0.2, wireframe: true, depthWrite: false,
      }));
      shieldNet.position.copy(shieldMesh.position);
      g.add(shieldMesh, shieldNet);
    }

    const clock = { t: 0 };
    let approach = 0;

    // Jedes Schiff fliegt seine eigene Bahn: eine langsame Ellipse um seinen
    // Platz im Verband, dazu ein Anflug, wenn es an der Reihe ist. Die Nase
    // zeigt immer dorthin, wo es hinfliegt - kein Zappeln, kein Rückwärtsflug.
    const _prev = new THREE.Vector3();
    const _next = new THREE.Vector3();
    const _home = new THREE.Vector3();
    function homeOf(ship) {
      const d = ship.userData;
      return _home.lerpVectors(d.entry, d.station, approach);
    }
    function flyShip(ship, t) {
      const d = ship.userData;
      _prev.copy(ship.position);
      const home = homeOf(ship);
      if (d.hold) {
        // Die Linie: ein schwerer Kiel schiebt sich langsam vor und zurück,
        // mehr nicht. Die Breitseite bleibt zum Feind.
        ship.position.set(
          home.x + Math.sin(t * 0.14 + d.phase) * 0.9,
          home.y + Math.sin(t * 0.21 + d.phase) * 0.7,
          home.z + Math.cos(t * 0.11 + d.phase) * 1.4,
        );
        let delta = d.facing - d.yaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        d.yaw += delta * 0.05;
        ship.rotation.y = d.yaw;
        ship.rotation.z *= 0.9;
        return;
      }
      const a = t * d.speed + d.phase;
      _next.set(
        home.x + Math.cos(a) * d.radius * 0.8,
        home.y + Math.sin(a * 0.7 + d.phase) * 1.4,
        home.z + Math.sin(a) * d.radius,
      );
      // Läuft ein Anflug, wird die Bahn zum Gegner hin verschoben und wieder
      // zurück - eine Welle, kein Sprung.
      if (d.runUntil && t < d.runUntil) {
        const span = d.runUntil - d.runFrom;
        const k = Math.sin(((t - d.runFrom) / span) * Math.PI);
        _next.x += (d.runTarget.x - home.x) * k * 0.5;
        _next.y += (d.runTarget.y - home.y) * k * 0.5;
        _next.z += (d.runTarget.z - home.z) * k * 0.5;
      }
      ship.position.copy(_next);
      // Kurs aus der tatsächlichen Bewegung: so fliegt kein Schiff seitwärts.
      const dx = ship.position.x - _prev.x;
      const dz = ship.position.z - _prev.z;
      if (dx * dx + dz * dz > 1e-6) {
        const want = Math.atan2(dx, dz);
        let delta = want - d.yaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        d.yaw += delta * 0.12;
        ship.rotation.y = d.yaw;
        ship.rotation.z = Math.max(-0.5, Math.min(0.5, -delta * 12));
      }
    }

    // Die Kamerafahrt: Ziel-Azimut wandert langsam weiter, der Zoom geht von
    // Runde zu Runde näher heran. Alles nachgeführt, nichts geschnitten.
    const camAim = { azimuth: camBefore.azimuth, polar: 1.26, zoom: 3.2, lookY: 7 };
    const camNow = {
      azimuth: camBefore.azimuth, polar: camBefore.polar, zoom: camBefore.zoom, lookY: 0,
    };

    let lastFrame = performance.now();
    const swirl = () => {
      if (!live) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      // Deutlich langsamer als früher: die Verbände fliegen, sie flirren nicht.
      clock.t += dt * 0.85 * speed;
      approach = Math.min(1, approach + dt * 0.42 * speed);
      for (const f of attackers) flyShip(f, clock.t);
      for (const f of defenders) flyShip(f, clock.t);
      stepTorpedoes(dt);
      stepEffects(dt);
      if (shieldNet) shieldNet.rotation.y += dt * 0.12;
      // Kamera: weich nachziehen, dazu ein Rütteln, das schnell abklingt.
      camAim.azimuth += dt * 0.075;
      camNow.azimuth += (camAim.azimuth - camNow.azimuth) * Math.min(1, dt * 2.2);
      camNow.polar += (camAim.polar - camNow.polar) * Math.min(1, dt * 1.8);
      camNow.zoom += (camAim.zoom - camNow.zoom) * Math.min(1, dt * 1.5);
      camNow.lookY += (camAim.lookY - camNow.lookY) * Math.min(1, dt * 1.5);
      shakeAmount = Math.max(0, shakeAmount - dt * 1.8);
      setCamera({
        azimuth: camNow.azimuth + (Math.random() - 0.5) * shakeAmount * 0.05,
        polar: camNow.polar + (Math.random() - 0.5) * shakeAmount * 0.04,
        zoom: camNow.zoom,
        lookY: camNow.lookY,
      });
      if (render) render();
      requestAnimationFrame(swirl);
    };
    requestAnimationFrame(swirl);

    // Der Anflug: beide Verbände schließen auf, ehe der erste Schuss fällt.
    hud.strength(report.rounds[0] ? report.rounds[0].attackStrength : '—',
      report.rounds[0] ? report.rounds[0].defenceStrength : '—');
    hud.round(0, report.rounds.length, 'Verbände schließen auf');
    sfx.triebwerk();
    await wait(2200 / speed);

    // Runde für Runde: Anflüge, Salven, Torpedos, Verluste.
    const total = report.rounds.length;
    for (const round of report.rounds) {
      if (cancelled) break;
      if (onRound) onRound(round);
      hud.round(round.round, total, 'Anflug');
      hud.strength(round.attackStrength, round.defenceStrength);
      // Jede Runde geht die Kamera ein Stück näher heran.
      // Die Verbände stehen jetzt weiter auseinander - der Rahmen bleibt so
      // weit, dass beide Linien im Bild liegen.
      camAim.zoom = Math.min(5.4, 3.6 + (round.round / total) * 1.8);
      camAim.polar = 1.3 - (round.round / total) * 0.16;

      // Wer greift in dieser Runde an? Zwei bis drei Maschinen je Seite ziehen
      // einen Anflug; der Rest hält die Linie.
      const runners = [];
      for (const [side, foes] of [[attackers, defenders], [defenders, attackers]]) {
        // Nur leichte Kiele brechen aus. Ein Träger dreht nicht in den Feind
        // hinein - er bleibt stehen und lässt schießen.
        const light = side.filter((sh) => LIGHT_ROLES.has(sh.userData.role));
        const pool = light.length ? light : side;
        const many = Math.min(3, Math.max(1, Math.round(pool.length / 2)));
        for (let i = 0; i < many; i++) {
          const ship = pool[Math.floor(Math.random() * pool.length)];
          const foe = foes[Math.floor(Math.random() * foes.length)];
          if (!ship || !foe || runners.includes(ship)) continue;
          attackRun(ship, foe, clock, 3 + Math.random() * 1.4);
          runners.push(ship);
        }
      }
      await wait(450 / speed);

      // Die Salven: ruhig getaktet, jedes Geschoss läuft sichtbar von Rohr zu
      // Rumpf. Man sieht, wer wen aufs Korn nimmt.
      if (!cancelled) hud.note('Feuergefecht');
      const shots = 7;
      for (let s = 0; s < shots; s++) {
        if (cancelled) break;
        const a = attackers[Math.floor(Math.random() * attackers.length)];
        const d = defenders[Math.floor(Math.random() * defenders.length)];
        if (a && d) {
          fireBolt(g, a.position.clone(), d, attackerColour, (at) => {
            sparks(g, at, 0xffd8a0, 3);
            if (Math.random() < 0.5) sfx.treffer();
          });
          fireBolt(g, d.position.clone(), a, defenderColour, (at) => {
            sparks(g, at, 0xffd8a0, 3);
          });
          if (s % 2 === 0) sfx.laser();
        }
        // Die schweren Kiele halten ihre Linie und schießen von dort - jede
        // zweite Salve eine schwere Lage, quer über das Feld.
        if (s % 2 === 1) {
          for (const [side, foes, colour] of [
            [attackers, defenders, attackerColour],
            [defenders, attackers, defenderColour],
          ]) {
            const heavies = side.filter((sh) => sh.userData.hold);
            const gun = heavies[Math.floor(Math.random() * heavies.length)];
            const mark = foes[Math.floor(Math.random() * foes.length)];
            if (!gun || !mark) continue;
            fireBolt(g, gun.position.clone(), mark, colour, (at) => {
              explode(g, at, { size: 1.6, colour: 0xffd08a, shards: 4, life: 0.5 });
              sfx.treffer();
            }, true);
          }
          sfx.laser();
        }
        await wait(280 / speed);
      }

      // Die Torpedos: jeder Bomber im Verband stößt einmal zu - gegen den
      // Schild, wenn eine Welt dahintersteht, sonst gegen den schwersten Kiel
      // auf der anderen Seite. Ein Torpedo braucht seine anderthalb Sekunden.
      let torpedoRun = false;
      for (const [side, foes, colour] of [
        [attackers, defenders, attackerColour],
        [defenders, attackers, defenderColour],
      ]) {
        const bombers = side.filter((sh) => sh.userData.role === 'bomber');
        for (const bomber of bombers.slice(0, 2)) {
          if (cancelled) break;
          const aim = shieldMesh && shieldMesh.visible && side === attackers
            ? shieldMesh
            : foes.slice().sort((x, y) => (FLIGHT_STYLE[y.userData.role].weight
              - FLIGHT_STYLE[x.userData.role].weight))[0];
          if (!aim) continue;
          if (!torpedoRun) { hud.note('Torpedos los'); torpedoRun = true; }
          sfx.torpedo();
          launchTorpedo(g, bomber.position.clone(), aim.position.clone(), colour, (at) => {
            explode(g, at, { size: 3.4, colour: 0xffd08a, shards: 10, life: 1 });
            sfx.explosion();
            shake(0.8);
          }, aim === shieldMesh ? null : aim);
          await wait(420 / speed);
        }
      }
      if (torpedoRun) await wait(700 / speed);

      // Der Schild unter Beschuss.
      if (shieldMesh) {
        const remaining = Math.max(0, 1 - (round.shieldDown || 0) / 100);
        shieldMesh.material.opacity = 0.05 + remaining * 0.24;
        if (shieldNet) shieldNet.material.opacity = 0.04 + remaining * 0.2;
        if ((round.shieldDown || 0) > 0) {
          sfx.schild();
          explode(g, shieldMesh.position, { size: 4, colour: 0x9fe4ff, shards: 6, life: 0.7 });
          hud.note(`Schild bei ${Math.round(remaining * 100)} %`);
          await wait(420 / speed);
        }
        if (remaining <= 0.01 && shieldMesh.visible) {
          shieldMesh.visible = false;
          if (shieldNet) shieldNet.visible = false;
          explode(g, shieldMesh.position, { size: 6, colour: 0xbfeaff, shards: 12, life: 1.1 });
          sfx.explosion();
          shake(0.9);
          hud.note('Schild gefallen');
          await wait(700 / speed);
        }
      }

      // Verluste: für jede Runde fällt so mancher Kiel aus der Formation -
      // anteilig, damit die Zahl auf dem Feld zum Bericht passt. Jedes Wrack
      // bekommt seine eigene Sekunde.
      const lossA = sumLosses(round.lossesAttacker);
      const lossD = sumLosses(round.lossesDefender);
      if (lossA || lossD) hud.note('Verluste');
      await removeSome(g, attackers, lossA / Math.max(1, sumUnits(report.attacker.units) + lossA), speed, attackerColour);
      await removeSome(g, defenders, lossD / Math.max(1, sumUnits(report.defender.units) + lossD), speed, defenderColour);
      await wait(500 / speed);
    }

    // Der Ausgang: der Verlierer geht hoch, der Sieger bleibt über dem Feld -
    // und die Kamera zieht sich langsam zurück.
    if (!cancelled) {
      const losers = report.winner === 'angreifer' ? defenders : attackers;
      const colour = report.winner === 'angreifer' ? defenderColour : attackerColour;
      hud.round(total, total, report.winner === 'angreifer' ? 'Angreifer siegt' : 'Verteidiger hält');
      camAim.zoom = 4.6;
      for (const f of losers.slice()) {
        shipDeath(g, f, colour, speed);
        await wait(240 / speed);
      }
      shake(0.9);
      flashTile(report.col, report.row, report.winner === 'angreifer' ? 0x7fffb0 : 0xff7a5a);
      await wait(1100 / speed);
    }

    // Zurück in die Karte: kein Schnitt, ein Rückzug.
    const back = { t: 0 };
    camAim.azimuth = camBefore.azimuth;
    camAim.polar = camBefore.polar;
    camAim.zoom = camBefore.zoom;
    camAim.lookY = 0;
    while (back.t < 1) {
      back.t += 0.022;
      await wait(16);
      if (cancelled && back.t > 0.3) break;
    }
    live = false;
    setCamera({
      azimuth: camBefore.azimuth, polar: camBefore.polar, zoom: camBefore.zoom, lookY: 0,
    });
  } finally {
    live = false;
    window.removeEventListener('keydown', onKey);
    setBattleMode(false);
    document.body.classList.remove('gefecht-laeuft');
    closeHud();
    clearGroup();
    setCamera({
      azimuth: camBefore.azimuth, polar: camBefore.polar, zoom: camBefore.zoom, lookY: 0,
    });
    running = false;
    if (render) render();
  }
}

async function removeSome(g, list, share, speed, colour) {
  const kill2 = Math.min(list.length - 1, Math.round(list.length * Math.max(0, Math.min(0.6, share))));
  for (let i = 0; i < kill2; i++) {
    const f = list.pop();
    if (!f) break;
    shipDeath(g, f, colour, speed);
    await wait(420 / speed);
  }
}

function sumUnits(units) {
  return (units || []).reduce((s, u) => s + Math.max(0, u.count), 0);
}
function sumLosses(losses) {
  return Object.values(losses || {}).reduce((s, n) => s + n, 0);
}

export function stopBattle() {
  cancelled = true;
  setBattleMode(false);
  document.body.classList.remove('gefecht-laeuft');
  closeHud();
  clearGroup();
  running = false;
}

export function isBattleRunning() {
  return running;
}

// Der Bericht in Worten - dieselbe Partitur, nur zum Lesen. Er steht im
// Fenster nach dem Gefecht.
export function battleRoundsHTML(report) {
  if (!report) return '';
  return `<table class="battle-rounds">
    <thead><tr><th>Runde</th><th>Angreifer</th><th>Verteidiger</th><th>Schild</th></tr></thead>
    <tbody>${report.rounds.map((r) => `<tr>
      <td>${r.round}</td>
      <td>${r.attackStrength} <small>(${lossText(r.lossesAttacker)})</small></td>
      <td>${r.defenceStrength} <small>(${lossText(r.lossesDefender)})</small></td>
      <td>${r.shieldDown == null ? '—' : `${r.shieldDown}%`}</td>
    </tr>`).join('')}</tbody></table>`;
}

function lossText(losses) {
  const parts = Object.entries(losses || {})
    .filter(([, n]) => n > 0)
    .map(([role, n]) => `−${n} ${ROLE_SHORT[role] || role}`);
  return parts.length ? parts.join(', ') : 'ohne Verlust';
}
