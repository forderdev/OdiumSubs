/*
  Odium Subs - local Faster-Whisper-XXL koşturucu (karar 2-3).
  Saf Node. CEP'e sifir bagimlilik.

  Ikiye ayrildi ki test edilebilsin:
    - parseWhisperJson / parseProgressLine : SAF fonksiyon, exe gerekmez
    - transcribe                           : exe'yi calistiran taraf

  NOT: Faster-Whisper-XXL'in bayrak isimleri surumden surume oynayabiliyor.
  Bu yuzden calistirilan komut ve stderr'in tamami log'a yaziliyor - ilk
  gercek calistirmada dogrulanacak (probe refleksinin aynisi).
*/
"use strict";

var fs = require("fs");
var path = require("path");
var childProcess = require("child_process");

var BINARY_NAMES = ["faster-whisper-xxl.exe", "whisper-faster-xxl.exe", "faster-whisper.exe"];

var DEFAULTS = {
  model: "large-v3-turbo",
  language: "tr",
  device: "auto",        // auto | cuda | cpu
  computeType: "",       // bos = surucuye birak
  vad: true,
  wordTimestamps: true,
  printProgress: true,   // ilerleme cubugu - panelde yuzde gostermek icin
  beepOff: true          // bitince bip calmasin
};

/* ------------------------------------------------------------------ */
/* Saf fonksiyonlar - test edilebilir                                   */
/* ------------------------------------------------------------------ */

/*
  Whisper JSON ciktisini normalize eder.
  Girdi bicimi (whisper uyumlu):
    { language, segments: [ { start, end, text, words: [ {word,start,end} ] } ] }

  Cikti: { language, words: [...], segments: [...], hasWordTimestamps }

  Kelimelerdeki bastaki bosluk (" merhaba") temizlenir - Whisper kelimeleri
  onlerindeki boslukla verir, obekleme sirasinda bu bosluk metni bozar.
*/
/* null / undefined / "" hepsi Number() ile 0'a duser - once bunlari ele. */
function isNumeric(value) {
  if (value === null || value === undefined || value === "") return false;
  return isFinite(Number(value));
}

function parseWhisperJson(raw) {
  var data = (typeof raw === "string") ? JSON.parse(raw) : raw;
  if (!data) throw new Error("Whisper ciktisi bos.");

  var segments = data.segments || [];
  var words = [];

  for (var s = 0; s < segments.length; s++) {
    var seg = segments[s];
    var segWords = seg.words || seg.word_timestamps || [];

    for (var w = 0; w < segWords.length; w++) {
      var item = segWords[w];
      var text = String(item.word === undefined ? item.text : item.word);
      text = text.replace(/^\s+|\s+$/g, "");
      if (!text) continue;

      // Number(null) === 0 oldugu icin once acikca eleniyor: JSON.stringify
      // NaN'i null'a cevirir, bozuk kelime aksi halde gecerli sayilirdi.
      if (!isNumeric(item.start)) continue;
      var start = Number(item.start);
      var end = isNumeric(item.end) ? Number(item.end) : start;
      if (end < start) end = start;

      words.push({
        word: text,
        start: start,
        end: end,
        confidence: (item.probability !== undefined) ? Number(item.probability) : null
      });
    }
  }

  var normalizedSegments = [];
  for (var i = 0; i < segments.length; i++) {
    normalizedSegments.push({
      start: Number(segments[i].start),
      end: Number(segments[i].end),
      text: String(segments[i].text === undefined ? "" : segments[i].text).replace(/^\s+|\s+$/g, "")
    });
  }

  return {
    language: data.language || null,
    words: words,
    segments: normalizedSegments,
    hasWordTimestamps: words.length > 0
  };
}

