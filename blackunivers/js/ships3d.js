// --- Die Schiffe ----------------------------------------------------------
// Bisher war eine Flotte ein Kegel und ein Jäger ein Dreieck. Hier stehen die
// wirklichen Umrisse - und zwar nach den Entwürfen des Films von 1999, nicht
// nach den schlanken Pfeilen der frühen Spiele:
//
//   Rapier    breiter, flacher Blechkasten mit tief sitzender Kanzel, kurzen
//             gekappten Flügeln, zwei wuchtigen Gondeln und nach außen
//             geneigten Seitenleitwerken
//   Tiger Claw  ein langer, dunkler Stahlkasten: Flugdeck über die ganze
//             Länge, offenes Hangarmaul unter dem Bug, Brückenturm weit
//             achtern, schwerer Triebwerksblock am Heck, gerippte Flanken
//   Dralthi   dunkle Bronze, ein breiter Flügel, der sich nach vorn krümmt,
//             die Spitzen nach unten gebogen, dazwischen ein gedrungener Pod
//             mit geteilter Kanzel
//
// Alle Modelle blicken nach +Z. Wer sie dreht, dreht um Y - so wie die Karte
// es tut, wenn eine Flotte ihren Kurs nimmt.
//
// Gebaut wird aus wenigen Körpern: Sie sollen auf einem Kartentisch zu
// erkennen sein, nicht in einer Werft nachgebaut werden.

// Geometrien und Werkstoffe werden geteilt: dreißig Flotten und dreißig
// Jäger im Gefecht sollen nicht dreihundert Puffer belegen.
const modelCache = new Map();

// Die Plattenhaut: hell genug, dass sie die Rumpffarbe nur moduliert statt
// sie abzudunkeln (sie wird als `map` mit der Farbe multipliziert). Alles
// darauf ist fein und unregelmäßig - grobe, gerade Muster würden auf einem
// gestreckten Kasten sofort als verzerrtes Gitter auffallen.
let panelTexture = null;
function hullPanels() {
  if (panelTexture) return panelTexture;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#f7f7f7';
  g.fillRect(0, 0, S, S);
  // Ein fester Zufall: dieselbe Haut bei jedem Start.
  let seed = 20250906;
  const zufall = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  // Bleche: unterschiedlich helle Rechtecke, damit die Fläche nicht wie
  // lackiert wirkt.
  for (let i = 0; i < 34; i++) {
    const w = 24 + zufall() * 70;
    const h = 18 + zufall() * 54;
    const x = zufall() * S;
    const y = zufall() * S;
    const t = 0.86 + zufall() * 0.14;
    g.fillStyle = `rgba(${Math.round(255 * t)},${Math.round(255 * t)},${Math.round(255 * t)},0.5)`;
    g.fillRect(x, y, w, h);
  }
  // Fugen: dünne dunkle Linien, waagerecht und senkrecht, in ungleichen
  // Abständen.
  g.strokeStyle = 'rgba(60,68,80,0.34)';
  g.lineWidth = 1;
  for (let i = 0; i < 22; i++) {
    const x = Math.round(zufall() * S) + 0.5;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, S);
    g.stroke();
  }
  for (let i = 0; i < 16; i++) {
    const y = Math.round(zufall() * S) + 0.5;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(S, y);
    g.stroke();
  }
  // Nietreihen entlang einiger Fugen.
  g.fillStyle = 'rgba(50,58,70,0.30)';
  for (let i = 0; i < 8; i++) {
    const y = Math.round(zufall() * S);
    for (let x = 3; x < S; x += 7) g.fillRect(x, y, 1, 1);
  }
  panelTexture = new THREE.CanvasTexture(cv);
  panelTexture.wrapS = THREE.RepeatWrapping;
  panelTexture.wrapT = THREE.RepeatWrapping;
  panelTexture.repeat.set(3, 3);
  panelTexture.anisotropy = 4;
  return panelTexture;
}

// Ein weicher Fleck als Bild: eine Sprite ohne Textur wäre ein hartes
// Quadrat. Diese hier wird einmal gemalt und von allen Triebwerken geteilt.
let dotTexture = null;
function softDot() {
  if (dotTexture) return dotTexture;
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const g = cv.getContext('2d');
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  dotTexture = new THREE.CanvasTexture(cv);
  return dotTexture;
}

// Der Schein, den ein laufendes Triebwerk um sich hat. Ohne ihn ist die
// Düse nur eine helle Scheibe, die aus jedem Winkel gleich klein aussieht -
// mit ihm sieht man auf einen Blick, welches Schiff Schub gibt, auch wenn es
// im Gefecht weit weg steht. Eine Sprite steht immer zur Kamera, kostet
// einen Zeichenaufruf und keine Beleuchtung.
function engineHalo(colour, radius, x, y, z, staerke = 0.62) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDot(),
    color: colour,
    transparent: true,
    opacity: staerke,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  sprite.scale.setScalar(radius * 4.4);
  sprite.position.set(x, y, z);
  sprite.name = 'flamme';
  return sprite;
}

function hullMaterial(colour, accent, { metal = 0.5, rough = 0.5, glow = 0.1 } = {}) {
  // Der Rumpf trägt die Farbe der Flagge, aber gedämpft: ein Schiff ist
  // graues Metall mit einem Farbton darin. Hell wird nur, was leuchtet -
  // Düsen, Decksbeleuchtung, Kanzeln. So liest sich die Silhouette auf der
  // dunklen Karte, statt als heller Fleck zu verschwimmen.
  const hue = new THREE.Color(colour).lerp(new THREE.Color(0x161d28), 0.68);
  return new THREE.MeshStandardMaterial({
    color: hue,
    map: hullPanels(),
    emissive: new THREE.Color(accent).multiplyScalar(0.22),
    emissiveIntensity: glow,
    metalness: metal,
    roughness: rough,
    flatShading: true,
  });
}

function darkMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x0f1720, metalness: 0.5, roughness: 0.7, flatShading: true,
  });
}

function glowMaterial(colour, opacity = 0.95) {
  return new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity });
}

// Ein Block. Alle Maße in Modelleinheiten; ein Jäger ist rund drei lang.
function box(mat, w, h, d, x = 0, y = 0, z = 0, rot = null) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  if (rot) mesh.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  return mesh;
}

// Eine Spitze, die nach vorn zeigt.
function nose(mat, radius, length, x = 0, y = 0, z = 0, segments = 4) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, length, segments), mat);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}

