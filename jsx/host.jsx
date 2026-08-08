/*
  Odium Subs - Premiere Pro host tarafi (ExtendScript / ES3).
  M0 = OLCUM PAKETI. Bu dosya henuz altyazi basmiyor; mimariyi belirleyecek
  dort bilinmeyeni olcuyor:
    1) importMGT klip basina kac ms suruyor
    2) MOGRT parametreleri isimle gorunuyor mu, yazilabiliyor mu (font dahil)
    3) QE DOM track ekleme/silme 26.x'te calisiyor mu
    4) Secim okuma + occurrence eslemesi + tick birimi dogru mu

  Kural: her adim aninda diske yazilir (yaz-kapat = flush). Premiere cokerse
  evalScript callback'i hic donmez ve panele log dusmez; log dosyasindaki SON
  SATIR tam olarak hangi cagrinin coktugunu gosterir.

  ES3 uyarisi: JSON, forEach, trim, Array.indexOf YOK. Duz dongu kullan.
*/

var PP_TICKS_PER_SECOND = 254016000000;

/* ------------------------------------------------------------------ */
/* Temel yardimcilar                                                    */
/* ------------------------------------------------------------------ */

function PP_hasNativeJSON() {
  return (typeof JSON !== "undefined" && JSON && typeof JSON.parse === "function" && typeof JSON.stringify === "function");
}

function PP_parseJson(jsonText) {
  try {
    if (PP_hasNativeJSON()) {
      return JSON.parse(jsonText);
    }
    // Payload'i biz uretiyoruz, guvenli kaynak; ES3'te fallback eval.
    return eval("(" + jsonText + ")");
  } catch (e) {
    return null;
  }
}

function PP_escapeJsonString(value) {
  var s = (value === null || value === undefined) ? "" : String(value);
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    var code = s.charCodeAt(i);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 32) out += "\\u" + PP_pad4(code.toString(16));
    else out += ch;
  }
  return out;
}

function PP_pad4(hex) {
  while (hex.length < 4) hex = "0" + hex;
  return hex;
}

function PP_result(ok, message, extraJson) {
  var out = '{"ok":' + (ok ? "true" : "false") + ',"message":"' + PP_escapeJsonString(message) + '"';
  if (extraJson) {
    out += ',"extra":' + extraJson;
  }
  out += "}";
  return out;
}

/* Log biriktirici: her yazimda dosyayi bastan yazip kapatir (flush garantisi). */
function PP_Logger(logPath) {
  this.logPath = logPath;
  this.lines = [];
}

PP_Logger.prototype.add = function (text) {
  this.lines.push(text);
  this.flush();
};

PP_Logger.prototype.step = function (n, text) {
  this.add("ADIM " + n + ": " + text);
};

PP_Logger.prototype.text = function () {
  return this.lines.join("\n");
};

PP_Logger.prototype.flush = function () {
  if (!this.logPath) return;
  try {
    var f = new File(this.logPath);
    var parent = f.parent;
    if (parent && !parent.exists) parent.create();
    f.encoding = "UTF-8";
    f.open("w");
    f.write(this.text());
    f.close();
  } catch (e) {
    // Log yazamiyorsak sessiz gec; probe'un kendisi durmasin.
  }
};

function PP_typeName(v) {
  try {
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    var t = typeof v;
    if (t === "object") {
      try {
        if (v.reflect && v.reflect.name) return "object:" + v.reflect.name;
      } catch (e0) {}
      return "object";
    }
    return t;
  } catch (e) {
    return "?";
  }
}

/* Bir nesnenin property/metod yuzeyini dokum eder. */
function PP_reflectList(obj, which) {
  var out = [];
  try {
    var items = (which === "methods") ? obj.reflect.methods : obj.reflect.properties;
    for (var i = 0; i < items.length; i++) {
      var name = String(items[i].name);
      if (which === "methods") {
        var argsText = "";
        try {
          var args = items[i].arguments;
          if (args && args.length) {
            var parts = [];
            for (var a = 0; a < args.length; a++) {
              parts.push(String(args[a].name) + ":" + String(args[a].dataType));
            }
            argsText = parts.join(", ");
          }
        } catch (eArgs) {
          argsText = "?";
        }
        out.push(name + "(" + argsText + ")");
      } else {
        var val = "";
        try { val = PP_typeName(obj[name]); } catch (eVal) { val = "<okunamadi>"; }
        out.push(name + " : " + val);
      }
    }
  } catch (e) {
    out.push("<reflect basarisiz: " + e + ">");
  }
  out.sort();
  return out;
}

function PP_dumpInto(logger, label, obj) {
  logger.add("--- " + label + " [" + PP_typeName(obj) + "] ---");
  logger.add("  PROPERTIES: " + PP_reflectList(obj, "properties").join(" | "));
  logger.add("  METHODS   : " + PP_reflectList(obj, "methods").join(" | "));
}

function PP_secondsToTicks(seconds) {
  return String(Math.round(seconds * PP_TICKS_PER_SECOND));
}

/* Time nesnesini hem saniye hem tick olarak okur; hangisinin dogru geldigini gorelim. */
function PP_timeInfo(timeObj) {
  var sec = null;
  var ticks = null;
  try { sec = timeObj.seconds; } catch (e1) {}
  try { ticks = timeObj.ticks; } catch (e2) {}
  return {
    seconds: (sec === null || sec === undefined) ? null : Number(sec),
    ticks: (ticks === null || ticks === undefined) ? null : String(ticks)
  };
}

function PP_timeText(label, timeObj) {
  var info = PP_timeInfo(timeObj);
  return label + "={sec:" + info.seconds + ", ticks:" + info.ticks + "}";
}

function PP_activeSequence(logger) {
  var seq = null;
  try {
    seq = app.project.activeSequence;
  } catch (e) {
    if (logger) logger.add("HATA: app.project.activeSequence okunamadi: " + e);
    return null;
  }
  if (!seq) {
    if (logger) logger.add("HATA: Aktif sequence yok. Timeline'da bir sequence acik olmali.");
    return null;
  }
  return seq;
}

/* ------------------------------------------------------------------ */
/* PROBE 0 - baglanti testi                                            */
/* ------------------------------------------------------------------ */

function PP_ping() {
  try {
    var name = "?";
    var version = "?";
    var projName = "<proje yok>";
    try { name = app.appName; } catch (e1) {}
    try { version = app.version; } catch (e2) {}
    try { if (app.project) projName = app.project.name; } catch (e3) {}

    var extra = '{"appName":"' + PP_escapeJsonString(name) + '"'
      + ',"version":"' + PP_escapeJsonString(version) + '"'
      + ',"project":"' + PP_escapeJsonString(projName) + '"'
      + ',"ticksPerSecond":"' + PP_TICKS_PER_SECOND + '"}';
    return PP_result(true, "Host baglantisi calisiyor.", extra);
  } catch (e) {
    return PP_result(false, "Ping hatasi: " + e);
  }
}

/* ------------------------------------------------------------------ */
/* PROBE 1 - secim okuma + occurrence eslemesi + tick dogrulama        */
/* ------------------------------------------------------------------ */

