/*
  ExtendScript koprusu. Panel tarafinda TEK yer host.jsx'e konusur.
  Kural (mimari karari 6): engine/ altindaki kod buraya bagimli olmayacak.
*/
(function (global) {
  "use strict";

  var cs = new CSInterface();

  // U+2028 / U+2029 JS kaynak kodunda satir sonu sayilir; evalScript'e ham
  // gonderilirse ExtendScript'te sozdizimi hatasi olur. Kaynak dosyaya bu
  // karakterleri gommemek icin koddan uretiyoruz.
  var LINE_SEP = String.fromCharCode(0x2028);
  var PARA_SEP = String.fromCharCode(0x2029);

  function jsStringLiteral(value) {
    return JSON.stringify(String(value))
      .split(LINE_SEP).join("\\u2028")
      .split(PARA_SEP).join("\\u2029");
  }

  function callHost(fnName, payload) {
    return new Promise(function (resolve) {
      var script;
      if (payload === undefined || payload === null) {
        script = fnName + "()";
      } else {
        script = fnName + "(" + jsStringLiteral(JSON.stringify(payload)) + ")";
      }

      cs.evalScript(script, function (raw) {
        if (raw === "EvalScript error." || raw === undefined || raw === null) {
          resolve({
            ok: false,
            message: "EvalScript error - host.jsx'te sozdizimi hatasi ya da fonksiyon yok: " + fnName
          });
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          resolve({ ok: false, message: "Host cevabi JSON degil: " + String(raw).substring(0, 500) });
        }
      });
    });
  }

  function hostEnvironment() {
    try { return cs.getHostEnvironment() || {}; } catch (e) { return {}; }
  }

  function extensionPath() {
    try { return cs.getSystemPath(SystemPath.EXTENSION) || ""; } catch (e) { return ""; }
  }

  global.PremiereBridge = {
    callHost: callHost,
    hostEnvironment: hostEnvironment,
    extensionPath: extensionPath,
    ping: function () { return callHost("PP_ping"); },

    /* Uretim fonksiyonlari */
    getSelection: function () { return callHost("PP_getSelection"); },
    importCaptions: function (payload) { return callHost("PP_importCaptions", payload); },

    /* Olcum probe'lari */
    probeSelection: function (payload) { return callHost("PP_probeSelection", payload); },
    probeMogrt: function (payload) { return callHost("PP_probeMogrt", payload); },
    probeImportSpeed: function (payload) { return callHost("PP_probeImportSpeed", payload); },
    probeFastPlace: function (payload) { return callHost("PP_probeFastPlace", payload); },
    probeTemplates: function (payload) { return callHost("PP_probeTemplates", payload); },
    probeMechanics: function (payload) { return callHost("PP_probeMechanics", payload); },
    probeTextWrite: function (payload) { return callHost("PP_probeTextWrite", payload); },
    probeQE: function (payload) { return callHost("PP_probeQE", payload); }
  };
})(window);
