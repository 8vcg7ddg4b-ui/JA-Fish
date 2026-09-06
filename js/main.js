import {
  createInitialState, playerFaction, unitTotalCount, factionById, logMsg, isFleet,
} from './state.js';
import {
  playableFactions, factionProfile, factionKind, unitDefs, UNIT_ROLES, ROLE_LABELS,
  CITY_DEFS, STARTING_GOLD, DEFAULT_PLAYER_FACTION, GAME_VERSION, MINE_NAME,
  wallLevelInfo, buildingDef, buildingName, ROAD_STONE,
} from './data.js';
import {
  renderUI, battleReportHTML, battlePreviewHTML, tileInfoHTML, visibleLogCount, empireHTML,
  diplomacyHTML, setDiploTab, setFactionSort, getFactionSort, noticeFromNews,
} from './ui.js';
import { setupInput } from './input.js';
import { computeReachable } from './pathfind.js';
import { aiTakeAllTurns } from './ai.js';
import { pirateFleets } from './piraten.js';
import { hordes } from './staemme.js';
import {
  recruitUnit, raiseArmyFromGarrison, reinforceArmy, collectIncome, regenerateGarrisons,
  buildSiegeEngine,
  resetMovement, checkVictory, disbandArmyIntoCity, buyCityWalls,
  advanceWallConstruction, recoverArmies, embarkArmy, applyWeather, advanceWeather,
  buyRoad, upgradeRoad, upgradeToGravel, advanceRoadConstruction, buildFleet,
  buyBuilding, advanceConstruction, mineIncomeOf,
  advanceTraining, cancelTraining,
  updateSieges, applySiegeAttrition, siegeInfo, buildCamp, breakCamp, besiegeCity,
  layAmbush, leaveAmbush,
  openTradeRoute, closeTradeRoute, pruneTradeRoutes, growPopulations, growSettlements,
  escortStrandedArmies, blockadingFleets, setTactic, previewTileCombat,
} from './actions.js';
import {
  offerPeace, declareWar, sendGift, rulersTakeTurn, rulerOf, GIFT_COST,
  proposeTreaty, renounceTreaty,
  takeDiploNews, updateKnowledge, knowsFaction,
  acceptOffer, rejectOffer, expireOffers,
} from './diplomacy.js';
import { rulerFor, TRAITS, TRAIT_NAMES, traitLabel } from './rulers.js';
import {
  initScene, buildMap, syncEntities, render, resize, centerOn, zoomCamera, cameraState, propsDebug, hideTent,
  cityDebug,
  isAnimating, effectsDebug, armyDebug, rotateCamera, resetCameraOrientation, panCameraRelative,
  skipBattleClash, setBattleSpeed,
  setMapMode, getMapMode, setMarchSpeed, setOpeningView,
  setBordersVisible, areBordersVisible,
  setWeatherSource, setWeatherReporter, setWeatherVisualsEnabled, captureFrame,
  northOnScreen, setWildlifeEnabled,
} from './scene3d.js';
import {
  sfx, unlockAudio, toggleMuted, isMuted, stopMarch, startTheme, stopTheme, setMusicEnabled,
  audioProbe,
  startAnthem, stopAnthem,
} from './audio.js';
import { CHRONICLE, chronicleSVG } from './chronicle.js';
import { titleSceneSVG } from './titlescene.js';
import { wreathSVG, menuIconSVG } from './ornaments.js';
import { saveGame, loadGame, clearSaveGame, saveGameSummary } from './savegame.js';
import { SCENARIOS, DEFAULT_SCENARIO_ID, scenarioById } from './scenarios.js';
import { factionArt, factionArtSVG } from './factionart.js';
import { emblemSVG } from './emblems.js';
import {
  loadSettings, getSetting, setSetting, resetSettings, settingsHTML,
  MARCH_SPEED_FACTORS, AI_STANCE_THRESHOLDS,
} from './settings.js';
import { setAiStance } from './ai.js';
import { weatherAt, calendarOfTurn } from './weather.js';
import { rollEvents } from './events.js';

const canvas = document.getElementById('gameCanvas');
const appEl = document.getElementById('app');
let state = null;

// --- Die Windrose ---------------------------------------------------------
// Sie dreht sich mit der Kamera: die Spitze zeigt nach Norden, gleich wohin
// der Blick geschwenkt ist. Damit das nirgends vergessen wird, hängt sie am
// Zeichnen selbst - jeder Schwenk, jeder Zoom und jeder Zug gehen ohnehin
// durch `render`.
const compassRose = document.getElementById('compassRose');
let compassDrehung = null;
// `zeichneKarte` statt `render`: im gebündelten Artefakt teilen sich alle
// Dateien einen Namensraum, und ein zweites `render` überschriebe das aus
// `scene3d.js`.
function zeichneKarte() {
  if (compassRose) {
    const grad = Math.round((northOnScreen() * 1800) / Math.PI) / 10;
    if (grad !== compassDrehung) {
      compassDrehung = grad;
      compassRose.style.transform = `rotate(${grad}deg)`;
    }
  }
  render();
}

// --- Einstellungen --------------------------------------------------------
loadSettings();

// Two settings reach into other modules; the rest are read where they matter.
function applySettings() {
  setMarchSpeed(MARCH_SPEED_FACTORS[getSetting('marchSpeed')] ?? 1);
  setAiStance(AI_STANCE_THRESHOLDS[getSetting('aiStance')] ?? 0.5);
  setWeatherVisualsEnabled(getSetting('weatherEffects'));
  setWildlifeEnabled(getSetting('wildlife'));
  setMusicEnabled(getSetting('music'));
}
applySettings();

const settingsOverlay = document.getElementById('settingsOverlay');

function paintSettings() {
  document.getElementById('settingsBody').innerHTML = settingsHTML(!isMuted());
}

function showSettings() {
  paintSettings();
  settingsOverlay.classList.remove('hidden');
}

function hideSettings() {
  settingsOverlay.classList.add('hidden');
}

// One delegated handler for the whole panel: every control carries the key it
// changes, so nothing has to be re-wired when the panel is repainted.
document.getElementById('settingsBody').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.id === 'settingsReset') {
    resetSettings();
  } else if (button.dataset.key === 'sound') {
    unlockAudio();
    toggleMuted();
  } else if (button.dataset.key) {
    const setting = button.dataset.value !== undefined
      ? button.dataset.value
      : !getSetting(button.dataset.key);
    setSetting(button.dataset.key, setting);
  } else {
    return;
  }
  applySettings();
  paintSettings();
  refreshMuteButton();
  syncMenuMusic();
  if (state) setWeatherSource((col, row) => weatherAt(state, col, row));
  if (!isMuted()) sfx.select();
});

// Die Titelmusik gehört zum Vorspann: sie läuft, solange Startbildschirm oder
// Fraktionswahl zu sehen sind, und schweigt auf der Karte. Wer den Ton oder
// die Musik im Menü wieder einschaltet, soll sie auch wieder hören.
function syncMenuMusic() {
  const inMenu = !document.getElementById('startScreen').classList.contains('hidden')
    || !document.getElementById('factionScreen').classList.contains('hidden');
  const erlaubt = !isMuted() && getSetting('music');
  if (inMenu) {
    stopAnthem({ fadeOut: 1.5 });
    if (erlaubt) startTheme({ fadeIn: 1.2 });
    return;
  }
  stopTheme({ fadeOut: 2 });
  // Auf der Karte klingt die eigene Fraktion. Wer die Musik in den
  // Einstellungen wieder einschaltet, hört sie ab dem nächsten Takt.
  if (erlaubt && state) startAnthem(playerFaction(state).id, { fadeIn: 2 });
  else if (!erlaubt) stopAnthem({ fadeOut: 1.5 });
}

// Der Blick auf den eigenen Sitz. Ist die Hauptstadt gefallen, tut es die
// nächstbeste eigene Stadt, und wenn auch die fort ist, das letzte Heer -
// sonst führte der Knopf ins Nichts.
function focusOwnCapital() {
  if (!state) return;
  const player = playerFaction(state);
  const own = state.cities.filter((c) => c.factionId === player.id);
  const home = own.find((c) => c.capital) || own[0]
    || state.armies.find((a) => a.factionId === player.id);
  if (home) centerOn(home.col, home.row);
}

// --- Der Empfang im Zelt --------------------------------------------------
// Bevor der erste Zug fällt, meldet sich der Erste Offizier. Die Ansprache
// liegt über der Karte statt vor ihr: man soll das Zelt sehen, in dem sie
// gesprochen wird.

// Wer da spricht, richtet sich nach der Fraktion - ein Legat dient keinem
// Sarmatenfürsten.
const HERALD_TITLES = {
  rom: 'Dein Legat', karthago: 'Dein Suffet', athen: 'Dein Stratege',
  sparta: 'Dein Ephor',
  makedonien: 'Dein Somatophylax', syrakus: 'Dein Ratsherr',
  seleukiden: 'Dein Stratege', ptolemaeer: 'Dein Nomarch',
  gallier: 'Dein Gefolgsmann', germanen: 'Dein Gefolgsmann',
  britannier: 'Dein Gefolgsmann', iberer: 'Dein Gefolgsmann',
  daker: 'Dein Gefolgsmann', illyrer: 'Dein Gefolgsmann',
  sarmaten: 'Dein Reiterführer',
  numidien: 'Dein Reiterfürst',
  parther: 'Dein Satrap',
  armenien: 'Dein Nacharar',
  pontus: 'Dein Stratege',
};

const heraldOverlay = document.getElementById('heraldOverlay');
const tentFade = document.getElementById('tentFade');
let heraldTimer = null;

function hideHerald() {
  if (!heraldOverlay) return;
  const wasOpen = !heraldOverlay.classList.contains('hidden');
  if (heraldTimer !== null) {
    clearTimeout(heraldTimer);
    heraldTimer = null;
  }
  heraldOverlay.classList.add('hidden');
  // „Lass uns die Schlachtkarte betrachten": die Kamera geht vom Zelt
  // hinunter auf den eigenen Sitz. Der Sprung selbst - Kamera hart umgesetzt,
  // das ganze Zelt auf einen Schlag weg - geschieht hinter einer kurzen
  // Schwarzblende, derselben Art Schnitt wie am Ende des Vorspanns: sonst
  // sprang das Zelt ersatzlos weg, mitten im Bild, ohne Übergang.
  //
  // Verdunkelt wird ohne eigene Übergangszeit, sofort und ganz, und der Umbau
  // (Kamerawechsel, Zeltabbau, neuer Aufbau der Szene) läuft direkt im selben
  // Zug dahinter - nicht erst nach einer abgewarteten Einblendung oder einem
  // abgewarteten Bild. Eine Karte mit vielen Objekten braucht beim Umbau
  // schon mal einen Moment, und diese Zeit ist nicht vorherzusagen; auf ein
  // bestimmtes Zeitfenster oder einen weiteren Bildwechsel zu warten, ehe der
  // Umbau beginnt, hieß bei einem lang dauernden Umbau: die Karte wurde schon
  // sichtbar, während die Blende selbst noch am Aufziehen war, halb dunkel,
  // mit unfertigem Aufbau - genau das Zwischenbild, das hier vermieden werden
  // soll. Läuft alles im selben Zug, bekommt der Browser den fertigen Stand
  // ohnehin erst zu fassen, wenn er wieder zeichnet - der Umbau bleibt so
  // unsichtbar, ganz gleich, wie lange er braucht. Nur das Aufhellen am Ende
  // bleibt ein eigener Schritt: erst wenn es beginnt, darf es auch sichtbar
  // werden, sanft statt hart wie der Wechsel selbst.
  if (wasOpen && state) {
    if (tentFade) {
      tentFade.classList.add('tent-fade-instant');
      tentFade.classList.add('tent-fade-in');
    }
    resetCameraOrientation();
    focusOwnCapital();
    // Die Ansprache ist vorbei - das Zelt hat seinen Auftritt gehabt und
    // verschwindet, statt für den Rest des Feldzugs auf der Karte zu stehen.
    hideTent();
    // refresh() statt des bloßen zeichneKarte(): es synchronisiert auch
    // Städte und Heere neu, ehe gezeichnet wird - der reine Render-Aufruf
    // zeigte sonst unter Umständen einen Stand von vor dem Kamerawechsel.
    refresh();
    if (tentFade) {
      const aufhellen = () => {
        tentFade.classList.remove('tent-fade-instant');
        tentFade.classList.remove('tent-fade-in');
      };
      // Das Aufhellen wartet auf das nächste Bild, damit der Wechsel wirklich
      // hinter der Blende liegt. Ein Fenster im Hintergrund zeichnet aber
      // keine Bilder: dort käme der Ruf nie, und wer zurückwechselte, säße vor
      // einem schwarzen Schirm. Die Uhr daneben ist die Sicherung - sie greift
      // später als das nächste Bild und ist zweimal auszuführen unschädlich.
      requestAnimationFrame(aufhellen);
      setTimeout(aufhellen, 250);
    }
  }
}

function showHerald() {
  if (!heraldOverlay || !state) return;
  const player = playerFaction(state);
  const who = document.getElementById('heraldWho');
  if (who) who.textContent = `${HERALD_TITLES[player.id] || 'Dein Gefolgsmann'} · ${player.name}`;
  // Der Spieler ist nicht "der Herr" im Allgemeinen, sondern dieser eine Mann.
  // Der Herold spricht ihn deshalb mit seinem Namen an.
  const line = document.getElementById('heraldLine');
  const ruler = rulerOf(state, player.id);
  if (line && ruler) {
    // Manche Namen enden schon auf einen Punkt ("Antiochos I."), und zwei
    // hintereinander sehen aus wie ein Tippfehler.
    const anrede = ruler.name.endsWith('.') ? ruler.name : `${ruler.name}.`;
    line.textContent = `„Ich grüße dich, ${anrede} Lass uns die Schlachtkarte betrachten."`;
  }
  heraldOverlay.classList.remove('hidden');
  sfx.raise();
  // Wer weiterlesen will, hat Zeit; wer die Partie kennt, klickt weg.
  heraldTimer = setTimeout(hideHerald, 9000);
}

function setupHerald() {
  if (!heraldOverlay) return;
  // Wegklicken geht überall auf der Ansprache, nicht nur auf dem Knopf. Der
  // Knopf liegt aber selbst auf der Ansprache: ohne das Anhalten hier liefe
  // ein Druck auf ihn zweimal durch - einmal als Knopf, einmal als Klick auf
  // die Fläche darunter.
  const close = document.getElementById('heraldClose');
  if (close) {
    close.addEventListener('click', (ereignis) => {
      ereignis.stopPropagation();
      hideHerald();
    });
  }
  heraldOverlay.addEventListener('click', hideHerald);
}
setupHerald();

// --- Zufallsereignisse ----------------------------------------------------
// Was der Spieler nicht befohlen hat, bekommt er trotzdem zu sehen: ein
// eigenes Fenster, damit eine Seuche nicht zwischen zwei Wetterzeilen im
// Protokoll untergeht. Was den anderen Fraktionen zustößt, steht nur dort.

const eventOverlay = document.getElementById('eventOverlay');

function hideEvent() {
  if (eventOverlay) eventOverlay.classList.add('hidden');
}

function showEvent(event) {
  if (!eventOverlay || !event) return;
  const box = eventOverlay.querySelector('.event-box');
  box.classList.toggle('good', !!event.good);
  box.classList.toggle('bad', !event.good);
  document.getElementById('eventIcon').textContent = event.icon;
  document.getElementById('eventKind').textContent = event.good ? 'Ein guter Tag' : 'Ein schwerer Tag';
  document.getElementById('eventTitle').textContent = event.title;
  document.getElementById('eventText').textContent = event.text;
  document.getElementById('eventEffect').textContent = event.effect;
  eventOverlay.classList.remove('hidden');
  (event.good ? sfx.wallDone : sfx.denied)();
}