function PP_probeSelection(payloadJson) {
  var payload = PP_parseJson(payloadJson) || {};
  var logger = new PP_Logger(payload.logPath);

  try {
    logger.add("=== PROBE 1: SECIM + OCCURRENCE + TICK ===");
    logger.add("Zaman: " + new Date().toString());

    logger.step(1, "app yuzeyi dokumu");
    PP_dumpInto(logger, "app", app);

    /* --- Project paneli secimi --- */
    logger.step(2, "Project paneli secimi okunuyor");
    var projectItems = [];

    try {
      if (typeof app.getCurrentProjectViewSelection === "function") {
        var sel = app.getCurrentProjectViewSelection();
        logger.add("  app.getCurrentProjectViewSelection() -> " + PP_typeName(sel)
          + " uzunluk=" + (sel && sel.length !== undefined ? sel.length : "?"));
        if (sel && sel.length) {
          for (var i = 0; i < sel.length; i++) projectItems.push(sel[i]);
        }
      } else {
        logger.add("  app.getCurrentProjectViewSelection YOK");
      }
    } catch (eSel1) {
      logger.add("  getCurrentProjectViewSelection HATA: " + eSel1);
    }

    if (!projectItems.length) {
      try {
        if (typeof app.getProjectViewIDs === "function") {
          var ids = app.getProjectViewIDs();
          logger.add("  app.getProjectViewIDs() -> uzunluk=" + (ids && ids.length ? ids.length : 0));
          if (ids && ids.length) {
            for (var v = 0; v < ids.length; v++) {
              var sel2 = app.getProjectViewSelection(ids[v]);
              logger.add("    view[" + v + "] secim uzunlugu=" + (sel2 && sel2.length ? sel2.length : 0));
              if (sel2 && sel2.length) {
                for (var s2 = 0; s2 < sel2.length; s2++) projectItems.push(sel2[s2]);
              }
            }
          }
        } else {
          logger.add("  app.getProjectViewIDs YOK");
        }
      } catch (eSel2) {
        logger.add("  getProjectViewIDs/Selection HATA: " + eSel2);
      }
    }

    logger.add("  TOPLAM secili project item: " + projectItems.length);

    var firstItem = null;
    for (var p = 0; p < projectItems.length; p++) {
      var it = projectItems[p];
      var nm = "?", mp = "?", nid = "?", tp = "?";
      try { nm = it.name; } catch (e3a) {}
      try { mp = it.getMediaPath(); } catch (e3b) { mp = "<getMediaPath HATA: " + e3b + ">"; }
      try { nid = it.nodeId; } catch (e3c) {}
      try { tp = it.type; } catch (e3d) {}
      logger.add("  [" + p + "] name=" + nm + " | type=" + tp + " | nodeId=" + nid);
      logger.add("       mediaPath=" + mp);
      if (!firstItem) firstItem = it;
    }

    if (firstItem) {
      logger.step(3, "ilk project item yuzeyi");
      PP_dumpInto(logger, "projectItem[0]", firstItem);
    } else {
      logger.step(3, "secili project item yok - atlandi");
    }

    /* --- Timeline secimi --- */
    logger.step(4, "Timeline (sequence) secimi okunuyor");
    var seq = PP_activeSequence(logger);
    if (seq) {
      logger.add("  sequence.name=" + seq.name);
      try { logger.add("  videoTracks.numTracks=" + seq.videoTracks.numTracks); } catch (e4a) {}
      try { logger.add("  audioTracks.numTracks=" + seq.audioTracks.numTracks); } catch (e4b) {}
      try { logger.add("  " + PP_timeText("zeroPoint", { seconds: null, ticks: seq.zeroPoint })); } catch (e4c) {
        logger.add("  zeroPoint okunamadi: " + e4c);
      }
      try { logger.add("  timebase=" + seq.timebase); } catch (e4d) {}
      try { logger.add("  " + PP_timeText("sequence.end", seq.end)); } catch (e4e) {}

      try {
        if (typeof seq.getSelection === "function") {
          var tSel = seq.getSelection();
          logger.add("  sequence.getSelection() -> uzunluk=" + (tSel && tSel.length ? tSel.length : 0));
          if (tSel && tSel.length) {
            for (var t = 0; t < tSel.length; t++) {
              PP_logTrackItem(logger, "  timelineSel[" + t + "]", tSel[t]);
            }
            logger.step(5, "ilk timeline klibi yuzeyi");
            PP_dumpInto(logger, "trackItem[0]", tSel[0]);
          }
        } else {
          logger.add("  sequence.getSelection YOK");
        }
      } catch (eT) {
        logger.add("  sequence.getSelection HATA: " + eT);
      }
    }

    /* --- Occurrence eslemesi: secili project item sequence'de nerelerde? --- */
    logger.step(6, "Occurrence taramasi (secili klip timeline'da nerelerde)");
    var occurrenceCount = 0;
    if (seq && firstItem) {
      var wantedId = null;
      try { wantedId = String(firstItem.nodeId); } catch (eW) {}
      logger.add("  aranan nodeId=" + wantedId);

      try {
        for (var vt = 0; vt < seq.videoTracks.numTracks; vt++) {
          var track = seq.videoTracks[vt];
          for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            var clipId = null;
            try { clipId = clip.projectItem ? String(clip.projectItem.nodeId) : null; } catch (eC) {}
            if (wantedId && clipId === wantedId) {
              occurrenceCount++;
              PP_logTrackItem(logger, "  V" + (vt + 1) + " occurrence[" + occurrenceCount + "]", clip);
              PP_logMappingCheck(logger, clip);
            }
          }
        }
      } catch (eOcc) {
        logger.add("  occurrence taramasi HATA: " + eOcc);
      }
    } else {
      logger.add("  atlandi (sequence veya secili item yok)");
    }
    logger.add("  TOPLAM occurrence: " + occurrenceCount);

    logger.step(7, "BITTI");

    var extra = '{"projectItemCount":' + projectItems.length
      + ',"occurrenceCount":' + occurrenceCount
      + ',"logPath":"' + PP_escapeJsonString(payload.logPath || "") + '"}';
    return PP_result(true, "Secim probe'u tamamlandi. Log: " + (payload.logPath || "<yol yok>"), extra);
  } catch (e) {
    logger.add("KRITIK HATA: " + e);
    return PP_result(false, "Secim probe'u hata verdi: " + e);
  }
}

function PP_logTrackItem(logger, label, clip) {
  try {
    var nm = "?";
    try { nm = clip.name; } catch (e1) {}
    logger.add(label + " name=" + nm);
    try { logger.add("      " + PP_timeText("start", clip.start)); } catch (e2) {}
    try { logger.add("      " + PP_timeText("end", clip.end)); } catch (e3) {}
    try { logger.add("      " + PP_timeText("inPoint", clip.inPoint)); } catch (e4) {}
    try { logger.add("      " + PP_timeText("outPoint", clip.outPoint)); } catch (e5) {}
    try { logger.add("      " + PP_timeText("duration", clip.duration)); } catch (e6) {}
    try { logger.add("      mediaType=" + clip.mediaType + " nodeId=" + (clip.projectItem ? clip.projectItem.nodeId : "-")); } catch (e7) {}
    try {
      if (typeof clip.getSpeed === "function") {
        logger.add("      getSpeed()=" + clip.getSpeed());
      } else {
        logger.add("      getSpeed YOK");
      }
    } catch (e8) {
      logger.add("      getSpeed HATA: " + e8);
    }
    try {
      if (typeof clip.isAdjustmentLayer === "function") {
        logger.add("      isAdjustmentLayer()=" + clip.isAdjustmentLayer());
      }
    } catch (e9) {}
  } catch (e) {
    logger.add(label + " okunamadi: " + e);
  }
}

