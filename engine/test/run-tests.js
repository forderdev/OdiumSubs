/*
  engine/ testleri. Bagimlilik yok, Premiere yok:
      node engine/test/run-tests.js

  Amac: obekleme ve SRT mantigini Premiere'e hic dokunmadan dogrulamak.
  Probe 1'den gelen GERCEK klip degerleri esleme testinde kullaniliyor.
*/
"use strict";

var chunker = require("../chunker.js");
var srt = require("../srt.js");
var whisper = require("../whisper.js");
var audio = require("../audio.js");
var installer = require("../installer.js");
var fonts = require("../fonts.js");
var pipeline = require("../pipeline.js");
var hostbox = require("./host-sandbox.js");

var passed = 0;
var failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log("  ok   " + name);
  } else {
    failed++;
    console.log("  FAIL " + name + (detail ? "  -> " + detail : ""));
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, "beklenen " + JSON.stringify(expected) + ", gelen " + JSON.stringify(actual));
}

function near(name, actual, expected, tol) {
  tol = tol === undefined ? 0.001 : tol;
  check(name, Math.abs(actual - expected) <= tol, "beklenen ~" + expected + ", gelen " + actual);
}

/* Yardimci: duzenli araliklarla kelime uretir. */
function words(list) {
  return list.map(function (w) {
    return { word: w[0], start: w[1], end: w[2] };
  });
}

/*
  Not: breakReason KAPANAN obege yazilir - "bu obek neden bitti".
  Son obek her zaman "end" tasir.
*/
console.log("\n=== chunker: temel obekleme ===");
{
  var w = words([
    ["bir", 0.0, 0.3], ["iki", 0.3, 0.6], ["uc", 0.6, 0.9],
    ["dort", 0.9, 1.2], ["bes", 1.2, 1.5], ["alti", 1.5, 1.8]
  ]);
  var cues = chunker.chunkWords(w, { mode: "chunk" });
  eq("6 kelime -> 2 obek (maks 5)", cues.length, 2);
  eq("ilk obek 5 kelime", cues[0].words.length, 5);
  eq("ilk obek metni", cues[0].text, "bir iki uc dort bes");
  eq("kesme sebebi maxWords", cues[0].breakReason, "maxWords");
  eq("son obek end", cues[1].breakReason, "end");
}

console.log("\n=== chunker: duraklamada kesme ===");
{
  var w = words([
    ["merhaba", 0.0, 0.5], ["dunya", 0.5, 1.0],
    ["nasilsin", 2.0, 2.5]   // 1.0 sn bosluk > pauseBreak 0.4
  ]);
  var cues = chunker.chunkWords(w, { mode: "chunk" });
  eq("bosluk obegi boler", cues.length, 2);
  eq("kesme sebebi pause", cues[0].breakReason, "pause");
}

console.log("\n=== chunker: noktalamada kesme ===");
{
  var w = words([
    ["gel.", 0.0, 0.3], ["sonra", 0.35, 0.6], ["gel", 0.6, 0.9]
  ]);
  var cues = chunker.chunkWords(w, { mode: "chunk" });
  eq("nokta obegi boler", cues.length, 2);
  eq("kesme sebebi punctuation", cues[0].breakReason, "punctuation");
  eq("ilk obek sadece nokta kelimesi", cues[0].text, "gel.");
}

console.log("\n=== chunker: maks sure ===");
{
  var w = words([
    ["a", 0.0, 0.9], ["b", 0.9, 1.8], ["c", 1.8, 2.7]  // 3. kelime 2.5 sn'yi asiyor
  ]);
  var cues = chunker.chunkWords(w, { mode: "chunk", pauseBreak: 0 });
  eq("sure asiminda boler", cues.length, 2);
  eq("kesme sebebi maxDuration", cues[0].breakReason, "maxDuration");
}

console.log("\n=== chunker: min sure uzatmasi ===");
{
  var w = words([["kisa", 0.0, 0.2]]);
  var cues = chunker.chunkWords(w, { mode: "chunk" });
  near("0.2 sn obek 0.6 sn'ye uzatildi", cues[0].end, 0.6);
}

console.log("\n=== chunker: kucuk bosluk birlestirme ===");
{
  var w = words([
    ["bir", 0.0, 1.0], ["iki", 1.0, 2.0], ["uc", 2.0, 3.0], ["dort", 3.0, 4.0], ["bes", 4.0, 5.0],
    ["alti", 5.2, 6.0]   // 0.2 sn bosluk <= gapMerge 0.3
  ]);
  var cues = chunker.chunkWords(w, { mode: "chunk", maxDuration: 0, pauseBreak: 0 });
  eq("iki obek olustu", cues.length, 2);
  near("onceki obek sonraki basina uzatildi", cues[0].end, cues[1].start);
}

