/*
  Minimal CSInterface koprusu - Odium Subs.
  Adobe'nin tam CSInterface.js'i yerine ihtiyacimiz olan alt kumeyi acar:
  evalScript, getSystemPath, getHostEnvironment.
  CEP panelin icinde window.__adobe_cep__ hazir gelir; bu sarmalayici onu
  window.CSInterface olarak sunar.
*/
(function (global) {
  "use strict";

  if (global.CSInterface) return;

  var SystemPath = {
    USER_DATA: "userData",
    COMMON_FILES: "commonFiles",
    MY_DOCUMENTS: "myDocuments",
    APPLICATION: "application",
    EXTENSION: "extension",
    HOST_APPLICATION: "hostApplication"
  };

  function safeJson(value, fallback) {
    try { return JSON.parse(value); } catch (e) { return fallback; }
  }

  function CSInterface() {}

  CSInterface.prototype.evalScript = function (script, callback) {
    if (global.__adobe_cep__ && typeof global.__adobe_cep__.evalScript === "function") {
      global.__adobe_cep__.evalScript(script, callback || function () {});
      return;
    }

    if (callback) {
      callback(JSON.stringify({
        ok: false,
        message: "__adobe_cep__ yok. Panel Premiere CEP icinde degil veya CEP baglantisi acilmamis."
      }));
    }
  };

  CSInterface.prototype.getSystemPath = function (pathType) {
    if (global.__adobe_cep__ && typeof global.__adobe_cep__.getSystemPath === "function") {
      return global.__adobe_cep__.getSystemPath(pathType);
    }
    return "";
  };

  CSInterface.prototype.getHostEnvironment = function () {
    if (global.__adobe_cep__ && typeof global.__adobe_cep__.getHostEnvironment === "function") {
      return safeJson(global.__adobe_cep__.getHostEnvironment(), {});
    }
    return {};
  };

  CSInterface.prototype.getOSInformation = function () {
    if (global.__adobe_cep__ && typeof global.__adobe_cep__.getOSInformation === "function") {
      return global.__adobe_cep__.getOSInformation();
    }
    return global.navigator ? global.navigator.platform : "unknown";
  };

  global.CSInterface = CSInterface;
  global.SystemPath = SystemPath;
})(window);