/*
  Occurrence eslemesinin cekirdegi:
    seqTime = clip.start + (sourceTime - clip.inPoint)
  Burada formulu iki ucta (klibin bası ve sonu) dogruluyoruz. Beklenen:
    sourceTime=inPoint  -> seqTime=start
    sourceTime=outPoint -> seqTime=end
  Sapma varsa (hiz degisimi vs.) burada gorunur.
*/
function PP_logMappingCheck(logger, clip) {
  try {
    var startS = clip.start.seconds;
    var endS = clip.end.seconds;
    var inS = clip.inPoint.seconds;
    var outS = clip.outPoint.seconds;

    var mappedStart = startS + (inS - inS);
    var mappedEnd = startS + (outS - inS);
    var deltaEnd = mappedEnd - endS;

    logger.add("      ESLEME: mappedStart=" + mappedStart + " (beklenen " + startS + ")");
    logger.add("      ESLEME: mappedEnd=" + mappedEnd + " (beklenen " + endS + ") sapma=" + deltaEnd);
    if (deltaEnd > 0.005 || deltaEnd < -0.005) {
      logger.add("      >>> UYARI: sapma 5ms ustu. Hiz degisimi / time remap olabilir.");
    }
  } catch (e) {
    logger.add("      ESLEME kontrolu HATA: " + e);
  }
}

/* ------------------------------------------------------------------ */
/* PROBE 2 - MOGRT parametre yuzeyi                                    */
/* ------------------------------------------------------------------ */

function PP_probeMogrt(payloadJson) {
  var payload = PP_parseJson(payloadJson) || {};
  var logger = new PP_Logger(payload.logPath);

  try {
    logger.add("=== PROBE 2: MOGRT PARAMETRELERI ===");
    logger.add("Zaman: " + new Date().toString());
    logger.add("mogrtPath: " + payload.mogrtPath);

    var seq = PP_activeSequence(logger);
    if (!seq) return PP_result(false, "Aktif sequence yok.");

    logger.step(1, "sequence yuzeyi dokumu (importMGT imzasi icin)");
    PP_dumpInto(logger, "sequence", seq);

    logger.step(2, "mogrt dosyasi kontrolu");
    var mf = new File(payload.mogrtPath);
    logger.add("  exists=" + mf.exists + " fsName=" + mf.fsName);
    if (!mf.exists) {
      logger.add("HATA: mogrt dosyasi yok.");
      return PP_result(false, "MOGRT dosyasi bulunamadi: " + payload.mogrtPath);
    }

    var vTrack = (payload.videoTrackIndex === undefined || payload.videoTrackIndex === null) ? 0 : payload.videoTrackIndex;
    var atSeconds = (payload.atSeconds === undefined || payload.atSeconds === null) ? 0 : payload.atSeconds;
    var ticks = PP_secondsToTicks(atSeconds);

    logger.step(3, "importMGT cagriliyor (tick=" + ticks + ", vTrack=" + vTrack + ")");
    var clip = null;
    try {
      clip = seq.importMGT(mf.fsName, ticks, vTrack, 0);
    } catch (eImp) {
      logger.add("  importMGT(fsName, ticksString, v, a) HATA: " + eImp);
    }

    if (!clip) {
      logger.add("  clip null dondu. Alternatif imza deneniyor: saniye (number) ile");
      try {
        clip = seq.importMGT(mf.fsName, atSeconds, vTrack, 0);
        logger.add("  saniye ile dondu -> " + PP_typeName(clip));
      } catch (eImp2) {
        logger.add("  saniye varyanti da HATA: " + eImp2);
      }
    }

    if (!clip) {
      logger.add("HATA: importMGT klip dondurmedi. Sonraki adimlar atlaniyor.");
      return PP_result(false, "importMGT klip dondurmedi. Log: " + payload.logPath);
    }

    logger.add("  clip donduruldu: " + PP_typeName(clip));
    PP_logTrackItem(logger, "  yerlesen klip", clip);

    logger.step(4, "yerlesim dogrulamasi (istenen vs okunan)");
    try {
      var gotSec = clip.start.seconds;
      logger.add("  istenen=" + atSeconds + "s, okunan=" + gotSec + "s, sapma=" + (gotSec - atSeconds));
      if (Math.abs(gotSec - atSeconds) > 0.02) {
        logger.add("  >>> UYARI: yerlesim sapmasi. Tick birimi yanlis olabilir.");
      }
    } catch (eV) {
      logger.add("  dogrulama HATA: " + eV);
    }

    logger.step(5, "getMGTComponent()");
    var comp = null;
    try {
      if (typeof clip.getMGTComponent === "function") {
        comp = clip.getMGTComponent();
        logger.add("  comp=" + PP_typeName(comp));
      } else {
        logger.add("  clip.getMGTComponent YOK");
      }
    } catch (eComp) {
      logger.add("  getMGTComponent HATA: " + eComp);
    }

    if (!comp) {
      logger.add("getMGTComponent bos dondu. YEDEK: tum component'ler ve parametreleri dokuluyor.");
      logger.add("(MOGRT parametreleri buyuk ihtimalle bu listede bir component'in altinda.)");
      try {
        var allComps = clip.components;
        logger.add("  components.numItems=" + allComps.numItems);
        for (var ac = 0; ac < allComps.numItems; ac++) {
          var one = allComps[ac];
          var oneName = "?";
          try { oneName = one.displayName; } catch (eOn) {}
          var oneCount = 0;
          try { oneCount = one.properties.numItems; } catch (eOc) {}
          logger.add("  --- component[" + ac + "] \"" + oneName + "\" parametre=" + oneCount);
          try {
            for (var op = 0; op < oneCount; op++) {
              var opd = "?", opv = "?";
              try { opd = one.properties[op].displayName; } catch (eOd) {}
              try { opv = String(one.properties[op].getValue()); } catch (eOv) { opv = "<getValue HATA>"; }
              if (opv && opv.length > 160) opv = opv.substring(0, 160) + " ...[kisaltildi]";
              logger.add("      [" + op + "] \"" + opd + "\" = " + opv);
            }
          } catch (eOp) {
            logger.add("      parametreler okunamadi: " + eOp);
          }
        }
      } catch (eAll) {
        logger.add("  component dokumu HATA: " + eAll);
      }
      return PP_result(false, "getMGTComponent bos dondu - yedek dokum log'da. Log: " + payload.logPath);
    }

    PP_dumpInto(logger, "mgtComponent", comp);

    logger.step(6, "PARAMETRE DOKUMU (en kritik cikti)");
    var paramCount = 0;
    var textParamIndex = -1;
    try {
      var props = comp.properties;
      paramCount = props.numItems;
      logger.add("  properties.numItems=" + paramCount);

      for (var i = 0; i < paramCount; i++) {
        var pr = props[i];
        var dn = "?", val = "?", tn = PP_typeName(pr);
        try { dn = pr.displayName; } catch (eDn) { dn = "<displayName HATA>"; }
        try { val = String(pr.getValue()); } catch (eVal) { val = "<getValue HATA: " + eVal + ">"; }
        if (val && val.length > 220) val = val.substring(0, 220) + " ...[kisaltildi]";
        logger.add("  [" + i + "] \"" + dn + "\" (" + tn + ") = " + val);

        var lower = String(dn).toLowerCase();
        if (textParamIndex < 0 && (lower === "text" || lower.indexOf("source text") >= 0 || lower.indexOf("metin") >= 0)) {
          textParamIndex = i;
        }
      }

      if (paramCount > 0) {
        logger.add("  --- ilk parametrenin yuzeyi ---");
        PP_dumpInto(logger, "properties[0]", props[0]);
      }
    } catch (eProps) {
      logger.add("  properties okuma HATA: " + eProps);
    }

    logger.step(7, "TEXT YAZMA TESTI (index=" + textParamIndex + ")");
    if (textParamIndex >= 0) {
      var testText = "ODIUM TEST ÇĞİÖŞÜ";
      try {
        comp.properties[textParamIndex].setValue(testText, true);
        logger.add("  setValue cagrildi.");
        var after = "?";
        try { after = String(comp.properties[textParamIndex].getValue()); } catch (eA) { after = "<geri okunamadi>"; }
        if (after.length > 220) after = after.substring(0, 220) + " ...[kisaltildi]";
        logger.add("  geri okunan: " + after);
        logger.add("  >>> Turkce karakter korunmus mu, ustteki satira bak.");
      } catch (eSet) {
        logger.add("  setValue HATA: " + eSet);
        logger.add("  Not: bazi surumlerde setValue(string) yerine JSON string bekleniyor olabilir.");
      }
    } else {
      logger.add("  Text parametresi isimle bulunamadi. Yukaridaki dokumden dogru index'i sec.");
    }

    logger.step(8, "MOTION EFEKTI (konum/boyut icin) taraniyor");
    try {
      var comps = clip.components;
      logger.add("  components.numItems=" + comps.numItems);
      for (var ci = 0; ci < comps.numItems; ci++) {
        var cc = comps[ci];
        var cname = "?";
        try { cname = cc.displayName; } catch (eCn) {}
        logger.add("  component[" + ci + "] " + cname);
        var lowerC = String(cname).toLowerCase();
        if (lowerC.indexOf("motion") >= 0 || lowerC.indexOf("hareket") >= 0) {
          try {
            for (var pi = 0; pi < cc.properties.numItems; pi++) {
              var mp = cc.properties[pi];
              var mdn = "?", mval = "?";
              try { mdn = mp.displayName; } catch (eM1) {}
              try { mval = String(mp.getValue()); } catch (eM2) { mval = "<getValue HATA>"; }
              logger.add("      param[" + pi + "] \"" + mdn + "\" = " + mval);
            }
          } catch (eMp) {
            logger.add("      motion parametreleri okunamadi: " + eMp);
          }
        }
      }
    } catch (eComps) {
      logger.add("  components HATA: " + eComps);
    }

    logger.step(9, "BITTI - test klibi timeline'da BIRAKILDI. Ctrl+Z ile geri al.");

    var extra = '{"paramCount":' + paramCount + ',"textParamIndex":' + textParamIndex + "}";
    return PP_result(true, "MOGRT probe tamamlandi (" + paramCount + " parametre). Log: " + (payload.logPath || ""), extra);
  } catch (e) {
    logger.add("KRITIK HATA: " + e);
    return PP_result(false, "MOGRT probe hata verdi: " + e);
  }
}