function setupEventWindow() {
  if (!eventOverlay) return;
  const close = document.getElementById('eventClose');
  if (close) close.addEventListener('click', hideEvent);
  eventOverlay.addEventListener('click', (e) => {
    if (e.target === eventOverlay) hideEvent();
  });
}
setupEventWindow();

// --- Reichsübersicht ------------------------------------------------------
// Ein Fenster über den ganzen Besitz: jeder Ort mit seinen Einnahmen, die
// Summe darunter, dazu Heere, Flotten und der Sold, der davon abgeht.

const empireOverlay = document.getElementById('empireOverlay');

function hideEmpire() {
  if (empireOverlay) empireOverlay.classList.add('hidden');
}

function showEmpire() {
  if (!empireOverlay || !state) return;
  document.getElementById('empireBody').innerHTML = empireHTML(state);
  empireOverlay.classList.remove('hidden');
  sfx.select();
}

// --- Werkzeugleiste --------------------------------------------------------
// Ein Knopf trägt sein Zeichen und, wenn die Leiste aufgeklappt ist, seinen
// Namen daneben. Wechselt das Zeichen - vom Lautsprecher zum durchgestrichenen,
// von der Karte zum Gebirge -, darf die Beschriftung nicht mitverschwinden.
function setButtonIcon(button, icon) {
  const span = button.querySelector('.btn-icon');
  if (span) span.textContent = icon;
  else button.textContent = icon;
}

// Hinter dem ☰ liegt, was man selten braucht - und auf schmalem Schirm auch
// das, wofür die Leiste keinen Platz mehr hat. Verschoben werden dabei die
// Knöpfe selbst, nicht Kopien davon: ihre Klickbehandlung reist mit.
const toolbarEl = document.getElementById('toolbar');
const toolMenuEl = document.getElementById('toolMenu');
const menuToggleEl = document.getElementById('menuBtn');
// Die vier, die offen in der Leiste stehen, solange sie hineinpassen.
const PRIMARY_TOOLS = ['undoBtn', 'empireBtn', 'diploBtn', 'mapModeBtn'];
const wideBar = window.matchMedia('(min-width: 1151px)');

function setToolMenuOpen(open) {
  if (!toolMenuEl || !menuToggleEl) return;
  toolMenuEl.classList.toggle('open', open);
  menuToggleEl.classList.toggle('active', open);
  menuToggleEl.setAttribute('aria-expanded', open ? 'true' : 'false');
}

// Räumt die vier Hauptwerkzeuge dorthin, wo sie hingehören: in die Leiste,
// solange sie breit genug ist, sonst an den Anfang der Klappliste.
function arrangeTools() {
  if (!toolbarEl || !toolMenuEl) return;
  const inDerLeiste = wideBar.matches;
  const knoepfe = PRIMARY_TOOLS.map((id) => document.getElementById(id)).filter(Boolean);
  if (inDerLeiste) {
    for (const button of knoepfe) toolbarEl.appendChild(button);
  } else {
    // Rückwärts einfügen, damit die Reihenfolge stimmt.
    for (const button of [...knoepfe].reverse()) {
      toolMenuEl.insertBefore(button, toolMenuEl.firstChild);
    }
  }
}

function setupToolbar() {
  if (!toolMenuEl || !menuToggleEl) return;
  arrangeTools();
  if (wideBar.addEventListener) wideBar.addEventListener('change', arrangeTools);
  else if (wideBar.addListener) wideBar.addListener(arrangeTools);
  menuToggleEl.addEventListener('click', (e) => {
    e.stopPropagation();
    setToolMenuOpen(!toolMenuEl.classList.contains('open'));
    sfx.select();
  });
  // Ein Werkzeug gewählt: die Liste geht zu, damit man sieht, was es tat.
  toolMenuEl.addEventListener('click', (e) => {
    if (e.target.closest('.icon-btn')) setToolMenuOpen(false);
  });
  document.addEventListener('click', (e) => {
    if (!toolMenuEl.classList.contains('open')) return;
    if (e.target.closest('#toolMenu') || e.target.closest('#menuBtn')) return;
    setToolMenuOpen(false);
  });
}
setupToolbar();

// --- Nachrichten aus der Diplomatie ----------------------------------------
// Wenn ein Herrscher dir den Krieg erklärt, sollst du es nicht im Protokoll
// entdecken, sondern gesagt bekommen. Meldungen, die andere betreffen, stehen
// im Protokoll; nur was dich angeht, hält die Runde an.
const diploNewsOverlay = document.getElementById('diploNewsOverlay');
let diploNewsQueue = [];

function hideDiploNews() {
  if (diploNewsOverlay) diploNewsOverlay.classList.add('hidden');
  if (diploNewsQueue.length) {
    // Mehrere Meldungen in einer Runde kommen eine nach der anderen.
    setTimeout(showNextDiploNews, 120);
  }
}

// Eine fertige Meldung: Zeichen, Zeile, Überschrift, Text, Folge - und, wenn
// ein Schlachtbericht dahinterliegt, ein Knopf dorthin.
function showNotice(meldung) {
  if (!diploNewsOverlay) return;
  const icon = document.getElementById('diploNewsIcon');
  const kind = document.getElementById('diploNewsKind');
  const title = document.getElementById('diploNewsTitle');
  const text = document.getElementById('diploNewsText');
  const effect = document.getElementById('diploNewsEffect');
  const close = document.getElementById('diploNewsClose');
  if (icon) icon.textContent = meldung.icon;
  if (kind) kind.textContent = meldung.kind;
  if (title) title.textContent = meldung.title;
  if (text) text.textContent = meldung.text;
  // Eine Aufzählung - mehrere Bauwerke, die in derselben Runde fertig
  // geworden sind. Ohne sie bleibt die Liste leer und aus dem Weg.
  const list = document.getElementById('diploNewsList');
  if (list) {
    list.textContent = '';
    const zeilen = meldung.list || [];
    for (const zeile of zeilen) {
      const li = document.createElement('li');
      const icon = document.createElement('span');
      icon.className = 'event-list-icon';
      icon.textContent = zeile.icon || '·';
      const body = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = zeile.name;
      body.appendChild(name);
      if (zeile.note) {
        const note = document.createElement('span');
        note.className = 'event-list-note';
        note.textContent = ` – ${zeile.note}`;
        body.appendChild(note);
      }
      li.append(icon, body);
      list.appendChild(li);
    }
    list.hidden = zeilen.length === 0;
  }
  if (effect) effect.textContent = meldung.effect || '';
  // Der Bericht liegt hinter einem eigenen Knopf: wer ihn sehen will, klickt.
  const alt = document.getElementById('diploNewsReport');
  if (alt) alt.remove();
  if (meldung.reportId && close) {
    const button = document.createElement('button');
    button.id = 'diploNewsReport';
    button.className = 'event-btn';
    button.textContent = '📜 Bericht ansehen';
    button.addEventListener('click', () => {
      const id = meldung.reportId;
      hideDiploNews();
      showBattleReport(id);
    });
    close.parentNode.insertBefore(button, close);
  }
  diploNewsOverlay.classList.remove('hidden');
  // Eine Baumeldung klingt nach Handwerk, ein Herold nach Horn.
  (meldung.sound === 'bau' ? sfx.built : sfx.raise)();
}

function showNextDiploNews() {
  if (!diploNewsOverlay || !diploNewsQueue.length || !state) return;
  const meldung = diploNewsQueue.shift();
  // Alles, was seinen Text schon mitbringt - fertige Meldungen, Verträge,
  // Vertragsbrüche, der Bündnisfall -, geht direkt durch. Welcher Fall das
  // ist, entscheidet `noticeFromNews`.
  const fertig = noticeFromNews(meldung);
  if (fertig) { showNotice(fertig); return; }
  const krieg = meldung.kind === 'krieg';
  const angebot = meldung.kind === 'angebot';
  const gegner = factionById(state, meldung.von === playerFaction(state).id
    ? meldung.gegen : meldung.von);
  const icon = document.getElementById('diploNewsIcon');
  const kind = document.getElementById('diploNewsKind');
  const title = document.getElementById('diploNewsTitle');
  const text = document.getElementById('diploNewsText');
  const effect = document.getElementById('diploNewsEffect');
  // Ein Gesandter, der auf Antwort wartet: die Entscheidung fällt nicht hier,
  // sondern im Diplomatiefenster - hier steht nur, dass er da ist.
  if (angebot) {
    if (icon) icon.textContent = '🕊';
    if (kind) kind.textContent = `Ein Gesandter${gegner ? ` · ${gegner.name}` : ''}`;
    if (title) title.textContent = `${meldung.ruler} bietet dir Frieden an`;
    if (text) {
      text.textContent = `${meldung.ruler}, ${meldung.titel}, lässt fragen, ob der `
        + `Krieg zwischen euch nicht genug sei – ${meldung.grund}.`
        + (meldung.tribut > 0
          ? ` Er legt ${meldung.tribut.toLocaleString('de-DE')} Gold dazu.` : '');
    }
    if (effect) {
      effect.textContent = 'Der Gesandte wartet drei Runden. Im Diplomatiefenster '
        + 'nimmst du an oder schickst ihn nach Hause.';
    }
    diploNewsOverlay.classList.remove('hidden');
    sfx.raise();
    return;
  }
  if (icon) icon.textContent = krieg ? '⚔' : '🕊';
  // Der Name der Fraktion steht in der Zeile darüber, nicht im Satz: "ein
  // Herold aus Illyrer" wäre kein Deutsch, und die Namen sind teils Völker,
  // teils Orte - eine Wendung, die für beide passt, gibt es nicht.
  if (kind) {
    kind.textContent = `${krieg ? 'Eine Kriegserklärung' : 'Ein Friedensschluss'}${
      gegner ? ` · ${gegner.name}` : ''}`;
  }
  if (title) title.textContent = krieg
    ? `${meldung.ruler} erklärt dir den Krieg`
    : `${meldung.ruler} schließt Frieden`;
  if (text) {
    text.textContent = krieg
      ? `Ein Herold steht im Zelt: ${meldung.ruler}, ${meldung.titel}, `
        + `kündigt den Frieden auf – ${meldung.grund}.`
      : `${meldung.ruler}, ${meldung.titel}, lässt ausrichten, dass zwischen euch `
        + `wieder Friede sein soll – ${meldung.grund}.`;
  }
  if (effect) {
    effect.textContent = krieg
      ? 'Seine Heere können deine Orte ab dieser Runde angreifen. Im Diplomatiefenster '
        + 'steht, was ihn ein neuer Friede kosten würde.'
      : 'Eure Heere gehen einander wieder aus dem Weg.';
  }
  diploNewsOverlay.classList.remove('hidden');
  sfx.raise();
}

// Nimmt entgegen, was die Herrscher in dieser Runde beschlossen haben: was den
// Spieler angeht, kommt ins Fenster, alles andere ins Protokoll - aber nur,
// wenn er die Beteiligten überhaupt kennt.
function collectDiploNews() {
  if (!state) return;
  const me = playerFaction(state).id;
  for (const meldung of takeDiploNews(state)) {
    if (meldung.von === me || meldung.gegen === me) {
      diploNewsQueue.push(meldung);
      continue;
    }
    if (!knowsFaction(state, me, meldung.von) || !knowsFaction(state, me, meldung.gegen)) continue;
    const von = factionById(state, meldung.von);
    const gegen = factionById(state, meldung.gegen);
    if (!von || !gegen) continue;
    logMsg(state, meldung.titel ? `${meldung.titel}.`
      : meldung.kind === 'krieg'
        ? `${meldung.ruler} von ${von.name} erklärt ${gegen.name} den Krieg – ${meldung.grund}.`
        : `${von.name} und ${gegen.name} schließen Frieden.`);
  }
}

// --- Was in dieser Runde mit dir geschehen ist ----------------------------
// Nach dem Zug der Gegner wird zusammengetragen, was die eigene Fraktion
// betrifft: jede Schlacht, jeder verlorene und gewonnene Ort, jedes
// vernichtete Heer. Vorher stand davon nur die letzte Schlacht in einem
// Fenster, alles andere im Protokoll - und wer eine Stadt verlor, erfuhr es
// erst, wenn er hinsah.
function snapshotOwn() {
  if (!state) {
    return {
      orte: new Set(), heere: new Map(), piraten: new Set(),
      staemme: new Set(), gesperrt: new Set(),
    };
  }
  const me = playerFaction(state).id;
  return {
    orte: new Set(state.cities.filter((c) => c.factionId === me).map((c) => c.id)),
    heere: new Map(state.armies.filter((a) => a.factionId === me).map((a) => [a.id, a.name])),
    // Welche Seeräuber schon unterwegs waren - ein neues Segel vor der eigenen
    // Küste ist eine Meldung wert, eines am anderen Ende der Welt nicht.
    piraten: new Set(pirateFleets(state).map((p) => p.id)),
    // Und welche Züge aus dem Osten. Die sind immer eine Meldung wert: ein
    // Volk in Bewegung geht die ganze Welt an, nicht nur den, gegen den es zieht.
    staemme: new Set(hordes(state).map((h) => h.id)),
    // Welche eigenen Häfen schon gesperrt waren - eine neue Sperre ist eine
    // Meldung, eine bestehende nicht.
    gesperrt: new Set(state.cities
      .filter((c) => c.factionId === me && blockadingFleets(state, c).length)
      .map((c) => c.id)),
    // Und die Zahlen, an denen sich eine Runde messen lässt.
    zahlen: reichsZahlen(),
  };
}

// Der Stand des Reichs in Zahlen. Womit die Runde begann und womit sie endet -
// die Differenz ist die Rundenbilanz.
function reichsZahlen() {
  if (!state) return null;
  const me = playerFaction(state).id;
  const meine = playerFaction(state);
  const orte = state.cities.filter((c) => c.factionId === me);
  const heere = state.armies.filter((a) => a.factionId === me && !isFleet(a));
  const flotten = state.armies.filter((a) => a.factionId === me && isFleet(a));
  return {
    gold: Math.round(meine.gold),
    einwohner: orte.reduce((sum, c) => sum + c.population, 0),
    orte: orte.length,
    mann: heere.reduce((sum, a) => sum + unitTotalCount(a.units), 0),
    heere: heere.length,
    wache: orte.reduce((sum, c) => sum + unitTotalCount(c.garrison), 0),
    schiffe: flotten.reduce((sum, f) => sum + (f.units.ships || 0), 0),
  };
}

// Die Rundenbilanz: was diese Runde am Reich verändert hat, in einer Liste.
// Nur was sich bewegt hat, steht darin - eine Tafel voller Nullen sagt nichts,
// und wenn sich gar nichts bewegt hat, kommt sie überhaupt nicht.
const BILANZ_ZEILEN = [
  { key: 'gold', icon: '💰', name: 'Schatz' },
  { key: 'einwohner', icon: '👥', name: 'Einwohner' },
  { key: 'orte', icon: '🏛️', name: 'Orte' },
  { key: 'mann', icon: '⚔️', name: 'Mann im Feld' },
  { key: 'heere', icon: '🚩', name: 'Heere' },
  { key: 'wache', icon: '🛡️', name: 'Stadtwache' },
  { key: 'schiffe', icon: '⛵', name: 'Schiffe' },
];

function collectBalanceNews(vorher) {
  const jetzt = reichsZahlen();
  if (!jetzt || !vorher || !vorher.zahlen) return;
  const vor = vorher.zahlen;
  const zeilen = [];
  const deltas = {};
  for (const zeile of BILANZ_ZEILEN) {
    const diff = jetzt[zeile.key] - vor[zeile.key];
    deltas[zeile.key] = diff;
    if (!diff) continue;
    zeilen.push({
      icon: zeile.icon,
      name: zeile.name,
      diff,
      text: `${diff > 0 ? '+' : '−'}${Math.abs(diff).toLocaleString('de-DE')}`,
    });
  }
  // Die Zahlen bleiben am Spielstand hängen: die Goldanzeige liest daraus ihr
  // „+150", und die Bilanz übersteht damit auch ein Rückgängig.
  state.lastDeltas = deltas;
  showTurnSummary(zeilen);
}