// Eine Triebwerksdüse: Rohr, heiße Scheibe, Schleppfahne.
function engine(mat, glowColour, radius, length, x, y, z, flame = 1) {
  const g = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.86, length, 8), mat);
  tube.rotation.x = Math.PI / 2;
  g.add(tube);
  // Der Kranz um die Düsenmündung: er gibt dem Rohr Tiefe, statt es flach
  // abzuschneiden.
  const bell = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.15, radius * 0.9, length * 0.3, 8, 1, true),
    mat,
  );
  bell.rotation.x = Math.PI / 2;
  bell.position.z = -length / 2 - length * 0.14;
  bell.name = 'zier';
  g.add(bell);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.82, 10), glowMaterial(glowColour));
  disc.position.z = -length / 2 - 0.01;
  disc.rotation.y = Math.PI;
  g.add(disc);
  if (flame > 0) {
    g.add(engineHalo(glowColour, radius, 0, 0, -length / 2 - radius * 0.5));
    const trail = new THREE.Mesh(
      new THREE.ConeGeometry(radius * 0.72, length * 1.9 * flame, 8, 1, true),
      glowMaterial(glowColour, 0.32),
    );
    trail.rotation.x = -Math.PI / 2;
    trail.position.z = -length / 2 - (length * 1.9 * flame) / 2;
    // Die Schleppfahne ist durchsichtig und damit die teuerste Fläche am
    // Schiff. Sie trägt einen Namen, damit sie bei vielen Schiffen auf
    // einmal wegfallen kann.
    trail.name = 'flamme';
    g.add(trail);
  }
  g.position.set(x, y, z);
  return g;
}

// Ein Glutball hinter der Düse: er trägt weiter als das Rohr selbst und
// macht aus einem Schiff im Dunkeln ein fliegendes Schiff.
function engineGlow(colour, radius, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 8, 6),
    new THREE.MeshBasicMaterial({
      color: colour, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending,
    }),
  );
  mesh.position.set(x, y, z);
  mesh.name = 'flamme';
  return mesh;
}

// Positionslichter: rot backbord, grün steuerbord - auch im Weltraum.
function runningLights(group, halfWidth, z) {
  const red = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), glowMaterial(0xff5a4a));
  red.position.set(-halfWidth, 0, z);
  red.name = 'licht';
  const green = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), glowMaterial(0x5affa0));
  green.position.set(halfWidth, 0, z);
  green.name = 'licht';
  group.add(red, green);
}

// Eine Platte: eine Spur heller als der Rumpf. Große Flächen wirken damit
// wie zusammengesetzte Schiffe und nicht wie ein Block.
function plateMaterial(colour) {
  const hue = new THREE.Color(colour).lerp(new THREE.Color(0x1c2532), 0.62);
  return new THREE.MeshStandardMaterial({
    color: hue, map: hullPanels(), metalness: 0.58, roughness: 0.44, flatShading: true,
  });
}

// Ein Geschützturm: Sockel, drehbarer Kopf, Doppelrohr. Er ersetzt überall
// den Würfel mit dem Stäbchen - aus der Nähe ist das der Unterschied
// zwischen Schiff und Modellbaukasten.
function turret(hull, dark, size, x, y, z, aim = 0) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.62, size * 0.74, size * 0.34, 8), dark,
  );
  g.add(base);
  const head = new THREE.Mesh(new THREE.BoxGeometry(size * 1.0, size * 0.5, size * 0.86), hull);
  head.position.y = size * 0.4;
  g.add(head);
  const barrels = new THREE.Mesh(
    new THREE.BoxGeometry(size * 0.5, size * 0.14, size * 1.5), dark,
  );
  barrels.position.set(0, size * 0.44, size * 0.9);
  g.add(barrels);
  g.position.set(x, y, z);
  g.rotation.y = aim;
  g.name = 'zier';
  return g;
}

// Ein Kühler: eine dünne Platte mit glühender Kante. Große Schiffe müssen
// ihre Wärme irgendwo loswerden, und man sieht es ihnen an.
function radiator(colour, plate, w, h, x, y, z, tilt = 0) {
  const g = new THREE.Group();
  // Dunkel wie ein kaltes Blech - nur die Kante glüht. Sonst hängt ein
  // heller Fleck am Schiff, wo eine Flosse sein soll.
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, w), darkMaterial());
  g.add(panel);
  for (let i = 0; i < 3; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.07, h * 0.9, 0.03), plate);
    rib.position.z = (i - 1) * (w / 3.2);
    g.add(rib);
  }
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.05, w * 0.9), glowMaterial(colour, 0.55),
  );
  edge.position.y = -h / 2;
  g.add(edge);
  g.position.set(x, y, z);
  g.rotation.z = tilt;
  g.name = 'zier';
  return g;
}

// Ein Mast mit Rahmenantenne und Blinkfeuer - die Silhouette, an der man ein
// Kriegsschiff von einem Frachter unterscheidet.
function mast(dark, height, x, y, z) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.05, height, 5), dark,
  );
  pole.position.y = height / 2;
  g.add(pole);
  const array = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.05), dark);
  array.position.y = height * 0.72;
  g.add(array);
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), glowMaterial(0xff5a4a));
  strobe.position.y = height;
  strobe.name = 'licht';
  g.add(strobe);
  g.position.set(x, y, z);
  g.name = 'zier';
  return g;
}

// Ein Kanonenrohr mit Mündung - für Jäger, wo ein Kasten zu grob wäre.
function cannon(dark, glowColour, radius, length, x, y, z) {
  const g = new THREE.Group();
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.25, length, 6), dark,
  );
  tube.rotation.x = Math.PI / 2;
  g.add(tube);
  const muzzle = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.5, radius * 1.5, length * 0.12, 6), dark,
  );
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.z = length * 0.42;
  g.add(muzzle);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.8, 6, 5), glowMaterial(glowColour, 0.7));
  tip.position.z = length * 0.5;
  tip.name = 'licht';
  g.add(tip);
  g.position.set(x, y, z);
  g.name = 'zier';
  return g;
}