/* ------------------------------------------------------------------ */
/* PROBE 3 - importMGT hiz olcumu (URUNUN SEKLINI BU BELIRLIYOR)       */
/* ------------------------------------------------------------------ */

function PP_probeImportSpeed(payloadJson) {
  var payload = PP_parseJson(payloadJson) || {};
  var logger = new PP_Logger(payload.logPath);

  try {
    logger.add("=== PROBE 3: importMGT HIZ OLCUMU ===");
    logger.add("Zaman: " + new Date().toString());

    var seq = PP_activeSequence(logger);
    if (!seq) return PP_result(false, "Aktif sequence yok.");

    var mf = new File(payload.mogrtPath);
    if (!mf.exists) {
      logger.add("HATA: mogrt yok: " + payload.mogrtPath);
      return PP_result(false, "MOGRT dosyasi bulunamadi.");
    }

    var count = payload.count ? Number(payload.count) : 25;
    var vTrack = (payload.videoTrackIndex === undefined || payload.videoTrackIndex === null) ? 0 : payload.videoTrackIndex;
    var gapSeconds = payload.gapSeconds ? Number(payload.gapSeconds) : 2;
    var startAt = payload.startAtSeconds ? Number(payload.startAtSeconds) : 0;

    logger.add("count=" + count + " vTrack=" + vTrack + " gap=" + gapSeconds + "s baslangic=" + startAt + "s");
    logger.add("mogrt=" + mf.fsName);

    var t0 = new Date().getTime();
    var placed = 0;
    var failed = 0;
    var perClip = [];

    for (var i = 0; i < count; i++) {
      var at = startAt + (i * gapSeconds);
      var ticks = PP_secondsToTicks(at);
      var tA = new Date().getTime();
      var clip = null;
      try {
        clip = seq.importMGT(mf.fsName, ticks, vTrack, 0);
      } catch (eI) {
        if (failed === 0) logger.add("  ilk hata (i=" + i + "): " + eI);
      }
      var tB = new Date().getTime();
      perClip.push(tB - tA);

      if (clip) placed++; else failed++;

      // Her 5 klipte bir diske yaz - cokerse nerede coktugu belli olsun.
      if (i % 5 === 0) {
        logger.add("  ilerleme: " + (i + 1) + "/" + count + " (son klip " + (tB - tA) + " ms)");
      }
    }

    var t1 = new Date().getTime();
    var totalMs = t1 - t0;
    var avgMs = count > 0 ? (totalMs / count) : 0;

    // Medyan - tek bir yavas klip ortalamayi bozmasin.
    perClip.sort(function (a, b) { return a - b; });
    var medianMs = perClip.length ? perClip[Math.floor(perClip.length / 2)] : 0;

    logger.add("--- SONUC ---");
    logger.add("  yerlesen=" + placed + " basarisiz=" + failed);
    logger.add("  toplam=" + totalMs + " ms");
    logger.add("  ortalama=" + avgMs + " ms/klip");
    logger.add("  medyan=" + medianMs + " ms/klip");
    logger.add("  ilk klip=" + perClip[0] + " ms, en yavas=" + perClip[perClip.length - 1] + " ms");
    logger.add("--- TAHMINLER (medyan uzerinden) ---");
    logger.add("  350 klip (10 dk obek modu)  = " + Math.round(medianMs * 350 / 1000) + " sn");
    logger.add("  600 klip                    = " + Math.round(medianMs * 600 / 1000) + " sn");
    logger.add("  1400 klip (40 dk obek modu) = " + Math.round(medianMs * 1400 / 1000) + " sn");
    logger.add("BITTI - " + placed + " test klibi timeline'da BIRAKILDI. Ctrl+Z ile geri al.");

    var extra = '{"placed":' + placed + ',"failed":' + failed
      + ',"totalMs":' + totalMs + ',"avgMs":' + avgMs + ',"medianMs":' + medianMs + "}";
    return PP_result(true, placed + " klip / " + totalMs + " ms, medyan " + medianMs + " ms/klip.", extra);
  } catch (e) {
    logger.add("KRITIK HATA: " + e);
    return PP_result(false, "Hiz probe'u hata verdi: " + e);
  }
}

/* ------------------------------------------------------------------ */
/* PROBE 5 - HIZLI YOL: importMGT yerine projectItem + insertClip      */
/*                                                                     */
/* Probe 3 medyan 427 ms/klip verdi -> 1400 klip = 10 dk. Kullanilamaz. */
/* Hipotez: importMGT ilk cagrida .mogrt'i acip projeye bir item olarak */
/* dusuruyor. Oyleyse kalan klipleri o hazir item'dan insertClip /      */
/* overwriteClip ile basmak cok daha ucuz olmali.                      */
/* Bu probe hipotezi olcer; dogruysa M3'un tum yerlestirme stratejisi   */
/* degisir.                                                            */
/* ------------------------------------------------------------------ */

function PP_rootItems() {
  var out = [];
  try {
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
      var it = root.children[i];
      var nm = "?", nid = "?", tp = "?";
      try { nm = it.name; } catch (e1) {}
      try { nid = String(it.nodeId); } catch (e2) {}
      try { tp = String(it.type); } catch (e3) {}
      out.push({ item: it, name: nm, nodeId: nid, type: tp });
    }
  } catch (e) {}
  return out;
}

function PP_median(arr) {
  if (!arr.length) return 0;
  var c = [];
  for (var i = 0; i < arr.length; i++) c.push(arr[i]);
  c.sort(function (a, b) { return a - b; });
  return c[Math.floor(c.length / 2)];
}