// --- Die Rundenbilanz ------------------------------------------------------
// Was sich mit dem Rundenwechsel verändert hat, steht als Streifen unter der
// Kopfzeile - und nicht in einem Fenster, das man wegklicken muss. Eine
// Meldung, die jede Runde kommt, darf den Spieler nicht aufhalten; sie soll
// im Vorbeigehen zu lesen sein und von selbst wieder gehen.
const SUMMARY_MS = 9000;
let summaryTimer = null;

function showTurnSummary(zeilen) {
  const strip = document.getElementById('turnSummary');
  if (!strip) return;
  strip.textContent = '';
  if (!zeilen.length) {
    strip.classList.add('hidden');
    return;
  }
  for (const zeile of zeilen) {
    const chip = document.createElement('span');
    chip.className = `summary-chip ${zeile.diff > 0 ? 'delta-up' : 'delta-down'}`;
    const icon = document.createElement('span');
    icon.className = 'summary-icon';
    icon.textContent = zeile.icon;
    const name = document.createElement('span');
    name.className = 'summary-name';
    name.textContent = zeile.name;
    const wert = document.createElement('strong');
    wert.textContent = zeile.text;
    chip.append(icon, name, wert);
    strip.appendChild(chip);
  }
  strip.classList.remove('hidden');
  clearTimeout(summaryTimer);
  summaryTimer = setTimeout(() => strip.classList.add('hidden'), SUMMARY_MS);
}

// Wie nah ein Segel sein muss, damit es die eigene Küste angeht.
const PIRATE_ALARM_RANGE = 9;

function collectOwnNews(vorher, previousHead) {
  if (!state) return;
  const me = playerFaction(state).id;

  // Schlachten: jede, an der die eigene Fraktion beteiligt war.
  const schlachten = [];
  for (const report of state.battleReports) {
    if (report.id === previousHead) break;
    if (report.involvesPlayer) schlachten.push(report);
  }
  for (const report of schlachten.reverse()) {
    const angreifer = report.attackerFactionId === me;
    const gewonnen = angreifer === (report.outcome === 'attacker');
    const zurSee = !!report.naval;
    const wo = report.cityName ? report.cityName : `${report.col},${report.row}`;
    diploNewsQueue.push({
      icon: zurSee ? '⛵' : report.kind === 'city' ? '🏰' : '⚔',
      kind: zurSee ? 'Eine Seeschlacht' : report.kind === 'city' ? 'Eine Belagerung' : 'Eine Feldschlacht',
      title: `${gewonnen ? 'Sieg' : 'Niederlage'} ${zurSee ? 'zur See' : 'bei'} ${
        zurSee && !report.cityName ? 'auf offener See' : wo}`,
      text: angreifer
        ? `Dein Angriff ${gewonnen ? 'hat sich durchgesetzt' : 'ist zurückgeschlagen worden'}.`
        : `${(factionById(state, report.attackerFactionId) || {}).name || 'Ein Feind'} hat dich angegriffen und ${
          gewonnen ? 'ist gescheitert' : 'sich durchgesetzt'}.`,
      effect: zurSee
        ? 'Zur See kämpft nur, was schwimmt: geschlagene Schiffe sind verloren.'
        : 'Der Bericht nennt Verluste, Gelände und den Verlauf.',
      reportId: report.id,
    });
  }

  // Orte, die den Besitzer gewechselt haben.
  const jetzt = new Set(state.cities.filter((c) => c.factionId === me).map((c) => c.id));
  for (const id of vorher.orte) {
    if (jetzt.has(id)) continue;
    const city = state.cities.find((c) => c.id === id);
    if (!city) continue;
    const sieger = factionById(state, city.factionId);
    diploNewsQueue.push({
      icon: '🏳', kind: 'Ein Ort ist gefallen',
      title: `${city.name} ist verloren`,
      text: `${sieger ? sieger.name : 'Ein Feind'} hält ${city.name}.`
        + ' Was der Ort trug, trägt er für einen anderen.',
      effect: 'Einnahmen, Garnison und Handelswege des Orts sind damit fort.',
    });
  }
  for (const city of state.cities) {
    if (city.factionId !== me || vorher.orte.has(city.id)) continue;
    diploNewsQueue.push({
      icon: '🏛', kind: 'Ein Ort ist gewonnen',
      title: `${city.name} ist dein`,
      text: `${city.name} steht unter deiner Herrschaft.`,
      effect: 'Der Ort trägt ab der nächsten Abrechnung zu deinen Einnahmen bei.',
    });
  }

  // Ein Volk, das sich in Bewegung gesetzt hat. Das steht im Fenster, gleich
  // ob es gegen den Spieler zieht oder gegen einen anderen: wer es zuerst
  // trifft, ist eine Frage von Runden.
  for (const zug of hordes(state)) {
    if (vorher.staemme.has(zug.id)) continue;
    const gegner = factionById(state, zug.gegen);
    const gegenMich = zug.gegen === me;
    const staerke = unitTotalCount(zug.units).toLocaleString('de-DE');
    diploNewsQueue.push({
      icon: '🐎', kind: 'Ein Volk in Bewegung',
      title: `${zug.name} zieht aus dem Osten heran`,
      text: `${staerke} wehrhafte Männer, dazu Weiber, Kinder, Karren und Herden. `
        + (gegenMich
          ? 'Der Zug geht gegen dich.'
          : `Der Zug geht gegen ${gegner ? gegner.name : 'ein Reich im Westen'}.`),
      effect: gegenMich
        ? 'Sie überrennen, was im Weg steht. Nehmen sie einen deiner Orte, bleiben '
          + 'sie dort – und der Ort ist für dich verloren.'
        : 'Was sie unterwegs nehmen, gehört von da an niemandem mehr. Ihr Weg führt '
          + 'quer durch die Reiche des Ostens.',
    });
  }

  // Seeräuber, die neu vor der eigenen Küste aufgetaucht sind.
  const meineOrte = state.cities.filter((c) => c.factionId === me);
  for (const raeuber of pirateFleets(state)) {
    if (vorher.piraten.has(raeuber.id)) continue;
    let nah = null;
    let beste = Infinity;
    for (const city of meineOrte) {
      const d = Math.abs(city.col - raeuber.col) + Math.abs(city.row - raeuber.row);
      if (d < beste) { beste = d; nah = city; }
    }
    if (!nah || beste > PIRATE_ALARM_RANGE) continue;
    diploNewsQueue.push({
      icon: '🏴', kind: 'Seeräuber',
      title: `Schwarze Segel vor ${nah.name}`,
      text: `${raeuber.name} kreuzt ${beste} Felder vor ${nah.name}. `
        + 'Sie halten keine Stadt und nehmen keine – sie nehmen, was fährt.',
      effect: 'Solange sie dort liegen, trägt jeder Seehandelsweg der Gegend nur die '
        + 'Hälfte. Wer sie versenkt, findet ihre Beute an Bord.',
    });
  }

  // Eigene Heere, die es nicht mehr gibt. Im Zug der Gegner kann ein Heer nur
  // vernichtet worden sein - vereinigen kann es sich nur, wenn man selbst zieht.
  const heereJetzt = new Set(state.armies.filter((a) => a.factionId === me).map((a) => a.id));
  for (const [id, name] of vorher.heere) {
    if (heereJetzt.has(id)) continue;
    diploNewsQueue.push({
      icon: '💀', kind: 'Ein Heer ist gefallen',
      title: `${name} besteht nicht mehr`,
      text: `Von ${name} ist nichts übrig, das noch marschieren könnte.`,
      effect: 'Der Sold für dieses Heer entfällt – und mit ihm sein Schutz.',
    });
  }
}

function setupDiploNews() {
  const close = document.getElementById('diploNewsClose');
  if (close) close.addEventListener('click', hideDiploNews);
  if (diploNewsOverlay) {
    diploNewsOverlay.addEventListener('click', (e) => {
      if (e.target === diploNewsOverlay) hideDiploNews();
    });
  }
}
setupDiploNews();

// --- Diplomatie ------------------------------------------------------------
// Ein eigenes Fenster, weil hier nichts auf der Karte passiert: hier wird
// geredet. Was gesagt wurde, steht als Antwort über der Liste, bis das
// Fenster wieder zugeht.
const diploOverlay = document.getElementById('diploOverlay');
let diploNote = '';

function hideDiplomacy() {
  if (diploOverlay) diploOverlay.classList.add('hidden');
  diploNote = '';
}

function renderDiplomacy() {
  const body = document.getElementById('diploBody');
  if (!body || !state) return;
  body.innerHTML = diplomacyHTML(state, diploNote);
  body.querySelectorAll('[data-diplotab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setDiploTab(btn.dataset.diplotab);
      sfx.select();
      renderDiplomacy();
    });
  });
  body.querySelectorAll('.diplo-btn:not([disabled])').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.faction;
      const me = playerFaction(state).id;
      pushUndo();
      let answer = null;
      if (btn.dataset.act === 'peace') {
        const tribute = Number(btn.dataset.tribute) || 0;
        const result = offerPeace(state, me, target, tribute);
        answer = result.text;
        (result.ok ? sfx.wallBuy : sfx.denied)();
      } else if (btn.dataset.act === 'war') {
        const ruler = rulerOf(state, target);
        const result = declareWar(state, me, target, 'die Boten sind zurückgeschickt');
        const gerufen = (result.allies || [])
          .map((id) => factionById(state, id).name).join(', ');
        answer = result.ok
          ? `Die Herolde sind unterwegs. ${ruler.name} weiß es vor der nächsten Runde.${
            gerufen ? ` Sein Bündnis ruft ${gerufen} mit ins Feld.` : ''}`
          : (result.text || (result.lock ? result.lock.text : 'Dafür ist es zu früh.'));
        sfx.denied();
      } else if (btn.dataset.act === 'treaty') {
        const result = proposeTreaty(state, me, target, btn.dataset.kind);
        answer = result.text;
        (result.ok ? sfx.wallBuy : sfx.denied)();
      } else if (btn.dataset.act === 'renounce') {
        const result = renounceTreaty(state, me, target, btn.dataset.kind);
        answer = result.ok ? result.text : 'Daran ist nichts aufzukündigen.';
        sfx.denied();
      } else if (btn.dataset.act === 'gift') {
        const result = sendGift(state, me, target, GIFT_COST);
        answer = result.text;
        (result.ok ? sfx.wallBuy : sfx.denied)();
      } else if (btn.dataset.act === 'accept') {
        const result = acceptOffer(state, target, me);
        answer = result.text;
        (result.ok ? sfx.wallBuy : sfx.denied)();
      } else if (btn.dataset.act === 'reject') {
        const result = rejectOffer(state, target, me);
        answer = result.text;
        sfx.denied();
      }
      diploNote = answer || '';
      refresh();
      renderDiplomacy();
    });
  });
}

function showDiplomacy() {
  if (!diploOverlay || !state) return;
  diploNote = '';
  renderDiplomacy();
  diploOverlay.classList.remove('hidden');
  sfx.select();
}

function setupDiplomacyButton() {
  const button = document.getElementById('diploBtn');
  if (button) button.addEventListener('click', showDiplomacy);
  const close = document.getElementById('diploClose');
  if (close) close.addEventListener('click', hideDiplomacy);
  if (diploOverlay) {
    diploOverlay.addEventListener('click', (e) => {
      if (e.target === diploOverlay) hideDiplomacy();
    });
  }
}
setupDiplomacyButton();

function setupEmpireButton() {
  const button = document.getElementById('empireBtn');
  if (button) button.addEventListener('click', showEmpire);
  const close = document.getElementById('empireClose');
  if (close) close.addEventListener('click', hideEmpire);
  if (empireOverlay) {
    empireOverlay.addEventListener('click', (e) => {
      if (e.target === empireOverlay) hideEmpire();
    });
  }
}
setupEmpireButton();

function resizeScene() {
  const rect = canvas.parentElement.getBoundingClientRect();
  resize(rect.width, rect.height);
}

// The window resize event misses changes that come from the page itself -
// collapsing the sidebar, or a host resizing the embed - so watch the map
// container directly.
function observeMapSize() {
  if (typeof ResizeObserver !== 'function') return;
  const observer = new ResizeObserver(() => {
    resizeScene();
    zeichneKarte();
  });
  observer.observe(canvas.parentElement);
}

// --- Die Merktafel --------------------------------------------------------
// Der rechte Flügel des Triptychons. Ein Feldzug, der zu Ende ist - gewonnen
// oder verloren -, ist zu Ende: was bleibt, ist sein Andenken. Ein Feldzug,
// der nur unterbrochen wurde, ist etwas anderes - der wartet als Spielstand
// auf die Kachel "Fortsetzen" (`savegame.js`) und steht hier nicht drin. Die
// Merktafel füllt nur, was sonst leer bliebe, wenn man noch nie gespielt hat.
const MEMO_KEY = 'spqr.letzterFeldzug';

function ladeMerktafel() {
  try {
    const roh = localStorage.getItem(MEMO_KEY);
    return roh ? JSON.parse(roh) : null;
  } catch (err) {
    return null;
  }
}

// Aufgeschrieben wird beim Ende eines Feldzugs - ob gewonnen, verloren oder
// abgebrochen. `ausgang` sagt, welches davon.
function merkeFeldzug(ausgang) {
  if (!state) return;
  try {
    const ich = playerFaction(state);
    const orte = state.cities.filter((c) => c.factionId === ich.id);
    const heere = state.armies.filter((a) => a.factionId === ich.id);
    const { season, year } = calendarOfTurn(state.turn, state.startYear);
    // Die letzte Schlacht, an der man selbst beteiligt war.
    const schlacht = (state.battleReports || []).find((r) => r.involvesPlayer);
    localStorage.setItem(MEMO_KEY, JSON.stringify({
      fraktion: ich.name,
      farbe: ich.color,
      ausgang,
      runde: state.turn,
      jahr: `${season.icon} ${season.name} ${year} v. Chr.`,
      orte: orte.length,
      mann: heere.reduce((sum, a) => sum + unitTotalCount(a.units), 0),
      gold: Math.round(ich.gold),
      schlacht: schlacht ? {
        wo: schlacht.cityName || `${schlacht.col},${schlacht.row}`,
        sieg: (schlacht.attackerFactionId === ich.id) === (schlacht.outcome === 'attacker'),
      } : null,
    }));
  } catch (err) {
    // Ein Browser, der nichts speichern darf, ist kein Grund für einen Fehler.
  }
}

const MEMO_AUSGANG = {
  victory: { text: 'Sieg', klasse: 'memo-win' },
  defeat: { text: 'Niederlage', klasse: 'memo-loss' },
  abgebrochen: { text: 'abgebrochen', klasse: '' },
};