// --- Der Torpedo ----------------------------------------------------------
// Er hängt unter den Bombern und fliegt im Gefecht allein: Stahlkörper,
// Suchkopf mit glühendem Ring, vier Flossen, ein Triebwerk, das eine Fahne
// zieht. Blickrichtung +Z wie bei allen Modellen; ein Torpedo misst eine
// Modelleinheit.
export function torpedoModel(colour = 0xffd08a, { armed = true } = {}) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({
    color: 0x49525f, metalness: 0.85, roughness: 0.32, flatShading: true,
  });
  const dark = darkMaterial();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.72, 10), steel);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  // Suchkopf: eine Spitze mit einem Leuchtring dahinter.
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.34, 10), steel);
  head.rotation.x = Math.PI / 2;
  head.position.z = 0.53;
  g.add(head);
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(0.135, 0.135, 0.06, 10), glowMaterial(colour, 0.9),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.z = 0.34;
  g.add(ring);
  const seeker = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), glowMaterial(0xfff2d0, 0.9));
  seeker.position.z = 0.7;
  g.add(seeker);
  // Vier Flossen im Kreuz, leicht angestellt.
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.26, 0.3), dark);
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    fin.position.set(Math.cos(a) * 0.14, Math.sin(a) * 0.14, -0.28);
    fin.rotation.z = a - Math.PI / 2;
    g.add(fin);
  }
  // Ein Band um den Bauch: Kennzeichnung und Gurt zugleich.
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.07, 10), dark);
  belt.rotation.x = Math.PI / 2;
  belt.position.z = 0.02;
  g.add(belt);
  // Das Triebwerk am Heck.
  const bell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.09, 0.16, 8, 1, true), dark,
  );
  bell.rotation.x = Math.PI / 2;
  bell.position.z = -0.42;
  g.add(bell);
  if (armed) {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.8, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    flame.rotation.x = -Math.PI / 2;
    flame.position.z = -0.88;
    flame.name = 'flamme';
    g.add(flame);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 6),
      new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity: 0.75,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    glow.position.z = -0.5;
    glow.name = 'flamme';
    g.add(glow);
  }
  return g;
}

// --- Terranische Werften -------------------------------------------------

// Rapier, wie ihn der Film zeigt: kein spitzer Pfeil, sondern ein breiter,
// flacher Kasten mit tief sitzender Kanzel, kurzen gekappten Flügeln, zwei
// wuchtigen Triebwerksgondeln hinten und zwei nach außen geneigten
// Seitenleitwerken. Ein Arbeitsgerät aus Blech, kein Sportwagen.
function terranFighter(colour, accent) {
  const g = new THREE.Group();
  const hull = hullMaterial(colour, accent);
  const plate = plateMaterial(colour);
  const dark = darkMaterial();

  // Der Rumpf: breit und flach, vorn abgeschrägt.
  g.add(box(hull, 0.86, 0.3, 1.5, 0, 0, 0));
  g.add(box(hull, 0.62, 0.26, 0.7, 0, -0.02, 0.95, [0.12, 0, 0]));
  g.add(box(plate, 0.44, 0.16, 0.4, 0, -0.04, 1.35, [0.2, 0, 0]));

  // Die Kanzel sitzt tief und weit vorn, mit schwerem Rahmen.
  const canopy = box(glowMaterial(0x9fd4ff, 0.5), 0.36, 0.22, 0.62, 0, 0.2, 0.5, [0.1, 0, 0]);
  g.add(canopy);
  g.add(box(dark, 0.4, 0.06, 0.08, 0, 0.32, 0.78));
  g.add(box(dark, 0.06, 0.2, 0.6, 0, 0.22, 0.5));
  const pilot = box(dark, 0.16, 0.14, 0.16, 0, 0.16, 0.42);
  pilot.name = 'zier';
  g.add(pilot);
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), glowMaterial(0xdce9fb, 0.8));
  helm.position.set(0, 0.25, 0.44);
  helm.name = 'zier';
  g.add(helm);

  for (const side of [-1, 1]) {
    // Kurze, gekappte Flügel mit dickem Vorderholm.
    g.add(box(hull, 0.8, 0.1, 0.72, side * 0.78, -0.02, 0.05));
    g.add(box(plate, 0.8, 0.13, 0.2, side * 0.78, 0.0, 0.34));
    g.add(box(dark, 0.16, 0.2, 0.66, side * 1.14, 0.0, 0.0));
    // Die Triebwerksgondel: ein Kasten, nicht ein Rohr.
    g.add(box(hull, 0.36, 0.36, 1.15, side * 0.42, 0.02, -0.62));
    g.add(engine(dark, accent, 0.15, 0.34, side * 0.42, 0.02, -1.24, 1.1));
    g.add(engineGlow(accent, 0.2, side * 0.42, 0.02, -1.5));
    // Nach außen geneigtes Seitenleitwerk.
    g.add(box(hull, 0.07, 0.5, 0.44, side * 0.62, 0.32, -1.0, [0, 0, side * -0.34]));
    // Kanone unter dem Flügel, dazu eine Rakete.
    g.add(cannon(dark, accent, 0.04, 0.7, side * 0.98, -0.12, 0.3));
    const rocket = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.4, 6), dark);
    rocket.rotation.x = Math.PI / 2;
    rocket.position.set(side * 0.62, -0.16, 0.15);
    rocket.name = 'zier';
    g.add(rocket);
    g.add(nose(dark, 0.055, 0.2, side * 0.62, -0.16, 0.42, 5));
  }

  // Kennstreifen über dem Rücken und Plattennähte.
  g.add(box(glowMaterial(accent, 0.55), 0.1, 0.02, 0.9, 0, 0.16, -0.35));
  const seam = box(plate, 0.7, 0.03, 0.06, 0, 0.16, 0.1);
  seam.name = 'zier';
  g.add(seam);
  const port = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), glowMaterial(0xff5a4a));
  port.position.set(-1.22, 0.06, 0.05);
  port.name = 'licht';
  const stbd = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), glowMaterial(0x5affa0));
  stbd.position.set(1.22, 0.06, 0.05);
  stbd.name = 'licht';
  g.add(port, stbd);
  return g;
}

// Der schwere Bruder im selben Baukasten: zwei Sitze hintereinander, ein
// tiefer Waffenschacht, vier Gondeln. Die Torpedos hängen offen darin.
function terranBomber(colour, accent) {
  const g = new THREE.Group();
  const hull = hullMaterial(colour, accent, { metal: 0.5, rough: 0.5 });
  const plate = plateMaterial(colour);
  const dark = darkMaterial();

  g.add(box(hull, 1.05, 0.44, 2.0, 0, 0, 0));
  g.add(box(hull, 0.7, 0.36, 0.8, 0, -0.02, 1.2, [0.1, 0, 0]));
  g.add(box(plate, 0.5, 0.2, 0.44, 0, -0.04, 1.66, [0.18, 0, 0]));
  // Der Waffenschacht in der Wanne, offen, mit zwei Torpedos darin.
  g.add(box(dark, 0.66, 0.24, 1.1, 0, -0.3, 0.15));
  for (const side of [-1, 1]) {
    const torp = torpedoModel(accent, { armed: false });
    torp.scale.setScalar(0.8);
    torp.position.set(side * 0.18, -0.42, 0.2);
    torp.name = 'zier';
    g.add(torp);
  }
  // Zwei Kanzeln hintereinander, schwer gerahmt.
  g.add(box(glowMaterial(0x9fd4ff, 0.5), 0.42, 0.24, 0.5, 0, 0.28, 0.72, [0.08, 0, 0]));
  g.add(box(glowMaterial(0x9fd4ff, 0.4), 0.38, 0.2, 0.36, 0, 0.28, 0.24));
  g.add(box(dark, 0.44, 0.05, 0.06, 0, 0.42, 0.48));
  g.add(turret(plate, dark, 0.22, 0, 0.34, -0.55));

  for (const side of [-1, 1]) {
    g.add(box(hull, 0.9, 0.12, 0.9, side * 0.8, 0.0, -0.1));
    g.add(box(plate, 0.9, 0.15, 0.24, side * 0.8, 0.02, 0.28));
    // Zwei Gondeln je Seite, übereinander gestaffelt.
    g.add(box(hull, 0.32, 0.3, 1.0, side * 0.52, 0.02, -0.85));
    g.add(box(hull, 0.28, 0.26, 0.85, side * 1.05, -0.04, -0.7));
    g.add(engine(dark, accent, 0.15, 0.36, side * 0.52, 0.02, -1.42, 0.9));
    g.add(engine(dark, accent, 0.13, 0.32, side * 1.05, -0.04, -1.2, 0.8));
    g.add(engineGlow(accent, 0.2, side * 0.52, 0.02, -1.7));
    g.add(engineGlow(accent, 0.17, side * 1.05, -0.04, -1.45));
    // Hohes Seitenleitwerk, nach außen geneigt.
    g.add(box(hull, 0.08, 0.6, 0.5, side * 0.86, 0.38, -1.05, [0, 0, side * -0.3]));
    const strake = box(plate, 0.06, 0.14, 1.3, side * 0.46, 0.2, -0.1);
    strake.name = 'zier';
    g.add(strake);
  }
  runningLights(g, 1.24, -0.1);
  return g;
}

