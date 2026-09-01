/*
  jsx/host.jsx'in SAF fonksiyonlarini node icinde calistirir.

  host.jsx ExtendScript; Premiere disinda calismaz. Ama occurrence yurutucusu
  (PP_walkOccurrences / PP_findOccurrences) duz matematik: klip zamanlari,
  nest donusumu, hiz orani. Bu matematik yanlis olursa altyazi yanlis yere
  basiliyor ve bunu ancak Premiere'de gozle gorurduk.

  Dosya yuklenirken hicbir sey CALISMIYOR (sadece fonksiyon tanimlari), bu
  yuzden vm baglaminda guvenle yuklenebiliyor. Premiere nesneleri (app,
  sequence, trackItem) testte sahte nesnelerle taklit ediliyor.
*/
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var HOST_PATH = path.join(__dirname, "..", "..", "jsx", "host.jsx");

var EXPORTED = [
  "PP_trackGroups",
  "PP_walkOccurrences",
  "PP_findOccurrences",
  "PP_sameMapping",
  "PP_dominantSourceInSequence",
  "PP_sequenceForItem",
  "PP_seconds",
  "PP_stringify",
  "PP_stringifyValue",
  "PP_parseJson",
  "PP_escapeJsonString"
];

/* Zaman nesnesi - Premiere'in Time'i .seconds tasiyor. */
function time(value) {
  return { seconds: value };
}

/* clips koleksiyonu: hem dizi gibi indekslenir hem numItems tasir. */
function clipList(clips) {
  var arr = clips.slice();
  arr.numItems = clips.length;
  return arr;
}

function trackList(tracks) {
  var arr = tracks.slice();
  arr.numTracks = tracks.length;
  return arr;
}

/*
  spec: { start, end, inPoint, item, speed, reversed, name }
  Zamanlar saniye. item = projectItem taklidi ({ nodeId, name, getMediaPath }).
*/
function clip(spec) {
  return {
    name: spec.name || "klip",
    start: time(spec.start),
    end: time(spec.end),
    inPoint: time(spec.inPoint === undefined ? 0 : spec.inPoint),
    projectItem: spec.item,
    getSpeed: function () { return spec.speed === undefined ? 1 : spec.speed; },
    isSpeedReversed: function () { return !!spec.reversed; }
  };
}

function mediaItem(nodeId, name) {
  return {
    nodeId: nodeId,
    name: name || nodeId,
    getMediaPath: function () { return "C:\\medya\\" + (name || nodeId) + ".mp4"; }
  };
}

/* video: [[clip,...], ...] her ic dizi bir track. audio ayni bicimde. */
function sequence(spec) {
  var video = (spec.video || []).map(function (clips) { return { clips: clipList(clips) }; });
  var audio = (spec.audio || []).map(function (clips) { return { clips: clipList(clips) }; });

  return {
    name: spec.name || "Sequence",
    projectItem: spec.item || null,
    videoTracks: trackList(video),
    audioTracks: trackList(audio)
  };
}

/*
  load(sequences) -> host.jsx'in saf fonksiyonlari.
  sequences: nest cozumlemesi icin projede duran sequence listesi.
*/
function load(sequences) {
  var list = (sequences || []).slice();
  list.numSequences = list.length;

  var sandbox = {
    app: { project: { sequences: list } }
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);

  var src = fs.readFileSync(HOST_PATH, "utf8");
  var tail = "\nthis.__odium = {";
  for (var i = 0; i < EXPORTED.length; i++) {
    tail += (i ? "," : "") + EXPORTED[i] + ":" + EXPORTED[i];
  }
  tail += "};\n";

  vm.runInContext(src + tail, sandbox, { filename: "host.jsx" });
  return sandbox.__odium;
}

/* PP_findOccurrences JSON parcalari donuyor; testte nesne daha kullanisli. */
function occurrences(host, seq, nodeId) {
  var parts = host.PP_findOccurrences(seq, nodeId);
  return JSON.parse("[" + parts.join(",") + "]");
}

module.exports = {
  load: load,
  occurrences: occurrences,
  sequence: sequence,
  clip: clip,
  mediaItem: mediaItem
};
