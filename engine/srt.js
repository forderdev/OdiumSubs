/*
  Odium Subs - cue dizisini SRT'ye cevirir ve SRT'yi geri okur.
  Saf Node. Premiere'e dokunmaz.

  Onemli (karar 5b / Probe 1): sequence'in baslangic timecode'u 0 olmak
  zorunda degil. Premiere SRT'yi sequence timecode'una gore hizaladigi icin
  offsetSeconds ile sequence zeroPoint'i eklenebilir. Test projesinde
  zeroPoint=0 cikti ama 01:00:00:00'dan baslayan projeler yaygin.
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.OdiumSrt = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function pad(n, width) {
    var s = String(n);
    while (s.length < width) s = "0" + s;
    return s;
  }

  /* 75.482 -> "00:01:15,482" */
  function secondsToSrtTime(seconds) {
    var total = Math.max(0, Number(seconds) || 0);
    var ms = Math.round(total * 1000);

    var h = Math.floor(ms / 3600000); ms -= h * 3600000;
    var m = Math.floor(ms / 60000);   ms -= m * 60000;
    var s = Math.floor(ms / 1000);    ms -= s * 1000;

    return pad(h, 2) + ":" + pad(m, 2) + ":" + pad(s, 2) + "," + pad(ms, 3);
  }

  /* "00:01:15,482" -> 75.482 */
  function srtTimeToSeconds(text) {
    var m = /^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(String(text).replace(/^\s+|\s+$/g, ""));
    if (!m) return null;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
  }

  function cueLines(cue) {
    if (cue.lines && cue.lines.length) return cue.lines;
    return [String(cue.text === undefined ? "" : cue.text)];
  }

  /*
    options:
      offsetSeconds - tum zamanlara eklenir (sequence zeroPoint icin)
      eol           - satir sonu, varsayilan CRLF (SRT standardi, Premiere ikisini de okur)
  */
  function toSrt(cues, options) {
    options = options || {};
    var offset = Number(options.offsetSeconds) || 0;
    var eol = options.eol || "\r\n";

    var blocks = [];
    for (var i = 0; i < cues.length; i++) {
      var c = cues[i];
      var start = secondsToSrtTime(c.start + offset);
      var end = secondsToSrtTime(c.end + offset);
      var body = cueLines(c).join(eol);
      blocks.push(String(i + 1) + eol + start + " --> " + end + eol + body);
    }
    return blocks.join(eol + eol) + (blocks.length ? eol + eol : "");
  }

  /*
    SRT'yi cue dizisine cevirir. Kullanici disarida duzeltip geri yuklerse lazim.
    Bozuk blogu atlar, sessizce comez.
  */
  function fromSrt(text) {
    var cues = [];
    if (!text) return cues;

    var normalized = String(text).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    var blocks = normalized.split(/\n{2,}/);

    for (var b = 0; b < blocks.length; b++) {
      var lines = blocks[b].split("\n");
      var cursor = 0;

      // Numara satiri opsiyonel
      if (cursor < lines.length && /^\s*\d+\s*$/.test(lines[cursor])) cursor++;
      if (cursor >= lines.length) continue;

      var timeMatch = /^\s*([\d:,.]+)\s*-->\s*([\d:,.]+)/.exec(lines[cursor]);
      if (!timeMatch) continue;

      var start = srtTimeToSeconds(timeMatch[1]);
      var end = srtTimeToSeconds(timeMatch[2]);
      if (start === null || end === null) continue;
      cursor++;

      var bodyLines = [];
      for (var l = cursor; l < lines.length; l++) {
        if (lines[l].replace(/\s/g, "") !== "") bodyLines.push(lines[l]);
      }
      if (!bodyLines.length) continue;

      cues.push({
        index: cues.length,
        start: start,
        end: end,
        text: bodyLines.join(" "),
        lines: bodyLines
      });
    }
    return cues;
  }

  return {
    toSrt: toSrt,
    fromSrt: fromSrt,
    secondsToSrtTime: secondsToSrtTime,
    srtTimeToSeconds: srtTimeToSeconds
  };
});