function zeigeMerktafel() {
  const box = document.getElementById('startMemo');
  if (!box) return;
  const merk = ladeMerktafel();
  if (!merk) {
    box.innerHTML = `
      <h2 class="memo-head">Worum es geht</h2>
      <div class="memo-sheet">
        <p>Ein Reich des Altertums, von <strong>264 v. Chr.</strong> an. Sechzehn
          Mächte zwischen Atlantik und iranischer Hochebene, jede mit ihrem
          Herrscher, ihren Truppen und ihrer Musik.</p>
        <p>Der Feldzug wird über einer Karte geführt, die auf dem Tisch im eigenen
          <strong>Feldherrnzelt</strong> liegt. Jede Runde ist ein Monat, drei
          Monate sind eine Jahreszeit, und das Wetter zählt mit.</p>
        <p>Gewonnen hat, wer <strong>zwanzig Orte</strong> hält. Verloren hat,
          wer keinen mehr hat.</p>
      </div>
      <p class="memo-note">Was hier steht, wenn du einmal gespielt hast, ist das
        Andenken an den letzten zu Ende gebrachten Feldzug – ein
        unterbrochener wartet stattdessen unter "Fortsetzen".</p>`;
    return;
  }
  const ausgang = MEMO_AUSGANG[merk.ausgang] || MEMO_AUSGANG.abgebrochen;
  const zeile = (name, wert) => `<div class="memo-row"><dt>${name}</dt><dd>${wert}</dd></div>`;
  box.innerHTML = `
    <h2 class="memo-head">Dein letzter Feldzug</h2>
    <div class="memo-crest">
      <span class="memo-dot" style="background:${escapeText(merk.farbe || '#888')}"></span>
      <strong>${escapeText(merk.fraktion || 'Unbekannt')}</strong>
    </div>
    <dl class="memo-rows">
      ${zeile('Ausgang', `<span class="${ausgang.klasse}">${ausgang.text}</span>`)}
      ${zeile('Zuletzt', escapeText(merk.jahr || '–'))}
      ${zeile('Runden', merk.runde || 0)}
      ${zeile('Orte', merk.orte || 0)}
      ${zeile('Mann im Feld', (merk.mann || 0).toLocaleString('de-DE'))}
      ${zeile('Schatz', `${(merk.gold || 0).toLocaleString('de-DE')} Gold`)}
      ${merk.schlacht ? zeile('Letzte Schlacht',
    `<span class="${merk.schlacht.sieg ? 'memo-win' : 'memo-loss'}">${
      merk.schlacht.sieg ? 'Sieg' : 'Niederlage'}</span> bei ${escapeText(merk.schlacht.wo)}`) : ''}
    </dl>
    <p class="memo-note">Dieser Feldzug ist entschieden – ein neuer beginnt von
      vorn. Diese Tafel ist nur das Andenken.</p>`;
}

// --- Die Kachel "Fortsetzen" -----------------------------------------------
// Sie steht nur da, solange ein unterbrochener Feldzug wartet - und dann an
// der Stelle, an der sonst "Neues Spiel" hervorgehoben ist: wer mitten in
// einem Feldzug steckt, will ihn eher fortsetzen als einen zweiten beginnen.
function zeigeFortsetzenKachel() {
  const btn = document.getElementById('continueGameBtn');
  const startBtn = document.getElementById('startGameBtn');
  if (!btn || !startBtn) return;
  const stand = saveGameSummary();
  btn.classList.toggle('hidden', !stand);
  btn.classList.toggle('menu-primary', !!stand);
  startBtn.classList.toggle('menu-primary', !stand);
  if (!stand) return;
  const label = btn.querySelector('.mp-text small');
  if (label) {
    label.textContent = `${stand.fraktion} · ${stand.jahr} · ${
      stand.orte} ${stand.orte === 1 ? 'Ort' : 'Orte'}`;
  }
}

// --- Feldzug beenden ------------------------------------------------------
// Zurück ins Hauptmenü, mit Rückfrage - nicht weil der Feldzug dabei verloren
// ginge (er wird gespeichert), sondern weil ein falscher Klick mitten in
// einem Zug sonst ungefragt aus dem Spiel führte.

function showQuitDialog() {
  const overlay = document.getElementById('quitOverlay');
  if (overlay) overlay.classList.remove('hidden');
}

function hideQuitDialog() {
  const overlay = document.getElementById('quitOverlay');
  if (overlay) overlay.classList.add('hidden');
}

function quitToMenu() {
  // Ein entschiedener Feldzug hat sein Andenken und keinen Spielstand mehr -
  // das erledigt schon das Rundenende, in dem er entschieden wurde. Ein
  // unterbrochener bekommt seinen Spielstand erst hier, beim Verlassen.
  if (state && !state.gameOver) saveGame(state);
  hideQuitDialog();
  hideHerald();
  hideEmpire();
  hideEvent();
  hideBattleReport();
  hideBattlePreview();
  hideTileInfo();
  stopMarch();
  // Der Feldzug endet, die Musik seiner Fraktion mit ihm.
  stopAnthem({ fadeOut: 2 });
  // Erst die Szene abmelden, dann den Spielstand loslassen: die Karte fragt
  // das Wetter über einen Rückruf ab, und der griffe sonst ins Leere.
  setWeatherSource(null);
  setWeatherReporter(null);
  state = null;
  undoStack.length = 0;
  appEl.classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
  schliesseTafel();
  zeigeMerktafel();
  zeigeFortsetzenKachel();
  startGlimpseCycle();
  syncMenuMusic();
  focusStartButton();
}

function setupQuitButton() {
  const button = document.getElementById('quitBtn');
  if (button) button.addEventListener('click', showQuitDialog);
  const confirmBtn = document.getElementById('quitConfirm');
  if (confirmBtn) confirmBtn.addEventListener('click', quitToMenu);
  const cancelBtn = document.getElementById('quitCancel');
  if (cancelBtn) cancelBtn.addEventListener('click', hideQuitDialog);
  const overlay = document.getElementById('quitOverlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) hideQuitDialog(); });
  }
}

// --- Feldauskunft (Rechtsklick) -----------------------------------------
// Ein Fenster am Mauszeiger, das sagt, was auf dem Feld steht. Es ändert
// nichts: keine Auswahl, keine Bewegung, kein Zug.

function hideTileInfo() {
  const box = document.getElementById('tileInfo');
  if (box) box.classList.add('hidden');
}

function showTileInfo(tile, clientX, clientY) {
  const box = document.getElementById('tileInfo');
  const body = document.getElementById('tileInfoBody');
  if (!box || !body || !state || !tile) {
    hideTileInfo();
    return;
  }
  const html = tileInfoHTML(state, tile);
  if (!html.trim()) {
    hideTileInfo();
    return;
  }
  body.innerHTML = html;
  box.classList.remove('hidden');
  // Am Zeiger, aber immer ganz im Bild: sonst steht die Hälfte außerhalb,
  // wenn man am rechten oder unteren Rand nachschlägt.
  const wrap = document.getElementById('mapWrap').getBoundingClientRect();
  const width = box.offsetWidth;
  const height = box.offsetHeight;
  const left = Math.min(Math.max(8, clientX - wrap.left + 14), wrap.width - width - 8);
  const top = Math.min(Math.max(8, clientY - wrap.top + 14), wrap.height - height - 8);
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
}

function setupTileInfo() {
  const close = document.getElementById('tileInfoClose');
  if (close) close.addEventListener('click', hideTileInfo);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTileInfo(); });
  // Ein Klick auf die Karte oder daneben schließt es wieder.
  document.addEventListener('pointerdown', (e) => {
    const box = document.getElementById('tileInfo');
    if (!box || box.classList.contains('hidden')) return;
    if (box.contains(e.target)) return;
    if (e.button === 2) return;
    hideTileInfo();
  }, true);
}

// --- Reiter in der Seitenleiste -----------------------------------------
// Auswahl, Fraktionen und Protokoll teilen sich denselben Platz. Wer etwas
// anklickt, will die Auswahl sehen - dorthin springt die Leiste von selbst;
// neue Ereignisse melden sich stattdessen mit einer Zahl am Reiter.

let activeTab = 'selection';
let seenLogLength = 0;

function showSidebarTab(tab) {
  activeTab = tab;
  document.querySelectorAll('#sidebarTabs .tab-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  document.querySelectorAll('#sidebar > section').forEach((section) => {
    section.hidden = section.dataset.panel !== tab;
  });
  if (tab === 'log' && state) {
    seenLogLength = visibleLogCount(state);
    paintLogBadge();
  }
}

function paintLogBadge() {
  const badge = document.querySelector('#sidebarTabs .tab-badge');
  if (!badge || !state) return;
  const unseen = activeTab === 'log' ? 0 : Math.max(0, visibleLogCount(state) - seenLogLength);
  badge.textContent = unseen > 9 ? '9+' : String(unseen);
  badge.classList.toggle('hidden', unseen === 0);
}

function setupSidebarTabs() {
  document.querySelectorAll('#sidebarTabs .tab-btn').forEach((button) => {
    button.addEventListener('click', () => {
      sfx.select();
      showSidebarTab(button.dataset.tab);
    });
  });
  showSidebarTab('selection');
}

// Auf einem schmalen Schirm legt sich die Seitenleiste über die Karte statt
// neben sie - offen bliebe von der Karte kaum etwas übrig. Sie beginnt deshalb
// dort eingeklappt; ⇥ im Menü holt sie hervor.
const NARROW_SCREEN = 620;

function setSidebarCollapsed(collapsed) {
  const button = document.getElementById('sidebarBtn');
  appEl.classList.toggle('sidebar-collapsed', collapsed);
  if (button) {
    button.classList.toggle('active', collapsed);
    // Nur das Zeichen wechselt - die Beschriftung daneben bleibt stehen.
    setButtonIcon(button, collapsed ? '⇤' : '⇥');
  }
  // ResizeObserver picks the new size up, but resize now so the very next
  // frame is already correct.
  resizeScene();
  zeichneKarte();
}

function setupSidebarToggle() {
  const button = document.getElementById('sidebarBtn');
  if (!button) return;
  button.addEventListener('click', () => {
    setSidebarCollapsed(!appEl.classList.contains('sidebar-collapsed'));
  });
}

// The tactical view is a way of looking at the same map, so the button says
// which way you are looking at it right now.
// Names the weather where the player is actually looking, with what it costs.
function paintWeatherLabel(weather) {
  // A tint over the whole map, which reads at any camera angle - the scene's
  // own fog only bites at a distance, and a sandstorm has to be felt up close.
  const veil = document.getElementById('weatherVeil');
  if (veil) {
    veil.dataset.effect = getSetting('weatherEffects') ? (weather.effect || 'clear') : 'clear';
  }
  const label = document.getElementById('weatherLabel');
  if (!label || !state) return;
  const { season } = calendarOfTurn(state.turn, state.startYear);
  const price = [];
  if (weather.moveCost) price.push(`+${weather.moveCost} Bew.`);
  if (weather.wear) price.push(`+${weather.wear} Ersch.`);
  label.textContent = `${weather.icon} ${weather.name}${price.length ? ` · ${price.join(' · ')}` : ''}`;
  label.title = `${season.name}: ${weather.note || 'Kein besonderes Wetter.'}`;
  label.classList.toggle('weather-harsh', !!weather.moveCost);
}

function refreshMapModeButton() {
  const button = document.getElementById('mapModeBtn');
  if (!button) return;
  const tactical = getMapMode() === 'tactical';
  button.classList.toggle('active', tactical);
  setButtonIcon(button, tactical ? '🏔️' : '🗺');
  button.title = tactical
    ? 'Zurück zur Geländekarte (3)'
    : 'Taktische Sicht: Gebiete nach Fraktionen (3)';
}

// --- Chronik im Startbildschirm ------------------------------------------
// Zwei übereinanderliegende Ebenen, von denen immer eine sichtbar ist: das
// nächste Bild wird unsichtbar aufgebaut und dann eingeblendet, damit der
// Wechsel nie stockt.
const CHRONICLE_INTERVAL = 11000;
let chronicleIndex = 0;
let chronicleSlot = 0;
let chronicleTimer = null;

function paintChronicle(index, { animate = true } = {}) {
  const stage = document.getElementById('chronicleStage');
  if (!stage || !CHRONICLE.length) return;
  chronicleIndex = ((index % CHRONICLE.length) + CHRONICLE.length) % CHRONICLE.length;
  const scene = CHRONICLE[chronicleIndex];
  const layers = stage.querySelectorAll('.chron-layer');
  const next = layers[chronicleSlot ^ 1];
  const current = layers[chronicleSlot];

  next.innerHTML = chronicleSVG(scene);
  next.classList.toggle('chron-still', !animate);
  // Restarting the slow drift means taking the element out of the animation
  // and putting it back; without the reflow the browser keeps the old one.
  next.style.animation = 'none';
  void next.offsetWidth;
  next.style.animation = '';
  next.classList.add('visible');
  current.classList.remove('visible');
  chronicleSlot ^= 1;

  document.querySelector('.chron-year').textContent = scene.year;
  document.querySelector('.chron-title').textContent = scene.title;
  document.querySelector('.chron-text').textContent = scene.text;
  document.querySelectorAll('#chronDots button').forEach((dot, i) => {
    dot.classList.toggle('active', i === chronicleIndex);
    dot.setAttribute('aria-current', i === chronicleIndex ? 'true' : 'false');
  });
}

function scheduleChronicle() {
  clearTimeout(chronicleTimer);
  if (!getSetting('chronicle')) return;
  chronicleTimer = setTimeout(() => {
    paintChronicle(chronicleIndex + 1);
    scheduleChronicle();
  }, CHRONICLE_INTERVAL);
}

function stepChronicle(delta) {
  paintChronicle(chronicleIndex + delta);
  scheduleChronicle();
}

// Verdrahtet wird einmal, gestartet jedes Mal, wenn die Tafel aufgeschlagen
// wird - sonst hinge nach dem dritten Aufschlagen ein dritter Zuhörer an den
// Pfeilen.
let chronicleWired = false;

// `startIndex` lässt die Chronik gezielt an einer Stelle aufschlagen - der
// Blick von der Titelseite (`zeigeGlimpse`) öffnet sie genau bei der
// Geschichte, die dort gerade stand, statt irgendwo neu zu beginnen.
function startChronicle(startIndex) {
  const dots = document.getElementById('chronDots');
  if (!dots) return;
  if (chronicleWired) {
    paintChronicle(startIndex !== undefined ? startIndex : chronicleIndex, { animate: false });
    scheduleChronicle();
    return;
  }
  chronicleWired = true;
  dots.innerHTML = CHRONICLE.map((scene, i) =>
    `<button data-index="${i}" title="${scene.year} – ${scene.title}"
      aria-label="${scene.year} – ${scene.title}"></button>`).join('');
  dots.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    paintChronicle(Number(button.dataset.index));
    scheduleChronicle();
  });
  document.getElementById('chronPrev').addEventListener('click', () => stepChronicle(-1));
  document.getElementById('chronNext').addEventListener('click', () => stepChronicle(1));
  // Start somewhere in the story rather than always at the founding.
  paintChronicle(startIndex !== undefined ? startIndex : Math.floor(Math.random() * CHRONICLE.length),
    { animate: false });
  scheduleChronicle();
}

function stopChronicle() {
  clearTimeout(chronicleTimer);
  chronicleTimer = null;
}

// --- Der Blick in die Chronik ----------------------------------------------
// Rechts blieb sonst nichts als das Bild, solange keine Tafel aufgeschlagen
// ist - hier steht dafür, nur wo wirklich Platz ist (CSS blendet es auf
// schmalem oder flachem Schirm aus), ein kurzer Ausschnitt aus der Chronik.
// Ein Klick öffnet sie genau an dieser Stelle statt zufällig.
let glimpseIndex = 0;
let glimpseTimer = null;

function paintGlimpse() {
  const jahr = document.getElementById('tgYear');
  const titel = document.getElementById('tgTitle');
  if (!jahr || !titel) return;
  const szene = CHRONICLE[glimpseIndex];
  jahr.textContent = szene.year;
  titel.textContent = szene.title;
}

// Nur ein Sichtbarkeitswechsel - der Inhalt steht schon, solange der
// Umlauf läuft. Gerufen, wenn eine Tafel wieder zugeht.
function zeigeGlimpse() {
  const box = document.getElementById('titleGlimpse');
  if (box) box.classList.remove('hidden');
}

function hideGlimpse() {
  const box = document.getElementById('titleGlimpse');
  if (box) box.classList.add('hidden');
}

function startGlimpseCycle() {
  if (glimpseTimer) return;
  paintGlimpse();
  zeigeGlimpse();
  glimpseTimer = setInterval(() => {
    glimpseIndex = (glimpseIndex + 1) % CHRONICLE.length;
    paintGlimpse();
  }, 7000);
}