console.log("\n=== chunker: obekler cakismaz ===");
{
  var w = words([
    ["a", 0.0, 0.5], ["b", 0.5, 1.0], ["c", 1.0, 1.5], ["d", 1.5, 2.0], ["e", 2.0, 2.4],
    ["f", 2.4, 2.9], ["g", 2.9, 3.4]
  ]);
  var cues = chunker.chunkWords(w, { mode: "chunk" });
  var overlap = false;
  for (var i = 0; i < cues.length - 1; i++) {
    if (cues[i].end > cues[i + 1].start + 1e-9) overlap = true;
  }
  check("hicbir obek digerinin uzerine binmiyor", !overlap);
}

console.log("\n=== chunker: klasik mod satir sarma ===");
{
  var w = [];
  for (var i = 0; i < 20; i++) {
    w.push(["kelimeler" + i, i * 0.3, i * 0.3 + 0.3]);
  }
  var cues = chunker.chunkWords(words(w), { mode: "classic", pauseBreak: 0 });
  var maxLen = 0;
  var maxLines = 0;
  cues.forEach(function (c) {
    maxLines = Math.max(maxLines, c.lines.length);
    c.lines.forEach(function (l) { maxLen = Math.max(maxLen, l.length); });
  });
  check("satir sayisi 2'yi asmiyor", maxLines <= 2, "gelen " + maxLines);
  check("satir uzunlugu makul (<=52)", maxLen <= 52, "gelen " + maxLen);
}

console.log("\n=== chunker: karakter siniri tasmayi engelliyor ===");
{
  // Uzun Turkce kelimeler: 5 kelime siniri altinda ama karakterde tasiyor.
  var w = words([
    ["muvaffakiyetsizleştiricilerdenmişsinizcesine", 0.0, 0.6],
    ["karşılaştırmalarımızdan", 0.6, 1.2],
    ["bilgisayarlarımızdaki", 1.2, 1.8]
  ]);
  var cues = chunker.chunkWords(w, { mode: "chunk", pauseBreak: 0, maxDuration: 0 });
  check("uzun kelimeler bolundu", cues.length >= 2, "gelen " + cues.length);

  var tooLong = 0;
  cues.forEach(function (c) { if (c.text.length > 60) tooLong++; });
  // Tek kelime sinirdan uzunsa bolunemez; onun disinda kimse 60 karakteri gecmemeli.
  check("tek kelimelik obekler disinda tasma yok", tooLong <= 1, "60+ karakterli obek: " + tooLong);

  var normal = words([
    ["bugün", 0.0, 0.3], ["hava", 0.3, 0.6], ["çok", 0.6, 0.9],
    ["güzel", 0.9, 1.2], ["görünüyor", 1.2, 1.5]
  ]);
  var normalCues = chunker.chunkWords(normal, { mode: "chunk", pauseBreak: 0 });
  eq("normal 5 kelime tek obekte kaldi", normalCues.length, 1);
  check("32 karakter siniri altinda", normalCues[0].text.length <= 32, normalCues[0].text.length + " karakter");
}

console.log("\n=== chunker: bozuk girdi ===");
{
  var cues = chunker.chunkWords([
    { word: "  ", start: 0, end: 1 },
    { word: "iyi", start: 1, end: 0.5 },      // ters zaman
    { word: "kotu", start: NaN, end: 2 },     // gecersiz
    { word: "null", start: null, end: 3 },    // JSON.stringify NaN'i null yapar
    { word: "bos", start: "", end: 4 },       // Number("") === 0 tuzagi
    null
  ], { mode: "chunk" });
  eq("sadece gecerli kelime kaldi", cues.length, 1);
  eq("ters zaman duzeltildi", cues[0].words[0].end >= cues[0].words[0].start, true);
}