// Gilgamesch: Korvette. Ein Rumpf, zwei Türme, drei Düsen.
function terranCorvette(colour, accent) {
  const g = new THREE.Group();
  const hull = hullMaterial(colour, accent, { metal: 0.68, rough: 0.35 });
  const plate = plateMaterial(colour);
  const dark = darkMaterial();
  g.add(box(hull, 0.9, 0.62, 3.4, 0, 0, 0));
  g.add(nose(hull, 0.44, 1.1, 0, 0, 2.25, 6));
  g.add(box(hull, 0.6, 0.34, 1.0, 0, 0.44, -0.4));
  g.add(box(glowMaterial(0xbfe4ff, 0.55), 0.44, 0.1, 0.24, 0, 0.5, 0.05));
  g.add(mast(dark, 0.7, 0, 0.6, -0.9));
  for (const side of [-1, 1]) {
    g.add(turret(plate, dark, 0.22, side * 0.42, 0.34, 0.8));
    g.add(radiator(accent, plate, 1.0, 0.36, side * 0.5, -0.32, -1.1, side * 0.7));
    g.add(box(hull, 0.34, 0.1, 1.1, side * 0.66, -0.08, -0.6, [0, 0, side * 0.25]));
    g.add(box(glowMaterial(accent, 0.5), 0.03, 0.07, 2.2, side * 0.46, 0.04, 0.2));
  }
  g.add(engine(dark, accent, 0.2, 0.5, 0, -0.05, -1.9, 1.1));
  g.add(engine(dark, accent, 0.15, 0.45, -0.42, -0.05, -1.85, 0.9));
  g.add(engine(dark, accent, 0.15, 0.45, 0.42, -0.05, -1.85, 0.9));
  runningLights(g, 0.55, 0.2);
  return g;
}

// Tallahassee: Kreuzer. Hammerkopfbug, Türme auf dem Rücken, vier Düsen.
function terranCruiser(colour, accent) {
  const g = new THREE.Group();
  const hull = hullMaterial(colour, accent, { metal: 0.7, rough: 0.32 });
  const plate = plateMaterial(colour);
  const dark = darkMaterial();
  g.add(box(hull, 1.15, 0.8, 4.6, 0, 0, 0));
  g.add(box(hull, 2.0, 0.5, 1.1, 0, 0.05, 2.5));          // Hammerkopf
  g.add(nose(hull, 0.42, 0.9, 0, 0.05, 3.4, 6));
  g.add(box(hull, 0.75, 0.45, 1.7, 0, 0.6, -0.6));        // Aufbau
  g.add(box(glowMaterial(0xbfe4ff, 0.45), 0.5, 0.14, 0.3, 0, 0.78, 0.15));
  for (const side of [-1, 1]) {
    for (const z of [1.4, 0.2, -1.4]) {
      g.add(turret(plate, dark, 0.26, side * 0.42, 0.44, z, side * 0.2));
    }
    g.add(radiator(accent, plate, 1.4, 0.46, side * 0.68, -0.44, -1.5, side * 0.7));
    g.add(box(hull, 0.5, 0.14, 1.6, side * 0.82, -0.12, -1.0, [0, 0, side * 0.2]));
    g.add(box(glowMaterial(accent, 0.5), 0.03, 0.08, 3.0, side * 0.59, 0.06, 0.2));
    g.add(engine(dark, accent, 0.24, 0.6, side * 0.3, 0.12, -2.6, 1.2));
    g.add(engine(dark, accent, 0.24, 0.6, side * 0.3, -0.28, -2.6, 1.2));
    g.add(engineGlow(accent, 0.4, side * 0.3, -0.08, -3.1));
  }
  g.add(mast(dark, 0.9, 0, 0.82, -1.3));
  runningLights(g, 1.0, 2.4);
  return g;
}

