/*
  Odium Subs - kurulu fontlari okur.
  Saf Node, bagimliliksiz. CEP'e dokunmaz.

  Neden gerekli: panel fontu MOGRT parametresine PostScript adiyla yaziyor
  ("Montserrat-Black" gibi). Kullanici bunu elle yazamaz - yanlis yazarsa
  Premiere sessizce baska fonta duser. Bu yuzden kurulu fontlari dosyadan
  okuyup listeliyoruz.

  Ayrica her fontun Turkce gliflerini (Ç Ğ İ Ş ı ğ ş) tasiyip tasimadigi
  kontrol ediliyor. Fredoka One tasimiyor; kullanici secerse yazi bozulur,
  o yuzden listede isaretli.

  Bicim: sfnt (TTF/OTF) ve TTC (font koleksiyonu). Okunan tablolar:
    name -> aile adi (ID 1), alt aile (ID 2), PostScript adi (ID 6)
    cmap -> hangi karakterler var (format 4 ve 12)
*/
"use strict";

var fs = require("fs");
var os = require("os");
var path = require("path");

/* Turkce'ye ozgu, cogu fontta eksik olan karakterler. */
var TURKISH_CHARS = [0x011E, 0x011F, 0x0130, 0x0131, 0x015E, 0x015F, 0x00C7, 0x00E7];

function fontDirectories() {
  var dirs = [];
  var windir = process.env.SystemRoot || "C:\\Windows";
  dirs.push(path.join(windir, "Fonts"));

  var local = process.env.LOCALAPPDATA;
  if (local) dirs.push(path.join(local, "Microsoft", "Windows", "Fonts"));

  return dirs.filter(function (d) {
    try { return fs.existsSync(d); } catch (e) { return false; }
  });
}

/* ------------------------------------------------------------------ */
/* sfnt ayristirma                                                     */
/* ------------------------------------------------------------------ */

function readTableDirectory(buf, offset) {
  var tables = {};
  var numTables = buf.readUInt16BE(offset + 4);
  var p = offset + 12;

  for (var i = 0; i < numTables; i++) {
    if (p + 16 > buf.length) break;
    var tag = buf.toString("ascii", p, p + 4);
    tables[tag] = {
      offset: buf.readUInt32BE(p + 8),
      length: buf.readUInt32BE(p + 12)
    };
    p += 16;
  }
  return tables;
}

/* Bir dosyada birden fazla font olabilir (TTC). Her birinin baslangicini doner. */
function fontOffsets(buf) {
  if (buf.length < 12) return [];

  var tag = buf.toString("ascii", 0, 4);
  if (tag === "ttcf") {
    var count = buf.readUInt32BE(8);
    var out = [];
    for (var i = 0; i < count && 12 + i * 4 + 4 <= buf.length; i++) {
      out.push(buf.readUInt32BE(12 + i * 4));
    }
    return out;
  }
  return [0];
}

/*
  name tablosundan istenen ID'leri cikarir.
  Windows platformu (3) UTF-16BE, Mac platformu (1) tek bayt.
  Ingilizce kaydi tercih ediyoruz; yoksa ilk bulunan.
*/
function readNames(buf, table) {
  var result = {};
  if (!table) return result;

  var base = table.offset;
  if (base + 6 > buf.length) return result;

  var count = buf.readUInt16BE(base + 2);
  var stringOffset = base + buf.readUInt16BE(base + 4);

  for (var i = 0; i < count; i++) {
    var rec = base + 6 + i * 12;
    if (rec + 12 > buf.length) break;

    var platformId = buf.readUInt16BE(rec);
    var languageId = buf.readUInt16BE(rec + 4);
    var nameId = buf.readUInt16BE(rec + 6);
    var length = buf.readUInt16BE(rec + 8);
    var offset = stringOffset + buf.readUInt16BE(rec + 10);

    if (nameId !== 1 && nameId !== 2 && nameId !== 6) continue;
    if (offset + length > buf.length) continue;

    var value;
    if (platformId === 3) {
      value = swapBytes(buf.slice(offset, offset + length));
    } else {
      value = buf.toString("latin1", offset, offset + length);
    }
    value = value.replace(/\u0000/g, "").replace(/^\s+|\s+$/g, "");
    if (!value) continue;

    var isEnglish = (platformId === 3 && languageId === 0x0409) || (platformId === 1 && languageId === 0);
    if (!result[nameId] || isEnglish) result[nameId] = value;
  }

  return result;
}