console.log("\n=== mapToSequence: Probe 1'in gercek klip degerleri ===");
{
  // Probe 1: start=15.32  inPoint=85.72  outPoint=93.04  (sure 7.32)
  var occ = { start: 15.32, inPoint: 85.72, outPoint: 93.04 };

  var cues = [
    { index: 0, start: 80.00, end: 82.00, text: "kesilmis - once" },
    { index: 1, start: 86.00, end: 87.00, text: "icerde" },
    { index: 2, start: 92.50, end: 95.00, text: "yarim - tasan" },
    { index: 3, start: 98.00, end: 99.00, text: "kesilmis - sonra" }
  ];

  var mapped = chunker.mapToSequence(cues, occ);
  eq("klip disindakiler atildi", mapped.length, 2);
  near("icerdeki obek dogru kaydi", mapped[0].start, 15.32 + (86.00 - 85.72));
  near("icerdeki obek sonu dogru", mapped[0].end, 15.32 + (87.00 - 85.72));
  eq("tasan obek kirpildi", mapped[1].clipped, true);
  near("tasan obek klip sonunda bitti", mapped[1].end, 15.32 + (93.04 - 85.72));
  near("kirpilan son = klip sonu", mapped[1].end, 22.64);
  eq("kaynak zamani saklandi", mapped[0].sourceStart, 86.00);
  eq("index yeniden numaralandi", mapped[1].index, 1);
}

console.log("\n=== srt: zaman bicimi ===");
{
  eq("0 sn", srt.secondsToSrtTime(0), "00:00:00,000");
  eq("75.482 sn", srt.secondsToSrtTime(75.482), "00:01:15,482");
  eq("3600 sn", srt.secondsToSrtTime(3600), "01:00:00,000");
  eq("negatif 0'a sabitlendi", srt.secondsToSrtTime(-5), "00:00:00,000");
  near("geri cevirme", srt.srtTimeToSeconds("00:01:15,482"), 75.482);
  near("nokta ayirici da okunuyor", srt.srtTimeToSeconds("00:00:02.500"), 2.5);
}

console.log("\n=== srt: uretim ve geri okuma ===");
{
  var cues = [
    { start: 1.0, end: 2.5, text: "birinci satır ÇĞİÖŞÜ", lines: ["birinci satır ÇĞİÖŞÜ"] },
    { start: 3.0, end: 4.0, text: "ikinci blok", lines: ["ikinci", "blok"] }
  ];
  var text = srt.toSrt(cues);
  check("numaralandirma 1'den basliyor", text.indexOf("1\r\n00:00:01,000 --> 00:00:02,500") === 0, text.substring(0, 60));
  check("Turkce karakter korundu", text.indexOf("ÇĞİÖŞÜ") > 0);
  check("cok satirli blok korundu", text.indexOf("ikinci\r\nblok") > 0);

  var back = srt.fromSrt(text);
  eq("geri okunan blok sayisi", back.length, 2);
  near("geri okunan baslangic", back[0].start, 1.0);
  eq("geri okunan metin", back[0].text, "birinci satır ÇĞİÖŞÜ");
  eq("cok satirli metin birlestirildi", back[1].text, "ikinci blok");
}

console.log("\n=== srt: offset (sequence zeroPoint) ===");
{
  var cues = [{ start: 0, end: 1, text: "a", lines: ["a"] }];
  var text = srt.toSrt(cues, { offsetSeconds: 3600 });
  check("1 saat offset uygulandi", text.indexOf("01:00:00,000 --> 01:00:01,000") > 0, text);
}

console.log("\n=== srt: bozuk girdi ===");
{
  var back = srt.fromSrt("bu bir srt degil\n\n\n42\nzaman yok\nmetin");
  eq("bozuk bloklar atlandi", back.length, 0);
}

console.log("\n=== whisper: JSON ayristirma ===");
{
  var raw = {
    language: "tr",
    segments: [
      {
        start: 0.0, end: 1.6, text: " Merhaba dünya.",
        words: [
          { word: " Merhaba", start: 0.0, end: 0.8, probability: 0.98 },
          { word: " dünya.", start: 0.8, end: 1.6, probability: 0.91 }
        ]
      },
      {
        start: 2.4, end: 3.1, text: " Nasılsın",
        words: [
          { word: " Nasılsın", start: 2.4, end: 3.1, probability: 0.87 },
          { word: "   ", start: 3.1, end: 3.2 },                 // bos - atilmali
          { word: "bozuk", start: NaN, end: 4.0 }                // gecersiz - atilmali
        ]
      }
    ]
  };

  var parsed = whisper.parseWhisperJson(raw);
  eq("dil okundu", parsed.language, "tr");
  eq("gecerli kelime sayisi", parsed.words.length, 3);
  eq("bastaki bosluk temizlendi", parsed.words[0].word, "Merhaba");
  eq("noktalama korundu", parsed.words[1].word, "dünya.");
  eq("guven degeri tasindi", parsed.words[0].confidence, 0.98);
  eq("segment metni trim'lendi", parsed.segments[0].text, "Merhaba dünya.");
  eq("kelime zamani var", parsed.hasWordTimestamps, true);

  // String girdi de kabul edilmeli
  var fromString = whisper.parseWhisperJson(JSON.stringify(raw));
  eq("string girdi ayristirildi", fromString.words.length, 3);
}