function PP_probeFastPlace(payloadJson) {
  var payload = PP_parseJson(payloadJson) || {};
  var logger = new PP_Logger(payload.logPath);

  try {
    logger.add("=== PROBE 5: HIZLI YERLESTIRME YOLU ===");
    logger.add("Zaman: " + new Date().toString());

    var seq = PP_activeSequence(logger);
    if (!seq) return PP_result(false, "Aktif sequence yok.");

    var mf = new File(payload.mogrtPath);
    if (!mf.exists) {
      logger.add("HATA: mogrt yok: " + payload.mogrtPath);
      return PP_result(false, "MOGRT dosyasi bulunamadi.");
    }

    var count = payload.count ? Number(payload.count) : 25;
    var vTrack = (payload.videoTrackIndex === undefined || payload.videoTrackIndex === null) ? 0 : payload.videoTrackIndex;
    var gap = payload.gapSeconds ? Number(payload.gapSeconds) : 2;
    var base = payload.startAtSeconds ? Number(payload.startAtSeconds) : 0;

    logger.step(1, "import oncesi proje kok item'lari");
    var before = PP_rootItems();
    logger.add("  kok item sayisi: " + before.length);
    var beforeIds = {};
    for (var b = 0; b < before.length; b++) beforeIds[before[b].nodeId] = true;

    logger.step(2, "referans olcum: importMGT x1");
    var tA = new Date().getTime();
    var seedClip = null;
    try {
      seedClip = seq.importMGT(mf.fsName, PP_secondsToTicks(base), vTrack, 0);
    } catch (eImp) {
      logger.add("  importMGT HATA: " + eImp);
    }
    var importMs = new Date().getTime() - tA;
    logger.add("  importMGT tek klip = " + importMs + " ms, clip=" + PP_typeName(seedClip));
    if (!seedClip) return PP_result(false, "importMGT klip dondurmedi.");

    logger.step(3, "import sonrasi yeni kok item'lar");
    var after = PP_rootItems();
    logger.add("  kok item sayisi: " + after.length + " (fark " + (after.length - before.length) + ")");

    var newItems = [];
    for (var a = 0; a < after.length; a++) {
      if (!beforeIds[after[a].nodeId]) {
        newItems.push(after[a]);
        logger.add("  YENI item: \"" + after[a].name + "\" type=" + after[a].type + " nodeId=" + after[a].nodeId);
      }
    }

    logger.step(4, "yerlesen klibin projectItem'i");
    var seedItem = null;
    try {
      seedItem = seedClip.projectItem;
      logger.add("  clip.projectItem = " + PP_typeName(seedItem));
      if (seedItem) {
        logger.add("  adi: " + seedItem.name);
        PP_dumpInto(logger, "seed projectItem", seedItem);
      }
    } catch (ePi) {
      logger.add("  clip.projectItem HATA: " + ePi);
    }

    if (!seedItem && newItems.length) {
      seedItem = newItems[0].item;
      logger.add("  clip.projectItem yok - yeni kok item kullanilacak: " + newItems[0].name);
    }

    if (!seedItem) {
      logger.add("SONUC: MOGRT projeye item olarak dusmuyor. Hizli yol YOK.");
      logger.add("Bu durumda tek secenek importMGT (427 ms/klip) veya klasik altyazi.");
      return PP_result(false, "MOGRT icin projectItem bulunamadi - hizli yol yok. Log: " + payload.logPath);
    }

    logger.step(5, "hedef track yuzeyi (insertClip / overwriteClip var mi)");
    var track = null;
    try {
      track = seq.videoTracks[vTrack];
      PP_dumpInto(logger, "videoTrack[" + vTrack + "]", track);
    } catch (eTr) {
      logger.add("  track alinamadi: " + eTr);
      return PP_result(false, "Hedef track alinamadi.");
    }

    logger.step(6, "overwriteClip ile " + count + " klip - OLCUM");
    var overMs = [];
    var overOk = 0;
    var overFail = 0;
    var firstOverError = "";

    for (var i = 0; i < count; i++) {
      var at = base + gap + (i * gap);
      var t0 = new Date().getTime();
      var placed = false;
      try {
        track.overwriteClip(seedItem, PP_secondsToTicks(at));
        placed = true;
      } catch (eO1) {
        if (!firstOverError) firstOverError = "ticks: " + eO1;
        try {
          track.overwriteClip(seedItem, at);
          placed = true;
        } catch (eO2) {
          if (firstOverError.indexOf("saniye") < 0) firstOverError += " | saniye: " + eO2;
        }
      }
      overMs.push(new Date().getTime() - t0);
      if (placed) overOk++; else overFail++;
    }

    if (firstOverError) logger.add("  ilk overwriteClip hatasi -> " + firstOverError);

    var overMedian = PP_median(overMs);
    logger.add("  yerlesen=" + overOk + " basarisiz=" + overFail);
    logger.add("  medyan=" + overMedian + " ms/klip");

    logger.step(7, "KARSILASTIRMA");
    logger.add("  importMGT      : " + importMs + " ms/klip");
    logger.add("  overwriteClip  : " + overMedian + " ms/klip");
    if (overOk > 0 && overMedian > 0) {
      logger.add("  kazanc: " + Math.round(importMs / overMedian) + "x");
      logger.add("  --- overwriteClip ile tahminler ---");
      logger.add("   350 klip = " + Math.round(overMedian * 350 / 1000) + " sn");
      logger.add("   600 klip = " + Math.round(overMedian * 600 / 1000) + " sn");
      logger.add("  1400 klip = " + Math.round(overMedian * 1400 / 1000) + " sn");
    }

    logger.step(8, "KOPYA KLIPLERIN MGT PARAMETRELERI BAGIMSIZ MI?");
    logger.add("  KRITIK: kopyalar ayni project item'dan geldigi icin metinleri");
    logger.add("  birbirine bagli olabilir. Bagliysa hizli yol ise yaramaz.");
    try {
      var clips = track.clips;
      logger.add("  track.clips.numItems=" + clips.numItems);
      var tested = 0;
      for (var c = 0; c < clips.numItems && tested < 2; c++) {
        var cl = clips[c];
        var comp = null;
        try { comp = (typeof cl.getMGTComponent === "function") ? cl.getMGTComponent() : null; } catch (eG) {}
        if (!comp) continue;
        tested++;
        logger.add("  klip[" + c + "] MGT component VAR, parametre sayisi=" + comp.properties.numItems);
        for (var pi = 0; pi < comp.properties.numItems; pi++) {
          var dn = "?";
          try { dn = comp.properties[pi].displayName; } catch (eD) {}
          logger.add("     [" + pi + "] " + dn);
        }
      }
      if (tested === 0) {
        logger.add("  >>> Hicbir klipte getMGTComponent yok. Probe 2'deki hatanin ayni sebebi.");
      }
    } catch (eC) {
      logger.add("  klip taramasi HATA: " + eC);
    }

    logger.step(9, "BITTI - test klipleri timeline'da BIRAKILDI. Ctrl+Z.");

    var extra = '{"importMs":' + importMs + ',"overwriteMedianMs":' + overMedian
      + ',"placed":' + overOk + ',"failed":' + overFail + "}";
    return PP_result(true, "importMGT " + importMs + " ms vs overwriteClip " + overMedian + " ms (" + overOk + "/" + count + ").", extra);
  } catch (e) {
    logger.add("KRITIK HATA: " + e);
    return PP_result(false, "Hizli yol probe'u hata verdi: " + e);
  }
}

