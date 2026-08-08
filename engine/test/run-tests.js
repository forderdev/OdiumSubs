/*
  engine/ testleri. Bagimlilik yok, Premiere yok:
      node engine/test/run-tests.js

  Amac: obekleme ve SRT mantigini Premiere'e hic dokunmadan dogrulamak.
  Probe 1'den gelen GERCEK klip degerleri esleme testinde kullaniliyor.
*/
"use strict";

var chunker = require("../chunker.js");
var srt = require("../srt.js");

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

console.log("\n=== chunker: bozuk girdi ===");
{
  var cues = chunker.chunkWords([
    { word: "  ", start: 0, end: 1 },
    { word: "iyi", start: 1, end: 0.5 },      // ters zaman
    { word: "kotu", start: NaN, end: 2 },     // gecersiz
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

console.log("\n----------------------------------------");
console.log("  gecen: " + passed + "   kalan: " + failed);
console.log("----------------------------------------\n");

process.exit(failed ? 1 : 0);
