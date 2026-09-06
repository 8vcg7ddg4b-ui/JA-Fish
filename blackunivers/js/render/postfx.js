// --- Nachbearbeitung: Leuchten und Miniatur-Unschärfe ----------------------
// Beide Spiele zeichneten bisher direkt auf den Schirm. Alles, was danach
// käme, fehlte: ein Triebwerk strahlte zwar in seiner Farbe, aber es blendete
// nicht, und die Karte auf dem Tisch sah aus wie eine Landschaft, nicht wie
// ein Modell.
//
// Diese Kette hängt sich zwischen Szene und Schirm:
//
//   Szene  ->  Ziel (halbe Zahlen, damit Werte über Weiß erhalten bleiben)
//          ->  Heller Auszug (nur, was über der Schwelle liegt)   [halbe Größe]
//          ->  zwei Unschärfen, waagerecht und senkrecht          [halbe Größe]
//          ->  Zusammensetzen: Szene + Leuchten, Tonwerte, sRGB
//
// Für die Miniatur-Unschärfe wird zusätzlich die Szene selbst weichgezeichnet
// und oben und unten eingeblendet - das ist der Trick, mit dem ein Foto einer
// echten Landschaft wie eine Modelleisenbahn aussieht.
//
// Wichtig: die Tonwertabbildung wandert damit vom Renderer in den letzten
// Durchgang. Nur so wird das Leuchten addiert, *bevor* die Helligkeit
// zusammengedrückt wird - andersherum bliebe von einem hellen Triebwerk nach
// dem Zusammendrücken nichts übrig, was noch strahlen könnte.
window.__makePostFX = function (renderer, opts) {
  if (!renderer || typeof THREE === 'undefined') return null;
  opts = opts || {};
  const bloom = opts.bloom || null;
  const tilt = opts.tilt || null;
  if (!bloom && !tilt) return null;

  const groesse = new THREE.Vector2();
  renderer.getDrawingBufferSize(groesse);
  let breite = Math.max(2, groesse.x);
  let hoehe = Math.max(2, groesse.y);

  const halbfloat = THREE.HalfFloatType !== undefined ? THREE.HalfFloatType : undefined;
  function ziel(w, h, hdr) {
    const rt = new THREE.WebGLRenderTarget(Math.max(2, Math.round(w)), Math.max(2, Math.round(h)), {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: hdr && halbfloat ? halbfloat : THREE.UnsignedByteType,
      depthBuffer: hdr === true,
      stencilBuffer: false,
    });
    return rt;
  }

  // Die Szene braucht Tiefe, die Zwischenziele nicht.
  let rtSzene = ziel(breite, hoehe, true);
  const teiler = 2;
  let rtA = ziel(breite / teiler, hoehe / teiler, true);
  let rtB = ziel(breite / teiler, hoehe / teiler, true);
  let rtWeich = tilt ? ziel(breite / teiler, hoehe / teiler, true) : null;
  let rtWeich2 = tilt ? ziel(breite / teiler, hoehe / teiler, true) : null;

  // Eine Fläche, ein Bild: alle Durchgänge zeichnen dasselbe Rechteck.
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadSzene = new THREE.Scene();
  const quadMesh = new THREE.Mesh(quadGeo, null);
  quadMesh.frustumCulled = false;
  quadSzene.add(quadMesh);

  const KOPF = `
    precision highp float;
    varying vec2 vUv;
  `;
  const ECKPUNKTE = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  // 1. Der helle Auszug ------------------------------------------------------
  const matHell = new THREE.RawShaderMaterial({
    uniforms: {
      tBild: { value: null },
      uSchwelle: { value: bloom ? (bloom.schwelle ?? 0.72) : 0.72 },
      uWeich: { value: 0.3 },
    },
    vertexShader: 'precision highp float;\nattribute vec3 position;\nattribute vec2 uv;\n' + ECKPUNKTE,
    fragmentShader: KOPF + `
      uniform sampler2D tBild;
      uniform float uSchwelle;
      uniform float uWeich;
      void main() {
        vec4 c = texture2D(tBild, vUv);
        float helligkeit = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        float k = smoothstep(uSchwelle, uSchwelle + uWeich, helligkeit);
        gl_FragColor = vec4(c.rgb * k, 1.0);
      }
    `,
  });

  // 2. Die Unschärfe ---------------------------------------------------------
  // Neun Abtastungen mit den Gewichten einer Glockenkurve, einmal waagerecht
  // und einmal senkrecht - zusammen dasselbe Ergebnis wie einundachtzig
  // Abtastungen in einem Durchgang, für ein Fünftel der Arbeit.
  const matWeich = new THREE.RawShaderMaterial({
    uniforms: {
      tBild: { value: null },
      uSchritt: { value: new THREE.Vector2(1, 0) },
    },
    vertexShader: 'precision highp float;\nattribute vec3 position;\nattribute vec2 uv;\n' + ECKPUNKTE,
    fragmentShader: KOPF + `
      uniform sampler2D tBild;
      uniform vec2 uSchritt;
      void main() {
        float g[5];
        g[0] = 0.227027; g[1] = 0.194594; g[2] = 0.121621; g[3] = 0.054054; g[4] = 0.016216;
        vec3 summe = texture2D(tBild, vUv).rgb * g[0];
        for (int i = 1; i < 5; i++) {
          vec2 v = uSchritt * float(i);
          summe += texture2D(tBild, vUv + v).rgb * g[i];
          summe += texture2D(tBild, vUv - v).rgb * g[i];
        }
        gl_FragColor = vec4(summe, 1.0);
      }
    `,
  });

  // 3. Zusammensetzen --------------------------------------------------------
  const matFertig = new THREE.RawShaderMaterial({
    uniforms: {
      tSzene: { value: null },
      tLeuchten: { value: null },
      tWeich: { value: null },
      uLeuchten: { value: bloom ? (bloom.staerke ?? 0.85) : 0.0 },
      uTilt: { value: tilt ? (tilt.staerke ?? 0.85) : 0.0 },
      uTiltMitte: { value: tilt ? (tilt.mitte ?? 0.46) : 0.5 },
      uTiltBreite: { value: tilt ? (tilt.breite ?? 0.3) : 1.0 },
      uBelichtung: { value: opts.belichtung ?? 1.0 },
      uSaettigung: { value: opts.saettigung ?? 1.0 },
      uVignette: { value: opts.vignette ?? 0.0 },
    },
    vertexShader: 'precision highp float;\nattribute vec3 position;\nattribute vec2 uv;\n' + ECKPUNKTE,
    fragmentShader: KOPF + `
      uniform sampler2D tSzene;
      uniform sampler2D tLeuchten;
      uniform sampler2D tWeich;
      uniform float uLeuchten;
      uniform float uTilt;
      uniform float uTiltMitte;
      uniform float uTiltBreite;
      uniform float uBelichtung;
      uniform float uSaettigung;
      uniform float uVignette;

      ${opts.kurve === 'aces' ? `
      // ACES, die genäherte Fassung von Krzysztof Narkowicz - kurz genug für
      // einen Durchgang, nah genug an der langen.
      vec3 tonwerte(vec3 x) {
        const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
        return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
      }` : `
      vec3 tonwerte(vec3 x) { return clamp(x, 0.0, 1.0); }`}

      // Von Hand, weil ein RawShaderMaterial keine Bausteine von three
      // eingesetzt bekommt: ein #include bliebe wörtlich im Quelltext stehen
      // und der Schattierer ließe sich nicht übersetzen - der Schirm bliebe
      // schwarz. (Genau das ist beim ersten Versuch passiert.)
      vec3 nachSRGB(vec3 c) {
        c = clamp(c, 0.0, 1.0);
        return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
      }

      void main() {
        vec3 farbe = texture2D(tSzene, vUv).rgb;
        if (uTilt > 0.0) {
          // Scharf in einem Band um uTiltMitte, nach oben und unten weich.
          float d = abs(vUv.y - uTiltMitte);
          float k = smoothstep(uTiltBreite * 0.5, uTiltBreite * 0.5 + 0.34, d);
          farbe = mix(farbe, texture2D(tWeich, vUv).rgb, k * uTilt);
        }
        if (uLeuchten > 0.0) {
          farbe += texture2D(tLeuchten, vUv).rgb * uLeuchten;
        }
        farbe *= uBelichtung;
        farbe = tonwerte(farbe);
        if (uSaettigung != 1.0) {
          float grau = dot(farbe, vec3(0.2126, 0.7152, 0.0722));
          farbe = mix(vec3(grau), farbe, uSaettigung);
        }
        if (uVignette > 0.0) {
          vec2 m = vUv - 0.5;
          farbe *= 1.0 - uVignette * dot(m, m) * 2.0;
        }
        gl_FragColor = vec4(nachSRGB(farbe), 1.0);
      }
    `,
  });

  function zeichneQuad(material, ziel2) {
    quadMesh.material = material;
    renderer.setRenderTarget(ziel2 || null);
    renderer.render(quadSzene, quadCam);
  }

  function pruefeGroesse() {
    renderer.getDrawingBufferSize(groesse);
    const w = Math.max(2, groesse.x);
    const h = Math.max(2, groesse.y);
    if (w === breite && h === hoehe) return;
    breite = w;
    hoehe = h;
    rtSzene.setSize(breite, hoehe);
    rtA.setSize(breite / teiler, hoehe / teiler);
    rtB.setSize(breite / teiler, hoehe / teiler);
    if (rtWeich) rtWeich.setSize(breite / teiler, hoehe / teiler);
    if (rtWeich2) rtWeich2.setSize(breite / teiler, hoehe / teiler);
  }

  function unschaerfe(quelle, a, b, radius) {
    matWeich.uniforms.tBild.value = quelle;
    matWeich.uniforms.uSchritt.value.set(radius / (breite / teiler), 0);
    zeichneQuad(matWeich, a);
    matWeich.uniforms.tBild.value = a.texture;
    matWeich.uniforms.uSchritt.value.set(0, radius / (hoehe / teiler));
    zeichneQuad(matWeich, b);
    return b;
  }

  return {
    uniforms: matFertig.uniforms,
    render(scene, camera) {
      pruefeGroesse();
      const vorher = renderer.getRenderTarget();
      renderer.setRenderTarget(rtSzene);
      renderer.clear();
      renderer.render(scene, camera);

      if (bloom) {
        matHell.uniforms.tBild.value = rtSzene.texture;
        zeichneQuad(matHell, rtA);
        const fertig = unschaerfe(rtA.texture, rtB, rtA, bloom.radius ?? 2.0);
        matFertig.uniforms.tLeuchten.value = fertig.texture;
      }
      if (tilt) {
        const fertig = unschaerfe(rtSzene.texture, rtWeich, rtWeich2, tilt.radius ?? 2.4);
        matFertig.uniforms.tWeich.value = fertig.texture;
      }
      matFertig.uniforms.tSzene.value = rtSzene.texture;
      zeichneQuad(matFertig, null);
      renderer.setRenderTarget(vorher);
    },
    dispose() {
      rtSzene.dispose(); rtA.dispose(); rtB.dispose();
      if (rtWeich) rtWeich.dispose();
      if (rtWeich2) rtWeich2.dispose();
      quadGeo.dispose();
      matHell.dispose(); matWeich.dispose(); matFertig.dispose();
    },
  };
};