/* ------------------------------------------------------------------ */
/* PROBE 6 - SABLON KARSILASTIRMA: AE (aefx) vs Premiere (ppro)        */
/*                                                                     */
/* Probe 2'de getMGTComponent() null dondu. Sebep bulundu: denenen     */
/* sablon Premiere'de yazilmis (definition.json -> authorApp:"ppro"),  */
/* timeline'a duz Premiere grafigi olarak aciliyor, Essential Graphics */
/* parametresi tasimiyor. AE'de yazilmis olanda (authorApp:"aefx")     */
/* clientControls[] gercek parametre listesi ve font duzenleme var.    */
/*                                                                     */
/* Bu probe her sablon icin: import suresi + getMGTComponent + tam     */
/* parametre dokumu + metin yazma testi.                               */
/* ------------------------------------------------------------------ */

function PP_probeTemplates(payloadJson) {
  var payload = PP_parseJson(payloadJson) || {};
  var logger = new PP_Logger(payload.logPath);

  try {
    logger.add("=== PROBE 6: SABLON KARSILASTIRMA ===");
    logger.add("Zaman: " + new Date().toString());

    var seq = PP_activeSequence(logger);
    if (!seq) return PP_result(false, "Aktif sequence yok.");

    var paths = payload.paths || [];
    if (!paths.length) return PP_result(false, "Sablon listesi bos.");

    var vTrack = (payload.videoTrackIndex === undefined || payload.videoTrackIndex === null) ? 0 : payload.videoTrackIndex;
    var speedRuns = payload.speedRuns ? Number(payload.speedRuns) : 5;
    var cursor = payload.startAtSeconds ? Number(payload.startAtSeconds) : 0;
    var gap = payload.gapSeconds ? Number(payload.gapSeconds) : 4;

    var summary = [];

    for (var t = 0; t < paths.length; t++) {
      var p = paths[t];
      logger.add("");
      logger.add("################################################");
      logger.add("# SABLON " + (t + 1) + "/" + paths.length);
      logger.add("# " + p);
      logger.add("################################################");

      var mf = new File(p);
      if (!mf.exists) {
        logger.add("  ATLANDI: dosya yok.");
        summary.push({ path: p, ok: false, note: "dosya yok" });
        continue;
      }

      /* --- hiz --- */
      logger.step(1, "hiz olcumu (" + speedRuns + " import)");
      var times = [];
      var firstClip = null;
      for (var r = 0; r < speedRuns; r++) {
        var at = cursor;
        cursor += gap;
        var t0 = new Date().getTime();
        var c = null;
        try {
          c = seq.importMGT(mf.fsName, PP_secondsToTicks(at), vTrack, 0);
        } catch (eI) {
          if (r === 0) logger.add("  import HATA: " + eI);
        }
        times.push(new Date().getTime() - t0);
        if (!firstClip && c) firstClip = c;
      }
      var med = PP_median(times);
      logger.add("  medyan=" + med + " ms/klip  (tum olcumler: " + times.join(", ") + ")");
      logger.add("  tahmin  350 klip = " + Math.round(med * 350 / 1000) + " sn");
      logger.add("  tahmin 1400 klip = " + Math.round(med * 1400 / 1000) + " sn");

      if (!firstClip) {
        logger.add("  klip donmedi, parametre testi atlandi.");
        summary.push({ path: p, ok: false, note: "import basarisiz", medianMs: med });
        continue;
      }

      /* --- MGT component --- */
      logger.step(2, "isMGT() / getMGTComponent()");
      var isMgt = "?";
      try { isMgt = String(firstClip.isMGT()); } catch (eM) { isMgt = "<isMGT HATA>"; }
      logger.add("  isMGT()=" + isMgt);
      logger.add("  klip adi=" + firstClip.name);

      var comp = null;
      try { comp = firstClip.getMGTComponent(); } catch (eG) { logger.add("  getMGTComponent HATA: " + eG); }
      logger.add("  getMGTComponent -> " + PP_typeName(comp));

      if (!comp) {
        logger.add("  >>> Essential Graphics parametresi YOK. Bu sablon plugin icin kullanilamaz.");
        summary.push({ path: p, ok: false, note: "getMGTComponent null", medianMs: med, isMGT: isMgt });
        continue;
      }

      /* --- parametreler --- */
      logger.step(3, "PARAMETRE DOKUMU");
      var count = 0;
      var textIdx = -1;
      try {
        count = comp.properties.numItems;
        logger.add("  parametre sayisi=" + count);
        for (var i = 0; i < count; i++) {
          var pr = comp.properties[i];
          var dn = "?", vv = "?";
          try { dn = pr.displayName; } catch (eD) {}
          try { vv = String(pr.getValue()); } catch (eV) { vv = "<getValue HATA>"; }
          if (vv && vv.length > 200) vv = vv.substring(0, 200) + " ...[kisaltildi]";
          logger.add("  [" + i + "] \"" + dn + "\" = " + vv);
          if (textIdx < 0) {
            var low = String(dn).toLowerCase();
            if (low === "text" || low === "metin" || low.indexOf("source text") >= 0) textIdx = i;
          }
        }
        if (count > 0) PP_dumpInto(logger, "properties[0]", comp.properties[0]);
      } catch (eP) {
        logger.add("  parametre okuma HATA: " + eP);
      }

      /* --- metin yazma --- */
      logger.step(4, "METIN YAZMA TESTI (index=" + textIdx + ")");
      var writeOk = false;
      if (textIdx >= 0) {
        var testText = "ODIUM ÇĞİÖŞÜ test";
        try {
          comp.properties[textIdx].setValue(testText, true);
          var back = "?";
          try { back = String(comp.properties[textIdx].getValue()); } catch (eB) { back = "<geri okunamadi>"; }
          if (back.length > 200) back = back.substring(0, 200) + " ...";
          logger.add("  yazilan : " + testText);
          logger.add("  okunan  : " + back);
          writeOk = (back.indexOf("ODIUM") >= 0);
          logger.add("  SONUC: " + (writeOk ? "METIN YAZILIYOR" : "yazma dogrulanamadi - degeri elle kontrol et"));
        } catch (eS) {
          logger.add("  setValue HATA: " + eS);
        }
      } else {
        logger.add("  metin parametresi isimle bulunamadi.");
      }

      summary.push({
        path: p, ok: true, medianMs: med, isMGT: isMgt,
        paramCount: count, textIndex: textIdx, textWrite: writeOk
      });
    }

    /* --- ozet --- */
    logger.add("");
    logger.add("================ OZET ================");
    var extraParts = [];
    for (var s = 0; s < summary.length; s++) {
      var it = summary[s];
      var nameOnly = String(it.path);
      var slash = nameOnly.lastIndexOf("\\");
      if (slash < 0) slash = nameOnly.lastIndexOf("/");
      if (slash >= 0) nameOnly = nameOnly.substring(slash + 1);

      logger.add(nameOnly);
      logger.add("   medyan=" + (it.medianMs === undefined ? "-" : it.medianMs) + " ms"
        + " | MGT param=" + (it.ok ? it.paramCount : "YOK")
        + " | metin yazildi=" + (it.textWrite ? "EVET" : "hayir")
        + (it.note ? " | " + it.note : ""));

      extraParts.push('{"name":"' + PP_escapeJsonString(nameOnly) + '"'
        + ',"medianMs":' + (it.medianMs === undefined ? 0 : it.medianMs)
        + ',"paramCount":' + (it.paramCount === undefined ? 0 : it.paramCount)
        + ',"textWrite":' + (it.textWrite ? "true" : "false") + "}");
    }
    logger.add("BITTI - test klipleri timeline'da BIRAKILDI. Ctrl+Z.");

    return PP_result(true, paths.length + " sablon olculdu. Log: " + (payload.logPath || ""),
      '{"templates":[' + extraParts.join(",") + "]}");
  } catch (e) {
    logger.add("KRITIK HATA: " + e);
    return PP_result(false, "Sablon probe'u hata verdi: " + e);
  }
}

