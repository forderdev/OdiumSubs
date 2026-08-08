# Odium Subs — Premiere Pro altyazı otomasyonu

Premiere Pro 2026 (26.0.2) için CEP paneli. Seçilen klibin sesini local Whisper ile
kelime bazlı zaman damgalı yazıya döker, panelde düzeltilir, timeline'a klasik altyazı
veya animasyonlu MOGRT klipleri olarak basılır. Tamamen offline — API key yok, hesap yok.

Kararların tamamı: [DECISIONS.md](DECISIONS.md)

---

## Şu anki durum: M2 — çalışan panel (klasik altyazı yolu)

Panel akışı:

1. **Kaynak** — timeline'da veya Project panelinde seçili klibi okur, o klibin
   timeline'daki tüm kullanımlarını bulur
2. **Ayarlar** — mod (öbek/klasik), dil, model, özel sözlük, öbek kuralları
3. **Yazıya dök** — ffmpeg → local Whisper → öbekleme, tek ilerleme çubuğuyla
4. **Düzenle** — öbekleri düzelt, böl, birleştir, sil; toplu bul-değiştir
5. **Timeline'a bas** — SRT üretir, kaynak zamanlarını sequence zamanına çevirir
   (kesilmiş kurguda klip dışı öbekler atılır), Premiere'e alır

**Animasyonlu MOGRT modu M3'te.** M0 ölçümleri onu mümkün kıldı:
AE şablonuyla 97 ms/klip, parametreler isimle yazılabiliyor, font korunuyor.

Ölçüm probe'ları panelin altındaki **Gelişmiş** bölümünde duruyor.

---

## Kurulum sırası

1. `tools\Dev-Link.bat` — paneli kur, CEP debug modunu aç
2. `node tools\install-whisper.js` — Faster-Whisper-XXL (1.36 GB, tek seferlik).
   Panel de ilk transkripsiyonda kendisi indirir; bu sadece önden almak için
3. Premiere'i tamamen kapat/aç → `Window > Extensions > Odium Subs`

ffmpeg PATH'te olmalı ya da `tools/ffmpeg.exe` olarak konmalı.
Whisper modelleri ilk çalıştırmada iner (`large-v3-turbo` ~1.6 GB).

### Premiere'siz test

```bash
node engine\test\run-tests.js
node tools\smoke-test.js "D:\video.mp4" --model large-v3-turbo --seconds 60
```

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
