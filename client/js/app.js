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

  var DEFAULT_MOGRT = "D:\\Adobe\\Adobe Premiere Pro 2026\\Essential Graphics\\Captions and Subtitles\\Modern Web Caption.mogrt";

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
    el.pill.className = "pill" + (kind ? " " + kind : "");
  }

  function ensureLogDir() {
    if (!fs || !path) return "";
    try {
      var base = PremiereBridge.extensionPath();
      if (!base) return "";
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
    button.className = "btn" + (button.dataset.primary ? " primary" : "");
    var t0 = Date.now();
    log("--- " + label + " basladi ---");

    fn().then(function (res) {
      var ms = Date.now() - t0;
      if (res && res.ok) {
        button.className += " done";
        log("OK (" + ms + " ms): " + res.message);
      } else {
        button.className += " fail";
        log("HATA (" + ms + " ms): " + ((res && res.message) || "bilinmeyen"));
      }
      if (res && res.extra) {
        log("  extra: " + JSON.stringify(res.extra));
      }
      button.disabled = false;
    }, function (err) {
      button.className += " fail";
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