/*
  Whisper stdout/stderr satirindan ilerleme cikarir.
  Iki bicim destekleniyor:
    "  42%|####     | ..."                  -> dogrudan yuzde
    "[00:01:15.480 --> 00:01:18.200] metin" -> zaman / toplam sure
  Bilinmiyorsa null doner.
*/
function parseProgressLine(line, totalSeconds) {
  if (!line) return null;

  var pct = /(\d{1,3})%/.exec(line);
  if (pct) {
    var v = Number(pct[1]) / 100;
    if (v >= 0 && v <= 1) return v;
  }

  if (totalSeconds && totalSeconds > 0) {
    var ts = /\[(\d{2}):(\d{2})[:.](\d{2})(?:\.(\d+))?\s*-->/.exec(line);
    if (ts) {
      /*
        Bicim her zaman HH:MM:SS[.mmm]. Once milisaniye varsa HH:MM:SS,
        yoksa MM:SS sayiliyordu; damgasi milisaniyesiz gelen surumde ilerleme
        60 kat yanlis okunuyordu.
      */
      var seconds = Number(ts[1]) * 3600 + Number(ts[2]) * 60 + Number(ts[3]);
      if (ts[4] !== undefined) seconds += Number("0." + ts[4]);
      var ratio = seconds / totalSeconds;
      if (ratio >= 0 && ratio <= 1) return ratio;
    }
  }

  return null;
}

/* Whisper'in CLI argumanlarini kurar. Ayri fonksiyon = test edilebilir. */
function buildArgs(audioPath, outputDir, options) {
  var opt = {};
  for (var k in DEFAULTS) if (DEFAULTS.hasOwnProperty(k)) opt[k] = DEFAULTS[k];
  for (var o in options) if (options.hasOwnProperty(o) && options[o] !== undefined && options[o] !== null) opt[o] = options[o];

  var args = [audioPath];

  args.push("--model", String(opt.model));
  args.push("--output_dir", outputDir);
  args.push("--output_format", "json");

  // "auto" = Whisper kendi algilasin (karar 12: varsayilan tr, auto secenek)
  if (opt.language && String(opt.language).toLowerCase() !== "auto") {
    args.push("--language", String(opt.language));
  }

  if (opt.wordTimestamps) args.push("--word_timestamps", "True");
  if (opt.vad) args.push("--vad_filter", "True");

  // Degersiz bayraklar (store_true). --help ile dogrulandi.
  if (opt.printProgress !== false) args.push("--print_progress");
  if (opt.beepOff !== false) args.push("--beep_off");

  if (opt.device && opt.device !== "auto") args.push("--device", String(opt.device));
  if (opt.computeType) args.push("--compute_type", String(opt.computeType));

  // Ozel sozluk (karar 8): isimleri/terimleri modele onceden fisildar.
  if (opt.initialPrompt) args.push("--initial_prompt", String(opt.initialPrompt));

  if (opt.extraArgs && opt.extraArgs.length) {
    for (var e = 0; e < opt.extraArgs.length; e++) args.push(String(opt.extraArgs[e]));
  }

  return args;
}

/* ------------------------------------------------------------------ */
/* exe bulma                                                           */
/* ------------------------------------------------------------------ */

/*
  Sirayla arar: acikca verilen yol -> <toolsDir> altinda (bir seviye derin) -> PATH.
  Bulamazsa null. Indirme BILEREK burada degil: dogrulanmamis bir indirme
  adresini koda gommek istemiyorum. Panel exe yoksa kullaniciya nereye
  koyacagini soyleyecek, indirme adresi ayarlardan gelecek.
*/
function resolveBinary(options) {
  options = options || {};

  if (options.binaryPath && fs.existsSync(options.binaryPath)) return options.binaryPath;

  if (options.toolsDir && fs.existsSync(options.toolsDir)) {
    var found = findInTree(options.toolsDir, BINARY_NAMES, 2);
    if (found) return found;
  }

  var dirs = String(process.env.PATH || "").split(path.delimiter);
  for (var i = 0; i < dirs.length; i++) {
    if (!dirs[i]) continue;
    for (var n = 0; n < BINARY_NAMES.length; n++) {
      var candidate = path.join(dirs[i], BINARY_NAMES[n]);
      try { if (fs.existsSync(candidate)) return candidate; } catch (e) {}
    }
  }

  return null;
}

function findInTree(dir, names, depth) {
  var entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return null; }

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var full = path.join(dir, entry.name);
    if (entry.isFile()) {
      for (var n = 0; n < names.length; n++) {
        if (entry.name.toLowerCase() === names[n].toLowerCase()) return full;
      }
    }
  }

  if (depth > 0) {
    for (var d = 0; d < entries.length; d++) {
      if (!entries[d].isDirectory()) continue;
      var hit = findInTree(path.join(dir, entries[d].name), names, depth - 1);
      if (hit) return hit;
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Calistirma                                                          */
/* ------------------------------------------------------------------ */

/*
  transcribe({
    binaryPath | toolsDir,
    audioPath, outputDir,
    model, language, device, computeType, initialPrompt,
    totalSeconds,          // ilerleme yuzdesi icin
    onProgress, onLog
  })
  -> Promise<{ language, words, segments, jsonPath, command, durationMs }>
*/
function transcribe(options) {
  options = options || {};

  var binary = resolveBinary(options);
  if (!binary) {
    return Promise.reject(new Error(
      "Faster-Whisper-XXL bulunamadi. Beklenen isimler: " + BINARY_NAMES.join(", ")
      + ". tools/ klasorune koy ya da ayarlardan yolunu ver."
    ));
  }

  var audioPath = options.audioPath;
  if (!audioPath || !fs.existsSync(audioPath)) {
    return Promise.reject(new Error("Ses dosyasi bulunamadi: " + audioPath));
  }

  var outputDir = options.outputDir || path.dirname(audioPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  var args = buildArgs(audioPath, outputDir, options);
  var command = binary + " " + args.join(" ");
  if (options.onLog) options.onLog("KOMUT: " + command);

  var started = Date.now();

  return new Promise(function (resolve, reject) {
    var proc = childProcess.spawn(binary, args, { windowsHide: true });
    var tail = [];

    function handleStream(data) {
      var text = data.toString();
      var lines = text.split(/\r?\n|\r/);
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line || !line.replace(/\s/g, "")) continue;

        tail.push(line);
        if (tail.length > 40) tail.shift();
        if (options.onLog) options.onLog(line);

        if (options.onProgress) {
          var ratio = parseProgressLine(line, options.totalSeconds);
          if (ratio !== null) options.onProgress(ratio);
        }
      }
    }

    proc.stdout.on("data", handleStream);
    proc.stderr.on("data", handleStream);

    proc.on("error", function (err) {
      reject(new Error("Whisper calistirilamadi: " + err.message));
    });

    proc.on("close", function (code) {
      /*
        Cikis kodu tek basina karar veremiyor. Olculen davranis: r245.4 isini
        bitirip JSON'u yaziyor, sonra kapanirken 0xC0000409 (3221226505,
        stack buffer overrun) ile cokuyor - PyInstaller ile paketlenmis
        araclarda bilinen bir kapanis hatasi. Cikti gecerliyse basarili say,
        kodu sadece logla.
      */
      var jsonPath = expectedJsonPath(audioPath, outputDir, started);

      if (!jsonPath) {
        reject(new Error(
          (code === 0 ? "Whisper bitti ama JSON cikti bulunamadi." : "Whisper hata verdi (kod " + code + ").")
          + " Aranan klasor: " + outputDir + "\nSon satirlar:\n" + tail.slice(-8).join("\n")
        ));
        return;
      }

      var parsed;
      try {
        parsed = parseWhisperJson(fs.readFileSync(jsonPath, "utf8"));
      } catch (e) {
        reject(new Error("Whisper JSON'u okunamadi (" + jsonPath + "): " + e.message
          + (code !== 0 ? " (cikis kodu " + code + ")" : "")));
        return;
      }

      if (code !== 0 && options.onLog) {
        options.onLog("UYARI: whisper " + code + " koduyla kapandi ama cikti gecerli, devam ediliyor.");
      }

      if (!parsed.hasWordTimestamps) {
        reject(new Error("Kelime bazli zaman damgasi gelmedi. --word_timestamps bayragi bu surumde farkli olabilir."
          + " Son satirlar:\n" + tail.slice(-8).join("\n")));
        return;
      }

      if (options.onProgress) options.onProgress(1);

      parsed.jsonPath = jsonPath;
      parsed.command = command;
      parsed.durationMs = Date.now() - started;
      resolve(parsed);
    });
  });
}

/*
  Whisper ciktiyi <ses adi>.json olarak yazar ama surumler arasi ufak
  farklar olabiliyor; once beklenen adi, sonra klasordeki en yeni .json'u dener.

  notBefore (ms): bu andan ONCE yazilmis dosyalar kabul edilmez. Kritik -
  is klasorunde onceki bir klibin JSON'u duruyor olabilir. Whisper cikti
  yazmadan coktugunde eski dosya "gecerli sonuc" sanilip BASKA bir klibin
  altyazisi basilirdi. Dosya sistemi mtime'i saniyeye yuvarlayabildigi icin
  1 sn tolerans birakiliyor.
*/
function expectedJsonPath(audioPath, outputDir, notBefore) {
  var floor = notBefore ? (Number(notBefore) - 1000) : 0;

  function fresh(full) {
    if (!floor) return true;
    try { return fs.statSync(full).mtimeMs >= floor; } catch (e) { return false; }
  }

  var base = path.basename(audioPath).replace(/\.[^.]+$/, "");
  var direct = path.join(outputDir, base + ".json");
  if (fs.existsSync(direct) && fresh(direct)) return direct;

  var newest = null;
  var newestTime = 0;
  var entries;
  try { entries = fs.readdirSync(outputDir); } catch (e) { return null; }

  for (var i = 0; i < entries.length; i++) {
    if (!/\.json$/i.test(entries[i])) continue;
    var full = path.join(outputDir, entries[i]);
    var stat;
    try { stat = fs.statSync(full); } catch (e) { continue; }
    if (stat.mtimeMs < floor) continue;
    if (stat.mtimeMs > newestTime) {
      newestTime = stat.mtimeMs;
      newest = full;
    }
  }
  return newest;
}

module.exports = {
  DEFAULTS: DEFAULTS,
  BINARY_NAMES: BINARY_NAMES,
  parseWhisperJson: parseWhisperJson,
  parseProgressLine: parseProgressLine,
  buildArgs: buildArgs,
  expectedJsonPath: expectedJsonPath,
  resolveBinary: resolveBinary,
  transcribe: transcribe
};
