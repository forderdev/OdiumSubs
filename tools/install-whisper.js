/*
  Faster-Whisper-XXL'i indirip acar. Panel de ayni kodu kullaniyor
  (engine/installer.js); bu dosya sadece konsoldan tetiklemek icin.

      node tools\install-whisper.js
      node tools\install-whisper.js --force        (tekrar kur)
      node tools\install-whisper.js --keep-archive (1.4 GB arsivi silme)

  Kurulum yeri: <depo>/tools/faster-whisper-xxl/
  Modeller ayri: ilk transkripsiyonda whisper kendi indirir (~1.6 GB).
*/
"use strict";

var path = require("path");
var installer = require("../engine/installer.js");

var args = process.argv.slice(2);
var force = args.indexOf("--force") >= 0;
var keepArchive = args.indexOf("--keep-archive") >= 0;

var toolsDir = __dirname;
var lastLine = "";

function write(text) {
  // Ayni satiri gunceller - konsol ilerleme cubugu kaymasin.
  var pad = Math.max(0, lastLine.length - text.length);
  process.stdout.write("\r" + text + new Array(pad + 1).join(" "));
  lastLine = text;
}

function bar(ratio, width) {
  width = width || 28;
  var filled = Math.round(ratio * width);
  return "[" + new Array(filled + 1).join("#") + new Array(width - filled + 1).join(".") + "]";
}

console.log("Odium Subs - Faster-Whisper-XXL kurulumu");
console.log("Hedef: " + path.join(toolsDir, "faster-whisper-xxl"));
console.log("");

installer.ensureWhisper({
  toolsDir: toolsDir,
  force: force,
  keepArchive: keepArchive,

  onLog: function (message) {
    if (lastLine) { process.stdout.write("\n"); lastLine = ""; }
    console.log("  " + message);
  },

  onProgress: function (p) {
    if (p.phase === "download" && p.total) {
      write("  indiriliyor " + bar(p.ratio) + " " + Math.round(p.ratio * 100) + "%  "
        + installer.formatBytes(p.received) + " / " + installer.formatBytes(p.total));
    } else if (p.phase === "extract") {
      write("  aciliyor " + (p.ratio >= 1 ? "bitti" : "... (birkac dakika surebilir)"));
    }
  }
}).then(function (result) {
  if (lastLine) process.stdout.write("\n");
  console.log("");
  if (result.installed) {
    console.log("KURULDU: " + result.binaryPath);
  } else {
    console.log("ZATEN KURULU: " + result.binaryPath);
  }
  console.log("");
  console.log("Sonraki adim: panel bu exe'yi tools/ altinda kendisi buluyor.");
  process.exit(0);
}, function (err) {
  if (lastLine) process.stdout.write("\n");
  console.error("");
  console.error("HATA: " + err.message);
  console.error("");
  console.error("Elle kurmak istersen:");
  console.error("  1) " + installer.FALLBACK.url);
  console.error("  2) Arsivi ac, icindeki klasoru " + path.join(toolsDir, "faster-whisper-xxl") + " olacak sekilde koy");
  console.error("  3) " + path.join(toolsDir, "faster-whisper-xxl", "faster-whisper-xxl.exe") + " olusmali");
  process.exit(1);
});
