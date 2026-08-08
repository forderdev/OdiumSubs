/*
  Odium Subs - kaynak medyadan Whisper'a uygun ses cikarir.
  Saf Node (child_process, fs, path). CEP'e sifir bagimlilik.

  Neden 16 kHz mono WAV: Whisper zaten icerde 16 kHz mono'ya cevirir.
  Bunu ffmpeg'e yaptirmak hem daha hizli hem dosya ~10 kat kucuk.
  40 dk video: 48kHz stereo ~460 MB, 16kHz mono ~77 MB.
*/
"use strict";

var fs = require("fs");
var path = require("path");
var childProcess = require("child_process");

var DEFAULT_SAMPLE_RATE = 16000;

/* ffmpeg -progress ciktisi "out_time_ms=12345678" satirlari verir. */
var OUT_TIME_RE = /out_time_ms=(\d+)/g;

/*
  ffmpeg'i sirayla arar:
    1) acikca verilen yol
    2) <toolsDir>/ffmpeg.exe   (installer buraya koyar)
    3) PATH
  Bulamazsa null doner - cagiran taraf kullaniciya anlamli hata verir.
*/
function resolveFfmpeg(options) {
  options = options || {};

  if (options.ffmpegPath && fs.existsSync(options.ffmpegPath)) {
    return options.ffmpegPath;
  }

  if (options.toolsDir) {
    var bundled = path.join(options.toolsDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    if (fs.existsSync(bundled)) return bundled;
  }

  var fromPath = whichSync(process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  return fromPath || null;
}

function whichSync(binName) {
  var dirs = String(process.env.PATH || "").split(path.delimiter);
  for (var i = 0; i < dirs.length; i++) {
    if (!dirs[i]) continue;
    var candidate = path.join(dirs[i], binName);
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (e) {}
  }
  return null;
}

/*
  Medyanin sure/ses bilgisini okur. ffprobe yoksa ffmpeg'in stderr'inden
  Duration satirini ayiklar - ffprobe'u zorunlu kilmamak icin.
*/
function probeDuration(ffmpegPath, inputPath) {
  return new Promise(function (resolve) {
    var proc = childProcess.spawn(ffmpegPath, ["-hide_banner", "-i", inputPath], { windowsHide: true });
    var stderr = "";

    proc.stderr.on("data", function (d) { stderr += d.toString(); });
    proc.on("error", function () { resolve(null); });
    proc.on("close", function () {
      var m = /Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d+)/.exec(stderr);
      if (!m) return resolve(null);
      var seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number("0." + m[4]);
      var hasAudio = /Stream #\d+:\d+.*: Audio:/.test(stderr);
      resolve({ duration: seconds, hasAudio: hasAudio });
    });
  });
}

/*
  extractAudio({
    ffmpegPath, input, output,
    startSeconds, durationSeconds,   // opsiyonel - In/Out modu icin
    sampleRate, onProgress
  })
  -> Promise<{ output, durationSeconds }>

  onProgress(ratio 0..1) cagrilir; toplam sure bilinmiyorsa cagrilmaz.
*/
function extractAudio(options) {
  options = options || {};

  var ffmpegPath = options.ffmpegPath;
  var input = options.input;
  var output = options.output;

  if (!ffmpegPath) return Promise.reject(new Error("ffmpeg bulunamadi."));
  if (!input || !fs.existsSync(input)) {
    return Promise.reject(new Error("Kaynak medya bulunamadi: " + input));
  }
  if (!output) return Promise.reject(new Error("Cikti yolu verilmedi."));

  var outDir = path.dirname(output);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  return probeDuration(ffmpegPath, input).then(function (info) {
    if (info && !info.hasAudio) {
      throw new Error("Bu medyada ses akisi yok: " + path.basename(input));
    }

    var total = null;
    if (options.durationSeconds) {
      total = Number(options.durationSeconds);
    } else if (info && info.duration) {
      total = info.duration - (Number(options.startSeconds) || 0);
    }

    var args = ["-hide_banner", "-loglevel", "error", "-y"];

    // -ss girdiden ONCE = hizli arama. Uzun dosyada fark buyuk.
    if (options.startSeconds) args.push("-ss", String(options.startSeconds));
    args.push("-i", input);
    if (options.durationSeconds) args.push("-t", String(options.durationSeconds));

    args.push(
      "-vn",                                                    // video yok
      "-ac", "1",                                               // mono
      "-ar", String(options.sampleRate || DEFAULT_SAMPLE_RATE), // 16 kHz
      "-c:a", "pcm_s16le",
      "-progress", "pipe:1",
      "-nostats",
      output
    );

    return runFfmpeg(ffmpegPath, args, total, options.onProgress).then(function () {
      if (!fs.existsSync(output)) {
        throw new Error("ffmpeg calisti ama cikti dosyasi olusmadi: " + output);
      }
      var size = fs.statSync(output).size;
      if (size < 1024) {
        throw new Error("Cikti sesi bos gorunuyor (" + size + " bayt). Kaynakta ses var mi?");
      }
      return { output: output, durationSeconds: total, bytes: size };
    });
  });
}

function runFfmpeg(ffmpegPath, args, totalSeconds, onProgress) {
  return new Promise(function (resolve, reject) {
    var proc = childProcess.spawn(ffmpegPath, args, { windowsHide: true });
    var stderr = "";

    proc.stdout.on("data", function (data) {
      if (!onProgress || !totalSeconds) return;
      var text = data.toString();
      var m, last = null;
      OUT_TIME_RE.lastIndex = 0;
      while ((m = OUT_TIME_RE.exec(text)) !== null) last = Number(m[1]);
      if (last !== null) {
        var ratio = (last / 1000000) / totalSeconds;
        onProgress(Math.max(0, Math.min(1, ratio)));
      }
    });

    proc.stderr.on("data", function (d) { stderr += d.toString(); });

    proc.on("error", function (err) {
      reject(new Error("ffmpeg calistirilamadi: " + err.message));
    });

    proc.on("close", function (code) {
      if (code === 0) {
        if (onProgress) onProgress(1);
        resolve();
      } else {
        var tail = stderr.split(/\r?\n/).filter(function (l) { return l.trim(); }).slice(-3).join(" | ");
        reject(new Error("ffmpeg hata verdi (kod " + code + "): " + (tail || "cikti yok")));
      }
    });
  });
}

module.exports = {
  DEFAULT_SAMPLE_RATE: DEFAULT_SAMPLE_RATE,
  resolveFfmpeg: resolveFfmpeg,
  probeDuration: probeDuration,
  extractAudio: extractAudio
};