console.log("\n=== whisper: kelime zamani yoksa ===");
{
  var parsed = whisper.parseWhisperJson({
    language: "tr",
    segments: [{ start: 0, end: 2, text: "sadece segment" }]
  });
  eq("hasWordTimestamps false", parsed.hasWordTimestamps, false);
  eq("segment yine de okundu", parsed.segments.length, 1);
}

console.log("\n=== whisper: ilerleme satiri ===");
{
  near("yuzde okundu", whisper.parseProgressLine("  42%|####      | 12/28", null), 0.42);
  eq("alakasiz satir null", whisper.parseProgressLine("Loading model...", 100), null);
  var r = whisper.parseProgressLine("[00:00:50.000 --> 00:00:52.000]  metin", 100);
  near("zaman damgasindan oran", r, 0.5, 0.01);
  near("milisaniyeli damga", whisper.parseProgressLine("[00:01:15.480 --> 00:01:18.200] metin", 150), 0.5032, 0.001);
  near("milisaniyesiz damga da saat:dakika:saniye",
    whisper.parseProgressLine("[00:01:15 --> 00:01:18] metin", 150), 0.5, 0.001);
}

console.log("\n=== whisper: CLI argumanlari ===");
{
  var args = whisper.buildArgs("C:\\ses.wav", "C:\\out", { language: "tr", initialPrompt: "Odium, Kayseri" });
  eq("ilk arguman ses dosyasi", args[0], "C:\\ses.wav");
  check("model verildi", args.indexOf("--model") > 0);
  check("json cikti", args.indexOf("--output_format") > 0 && args.indexOf("json") > 0);
  check("dil verildi", args.indexOf("--language") > 0 && args.indexOf("tr") > 0);
  check("kelime zamani acik", args.indexOf("--word_timestamps") > 0);
  check("vad acik", args.indexOf("--vad_filter") > 0);
  check("ozel sozluk gecti", args.indexOf("Odium, Kayseri") > 0);

  var autoArgs = whisper.buildArgs("a.wav", "out", { language: "auto" });
  eq("auto dilde --language gonderilmiyor", autoArgs.indexOf("--language"), -1);
}

console.log("\n=== ffmpeg: bulma ===");
{
  var found = audio.resolveFfmpeg({});
  check("PATH'te ffmpeg bulundu", !!found, "bulunamadi - kurulu degilse bu normal");
  eq("olmayan yol yok sayildi", audio.resolveFfmpeg({ ffmpegPath: "C:\\yok\\ffmpeg.exe" }) !== "C:\\yok\\ffmpeg.exe", true);
}

console.log("\n=== installer: surum secimi ===");
{
  eq("r245.4 -> 245.004", installer.assetVersion("Faster-Whisper-XXL_r245.4_windows.7z"), 245.004);
  eq("r192.3.1 -> 192.003", installer.assetVersion("Faster-Whisper-XXL_r192.3.1_linux.7z"), 192.003);
  eq("surumsuz -> 0", installer.assetVersion("readme.txt"), 0);

  var assets = [
    { name: "Faster-Whisper-XXL_r192.3.4_windows.7z", browser_download_url: "u1", size: 100 },
    { name: "Faster-Whisper-XXL_r245.4_linux.7z", browser_download_url: "u2", size: 200 },
    { name: "Faster-Whisper-XXL_r245.4_windows.7z", browser_download_url: "u3", size: 300 },
    { name: "Faster-Whisper-XXL_r245.1_windows.7z", browser_download_url: "u4", size: 400 },
    { name: "notlar.txt", browser_download_url: "u5", size: 10 }
  ];
  var picked = installer.pickWindowsAsset(assets);
  eq("en yeni windows varligi secildi", picked.name, "Faster-Whisper-XXL_r245.4_windows.7z");
  eq("dogru url", picked.url, "u3");
  eq("linux elendi", picked.url === "u2", false);

  eq("bos liste null", installer.pickWindowsAsset([]), null);
  eq("sadece linux varsa null", installer.pickWindowsAsset([{ name: "x_r1_linux.7z" }]), null);
}

