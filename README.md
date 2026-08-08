# Odium Subs — Premiere Pro altyazı otomasyonu

Premiere Pro 2026 (26.0.2) için CEP paneli. Seçilen klibin sesini local Whisper ile
kelime bazlı zaman damgalı yazıya döker, panelde düzeltilir, timeline'a klasik altyazı
veya animasyonlu MOGRT klipleri olarak basılır. Tamamen offline — API key yok, hesap yok.

Kararların tamamı: [DECISIONS.md](DECISIONS.md)

---

## Şu anki durum: M0 — ölçüm paketi

Bu sürüm **altyazı basmıyor.** Mimariyi belirleyecek dört bilinmeyeni ölçüyor.
Bu dördünün sonucu gelmeden M1'e geçilmiyor.

| # | Ölçülen | Neden önemli |
|---|---|---|
| 1 | Seçim okuma + occurrence eşleme + tick birimi | Altyazının timeline'da doğru yere düşmesi buna bağlı |
| 2 | MOGRT parametre yüzeyi (`getMGTComponent`) | Font/boyut/renk yazılabiliyor mu, isimler ne |
| 3 | `importMGT` klip başına süre | **Ürünün şeklini bu belirliyor** — animasyonlu mod uzun videoda yaşar mı |
| 4 | QE DOM track ekleme / adlandırma | `ODIUM SUBS` track'i açılabiliyor mu |

---

## Kurulum (geliştirme)

```bat
tools\Dev-Link.bat
```

Ne yapar: `%APPDATA%\Adobe\CEP\extensions\OdiumSubs` altına bu depoya bir junction açar
(kopyalamaz — dosyayı düzenle, paneli kapat/aç, yeni kod gelir) ve imzasız uzantı için
CEP debug modunu açar (`HKCU\Software\Adobe\CSXS.9..14` → `PlayerDebugMode="1"`, REG_SZ).

Sonra **Premiere'i tamamen kapat, yeniden aç** → `Window > Extensions > Odium Subs`.

Panel görünmüyorsa: debug modu yazılmamış ya da Premiere tam kapanmamıştır
(görev yöneticisinde `Adobe Premiere Pro.exe` kalmış olabilir).

---

## Probe'ları çalıştırma sırası

Her probe adım adım diske log yazar (`<uzantı>/.probe/*.txt`). Premiere çökerse
`evalScript` callback'i hiç dönmez ve panele bir şey düşmez — **log dosyasındaki son
satır** tam olarak hangi çağrının çöktüğünü gösterir.

### 0 — Host'u Test Et
Bağlantı var mı, hangi sürüm. Bu çalışmadan diğerlerine geçme.

### 1 — Seçimi Oku
1. Bir proje aç, timeline'da bir sequence açık olsun.
2. **Project panelinde** kesilmiş kurguda kullanılan bir video klibi seç
   (veya timeline'da bir klip seç).
3. `Secimi Oku`.

Log'da bakılacak: `TOPLAM occurrence` sayısı ve her occurrence altındaki
`ESLEME: mappedEnd=... sapma=...` satırı. Sapma 5 ms üstüyse hız değişimi vardır.

### 2 — MOGRT Parametrelerini Dök
Boş bir video track seç (varsayılan V1 = index 0), `MOGRT Parametrelerini Dok`.
Log'da `PARAMETRE DOKUMU` bölümü kritik: hangi parametre hangi isimle görünüyor,
font var mı, Türkçe karakter `setValue`'dan geri sağlam dönüyor mu.

Test klibi timeline'da bırakılır — `Ctrl+Z` ile geri al.

### 3 — Hızı Ölç
**Boş bir sequence'de çalıştır.** 25 klip yeter. Log'un sonundaki
`medyan ... ms/klip` ve 350 / 600 / 1400 klip tahminleri, animasyonlu modun
eşik değerini belirleyecek sayılar.

### 4 — QE DOM'u Test Et
Track ekleme/adlandırma çalışıyor mu. **Silme yapmaz**, sadece yüzeyi döker.

---

## Ne göndereceksin

`.probe/` klasöründeki dört `.txt` (panelde `Log Klasorunu Ac` butonu açar).
Bu dördü gelince M1 (`engine/`) başlar.

---

## Klasör düzeni

```
CSXS/manifest.xml        CEP manifest (host: PPRO, node açık)
client/                  panel arayüzü (HTML/CSS/JS)
  lib/CSInterface.js     __adobe_cep__ sarmalayıcısı
  js/premiereBridge.js   host.jsx'e konuşan TEK yer
  js/app.js              probe düğmeleri + log
jsx/host.jsx             ExtendScript (ES3) — probe'lar
tools/                   kurulum ve CEP debug scriptleri
.probe/                  probe logları (git dışı)
```

Mimari kuralı: `engine/` (M1'de gelecek) **saf Node** olacak — `CSInterface`,
`cep.fs`, `evalScript` oraya girmeyecek. Premiere'e dokunan her şey
`client/js/premiereBridge.js` ve `jsx/host.jsx`'te kalacak.
