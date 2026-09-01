/*
  Odium Subs - Faster-Whisper-XXL'i ilk calistirmada indirir ve acar (karar 3).
  Saf Node. CEP'e sifir bagimlilik.

  Kaynak: github.com/Purfview/whisper-standalone-win
  Tag "Faster-Whisper-XXL" altindaki *_windows.7z varligi. ~1.36 GB.
  Modeller ayri: whisper ilk calistirmada large-v3-turbo'yu kendi indirir (~1.6 GB).

  Adres koda GOMULU DEGIL: once GitHub API'den en yuksek surumlu varlik secilir,
  API'ye ulasilamazsa bilinen son surume duser. Boylece yeni surum ciktiginda
  kod degistirmeye gerek kalmaz.

  Acma: 7-Zip her makinede yok. Sirayla denenen zincir:
    7z ailesi (7-Zip / winget / NanaZip / PeaZip / Bandizip / PATH) -> WinRAR
    -> Windows'un tar.exe'si -> son care 7zr.exe'yi resmi siteden indirmek.
  tar.exe en sona alindi: bsdtar bu arsivlerin BCJ2 filtresini cozemiyor ve
  "sadece 7-Zip kabul ediyor" gorunumu bundan cikiyordu.
*/
"use strict";

var fs = require("fs");
var path = require("path");
var https = require("https");
var childProcess = require("child_process");

var REPO = "Purfview/whisper-standalone-win";
var RELEASE_TAG = "Faster-Whisper-XXL";

/* API ulasilamazsa kullanilacak, elle dogrulanmis adres. */
var FALLBACK = {
  name: "Faster-Whisper-XXL_r245.4_windows.7z",
  url: "https://github.com/Purfview/whisper-standalone-win/releases/download/"
     + "Faster-Whisper-XXL/Faster-Whisper-XXL_r245.4_windows.7z",
  size: 1424309000
};

var BINARY_NAMES = ["faster-whisper-xxl.exe", "whisper-faster-xxl.exe"];

/* ------------------------------------------------------------------ */
/* Saf fonksiyonlar                                                     */
/* ------------------------------------------------------------------ */

/* "Faster-Whisper-XXL_r245.4_windows.7z" -> 245.4 ; eslesmezse 0 */
function assetVersion(name) {
  var m = /_r(\d+)(?:\.(\d+))?/.exec(String(name));
  if (!m) return 0;
  return Number(m[1]) + (m[2] ? Number(m[2]) / 1000 : 0);
}

/*
  Varlik listesinden Windows surumunun en yenisini secer.
  Linux/macOS varliklarini ve surumsuz dosyalari eler.
*/
function pickWindowsAsset(assets) {
  var best = null;
  for (var i = 0; i < (assets || []).length; i++) {
    var a = assets[i];
    var name = String(a.name || "");
    if (!/windows/i.test(name)) continue;
    if (!/\.(7z|zip)$/i.test(name)) continue;

    var version = assetVersion(name);
    if (!best || version > best.version) {
      best = {
        name: name,
        url: a.browser_download_url,
        size: Number(a.size) || 0,
        version: version
      };
    }
  }
  return best;
}

function formatBytes(bytes) {
  if (!bytes) return "? MB";
  return (bytes / 1024 / 1024).toFixed(0) + " MB";
}

/* ------------------------------------------------------------------ */
/* Ag                                                                   */
/* ------------------------------------------------------------------ */

