/*
  Uctan uca duman testi. Premiere gerekmez.

      node tools\smoke-test.js "D:\yol\video.mp4"
      node tools\smoke-test.js "D:\yol\video.mp4" --model tiny --seconds 40
      node tools\smoke-test.js "video.mp4" --language auto --start 60

  Ne yapar: ses cikarir -> whisper -> obekler -> SRT yazar, sonuclari basar.
  Ilk calistirmada whisper modeli indirir (tiny ~75 MB, large-v3-turbo ~1.6 GB).
*/
"use strict";

var fs = require("fs");
var path = require("path");
var pipeline = require("../engine/pipeline.js");

var argv = process.argv.slice(2);
var mediaPath = argv[0];

if (!mediaPath || mediaPath.charAt(0) === "-") {
  console.error("Kullanim: node tools\\smoke-test.js <medya> [--model tiny] [--seconds 40] [--start 0] [--language tr]");
  process.exit(1);
}

function arg(name, fallback) {
  var i = argv.indexOf("--" + name);
  return (i >= 0 && argv[i + 1]) ? argv[i + 1] : fallback;
}

var toolsDir = __dirname;
var workDir = path.join(toolsDir, "..", ".probe", "smoke");
var seconds = Number(arg("seconds", 40));
var start = Number(arg("start", 0));

var lastPhase = "";

console.log("Odium Subs - duman testi");
console.log("  medya : " + mediaPath);
console.log("  kesit : " + start + " sn'den " + seconds + " sn");
console.log("  model : " + arg("model", "tiny"));
console.log("");

var started = Date.now();

pipeline.transcribeMedia({
  mediaPath: mediaPath,
  workDir: workDir,
  toolsDir: toolsDir,

  startSeconds: start || undefined,
  durationSeconds: seconds || undefined,

  model: arg("model", "tiny"),
  language: arg("language", "tr"),
  initialPrompt: arg("prompt", ""),

  chunkOptions: { mode: arg("mode", "chunk") },
  srtPath: path.join(workDir, "smoke.srt"),

  onLog: function (line) {
    // Whisper'in ilerleme cubugu satirlarini yutuyoruz, log sismesin.
    if (/^\s*\d{1,3}%/.test(line)) return;
    console.log("    " + line);
  },

  onPhase: function (phase, ratio) {
    if (phase !== lastPhase) {
      lastPhase = phase;
      console.log("  [" + pipeline.PHASES[phase].label + "]");
    }
    if (ratio >= 1) return;
    process.stdout.write("\r    %" + Math.round(ratio * 100) + "   ");
  }
}).then(function (result) {
  process.stdout.write("\r");
  console.log("");
  console.log("=========================================");
  console.log("  dil        : " + result.language);
  console.log("  kelime     : " + result.words.length);
  console.log("  obek       : " + result.cues.length);
  console.log("  wav        : " + result.wavPath);
  console.log("  whisper    : " + result.jsonPath);
  console.log("  srt        : " + result.srtPath);
  console.log("  sureler    : ses " + result.timings.extract + " ms | whisper " + result.timings.transcribe + " ms");
  console.log("=========================================");
  console.log("");

  var show = Math.min(12, result.cues.length);
  console.log("Ilk " + show + " obek:");
  for (var i = 0; i < show; i++) {
    var c = result.cues[i];
    console.log("  " + c.start.toFixed(2) + " - " + c.end.toFixed(2)
      + "  (" + (c.end - c.start).toFixed(2) + " sn, " + c.words.length + " kelime, " + c.breakReason + ")");
    console.log("      " + c.text);
  }

  if (result.cues.length) {
    var totalWords = 0, totalDur = 0;
    result.cues.forEach(function (c) { totalWords += c.words.length; totalDur += (c.end - c.start); });
    console.log("");
    console.log("Ortalama: " + (totalWords / result.cues.length).toFixed(1) + " kelime/obek, "
      + (totalDur / result.cues.length).toFixed(2) + " sn/obek");
  }

  console.log("");
  console.log("Toplam: " + Math.round((Date.now() - started) / 1000) + " sn");
  process.exit(0);
}, function (err) {
  process.stdout.write("\r");
  console.error("");
  console.error("HATA: " + err.message);
  process.exit(1);
});