/* UTF-16BE -> JS string. Node'un utf16le'si ters oldugu icin bayt cevirmek gerekiyor. */
function swapBytes(slice) {
  var out = "";
  for (var i = 0; i + 1 < slice.length; i += 2) {
    out += String.fromCharCode((slice[i] << 8) | slice[i + 1]);
  }
  return out;
}

/*
  cmap'te verilen karakterlerin hepsi var mi.
  Format 4 (BMP, en yaygin) ve format 12 (genis) destekleniyor.
*/
function hasChars(buf, table, codepoints) {
  if (!table) return false;

  var base = table.offset;
  if (base + 4 > buf.length) return false;

  var numTables = buf.readUInt16BE(base + 2);
  var best = null;

  for (var i = 0; i < numTables; i++) {
    var rec = base + 4 + i * 8;
    if (rec + 8 > buf.length) break;
    var platformId = buf.readUInt16BE(rec);
    var encodingId = buf.readUInt16BE(rec + 2);
    var subOffset = base + buf.readUInt32BE(rec + 4);

    // Unicode alt tablolarini tercih et: (3,10) > (3,1) > (0,x)
    var score = 0;
    if (platformId === 3 && encodingId === 10) score = 3;
    else if (platformId === 3 && encodingId === 1) score = 2;
    else if (platformId === 0) score = 1;
    if (score === 0) continue;

    if (!best || score > best.score) best = { score: score, offset: subOffset };
  }

  if (!best || best.offset + 4 > buf.length) return false;

  var format = buf.readUInt16BE(best.offset);
  for (var c = 0; c < codepoints.length; c++) {
    var glyph = 0;
    if (format === 4) glyph = lookupFormat4(buf, best.offset, codepoints[c]);
    else if (format === 12) glyph = lookupFormat12(buf, best.offset, codepoints[c]);
    else return false;
    if (!glyph) return false;
  }
  return true;
}

function lookupFormat4(buf, offset, code) {
  if (code > 0xFFFF) return 0;
  try {
    var segCountX2 = buf.readUInt16BE(offset + 6);
    var segCount = segCountX2 / 2;
    var endBase = offset + 14;
    var startBase = endBase + segCountX2 + 2;
    var deltaBase = startBase + segCountX2;
    var rangeBase = deltaBase + segCountX2;

    for (var s = 0; s < segCount; s++) {
      var end = buf.readUInt16BE(endBase + s * 2);
      if (code > end) continue;
      var start = buf.readUInt16BE(startBase + s * 2);
      if (code < start) return 0;

      var delta = buf.readInt16BE(deltaBase + s * 2);
      var rangeOffset = buf.readUInt16BE(rangeBase + s * 2);

      if (rangeOffset === 0) return (code + delta) & 0xFFFF;

      var glyphAddr = rangeBase + s * 2 + rangeOffset + (code - start) * 2;
      if (glyphAddr + 2 > buf.length) return 0;
      var glyph = buf.readUInt16BE(glyphAddr);
      return glyph === 0 ? 0 : (glyph + delta) & 0xFFFF;
    }
  } catch (e) {}
  return 0;
}

function lookupFormat12(buf, offset, code) {
  try {
    var nGroups = buf.readUInt32BE(offset + 12);
    for (var g = 0; g < nGroups; g++) {
      var rec = offset + 16 + g * 12;
      if (rec + 12 > buf.length) break;
      var start = buf.readUInt32BE(rec);
      var end = buf.readUInt32BE(rec + 4);
      if (code < start) return 0;
      if (code > end) continue;
      return buf.readUInt32BE(rec + 8) + (code - start);
    }
  } catch (e) {}
  return 0;
}

/* ------------------------------------------------------------------ */
/* Ust seviye                                                          */
/* ------------------------------------------------------------------ */