console.log("\n=== installer: arsiv acici ===");
{
  var tools = installer.findExtractors();
  check("arsiv acacak arac var", tools.length > 0, "hicbir acici bulunamadi");
  for (var ti = 0; ti < tools.length; ti++) {
    console.log("       aday " + (ti + 1) + ": " + tools[ti].kind + " -> " + tools[ti].path);
  }

  /* tar en sonda olmali: bsdtar bu 7z'leri acamiyor, once gercek acicilar denenmeli. */
  var tarIndex = -1;
  for (var tj = 0; tj < tools.length; tj++) if (tools[tj].kind === "tar") tarIndex = tj;
  check("tar en son sirada", tarIndex === -1 || tarIndex === tools.length - 1,
    "tar " + tarIndex + ". sirada, toplam " + tools.length);

  var seen = {};
  var dupe = false;
  for (var tk = 0; tk < tools.length; tk++) {
    var key = tools[tk].path.toLowerCase();
    if (seen[key]) dupe = true;
    seen[key] = true;
  }
  check("ayni exe iki kez listelenmedi", !dupe, "yinelenen yol var");

  var tool = installer.findExtractor();
  check("ilk aday donuyor", !tool || tool.path === tools[0].path, "ilk aday eslemedi");
  eq("boyut bicimi", installer.formatBytes(1424309000), "1358 MB");
}

console.log("\n=== fontlar: kurulu font okuma ===");
{
  var fontResult = fonts.listFonts();
  check("font bulundu", fontResult.fonts.length > 20, "gelen " + fontResult.fonts.length);
  console.log("       " + fontResult.fonts.length + " font, " + fontResult.elapsedMs + " ms");

  var withTurkish = fontResult.fonts.filter(function (f) { return f.turkish; });
  check("Turkce kapsayan font var", withTurkish.length > 5, "gelen " + withTurkish.length);

  check("her kayit tam", fontResult.fonts.every(function (f) {
    return f.postScriptName && f.family && typeof f.turkish === "boolean";
  }));

  /*
    PostScript adinda bosluk olmamasi kural ama bazi sistem fontlari
    (ornegin "Microsoft Himalaya") kurali cignediyor. Cogunlugun temiz
    olmasi yeterli - Premiere bu adi oldugu gibi kabul ediyor.
  */
  var spaced = fontResult.fonts.filter(function (f) { return /\s/.test(f.postScriptName); });
  check("PostScript adlari cogunlukla bosluksuz",
    spaced.length < fontResult.fonts.length * 0.1,
    spaced.length + " tanesinde bosluk var");

  var montserrat = fontResult.fonts.filter(function (f) { return f.postScriptName === "Montserrat-Black"; })[0];
  if (montserrat) {
    eq("Montserrat-Black Turkce kapsiyor", montserrat.turkish, true);
  } else {
    console.log("       (Montserrat-Black kurulu degil, atlandi)");
  }

  var fredoka = fontResult.fonts.filter(function (f) { return /^FredokaOne/.test(f.postScriptName); })[0];
  if (fredoka) {
    eq("Fredoka One Turkce KAPSAMIYOR", fredoka.turkish, false);
  } else {
    console.log("       (Fredoka One kurulu degil, atlandi)");
  }

  var grouped = fonts.groupByFamily(fontResult.fonts);
  check("aileye gore gruplandi", grouped.length > 0 && grouped.length <= fontResult.fonts.length);
  check("her ailede en az bir stil", grouped.every(function (g) { return g.styles.length > 0; }));
}

console.log("\n=== fontlar: onbellek ===");
{
  var cachePath = require("path").join(require("os").tmpdir(), "odium-font-cache-test.json");
  try { require("fs").unlinkSync(cachePath); } catch (e) {}

  var first = fonts.listFontsCached(cachePath);
  eq("ilk okuma onbelleksiz", first.cached, false);

  var second = fonts.listFontsCached(cachePath);
  eq("ikinci okuma onbellekten", second.cached, true);
  eq("ayni font sayisi", second.fonts.length, first.fonts.length);
  check("onbellek okumasi ani", second.elapsedMs === 0);

  try { require("fs").unlinkSync(cachePath); } catch (e) {}
}

console.log("\n=== uctan uca: whisper JSON -> obek -> SRT ===");
{
  var parsed = whisper.parseWhisperJson({
    language: "tr",
    segments: [{
      start: 0, end: 4.2, text: " Bugün hava çok güzel. Dışarı çıkalım mı",
      words: [
        { word: " Bugün", start: 0.0, end: 0.5 },
        { word: " hava", start: 0.5, end: 0.9 },
        { word: " çok", start: 0.9, end: 1.2 },
        { word: " güzel.", start: 1.2, end: 1.8 },
        { word: " Dışarı", start: 2.4, end: 3.0 },
        { word: " çıkalım", start: 3.0, end: 3.6 },
        { word: " mı", start: 3.6, end: 4.2 }
      ]
    }]
  });

  var cues = chunker.chunkWords(parsed.words, { mode: "chunk" });
  eq("nokta + duraklama iki obek yapti", cues.length, 2);
  eq("ilk obek", cues[0].text, "Bugün hava çok güzel.");
  eq("ikinci obek", cues[1].text, "Dışarı çıkalım mı");

  var text = srt.toSrt(cues);
  check("SRT Turkce metni tasidi", text.indexOf("Dışarı çıkalım mı") > 0);
  eq("SRT geri okunabildi", srt.fromSrt(text).length, 2);
}


