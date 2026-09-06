// --- Farbverwaltung, sRGB-Ausgabe, Tonwertabbildung ------------------------
// three.js r149 rechnet ohne Zutun in „Altlast-Farben": Materialfarben werden
// so genommen, wie sie im Quelltext stehen, und ohne Umrechnung ausgegeben.
// Licht mischt sich dann in einem Raum, in dem Doppelte Helligkeit nicht
// doppelte Zahl heißt - Halbschatten kippen ins Graue, helle Flächen laufen
// flach aus. Mit eingeschalteter Farbverwaltung wird jede Farbe in den
// linearen Arbeitsraum geholt, dort beleuchtet und am Ende wieder nach sRGB
// gebracht; die Tonwertabbildung (ACES) fängt dabei ab, was heller als weiß
// wäre, statt es abzuschneiden.
//
// Wichtig: das muss geschehen, bevor die erste Farbe angelegt wird - deshalb
// steht es hier und nicht im Spielcode.
(function () {
  if (typeof THREE === 'undefined') return;
  if (THREE.ColorManagement && 'legacyMode' in THREE.ColorManagement) {
    THREE.ColorManagement.legacyMode = false;
  }
  // Jede gemalte Leinwand ist ein Farbbild und liegt damit in sRGB. Ohne
  // diesen Vermerk würde sie als lineares Bild gelesen und käme zu hell
  // heraus - Beschriftungen, Papierfaser, Flugdeck, alle.
  if (THREE.CanvasTexture && !THREE.CanvasTexture.__srgb && THREE.sRGBEncoding !== undefined) {
    const Alt = THREE.CanvasTexture;
    class CanvasTextureSRGB extends Alt {
      constructor(...args) {
        super(...args);
        this.encoding = THREE.sRGBEncoding;
      }
    }
    CanvasTextureSRGB.__srgb = true;
    THREE.CanvasTexture = CanvasTextureSRGB;
  }
})();

// Am Renderer selbst: Ausgabe in sRGB und ACES-Tonwerte. `belichtung` gleicht
// aus, dass ACES die Mitten etwas herunterzieht.
// `art` wählt die Kurve:
//   'linear' - nur Helligkeit, Farben bleiben so satt wie gemalt. Für Pax:
//              die Karte lebt von klaren, kräftigen Farben, und ACES nahm ihr
//              gemessen sieben Prozent Sättigung.
//   'film'   - ACES: fängt ab, was heller als weiß wäre, und rollt Lichter
//              weich aus. Für den schwarzen Raum, wo Triebwerke und Explosionen
//              weit über Weiß hinausgehen.
window.__setupColorPipeline = function (renderer, belichtung, art) {
  if (!renderer || typeof THREE === 'undefined') return;
  if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
  if (art === 'film' && THREE.ACESFilmicToneMapping !== undefined) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
  } else if (THREE.LinearToneMapping !== undefined) {
    renderer.toneMapping = THREE.LinearToneMapping;
  }
  renderer.toneMappingExposure = belichtung || 1;
};
