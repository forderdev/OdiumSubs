/*
  Odium Subs - uctan uca boru hatti.
  medya -> ses -> whisper -> obek -> SRT

  Saf Node. Premiere'e dokunmaz; sequence eslemesi (mapToSequence) cagiran
  tarafta, klip bilgisi elde olunca yapilir.

  Panel de, konsol da bu dosyayi cagirir - tek akis, tek hata yolu.
*/
"use strict";

var fs = require("fs");
var path = require("path");

var audio = require("./audio.js");
var whisper = require("./whisper.js");
var chunker = require("./chunker.js");
var srt = require("./srt.js");
var installer = require("./installer.js");

/*
  Asamalar ve kaba agirliklari. Panelde tek bir ilerleme cubugu gostermek
  icin; kurulum zaten yapilmissa o dilim atlanip kalanlar olceklenir.
*/
var PHASES = {
  install: { label: "Whisper kurulumu", weight: 0.30 },
  extract: { label: "Ses cikariliyor", weight: 0.10 },
  transcribe: { label: "Yaziya dokuluyor", weight: 0.58 },
  chunk: { label: "Obekleniyor", weight: 0.02 }
};

/*
  Zaman tasiyan kayitlari (kelime / segment) offset kadar kaydirir.
  Girdiyi bozmaz - yeni dizi doner. offset 0 ise ayni dizi geri verilir.
*/
function shiftTimes(items, offset) {
  if (!items || !items.length || !offset) return items || [];

  var out = [];
  for (var i = 0; i < items.length; i++) {
    var copy = {};
    for (var k in items[i]) if (items[i].hasOwnProperty(k)) copy[k] = items[i][k];
    if (typeof copy.start === "number") copy.start += offset;
    if (typeof copy.end === "number") copy.end += offset;
    out.push(copy);
  }
  return out;
}

function safeName(text) {
  return String(text).replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").substring(0, 60) || "media";
}