console.log("\n=== chunker: bozuk ayarlar varsayilani ezmesin ===");
{
  /* Panelde bos birakilan kutu Number("") -> NaN veriyor. */
  var opt = chunker.buildOptions({ mode: "chunk", maxWords: NaN, maxDuration: "", maxCharsPerLine: "40" });
  eq("NaN maxWords varsayilanda kaldi", opt.maxWords, 5);
  eq("bos maxDuration varsayilanda kaldi", opt.maxDuration, 2.5);
  eq("metin sayi cevrildi", opt.maxCharsPerLine, 40);

  var w = words([
    ["bir", 0.0, 0.3], ["iki", 0.3, 0.6], ["uc", 0.6, 0.9],
    ["dort", 0.9, 1.2], ["bes", 1.2, 1.5], ["alti", 1.5, 1.8]
  ]);
  var cues = chunker.chunkWords(w, { mode: "chunk", maxWords: NaN });
  eq("NaN ayarla obekleme yine bolundu", cues.length, 2);
}

console.log("\n=== chunker: hiz degistirilmis klip eslemesi ===");
{
  var cues = [{ index: 0, start: 4, end: 6, text: "iki kat hizli" }];

  var normal = chunker.mapToSequence(cues, { start: 0, inPoint: 0, outPoint: 20, speed: 1 });
  near("normal hizda kayma yok", normal[0].start, 4);

  var fast = chunker.mapToSequence(cues, { start: 0, inPoint: 0, outPoint: 20, speed: 2 });
  near("2x klipte kaynak 4 sn -> sequence 2 sn", fast[0].start, 2);
  near("2x klipte bitis 3 sn", fast[0].end, 3);

  var slow = chunker.mapToSequence(cues, { start: 10, inPoint: 0, outPoint: 20, speed: 0.5 });
  near("0.5x klipte kaynak 4 sn -> sequence 18 sn", slow[0].start, 18);

  var missing = chunker.mapToSequence(cues, { start: 0, inPoint: 0, outPoint: 20 });
  near("speed yoksa 1 sayiliyor", missing[0].start, 4);

  var reversed = chunker.mapToSequence(cues, { start: 0, inPoint: 0, outPoint: 20, speed: 1, reversed: true });
  eq("ters klip icin obek uretilmiyor", reversed.length, 0);
}

console.log("\n=== pipeline: In/Out modunda zaman kaydirma ===");
{
  var shifted = pipeline.shiftTimes([{ word: "a", start: 0, end: 0.5 }, { word: "b", start: 1, end: 1.5 }], 120);
  near("ilk kelime kaynak zamanina tasindi", shifted[0].start, 120);
  near("ikinci kelime bitisi", shifted[1].end, 121.5);
  eq("metin korundu", shifted[1].word, "b");

  var same = pipeline.shiftTimes([{ start: 3, end: 4 }], 0);
  near("offset 0 ise dokunulmuyor", same[0].start, 3);
}

console.log("\n=== whisper: bayat JSON kabul edilmiyor ===");
{
  var os = require("os");
  var fsx = require("fs");
  var pathx = require("path");

  var dir = pathx.join(os.tmpdir(), "odium-test-" + Date.now());
  fsx.mkdirSync(dir, { recursive: true });

  var stale = pathx.join(dir, "onceki-klip.json");
  fsx.writeFileSync(stale, "{}");
  var old = new Date(Date.now() - 10 * 60 * 1000);
  fsx.utimesSync(stale, old, old);

  var now = Date.now();
  eq("baska klibin eski JSON'u secilmiyor", whisper.expectedJsonPath(pathx.join(dir, "ses.wav"), dir, now), null);

  var fresh = pathx.join(dir, "ses.json");
  fsx.writeFileSync(fresh, "{}");
  eq("taze JSON bulunuyor", whisper.expectedJsonPath(pathx.join(dir, "ses.wav"), dir, now), fresh);

  try { fsx.unlinkSync(stale); fsx.unlinkSync(fresh); fsx.rmdirSync(dir); } catch (e) {}
}

