/*
  Odium Subs - M0 probe paneli.
  Tek isi: dort olcumu calistirmak ve loglari diske yazmak.
*/
(function () {
  "use strict";

  var nodeRequire = (typeof window.cep_node !== "undefined" && window.cep_node.require)
    ? window.cep_node.require
    : (typeof require === "function" ? require : null);

  var fs = nodeRequire ? nodeRequire("fs") : null;
  var path = nodeRequire ? nodeRequire("path") : null;
  var childProcess = nodeRequire ? nodeRequire("child_process") : null;

  var EG = "D:\\Adobe\\Adobe Premiere Pro 2026\\Essential Graphics\\";
  var DEFAULT_MOGRT = EG + "Captions and Subtitles\\Modern Web Caption.mogrt";

  /*
    Karsilastirma listesi:
      - aefx (AE'de yazilmis)  -> Essential Graphics parametresi tasimasi beklenir
      - ppro (Premiere'de)     -> duz grafik olarak aciliyor, parametre yok
    Boyut farki da hiz uzerindeki etkiyi gosterir.
  */
  var DEFAULT_TEMPLATES = [
    EG + "[AE] Sports Package\\Sports Lower Third Side.mogrt",   // aefx, 664 KB
    EG + "[AE] Sports Package\\Sports Graphic Overlay.mogrt",    // aefx, 286 KB
    EG + "Basic Title.mogrt",                                    // ppro, 380 KB
    EG + "Captions and Subtitles\\Modern Web Caption.mogrt"      // ppro, 725 KB
  ];

  var el = {};
  var logDir = "";

  function $(id) { return document.getElementById(id); }

  function log(text) {
    var stamp = new Date().toTimeString().substring(0, 8);
    el.log.textContent += "[" + stamp + "] " + text + "\n";
    el.log.scrollTop = el.log.scrollHeight;
  }

  function setPill(text, kind) {
    el.pill.textContent = text;
    el.pill.className = "status" + (kind ? " " + kind : "");
  }

  /*
    CEP'in getSystemPath'i Windows'ta "file:\C:\..." gibi URL kirintisi
    donduruyor; fs bunu tanimiyor. Temizle, tanimazsan panelin kendi
    konumundan turet.
  */
  function normalizePath(raw) {
    if (!raw) return "";
    var s = String(raw);
    s = s.replace(/^file:(\/\/)?/i, "");   // file:// veya file:
    s = s.replace(/^[\\/]{1,3}(?=[A-Za-z]:)/, ""); // /C:/ veya \C:\ onundeki ayiricilar
    try { s = decodeURIComponent(s); } catch (e) {}
    s = s.replace(/\//g, "\\");
    return s;
  }

  function extensionRoot() {
    var fromCep = normalizePath(PremiereBridge.extensionPath());
    if (fromCep && fs && fs.existsSync(fromCep)) return fromCep;

    // Yedek: bu dosya <root>/client/js/app.js icinde.
    try {
      var here = normalizePath(window.location.pathname);
      var root = path.resolve(path.dirname(here), "..", "..");
      if (fs.existsSync(root)) return root;
    } catch (e) {}

    return fromCep || "";
  }

  function ensureLogDir() {
    if (!fs || !path) return "";
    try {
      var base = extensionRoot();
      if (!base) {
        log("Uzanti kok klasoru bulunamadi.");
        return "";
      }
      var dir = path.join(base, ".probe");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch (e) {
      log("Log klasoru olusturulamadi: " + e.message);
      return "";
    }
  }

  function logPathFor(name) {
    if (!logDir || !path) return "";
    return path.join(logDir, name);
  }

  /* Butonu calisir/bitti/hata durumlarina sokar. */
  function runProbe(button, label, fn) {
    button.disabled = true;
    // Temel siniflari koru; sadece sonuc sinifini temizle.
    button.classList.remove("done", "fail");
    var t0 = Date.now();
    log("--- " + label + " basladi ---");

    fn().then(function (res) {
      var ms = Date.now() - t0;
      if (res && res.ok) {
        button.classList.add("done");
        log("OK (" + ms + " ms): " + res.message);
      } else {
        button.classList.add("fail");
        log("HATA (" + ms + " ms): " + ((res && res.message) || "bilinmeyen"));
      }
      if (res && res.extra) {
        log("  extra: " + JSON.stringify(res.extra));
      }
      button.disabled = false;
    }, function (err) {
      button.classList.add("fail");
      log("BEKLENMEYEN: " + err);
      button.disabled = false;
    });
  }

  function readLogTail(fileName, maxChars) {
    if (!fs) return;
    var p = logPathFor(fileName);
    if (!p || !fs.existsSync(p)) return;
    try {
      var content = fs.readFileSync(p, "utf8");
      var tail = content.length > maxChars ? content.substring(content.length - maxChars) : content;
      el.log.textContent += "\n===== " + fileName + " =====\n" + tail + "\n";
      el.log.scrollTop = el.log.scrollHeight;
    } catch (e) {
      log(fileName + " okunamadi: " + e.message);
    }
  }

  function init() {
    el.log = $("log");
    el.pill = $("pill");

    log("Panel yuklendi.");

    if (!nodeRequire) {
      log("UYARI: Node yok. manifest'te --enable-nodejs var mi kontrol et.");
    }

    logDir = ensureLogDir();
    $("logDirHint").textContent = logDir ? ("Loglar: " + logDir) : "Log klasoru yok (Node kapali).";

    var env = PremiereBridge.hostEnvironment();
    if (env && env.appName) {
      log("Host: " + env.appName + " " + env.appVersion + " (" + env.appLocale + ")");
    }

    $("mogrtPath").value = DEFAULT_MOGRT;

    $("btnPing").addEventListener("click", function () {
      runProbe(this, "Ping", function () {
        return PremiereBridge.ping().then(function (res) {
          if (res.ok) {
            setPill("bagli", "ok");
            if (res.extra) {
              log("  appName=" + res.extra.appName + " version=" + res.extra.version);
              log("  proje=" + res.extra.project);
            }
          } else {
            setPill("host yok", "err");
          }
          return res;
        });
      });
    });

    $("btnSelection").addEventListener("click", function () {
      var btn = this;
      runProbe(btn, "Secim probe", function () {
        return PremiereBridge.probeSelection({
          logPath: logPathFor("01-selection.txt")
        }).then(function (res) {
          readLogTail("01-selection.txt", 6000);
          return res;
        });
      });
    });

    $("btnMogrt").addEventListener("click", function () {
      var btn = this;
      runProbe(btn, "MOGRT parametre probe", function () {
        return PremiereBridge.probeMogrt({
          logPath: logPathFor("02-mogrt-params.txt"),
          mogrtPath: $("mogrtPath").value,
          videoTrackIndex: Number($("mogrtTrack").value),
          atSeconds: Number($("mogrtAt").value)
        }).then(function (res) {
          readLogTail("02-mogrt-params.txt", 8000);
          return res;
        });
      });
    });

    var speedBtn = $("btnSpeed");
    speedBtn.dataset.primary = "1";
    speedBtn.addEventListener("click", function () {
      var btn = this;
      var count = Number($("speedCount").value);
      runProbe(btn, "Hiz olcumu (" + count + " klip)", function () {
        return PremiereBridge.probeImportSpeed({
          logPath: logPathFor("03-import-speed.txt"),
          mogrtPath: $("mogrtPath").value,
          count: count,
          videoTrackIndex: Number($("speedTrack").value),
          gapSeconds: Number($("speedGap").value),
          startAtSeconds: 0
        }).then(function (res) {
          readLogTail("03-import-speed.txt", 4000);
          return res;
        });
      });
    });

    var fastBtn = $("btnFast");
    fastBtn.dataset.primary = "1";
    fastBtn.addEventListener("click", function () {
      var btn = this;
      var count = Number($("fastCount").value);
      runProbe(btn, "Hizli yol olcumu (" + count + " klip)", function () {
        return PremiereBridge.probeFastPlace({
          logPath: logPathFor("05-fast-place.txt"),
          mogrtPath: $("mogrtPath").value,
          count: count,
          videoTrackIndex: Number($("fastTrack").value),
          gapSeconds: Number($("fastGap").value),
          startAtSeconds: 0
        }).then(function (res) {
          readLogTail("05-fast-place.txt", 8000);
          return res;
        });
      });
    });

    $("tplPaths").value = DEFAULT_TEMPLATES.join("\n");

    var tplBtn = $("btnTemplates");
    tplBtn.dataset.primary = "1";
    tplBtn.addEventListener("click", function () {
      var btn = this;
      var lines = $("tplPaths").value.split(/\r?\n/);
      var paths = [];
      for (var i = 0; i < lines.length; i++) {
        var s = lines[i].replace(/^\s+|\s+$/g, "");
        if (s) paths.push(s);
      }
      runProbe(btn, "Sablon karsilastirma (" + paths.length + " sablon)", function () {
        return PremiereBridge.probeTemplates({
          logPath: logPathFor("06-templates.txt"),
          paths: paths,
          speedRuns: Number($("tplRuns").value),
          videoTrackIndex: Number($("tplTrack").value),
          startAtSeconds: 0,
          gapSeconds: 4
        }).then(function (res) {
          readLogTail("06-templates.txt", 10000);
          return res;
        });
      });
    });

    $("mechPath").value = DEFAULT_TEMPLATES[0];

    var mechBtn = $("btnMechanics");
    mechBtn.dataset.primary = "1";
    mechBtn.addEventListener("click", function () {
      var btn = this;
      runProbe(btn, "Klip mekanigi provasi", function () {
        return PremiereBridge.probeMechanics({
          logPath: logPathFor("07-mechanics.txt"),
          mogrtPath: $("mechPath").value,
          videoTrackIndex: Number($("mechTrack").value),
          atSeconds: 0,
          durationSeconds: Number($("mechDur").value),
          testText: "ODIUM ÇĞİÖŞÜ 123"
        }).then(function (res) {
          readLogTail("07-mechanics.txt", 12000);
          return res;
        });
      });
    });

    $("wrPath").value = DEFAULT_TEMPLATES[0];

    var wrBtn = $("btnTextWrite");
    wrBtn.dataset.primary = "1";
    wrBtn.addEventListener("click", function () {
      var btn = this;
      runProbe(btn, "Dogru yazma testi", function () {
        return PremiereBridge.probeTextWrite({
          logPath: logPathFor("08-text-write.txt"),
          mogrtPath: $("wrPath").value,
          videoTrackIndex: Number($("wrTrack").value),
          atSeconds: 0,
          testText: $("wrText").value,
          font: $("wrFont").value,
          fontSize: Number($("wrSize").value)
        }).then(function (res) {
          readLogTail("08-text-write.txt", 10000);
          return res;
        });
      });
    });

    $("btnQE").addEventListener("click", function () {
      var btn = this;
      runProbe(btn, "QE DOM probe", function () {
        return PremiereBridge.probeQE({
          logPath: logPathFor("04-qe-dom.txt"),
          trackName: $("qeTrackName").value
        }).then(function (res) {
          readLogTail("04-qe-dom.txt", 8000);
          return res;
        });
      });
    });

    $("btnOpenLogs").addEventListener("click", function () {
      if (!logDir || !childProcess) {
        log("Log klasoru acilamadi (Node yok).");
        return;
      }
      try {
        childProcess.spawn("explorer.exe", [logDir], { detached: true, stdio: "ignore" }).unref();
      } catch (e) {
        log("explorer acilamadi: " + e.message);
      }
    });

    $("btnClear").addEventListener("click", function () {
      el.log.textContent = "";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