// Die Tiger Claw, wie sie im Film fährt: ein langer, dunkler Stahlkasten,
// kein eleganter Keil. Das Flugdeck läuft fast über die ganze Länge, das
// Hangarmaul steht offen unter dem Bug, der Brückenturm sitzt weit achtern
// auf dem Rücken, und hinten sitzt ein schwerer Triebwerksblock mit vier
// Düsen. Die Flanken sind gerippt wie ein Schiffsrumpf.
function terranCarrier(colour, accent) {
  const g = new THREE.Group();
  const hull = hullMaterial(colour, accent, { metal: 0.66, rough: 0.45 });
  const plate = plateMaterial(colour);
  const dark = darkMaterial();

  // Der Rumpf: ein langer Kasten mit angeschrägtem Bug und tiefer Wanne.
  g.add(box(hull, 1.9, 1.15, 7.0, 0, -0.3, 0));
  g.add(box(hull, 1.5, 0.9, 1.2, 0, -0.3, 3.7, [0, 0, 0]));
  for (const side of [-1, 1]) {
    g.add(box(hull, 0.8, 1.0, 1.5, side * 0.55, -0.3, 3.4, [0, side * -0.2, 0]));
  }
  // Das Hangarmaul unter dem Bug - offen, von innen erleuchtet.
  g.add(box(dark, 1.5, 0.6, 1.5, 0, -0.62, 3.2));
  g.add(box(glowMaterial(accent, 0.75), 1.25, 0.4, 0.1, 0, -0.62, 3.94));
  g.add(box(glowMaterial(0xffc98a, 0.3), 1.2, 0.5, 0.08, 0, -0.62, 3.3));

  // Das Flugdeck: eine lange, flache Platte mit Mittelbahn und Aufzügen.
  g.add(box(plate, 2.6, 0.16, 6.4, 0, 0.36, 0.1));
  g.add(box(glowMaterial(accent, 0.7), 0.44, 0.03, 5.4, -0.3, 0.46, 0.1));
  for (const z of [2.1, 0.3, -1.5]) {
    const lift = box(dark, 0.9, 0.03, 0.72, 0.45, 0.46, z);
    lift.name = 'zier';
    g.add(lift);
  }
  // Die Deckbefeuerung entlang der Bahn.
  for (let i = 0; i < 8; i++) {
    const light = box(glowMaterial(i % 2 ? accent : 0xffb765, 0.9), 0.07, 0.05, 0.07,
      -1.2, 0.46, 2.6 - i * 0.75);
    light.name = 'licht';
    g.add(light);
  }

  // Der Brückenturm sitzt weit achtern, kantig und hoch.
  g.add(box(hull, 0.7, 0.9, 1.7, 0.72, 0.92, -1.5));
  g.add(box(hull, 0.5, 0.5, 1.0, 0.72, 1.55, -1.6));
  g.add(box(glowMaterial(0xbfe4ff, 0.7), 0.72, 0.12, 0.9, 0.72, 1.2, -1.2));
  g.add(box(glowMaterial(0xbfe4ff, 0.55), 0.52, 0.1, 0.6, 0.72, 1.72, -1.5));
  g.add(mast(dark, 1.2, 0.72, 1.9, -2.1));
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  dish.rotation.set(-0.5, 0, 0);
  dish.position.set(0.72, 1.9, -1.9);
  dish.name = 'zier';
  g.add(dish);

  // Der Triebwerksblock am Heck: ein Kasten mit vier schweren Düsen.
  g.add(box(hull, 1.85, 1.1, 1.1, 0, -0.25, -3.4));
  for (const side of [-1, 1]) {
    for (const y of [0.1, -0.6]) {
      g.add(engine(dark, accent, 0.28, 0.7, side * 0.5, y, -4.1, 1.3));
      g.add(engineGlow(accent, 0.44, side * 0.5, y, -4.7));
    }
  }

  for (const side of [-1, 1]) {
    // Katapultwulst und Geschützstände am Deckrand.
    g.add(box(hull, 0.28, 0.26, 2.8, side * 1.42, 0.14, 0.3));
    for (const z of [2.2, -0.2, -2.4]) {
      g.add(turret(plate, dark, 0.2, side * 1.4, 0.46, z, side * 0.5));
    }
    // Die gerippte Flanke - das, was einen Kasten zu einem Schiff macht.
    for (let i = 0; i < 7; i++) {
      const rib = box(dark, 0.14, 0.62, 0.3, side * 0.98, -0.42, 2.2 - i * 0.8);
      rib.name = 'zier';
      g.add(rib);
    }
    for (let i = 0; i < 4; i++) {
      const hatch = box(plate, 0.16, 0.24, 0.5, side * 0.96, 0.02, 1.4 - i * 1.1);
      hatch.name = 'zier';
      g.add(hatch);
    }
    g.add(radiator(accent, plate, 1.7, 0.55, side * 1.12, -0.75, -2.0, side * 0.75));
    g.add(box(glowMaterial(accent, 0.5), 0.04, 0.09, 4.6, side * 0.96, 0.16, 0.2));
  }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), glowMaterial(0xff5a4a));
  beacon.position.set(0.72, 2.5, -2.1);
  beacon.name = 'licht';
  g.add(beacon);
  runningLights(g, 1.4, 3.2);
  return g;
}

// Marineinfanterie fliegt in Landungsschiffen: kastig, mit Bugklappe.
function terranTransport(colour, accent) {
  const g = new THREE.Group();
  const hull = hullMaterial(colour, accent, { metal: 0.45, rough: 0.6 });
  const plate = plateMaterial(colour);
  const dark = darkMaterial();
  g.add(box(hull, 1.0, 0.8, 2.6, 0, 0, 0));
  g.add(box(dark, 0.8, 0.6, 0.3, 0, -0.05, 1.42));
  g.add(box(hull, 0.5, 0.3, 0.6, 0, 0.5, 0.7));
  // Kanzelband, Sturmklappe und ein Turm über der Luke: ein Landungsschiff
  // fliegt dorthin, wo geschossen wird.
  g.add(box(glowMaterial(0x9fd4ff, 0.55), 0.42, 0.14, 0.16, 0, 0.56, 0.98));
  g.add(box(plate, 0.86, 0.1, 0.5, 0, -0.36, 1.2, [0.5, 0, 0]));
  g.add(turret(plate, dark, 0.18, 0, 0.42, -0.5));
  for (const side of [-1, 1]) {
    g.add(box(dark, 0.22, 0.5, 1.4, side * 0.65, 0, -0.3));
    g.add(engine(dark, accent, 0.2, 0.45, side * 0.65, 0, -1.35, 0.8));
    // Streben und Ladeluken an der Flanke.
    const rib = box(plate, 0.08, 0.5, 0.2, side * 0.52, 0.05, 0.4);
    rib.name = 'zier';
    g.add(rib);
  }
  runningLights(g, 0.78, 0.9);
  return g;
}

// --- Klanwerften von Kilrah ---------------------------------------------

