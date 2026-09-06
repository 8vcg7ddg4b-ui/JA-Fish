// --- Umgebungslicht als Spiegelbild -------------------------------------
// Metallische Werkstoffe (metalness > 0) sind ohne Umgebung fast schwarz:
// sie haben nichts, was sie spiegeln könnten. Diese Hilfe malt eine kleine
// Himmelskugel in eine Leinwand, lässt three.js sie zu einer Umgebungskarte
// verrechnen und hängt sie an die Szene. Kein Netz, keine Datei - ein paar
// Farbverläufe genügen.
window.__buildEnvMap = function (renderer, art) {
  if (typeof THREE === 'undefined' || !renderer) return null;
  var W = 512, H = 256;
  var cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  var g = cv.getContext('2d');

  function radial(x, y, r, inner, outer) {
    var rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, inner);
    rg.addColorStop(1, outer);
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
  }

  if (art === 'raum') {
    // Schwarzer Raum: ein kalter Hauptschein, ein warmer Gegenschein, unten
    // das Streulicht eines Planeten.
    var lg = g.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0, '#060e1b');
    lg.addColorStop(0.55, '#03070e');
    lg.addColorStop(1, '#0a111d');
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    radial(W * 0.22, H * 0.3, W * 0.34, 'rgba(150,205,255,0.6)', 'rgba(150,205,255,0)');
    radial(W * 0.78, H * 0.46, W * 0.3, 'rgba(255,176,96,0.3)', 'rgba(255,176,96,0)');
    radial(W * 0.52, H * 0.9, W * 0.36, 'rgba(70,120,190,0.32)', 'rgba(70,120,190,0)');
    g.globalCompositeOperation = 'source-over';
  } else {
    // Tageslicht: heller Himmel oben, warmer Boden unten, die Sonne als
    // Fleck im oberen Drittel.
    var sg = g.createLinearGradient(0, 0, 0, H);
    sg.addColorStop(0, '#61758a');
    sg.addColorStop(0.46, '#4a5c70');
    sg.addColorStop(0.54, '#42392e');
    sg.addColorStop(1, '#2b241b');
    g.fillStyle = sg;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    radial(W * 0.3, H * 0.22, W * 0.26, 'rgba(255,244,214,0.35)', 'rgba(255,244,214,0)');
    g.globalCompositeOperation = 'source-over';
  }

  var tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
  var pmrem = new THREE.PMREMGenerator(renderer);
  var env = null;
  try {
    pmrem.compileEquirectangularShader();
    env = pmrem.fromEquirectangular(tex).texture;
  } catch (err) {
    env = null;
  }
  pmrem.dispose();
  tex.dispose();
  return env;
};