function httpsJson(url) {
  return new Promise(function (resolve, reject) {
    var req = https.get(url, {
      headers: { "User-Agent": "odium-subs", "Accept": "application/vnd.github+json" },
      timeout: 20000
    }, function (res) {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error("GitHub API " + res.statusCode));
        return;
      }
      var body = "";
      res.setEncoding("utf8");
      res.on("data", function (d) { body += d; });
      res.on("end", function () {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on("timeout", function () { req.destroy(new Error("GitHub API zaman asimi")); });
    req.on("error", reject);
  });
}

/*
  Dosyayi indirir. GitHub yonlendirme yaptigi icin redirect takip ediliyor.
  .part uzantisiyla inip bitince adi degistirilir - yarim dosya asla
  "indirilmis" sayilmaz.
*/
function download(url, destPath, onProgress, redirectsLeft) {
  redirectsLeft = (redirectsLeft === undefined) ? 5 : redirectsLeft;

  return new Promise(function (resolve, reject) {
    if (redirectsLeft < 0) {
      reject(new Error("Cok fazla yonlendirme."));
      return;
    }

    var tempPath = destPath + ".part";
    var dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    var req = https.get(url, { headers: { "User-Agent": "odium-subs" }, timeout: 60000 }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(download(res.headers.location, destPath, onProgress, redirectsLeft - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error("Indirme basarisiz: HTTP " + res.statusCode));
        return;
      }

      var total = Number(res.headers["content-length"]) || 0;
      var received = 0;
      var lastTick = 0;

      var file = fs.createWriteStream(tempPath);

      res.on("data", function (chunk) {
        received += chunk.length;
        if (onProgress && total) {
          var now = Date.now();
          if (now - lastTick > 400) {   // saniyede ~2 guncelleme yeter
            lastTick = now;
            onProgress(received / total, received, total);
          }
        }
      });

      res.pipe(file);

      file.on("finish", function () {
        file.close(function () {
          if (total && received < total) {
            try { fs.unlinkSync(tempPath); } catch (e) {}
            reject(new Error("Indirme yarim kaldi (" + formatBytes(received) + " / " + formatBytes(total) + ")."));
            return;
          }
          try {
            if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
            fs.renameSync(tempPath, destPath);
          } catch (e) {
            reject(new Error("Indirilen dosya tasinamadi: " + e.message));
            return;
          }
          if (onProgress) onProgress(1, received, total);
          resolve({ path: destPath, bytes: received });
        });
      });

      file.on("error", function (err) {
        try { fs.unlinkSync(tempPath); } catch (e) {}
        reject(err);
      });
    });

    req.on("timeout", function () { req.destroy(new Error("Indirme zaman asimi.")); });
    req.on("error", function (err) {
      try { fs.unlinkSync(destPath + ".part"); } catch (e) {}
      reject(err);
    });
  });
}

/* ------------------------------------------------------------------ */
/* Acma                                                                 */
/* ------------------------------------------------------------------ */

var SEVEN_ZR = {
  url: "https://www.7-zip.org/a/7zr.exe",
  minBytes: 200 * 1024
};

function addIfFile(list, kind, filePath) {
  if (!filePath) return;
  try { if (fs.existsSync(filePath)) list.push({ kind: kind, path: filePath }); } catch (e) {}
}

/*
  Acici adaylari, tercih sirasiyla. tar.exe en sonda: Windows ile birlikte
  geliyor ama Faster-Whisper arsivlerinin filtresini cozemedigi icin cogu
  makinede kod 1 ile dusuyordu.
*/
function findExtractors(toolsDir) {
  var found = [];

  var bases = [
    process.env.ProgramFiles || "",
    process.env["ProgramFiles(x86)"] || "",
    process.env.ProgramW6432 || "",
    path.join(process.env.LOCALAPPDATA || "", "Programs")
  ];

  /* Daha once indirdiysek once onu kullan. */
  if (toolsDir) addIfFile(found, "7z", path.join(toolsDir, "7zr.exe"));

  for (var b = 0; b < bases.length; b++) {
    var base = bases[b];
    if (!base) continue;
    addIfFile(found, "7z", path.join(base, "7-Zip", "7z.exe"));
    addIfFile(found, "7z", path.join(base, "NanaZip", "NanaZipC.exe"));
    addIfFile(found, "7z", path.join(base, "NanaZip", "NanaZip.exe"));
    addIfFile(found, "7z", path.join(base, "PeaZip", "res", "bin", "7z", "7z.exe"));
    addIfFile(found, "7z", path.join(base, "PeaZip", "res", "7z", "7z.exe"));
    addIfFile(found, "bandizip", path.join(base, "Bandizip", "bz.exe"));
    addIfFile(found, "winrar", path.join(base, "WinRAR", "WinRAR.exe"));
  }

  /* winget ile kurulan 7-Zip buraya shim birakiyor. */
  addIfFile(found, "7z", path.join(process.env.LOCALAPPDATA || "",
    "Microsoft", "WinGet", "Links", "7z.exe"));

  /* PATH'te duran tasinabilir surumler. */
  var dirs = String(process.env.PATH || process.env.Path || "").split(";");
  var names = ["7z.exe", "7za.exe", "7zr.exe"];
  for (var d = 0; d < dirs.length; d++) {
    var dir = dirs[d].replace(/^"|"$/g, "").replace(/^\s+|\s+$/g, "");
    if (!dir) continue;
    for (var n = 0; n < names.length; n++) addIfFile(found, "7z", path.join(dir, names[n]));
  }

  addIfFile(found, "tar", path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"));

  /* Ayni exe birden fazla yoldan gelmis olabilir. */
  var seen = {};
  var unique = [];
  for (var u = 0; u < found.length; u++) {
    var key = found[u].path.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    unique.push(found[u]);
  }
  return unique;
}

/* Geriye donuk: tek arac bekleyen cagiranlar icin ilk aday. */
function findExtractor(toolsDir) {
  var all = findExtractors(toolsDir);
  return all.length ? all[0] : null;
}

function extractorArgs(kind, archivePath, destDir) {
  if (kind === "bandizip") return ["x", "-y", "-o:" + destDir, archivePath];
  if (kind === "winrar") return ["x", "-y", "-ibck", archivePath, destDir + path.sep];
  if (kind === "tar") return ["-xf", archivePath, "-C", destDir];
  return ["x", archivePath, "-o" + destDir, "-y"];
}

function runExtractor(tool, archivePath, destDir, onLog) {
  var args = extractorArgs(tool.kind, archivePath, destDir);
  if (onLog) onLog("Aciliyor (" + tool.kind + "): " + tool.path + " " + args.join(" "));

  return new Promise(function (resolve, reject) {
    var proc = childProcess.spawn(tool.path, args, { windowsHide: true });
    var tail = [];

    function collect(d) {
      var lines = d.toString().split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        if (!lines[i].replace(/\s/g, "")) continue;
        tail.push(lines[i]);
        if (tail.length > 20) tail.shift();
      }
    }

    proc.stdout.on("data", collect);
    proc.stderr.on("data", collect);

    proc.on("error", function (err) {
      reject(new Error("calistirilamadi: " + err.message));
    });

    proc.on("close", function (code) {
      if (code === 0) {
        resolve({ tool: tool.kind, path: tool.path });
      } else {
        reject(new Error("kod " + code + " " + tail.slice(-3).join(" | ")));
      }
    });
  });
}

/*
  Hicbir acici ise yaramazsa 7-Zip'in tek dosyalik konsol surumunu
  (7zr.exe, ~600 KB, resmi site) toolsDir'e indirir. Kurulum gerektirmiyor,
  yonetici izni istemiyor; 7z formatini tam cozuyor.
*/
function bootstrapSevenZr(toolsDir, onLog) {
  var target = path.join(toolsDir, "7zr.exe");

  if (fs.existsSync(target)) return Promise.resolve(target);
  if (onLog) onLog("Acici bulunamadi. 7zr.exe indiriliyor: " + SEVEN_ZR.url);

  return download(SEVEN_ZR.url, target).then(function () {
    var size = 0;
    try { size = fs.statSync(target).size; } catch (e) {}

    var head = "";
    try {
      var fd = fs.openSync(target, "r");
      var buf = Buffer.alloc(2);
      fs.readSync(fd, buf, 0, 2, 0);
      fs.closeSync(fd);
      head = buf.toString("latin1");
    } catch (e2) {}

    if (size < SEVEN_ZR.minBytes || head !== "MZ") {
      try { fs.unlinkSync(target); } catch (e3) {}
      throw new Error("indirilen 7zr.exe gecerli degil (" + size + " bayt).");
    }

    if (onLog) onLog("7zr.exe indi (" + formatBytes(size) + ").");
    return target;
  });
}

/*
  extractArchive(archivePath, destDir, onLog, options)
  options: { toolsDir, allowDownload }

  Adaylari sirayla dener; hepsi duserse 7zr.exe indirip son bir deneme yapar.
  allowDownload:false verilirse indirme atlanir (testler, cevrimdisi kurulum).
*/
function extractArchive(archivePath, destDir, onLog, options) {
  options = options || {};
  var log = onLog || function () {};
  var toolsDir = options.toolsDir || path.dirname(archivePath);

  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  var tools = findExtractors(toolsDir);
  var errors = [];

  function finalError() {
    return new Error(
      "Arsiv acilamadi.\n  "
      + (errors.length ? errors.join("\n  ") : "hicbir acici bulunamadi")
      + "\n7-Zip kur (7-zip.org) ya da arsivi elle ac: " + archivePath + " -> " + destDir
    );
  }

  function attempt(index) {
    if (index < tools.length) {
      return runExtractor(tools[index], archivePath, destDir, log).catch(function (err) {
        errors.push(tools[index].kind + " " + tools[index].path + ": " + err.message);
        log(tools[index].kind + " olmadi (" + err.message + "), sonraki arac deneniyor.");
        return attempt(index + 1);
      });
    }

    if (options.allowDownload === false) return Promise.reject(finalError());

    return bootstrapSevenZr(toolsDir, log).then(function (zrPath) {
      return runExtractor({ kind: "7z", path: zrPath }, archivePath, destDir, log);
    }).catch(function (err) {
      errors.push("7zr.exe: " + err.message);
      return Promise.reject(finalError());
    });
  }

  return attempt(0);
}

/* ------------------------------------------------------------------ */
/* Ana akis                                                             */
/* ------------------------------------------------------------------ */

function findBinary(dir, depth) {
  depth = (depth === undefined) ? 3 : depth;
  var entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return null; }

  for (var i = 0; i < entries.length; i++) {
    if (!entries[i].isFile()) continue;
    for (var n = 0; n < BINARY_NAMES.length; n++) {
      if (entries[i].name.toLowerCase() === BINARY_NAMES[n]) {
        return path.join(dir, entries[i].name);
      }
    }
  }

  if (depth > 0) {
    for (var d = 0; d < entries.length; d++) {
      if (!entries[d].isDirectory()) continue;
      var hit = findBinary(path.join(dir, entries[d].name), depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

function resolveAsset(onLog) {
  var url = "https://api.github.com/repos/" + REPO + "/releases/tags/" + RELEASE_TAG;
  return httpsJson(url).then(function (release) {
    var asset = pickWindowsAsset(release.assets);
    if (!asset) throw new Error("Windows varligi bulunamadi.");
    if (onLog) onLog("Surum secildi: " + asset.name + " (" + formatBytes(asset.size) + ")");
    return asset;
  }).catch(function (err) {
    if (onLog) onLog("GitHub API okunamadi (" + err.message + "), bilinen surume dusuluyor.");
    return FALLBACK;
  });
}

/*
  ensureWhisper({ toolsDir, onProgress, onLog, force })
  -> Promise<{ binaryPath, installed, asset }>

  installed=false : zaten kuruluymus, hicbir sey indirilmedi
  onProgress({ phase, ratio, received, total })
      phase: "download" | "extract" | "done"
*/
function ensureWhisper(options) {
  options = options || {};

  var toolsDir = options.toolsDir;
  if (!toolsDir) return Promise.reject(new Error("toolsDir verilmedi."));

  var installDir = path.join(toolsDir, "faster-whisper-xxl");
  var log = options.onLog || function () {};
  var progress = options.onProgress || function () {};

  if (!options.force) {
    var existing = findBinary(installDir);
    if (existing) {
      log("Zaten kurulu: " + existing);
      progress({ phase: "done", ratio: 1 });
      return Promise.resolve({ binaryPath: existing, installed: false, asset: null });
    }
  }

  if (!fs.existsSync(installDir)) fs.mkdirSync(installDir, { recursive: true });

  var chosen = null;

  return resolveAsset(log).then(function (asset) {
    chosen = asset;

    log("Indiriliyor: " + asset.name + " (" + formatBytes(asset.size) + ")");
    log("Bu tek seferlik. Modeller ayrica ilk transkripsiyonda inecek (~1.6 GB).");

    var archivePath = path.join(toolsDir, asset.name);

    if (fs.existsSync(archivePath) && asset.size && fs.statSync(archivePath).size === asset.size) {
      log("Arsiv zaten inmis, tekrar indirilmiyor.");
      progress({ phase: "download", ratio: 1, received: asset.size, total: asset.size });
      return archivePath;
    }

    return download(asset.url, archivePath, function (ratio, received, total) {
      progress({ phase: "download", ratio: ratio, received: received, total: total });
    }).then(function (result) {
      log("Indi: " + formatBytes(result.bytes));
      return result.path;
    });
  }).then(function (archivePath) {
    progress({ phase: "extract", ratio: 0 });
    return extractArchive(archivePath, installDir, log, {
      toolsDir: toolsDir,
      allowDownload: options.allowExtractorDownload !== false
    }).then(function (info) {
      progress({ phase: "extract", ratio: 1 });
      log("Acildi (" + info.tool + ").");
      return archivePath;
    });
  }).then(function (archivePath) {
    var binaryPath = findBinary(installDir);
    if (!binaryPath) {
      throw new Error(
        "Arsiv acildi ama calistirilabilir bulunamadi. Aranan: " + BINARY_NAMES.join(", ")
        + " | Klasor: " + installDir
      );
    }

    // Arsiv 1.4 GB - acildiktan sonra tutmanin anlami yok.
    if (options.keepArchive !== true) {
      try { fs.unlinkSync(archivePath); log("Arsiv silindi."); } catch (e) {}
    }

    log("Kuruldu: " + binaryPath);
    progress({ phase: "done", ratio: 1 });
    return { binaryPath: binaryPath, installed: true, asset: chosen };
  });
}

module.exports = {
  REPO: REPO,
  RELEASE_TAG: RELEASE_TAG,
  FALLBACK: FALLBACK,
  BINARY_NAMES: BINARY_NAMES,
  assetVersion: assetVersion,
  pickWindowsAsset: pickWindowsAsset,
  formatBytes: formatBytes,
  findBinary: findBinary,
  findExtractor: findExtractor,
  findExtractors: findExtractors,
  bootstrapSevenZr: bootstrapSevenZr,
  resolveAsset: resolveAsset,
  download: download,
  extractArchive: extractArchive,
  ensureWhisper: ensureWhisper
};