// Dralthi, wie ihn der Film zeigt: dunkle Bronze, ein breiter Flügel, der
// sich nach vorn krümmt wie zwei Flügelschläge, die Spitzen nach unten
// gebogen, dazwischen ein gedrungener Pod mit geteilter Kanzel. Kein Rumpf,
// den man von vorn trifft.
function kilrathiFighter(colour, accent) {
  const g = new THREE.Group();
  const hull = hullMaterial(colour, accent, { metal: 0.55, rough: 0.45 });
  const plate = plateMaterial(colour);
  const dark = darkMaterial();

  // Der Pod in der Mitte: flach, breit, hinten abfallend.
  const pod = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), hull);
  pod.scale.set(1.15, 0.5, 1.4);
  g.add(pod);
  g.add(nose(hull, 0.24, 0.6, 0, -0.02, 0.7, 5));
  g.add(box(plate, 0.42, 0.1, 0.5, 0, 0.12, -0.3));

  for (const side of [-1, 1]) {
    // Der Flügel in drei Segmenten, jedes weiter nach vorn gedreht.
    g.add(box(hull, 0.95, 0.09, 0.7, side * 0.58, 0, 0.02, [0, side * 0.34, side * 0.06]));
    g.add(box(hull, 0.7, 0.08, 0.5, side * 1.22, 0.02, 0.34, [0, side * 0.64, side * 0.16]));
    // Die Spitze knickt nach unten.
    g.add(box(hull, 0.4, 0.08, 0.34, side * 1.6, -0.14, 0.6, [0, side * 0.9, side * 0.6]));
    // Rippen auf der Oberseite, wie Sehnen über einer Schwinge.
    for (let i = 0; i < 3; i++) {
      const rib = box(dark, 0.05, 0.05, 0.4, side * (0.5 + i * 0.36), 0.06, 0.1 + i * 0.12,
        [0, side * (0.3 + i * 0.16), 0]);
      rib.name = 'zier';
      g.add(rib);
    }
    // Neutronenkanone in der Flügelwurzel.
    g.add(cannon(dark, accent, 0.038, 0.56, side * 0.42, -0.06, 0.62));
  }

  // Die geteilte Kanzel: zwei bernsteinfarbene Scheiben unter einem Steg.
  for (const side of [-1, 1]) {
    const pane = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), glowMaterial(0xffc98a, 0.55));
    pane.scale.set(0.9, 0.6, 1.25);
    pane.position.set(side * 0.11, 0.14, 0.22);
    g.add(pane);
  }
  g.add(box(dark, 0.05, 0.1, 0.6, 0, 0.18, 0.22));
  const pilot = box(dark, 0.2, 0.12, 0.16, 0, 0.08, 0.14);
  pilot.name = 'zier';
  g.add(pilot);

  // Zwei Düsen im Heck des Pods, dazu der Kammstreifen.
  for (const side of [-1, 1]) {
    g.add(engine(dark, accent, 0.15, 0.34, side * 0.2, -0.02, -0.7));
    g.add(engineGlow(accent, 0.18, side * 0.2, -0.02, -0.98));
  }
  g.add(box(glowMaterial(accent, 0.55), 0.06, 0.02, 0.6, 0, 0.2, -0.15));
  const port = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), glowMaterial(0xff5a4a));
  port.position.set(-1.74, -0.16, 0.72);
  port.name = 'licht';
  const stbd = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), glowMaterial(0x5affa0));
  stbd.position.set(1.74, -0.16, 0.72);
  stbd.name = 'licht';
  g.add(port, stbd);
  return g;
}

// Paktahn: der Bomber des Imperiums. Breit, schwer, mit Torpedoklauen.
function kilrathiBomber(colour, accent) {
  const g = new THREE.Group();
  const hull = hullMaterial(colour, accent, { metal: 0.5, rough: 0.5 });
  const plate = plateMaterial(colour);
  const dark = darkMaterial();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), hull);
  body.scale.set(1.1, 0.7, 1.9);
  g.add(body);
  g.add(nose(hull, 0.3, 0.8, 0, 0, 1.3, 5));
  // Kanzel mit Rahmen - der Paktahn fliegt mit zwei Mann.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), glowMaterial(0xffc98a, 0.5));
  canopy.scale.set(1, 0.7, 1.5);
  canopy.position.set(0, 0.26, 0.5);
  g.add(canopy);
  g.add(box(dark, 0.3, 0.05, 0.05, 0, 0.4, 0.5));
  // Rückenturm und Kammstreifen.
  g.add(turret(plate, dark, 0.2, 0, 0.3, -0.6));
  g.add(box(glowMaterial(accent, 0.55), 0.05, 0.03, 0.9, 0, 0.36, -0.1));
  for (const side of [-1, 1]) {
    g.add(box(hull, 1.1, 0.1, 0.8, side * 0.8, -0.05, -0.1, [0, side * 0.3, side * 0.18]));
    // In der Klaue hängt ein Torpedo, offen und geladen.
    g.add(box(dark, 0.16, 0.16, 0.9, side * 1.2, -0.14, 0.1));
    const torp = torpedoModel(accent, { armed: false });
    torp.scale.setScalar(0.75);
    torp.position.set(side * 1.2, -0.3, 0.16);
    torp.name = 'zier';
    g.add(torp);
    g.add(engine(dark, accent, 0.19, 0.45, side * 0.34, 0, -1.2, 0.9));
    g.add(engineGlow(accent, 0.21, side * 0.34, 0, -1.55));
  }
  runningLights(g, 1.3, -0.1);
  return g;
}

// Kamekh: die Korvette. Eine Klinge mit Rückenkamm.
function kilrathiCorvette(colour, accent) {
  const g = new THREE.Group();
  const hull = hullMaterial(colour, accent, { metal: 0.6, rough: 0.42 });
  const plate = plateMaterial(colour);
  const dark = darkMaterial();
  g.add(box(hull, 0.8, 0.5, 3.2, 0, 0, 0, [0, 0, 0]));
  g.add(nose(hull, 0.45, 1.6, 0, 0, 2.3, 4));
  g.add(box(hull, 0.12, 0.5, 2.0, 0, 0.45, -0.3));            // Kamm
  // Ein glühendes Auge am Bug: das Kennzeichen kilrathischer Klingen.
  g.add(box(glowMaterial(accent, 0.7), 0.3, 0.06, 0.5, 0, 0.1, 1.7));
  for (const side of [-1, 1]) {
    g.add(box(hull, 0.6, 0.1, 1.2, side * 0.6, -0.12, -0.8, [0, 0, side * 0.35]));
    g.add(turret(plate, dark, 0.2, side * 0.35, 0.28, 0.9, side * -0.3));
    g.add(radiator(accent, plate, 0.9, 0.34, side * 0.46, -0.3, -0.9, side * 0.7));
    g.add(engine(dark, accent, 0.2, 0.5, side * 0.28, -0.05, -1.8, 1.1));
  }
  runningLights(g, 0.7, 0.6);
  return g;
}

// Fralthi: der Kreuzer. Ein Keil mit Kamm und aufgesetzten Türmen.
function kilrathiCruiser(colour, accent) {
  const g = new THREE.Group();
  const hull = hullMaterial(colour, accent, { metal: 0.62, rough: 0.4 });
  const plate = plateMaterial(colour);
  const dark = darkMaterial();
  g.add(box(hull, 1.3, 0.85, 4.4, 0, 0, 0));
  g.add(nose(hull, 0.7, 2.2, 0, 0, 3.2, 4));
  g.add(box(hull, 0.16, 0.9, 3.0, 0, 0.8, -0.4));             // Rückenkamm
  g.add(box(hull, 0.16, 0.6, 2.0, 0, -0.65, -0.6));           // Kiel
  for (const side of [-1, 1]) {
    g.add(box(hull, 0.9, 0.14, 1.8, side * 0.9, -0.1, -0.9, [0, 0, side * 0.3]));
    for (const z of [1.2, -0.6]) {
      g.add(turret(plate, dark, 0.26, side * 0.45, 0.44, z, side * 0.25));
    }
    g.add(radiator(accent, plate, 1.3, 0.44, side * 0.74, -0.46, -1.6, side * 0.7));
    g.add(engine(dark, accent, 0.26, 0.62, side * 0.36, 0, -2.5, 1.2));
    g.add(engineGlow(accent, 0.34, side * 0.36, 0, -3.0));
  }
  g.add(box(glowMaterial(accent, 0.7), 0.4, 0.08, 0.7, 0, 0.1, 2.4));
  runningLights(g, 0.85, 2.0);
  return g;
}