console.log("\n=== host.jsx: occurrence yurutucusu ===");
{
  var media = hostbox.mediaItem("media-1", "andre");
  var baska = hostbox.mediaItem("media-2", "muzik");

  /* 1. A/V bagli klip: iki track'te duruyor ama tek kullanim sayilmali */
  var avSeq = hostbox.sequence({
    video: [[hostbox.clip({ start: 10, end: 14, inPoint: 5, item: media })]],
    audio: [[hostbox.clip({ start: 10, end: 14, inPoint: 5, item: media })]]
  });
  var av = hostbox.occurrences(hostbox.load([]), avSeq, "media-1");
  eq("A/V bagli klip tek occurrence", av.length, 1);
  eq("tutulan kayit video", av[0].audio, false);
  near("start", av[0].start, 10);
  near("inPoint", av[0].inPoint, 5);
  near("outPoint", av[0].outPoint, 9);

  /* 2. Sadece ses track'inde duran klip (bugunku hata) */
  var sesSeq = hostbox.sequence({
    video: [[hostbox.clip({ start: 0, end: 4, inPoint: 0, item: baska })]],
    audio: [[hostbox.clip({ start: 30, end: 40, inPoint: 2, item: media })]]
  });
  var ses = hostbox.occurrences(hostbox.load([]), sesSeq, "media-1");
  eq("ses track'indeki klip bulundu", ses.length, 1);
  eq("ses bayragi acik", ses[0].audio, true);
  near("ses klibi start", ses[0].start, 30);

  /* 3. Ayni kaynagin iki ayri kullanimi elenmemeli */
  var ikiSeq = hostbox.sequence({
    video: [[
      hostbox.clip({ start: 0, end: 5, inPoint: 0, item: media }),
      hostbox.clip({ start: 20, end: 25, inPoint: 40, item: media })
    ]]
  });
  eq("iki ayri kullanim korundu", hostbox.occurrences(hostbox.load([]), ikiSeq, "media-1").length, 2);

  /* 4. Hizlandirilmis klip */
  var hizSeq = hostbox.sequence({
    video: [[hostbox.clip({ start: 0, end: 5, inPoint: 0, speed: 2, item: media })]]
  });
  var hiz = hostbox.occurrences(hostbox.load([]), hizSeq, "media-1")[0];
  near("2x klipte 5 sn sequence = 10 sn kaynak", hiz.outPoint, 10);
  near("occurrence hizi", hiz.speed, 2);
  near("2x klipte kaynak 4 sn -> sequence 2 sn",
    chunker.mapToSequence([{ start: 4, end: 4.5 }], hiz)[0].start, 2);

  /* 5. Ters cevrilmis klip isaretleniyor */
  var tersSeq = hostbox.sequence({
    video: [[hostbox.clip({ start: 0, end: 5, inPoint: 0, reversed: true, item: media })]]
  });
  eq("ters klip isaretli", hostbox.occurrences(hostbox.load([]), tersSeq, "media-1")[0].reversed, true);

  /* 6. Nest: ic klibin kaynak zamani dis sequence zamanina cevriliyor */
  var nestItem = hostbox.mediaItem("nest-1", "Nested Sequence 01");
  var icSeq = hostbox.sequence({
    name: "Nested Sequence 01",
    item: nestItem,
    video: [[hostbox.clip({ start: 0, end: 20, inPoint: 5, item: media })]]
  });
  var disSeq = hostbox.sequence({
    video: [[hostbox.clip({ start: 100, end: 120, inPoint: 0, item: nestItem })]]
  });
  var nest = hostbox.occurrences(hostbox.load([icSeq]), disSeq, "media-1")[0];
  eq("nest icindeki klip bulundu", nest.nested, true);
  near("nest start", nest.start, 100);
  near("nest inPoint", nest.inPoint, 5);
  near("kaynak 7 sn -> sequence 102 sn",
    chunker.mapToSequence([{ start: 7, end: 8 }], nest)[0].start, 102);

  /* 7. Kirpilmis nest: disarida kalan kisim sayilmamali */
  var kirpikDis = hostbox.sequence({
    video: [[hostbox.clip({ start: 100, end: 110, inPoint: 3, item: nestItem })]]
  });
  var kirpik = hostbox.occurrences(hostbox.load([icSeq]), kirpikDis, "media-1")[0];
  near("kirpilmis nest start", kirpik.start, 100);
  near("kirpilmis nest inPoint", kirpik.inPoint, 8);
  near("kirpilmis nest outPoint", kirpik.outPoint, 18);

  /* 8. Hizlandirilmis nest: iki kademe hiz birlesiyor */
  var hizliDis = hostbox.sequence({
    video: [[hostbox.clip({ start: 0, end: 10, inPoint: 0, speed: 2, item: nestItem })]]
  });
  var hizliNest = hostbox.occurrences(hostbox.load([icSeq]), hizliDis, "media-1")[0];
  near("2x nest icinde occurrence hizi", hizliNest.speed, 2);
  near("2x nest bitisi", hizliNest.end, 10);
  near("2x nest: kaynak 15 sn -> sequence 5 sn",
    chunker.mapToSequence([{ start: 15, end: 16 }], hizliNest)[0].start, 5);

  /* 9. Hem kirpilmis hem hizlandirilmis nest - iki duzeltme birlikte */
  var zorDis = hostbox.sequence({
    video: [[hostbox.clip({ start: 50, end: 60, inPoint: 4, speed: 2, item: nestItem })]]
  });
  var zor = hostbox.occurrences(hostbox.load([icSeq]), zorDis, "media-1")[0];
  near("kirpik+hizli nest start", zor.start, 50);
  /*
    Nest 10 sn yer kapliyor ve 2x hizli, yani 20 sn ic malzeme istiyor; ic
    sequence 4. saniyeden sonra sadece 16 sn tasiyor. Kullanim 8 sn'de bitiyor,
    son 2 sn'de gosterecek goruntu yok - occurrence bunu dogru kesiyor.
  */
  near("kirpik+hizli nest end", zor.end, 58);
  near("kirpik+hizli nest inPoint", zor.inPoint, 9);
  near("kirpik+hizli nest outPoint", zor.outPoint, 25);
  near("kirpik+hizli nest hizi", zor.speed, 2);

  var zorCues = chunker.mapToSequence([{ start: 9, end: 10 }, { start: 24, end: 25 }], zor);
  near("ilk obek nest'in basinda", zorCues[0].start, 50);
  near("son obek nest'in sonunda", zorCues[1].end, 58);
  eq("nest disi obek atildi",
    chunker.mapToSequence([{ start: 100, end: 101 }], zor).length, 0);
}