/* ------------------------------------------------------------------ */
/* PROBE 7 - KLIP MEKANIGI PROVASI (M3'un cekirdegi)                   */
/*                                                                     */
/* Probe 6'da index 0 ("Text") string kabul edip geri verdi ama ekranda*/
/* yazi degismedi -> o parametre grup basligi. Gercek metin type-6     */
/* parametrelerin ("Title"/"Subtitle") JSON blob degerinin icinde.     */
/*                                                                     */
/* Bu probe hicbir sey varsaymaz:                                      */
/*   1) her parametrenin TAM degerini kirpmadan doker (sema gorulsun)  */
/*   2) her parametreye duz string yazmayi dener, geri okur, DEGISTI mi*/
/*      diye karsilastirir                                             */
/*   3) klip suresini degistirmeyi dener (obek suresi icin sart)       */
/*   4) Motion Position/Scale yazmayi dener (konum/boyut karari 9b)    */
/* ------------------------------------------------------------------ */

function PP_probeMechanics(payloadJson) {
  var payload = PP_parseJson(payloadJson) || {};
  var logger = new PP_Logger(payload.logPath);

  try {
    logger.add("=== PROBE 7: KLIP MEKANIGI PROVASI ===");
    logger.add("Zaman: " + new Date().toString());
    logger.add("native JSON var mi: " + PP_hasNativeJSON());
    logger.add("mogrt: " + payload.mogrtPath);

    var seq = PP_activeSequence(logger);
    if (!seq) return PP_result(false, "Aktif sequence yok.");

    var mf = new File(payload.mogrtPath);
    if (!mf.exists) return PP_result(false, "MOGRT bulunamadi: " + payload.mogrtPath);

    var vTrack = (payload.videoTrackIndex === undefined || payload.videoTrackIndex === null) ? 0 : payload.videoTrackIndex;
    var at = payload.atSeconds ? Number(payload.atSeconds) : 0;
    var wantSeconds = payload.durationSeconds ? Number(payload.durationSeconds) : 1.4;
    var testText = payload.testText || "ODIUM ÇĞİÖŞÜ 123";

    logger.step(1, "importMGT");
    var clip = null;
    try {
      clip = seq.importMGT(mf.fsName, PP_secondsToTicks(at), vTrack, 0);
    } catch (eI) {
      logger.add("  HATA: " + eI);
    }
    if (!clip) return PP_result(false, "importMGT klip dondurmedi.");
    logger.add("  klip adi=" + clip.name + " isMGT=" + clip.isMGT());

    var comp = null;
    try { comp = clip.getMGTComponent(); } catch (eG) {}
    if (!comp) return PP_result(false, "getMGTComponent null - AE sablonu kullan.");

    var count = comp.properties.numItems;
    logger.add("  parametre sayisi=" + count);

    /* --- 2. TAM DEGER DOKUMU (kirpma yok) --- */
    logger.step(2, "TAM DEGER DOKUMU - kirpma yok");
    var names = [];
    for (var i = 0; i < count; i++) {
      var dn = "?", vv = "<okunamadi>";
      try { dn = String(comp.properties[i].displayName); } catch (eD) {}
      try { vv = String(comp.properties[i].getValue()); } catch (eV) { vv = "<getValue HATA: " + eV + ">"; }
      names.push(dn);
      logger.add("");
      logger.add("  ----- [" + i + "] \"" + dn + "\" -----");
      logger.add("  " + vv);
    }

    /* --- 3. HER PARAMETREYE YAZMA DENEMESI --- */
    logger.step(3, "YAZMA TESTI - her parametreye duz string, oncesi/sonrasi karsilastirma");
    logger.add("  yazilacak metin: " + testText);
    var changed = [];

    for (var w = 0; w < count; w++) {
      var before = null, after = null;
      try { before = String(comp.properties[w].getValue()); } catch (eB) { before = null; }
      if (before === null) {
        logger.add("  [" + w + "] \"" + names[w] + "\" okunamadi, atlandi.");
        continue;
      }

      var threw = "";
      try {
        comp.properties[w].setValue(testText, true);
      } catch (eS) {
        threw = String(eS);
      }
      try { after = String(comp.properties[w].getValue()); } catch (eA) { after = null; }

      var didChange = (after !== null && after !== before);
      var carriesText = (after !== null && after.indexOf("ODIUM") >= 0);

      logger.add("  [" + w + "] \"" + names[w] + "\""
        + " degisti=" + (didChange ? "EVET" : "hayir")
        + " metin-icinde=" + (carriesText ? "EVET" : "hayir")
        + (threw ? " HATA=" + threw : ""));

      if (didChange) {
        changed.push(w);
        logger.add("      oncesi: " + (before.length > 300 ? before.substring(0, 300) + " ..." : before));
        logger.add("      sonrasi: " + (after.length > 300 ? after.substring(0, 300) + " ..." : after));
      }
    }

    logger.add("");
    logger.add("  >>> DEGISEN PARAMETRE INDEXLERI: " + (changed.length ? changed.join(", ") : "HICBIRI"));
    logger.add("  >>> Premiere'de klibe bak: yazi gercekten degisti mi? Program Monitor'e bak.");

    /* --- 4. SURE DEGISTIRME --- */
    logger.step(4, "SURE DEGISTIRME (obek suresi icin sart)");
    try {
      var startS = clip.start.seconds;
      var endS = clip.end.seconds;
      logger.add("  oncesi: start=" + startS + " end=" + endS + " sure=" + (endS - startS));

      var targetEndTicks = PP_secondsToTicks(startS + wantSeconds);
      logger.add("  hedef end=" + (startS + wantSeconds) + "s (tick " + targetEndTicks + ")");

      var setWorked = false;

      // A) Time nesnesi uzerinden ticks yazma
      try {
        var tObj = clip.end;
        tObj.ticks = targetEndTicks;
        clip.end = tObj;
        setWorked = true;
        logger.add("  A) clip.end.ticks + atama denendi.");
      } catch (eA1) {
        logger.add("  A) HATA: " + eA1);
      }

      var nowEnd = "?";
      try { nowEnd = clip.end.seconds; } catch (eN) {}
      logger.add("  sonrasi: end=" + nowEnd + " (hedef " + (startS + wantSeconds) + ")");

      if (String(nowEnd) === String(endS)) {
        logger.add("  >>> SURE DEGISMEDI. QE tarafi denenecek (qe trackItem.setEndPosition / move).");
        try {
          app.enableQE();
          var qseq = qe.project.getActiveSequence();
          var qtr = qseq.getVideoTrackAt(vTrack);
          logger.add("  qe track numItems=" + qtr.numItems);
          logger.add("  qe trackItem metodlari: " + PP_reflectList(qtr.getItemAt(0), "methods").join(" | "));
        } catch (eQ) {
          logger.add("  QE dokumu HATA: " + eQ);
        }
      } else {
        logger.add("  >>> SURE DEGISTI. Yol A calisiyor.");
      }
    } catch (eDur) {
      logger.add("  sure testi HATA: " + eDur);
    }

    /* --- 5. MOTION: konum ve boyut --- */
    logger.step(5, "MOTION Position / Scale yazma (karar 9b)");
    try {
      var comps = clip.components;
      var motion = null;
      for (var mc = 0; mc < comps.numItems; mc++) {
        var nm2 = "";
        try { nm2 = String(comps[mc].displayName); } catch (eN2) {}
        if (nm2 === "Motion") { motion = comps[mc]; break; }
      }
      if (!motion) {
        logger.add("  Motion component bulunamadi.");
      } else {
        var mCount = motion.properties.numItems;
        for (var mp = 0; mp < mCount; mp++) {
          var mdn = "?";
          try { mdn = String(motion.properties[mp].displayName); } catch (eMd) {}
          if (mdn === "Position" || mdn === "Scale") {
            var mBefore = "?";
            try { mBefore = String(motion.properties[mp].getValue()); } catch (eMb) {}
            var newVal = (mdn === "Scale") ? 60 : [0.5, 0.82];
            var mThrew = "";
            try {
              motion.properties[mp].setValue(newVal, true);
            } catch (eMs) {
              mThrew = String(eMs);
            }
            var mAfter = "?";
            try { mAfter = String(motion.properties[mp].getValue()); } catch (eMa) {}
            logger.add("  " + mdn + ": oncesi=" + mBefore + " -> sonrasi=" + mAfter
              + (mThrew ? "  HATA=" + mThrew : "")
              + "  degisti=" + (mAfter !== mBefore ? "EVET" : "hayir"));
          }
        }
      }
    } catch (eMot) {
      logger.add("  Motion testi HATA: " + eMot);
    }

    logger.step(6, "BITTI - klip timeline'da BIRAKILDI. Program Monitor'de yaziya bak, sonra Ctrl+Z.");

    return PP_result(true, "Mekanik provasi bitti. Degisen parametre: "
      + (changed.length ? changed.join(",") : "yok") + ". Log: " + (payload.logPath || ""),
      '{"paramCount":' + count + ',"changedCount":' + changed.length + "}");
  } catch (e) {
    logger.add("KRITIK HATA: " + e);
    return PP_result(false, "Mekanik probe hata verdi: " + e);
  }
}

