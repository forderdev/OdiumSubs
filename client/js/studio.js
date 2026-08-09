/*
  Odium Subs - ana akis.
  Kaynak sec -> yaziya dok -> obekleri duzelt -> timeline'a bas.

  Bu dosya CEP tarafinda; engine/ modullerini Node ile yukluyor.
  engine/ hicbir sekilde bu dosyaya bagimli degil (mimari karari 6) -
  bagimlilik tek yonlu: studio.js -> engine/
*/
window.OdiumStudio = (function () {
  "use strict";

  var nodeRequire = (typeof window.cep_node !== "undefined" && window.cep_node.require)
    ? window.cep_node.require
    : (typeof require === "function" ? require : null);

  var fs = nodeRequire ? nodeRequire("fs") : null;
  var path = nodeRequire ? nodeRequire("path") : null;
  var childProcess = nodeRequire ? nodeRequire("child_process") : null;

  var engine = { pipeline: null, chunker: null, srt: null };
  var root = "";

  var state = {
    selection: null,     // PP_getSelection extra'si
    cues: [],            // duzenlenebilir obekler
    words: [],           // ham whisper kelimeleri
    language: null,
    busy: false
  };

  var SETTINGS_KEY = "odium.subs.settings";

  function $(id) { return document.getElementById(id); }

  /* ---------------------------------------------------------------- */
  /* Yol / modul yukleme                                               */
  /* ---------------------------------------------------------------- */

  // CEP'in getSystemPath'i "file:\C:\..." donduruyor; temizle.
  function normalizePath(raw) {
    if (!raw) return "";
    var s = String(raw);
    s = s.replace(/^file:(\/\/)?/i, "");
    s = s.replace(/^[\\/]{1,3}(?=[A-Za-z]:)/, "");
    try { s = decodeURIComponent(s); } catch (e) {}
    return s.replace(/\//g, "\\");
  }

  function extensionRoot() {
    var fromCep = normalizePath(PremiereBridge.extensionPath());
    if (fromCep && fs && fs.existsSync(fromCep)) return fromCep;
    try {
      var here = normalizePath(window.location.pathname);
      var derived = path.resolve(path.dirname(here), "..", "..");
      if (fs.existsSync(derived)) return derived;
    } catch (e) {}
    return fromCep || "";
  }

  function loadEngine() {
    if (!nodeRequire) throw new Error("Node yok. manifest'te --enable-nodejs var mi?");
    root = extensionRoot();
    if (!root) throw new Error("Uzanti kok klasoru bulunamadi.");

    engine.pipeline = nodeRequire(path.join(root, "engine", "pipeline.js"));
    engine.chunker = nodeRequire(path.join(root, "engine", "chunker.js"));
    engine.srt = nodeRequire(path.join(root, "engine", "srt.js"));
  }

  /* ---------------------------------------------------------------- */
  /* UI yardimcilari                                                   */
  /* ---------------------------------------------------------------- */

  function log(text) {
    var el = $("log");
    if (!el) return;
    var stamp = new Date().toTimeString().substring(0, 8);
    el.textContent += "[" + stamp + "] " + text + "\n";
    el.scrollTop = el.scrollHeight;
  }

  function setPill(text, kind) {
    var el = $("pill");
    el.textContent = text;
    el.className = "pill" + (kind ? " " + kind : "");
  }

  function show(id, visible) {
    var el = $(id);
    if (!el) return;
    if (visible) el.classList.remove("hidden");
    else el.classList.add("hidden");
  }

  function setProgress(ratio, text) {
    show("progWrap", true);
    $("progBar").style.width = Math.round(Math.max(0, Math.min(1, ratio)) * 100) + "%";
    $("progText").textContent = text || "";
  }

  function timeLabel(seconds) {
    var s = Math.max(0, seconds);
    var m = Math.floor(s / 60);
    var rest = s - m * 60;
    return m + ":" + (rest < 10 ? "0" : "") + rest.toFixed(2);
  }

  /* ---------------------------------------------------------------- */
  /* Ayarlar                                                           */
  /* ---------------------------------------------------------------- */

  var SETTING_IDS = [
    "optMode", "optLanguage", "optModel", "optScope", "optStart", "optSeconds",
    "optPrompt", "optMaxWords", "optMaxDuration", "optMaxChars", "optPause",
    "optMinDuration", "optGapMerge"
  ];

  function saveSettings() {
    var data = {};
    for (var i = 0; i < SETTING_IDS.length; i++) {
      var el = $(SETTING_IDS[i]);
      if (el) data[SETTING_IDS[i]] = el.value;
    }
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch (e) {}
  }

  function loadSettings() {
    var data = null;
    try { data = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch (e) {}
    if (!data) return;
    for (var key in data) {
      if (!data.hasOwnProperty(key)) continue;
      var el = $(key);
      if (el) el.value = data[key];
    }
  }

  function chunkOptions() {
    return {
      mode: $("optMode").value,
      maxWords: Number($("optMaxWords").value),
      maxDuration: Number($("optMaxDuration").value),
      maxCharsPerLine: Number($("optMaxChars").value),
      pauseBreak: Number($("optPause").value),
      minDuration: Number($("optMinDuration").value),
      gapMerge: Number($("optGapMerge").value)
    };
  }

  /* ---------------------------------------------------------------- */
  /* 1. Kaynak                                                         */
  /* ---------------------------------------------------------------- */

  function readSelection() {
    return PremiereBridge.getSelection().then(function (res) {
      if (!res.ok) {
        setPill("secim yok", "err");
        log(res.message);
        state.selection = null;
        show("sourceBox", false);
        updateTranscribeButton();
        return;
      }

      var extra = res.extra;
      state.selection = extra;

      $("srcName").textContent = extra.item.name || "-";
      $("srcPath").textContent = extra.item.mediaPath || "<dosya yolu yok>";
      $("srcSeq").textContent = extra.sequence ? extra.sequence.name : "<sequence yok>";

      var occText = extra.occurrenceCount + " kullanim";
      if (extra.occurrenceCount === 0) {
        occText += " - klip timeline'da yok, sadece SRT uretilir";
      }
      $("srcOcc").textContent = occText;

      show("sourceBox", true);
      setPill(extra.source === "timeline" ? "timeline secimi" : "project secimi", "ok");
      log(res.message);

      if (!extra.item.mediaPath) {
        log("UYARI: bu item'in disk yolu yok (sequence ya da sentetik klip olabilir).");
      }

      updateTranscribeButton();
    });
  }

  function updateTranscribeButton() {
    var btn = $("btnTranscribe");
    var ready = !!(state.selection && state.selection.item && state.selection.item.mediaPath);
    btn.disabled = !ready || state.busy;
    btn.textContent = ready ? "Yaziya Dok" : "Once kaynak sec";
  }

  /* ---------------------------------------------------------------- */
  /* 3. Transkripsiyon                                                 */
  /* ---------------------------------------------------------------- */

  function transcribe() {
    if (!state.selection || state.busy) return;

    var mediaPath = state.selection.item.mediaPath;
    var scope = $("optScope").value;

    state.busy = true;
    updateTranscribeButton();
    setPill("calisiyor", "");
    setProgress(0, "hazirlaniyor");

    var workDir = path.join(root, ".probe", "work");
    var toolsDir = path.join(root, "tools");

    var phaseWeights = engine.pipeline.PHASES;
    var order = ["install", "extract", "transcribe", "chunk"];

    function overallRatio(phase, ratio) {
      var before = 0;
      for (var i = 0; i < order.length; i++) {
        if (order[i] === phase) break;
        before += phaseWeights[order[i]].weight;
      }
      return before + phaseWeights[phase].weight * ratio;
    }

    engine.pipeline.transcribeMedia({
      mediaPath: mediaPath,
      workDir: workDir,
      toolsDir: toolsDir,

      startSeconds: scope === "range" ? Number($("optStart").value) : undefined,
      durationSeconds: scope === "range" ? Number($("optSeconds").value) : undefined,

      model: $("optModel").value,
      language: $("optLanguage").value,
      initialPrompt: $("optPrompt").value,
      chunkOptions: chunkOptions(),

      onLog: function (line) {
        if (/^\s*\d{1,3}%/.test(line)) return;   // ilerleme cubugu satirlari log'u sismesin
        log(line);
      },
      onPhase: function (phase, ratio, message) {
        setProgress(overallRatio(phase, ratio), phaseWeights[phase].label + " " + Math.round(ratio * 100) + "%");
      }
    }).then(function (result) {
      state.words = result.words;
      state.cues = result.cues;
      state.language = result.language;
      state.busy = false;

      setProgress(1, "bitti");
      setPill(result.cues.length + " obek", "ok");
      log("Bitti: " + result.words.length + " kelime, " + result.cues.length + " obek, dil " + result.language);
      log("Sureler: ses " + result.timings.extract + " ms, whisper " + result.timings.transcribe + " ms");

      renderCues();
      show("editorCard", true);
      show("outputCard", true);
      updateTranscribeButton();
    }, function (err) {
      state.busy = false;
      setPill("hata", "err");
      setProgress(0, "");
      show("progWrap", false);
      log("HATA: " + err.message);
      updateTranscribeButton();
    });
  }

  /* ---------------------------------------------------------------- */
  /* 4. Obek editoru                                                   */
  /* ---------------------------------------------------------------- */

  function renderCues() {
    var list = $("cueList");
    list.innerHTML = "";
    $("cueCount").textContent = state.cues.length + " obek";

    for (var i = 0; i < state.cues.length; i++) {
      list.appendChild(cueRow(state.cues[i], i));
    }
  }

  function cueRow(cue, index) {
    var row = document.createElement("div");
    row.className = "cue";

    var head = document.createElement("div");
    head.className = "cue-head";

    var num = document.createElement("span");
    num.className = "cue-num";
    num.textContent = (index + 1);

    var time = document.createElement("span");
    time.className = "cue-time";
    time.textContent = timeLabel(cue.start) + " - " + timeLabel(cue.end)
      + "  (" + (cue.end - cue.start).toFixed(2) + " sn)";

    var actions = document.createElement("span");
    actions.className = "cue-actions";

    actions.appendChild(iconButton("bol", "Imlecin oldugu yerden bol", function () {
      splitCue(index, textArea.selectionStart);
    }));
    actions.appendChild(iconButton("birlestir", "Sonraki obekle birlestir", function () {
      mergeCue(index);
    }));
    actions.appendChild(iconButton("sil", "Bu obegi sil", function () {
      deleteCue(index);
    }));

    head.appendChild(num);
    head.appendChild(time);
    head.appendChild(actions);

    var textArea = document.createElement("textarea");
    textArea.className = "cue-text";
    textArea.rows = 1;
    textArea.value = cue.text;
    textArea.spellcheck = false;
    textArea.addEventListener("input", function () {
      cue.text = textArea.value;
      cue.lines = engine.chunker.wrapLines(cue.text,
        Number($("optMaxChars").value), Number($("optMode").value === "classic" ? 2 : 1));
      autoGrow(textArea);
    });

    row.appendChild(head);
    row.appendChild(textArea);
    setTimeout(function () { autoGrow(textArea); }, 0);
    return row;
  }

  function autoGrow(el) {
    el.style.height = "auto";
    el.style.height = (el.scrollHeight + 2) + "px";
  }

  function iconButton(label, title, onClick) {
    var b = document.createElement("button");
    b.className = "mini";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  /*
    Imlec konumundan boler. Kelime zamanlari elimizde oldugu icin bolme
    noktasi gercek zamana oturuyor - ortadan ikiye bolup tahmin etmiyoruz.
  */
  function splitCue(index, caret) {
    var cue = state.cues[index];
    if (!cue.words || cue.words.length < 2) {
      log("Bu obek tek kelime, bolunemez.");
      return;
    }

    // Imlecin hangi kelimeden sonra oldugunu bul.
    var cursor = 0;
    var splitAt = 1;
    for (var i = 0; i < cue.words.length; i++) {
      cursor += cue.words[i].word.length + (i > 0 ? 1 : 0);
      if (cursor >= caret) { splitAt = i + 1; break; }
      splitAt = i + 1;
    }
    if (splitAt <= 0) splitAt = 1;
    if (splitAt >= cue.words.length) splitAt = cue.words.length - 1;

    var left = cue.words.slice(0, splitAt);
    var right = cue.words.slice(splitAt);

    var a = makeCue(left);
    var b = makeCue(right);

    state.cues.splice(index, 1, a, b);
    reindex();
    renderCues();
    log("Obek " + (index + 1) + " bolundu.");
  }

  function mergeCue(index) {
    if (index >= state.cues.length - 1) {
      log("Son obek, birlestirilecek sonraki yok.");
      return;
    }
    var a = state.cues[index];
    var b = state.cues[index + 1];

    var merged = makeCue((a.words || []).concat(b.words || []));
    // Elle duzenlenmis metin varsa koru.
    merged.text = (a.text + " " + b.text).replace(/\s+/g, " ");
    merged.start = a.start;
    merged.end = b.end;
    merged.lines = engine.chunker.wrapLines(merged.text,
      Number($("optMaxChars").value), $("optMode").value === "classic" ? 2 : 1);

    state.cues.splice(index, 2, merged);
    reindex();
    renderCues();
    log("Obek " + (index + 1) + " ve " + (index + 2) + " birlestirildi.");
  }

  function deleteCue(index) {
    state.cues.splice(index, 1);
    reindex();
    renderCues();
    log("Obek " + (index + 1) + " silindi.");
  }

  function makeCue(words) {
    var text = [];
    for (var i = 0; i < words.length; i++) text.push(words[i].word);
    var joined = text.join(" ");
    return {
      index: 0,
      start: words.length ? words[0].start : 0,
      end: words.length ? words[words.length - 1].end : 0,
      text: joined,
      words: words,
      lines: engine.chunker.wrapLines(joined,
        Number($("optMaxChars").value), $("optMode").value === "classic" ? 2 : 1),
      breakReason: "manual"
    };
  }

  function reindex() {
    for (var i = 0; i < state.cues.length; i++) state.cues[i].index = i;
  }

  function replaceAll() {
    var find = $("findText").value;
    if (!find) { log("Aranacak metin bos."); return; }
    var replace = $("replaceText").value;

    var count = 0;
    for (var i = 0; i < state.cues.length; i++) {
      var cue = state.cues[i];
      if (cue.text.indexOf(find) < 0) continue;
      var parts = cue.text.split(find);
      count += parts.length - 1;
      cue.text = parts.join(replace);
      cue.lines = engine.chunker.wrapLines(cue.text,
        Number($("optMaxChars").value), $("optMode").value === "classic" ? 2 : 1);
    }

    renderCues();
    log(count + " yerde degistirildi.");
  }

  /* ---------------------------------------------------------------- */
  /* 5. Cikti                                                          */
  /* ---------------------------------------------------------------- */

  function srtOffset() {
    // Sequence 0'dan baslamiyorsa SRT'yi kaydirmazsak altyazilar hic gorunmez.
    if (state.selection && state.selection.sequence) {
      return Number(state.selection.sequence.zeroPointSeconds) || 0;
    }
    return 0;
  }

  /*
    Obekleri sequence zamanina cevirir. Klip timeline'da birden fazla yerde
    kullaniliyorsa hepsine dagitilir; klip disi obekler atilir (karar 5b).
  */
  function cuesForSequence() {
    var occ = state.selection ? state.selection.occurrences : [];
    if (!occ || !occ.length) return null;

    var all = [];
    for (var i = 0; i < occ.length; i++) {
      var mapped = engine.chunker.mapToSequence(state.cues, occ[i]);
      for (var m = 0; m < mapped.length; m++) all.push(mapped[m]);
    }
    all.sort(function (a, b) { return a.start - b.start; });
    for (var k = 0; k < all.length; k++) all[k].index = k;
    return all;
  }

  function buildSrt() {
    var mapped = cuesForSequence();
    if (mapped && mapped.length) {
      log("Sequence zamanina cevrildi: " + mapped.length + " obek ("
        + state.selection.occurrenceCount + " kullanim).");
      return engine.srt.toSrt(mapped, { offsetSeconds: srtOffset() });
    }
    log("Klip timeline'da bulunamadi - kaynak zamanlariyla SRT uretiliyor.");
    return engine.srt.toSrt(state.cues, { offsetSeconds: 0 });
  }

  function srtPath() {
    var base = "altyazi";
    if (state.selection && state.selection.item && state.selection.item.name) {
      base = String(state.selection.item.name).replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_");
    }
    var outDir = path.join(root, ".probe", "work");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    return path.join(outDir, base + ".srt");
  }

  /*
    reveal=true sadece kullanici "SRT Kaydet"e bastiginda. "Premiere'e Al"
    da ayni dosyayi yaziyor ama orada Explorer acmak Premiere'in onunu
    kapatiyor ve akisi bolduruyor.
  */
  function saveSrt(reveal) {
    try {
      var target = srtPath();
      fs.writeFileSync(target, buildSrt(), "utf8");
      log("SRT kaydedildi: " + target);
      if (reveal && childProcess) {
        childProcess.spawn("explorer.exe", ["/select,", target], { detached: true, stdio: "ignore" }).unref();
      }
      return target;
    } catch (e) {
      log("SRT yazilamadi: " + e.message);
      return null;
    }
  }

  function importSrt() {
    var target = saveSrt(false);
    if (!target) return;

    PremiereBridge.importCaptions({
      srtPath: target,
      logPath: path.join(root, ".probe", "import-captions.txt")
    }).then(function (res) {
      log((res.ok ? "" : "HATA: ") + res.message);
      if (res.ok && res.extra && !res.extra.trackCreated) {
        $("outputHint").textContent =
          "SRT projeye alindi ama caption track otomatik olusmadi. "
          + "Project panelinden timeline'a surukle. Ayrinti .probe/import-captions.txt icinde.";
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Baslat                                                            */
  /* ---------------------------------------------------------------- */

  function init() {
    try {
      loadEngine();
    } catch (e) {
      log("Engine yuklenemedi: " + e.message);
      setPill("engine yok", "err");
      return;
    }

    loadSettings();

    for (var i = 0; i < SETTING_IDS.length; i++) {
      var el = $(SETTING_IDS[i]);
      if (el) el.addEventListener("change", saveSettings);
    }

    $("optScope").addEventListener("change", function () {
      show("rangeRow", this.value === "range");
    });
    show("rangeRow", $("optScope").value === "range");

    $("optMode").addEventListener("change", function () {
      // Klasik modda karakter siniri ve kelime siniri farkli.
      if (this.value === "classic") {
        $("optMaxChars").value = 42;
        $("optMaxWords").value = 0;
        $("optMaxDuration").value = 6;
        $("optMinDuration").value = 1;
      } else {
        $("optMaxChars").value = 32;
        $("optMaxWords").value = 5;
        $("optMaxDuration").value = 2.5;
        $("optMinDuration").value = 0.6;
      }
      saveSettings();
    });

    $("btnRead").addEventListener("click", readSelection);
    $("btnTranscribe").addEventListener("click", transcribe);
    $("btnReplace").addEventListener("click", replaceAll);
    $("btnSaveSrt").addEventListener("click", function () { saveSrt(true); });
    $("btnImportSrt").addEventListener("click", importSrt);

    log("Odium Subs hazir. Kok: " + root);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return { state: state, renderCues: renderCues };
})();
