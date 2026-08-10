/*
  Odium Subs - ana akis.
  Kaynak sec -> yaziya dok -> obekleri duzelt -> timeline'a bas.

  Bu dosya CEP tarafinda; engine/ modullerini Node ile yukluyor.
  Bagimlilik tek yonlu: studio.js -> engine/ (mimari karari 6).
*/
window.OdiumStudio = (function () {
  "use strict";

  var nodeRequire = (typeof window.cep_node !== "undefined" && window.cep_node.require)
    ? window.cep_node.require
    : (typeof require === "function" ? require : null);

  var fs = nodeRequire ? nodeRequire("fs") : null;
  var path = nodeRequire ? nodeRequire("path") : null;
  var childProcess = nodeRequire ? nodeRequire("child_process") : null;

  var engine = { pipeline: null, chunker: null, srt: null, fonts: null };
  var root = "";

  var state = {
    selection: null,
    cues: [],
    words: [],
    language: null,
    busy: false,
    style: "mogrt",     // "mogrt" | "caption"
    fontFamilies: []
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
    engine.fonts = nodeRequire(path.join(root, "engine", "fonts.js"));
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
    el.className = "status" + (kind ? " " + kind : "");
  }

  function show(id, visible) {
    var el = $(id);
    if (!el) return;
    if (visible) el.classList.remove("hidden");
    else el.classList.add("hidden");
  }

  function setProgress(wrapId, barId, textId, ratio, text) {
    show(wrapId, true);
    $(barId).style.width = Math.round(Math.max(0, Math.min(1, ratio)) * 100) + "%";
    $(textId).textContent = text || "";
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
    "optLanguage", "optModel", "optScope", "optStart", "optSeconds", "optPrompt",
    "optMaxWords", "optMaxDuration", "optMaxChars", "optPause", "optMinDuration", "optGapMerge",
    "mogrtTemplate", "fontFamily", "fontStyle", "mogrtFontSize", "mogrtPosition",
    "mogrtScale", "mogrtTrackName", "mogrtColor"
  ];

  function saveSettings() {
    var data = { style: state.style };
    for (var i = 0; i < SETTING_IDS.length; i++) {
      var el = $(SETTING_IDS[i]);
      if (el) data[SETTING_IDS[i]] = el.value;
    }
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch (e) {}
  }

  function loadSettings() {
    var data = null;
    try { data = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch (e) {}
    if (!data) return null;

    for (var key in data) {
      if (!data.hasOwnProperty(key) || key === "style") continue;
      var el = $(key);
      if (el && el.tagName !== "SELECT") el.value = data[key];
    }
    return data;
  }

  /* Select'ler doldurulduktan SONRA uygulanmali, yoksa deger kaybolur. */
  function applySavedSelects(data) {
    if (!data) return;
    ["mogrtTemplate", "fontFamily", "fontStyle", "optLanguage", "optModel", "optScope", "mogrtPosition"].forEach(function (id) {
      var el = $(id);
      if (!el || data[id] === undefined) return;
      for (var i = 0; i < el.options.length; i++) {
        if (el.options[i].value === data[id]) { el.value = data[id]; return; }
      }
    });
  }

  function chunkOptions() {
    return {
      mode: state.style === "caption" ? "classic" : "chunk",
      maxWords: Number($("optMaxWords").value),
      maxDuration: Number($("optMaxDuration").value),
      maxCharsPerLine: Number($("optMaxChars").value),
      pauseBreak: Number($("optPause").value),
      minDuration: Number($("optMinDuration").value),
      gapMerge: Number($("optGapMerge").value)
    };
  }

  /* ---------------------------------------------------------------- */
  /* Sablon ve font listeleri                                          */
  /* ---------------------------------------------------------------- */

  function loadTemplates() {
    var select = $("mogrtTemplate");
    select.innerHTML = "";

    var dir = path.join(root, "templates");
    var files = [];
    try {
      files = fs.readdirSync(dir).filter(function (f) { return /\.mogrt$/i.test(f); });
    } catch (e) {}

    if (!files.length) {
      var empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "sablon yok - templates klasorune .mogrt koy";
      select.appendChild(empty);
      select.disabled = true;
      return;
    }

    select.disabled = false;
    for (var i = 0; i < files.length; i++) {
      var opt = document.createElement("option");
      opt.value = path.join(dir, files[i]);
      opt.textContent = files[i].replace(/\.mogrt$/i, "");
      select.appendChild(opt);
    }
  }

  /*
    Font listesi diskteki font dosyalarindan okunuyor. Kullanicinin
    PostScript adini elle yazmasi gerekmesin diye - yanlis yazarsa
    Premiere sessizce baska fonta duser.
  */
  function loadFonts() {
    var familySelect = $("fontFamily");
    familySelect.innerHTML = "";

    var cachePath = path.join(root, ".probe", "fonts-cache.json");
    var result;
    try {
      result = engine.fonts.listFontsCached(cachePath);
    } catch (e) {
      log("Font listesi okunamadi: " + e.message);
      return;
    }

    state.fontFamilies = engine.fonts.groupByFamily(result.fonts);
    log(result.fonts.length + " font okundu" + (result.cached ? " (onbellek)" : " (" + result.elapsedMs + " ms)"));

    var keep = document.createElement("option");
    keep.value = "";
    keep.textContent = "Sablondaki font";
    familySelect.appendChild(keep);

    for (var i = 0; i < state.fontFamilies.length; i++) {
      var group = state.fontFamilies[i];
      var opt = document.createElement("option");
      opt.value = group.family;
      // Turkce gliflerini tasimayan fontlar isaretli - secilirse yazi bozulur.
      opt.textContent = group.turkish ? group.family : group.family + "  (Turkce yok)";
      familySelect.appendChild(opt);
    }

    refreshFontStyles();
  }

  function refreshFontStyles() {
    var family = $("fontFamily").value;
    var styleSelect = $("fontStyle");
    styleSelect.innerHTML = "";

    if (!family) {
      var none = document.createElement("option");
      none.value = "";
      none.textContent = "-";
      styleSelect.appendChild(none);
      styleSelect.disabled = true;
      updateFontNote();
      return;
    }

    styleSelect.disabled = false;
    var group = null;
    for (var i = 0; i < state.fontFamilies.length; i++) {
      if (state.fontFamilies[i].family === family) { group = state.fontFamilies[i]; break; }
    }
    if (!group) return;

    for (var s = 0; s < group.styles.length; s++) {
      var opt = document.createElement("option");
      opt.value = group.styles[s].postScriptName;
      opt.textContent = group.styles[s].subfamily;
      styleSelect.appendChild(opt);
    }

    updateFontNote();
  }

  function updateFontNote() {
    var note = $("fontNote");
    var family = $("fontFamily").value;

    if (!family) {
      note.textContent = "Sablonun kendi fontu kullanilir.";
      note.style.color = "";
      return;
    }

    var group = null;
    for (var i = 0; i < state.fontFamilies.length; i++) {
      if (state.fontFamilies[i].family === family) { group = state.fontFamilies[i]; break; }
    }

    var ps = $("fontStyle").value || "-";
    if (group && !group.turkish) {
      note.textContent = "Bu font Turkce harfleri (C G I S) tasimiyor, yazi bozulur.";
      note.style.color = "var(--warn)";
    } else {
      note.textContent = ps;
      note.style.color = "";
    }
  }

  /* ---------------------------------------------------------------- */
  /* Stil secimi                                                       */
  /* ---------------------------------------------------------------- */

  function setStyle(style) {
    state.style = style;

    var mogrtBtn = $("styleMogrt");
    var captionBtn = $("styleCaption");

    mogrtBtn.classList.toggle("is-active", style === "mogrt");
    captionBtn.classList.toggle("is-active", style === "caption");
    mogrtBtn.setAttribute("aria-checked", style === "mogrt" ? "true" : "false");
    captionBtn.setAttribute("aria-checked", style === "caption" ? "true" : "false");

    show("mogrtOptions", style === "mogrt");

    $("outputHint").textContent = (style === "mogrt")
      ? "Sablon kliplerini ODIUM SUBS track'ine basar."
      : "SRT'yi projeye alir ve Premiere'in caption track'ine dusurur.";

    saveSettings();
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
      $("srcPath").textContent = extra.item.mediaPath || "dosya yolu yok";
      $("srcSeq").textContent = extra.sequence ? extra.sequence.name : "sequence yok";

      $("srcOcc").textContent = extra.occurrenceCount === 0
        ? "kullanilmiyor - sadece SRT uretilir"
        : extra.occurrenceCount + " yerde";

      show("sourceBox", true);
      setPill(extra.source === "timeline" ? "timeline" : "project", "ok");
      log(res.message);

      if (!extra.item.mediaPath) {
        log("UYARI: bu ogenin disk yolu yok (sequence ya da sentetik klip olabilir).");
      }

      updateTranscribeButton();
    });
  }

  function updateTranscribeButton() {
    var btn = $("btnTranscribe");
    var ready = !!(state.selection && state.selection.item && state.selection.item.mediaPath);
    btn.disabled = !ready || state.busy;
    btn.textContent = ready ? "Yaziya dok" : "Once kaynak sec";
  }

  /* ---------------------------------------------------------------- */
  /* 2. Transkripsiyon                                                 */
  /* ---------------------------------------------------------------- */

  function transcribe() {
    if (!state.selection || state.busy) return;

    var mediaPath = state.selection.item.mediaPath;
    var scope = $("optScope").value;

    state.busy = true;
    updateTranscribeButton();
    setPill("calisiyor", "busy");
    setProgress("progWrap", "progBar", "progText", 0, "hazirlaniyor");

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
        if (/^\s*\d{1,3}%/.test(line)) return;
        log(line);
      },
      onPhase: function (phase, ratio) {
        setProgress("progWrap", "progBar", "progText",
          overallRatio(phase, ratio),
          phaseWeights[phase].label + " %" + Math.round(ratio * 100));
      }
    }).then(function (result) {
      state.words = result.words;
      state.cues = result.cues;
      state.language = result.language;
      state.busy = false;

      setProgress("progWrap", "progBar", "progText", 1, "bitti");
      setPill(result.cues.length + " obek", "ok");
      log("Bitti: " + result.words.length + " kelime, " + result.cues.length + " obek, dil " + result.language);

      renderCues();
      show("editorCard", true);
      show("styleCard", true);
      show("outputCard", true);
      updateTranscribeButton();
    }, function (err) {
      state.busy = false;
      setPill("hata", "err");
      show("progWrap", false);
      log("HATA: " + err.message);
      updateTranscribeButton();
    });
  }

  /* ---------------------------------------------------------------- */
  /* 3. Obek editoru                                                   */
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
    var row = document.createElement("li");
    row.className = "cue";

    var head = document.createElement("div");
    head.className = "cue-head";

    var time = document.createElement("span");
    time.className = "cue-time";
    time.textContent = timeLabel(cue.start) + " - " + timeLabel(cue.end)
      + "  " + (cue.end - cue.start).toFixed(2) + " sn";

    var actions = document.createElement("span");
    actions.className = "cue-actions";

    var textArea = document.createElement("textarea");

    actions.appendChild(miniButton("bol", "Imlecin oldugu yerden bol", function () {
      splitCue(index, textArea.selectionStart);
    }));
    actions.appendChild(miniButton("birlestir", "Sonraki obekle birlestir", function () {
      mergeCue(index);
    }));
    actions.appendChild(miniButton("sil", "Bu obegi sil", function () {
      deleteCue(index);
    }));

    head.appendChild(time);
    head.appendChild(actions);

    textArea.className = "cue-text";
    textArea.rows = 1;
    textArea.value = cue.text;
    textArea.spellcheck = false;
    textArea.setAttribute("aria-label", "Obek " + (index + 1) + " metni");
    textArea.addEventListener("input", function () {
      cue.text = textArea.value;
      cue.lines = engine.chunker.wrapLines(cue.text,
        Number($("optMaxChars").value), state.style === "caption" ? 2 : 1);
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

  function miniButton(label, title, onClick) {
    var b = document.createElement("button");
    b.className = "mini";
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  /*
    Imlec konumundan boler. Kelime zamanlari elimizde oldugu icin bolme
    noktasi gercek zamana oturuyor - ortadan bolup tahmin etmiyoruz.
  */
  function splitCue(index, caret) {
    var cue = state.cues[index];
    if (!cue.words || cue.words.length < 2) {
      log("Bu obek tek kelime, bolunemez.");
      return;
    }

    var cursor = 0;
    var splitAt = 1;
    for (var i = 0; i < cue.words.length; i++) {
      cursor += cue.words[i].word.length + (i > 0 ? 1 : 0);
      if (cursor >= caret) { splitAt = i + 1; break; }
      splitAt = i + 1;
    }
    if (splitAt <= 0) splitAt = 1;
    if (splitAt >= cue.words.length) splitAt = cue.words.length - 1;

    state.cues.splice(index, 1,
      makeCue(cue.words.slice(0, splitAt)),
      makeCue(cue.words.slice(splitAt)));

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
    merged.text = (a.text + " " + b.text).replace(/\s+/g, " ");
    merged.start = a.start;
    merged.end = b.end;
    merged.lines = engine.chunker.wrapLines(merged.text,
      Number($("optMaxChars").value), state.style === "caption" ? 2 : 1);

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
    var parts = [];
    for (var i = 0; i < words.length; i++) parts.push(words[i].word);
    var joined = parts.join(" ");
    return {
      index: 0,
      start: words.length ? words[0].start : 0,
      end: words.length ? words[words.length - 1].end : 0,
      text: joined,
      words: words,
      lines: engine.chunker.wrapLines(joined,
        Number($("optMaxChars").value), state.style === "caption" ? 2 : 1),
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
        Number($("optMaxChars").value), state.style === "caption" ? 2 : 1);
    }

    renderCues();
    log(count + " yerde degistirildi.");
  }

  /* ---------------------------------------------------------------- */
  /* 4. Cikti                                                          */
  /* ---------------------------------------------------------------- */

  function srtOffset() {
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
      log("Sequence zamanina cevrildi: " + mapped.length + " obek.");
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

  /* reveal sadece kullanici acikca SRT kaydettiginde - akisi bolmesin. */
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

    setPill("aliniyor", "busy");
    PremiereBridge.importCaptions({
      srtPath: target,
      logPath: path.join(root, ".probe", "import-captions.txt")
    }).then(function (res) {
      log((res.ok ? "" : "HATA: ") + res.message);
      setPill(res.ok ? "basildi" : "hata", res.ok ? "ok" : "err");
      if (res.ok && res.extra && !res.extra.trackCreated) {
        $("outputHint").textContent =
          "SRT projeye alindi ama caption track otomatik olusmadi. "
          + "Project panelinden timeline'a surukle.";
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* 5. Efektli mod - MOGRT                                            */
  /* ---------------------------------------------------------------- */

  /*
    "#ffd400" -> [1, 0.831, 0, 1]
    AE'den gelen renk kontrolu 0-1 araliginda RGBA bekliyor (olculdu:
    sablonun varsayilan degeri [1,1,1,1] = beyaz). 0-255 gondermek yanlis
    renk uretiyor.
  */
  function hexToRgba01(hex) {
    var clean = String(hex).replace("#", "");
    if (clean.length === 3) {
      clean = clean.charAt(0) + clean.charAt(0)
            + clean.charAt(1) + clean.charAt(1)
            + clean.charAt(2) + clean.charAt(2);
    }
    if (clean.length !== 6) return null;

    var r = parseInt(clean.substring(0, 2), 16);
    var g = parseInt(clean.substring(2, 4), 16);
    var b = parseInt(clean.substring(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;

    return [r / 255, g / 255, b / 255, 1];
  }

  /* Motion Position normalize [x, y]: 0,0 sol ust; 1,1 sag alt. */
  var POSITIONS = {
    bottom: [0.5, 0.82],
    top: [0.5, 0.18],
    center: [0.5, 0.5],
    left: [0.28, 0.82],
    right: [0.72, 0.82]
  };

  /*
    Tek evalScript'te yuzlerce klip basmak Premiere'i dakikalarca kilitler
    ve ilerleme gosterilemez. Paket paket gonderiyoruz.
  */
  var BATCH_SIZE = 40;
  var WARN_THRESHOLD = 600;

  function placeMogrt() {
    if (state.busy) return;

    var template = $("mogrtTemplate").value;
    if (!template) {
      log("Sablon secilmedi. templates klasorune bir .mogrt koy.");
      setPill("sablon yok", "err");
      return;
    }
    if (!fs.existsSync(template)) {
      log("Sablon bulunamadi: " + template);
      return;
    }

    var cues = cuesForSequence();
    if (!cues || !cues.length) {
      log("Klip timeline'da bulunamadi - efektli mod sequence konumu gerektiriyor.");
      setPill("timeline'da yok", "err");
      return;
    }

    /*
      window.confirm KULLANMA. CEP panelinde acilan native onay diyalogu bu
      ortamda govdesi olmayan bir cubuk olarak ciziliyor ve JS thread'ini
      kilitliyor. Onay panel icindeki kutucuklardan aliniyor.
    */
    if (cues.length > WARN_THRESHOLD && !$("mogrtForce").checked) {
      log(cues.length + " obek var, tahmini " + Math.round(cues.length * 0.4) + " sn surer.");
      log("Devam icin Gelismis > \"600'den fazla obek olsa da bas\" kutucugunu isaretle.");
      setPill("cok obek", "err");
      return;
    }

    var trackName = $("mogrtTrackName").value || "ODIUM SUBS";
    var positionKey = $("mogrtPosition").value;
    var position = positionKey ? POSITIONS[positionKey] : null;
    var logPath = path.join(root, ".probe", "place-mogrt.txt");

    var payloadBase = {
      mogrtPath: template,
      font: $("fontStyle").value || "",
      fontSize: Number($("mogrtFontSize").value) || 0,
      position: position,
      scale: Number($("mogrtScale").value) || 0,
      color: $("mogrtColorOn").checked ? hexToRgba01($("mogrtColor").value) : null,
      logPath: logPath
    };

    state.busy = true;
    updateTranscribeButton();
    $("btnApply").disabled = true;
    setPill("basiliyor", "busy");
    setProgress("mogrtProgWrap", "mogrtProgBar", "mogrtProgText", 0, "track hazirlaniyor");

    PremiereBridge.ensureSubtitleTrack({
      trackName: trackName,
      clear: false,
      logPath: logPath
    }).then(function (res) {
      if (!res.ok) throw new Error(res.message);
      log(res.message);

      if (res.extra.existing > 0) {
        if (!$("mogrtClear").checked) {
          throw new Error(
            "\"" + trackName + "\" track'inde " + res.extra.existing + " klip var. "
            + "Gelismis > \"Track doluysa once temizle\" kutucugunu isaretle "
            + "ya da baska bir track adi ver."
          );
        }
        return PremiereBridge.ensureSubtitleTrack({
          trackName: trackName, clear: true, logPath: logPath
        }).then(function (res2) {
          if (!res2.ok) throw new Error(res2.message);
          log("Temizlendi: " + res2.extra.cleared + " klip");
          return res2.extra.trackIndex;
        });
      }
      return res.extra.trackIndex;
    }).then(function (trackIndex) {
      var total = cues.length;
      var placed = 0;
      var failed = 0;
      var started = Date.now();
      var offset = 0;

      function nextBatch() {
        if (offset >= total) {
          var seconds = Math.round((Date.now() - started) / 1000);
          setProgress("mogrtProgWrap", "mogrtProgBar", "mogrtProgText", 1,
            placed + " klip, " + seconds + " sn");
          setPill("basildi", "ok");
          log("Efektli basma bitti: " + placed + " klip"
            + (failed ? ", " + failed + " basarisiz" : "")
            + " (" + seconds + " sn, klip basi "
            + Math.round((Date.now() - started) / Math.max(1, placed)) + " ms)");
          state.busy = false;
          $("btnApply").disabled = false;
          updateTranscribeButton();
          return;
        }

        var slice = [];
        for (var i = offset; i < Math.min(offset + BATCH_SIZE, total); i++) {
          slice.push({ start: cues[i].start, end: cues[i].end, text: cues[i].text });
        }

        var payload = {};
        for (var k in payloadBase) if (payloadBase.hasOwnProperty(k)) payload[k] = payloadBase[k];
        payload.trackIndex = trackIndex;
        payload.cues = slice;

        return PremiereBridge.placeSubtitles(payload).then(function (res) {
          if (!res.ok) throw new Error(res.message);

          placed += res.extra.placed;
          failed += res.extra.failed;
          offset += slice.length;

          if (res.extra.firstError) log("uyari: " + res.extra.firstError);

          setProgress("mogrtProgWrap", "mogrtProgBar", "mogrtProgText",
            offset / total, placed + " / " + total + " klip");
          setTimeout(nextBatch, 30);
        });
      }

      nextBatch();
    }).catch(function (err) {
      state.busy = false;
      $("btnApply").disabled = false;
      updateTranscribeButton();
      show("mogrtProgWrap", false);
      setPill("hata", "err");
      log("HATA: " + err.message);
    });
  }

  function applyToTimeline() {
    if (state.style === "caption") importSrt();
    else placeMogrt();
  }

  /* ---------------------------------------------------------------- */
  /* Uzaktan guncelleme                                                */
  /* ---------------------------------------------------------------- */

  /* "1.2.10" > "1.2.9" dogru karsilastirilsin diye parca parca bakiyoruz. */
  function isNewer(remote, local) {
    var a = String(remote).split(".");
    var b = String(local).split(".");
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
      var x = Number(a[i] || 0);
      var y = Number(b[i] || 0);
      if (x > y) return true;
      if (x < y) return false;
    }
    return false;
  }

  function readLocalVersion() {
    try {
      var p = path.join(root, "version.json");
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (e) {
      return null;
    }
  }

  function fetchJson(url) {
    return new Promise(function (resolve, reject) {
      var https = nodeRequire("https");
      var req = https.get(url, { headers: { "User-Agent": "odium-subs" }, timeout: 8000 }, function (res) {
        if (res.statusCode !== 200) { res.resume(); reject(new Error("HTTP " + res.statusCode)); return; }
        var body = "";
        res.setEncoding("utf8");
        res.on("data", function (d) { body += d; });
        res.on("end", function () {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      });
      req.on("timeout", function () { req.destroy(new Error("zaman asimi")); });
      req.on("error", reject);
    });
  }

  /* Manifest adresi bos ya da internet yoksa sessiz gecer. */
  function checkUpdate() {
    var local = readLocalVersion();
    if (!local || !local.manifestUrl) return;

    fetchJson(local.manifestUrl).then(function (remote) {
      if (!remote || !remote.version) return;
      if (!isNewer(remote.version, local.version)) return;

      log("Yeni surum var: v" + remote.version + (remote.notes ? " - " + remote.notes : ""));
      var pill = $("pill");
      pill.textContent = "guncelle v" + remote.version;
      pill.className = "status update";
      pill.title = "Indirmek icin tikla";
      pill.onclick = function () {
        var url = remote.setupUrl || local.setupUrl;
        if (!url) { log("Kurulum adresi tanimli degil."); return; }
        try {
          childProcess.spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
          log("Tarayicida aciliyor: " + url);
        } catch (e) {
          log("Acilamadi: " + e.message);
        }
      };
    }, function (err) {
      log("Guncelleme kontrolu yapilamadi: " + err.message);
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

    var saved = loadSettings();

    loadTemplates();
    loadFonts();
    applySavedSelects(saved);
    refreshFontStyles();

    for (var i = 0; i < SETTING_IDS.length; i++) {
      var el = $(SETTING_IDS[i]);
      if (el) el.addEventListener("change", saveSettings);
    }

    $("optScope").addEventListener("change", function () {
      show("rangeRow", this.value === "range");
    });
    show("rangeRow", $("optScope").value === "range");

    $("fontFamily").addEventListener("change", function () {
      refreshFontStyles();
      saveSettings();
    });
    $("fontStyle").addEventListener("change", updateFontNote);

    var swatches = document.querySelectorAll(".swatch");
    for (var s = 0; s < swatches.length; s++) {
      swatches[s].addEventListener("click", function () {
        $("mogrtColor").value = this.getAttribute("data-color");
        $("mogrtColorOn").checked = true;
        saveSettings();
      });
    }

    $("styleMogrt").addEventListener("click", function () { setStyle("mogrt"); });
    $("styleCaption").addEventListener("click", function () { setStyle("caption"); });
    setStyle(saved && saved.style ? saved.style : "mogrt");

    $("btnRead").addEventListener("click", readSelection);
    $("btnTranscribe").addEventListener("click", transcribe);
    $("btnReplace").addEventListener("click", replaceAll);
    $("btnApply").addEventListener("click", applyToTimeline);
    $("btnSaveSrt").addEventListener("click", function () { saveSrt(true); });

    var localVersion = readLocalVersion();
    if (localVersion && localVersion.version) {
      $("version").textContent = "v" + localVersion.version;
    }

    log("Odium Subs hazir.");
    checkUpdate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return { state: state, renderCues: renderCues };
})();