// Snakeir: der Klanträger. Eine Klinge mit Hangarschlund und Kammrücken.
function kilrathiCarrier(colour, accent) {
  const g = new THREE.Group();
  const hull = hullMaterial(colour, accent, { metal: 0.6, rough: 0.45 });
  const plate = plateMaterial(colour);
  const dark = darkMaterial();
  g.add(box(hull, 2.0, 1.2, 6.4, 0, 0, 0));
  g.add(nose(hull, 1.0, 2.6, 0, 0, 4.4, 4));
  g.add(box(hull, 0.2, 1.5, 4.4, 0, 1.2, -0.6));              // Rückenkamm
  g.add(box(dark, 1.4, 0.7, 1.0, 0, -0.35, 3.0));             // Hangarschlund
  g.add(box(glowMaterial(accent, 0.8), 1.1, 0.44, 0.1, 0, -0.35, 3.52));
  g.add(box(glowMaterial(accent, 0.5), 0.06, 0.1, 3.6, 0, 1.9, -0.6));
  for (const side of [-1, 1]) {
    g.add(box(hull, 1.4, 0.2, 2.6, side * 1.4, -0.2, -0.6, [0, 0, side * 0.28]));
    for (const z of [1.8, 0.2, -1.6]) {
      g.add(turret(plate, dark, 0.28, side * 0.8, 0.6, z, side * 0.35));
    }
    g.add(radiator(accent, plate, 1.6, 0.5, side * 1.15, -0.78, -1.9, side * 0.7));
    g.add(engine(dark, accent, 0.36, 0.8, side * 0.6, -0.1, -3.6, 1.3));
    g.add(engine(dark, accent, 0.24, 0.6, side * 1.5, -0.3, -3.4, 1.0));
    g.add(engineGlow(accent, 0.56, side * 0.6, -0.1, -4.2));
    g.add(engineGlow(accent, 0.4, side * 1.5, -0.3, -3.95));
  }
  // Rippen über dem Rückenkamm - der Klanträger trägt sein Skelett außen.
  for (let i = 0; i < 5; i++) {
    g.add(box(hull, 0.5, 0.24, 0.16, 0, 1.5, 1.4 - i * 0.9));
  }
  // Zähne am Hangarschlund.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      g.add(nose(hull, 0.12, 0.5, side * (0.25 + i * 0.22), -0.05, 3.3, 4));
    }
    // Seitenflossen mit glühender Kante
    g.add(box(hull, 0.16, 1.1, 1.6, side * 1.9, 0.4, -1.4, [0, 0, side * 0.2]));
    g.add(box(glowMaterial(accent, 0.6), 0.05, 0.08, 1.4, side * 2.05, 0.92, -1.4));
  }
  // Der Schlund glüht von innen - ein Klanträger holt seine Staffeln ein,
  // ohne das Licht auszumachen.
  g.add(box(glowMaterial(0xffc98a, 0.4), 1.1, 0.5, 0.06, 0, -0.35, 3.2));
  g.add(mast(dark, 1.0, 0, 2.0, -2.4));
  // Kommandoblister auf dem Rücken.
  const blister = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8), hull);
  blister.scale.set(1, 0.6, 1.4);
  blister.position.set(0, 0.62, -1.9);
  g.add(blister);
  g.add(box(glowMaterial(0xffc98a, 0.7), 0.5, 0.06, 0.24, 0, 0.72, -1.55));
  runningLights(g, 1.6, 2.6);
  return g;
}

function kilrathiTransport(colour, accent) {
  const g = new THREE.Group();
  const hull = hullMaterial(colour, accent, { metal: 0.45, rough: 0.6 });
  const plate = plateMaterial(colour);
  const dark = darkMaterial();
  g.add(box(hull, 1.1, 0.9, 2.4, 0, 0, 0));
  g.add(nose(hull, 0.6, 1.2, 0, 0, 1.7, 4));
  g.add(box(hull, 0.14, 0.5, 1.6, 0, 0.68, -0.2));
  g.add(box(glowMaterial(accent, 0.6), 0.26, 0.06, 0.4, 0, 0.06, 1.5));
  g.add(turret(plate, dark, 0.18, 0, 0.5, 0.5));
  for (const side of [-1, 1]) {
    g.add(engine(dark, accent, 0.22, 0.5, side * 0.4, 0, -1.35, 0.9));
    const pod = box(plate, 0.16, 0.4, 1.0, side * 0.6, -0.05, -0.2);
    pod.name = 'zier';
    g.add(pod);
  }
  runningLights(g, 0.72, 0.4);
  return g;
}

// --- Firekka: Schwingen statt Rümpfe ------------------------------------
function firekkanFighter(colour, accent) {
  const g = new THREE.Group();
  const hull = hullMaterial(colour, accent, { metal: 0.3, rough: 0.65 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), hull);
  body.scale.set(0.9, 0.8, 1.8);
  g.add(body);
  g.add(nose(hull, 0.18, 0.8, 0, 0.05, 0.9, 5));
  for (const side of [-1, 1]) {
    // Drei Federn je Seite, nach hinten gefächert.
    for (let i = 0; i < 3; i++) {
      g.add(box(hull, 1.0 - i * 0.18, 0.05, 0.22, side * (0.55 + i * 0.12), i * 0.06,
        -0.1 - i * 0.28, [0, side * (0.25 + i * 0.12), side * (0.12 + i * 0.08)]));
    }
  }
  g.add(box(hull, 0.06, 0.4, 0.5, 0, 0.28, -0.6));
  // Die Firekka bauen keine Kanzeln: sie sehen hinaus. Ein Augenband am Bug,
  // dazu leuchtende Federkanten.
  g.add(box(glowMaterial(0xffe1a0, 0.75), 0.22, 0.07, 0.16, 0, 0.14, 0.52));
  for (const side of [-1, 1]) {
    const quill = box(glowMaterial(accent, 0.5), 0.7, 0.02, 0.04, side * 0.62, 0.02, -0.2,
      [0, side * 0.28, side * 0.14]);
    quill.name = 'zier';
    g.add(quill);
  }
  g.add(engine(darkMaterial(), accent, 0.13, 0.3, 0, 0, -0.85, 0.7));
  g.add(engineGlow(accent, 0.14, 0, 0, -1.05));
  return g;
}