/* ------------------------------------------------------------------ */
/* PROBE 4 - QE DOM: track ekleme / adlandirma / klip silme            */
/* ------------------------------------------------------------------ */

function PP_probeQE(payloadJson) {
  var payload = PP_parseJson(payloadJson) || {};
  var logger = new PP_Logger(payload.logPath);
  var trackName = payload.trackName || "ODIUM SUBS";

  try {
    logger.add("=== PROBE 4: QE DOM ===");
    logger.add("Zaman: " + new Date().toString());
    logger.add("hedef track adi: " + trackName);

    logger.step(1, "app.enableQE()");
    try {
      app.enableQE();
      logger.add("  enableQE cagrildi. typeof qe = " + (typeof qe));
    } catch (eQE) {
      logger.add("  enableQE HATA: " + eQE);
      return PP_result(false, "QE DOM acilamadi: " + eQE);
    }

    if (typeof qe === "undefined" || !qe) {
      logger.add("HATA: qe tanimsiz.");
      return PP_result(false, "qe tanimsiz - QE DOM bu surumde yok.");
    }

    logger.step(2, "qe.project yuzeyi");
    PP_dumpInto(logger, "qe.project", qe.project);

    logger.step(3, "qe aktif sequence");
    var qseq = null;
    try {
      qseq = qe.project.getActiveSequence();
      logger.add("  qseq=" + PP_typeName(qseq));
    } catch (eS) {
      logger.add("  getActiveSequence HATA: " + eS);
      return PP_result(false, "qe.project.getActiveSequence basarisiz.");
    }
    if (!qseq) return PP_result(false, "Aktif sequence yok (QE).");

    PP_dumpInto(logger, "qe sequence", qseq);

    logger.step(4, "mevcut video track'leri ve adlari");
    var beforeCount = 0;
    try {
      beforeCount = qseq.numVideoTracks;
      logger.add("  numVideoTracks=" + beforeCount);
      for (var i = 0; i < beforeCount; i++) {
        var qt = qseq.getVideoTrackAt(i);
        var nm = "?";
        try { nm = qt.name; } catch (eN) {}
        var items = "?";
        try { items = qt.numItems; } catch (eIt) {}
        logger.add("    V" + (i + 1) + " name=\"" + nm + "\" numItems=" + items);
        if (i === 0) {
          PP_dumpInto(logger, "qe videoTrack[0]", qt);
        }
      }
    } catch (eTr) {
      logger.add("  track listeleme HATA: " + eTr);
    }

    logger.step(5, "addTracks denemesi (1 video track)");
    var addOk = false;
    try {
      // Yaygin imza: addTracks(numV, videoIndex, numA, audioIndex, numSubmix, submixIndex)
      qseq.addTracks(1, beforeCount, 0, 0, 0, 0);
      addOk = true;
      logger.add("  addTracks(1, " + beforeCount + ", 0, 0, 0, 0) calisti.");
    } catch (eAdd1) {
      logger.add("  6 argumanli varyant HATA: " + eAdd1);
      try {
        qseq.addTracks(1, beforeCount, 0, 0);
        addOk = true;
        logger.add("  addTracks(1, " + beforeCount + ", 0, 0) calisti.");
      } catch (eAdd2) {
        logger.add("  4 argumanli varyant HATA: " + eAdd2);
        try {
          qseq.addTracks(1);
          addOk = true;
          logger.add("  addTracks(1) calisti.");
        } catch (eAdd3) {
          logger.add("  1 argumanli varyant HATA: " + eAdd3);
        }
      }
    }

    var afterCount = beforeCount;
    try { afterCount = qseq.numVideoTracks; } catch (eAC) {}
    logger.add("  track sayisi: " + beforeCount + " -> " + afterCount + " (eklendi=" + (afterCount - beforeCount) + ")");

    logger.step(6, "yeni track'i adlandirma denemesi");
    var namedOk = false;
    if (afterCount > beforeCount) {
      try {
        var newTrack = qseq.getVideoTrackAt(afterCount - 1);
        if (typeof newTrack.setName === "function") {
          newTrack.setName(trackName);
          namedOk = true;
          logger.add("  setName(\"" + trackName + "\") cagrildi.");
          var readBack = "?";
          try { readBack = qseq.getVideoTrackAt(afterCount - 1).name; } catch (eRb) {}
          logger.add("  geri okunan ad: \"" + readBack + "\"");
        } else {
          logger.add("  setName YOK. Track adlandirma baska yolla yapilmali.");
        }
      } catch (eNm) {
        logger.add("  setName HATA: " + eNm);
      }
    } else {
      logger.add("  yeni track olusmadi, adlandirma atlandi.");
    }

    logger.step(7, "klip silme yuzeyi (SILME YAPILMIYOR - sadece dokum)");
    try {
      for (var k = 0; k < afterCount; k++) {
        var qtk = qseq.getVideoTrackAt(k);
        var kn = "?";
        try { kn = qtk.name; } catch (eKn) {}
        var kItems = 0;
        try { kItems = qtk.numItems; } catch (eKi) {}
        if (kItems > 0) {
          logger.add("  V" + (k + 1) + " \"" + kn + "\" ilk klibin yuzeyi:");
          var item = qtk.getItemAt(0);
          PP_dumpInto(logger, "    qe trackItem", item);
          break;
        }
      }
    } catch (eDel) {
      logger.add("  klip yuzeyi HATA: " + eDel);
    }

    logger.step(8, "BITTI - eklenen track timeline'da BIRAKILDI. Ctrl+Z ile geri al.");

    var extra = '{"addOk":' + (addOk ? "true" : "false")
      + ',"namedOk":' + (namedOk ? "true" : "false")
      + ',"before":' + beforeCount + ',"after":' + afterCount + "}";
    return PP_result(true, "QE probe tamamlandi. Track " + beforeCount + " -> " + afterCount, extra);
  } catch (e) {
    logger.add("KRITIK HATA: " + e);
    return PP_result(false, "QE probe hata verdi: " + e);
  }
}
