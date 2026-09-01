/*
  Odium Subs - kelime dizisini altyazi obeklerine boler.

  MIMARI KURALI: bu dosya saf Node. CSInterface, cep.fs, evalScript BURAYA GIRMEZ.
  Girdi de cikti da duz veri; Premiere'den, Whisper'dan, dosyadan bagimsiz.

  Girdi : [{ word, start, end }]  - saniye cinsinden, kaynak medyaya gore
  Cikti : [{ index, start, end, text, words, lines }]

  Iki mod (karar 7):
    "chunk"   - obek: maks 5 kelime / 2.5 sn, noktalamada ve duraklamada kes
    "classic" - klasik: maks 2 satir x 42 karakter, 1-6 sn
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.OdiumChunker = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var PRESETS = {
    chunk: {
      maxWords: 5,
      maxDuration: 2.5,
      minDuration: 0.6,
      pauseBreak: 0.4,      // kelimeler arasi bu kadar bosluk varsa kes (nefes/duraklama)
      gapMerge: 0.3,        // obekler arasi bu kadar kucuk bosluk varsa oncekini uzat (titreme olmasin)
      breakOnPunctuation: true,
      /*
        Kelime sayisi tek basina tasmayi engellemiyor: Turkce kelimeler uzun,
        5 kelime 45 karakteri bulabiliyor ve 1080p'de kadraji asiyor.
        32 karakter, Montserrat Bold ~90 punto ile tek satirda rahat siginin
        ust siniri (32 x 0.55 x 90 = 1584 px < 1720 px guvenli alan).
      */
      maxCharsPerLine: 32,
      maxLines: 1
    },
    classic: {
      maxWords: 0,          // 0 = kelime siniri yok
      maxDuration: 6,
      minDuration: 1,
      pauseBreak: 0.8,
      gapMerge: 0.2,
      breakOnPunctuation: true,
      maxCharsPerLine: 42,
      maxLines: 2
    }
  };

  // Cumle sonu sayilan isaretler. Turkce'de "..." ve tirnak sonrasi da kesilmeli.
  var HARD_PUNCT = /[.!?…]["'»”’)]*\s*$/;
  var SOFT_PUNCT = /[,;:]["'»”’)]*\s*$/;

  function clone(obj) {
    var out = {};
    for (var k in obj) if (obj.hasOwnProperty(k)) out[k] = obj[k];
    return out;
  }

  function buildOptions(options) {
    options = options || {};
    var mode = options.mode === "classic" ? "classic" : "chunk";
    var base = clone(PRESETS[mode]);

    for (var k in options) {
      if (!options.hasOwnProperty(k) || k === "mode") continue;
      var value = options[k];
      if (value === undefined || value === null) continue;

      /*
        Panelde bos birakilan sayi kutusu Number("") -> NaN veriyor. NaN
        atanirsa butun karsilastirmalar false doner: obek bolme kurallari
        sessizce kapanir ve tek dev obek cikar. Sayisal ayarlarda gecersiz
        deger varsayilani ezmez.
      */
      if (typeof base[k] === "number") {
        if (value === "" || !isFinite(Number(value))) continue;
        value = Number(value);
      }

      base[k] = value;
    }

    base.mode = mode;
    return base;
  }

  function isNumeric(value) {
    if (value === null || value === undefined || value === "") return false;
    return isFinite(Number(value));
  }

  /* Bozuk/bos kelimeleri atar, siraya sokar, ters zamanlari duzeltir. */
  function normalizeWords(words) {
    var out = [];
    if (!words || !words.length) return out;

    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w) continue;
      var text = String(w.word === undefined ? w.text : w.word);
      text = text.replace(/^\s+|\s+$/g, "");
      if (!text) continue;

      // Number(null) === 0 - null/undefined/"" once elenmeli, yoksa bozuk
      // kelime 0. saniyeye yapisir.
      if (!isNumeric(w.start)) continue;
      var start = Number(w.start);
      var end = isNumeric(w.end) ? Number(w.end) : start;
      if (end < start) end = start;

      out.push({ word: text, start: start, end: end });
    }

    out.sort(function (a, b) { return a.start - b.start; });
    return out;
  }

  function joinWords(words) {
    var parts = [];
    for (var i = 0; i < words.length; i++) parts.push(words[i].word);
    return parts.join(" ");
  }

  /*
    Metni maks karakter/satir kuralina gore sarar.
    Kelime ortasindan bolmez; tek kelime satiri asiyorsa oldugu gibi birakir.
  */
  function wrapLines(text, maxChars, maxLines) {
    if (!maxChars || maxChars <= 0) return [text];

    var words = text.split(/\s+/);
    var lines = [];
    var current = "";

    for (var i = 0; i < words.length; i++) {
      var candidate = current ? (current + " " + words[i]) : words[i];
      if (current && candidate.length > maxChars) {
        lines.push(current);
        current = words[i];
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);

    // Satir siniri asildiysa kalanlari son satira sikistir - metin kaybolmasin.
    if (maxLines > 0 && lines.length > maxLines) {
      var head = lines.slice(0, maxLines - 1);
      head.push(lines.slice(maxLines - 1).join(" "));
      lines = head;
    }
    return lines;
  }

  function charCount(words) {
    var n = 0;
    for (var i = 0; i < words.length; i++) n += words[i].word.length;
    return n + Math.max(0, words.length - 1); // aradaki bosluklar
  }

  /*
    Yeni kelime mevcut obege sigar mi?
    Sigmiyorsa neden sigmadigini dondurur - test ve hata ayiklama icin.
  */
  function breakReason(current, next, opt) {
    if (!current.length) return null;

    var prev = current[current.length - 1];

    if (opt.pauseBreak > 0 && (next.start - prev.end) > opt.pauseBreak) {
      return "pause";
    }
    if (opt.breakOnPunctuation && HARD_PUNCT.test(prev.word)) {
      return "punctuation";
    }
    if (opt.maxWords > 0 && current.length >= opt.maxWords) {
      return "maxWords";
    }
    if (opt.maxDuration > 0 && (next.end - current[0].start) > opt.maxDuration) {
      return "maxDuration";
    }
    if (opt.maxCharsPerLine > 0 && opt.maxLines > 0) {
      var limit = opt.maxCharsPerLine * opt.maxLines;
      if (charCount(current) + 1 + next.word.length > limit) {
        return "maxChars";
      }
    }
    return null;
  }

  /*
    Yumusak noktalama (virgul) tek basina kesmez ama obek zaten doluysa
    kesmek icin iyi bir yerdir. maxWords'a bir kala virgul varsa kes.
  */
  function shouldBreakSoft(current, opt) {
    if (!opt.breakOnPunctuation || !current.length) return false;
    if (opt.maxWords <= 0) return false;
    if (current.length < opt.maxWords - 1) return false;
    return SOFT_PUNCT.test(current[current.length - 1].word);
  }

  function chunkWords(words, options) {
    var opt = buildOptions(options);
    var list = normalizeWords(words);
    if (!list.length) return [];

    var groups = [];
    var current = [];

    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      var reason = breakReason(current, w, opt);

      if (!reason && shouldBreakSoft(current, opt)) {
        reason = "softPunctuation";
      }

      if (reason) {
        groups.push({ words: current, breakReason: reason });
        current = [];
      }
      current.push(w);
    }
    if (current.length) groups.push({ words: current, breakReason: "end" });

    /* --- cue'lara cevir --- */
    var cues = [];
    for (var g = 0; g < groups.length; g++) {
      var gw = groups[g].words;
      var text = joinWords(gw);
      cues.push({
        index: g,
        start: gw[0].start,
        end: gw[gw.length - 1].end,
        text: text,
        words: gw,
        lines: wrapLines(text, opt.maxCharsPerLine, opt.maxLines),
        breakReason: groups[g].breakReason
      });
    }

    applyTiming(cues, opt);
    return cues;
  }

  /*
    Zamanlama duzeltmeleri:
      1) minDuration - cok kisa obek goz kirpmasi gibi olur, uzat
      2) gapMerge    - obekler arasi kucuk bosluk titreme yapar, oncekini uzat
      3) cakisma     - hicbir obek bir sonrakinin uzerine binmesin
    Sirasi onemli: once uzat, sonra cakismayi kirp.
  */
  function applyTiming(cues, opt) {
    for (var i = 0; i < cues.length; i++) {
      var cue = cues[i];
      var next = cues[i + 1];
      var limit = next ? next.start : Infinity;

      if (opt.minDuration > 0 && (cue.end - cue.start) < opt.minDuration) {
        cue.end = Math.min(cue.start + opt.minDuration, limit);
      }

      if (next && opt.gapMerge > 0) {
        var gap = next.start - cue.end;
        if (gap > 0 && gap <= opt.gapMerge) {
          cue.end = next.start;
        }
      }

      if (next && cue.end > next.start) {
        cue.end = next.start;
      }
      if (cue.end < cue.start) {
        cue.end = cue.start;
      }
    }
  }

  /*
    Kaynak zamanini sequence zamanina cevirir ve klip disinda kalanlari atar.
    Formul (karar 5b, Probe 1'de dogrulandi):
        seqTime = clip.start + (sourceTime - clip.inPoint) / speed

    speed klibin hiz orani (1 = normal, 2 = iki kat hizli). Hizi degistirilmis
    klipte kaynak saniyesi sequence'de daha kisa yer kapliyor; boleni atlarsak
    obekler klip ilerledikce artan bir hatayla kayiyor.

    Ters cevrilmis klipte (reversed) esleme guvenilir degil - obek atilmasi
    yerine hicbir sey basilmiyor, cagiran taraf kullaniciyi uyarabilsin diye.

    occurrence: { start, inPoint, outPoint, speed, reversed }  - saniye
  */
  function mapToSequence(cues, occurrence) {
    var out = [];
    if (!occurrence) return out;
    if (occurrence.reversed) return out;

    var speed = Number(occurrence.speed);
    if (!isFinite(speed) || speed <= 0) speed = 1;

    for (var i = 0; i < cues.length; i++) {
      var c = cues[i];
      // Klip penceresiyle kesisim
      var s = Math.max(c.start, occurrence.inPoint);
      var e = Math.min(c.end, occurrence.outPoint);
      if (e <= s) continue; // tamamen kesilmis

      var mapped = clone(c);
      mapped.sourceStart = c.start;
      mapped.sourceEnd = c.end;
      mapped.start = occurrence.start + (s - occurrence.inPoint) / speed;
      mapped.end = occurrence.start + (e - occurrence.inPoint) / speed;
      mapped.clipped = (s !== c.start || e !== c.end);
      out.push(mapped);
    }

    for (var k = 0; k < out.length; k++) out[k].index = k;
    return out;
  }

  return {
    PRESETS: PRESETS,
    chunkWords: chunkWords,
    mapToSequence: mapToSequence,
    normalizeWords: normalizeWords,
    wrapLines: wrapLines,
    buildOptions: buildOptions
  };
});