function firekkanCapital(colour, accent, scale = 1) {
  const g = new THREE.Group();
  const hull = hullMaterial(colour, accent, { metal: 0.35, rough: 0.6 });
  const dark = darkMaterial();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.7 * scale, 12, 9), hull);
  body.scale.set(1, 0.7, 2.6);
  g.add(body);
  g.add(nose(hull, 0.5 * scale, 1.6 * scale, 0, 0, 2.2 * scale, 6));
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      g.add(box(hull, (1.9 - i * 0.3) * scale, 0.08, 0.4 * scale,
        side * (1.0 + i * 0.16) * scale, i * 0.1, (-0.3 - i * 0.5) * scale,
        [0, side * (0.2 + i * 0.1), side * (0.1 + i * 0.06)]));
    }
    g.add(engine(dark, accent, 0.2 * scale, 0.5 * scale, side * 0.5 * scale, 0, -2.2 * scale, 1));
  }
  return g;
}

// --- Der Schwarm: gewachsen, nicht gebaut -------------------------------
function nephilimShip(colour, accent, scale = 1) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({
    color: colour, emissive: new THREE.Color(accent).multiplyScalar(0.4),
    emissiveIntensity: 0.5, metalness: 0.1, roughness: 0.85, flatShading: true,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.6 * scale, 10, 8), skin);
  body.scale.set(1, 0.8, 1.8);
  g.add(body);
  g.add(nose(skin, 0.34 * scale, 1.1 * scale, 0, 0, 1.4 * scale, 6));
  // Ranken statt Flügel
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07 * scale, 0.02 * scale, 1.5 * scale, 5), skin,
    );
    arm.position.set(Math.cos(a) * 0.45 * scale, Math.sin(a) * 0.35 * scale, -0.9 * scale);
    arm.rotation.set(Math.PI / 2 + 0.25, 0, a);
    g.add(arm);
  }
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.2 * scale, 8, 6), glowMaterial(accent, 0.8));
  core.position.z = 0.3 * scale;
  g.add(core);
  // Adern über der Haut und zwei Beißzangen am Bug - der Schwarm ist
  // gewachsen, und man sieht ihm an, dass er lebt.
  for (const side of [-1, 1]) {
    const vein = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02 * scale, 0.02 * scale, 1.6 * scale, 4),
      glowMaterial(accent, 0.55),
    );
    vein.rotation.set(Math.PI / 2, 0, side * 0.16);
    vein.position.set(side * 0.3 * scale, 0.25 * scale, 0.1 * scale);
    vein.name = 'zier';
    g.add(vein);
    const fang = new THREE.Mesh(new THREE.ConeGeometry(0.09 * scale, 0.8 * scale, 5), skin);
    fang.rotation.set(Math.PI / 2, 0, side * 0.3);
    fang.position.set(side * 0.26 * scale, -0.14 * scale, 1.5 * scale);
    fang.name = 'zier';
    g.add(fang);
  }
  return g;
}

// --- Auswahl --------------------------------------------------------------
const BUILDERS = {
  terran: {
    jaeger: terranFighter,
    bomber: terranBomber,
    korvette: terranCorvette,
    kreuzer: terranCruiser,
    traeger: terranCarrier,
    marines: terranTransport,
    wache: terranCorvette,
  },
  kilrathi: {
    jaeger: kilrathiFighter,
    bomber: kilrathiBomber,
    korvette: kilrathiCorvette,
    kreuzer: kilrathiCruiser,
    traeger: kilrathiCarrier,
    marines: kilrathiTransport,
    wache: kilrathiCorvette,
  },
  firekkan: {
    jaeger: firekkanFighter,
    bomber: (c, a) => firekkanCapital(c, a, 0.55),
    korvette: (c, a) => firekkanCapital(c, a, 0.8),
    kreuzer: (c, a) => firekkanCapital(c, a, 1.1),
    traeger: (c, a) => firekkanCapital(c, a, 1.5),
    marines: (c, a) => firekkanCapital(c, a, 0.6),
    wache: (c, a) => firekkanCapital(c, a, 0.7),
  },
  nephilim: {
    jaeger: (c, a) => nephilimShip(c, a, 0.7),
    bomber: (c, a) => nephilimShip(c, a, 1),
    korvette: (c, a) => nephilimShip(c, a, 1.3),
    kreuzer: (c, a) => nephilimShip(c, a, 1.8),
    traeger: (c, a) => nephilimShip(c, a, 2.6),
    marines: (c, a) => nephilimShip(c, a, 1),
    wache: (c, a) => nephilimShip(c, a, 1.1),
  },
};

// Wie lang ein Schiff seiner Klasse nach ist - daran wird der Maßstab auf der
// Karte gerechnet, damit ein Träger neben einem Jäger nach Träger aussieht.
export const SHIP_LENGTH = {
  jaeger: 3, bomber: 3.4, korvette: 5, kreuzer: 6.6, traeger: 9, marines: 3.6, wache: 4,
};

// Ein Modell für Fraktionsart und Rolle. Es wird einmal gebaut und danach
// geklont: Geometrie und Werkstoff teilen sich alle Kopien.
// `detail: 'low'` lässt Schleppfahnen, Positionslichter und Kleinzeug weg.
// Auf der Karte sieht man davon nichts, im Gefecht alles. Das kostet
// wenig Bild und viel Rechenzeit - im Gefecht fliegen zwei Dutzend Schiffe
// gleichzeitig, und durchsichtige Flächen sind das Teuerste daran.
export function shipModel(kind, role, colour, accent, { scale = 1, detail = 'full' } = {}) {
  const key = `${kind}|${role}|${colour}|${accent}`;
  let master = modelCache.get(key);
  if (!master) {
    const table = BUILDERS[kind] || BUILDERS.terran;
    const build = table[role] || table.jaeger;
    master = build(colour, accent);
    modelCache.set(key, master);
  }
  const clone = master.clone(true);
  if (detail === 'low') {
    const drop = [];
    clone.traverse((node) => {
      if (node.name === 'flamme' || node.name === 'licht' || node.name === 'zier') drop.push(node);
    });
    for (const node of drop) node.parent.remove(node);
  }
  if (scale !== 1) clone.scale.setScalar(scale);
  return clone;
}

// Die schwerste Klasse einer Flotte - sie gibt der Flotte ihr Gesicht.
const WEIGHT = ['traeger', 'kreuzer', 'korvette', 'bomber', 'marines', 'jaeger'];
export function flagshipRole(fleet) {
  for (const role of WEIGHT) {
    if (fleet.units.some((u) => u.role === role && u.count > 0)) return role;
  }
  return 'jaeger';
}