function stopGlimpseCycle() {
  clearInterval(glimpseTimer);
  glimpseTimer = null;
  hideGlimpse();
}

// Die Fraktionsübersicht: nach Macht, Militär oder Schatz sortiert. Die Wahl
// bleibt stehen, solange das Spiel läuft.
function setupFactionSort() {
  const box = document.getElementById('factionSort');
  if (!box) return;
  box.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    setFactionSort(button.dataset.sort);
    box.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.sort === getFactionSort());
    });
    sfx.select();
    refresh();
  });
}

function setupMapModeButton() {
  const button = document.getElementById('mapModeBtn');
  if (!button) return;
  button.addEventListener('click', () => {
    if (!state) return;
    setMapMode(getMapMode() === 'tactical' ? 'terrain' : 'tactical', state);
    refreshMapModeButton();
    sfx.select();
    zeichneKarte();
  });
  refreshMapModeButton();
}

// --- Grenzen -------------------------------------------------------------
// Die Herrschaftsgebiete als Linie auf der Geländekarte. Ein eigener Knopf,
// weil es eine andere Frage ist als die taktische Sicht: dort geht es darum,
// wem was gehört, hier darum, wo das eine Land aufhört und das nächste
// anfängt - und das will man auch sehen, während man die Karte selbst liest.
function refreshBorderButton() {
  const button = document.getElementById('borderBtn');
  if (!button) return;
  const an = areBordersVisible();
  button.classList.toggle('active', an);
  button.title = an
    ? 'Grenzen ausblenden (4)'
    : 'Grenzen der Herrschaftsgebiete einblenden (4)';
}

function setupBorderButton() {
  const button = document.getElementById('borderBtn');
  if (!button) return;
  refreshBorderButton();
  button.addEventListener('click', () => {
    setBordersVisible(!areBordersVisible(), state);
    refreshBorderButton();
    sfx.select();
    zeichneKarte();
  });
}

function refreshMuteButton() {
  const button = document.getElementById('muteBtn');
  if (!button) return;
  setButtonIcon(button, isMuted() ? '🔇' : '🔊');
  button.classList.toggle('active', !isMuted());
}

function setupMuteButton() {
  const button = document.getElementById('muteBtn');
  if (!button) return;
  refreshMuteButton();
  button.addEventListener('click', () => {
    unlockAudio();
    toggleMuted();
    refreshMuteButton();
    syncMenuMusic();
    if (!isMuted()) sfx.select();
  });
}

function syncSelection() {
  if (!state) return;
  if (state.selectedArmyId) {
    const army = state.armies.find((a) => a.id === state.selectedArmyId);
    if (army) {
      state.reachable = computeReachable(state, army);
    } else {
      state.selectedArmyId = null;
      state.reachable = null;
    }
  }
  if (state.selectedCityId && !state.cities.find((c) => c.id === state.selectedCityId)) {
    state.selectedCityId = null;
  }
}

const reportOverlay = document.getElementById('battleReport');
const undoBtn = document.getElementById('undoBtn');

// Zurückgenommen wird ein Schritt, nicht die halbe Runde. Der Knopf ist da,
// damit ein Fehlklick nichts kostet - nicht, damit man den Zug der Gegner
// mehrfach durchprobiert und sich die günstigste Fassung aussucht. Vorher
// reichte der Stapel fünfundzwanzig Schritte weit zurück; wer wollte, konnte
// damit ein ganzes Feldzugsjahr rückwärts spielen.
const UNDO_LIMIT = 1;
const undoStack = [];

// The generated map never changes after startup, so snapshots share it by
// reference instead of copying 1200 tiles per action.
function snapshotState() {
  const { map, reachable, ...rest } = state;
  const copy = typeof structuredClone === 'function'
    ? structuredClone(rest)
    : JSON.parse(JSON.stringify(rest));
  return copy;
}

function pushUndo() {
  if (!state) return;
  undoStack.push(snapshotState());
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

function undoLastAction() {
  if (!state || !undoStack.length || isAnimating()) return;
  const previous = undoStack.pop();
  state = { ...previous, map: state.map, reachable: null };
  stopMarch();
  sfx.undo();
  hideBattlePreview();
  hideBattleReport();
  refresh();
}

function showBattleReport(reportOrId) {
  if (!state) return;
  const report = typeof reportOrId === 'string'
    ? state.battleReports.find((r) => r.id === reportOrId)
    : reportOrId;
  if (!report) return;
  document.getElementById('reportBody').innerHTML = battleReportHTML(state, report);
  reportOverlay.classList.remove('hidden');
}

function hideBattleReport() {
  reportOverlay.classList.add('hidden');
}

const previewOverlay = document.getElementById('battlePreview');
let pendingAttack = null;
// Der Weg neben dem Sturm: sich vor den Ort legen.
let pendingSiege = null;

function hideBattlePreview() {
  previewOverlay.classList.add('hidden');
  pendingAttack = null;
  pendingSiege = null;
}

// The forecast, and the decision it exists for. Nothing has happened yet when
// this opens: cancelling leaves the army exactly where it stood.
// Welcher Angriff gerade in der Vorschau steht - für den Fall, dass der
// Spieler die Schlachtordnung wechselt: dann wird die Prognose mit ihr neu
// gerechnet, sonst verspräche sie etwas anderes, als hinterher gefochten wird.
let vorschauZug = null;

function showBattlePreview(preview, confirm, siegeConfirm) {
  if (!state) return;
  // Turned off, the attack simply happens - the forecast was a courtesy, not
  // a gate. Nur eine Kriegserklärung nicht: wer im Frieden zuschlägt, wird
  // gefragt, auch wenn die Vorschau abgeschaltet ist.
  // Abschalten lässt sich die Prognose, nicht die Entscheidung: wo ein Krieg
  // erklärt würde oder wo statt des Sturms auch eine Belagerung offensteht,
  // geht das Fenster in jedem Fall auf.
  if (!getSetting('battlePreview') && !preview.declareWarOn && !siegeConfirm) {
    confirm();
    return;
  }
  vorschauZug = { armyId: preview.armyId, col: preview.col, row: preview.row };
  document.getElementById('previewBody').innerHTML = battlePreviewHTML(state, preview);
  const attackBtn = document.getElementById('previewAttack');
  attackBtn.textContent = preview.declareWarOn
    ? (preview.unopposed ? '⚔️ Einnehmen – und den Krieg erklären'
      : '⚔️ Angreifen – und den Krieg erklären')
    : preview.unopposed ? '🚩 Einnehmen' : '⚔️ Angreifen';
  // Der zweite Knopf steht nur da, wo sich statt des Sturms auch belagern ließe.
  const siegeBtn = document.getElementById('previewSiege');
  if (siegeBtn) siegeBtn.classList.toggle('hidden', !siegeConfirm);
  pendingSiege = siegeConfirm || null;
  pendingAttack = confirm;
  previewOverlay.classList.remove('hidden');
  attackBtn.focus();
}

// --- Die Schlachtordnung --------------------------------------------------
// Zwei Stellen, an denen gewählt wird: die Angriffsordnung in der Vorschau
// (für diesen einen Angriff, und sie bleibt als Vorgabe stehen) und die
// Verteidigungsordnung im Reichsfenster (als stehender Befehl). Beide Male
// sind es dieselben Knöpfe, deshalb genügt ein Zuhörer für das ganze Fenster.
function setupTacticPickers() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.tactic-btn');
    if (!btn || !state) return;
    const seite = btn.dataset.tacticSide;
    const key = btn.dataset.tactic;
    if (!seite || !key) return;
    const me = playerFaction(state).id;
    setTactic(state, me, seite, key);
    sfx.select();
    if (seite === 'angriff' && vorschauZug && pendingAttack) {
      // Die Prognose neu rechnen: sie hängt an der gewählten Ordnung.
      const neu = previewTileCombat(state, vorschauZug.armyId,
        vorschauZug.col, vorschauZug.row, undefined, key);
      if (neu) {
        document.getElementById('previewBody').innerHTML = battlePreviewHTML(state, neu);
        return;
      }
    }
    // Im Reichsfenster: es zeichnet sich nicht von selbst neu, und der
    // gewählte Knopf soll auch als gewählt dastehen.
    if (empireOverlay && !empireOverlay.classList.contains('hidden')) showEmpire();
    refresh();
  });
}
setupTacticPickers();

// --- Grenzverletzung ------------------------------------------------------
// Ein Schritt über eine fremde Grenze ist eine Kriegserklärung, und niemand
// soll sie aus Versehen abgeben. Das Fenster nennt das Reich, sagt, was der
// Marsch bedeutet - und wenn ein Vertrag die Hand bindet, dass er gar nicht
// geht.
const borderOverlay = document.getElementById('borderWarn');
let pendingBorder = null;