/*
  transcribeMedia({
    mediaPath,              // kaynak video/ses
    workDir,                // ara dosyalar (wav, whisper json)
    toolsDir,               // whisper exe burada aranir/kurulur

    startSeconds,           // opsiyonel - In/Out modu
    durationSeconds,

    model, language, device, computeType, initialPrompt,
    chunkOptions,           // chunker secenekleri (mode, maxWords, ...)
    srtPath,                // verilirse SRT diske yazilir
    srtOffsetSeconds,       // sequence zeroPoint

    autoInstall,            // varsayilan true
    onPhase(phase, ratio, message),
    onLog(line)
  })
  -> Promise<{ language, words, cues, srtText, srtPath, wavPath, jsonPath, timings }>
*/
function transcribeMedia(options) {
  options = options || {};

  var mediaPath = options.mediaPath;
  if (!mediaPath || !fs.existsSync(mediaPath)) {
    return Promise.reject(new Error("Kaynak medya bulunamadi: " + mediaPath));
  }

  var workDir = options.workDir || path.join(path.dirname(mediaPath), ".odium");
  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

  var log = options.onLog || function () {};
  var phase = options.onPhase || function () {};
  var timings = {};

  var base = safeName(path.basename(mediaPath).replace(/\.[^.]+$/, ""));
  var wavPath = path.join(workDir, base + ".16k.wav");

  var state = { binaryPath: null, ffmpegPath: null };

  /* --- 1. whisper hazir mi --- */
  function stepInstall() {
    var started = Date.now();
    var existing = whisper.resolveBinary({ toolsDir: options.toolsDir, binaryPath: options.whisperPath });

    if (existing) {
      state.binaryPath = existing;
      log("Whisper bulundu: " + existing);
      phase("install", 1, "hazir");
      timings.install = Date.now() - started;
      return Promise.resolve();
    }

    if (options.autoInstall === false) {
      return Promise.reject(new Error(
        "Faster-Whisper-XXL kurulu degil ve otomatik kurulum kapali."
      ));
    }

    log("Whisper kurulu degil, indiriliyor (tek seferlik ~1.4 GB).");
    return installer.ensureWhisper({
      toolsDir: options.toolsDir,
      onLog: log,
      onProgress: function (p) {
        // Indirme bu asamanin %90'i, acma kalan %10'u.
        var ratio = (p.phase === "download") ? p.ratio * 0.9
                  : (p.phase === "extract") ? 0.9 + p.ratio * 0.1
                  : 1;
        phase("install", ratio, p.phase === "download" ? "indiriliyor" : "aciliyor");
      }
    }).then(function (result) {
      state.binaryPath = result.binaryPath;
      timings.install = Date.now() - started;
    });
  }

  /* --- 2. ses cikar --- */
  function stepExtract() {
    var started = Date.now();

    state.ffmpegPath = audio.resolveFfmpeg({
      ffmpegPath: options.ffmpegPath,
      toolsDir: options.toolsDir
    });
    if (!state.ffmpegPath) {
      return Promise.reject(new Error("ffmpeg bulunamadi. tools/ klasorune koy ya da PATH'e ekle."));
    }
    log("ffmpeg: " + state.ffmpegPath);

    return audio.extractAudio({
      ffmpegPath: state.ffmpegPath,
      input: mediaPath,
      output: wavPath,
      startSeconds: options.startSeconds,
      durationSeconds: options.durationSeconds,
      onProgress: function (ratio) { phase("extract", ratio, "ses cikariliyor"); }
    }).then(function (result) {
      timings.extract = Date.now() - started;
      log("Ses hazir: " + wavPath + " (" + Math.round(result.bytes / 1024 / 1024) + " MB)");
      return result;
    });
  }

  /* --- 3. yaziya dok --- */
  function stepTranscribe(extractResult) {
    var started = Date.now();
    var total = (extractResult && extractResult.durationSeconds) || options.durationSeconds || null;

    log("Model: " + (options.model || whisper.DEFAULTS.model)
      + " | dil: " + (options.language || whisper.DEFAULTS.language));

    return whisper.transcribe({
      binaryPath: state.binaryPath,
      audioPath: wavPath,
      outputDir: workDir,
      model: options.model,
      language: options.language,
      device: options.device,
      computeType: options.computeType,
      initialPrompt: options.initialPrompt,
      totalSeconds: total,
      onLog: log,
      onProgress: function (ratio) { phase("transcribe", ratio, "yaziya dokuluyor"); }
    }).then(function (result) {
      timings.transcribe = Date.now() - started;
      log("Transkripsiyon bitti: " + result.words.length + " kelime, "
        + Math.round(result.durationMs / 1000) + " sn surdu.");
      return result;
    });
  }

  /* --- 4. obekle + SRT --- */
  function stepChunk(transcription) {
    var started = Date.now();
    phase("chunk", 0, "obekleniyor");

    /*
      In/Out modunda ses startSeconds'tan itibaren cikariliyor, yani whisper'in
      verdigi zamanlar 0'dan degil kirpma noktasindan basliyor. Kaynak medya
      zamanina geri tasimazsak hem SRT hem MOGRT tam startSeconds kadar kayiyor
      (mapToSequence klibin inPoint'ini kaynak zamaniyla karsilastiriyor).
    */
    var startOffset = Number(options.startSeconds) || 0;
    var words = shiftTimes(transcription.words, startOffset);
    var segments = shiftTimes(transcription.segments, startOffset);
    if (startOffset) log("Zamanlar kaynak medyaya tasindi: +" + startOffset + " sn");

    var cues = chunker.chunkWords(words, options.chunkOptions || {});

    // Kaynak zamanlari sakla: mapToSequence bunlara ihtiyac duyacak.
    var srtText = srt.toSrt(cues, { offsetSeconds: options.srtOffsetSeconds || 0 });

    var writtenPath = null;
    if (options.srtPath) {
      fs.writeFileSync(options.srtPath, srtText, "utf8");
      writtenPath = options.srtPath;
      log("SRT yazildi: " + writtenPath);
    }

    phase("chunk", 1, "bitti");
    timings.chunk = Date.now() - started;

    return {
      language: transcription.language,
      words: words,
      segments: segments,
      cues: cues,
      srtText: srtText,
      srtPath: writtenPath,
      wavPath: wavPath,
      jsonPath: transcription.jsonPath,
      command: transcription.command,
      timings: timings
    };
  }

  return stepInstall()
    .then(stepExtract)
    .then(stepTranscribe)
    .then(stepChunk);
}

/*
  Obekleri secili klibin timeline'daki her kullanimina dagitir.
  occurrences: [{ start, inPoint, outPoint, trackIndex }]  - host.jsx'ten gelir.
  Cikti: [{ occurrence, cues }]
*/
function distributeToOccurrences(cues, occurrences) {
  var out = [];
  for (var i = 0; i < (occurrences || []).length; i++) {
    var occ = occurrences[i];
    out.push({
      occurrence: occ,
      cues: chunker.mapToSequence(cues, occ)
    });
  }
  return out;
}

module.exports = {
  PHASES: PHASES,
  shiftTimes: shiftTimes,
  transcribeMedia: transcribeMedia,
  distributeToOccurrences: distributeToOccurrences
};