console.log("\n=== host.jsx: JSON yedek serilestirici ===");
{
  var host = hostbox.load([]);

  /* Metin blob'unun tasidigi alanlar: string, sayi dizisi, ic ice nesne. */
  var blob = {
    textEditValue: "Merhaba \"dunya\" ÇĞİŞ",
    fontTextRunLength: [21],
    fontEditValue: ["Montserrat-Black"],
    fontSizeEditValue: [90],
    bold: false,
    nested: { a: 1, b: null }
  };

  var yedek = host.PP_stringifyValue(blob);
  eq("yedek serilestirici gecerli JSON uretti",
    JSON.stringify(JSON.parse(yedek)), JSON.stringify(blob));
  check("tirnak kacisi dogru", yedek.indexOf('\\"dunya\\"') > 0, yedek.substring(0, 80));
  eq("satir sonu kaciriliyor", host.PP_stringifyValue("a\nb"), '"a\\nb"');
  eq("sonsuz sayi null oluyor", host.PP_stringifyValue(Infinity), "null");
  eq("dizi bicimi", host.PP_stringifyValue([1, "iki", true]), '[1,"iki",true]');
  eq("Turkce karakter bozulmadi", JSON.parse(yedek).textEditValue, blob.textEditValue);
}

console.log("\n=== host.jsx: nest icindeki baskin kaynak ===");
{
  var host = hostbox.load([]);
  var media = hostbox.mediaItem("media-1", "andre");
  var kisa = hostbox.mediaItem("media-2", "jingle");

  var seq = hostbox.sequence({
    video: [[
      hostbox.clip({ start: 0, end: 10, inPoint: 0, item: media }),
      hostbox.clip({ start: 10, end: 16, inPoint: 0, item: kisa })
    ]],
    audio: [[hostbox.clip({ start: 0, end: 10, inPoint: 0, item: media })]]
  });

  var tally = host.PP_dominantSourceInSequence(seq, 0, {});
  eq("A/V kaynak iki kat sayilmadi", tally["media-1"].seconds, 10);
  eq("ses tarafi da olculdu", tally["media-1"].audio, 10);
  eq("kisa kaynak ayri sayildi", tally["media-2"].seconds, 6);
  check("baskin kaynak dogru", tally["media-1"].seconds > tally["media-2"].seconds);
}

console.log("\n----------------------------------------");
console.log("  gecen: " + passed + "   kalan: " + failed);
console.log("----------------------------------------\n");

process.exit(failed ? 1 : 0);