// Fraktionsnamen kommen aus der eigenen Tabelle, aber ein Fenster, das HTML
// zusammensetzt, prüft das trotzdem.
function escapeText(text) {
  return String(text).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function hideBorderWarning() {
  if (borderOverlay) borderOverlay.classList.add('hidden');
  pendingBorder = null;
}

// --- Das Schlacht-HUD ------------------------------------------------------
// Steht über der Karte, solange der Zusammenprall selbst läuft: wer da
// aufeinandertrifft, wie viele Mann auf jeder Seite engagiert sind, und ein
// Knopf, der den Augenblick überspringt, für wen die Länge nicht sein muss.
const battleHudEl = document.getElementById('battleHud');

function hideBattleHud() {
  if (battleHudEl) battleHudEl.classList.add('hidden');
}

// Wie sehr "beschleunigt" den Zusammenprall rafft - schnell genug, dass die
// Länge nicht mehr stört, aber nicht so schnell, dass von den Schlachtreihen
// selbst nichts mehr zu sehen bliebe.
const BATTLE_FAST_FACTOR = 3.2;

function showBattleHud({ report, angreiferFraktion, verteidigerFraktion }) {
  if (!battleHudEl) return;
  const summe = (units) => Object.values(units || {}).reduce((s, n) => s + (n || 0), 0);
  const seite = (fraktion, units) => `
    <span class="battle-hud-side">
      <span class="battle-hud-dot" style="background:${fraktion ? fraktion.color : '#888'}"></span>
      <strong>${escapeText(fraktion ? fraktion.name : '?')}</strong>
      <small>${summe(units).toLocaleString('de-DE')} Mann</small>
    </span>`;
  battleHudEl.innerHTML = `
    ${seite(angreiferFraktion, report.attackerEngaged)}
    <span class="battle-hud-vs">${report.cityName ? `bei ${escapeText(report.cityName)}` : '⚔'}</span>
    ${seite(verteidigerFraktion, report.defenderEngaged)}
    <button id="battleHudFast" class="battle-hud-skip" type="button">⏩ Beschleunigen</button>
    <button id="battleHudSkip" class="battle-hud-skip" type="button">⏭ Überspringen</button>
  `;
  battleHudEl.classList.remove('hidden');
  const skip = document.getElementById('battleHudSkip');
  if (skip) skip.addEventListener('click', () => skipBattleClash());
  // Jede Schlacht beginnt wieder in normaler Geschwindigkeit - der Knopf
  // schaltet nur für diesen einen Zusammenprall um, kein Dauerzustand.
  let schnell = false;
  const fast = document.getElementById('battleHudFast');
  if (fast) {
    fast.addEventListener('click', () => {
      schnell = !schnell;
      setBattleSpeed(schnell ? BATTLE_FAST_FACTOR : 1);
      fast.textContent = schnell ? '▶ Normal' : '⏩ Beschleunigen';
    });
  }
}

function onBattleHud(info) {
  if (info) showBattleHud(info); else hideBattleHud();
}

function showBorderWarning(warnung, confirm) {
  if (!borderOverlay || !state) { confirm(); return; }
  const body = document.getElementById('borderBody');
  const go = document.getElementById('borderGo');
  const name = escapeText(warnung.name);
  if (body) {
    body.innerHTML = warnung.blocked
      ? `<h2 class="report-title">🚩 Die Grenze bleibt zu</h2>
         <p class="emp-note">Jenseits dieser Linie liegt das Land von <strong>${name}</strong>.
         Ein Wort steht dazwischen: ${escapeText(warnung.blocked)}. Solange es gilt,
         überschreitet dein Heer die Grenze nicht.</p>
         <p class="emp-note muted">Im Diplomatiefenster lässt sich der Vertrag aufkündigen –
         oder ein Betretungsrecht schließen, das den Marsch erlaubt, ohne dass er Krieg
         bedeutet.</p>`
      : `<h2 class="report-title">🚩 Grenzverletzung</h2>
         <p class="emp-note">Jenseits dieser Linie liegt das Land von <strong>${name}</strong>,
         und ihr steht im Frieden. Wer ohne Betretungsrecht einmarschiert,
         <strong>erklärt damit den Krieg</strong> – die Herolde brauchen keine Runde dafür.</p>
         <p class="emp-note muted">Ein Betretungsrecht schließt du im Diplomatiefenster.
         Bis dahin: Halten heißt, den Frieden zu behalten.</p>`;
  }
  if (go) go.classList.toggle('hidden', !!warnung.blocked);
  pendingBorder = warnung.blocked ? null : confirm;
  borderOverlay.classList.remove('hidden');
  const focus = warnung.blocked ? document.getElementById('borderCancel') : go;
  if (focus) focus.focus();
}

function confirmBorderCrossing() {
  const run = pendingBorder;
  hideBorderWarning();
  if (run) run();
}

function setupBorderWarning() {
  for (const id of ['borderClose', 'borderCancel']) {
    const button = document.getElementById(id);
    if (button) button.addEventListener('click', hideBorderWarning);
  }
  const go = document.getElementById('borderGo');
  if (go) go.addEventListener('click', confirmBorderCrossing);
}
setupBorderWarning();

function confirmPendingAttack() {
  const run = pendingAttack;
  hideBattlePreview();
  if (run) run();
}

// Was zuletzt angewählt war - wechselt es, springt die Leiste auf die Auswahl.
let lastSelectionKey = '';

function refresh() {
  if (!state) return;
  syncSelection();
  const selectionKey = [state.selectedArmyId, state.selectedCityId,
    state.inspectedTile && `${state.inspectedTile.col},${state.inspectedTile.row}`].join('|');
  if (selectionKey !== lastSelectionKey) {
    lastSelectionKey = selectionKey;
    if (state.selectedArmyId || state.selectedCityId || state.inspectedTile) {
      showSidebarTab('selection');
    }
  }
  syncEntities(state);
  zeichneKarte();
  renderUI(state, {
    onRecruit: (cityId, unitKey) => {
      pushUndo();
      const ok = recruitUnit(state, cityId, unitKey).ok;
      (ok ? sfx.recruit : sfx.denied)();
      refresh();
    },
    onCancelTraining: (cityId, index) => {
      pushUndo();
      const ok = cancelTraining(state, cityId, index).ok;
      (ok ? sfx.wallBuy : sfx.denied)();
      refresh();
    },
    onRaise: (cityId) => {
      pushUndo();
      const ok = raiseArmyFromGarrison(state, cityId).ok;
      (ok ? sfx.raise : sfx.denied)();
      refresh();
    },
    onReinforce: (armyId, unitKey) => {
      pushUndo();
      const ok = reinforceArmy(state, armyId, unitKey).ok;
      (ok ? sfx.recruit : sfx.denied)();
      refresh();
    },
    // Belagerungsgerät: gezimmert wird in der Stadt, mitgeführt vom Heer.
    onEngine: (armyId, key) => {
      pushUndo();
      const ok = buildSiegeEngine(state, armyId, key).ok;
      (ok ? sfx.wallBuy : sfx.denied)();
      refresh();
    },
    onDisband: (armyId) => {
      pushUndo();
      const result = disbandArmyIntoCity(state, armyId);
      if (result.ok) state.selectedCityId = result.cityId;
      (result.ok ? sfx.disband : sfx.denied)();
      refresh();
    },
    onBuyWalls: (cityId) => {
      pushUndo();
      const ok = buyCityWalls(state, cityId).ok;
      (ok ? sfx.wallBuy : sfx.denied)();
      refresh();
    },
    // Ein Handler für alle Bauwerke - welches gemeint ist, steht am Knopf.
    onBuild: (cityId, key) => {
      pushUndo();
      const ok = buyBuilding(state, cityId, key).ok;
      (ok ? sfx.wallBuy : sfx.denied)();
      refresh();
    },
    onBuildFleet: (cityId, kind) => {
      pushUndo();
      const result = buildFleet(state, cityId, kind || null);
      if (result.ok) state.selectedArmyId = result.armyId;
      (result.ok ? sfx.embark : sfx.denied)();
      refresh();
    },
    onBuildRoad: (cityId, targetId) => {
      pushUndo();
      const ok = buyRoad(state, cityId, targetId).ok;
      (ok ? sfx.wallBuy : sfx.denied)();
      refresh();
    },
    onUpgradeRoad: (cityId, targetId) => {
      pushUndo();
      const ok = upgradeRoad(state, cityId, targetId).ok;
      (ok ? sfx.wallBuy : sfx.denied)();
      refresh();
    },
    onUpgradeGravel: (cityId, targetId) => {
      pushUndo();
      const ok = upgradeToGravel(state, cityId, targetId).ok;
      (ok ? sfx.wallBuy : sfx.denied)();
      refresh();
    },
    onOpenTrade: (cityId, targetId) => {
      pushUndo();
      const ok = openTradeRoute(state, cityId, targetId).ok;
      (ok ? sfx.wallBuy : sfx.denied)();
      refresh();
    },
    onCloseTrade: (routeId) => {
      pushUndo();
      closeTradeRoute(state, routeId);
      sfx.select();
      refresh();
    },
    // Eine Belagerung wird erklärt - vom Heer, das schon davorsteht.
    onSiege: (armyId, cityId) => {
      pushUndo();
      const result = besiegeCity(state, armyId, cityId);
      (result.ok ? sfx.raise : sfx.denied)();
      refresh();
    },
    // Graben, Wall, Palisade - und vor einer fremden Stadt die Belagerung.
    onCamp: (armyId, abbrechen) => {
      pushUndo();
      const result = abbrechen ? breakCamp(state, armyId) : buildCamp(state, armyId);
      (result.ok ? sfx.wallBuy : sfx.denied)();
      refresh();
    },
    // Sich legen und warten. Kostet kein Gold, nur den Rest des Tages.
    onAmbush: (armyId, aufgeben) => {
      pushUndo();
      const result = aufgeben ? leaveAmbush(state, armyId) : layAmbush(state, armyId);
      (result.ok ? sfx.wallBuy : sfx.denied)();
      refresh();
    },
    onEmbark: (armyId) => {
      pushUndo();
      const ok = embarkArmy(state, armyId).ok;
      (ok ? sfx.embark : sfx.denied)();
      refresh();
    },
    onShowReport: showBattleReport,
    onRefresh: refresh,
  });

  undoBtn.disabled = undoStack.length === 0;
  paintLogBadge();
}

// --- Das Bauamt meldet -----------------------------------------------------
// Ein Bauauftrag läuft über Runden, und wenn er fertig wird, ist der Spieler
// längst woanders. Vorher stand es nur im Protokoll, wo es unterging - jetzt
// hält die Runde an und sagt es. Mauern, Straßen und Bauwerke laufen dabei
// durch dieselbe Meldung: was fertig ist, ist fertig.
const ZAHLWORT = ['kein', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs',
  'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf'];

function zahlwort(n) {
  return n < ZAHLWORT.length ? ZAHLWORT[n] : String(n);
}

// Was ein einzelnes fertiges Werk trägt - dieselbe Zeile für die Liste und
// für das Fenster, wenn es allein steht.
function bauEintraege(wallsDone, roadsDone, builtDone) {
  const me = playerFaction(state).id;
  const eintraege = [];
  for (const { city, level, repair } of wallsDone) {
    if (city.factionId !== me) continue;
    const stufe = wallLevelInfo(level);
    if (!stufe) continue;
    eintraege.push({
      icon: stufe.icon,
      name: `${stufe.name} um ${city.name}`,
      note: `${repair ? 'wieder ausgebessert' : 'neu errichtet'} – `
        + `${Math.round((stufe.defence - 1) * 100)} % stärkere Verteidigung`,
      city,
    });
  }
  for (const { city, key, repair } of builtDone) {
    if (city.factionId !== me) continue;
    const def = buildingDef(key);
    if (!def) continue;
    eintraege.push({
      icon: def.icon,
      name: `${buildingName(key, me)} in ${city.name}`,
      // Das Bergwerk meldet, was es trägt; alle anderen, wozu sie da sind.
      note: (repair ? 'aus den Trümmern wieder aufgebaut – ' : '')
        + (key === 'mine' ? `${mineIncomeOf(state, city)} Gold je Runde` : def.purpose),
      city,
    });
  }
  for (const project of roadsDone) {
    if (project.factionId !== me) continue;
    const stein = (project.level || 1) >= ROAD_STONE;
    eintraege.push({
      icon: stein ? '🧱' : '🛣️',
      name: `${stein ? 'Steinstraße' : 'Straße'} ${project.fromName} – ${project.toName}`,
      note: stein ? 'ein Feld je Bewegungspunkt – so schnell marschiert kein Heer sonst'
        : 'gepflasterter Weg: schneller marschieren, mehr Handel',
    });
  }
  return eintraege;
}

function collectBuildNews(wallsDone, roadsDone, builtDone) {
  const eintraege = bauEintraege(wallsDone, roadsDone, builtDone);
  if (!eintraege.length) return;
  // Ein einzelnes Werk bekommt seinen eigenen Satz; mehrere stehen
  // untereinander, statt fünf Fenster nacheinander aufzuziehen.
  if (eintraege.length === 1) {
    const e = eintraege[0];
    diploNewsQueue.push({
      icon: e.icon,
      sound: 'bau',
      kind: 'Das Bauamt meldet',
      title: `${e.name} ist fertig`,
      text: 'Die Gerüste sind gefallen, die Arbeiter abgezogen. Von dieser Runde '
        + 'an steht das Werk.',
      effect: e.note,
    });
    return;
  }
  diploNewsQueue.push({
    icon: '🏗️',
    sound: 'bau',
    kind: 'Das Bauamt meldet',
    title: `${zahlwort(eintraege.length).replace(/^./, (c) => c.toUpperCase())} `
      + 'Bauaufträge sind abgeschlossen',
    text: 'In dieser Runde sind fertig geworden:',
    list: eintraege.map(({ icon, name, note }) => ({ icon, name, note })),
    effect: 'Alles davon wirkt ab sofort.',
  });
}

// Was in dieser Runde auf dem Exerzierplatz fertig geworden ist. Eine Meldung
// für alles zusammen: wer in fünf Orten aushebt, will nicht fünf Fenster.
function collectTrainingNews(fertig) {
  const me = playerFaction(state).id;
  const meine = fertig.filter((f) => f.city.factionId === me);
  if (!meine.length) return;
  const mann = meine.reduce((sum, f) => sum + f.count, 0);
  diploNewsQueue.push({
    icon: '⚔️',
    sound: 'bau',
    kind: 'Der Exerzierplatz meldet',
    title: meine.length === 1
      ? `${meine[0].count} ${unitDefs(me)[meine[0].unit].name} sind ausgebildet`
      : `${mann.toLocaleString('de-DE')} Mann sind ausgebildet`,
    text: 'Die Ausbildung ist beendet, die Männer stehen bereit:',
    list: meine.map((f) => ({
      icon: '⚔️',
      name: `${f.count} ${unitDefs(me)[f.unit].name} in ${f.city.name}`,
      note: f.army ? `treten bei ${f.army.name} an` : 'stehen in der Wache',
    })),
    effect: 'Von dieser Runde an zählen sie mit.',
  });
}

function endTurn() {
  // Ending the turn mid-march would let the AI move while the player's army is
  // still visibly walking, and the resulting sync would teleport it.
  if (!state || state.gameOver || isAnimating()) return;
  hideBattlePreview();
  pushUndo();
  sfx.endTurn();
  // Identify new reports by the previous head, not by length: the list is
  // capped, so once it is full its length stops growing.
  const previousHead = state.battleReports.length ? state.battleReports[0].id : null;
  // Womit die Runde begann - daran wird nachher gemessen, was dir geschehen ist.
  const vorher = snapshotOwn();

  // Erst reden, dann marschieren: was die Herrscher in dieser Runde
  // beschließen, gilt für die Züge, die gleich folgen. Wessen Gesandter zu
  // lange gewartet hat, reist vorher ab.
  expireOffers(state);
  rulersTakeTurn(state);
  aiTakeAllTurns(state);
  // Wer inzwischen einem fremden Heer begegnet ist, kennt es jetzt.
  updateKnowledge(state, playerFaction(state).id);
  // Was die Herolde bringen, ehe die neue Runde beginnt.
  collectDiploNews();
  // Wer wen belagert, steht fest, sobald alle marschiert sind - und ehe
  // abgerechnet wird: eine belagerte Stadt zahlt keine Steuer.
  const belagert = updateSieges(state);
  applySiegeAttrition(state);
  // Wer im fremden Land zurückgeblieben ist und keinen Schritt mehr tun kann,
  // ohne den Krieg zu erklären, wird unter Geleit heimgeführt.
  const heimgeleitet = escortStrandedArmies(state);
  // Eroberungen der KI können Handelswege gekappt haben - das muss stehen,
  // bevor abgerechnet wird, sonst zahlt ein Weg, den es nicht mehr gibt.
  pruneTradeRoutes(state);
  collectIncome(state);
  // Erst die Abrechnung, dann das Schicksal: ein Ereignis greift in denselben
  // Schatz, den die Runde gerade gefüllt hat.
  const myEvent = rollEvents(state);
  // Die Menschen werden mehr, ehe die Wache aus ihnen nachgestellt wird - und
  // wer über seinen Rang hinausgewachsen ist, bekommt den nächsten, ehe die
  // Wache auf die neue Sollstärke rechnet.
  growPopulations(state);
  const orteGewachsen = growSettlements(state);
  regenerateGarrisons(state);
  const wallsDone = advanceWallConstruction(state);
  const roadsDone = advanceRoadConstruction(state);
  const builtDone = advanceConstruction(state);
  // Und der Exerzierplatz: was ausgebildet ist, tritt an. Nach den Bauten,
  // damit eine Kaserne, die in dieser Runde fertig wird, erst ab der nächsten
  // ausbildet.
  const ausgebildet = advanceTraining(state);
  // The season that just passed is what wore the armies down; the next one is
  // rolled once the turn has actually turned.
  applyWeather(state);
  checkVictory(state);
  state.turn += 1;
  advanceWeather(state);
  // Recovery is judged on the turn that just ended - an army that never spent
  // a movement point rested - so it runs before movement is replenished.
  recoverArmies(state);
  resetMovement(state);
  // A new season means new weather; the scene has to be asked again.
  setWeatherSource((col, row) => weatherAt(state, col, row));
  // Die Bilanz wird vor dem Neuzeichnen gezogen: die Goldanzeige liest ihr
  // „+172" daraus, und die käme sonst eine Runde zu spät.
  collectBalanceNews(vorher);
  refresh();

  // Alles, was die eigene Fraktion in dieser Runde betroffen hat, kommt der
  // Reihe nach ins Meldefenster - Schlachten, Orte, Heere. Die Herolde der
  // Diplomatie stehen schon in derselben Schlange.
  if (!state.gameOver) {
    const me = playerFaction(state).id;
    collectBuildNews(wallsDone, roadsDone, builtDone);
    collectTrainingNews(ausgebildet);
    // Eine Belagerung des eigenen Reichs ist eine Meldung wert: sie kostet ab
    // dieser Runde Steuer, Nachschub und Bauzeit.
    for (const city of belagert) {
      if (city.factionId !== me) continue;
      const info = siegeInfo(state, city);
      if (!info) continue;
      const feind = info.factions.map((id) => factionById(state, id).name).join(' und ');
      diploNewsQueue.push({
        icon: '⚔️', kind: 'Eine Belagerung',
        title: `${city.name} ist eingeschlossen`,
        text: `${feind} steht vor ${city.name}${info.sea && !info.land
          ? ' – mit Schiffen vor dem Hafen' : ''}: ${info.men.toLocaleString('de-DE')} Mann.`,
        effect: 'Keine Steuer, kein Nachschub für die Wache, kein Bau. '
          + `Nach ${info.bisHunger} weiteren Runden beginnt der Hunger.`,
      });
    }
    // Orte, die in dieser Runde in den nächsten Rang hineingewachsen sind.
    const meineGewachsen = orteGewachsen.filter((g) => g.city.factionId === me);
    if (meineGewachsen.length === 1) {
      const g = meineGewachsen[0];
      diploNewsQueue.push({
        icon: '🏛️', sound: 'bau', kind: 'Ein Ort wächst',
        title: `Aus ${g.vorher} wird ${g.jetzt}: ${g.city.name}`,
        text: `${g.city.name} zählt ${g.city.population.toLocaleString('de-DE')} `
          + `Einwohner und ist damit über ${g.vorher === 'Dorf' ? 'das Dorf' : 'die Stadt'} `
          + 'hinausgewachsen.',
        effect: 'Mit dem Rang wachsen die Einnahmen, die Wache, die der Ort halten '
          + 'kann, und die Zahl der Häuser auf der Karte.',
      });
    } else if (meineGewachsen.length > 1) {
      diploNewsQueue.push({
        icon: '🏛️', sound: 'bau', kind: 'Orte wachsen',
        title: `${zahlwort(meineGewachsen.length).replace(/^./, (c) => c.toUpperCase())} `
          + 'Orte sind über ihren Rang hinausgewachsen',
        text: 'In dieser Runde sind gewachsen:',
        list: meineGewachsen.map((g) => ({
          icon: '🏛️', name: g.city.name,
          note: `aus ${g.vorher} wird ${g.jetzt} · `
            + `${g.city.population.toLocaleString('de-DE')} Einwohner`,
        })),
        effect: 'Mit dem Rang wachsen Einnahmen, Wache und das Bild auf der Karte.',
      });
    }
    // Häfen, die in dieser Runde gesperrt worden sind.
    for (const city of state.cities) {
      if (city.factionId !== me || vorher.gesperrt.has(city.id)) continue;
      const flotten = blockadingFleets(state, city);
      if (!flotten.length) continue;
      const feind = [...new Set(flotten.map((f) => factionById(state, f.factionId).name))]
        .join(' und ');
      diploNewsQueue.push({
        icon: '⛔', kind: 'Der Hafen ist gesperrt',
        title: `Fremde Schiffe liegen vor ${city.name}`,
        text: `${feind} hält mit ${flotten.length === 1 ? 'einem Verband' : `${flotten.length} Verbänden`} `
          + `den Hafen von ${city.name} besetzt.`,
        effect: 'Solange sie dort liegen, läuft kein Schiff aus: keine Werft, keine '
          + 'Überfahrt, und die Seehandelswege dieses Hafens tragen nichts.',
      });
    }
    // Heere, die aus fremdem Land heimgeführt worden sind.
    for (const zug of heimgeleitet) {
      if (zug.army.factionId !== me) continue;
      diploNewsQueue.push({
        icon: '🚩', kind: 'Ein Heer ist heimgeführt',
        title: `${zug.army.name} steht wieder in ${zug.city.name}`,
        text: `Das Heer stand im Land von ${zug.wirtName} und wäre keinen Schritt `
          + 'mehr gekommen, ohne den Krieg zu erklären. Es hat Geleit bis zur Grenze '
          + 'bekommen.',
        effect: 'Der Marsch hat es erschöpft, und in dieser Runde zieht es nicht mehr.',
      });
    }
    collectOwnNews(vorher, previousHead);
    if (diploNewsQueue.length) showNextDiploNews();
    else if (myEvent) showEvent(myEvent);
  }

  // Die Fanfare am Rundenende ist entfallen: sie schlug auch an, wenn ein
  // fremdes Reich irgendwo eine Straße fertigstellte. Was den Spieler angeht,
  // meldet jetzt das Bauamt - mit seinem eigenen Klang.
  if (state.gameOver) {
    (state.gameOver.result === 'victory' ? sfx.victory : sfx.defeat)();
    // Der Feldzug ist entschieden - für die Merktafel im Startbild aufgeschrieben,
    // und der Spielstand ist es damit auch: es gibt nichts mehr fortzusetzen.
    merkeFeldzug(state.gameOver.result);
    clearSaveGame();
  } else {
    // Der Feldzug geht weiter - jede Runde ist ein Punkt, zu dem "Fortsetzen"
    // zurückkehren kann, nicht nur das bewusste Verlassen über das Menü.
    saveGame(state);
  }
}

let toastTimer = null;
function showToast(message, ms = 6000) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), ms);
}