function readFontFile(file) {
  var out = [];
  var buf;
  try { buf = fs.readFileSync(file); } catch (e) { return out; }

  var offsets = fontOffsets(buf);
  for (var i = 0; i < offsets.length; i++) {
    try {
      var tables = readTableDirectory(buf, offsets[i]);
      var names = readNames(buf, tables["name"]);
      var postScript = names[6];
      var family = names[1];
      if (!postScript || !family) continue;

      out.push({
        family: family,
        subfamily: names[2] || "Regular",
        postScriptName: postScript,
        file: file,
        turkish: hasChars(buf, tables["cmap"], TURKISH_CHARS)
      });
    } catch (e) {}
  }
  return out;
}

/*
  listFonts({ turkishOnly })
  -> [{ family, subfamily, postScriptName, file, turkish }] , aileye gore sirali

  ~400 font dosyasi okuyor; olcum icin sure de doner.
*/
function listFonts(options) {
  options = options || {};
  var started = Date.now();
  /*
    Anahtarlar font adlarindan geliyor. Duz {} kullanilirsa "constructor" ya
    da "toString" adli bir kayit Object.prototype uzerinden "zaten var" gorunup
    fontu sessizce listeden dusurur.
  */
  var seen = Object.create(null);
  var fonts = [];

  var dirs = fontDirectories();
  for (var d = 0; d < dirs.length; d++) {
    var entries;
    try { entries = fs.readdirSync(dirs[d]); } catch (e) { continue; }

    for (var i = 0; i < entries.length; i++) {
      if (!/\.(ttf|otf|ttc|otc)$/i.test(entries[i])) continue;
      var full = path.join(dirs[d], entries[i]);

      var parsed = readFontFile(full);
      for (var p = 0; p < parsed.length; p++) {
        var key = parsed[p].postScriptName.toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        if (options.turkishOnly && !parsed[p].turkish) continue;
        fonts.push(parsed[p]);
      }
    }
  }

  fonts.sort(function (a, b) {
    var fa = a.family.toLowerCase();
    var fb = b.family.toLowerCase();
    if (fa !== fb) return fa < fb ? -1 : 1;
    return a.subfamily.toLowerCase() < b.subfamily.toLowerCase() ? -1 : 1;
  });

  return { fonts: fonts, elapsedMs: Date.now() - started, directories: dirs };
}

/*
  416 font dosyasi okumak ~1.3 sn suruyor; panel her acilista bunu
  bekleyemez. Sonucu diske yaziyoruz, font klasorlerinin degisme tarihi
  ayni kaldigi surece onbellekten okuyoruz.
*/
function cacheStamp(dirs) {
  var parts = [];
  for (var i = 0; i < dirs.length; i++) {
    try {
      var st = fs.statSync(dirs[i]);
      parts.push(dirs[i] + ":" + Math.round(st.mtimeMs));
    } catch (e) {
      parts.push(dirs[i] + ":yok");
    }
  }
  return parts.join("|");
}

function listFontsCached(cachePath, options) {
  var dirs = fontDirectories();
  var stamp = cacheStamp(dirs);

  if (cachePath) {
    try {
      var raw = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      if (raw && raw.stamp === stamp && raw.fonts && raw.fonts.length) {
        return { fonts: raw.fonts, elapsedMs: 0, directories: dirs, cached: true };
      }
    } catch (e) {}
  }

  var result = listFonts(options);
  result.cached = false;

  if (cachePath) {
    try {
      var dir = path.dirname(cachePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify({ stamp: stamp, fonts: result.fonts }), "utf8");
    } catch (e) {}
  }

  return result;
}

/* Aileye gore gruplar - panel iki kademeli secici gosteriyor. */
function groupByFamily(fonts) {
  var map = Object.create(null);
  var order = [];

  for (var i = 0; i < fonts.length; i++) {
    var f = fonts[i];
    if (!map[f.family]) {
      map[f.family] = { family: f.family, turkish: false, styles: [] };
      order.push(f.family);
    }
    map[f.family].styles.push(f);
    if (f.turkish) map[f.family].turkish = true;
  }

  return order.map(function (name) { return map[name]; });
}

module.exports = {
  TURKISH_CHARS: TURKISH_CHARS,
  listFonts: listFonts,
  listFontsCached: listFontsCached,
  groupByFamily: groupByFamily,
  readFontFile: readFontFile,
  fontDirectories: fontDirectories
};
