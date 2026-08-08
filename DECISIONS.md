# Kararlar — Odium Subs

Grilling oturumu sonucu, 2026-08-08. Değişirse buraya yazılır.

## Ortam (ölçülmüş, varsayım değil)

- Premiere Pro **26.0.2**, `D:\Adobe\Adobe Premiere Pro 2026`. CEP + CEPHtmlEngine var.
- Premiere'in native Auto Transcription dilleri: `en-us en-gb cmn-hans cmn-hant zh-hk
  es-es de-de fr-fr ja-jp pt-pt ko-kr it-it ru-ru hi-in nb-no sv-se da-dk nl-nl`.
  **Türkçe yok** — projenin ana değer önerisi bu.
- GPU: RTX 3060 Ti 8 GB. Node v24.11.0, git, ffmpeg mevcut.
- Referans şablonlar: `<Premiere>\Essential Graphics\Captions and Subtitles\*.mogrt`

## Kararlar

| # | Konu | Karar |
|---|---|---|
| 1 | Kitle | Ekip/arkadaş dağıtımı. Installer + otomatik güncelleme. Lisans/auth yok |
| 2 | Motor | **Local**, bulut yok |
| 3 | Paketleme | **Faster-Whisper-XXL standalone** (Purfview). Python yok, Silero VAD dahil, `--word_timestamps`. Varsayılan model `large-v3-turbo`; GPU yoksa CPU int8 + süre uyarısı. Model ilk çalıştırmada indirilir, installer'a gömülmez |
| 4 | Timeline'a giriş | Önce **SRT / native caption** (zinciri uçtan uca doğrular), sonra **MOGRT** modu üstüne. ffmpeg/ASS overlay yolu elendi (düzenlenemez) |
| 5 | Ses kaynağı | Project paneli **veya** timeline seçiminden, ffmpeg ile doğrudan kaynak dosyadan. Sequence export yok |
| 5b | Hizalama | Occurrence eşleme: `seqTime = clip.start + (sourceTime − clip.inPoint)`. Klip dışı kelimeler atılır. Klip aktif sequence'de yoksa sadece SRT yazılır |
| 6 | Mimari | Düz CEP + panel içi Node. `engine/` saf Node, CEP'e sıfır bağımlılık. Sidecar yok |
| 7 | Parçalama | Varsayılan **öbek**: maks 5 kelime / 2.5 sn, noktalamada kes, 400 ms boşlukta kes, min 0.6 sn, 300 ms altı boşlukta önceki öbeği uzat. **Klasik** ikinci mod: maks 2 satır × 42 karakter, 1–6 sn. Kurallar kullanıcıya açık kaydırıcı |
| 8 | Düzeltme | **Panel içi editör**: düzelt / birleştir / böl / sil / sınır kaydır, **bul-değiştir**, **özel sözlük** (`--initial_prompt`). Veri sahibi panel. Native caption'dan geri okuma probe'a bağlı bonus |
| 9 | Şablonlar | **AE'de yazılır** — son kullanıcıda AE gerekmez (Premiere 13.0+ MOGRT'ları kendi render eder). 4 sabit in/out çifti: Zoom Pop / Yukarı Kay / Bounce / Düz. Responsive Design–Time ile süre koruması. Motion blur AE gerektiriyor: Premiere'den export edilen MOGRT klip efektlerini taşımıyor |
| 9b | Konum / boyut | Klibin **Motion** efektinden (Position / Scale), şablon parametresinden değil |
| 10 | Parametre sözleşmesi | Her şablon birebir aynı isimlerle: `Text`, `Font Size`, `Fill Color`, `Stroke Width`, `Stroke Color`, `BG Opacity`. Font şablonda; panelden seçilebilmesi probe'a bağlı, olmazsa font varyantı şablonlar |
| 11 | Track | Kullanıcı track seçer, `ODIUM SUBS` adıyla sahiplenilir. Tekrar basmadan önce sorar, onaylanınca temizler. QE DOM tek dosyada, try/catch + sayım doğrulaması, kırılırsa "elle temizle" moduna düşer |
| 12 | Dil | Dil seçici + otomatik algılama. Varsayılan Türkçe. **Çeviri yok** |
| 13 | Ölçek | Video 1 dk – 40 dk arası, kurgu büyük ihtimalle çok kesik |
| 14 | Uzun video | Eşik aşılırsa uyar, iki çıkış: **Klasik moda geç** veya **In/Out koy, sadece o aralığı efektli bas**. Eşik M0 ölçümünden çıkacak |
| 15 | Erişim | Kontrol yok, tamamen offline |

## Elenenler ve nedeni

- **Bulut STT (OpenAI / ElevenLabs)** — local seçildi; API key ve internet bağımlılığı istenmedi.
- **UXP** — harici process çalıştıramıyor (`child_process` yok), local whisper/ffmpeg imkânsız.
- **`pip install faster-whisper`** — son kullanıcıda Python + CUDA + cuDNN kurulum cehennemi.
- **whisper.cpp** — word timestamp'i (DTW) faster-whisper kadar oturmuş değil.
- **ffmpeg/ASS alpha overlay** — 4K 40 dk ProRes 4444 ≈ 200 GB+, düşük çözünürlükte yazı bulanık.
- **Kelime kelime mod** — 10 dk'da ~1500 klip, `importMGT` ile kullanılamaz.
- **Karaoke (cümle sabit, aktif kelime renkli)** — MOGRT parametrelerine dinamik kelime zamanlaması geçilemiyor.
- **Sidecar servis** — port çakışması, güvenlik duvarı uyarısı, zombi process; bugün karşılığı yok.
- **Lisans anahtarı listesi** — CEP paneli düz JS, koruma illüzyon; karşılığında offline çalışma feda ediliyor.

## Yol haritası

- **M0 — ölçüm paketi.** İskelet panel + 4 probe. ← şu an burada
- **M1 — `engine/`.** ffmpeg ses çıkarma → whisper indir/çalıştır → kelime JSON → öbekleme → SRT. Premiere'e dokunmadan test edilebilir.
- **M2 — Panel + editör + Klasik mod.** SRT caption track'e düşüyor, senkron doğru.
- **M3 — MOGRT modu.** Şablon sözleşmesi, occurrence eşleme, tick matematiği, Motion konum/boyut, `ODIUM SUBS` yönetimi, eşik + In/Out.
- **M4 — Paketleme.** Inno Setup setup.exe, GitHub `version.json` ile otomatik güncelleme, ilk çalıştırmada whisper/model indirme.

## M0 ölçüm sonuçları (Premiere 26.0.2, gerçek proje)

**Tick matematiği doğrulandı.** `15.32 s × 254016000000 = 3891525120000` — birebir.
`timebase=10160640000` → 25 fps. Test projesinde `zeroPoint=0`.

**Eşleme formülü doğrulandı.** Gerçek klip: `start=15.32`, `end=22.64`, `inPoint=85.72`,
`outPoint=93.04`, `duration=7.32`. `end−start = out−in = duration` ✓.
`getSpeed()=1` okunuyor, hız değişimi tespit edilebilir.

**Seçim API'si:**
- `app.getCurrentProjectViewSelection()` **`undefined` dönüyor** — kullanılamaz.
- `app.getProjectViewIDs()` + `app.getProjectViewSelection(id)` çalışıyor.
- `sequence.getSelection()` sağlam — seçili klibin video+audio parçasını ayrı ayrı verir
  (aynı `nodeId`, `mediaType` farklı). Ana giriş yolu bu olacak.
- `TrackItem` yüzeyinde `isMGT()`, `getMGTComponent()`, `getSpeed()`, `remove()` var.

**`importMGT` hızı: medyan 433 ms/klip** (25 import, 389–649 ms arası).
→ 350 klip ≈ 152 sn · 600 klip ≈ 260 sn · 1400 klip ≈ 606 sn.

**Hızlı yol yok.** MOGRT projeye item olarak düşmüyor: `clip.projectItem = null`,
kök item sayısı import öncesi/sonrası 34 → 34. Dolayısıyla `overwriteClip(projectItem)`
ile ucuz çoğaltma mümkün değil.

**QE DOM tam çalışıyor.** `addTracks(1,10,0,0,0,0)` → track 10→11, `setName("ODIUM SUBS")`
yazıldı ve geri okundu. Kullanılabilir yüzey: `removeVideoTrack`, `removeEmptyVideoTracks`,
`getVideoTrackAt().insert/overwrite/setName`, `trackItem.remove/move/moveToTrack/addVideoEffect/getProjectItem`.

**MOGRT'ın iki cinsi var — kritik bulgu.** `.mogrt` bir zip; içindeki `definition.json`
`authorApp` alanını taşıyor:

| | `authorApp: "ppro"` | `authorApp: "aefx"` |
|---|---|---|
| İçerik | `project.prgraphic` | `project.aegraphic` |
| Timeline'da | düz Premiere grafiği (Text + Shape component'leri) | Essential Graphics parametreli MOGRT |
| `getMGTComponent()` | **null** | (ölçülecek — Probe 6) |
| `fonteditinfo.capPropFontEdit` | `false` | **`true`** (`fontEditValue: "BebasNeue-Regular"`) |

Premiere'de yazılan şablon plugin için kullanılamaz: `Source Text` opak bir blob olarak
duruyor, Essential Graphics parametresi yok. **AE şablonu zorunlu** — karar 9 doğrulandı.
Font düzenlemesi AE tarafında açılabiliyor — karar 10'daki risk kalktı.

**Bonus:** `definition.json` panelden okunabilir (zip). Şablonun parametre isimlerini ve
sırasını Premiere'e hiç dokunmadan öğrenebiliriz — M3'te parametre eşlemesi için kullanılacak.

### Probe 6 — AE şablonu her iki cephede de kazanıyor

| Şablon | authorApp | Medyan | MGT parametre |
|---|---|---|---|
| Sports Lower Third Side | aefx | **97 ms** | 12 |
| Sports Graphic Overlay | aefx | **110 ms** | 9 |
| Basic Title | ppro | 369 ms | yok |
| Modern Web Caption | ppro | 378 ms | yok |

**AE şablonu 4 kat hızlı.** Yeni tahminler: 350 klip 34 sn · 600 klip 58 sn ·
**1400 klip 136 sn**. Karar 14'ün "uzun videoda animasyon yok" kısıtı büyük ölçüde kalktı;
eşik uyarısı ve In/Out modu yine kalacak ama artık 40 dk da basılabilir.
İlk import 2333 ms (soğuk yükleme), sonrakiler ~95 ms — şablon başına tek seferlik bedel.

`ComponentParam` yüzeyi: `getValue/setValue`, `getColorValue/setColorValue`,
`addKey/setValueAtKey/setTimeVarying/getKeys` — klip içi keyframe bile mümkün.

**AÇIK: metin yazma mekaniği henüz doğrulanmadı.** Probe 6 index 0'daki `"Text"`
parametresine yazıp aynısını geri okudu, ama Program Monitor'de yazı değişmedi
(hâlâ "SPORTS TEAM"). Index 0 büyük ihtimalle grup başlığı. Gerçek metin `[1] "Title"` /
`[2] "Subtitle"` parametrelerinin JSON blob değerinin içinde:
`{"capPropFontEdit":true,"capPropFontSizeEdit":false,"fontEditValue":["BebasNeue-Regular"],...}`.
Probe 7 bunu, klip süresi değiştirmeyi ve Motion Position/Scale yazmayı ölçüyor.

## M1 ölçüm sonuçları (gerçek dosya, Premiere'e dokunmadan)

**Kurulum:** `Faster-Whisper-XXL_r245.4_windows.7z`, 1358 MB. GitHub API'den seçildi.
Windows'un `tar.exe`'si (bsdtar 3.8.4 + liblzma) 7z'yi sorunsuz açtı — 7-Zip gerekmedi.
Kurulum yeri: `tools/faster-whisper-xxl/Faster-Whisper-XXL/faster-whisper-xxl.exe`.

**Bayraklar `--help` ile teyit edildi.** `--word_timestamps`, `--vad_filter`,
`--output_format json`, `--initial_prompt`, `--language`, `--model`, `--device`,
`--compute_type` hepsi var. `--print_progress` ve `--beep_off` değersiz bayrak.

**Hız: 32.7 ses saniyesi/sn** (RTX 3060 Ti, `large-v3-turbo`, CUDA).
→ 10 dk video ≈ 18 sn · 40 dk video ≈ 73 sn. Model ilk çalıştırmada iniyor (1.62 GB, ~18 sn).

**Kalite farkı gerçek.** Aynı 60 sn Türkçe konuşma:

| Model | Çıktı |
|---|---|
| `tiny` | "Sonuna intruyu şekeriz" · "programın ispili" · "Mikhemler" |
| `large-v3-turbo` | "Sonra introyu çekeriz" · "programın ismini" · "Mükemmel" |

Türkçe karakterler SRT'ye kadar bozulmadan geliyor.

**Öbekleme ölçüldü:** 2.8 kelime/öbek, 1.22 sn ortalama — karar 7'nin hedeflediği aralık.

**Tuzak: çıkış kodu güvenilmez.** r245.4 işini bitirip JSON'u yazıyor, sonra kapanırken
`0xC0000409` (3221226505, stack buffer overrun) ile çöküyor — PyInstaller paketlerinde
bilinen kapanış hatası. Çıkış koduna bakıp başarısız saysak her transkripsiyon boşa
giderdi. Artık çıktı geçerliyse başarı sayılıyor, kod sadece loglanıyor.

## Açık bilinmeyenler (M0 bunları ölçüyor)

1. `importMGT` klip başına ms → animasyonlu modun eşiği
2. MOGRT parametreleri isimle görünüyor mu, font yazılabiliyor mu
3. QE DOM `addTracks` / `setName` / klip silme 26.0.2'de çalışıyor mu
4. Seçim okuma API'si hangisi, tick birimi ve occurrence eşleme formülü doğru mu

## Kullanıcıdan beklenenler

1. M0 probe loglarının çıktısı (4 dosya)
2. Test projesi: Türkçe konuşmalı, kesilmiş kurgu, 2–5 dk `.prproj` + medya
3. AE şablonu — M3'ten önce, tarif yazılacak (comp ayarları, size 75→125→100 + fade,
   motion blur / shutter angle 360, Responsive Design–Time, Essential Graphics parametre isimleri)