// When the page is embedded cross-origin without an explicit fullscreen
// permission, the browser refuses outright: document.fullscreenEnabled is
// false and the request throws a permissions-policy error. Detect that up
// front rather than swallowing the rejection and leaving a dead button.
function fullscreenAllowed() {
  const root = document.documentElement;
  return !!document.fullscreenEnabled && !!(root.requestFullscreen || root.webkitRequestFullscreen);
}

// Fullscreen is the intended way to play, so the game asks for it at the
// start and treats losing it as something to put right - unless the player
// was the one who left.
let wantsFullscreen = true;
let restoreArmed = false;

function requestAppFullscreen({ explain = false } = {}) {
  if (!fullscreenAllowed()) {
    if (explain) {
      showToast('Vollbild ist in dieser eingebetteten Ansicht gesperrt. '
        + 'Öffne das Spiel in einem eigenen Browser-Tab oder als Desktop-App – dort geht es. '
        + 'Mit ⇥ blendest du die Seitenleiste aus und gewinnst hier Platz.', 9000);
    }
    return false;
  }
  if (document.fullscreenElement) return true;
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  Promise.resolve(request.call(root)).catch(() => {
    if (explain) showToast('Der Browser hat den Vollbildmodus abgelehnt.', 5000);
  });
  return true;
}

// A browser only grants fullscreen from inside a user gesture, so a swipe that
// drops out of it cannot be undone on the spot. The next touch or key press
// puts it back instead - which is the next thing the player does anyway.
//
// Gehört wird auf alles, was als Geste zählt: touchstart kommt auf dem Handy
// vor pointerdown, und manche Browser rechnen erst das Loslassen als
// Bestätigung. Wer den Vollbildmodus über den Knopf verlässt, hat entschieden -
// dann ist wantsFullscreen aus und hier passiert nichts.
const RESTORE_EVENTS = ['touchstart', 'pointerdown', 'pointerup', 'keydown'];

function armFullscreenRestore() {
  if (restoreArmed || !fullscreenAllowed()) return;
  restoreArmed = true;
  const restore = () => {
    for (const type of RESTORE_EVENTS) window.removeEventListener(type, restore, true);
    restoreArmed = false;
    if (wantsFullscreen && !document.fullscreenElement) requestAppFullscreen();
  };
  for (const type of RESTORE_EVENTS) window.addEventListener(type, restore, true);
}

// Ein Wisch nach unten soll die Karte bewegen und nicht die Seite. Alles, was
// nicht in einer scrollbaren Leiste beginnt, wird deshalb hier abgefangen -
// sonst zieht die Geste am Browserfenster, und das wirft das Spiel aus dem
// Vollbild. Was der Browser selbst vom Bildschirmrand aus abfängt, kann eine
// Seite nicht verhindern; dafür gibt es das Wiederherstellen oben.
const SCROLLABLE = '#sidebar, .report-box, #settingsBody, #tileInfo, .empire-box, .start-box, .memo-box, #startScreen, #factionScreen';

function blockPageGestures() {
  document.addEventListener('touchmove', (event) => {
    if (event.touches.length > 1) return;
    const target = event.target;
    if (target && target.closest && target.closest(SCROLLABLE)) return;
    if (event.cancelable) event.preventDefault();
  }, { passive: false });
}
blockPageGestures();

function setupFullscreenButton(button) {
  button.addEventListener('click', () => {
    if (document.fullscreenElement) {
      // Leaving by the button is a decision, and it sticks.
      wantsFullscreen = false;
      document.exitFullscreen();
    } else {
      wantsFullscreen = true;
      requestAppFullscreen({ explain: true });
    }
  });
  document.addEventListener('fullscreenchange', () => {
    button.classList.toggle('active', !!document.fullscreenElement);
    setTimeout(resizeScene, 60);
    if (!document.fullscreenElement && wantsFullscreen) armFullscreenRestore();
  });
  // Auch wer die Seite kurz verlässt, findet sie im Vollbild wieder vor.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && wantsFullscreen && !document.fullscreenElement) {
      armFullscreenRestore();
    }
  });
}

function reflectFullscreenAvailability() {
  const allowed = fullscreenAllowed();
  for (const id of ['fullscreenBtn', 'menuFullscreenBtn']) {
    const button = document.getElementById(id);
    if (!button) continue;
    button.classList.toggle('unavailable', !allowed);
    button.title = allowed
      ? 'Vollbildmodus'
      : 'Vollbild ist in dieser eingebetteten Ansicht gesperrt – in eigenem Tab öffnen';
  }
}

function setupDpad() {
  const STEP = 1.6;
  document.querySelectorAll('[data-pan]').forEach((btn) => {
    const [dc, dr] = btn.dataset.pan.split(',').map(Number);
    btn.addEventListener('click', () => {
      // Screen-relative: once the map is turned, "up" must still mean away
      // from the viewer rather than north on the tile grid.
      panCameraRelative(dc * STEP, dr * STEP);
      zeichneKarte();
    });
  });
  document.querySelectorAll('[data-zoom]').forEach((btn) => {
    const factor = Number(btn.dataset.zoom);
    btn.addEventListener('click', () => {
      zoomCamera(factor);
      zeichneKarte();
    });
  });
  document.querySelectorAll('[data-rotate]').forEach((btn) => {
    const amount = Number(btn.dataset.rotate);
    btn.addEventListener('click', () => {
      rotateCamera(amount);
      zeichneKarte();
    });
  });
  const resetBtn = document.getElementById('resetViewBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetCameraOrientation();
      focusOwnCapital();
      zeichneKarte();
    });
  }
}

// Without a WebGL context three.js throws while constructing the renderer.
// Say so plainly instead of leaving the player on a blank map - on desktop
// this is usually an outdated graphics driver or a VM without acceleration.
function showGraphicsError() {
  document.getElementById('startScreen').classList.remove('hidden');
  appEl.classList.add('hidden');
  const box = document.querySelector('.start-help');
  if (!box || box.querySelector('.start-error')) return;
  const note = document.createElement('p');
  note.className = 'start-error';
  note.textContent = 'Die 3D-Darstellung konnte nicht gestartet werden: Dieser Rechner '
    + 'stellt kein WebGL bereit. Bitte den Grafiktreiber aktualisieren oder die '
    + 'Hardwarebeschleunigung im Browser aktivieren.';
  box.prepend(note);
}

// --- Fraktionswahl -------------------------------------------------------
// Alle Fraktionen außer den Unabhängigen sind spielbar. Der Bildschirm zeigt
// zu jeder ihr eigenes Bild, ihre Startlage und ihre drei Einheiten - was man
// braucht, um die Wahl zu treffen, bevor die Karte steht.

let chosenFaction = DEFAULT_PLAYER_FACTION;
let chosenScenario = DEFAULT_SCENARIO_ID;
let factionArtSlot = 0;

// --- Die Ausgangslage -----------------------------------------------------
// Über der Fraktionswahl: in welchem Jahr der Feldzug beginnt. Karte und
// Fraktionen bleiben dieselben, nur die Lage am ersten Tag ist eine andere.
function selectScenario(id) {
  chosenScenario = id;
  const szenario = scenarioById(id);
  document.querySelectorAll('.scenario-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.scenario === id);
    chip.setAttribute('aria-checked', chip.dataset.scenario === id ? 'true' : 'false');
  });
  const blurb = document.getElementById('scenarioBlurb');
  if (blurb) blurb.textContent = szenario.blurb;
}

function buildScenarioChoices() {
  const row = document.getElementById('scenarioRow');
  if (!row) return;
  row.innerHTML = SCENARIOS.map((s) => `<button class="scenario-chip" data-scenario="${s.id}"
    role="radio" aria-checked="false">
    <strong>${s.kurz}</strong><small>${s.name}</small>
  </button>`).join('');
  row.querySelectorAll('.scenario-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      sfx.select();
      selectScenario(chip.dataset.scenario);
    });
  });
}

function factionFacts(faction) {
  const own = CITY_DEFS.filter((c) => c.factionId === faction.id);
  const capital = own.find((c) => c.capital);
  const sizes = { large: 0, city: 0, village: 0 };
  for (const c of own) sizes[c.size || 'city'] += 1;
  const rosters = faction.startingArmies || [faction.startingArmy
    || { infantry: 300, cavalry: 120, ranged: 120 }];
  // Ein Starteintrag ist entweder die Truppenliste selbst oder ein Paar aus
  // Liste und Standort - Karthagos zweites Heer nennt seinen Ort. Ohne das
  // Auspacken zählte die Übersicht ein Objekt statt Männer.
  const men = rosters.reduce((sum, r) => sum + unitTotalCount(r.units || r), 0);
  return {
    capital: capital ? capital.name : '—',
    settlements: own.length,
    sizes,
    armies: rosters.length,
    men,
  };
}

function factionDetailHTML(faction) {
  const profile = factionProfile(faction.id) || {};
  // Wer diese Fraktion wählt, wählt diesen Mann: seine Eigenschaften stehen
  // hier, ehe der erste Zug fällt.
  const ruler = rulerFor(faction.id);
  const art = factionArt(faction.id);
  const facts = factionFacts(faction);
  const defs = unitDefs(faction.id);
  const tiers = [
    facts.sizes.large ? `${facts.sizes.large}× Große Stadt` : '',
    facts.sizes.city ? `${facts.sizes.city}× Stadt` : '',
    facts.sizes.village ? `${facts.sizes.village}× Dorf` : '',
  ].filter(Boolean).join(' · ');

  return `
    <h3><span class="fd-emblem">${emblemSVG(faction.id, { size: 44, color: faction.color })}</span>
      ${faction.name}<span class="fd-kind">${factionKind(faction).label}</span></h3>
    <p class="fd-motto">„${art.motto}"</p>
    <p class="fd-blurb">${profile.blurb || ''}</p>
    <div class="fd-ruler">
      <strong>${ruler.name}</strong>, ${ruler.titel}
      <div class="fd-traits">${TRAITS.map((t) =>
    `<span>${TRAIT_NAMES[t]} ${ruler[t]} · ${traitLabel(t, ruler[t])}</span>`).join('')}</div>
      <p class="fd-blurb">${ruler.wort}</p>
    </div>
    <div class="fd-facts">
      <div class="fd-fact"><span>Hauptstadt</span><strong>${facts.capital}</strong></div>
      <div class="fd-fact"><span>Siedlungen</span><strong>${facts.settlements}</strong></div>
      <div class="fd-fact"><span>Art</span><strong>${factionKind(faction).label}</strong></div>
      <div class="fd-fact"><span>Startheer</span><strong>${facts.men} Mann${
  facts.armies > 1 ? ` in ${facts.armies} Heeren` : ''}</strong></div>
      <div class="fd-fact"><span>Startgold</span><strong>${STARTING_GOLD}</strong></div>
    </div>
    <p class="fd-line"><b>Orte:</b> ${tiers}</p>
    <p class="fd-line"><b>${factionKind(faction).label}:</b> ${factionKind(faction).note}</p>
    <div class="fd-units">
      ${UNIT_ROLES.map((role) => `<div class="fd-unit">${defs[role].icon}
        <strong>${defs[role].name}</strong>
        <em>${ROLE_LABELS[role]} · ${defs[role].attack}/${defs[role].defense} · ${defs[role].cost} Gold</em>
      </div>`).join('')}
    </div>
    <p class="fd-line"><b>Stärke:</b> ${profile.strength || ''}</p>
    <p class="fd-line"><b>Schwäche:</b> ${profile.weakness || ''}</p>
    <p class="fd-line"><b>Schwierigkeit:</b> ${profile.difficulty || 'mittel'}</p>`;
}

// Das Bild wird übergeblendet statt ausgetauscht: zwei Ebenen, abwechselnd.
function paintFactionArt(factionId) {
  const stage = document.getElementById('factionArt');
  if (!stage) return;
  const layers = stage.querySelectorAll('.fa-layer');
  const next = layers[factionArtSlot % layers.length];
  const previous = layers[(factionArtSlot + 1) % layers.length];
  next.innerHTML = factionArtSVG(factionId);
  next.classList.add('visible');
  if (previous !== next) previous.classList.remove('visible');
  factionArtSlot += 1;
}

function selectFaction(factionId) {
  chosenFaction = factionId;
  const faction = playableFactions().find((f) => f.id === factionId);
  if (!faction) return;
  document.querySelectorAll('.faction-choice').forEach((button) => {
    button.classList.toggle('active', button.dataset.faction === factionId);
    button.setAttribute('aria-selected', button.dataset.faction === factionId ? 'true' : 'false');
  });
  document.getElementById('factionDetail').innerHTML = factionDetailHTML(faction);
  paintFactionArt(factionId);
  const startBtn = document.getElementById('factionStartBtn');
  if (startBtn) startBtn.textContent = `Als ${faction.name} beginnen ▶`;
}

function buildFactionChoices() {
  const list = document.getElementById('factionChoices');
  if (!list) return;
  list.innerHTML = playableFactions().map((faction) => {
    const profile = factionProfile(faction.id) || {};
    return `<button class="faction-choice" data-faction="${faction.id}" role="option"
      aria-selected="false" style="--dot:${faction.color}">
      <span class="fc-emblem">${emblemSVG(faction.id, { size: 26, color: faction.color })}</span>
      ${faction.name}
      <span class="fc-diff">${profile.difficulty || ''}</span>
    </button>`;
  }).join('');
  list.querySelectorAll('.faction-choice').forEach((button) => {
    button.addEventListener('click', () => {
      sfx.select();
      selectFaction(button.dataset.faction);
    });
  });
}

function showFactionScreen() {
  unlockAudio();
  // Der Klick auf "Neues Spiel" ist die Geste, die der Browser für Vollbild
  // verlangt - also hier schon danach fragen, nicht erst auf der Karte.
  wantsFullscreen = true;
  requestAppFullscreen({ explain: true });
  schliesseTafel();
  stopGlimpseCycle();
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('factionScreen').classList.remove('hidden');
  buildScenarioChoices();
  selectScenario(chosenScenario);
  buildFactionChoices();
  selectFaction(chosenFaction);
}

function hideFactionScreen() {
  document.getElementById('factionScreen').classList.add('hidden');
}

function backToMenu() {
  hideFactionScreen();
  document.getElementById('startScreen').classList.remove('hidden');
  startGlimpseCycle();
  focusStartButton();
}

// Der gemeinsame Teil zwischen einem neuen Feldzug und einem fortgesetzten:
// beide brauchen dieselbe Szene, denselben Eingang für die Karte, dieselbe
// Musik. Was sie trennt, ist nur der erste Blick - ins Zelt oder gleich auf
// die eigene Hauptstadt, so wie man sie verlassen hat.
function enterGame(resumed) {
  try {
    initScene(canvas);
    resizeScene();
    buildMap(state);
  } catch (err) {
    console.error('3D-Initialisierung fehlgeschlagen:', err);
    state = null;
    showGraphicsError();
    return;
  }

  if (getSetting('startMapMode') === 'tactical') setMapMode('tactical', state);
  refreshMapModeButton();
  // Auf dem Telefon fängt die Karte mit voller Breite an.
  if (window.innerWidth <= NARROW_SCREEN) setSidebarCollapsed(true);

  // The scene asks the game what the weather is wherever the camera looks, and
  // reports back so the topbar can name it.
  setWeatherReporter(paintWeatherLabel);
  setWeatherSource((col, row) => weatherAt(state, col, row));

  if (resumed) {
    // Wer fortsetzt, steht schon mitten im Feldzug: kein Zelt, keine
    // Ansprache - der Blick geht sofort dorthin, wo die Ansprache im Zelt
    // sonst erst hinführt. Das Zelt selbst wird nie gezeigt und verschwindet
    // deshalb sofort wieder - sonst stünde es für immer auf der Karte.
    resetCameraOrientation();
    focusOwnCapital();
    hideTent();
  } else {
    // Der Feldzug beginnt nicht auf der Karte, sondern im Zelt: erst der
    // Tisch mit der Karte darauf und der Thron dahinter, dann - wenn der
    // Spieler die Ansprache wegklickt - der Blick auf die eigene Hauptstadt.
    setOpeningView();
  }
  // Mit dem Zelt wechselt die Musik: die Titelmusik gehört zum Vorspann, von
  // hier an klingt die eigene Fraktion.
  stopTheme({ fadeOut: 2 });
  if (!isMuted() && getSetting('music')) {
    startAnthem(playerFaction(state).id, { fadeIn: 3.5 });
  }
  if (!resumed) showHerald();

  // Input holds no reference to `state` itself, so it reads through a getter -
  // undo swaps the object wholesale.
  setupInput(canvas, () => state, refresh, showBattleReport, pushUndo, showBattlePreview,
    showTileInfo, showBorderWarning, onBattleHud);
  document.getElementById('endTurnBtn').addEventListener('click', endTurn);
  undoBtn.addEventListener('click', undoLastAction);
  observeMapSize();
  refresh();
}

function startNewGame(factionId = chosenFaction) {
  unlockAudio();
  stopChronicle();
  // Starting a game is a click, which is the gesture fullscreen needs.
  wantsFullscreen = true;
  requestAppFullscreen({ explain: true });
  document.getElementById('startScreen').classList.add('hidden');
  hideFactionScreen();
  appEl.classList.remove('hidden');

  state = createInitialState(factionId, scenarioById(chosenScenario));
  enterGame(false);
}

function continueGame() {
  const saved = loadGame();
  if (!saved) {
    // Zwischen dem Anzeigen der Kachel und dem Klick kann der Spielstand
    // verschwunden sein - ein anderer Tab, ein geleerter Speicher. Dann bleibt
    // nur, die Kachel wieder verschwinden zu lassen.
    zeigeFortsetzenKachel();
    return;
  }
  unlockAudio();
  stopChronicle();
  stopGlimpseCycle();
  wantsFullscreen = true;
  requestAppFullscreen({ explain: true });
  document.getElementById('startScreen').classList.add('hidden');
  hideFactionScreen();
  appEl.classList.remove('hidden');

  state = saved;
  enterGame(true);
}

window.addEventListener('resize', () => {
  resizeScene();
  zeichneKarte();
});

setupFullscreenButton(document.getElementById('fullscreenBtn'));
setupFullscreenButton(document.getElementById('menuFullscreenBtn'));
reflectFullscreenAvailability();
setupSidebarToggle();
setupSidebarTabs();
setupTileInfo();
setupQuitButton();
setupMuteButton();
setupBorderButton();
setupMapModeButton();
setupFactionSort();
setupDpad();

document.getElementById('reportClose').addEventListener('click', hideBattleReport);
reportOverlay.addEventListener('click', (e) => {
  if (e.target === reportOverlay) hideBattleReport();
});

document.getElementById('previewAttack').addEventListener('click', confirmPendingAttack);
const previewSiegeBtn = document.getElementById('previewSiege');
if (previewSiegeBtn) {
  previewSiegeBtn.addEventListener('click', () => {
    const run = pendingSiege;
    hideBattlePreview();
    if (run) run();
  });
}
document.getElementById('previewCancel').addEventListener('click', hideBattlePreview);
document.getElementById('previewClose').addEventListener('click', hideBattlePreview);
previewOverlay.addEventListener('click', (e) => {
  if (e.target === previewOverlay) hideBattlePreview();
});

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // Escape backs out of the decision without attacking. With nothing open it
  // is the browser's own way out of fullscreen, and that is a decision too.
  if (heraldOverlay && !heraldOverlay.classList.contains('hidden')) hideHerald();
  else if (eventOverlay && !eventOverlay.classList.contains('hidden')) hideEvent();
  else if (diploNewsOverlay && !diploNewsOverlay.classList.contains('hidden')) hideDiploNews();
  else if (empireOverlay && !empireOverlay.classList.contains('hidden')) hideEmpire();
  // Das Diplomatiefenster fehlte hier: es ließ sich nur über sein ✕ schließen,
  // und solange es offen stand, ging kein Tastenkürzel mehr.
  else if (diploOverlay && !diploOverlay.classList.contains('hidden')) hideDiplomacy();
  else if (!settingsOverlay.classList.contains('hidden')) hideSettings();
  else if (borderOverlay && !borderOverlay.classList.contains('hidden')) hideBorderWarning();
  else if (!previewOverlay.classList.contains('hidden')) hideBattlePreview();
  else if (!reportOverlay.classList.contains('hidden')) hideBattleReport();
  else if (!document.getElementById('quitOverlay').classList.contains('hidden')) {
    hideQuitDialog();
  }
  else if (document.fullscreenElement) wantsFullscreen = false;
});

// --- Tastenkürzel ----------------------------------------------------------
// Wer einen Feldzug führt, klickt sonst jede Runde dieselben vier Knöpfe. Die
// Zifferntasten öffnen die Fenster, die Leertaste beendet die Runde. Q/E
// drehen die Karte und WASD schiebt sie - das macht input.js, deshalb bleiben
// diese Buchstaben hier unberührt.
const SHORTCUT_BUTTONS = {
  1: 'empireBtn',
  2: 'diploBtn',
  3: 'mapModeBtn',
  4: 'borderBtn',
  5: 'settingsBtn',
  u: 'undoBtn',
  m: 'muteBtn',
};

// Steht ein Fenster offen, gehört die Tastatur ihm.
const OVERLAY_IDS = [
  'heraldOverlay', 'eventOverlay', 'empireOverlay', 'diploOverlay',
  'diploNewsOverlay', 'settingsOverlay', 'battlePreview', 'battleReport',
  'borderWarn', 'quitOverlay', 'gameOverOverlay',
];

function anyOverlayOpen() {
  return OVERLAY_IDS.some((id) => {
    const el = document.getElementById(id);
    return el && !el.classList.contains('hidden');
  });
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  // Nur auf der Karte, und nur wenn nichts darüber liegt.
  if (appEl.classList.contains('hidden') || anyOverlayOpen()) return;

  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    endTurn();
    return;
  }
  const id = SHORTCUT_BUTTONS[e.key.toLowerCase()];
  if (!id) return;
  const button = document.getElementById(id);
  if (!button || button.disabled) return;
  e.preventDefault();
  button.click();
});

document.getElementById('settingsClose').addEventListener('click', hideSettings);
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) hideSettings();
});
for (const id of ['settingsBtn', 'menuSettingsBtn']) {
  const button = document.getElementById(id);
  if (button) button.addEventListener('click', showSettings);
}

// --- Das Titelbild und die Tafel rechts -----------------------------------
// Der Startbildschirm ist ein Bild: der Feldherrnblick über eine Hafenstadt.
// Chronik, Andenken und Regeln stehen nicht mehr fest daneben, sondern treten
// von rechts hervor, wenn man sie aufschlägt - und verschwinden wieder.

const titleStage = document.getElementById('titleStage');
if (titleStage) titleStage.innerHTML = titleSceneSVG();

// Der Kranz über dem Titel und die sechs Zeichen auf den Menütafeln sind
// gezeichnetes SVG, kein Emoji mehr - siehe js/ornaments.js.
const tbWreath = document.getElementById('tbWreath');
if (tbWreath) tbWreath.innerHTML = wreathSVG();
document.querySelectorAll('.mp-icon[data-icon]').forEach((el) => {
  el.innerHTML = menuIconSVG(el.dataset.icon);
});

let offeneTafel = null;

function schliesseTafel() {
  const sheet = document.getElementById('titleSheet');
  if (sheet) sheet.classList.add('hidden');
  document.querySelectorAll('.menu-plaque[data-sheet], .tf-chip[data-sheet]')
    .forEach((btn) => btn.classList.remove('active'));
  document.querySelectorAll('#titleSheet .sheet-part')
    .forEach((part) => { part.hidden = true; });
  // Die Chronik zeichnet nur, solange sie zu sehen ist.
  if (offeneTafel === 'chronik') stopChronicle();
  offeneTafel = null;
  // Der Blick in die Chronik steht sonst genau dort, wo die Tafel jetzt
  // wieder Platz braucht.
  zeigeGlimpse();
}

function oeffneTafel(name, startIndex) {
  if (offeneTafel === name) { schliesseTafel(); sfx.select(); return; }
  schliesseTafel();
  const sheet = document.getElementById('titleSheet');
  const teil = document.querySelector(`#titleSheet .sheet-part[data-part="${name}"]`);
  if (!sheet || !teil) return;
  sheet.classList.remove('hidden');
  teil.hidden = false;
  document.querySelectorAll(`.menu-plaque[data-sheet="${name}"], .tf-chip[data-sheet="${name}"]`)
    .forEach((btn) => btn.classList.add('active'));
  offeneTafel = name;
  // Die Chronik läuft erst, wenn sie aufgeschlagen ist - und dann von vorn.
  if (name === 'chronik') startChronicle(startIndex);
  if (name === 'memo') zeigeMerktafel();
  // Der Blick in die Chronik stünde jetzt unter der Tafel selbst.
  hideGlimpse();
  sfx.select();
}

document.querySelectorAll('.menu-plaque[data-sheet], .tf-chip[data-sheet]').forEach((btn) => {
  btn.addEventListener('click', () => oeffneTafel(btn.dataset.sheet));
});
const sheetClose = document.getElementById('sheetClose');
if (sheetClose) sheetClose.addEventListener('click', () => { schliesseTafel(); sfx.select(); });

// --- Tastatur im Hauptmenü -------------------------------------------------
// Die sechs Tafeln waren als <button> zwar mit Tab erreichbar, aber ohne
// Pfeiltasten - wer nur die Tastatur nutzt, musste sich mit Tab durch alle
// sechs hangeln, statt mit hoch/runter durch ein Menü zu gehen. Und Escape
// schloss die aufgeschlagene Tafel nur über das Kreuz, nicht über die Taste,
// die auf jedem anderen Fenster im Spiel genau das tut.
function focusStartButton() {
  // Steht "Fortsetzen" da, ist es die naheliegende Wahl und bekommt den
  // ersten Fokus - genau die Tafel, die dann auch als hervorgehoben dasteht.
  const continueBtn = document.getElementById('continueGameBtn');
  const btn = (continueBtn && !continueBtn.classList.contains('hidden'))
    ? continueBtn
    : document.getElementById('startGameBtn');
  if (btn) btn.focus({ preventScroll: true });
}

window.addEventListener('keydown', (e) => {
  const startScreen = document.getElementById('startScreen');
  if (!startScreen || startScreen.classList.contains('hidden')) return;
  if (e.key === 'Escape') {
    if (offeneTafel) { schliesseTafel(); sfx.select(); e.preventDefault(); }
    return;
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  // Verborgene Tafeln zählen nicht mit - "Fortsetzen" ist nicht immer da.
  const buttons = [...document.querySelectorAll('.title-menu .menu-plaque')]
    .filter((b) => !b.classList.contains('hidden'));
  if (!buttons.length) return;
  const idx = buttons.indexOf(document.activeElement);
  const richtung = e.key === 'ArrowDown' ? 1 : -1;
  const naechster = idx === -1
    ? (richtung > 0 ? 0 : buttons.length - 1)
    : (idx + richtung + buttons.length) % buttons.length;
  buttons[naechster].focus();
  e.preventDefault();
});

// Die Merktafel steht beim ersten Bild schon da, die Kachel "Fortsetzen" nur,
// wenn tatsächlich ein Feldzug wartet.
zeigeMerktafel();
zeigeFortsetzenKachel();
startGlimpseCycle();
focusStartButton();

const titleGlimpse = document.getElementById('titleGlimpse');
if (titleGlimpse) {
  titleGlimpse.addEventListener('click', () => {
    oeffneTafel('chronik', glimpseIndex);
  });
}

// Die Version steht im Startbildschirm - eine Wahrheit aus data.js, damit sie
// nicht zwischen Auslieferung und Anzeige auseinanderläuft.
const versionLabel = document.getElementById('versionLabel');
if (versionLabel) versionLabel.textContent = GAME_VERSION;

// Die Titelmusik soll mit dem Programm anfangen, nicht mit dem ersten Knopf.
// Versucht wird es deshalb sofort; erlaubt der Browser noch keinen Ton - und
// das tut er vor der ersten Geste nie -, holt die allererste Geste es nach,
// gleich welche: ein Klick irgendwohin, eine Taste, eine Berührung. Vorher
// hing der Anstoß an vier bestimmten Knöpfen, und wer stattdessen scrollte
// oder auf das Bild klickte, hörte den ganzen Vorspann über nichts.
function beginMenuMusic() {
  unlockAudio();
  startTheme();
}

const GESTURES = ['pointerdown', 'keydown', 'touchstart'];
function firstGesture() {
  for (const type of GESTURES) window.removeEventListener(type, firstGesture, true);
  beginMenuMusic();
}
for (const type of GESTURES) window.addEventListener(type, firstGesture, true);
beginMenuMusic();

// Für die Prüfläufe: ob der Ton erlaubt ist und ob die Musik wirklich spielt.
window.__audioProbe = audioProbe;
// Dasselbe für die Karte: läuft gerade ein Marsch, und wie sieht sie in diesem
// Augenblick aus? Nur für die Prüfläufe.
window.__mapProbe = () => ({ marching: isAnimating() });
window.__effectsDebug = effectsDebug;
window.__mapFrame = captureFrame;
// Damit ein Prüflauf die Kamera gezielt auf ein Feld setzen kann, statt sich
// dorthin zu ziehen.
window.__centerOn = centerOn;
window.__zoomCamera = zoomCamera;
window.__cameraState = cameraState;
window.__propsDebug = propsDebug;
window.__cityDebug = cityDebug;
window.__armyDebug = armyDebug;
// Und der Spielstand selbst: ein Prüflauf soll eine Armee auswählen können,
// ohne die richtige Stelle auf dem Bildschirm zu treffen.
window.__spqrState = () => state;
window.__spqrRefresh = () => refresh();

// Der Weg ins Spiel führt über die Fraktionswahl - "Fortsetzen" übergeht sie,
// die Fraktion steht ja schon fest.
document.getElementById('startGameBtn').addEventListener('click', showFactionScreen);
document.getElementById('factionBackBtn').addEventListener('click', backToMenu);
document.getElementById('factionStartBtn').addEventListener('click', () => startNewGame());
const continueGameBtn = document.getElementById('continueGameBtn');
if (continueGameBtn) continueGameBtn.addEventListener('click', continueGame);

// The boot watchdog in index.html looks for this: reaching it means the whole
// script parsed and the start button is wired.
window.__spqrReady = true;
