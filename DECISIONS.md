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

## M2 doğrulaması — gerçek Premiere'de uçtan uca (2026-08-10)

Panel Premiere 26.0.2 içinde sürülerek test edildi. Temiz test projesi
(`D:\Temp\odium-test.prproj`), kaynak `D:\andre.mp4` (5:10, Türkçe konuşma).

| Adım | Sonuç |
|---|---|
| `PP_getSelection` | Klip, dosya yolu, sequence, "1 kullanım" — doğru |
| Ses çıkarma | 5:10 → 9.5 MB, 16 kHz mono WAV |
| Transkripsiyon | 90 segment, **308 kelime**, dil `tr` |
| Öbekleme | **110 öbek** |
| Editör | Birleştirme doğru: 110 → 109, süre `0:10.22–0:12.54` olarak birleşti |
| SRT | 6.2 KB, sequence zamanına çevrilmiş |
| `createCaptionTrack(item, "0")` | **İlk varyant tuttu**, `boolean` döndü |
| Caption track | `C1 Subtitle` oluştu, 109 altyazı yerleşti |
| Ekranda | `Nereden buldun bu herifi?` — videoya gömülü `Where did you find this guy?` ile aynı anda |

**Karar 4'ün klasik altyazı yolu tamamlandı.** Kalan: MOGRT modu (M3).

Ortam notu: uzaktan bağlantıda ekran 1280×720'ye düşüyor, Premiere 1024×768
istiyor ve uyarı veriyor (çalışmaya engel değil). Panel penceresi 802 px yüksekti,
ekrana sığmadığı için 700 px'e çekildi. Panel varsayılan yüksekliği bu yüzden
manifest'te gözden geçirilmeli.

## M3 doğrulaması — MOGRT yerleştirme (2026-08-10)

Adobe'nin AE şablonuyla (`[AE] Sports Lower Third Side.mogrt`) test edildi;
kendi şablonumuz henüz yok ama parametre sözleşmesi aynı.

| Ölçülen | Sonuç |
|---|---|
| Öbek sayısı | 112 (5:10 video, 310 kelime) |
| Yerleşen klip | **112, 0 hata** |
| Metin yazma yolu | `blob` — JSON blob parse edilip yazıldı, font korunur |
| Klip süresi | Tooltip: `Duration 00:00:02:08` — öbek süresine çekilmiş |
| Track | `MZ.TrackName = ODIUM SUBS`, Index 3 (V4), QE ile açıldı ve adlandırıldı |
| Kaydedilmiş projede | ODIUM SUBS track'inde **112 TrackItem** |
| Paketleme | 40'lık paketler, panel ilerleme çubuğu akıyor, Premiere donmuyor |

### Kendi şablonumuzla doğrulama (`odium-zoom-pop.mogrt`)

Şablon sözleşmeye birebir uyuyor: `authorApp: aefx`, tek kontrol `type=6` adı **`Text`**,
`capPropFontEdit: true`, `capPropFontSizeEdit: true`, gömülü font `FredokaOne-Regular`, punto 90.

| Ölçülen | Sonuç |
|---|---|
| Track temizleme | `Temizlendi: 112 klip` — QE ile eski içerik silindi |
| Yerleşen | **109 klip, 0 hata** |
| Ekranda | `Üstüne dublej alamam.` · `İşi bilenlerle çalışmak` — doğru zamanda |
| Türkçe glifler | İ, ş, ı, ç, ö, ü hepsi tek fontta, düşme yok |
| Font override | `Montserrat-Black` uygulandı (şablonun Fredoka'sı ezildi) |
| Motion Position | `istenen=0.5,0.82 → sonrasi=0.5,0.82` — konum doğru yazılıyor |

**Performans notu:** bu çalıştırmada klip başı **391 ms** (109 klip / 43 sn), oysa boş
sequence'te Adobe şablonuyla 97 ms ölçülmüştü. Aradaki fark sequence doluluğundan
geliyor gibi — 4 video track, 1 caption track, yüzlerce klip. Karar 14'ün eşiği
bu gerçek sayıya göre gözden geçirilmeli: 391 ms ile 1400 klip 9 dakika eder.

**Fredoka One uyarısı geçerliliğini koruyor:** şablonun gömülü fontu hâlâ Fredoka One.
Panel font alanı boş bırakılırsa Türkçe'de Ç/Ğ/Ş bozulur. Ya şablonu Montserrat ile
yeniden export et, ya panelde font alanını hep dolu tut.

### Bulunan iki hata (düzeltildi)

1. **`window.confirm` paneli kilitliyor.** CEP panelinden açılan native onay diyalogu
   bu ortamda gövdesi olmayan ince bir çubuk olarak çiziliyor, tıklanamıyor ve JS
   thread'ini bloke ediyor — panel tamamen donuyor. Onaylar panel içi kutucuklara
   taşındı (`Track doluysa once temizle`, `Cok obek olsa da bas`).
2. **Kendi bastığımız altyazıları kaynak sanma.** MOGRT klipleri seçili kalınca
   (basma sonrası normal durum) kullanıcı Project panelinden başka klip seçse bile
   timeline seçimi öne geçiyordu. `PP_getSelection` artık `isMGT()` olan klipleri atlıyor.

## Arayüz yenilemesi ve font seçici (2026-08-10)

**Font seçici gerçek font listesinden.** `engine/fonts.js` kurulu font dosyalarını
(`C:\Windows\Fonts` + kullanıcı klasörü) doğrudan okuyor: sfnt/TTC `name` tablosundan
aile, alt aile ve **PostScript adı**, `cmap`'ten Türkçe glif kapsaması (Ç Ğ İ Ş ı ğ ş ç).

- 416 font, **208'i Türkçe'yi tam kapsıyor**
- İlk okuma ~1.3 sn (konsol) / 327 ms (panel, sıcak dosya önbelleği) → sonuç diske
  önbelleklenip font klasörünün değişme tarihiyle doğrulanıyor, sonraki açılışlar anında
- Kapsamayan fontlar listede `(Turkce yok)` diye işaretli — seçilirse yazı bozulur
- Kullanıcı artık PostScript adını elle yazmıyor; "Montserrat" yazıp seçiyor,
  panel `Montserrat-Black` değerini kendisi gönderiyor

**Animasyon hızı slider'ı YAPILAMADI — ölçüldü.** Premiere, MOGRT kliplerini zaman
olarak esnetmeye izin vermiyor. QE DOM'da beş yol denendi, hiçbiri klibin hızını
değiştirmedi (`item.speed` hep `1` kaldı):

| Deneme | Sonuç |
|---|---|
| `setSpeed(yüzde, "", false, false, false)` | hata yok, değer değişmedi |
| `setSpeed(oran, "", false, false, false)` | hata yok, değer değişmedi |
| `setSpeed(yüzde)` / `setSpeed(oran)` | `Not Enough Parameters` |
| `item.speed = oran` | değer değişmedi |

Slider kaldırıldı; sahte kontrol bırakmak yanıltıcı olurdu. Yerine panelde açıklama var:
hız şablonun keyframe'lerinden gelir, farklı hız için ikinci bir şablon export edilir
(`odium-zoom-pop-hizli.mogrt`). Şablon listesi zaten `templates/` klasörünü okuduğu için
varyantlar kendiliğinden görünür.

### Dağıtımı üç saat kaybettiren hata

Kurulum paketinin **kaldırma testi `PlayerDebugMode`'u sildi** (`.iss` içinde
`uninsdeletevalue` bayrağı vardı). O andan itibaren CEP imzasız uzantı için HTML
motorunu hiç başlatmadı: panel çerçevesi açılıyor, içerik boş, log'da hiçbir hata yok.

Teşhisi zorlaştıran şey: `CEPHtmlEngine` süreçleri arasında bizim uzantımıza ait bir
süreç olup olmadığına bakmak sorunu tek adımda gösterdi — panel çerçevesinin açılması
uzantının yüklendiği anlamına gelmiyor.

`.iss` düzeltildi: **`PlayerDebugMode` asla silinmiyor.** Bu ayar makine genelinde;
kaldırma sırasında silinirse aynı makinedeki diğer imzasız CEP panelleri de açılmaz olur.

Ayrıca: sürüm numarasını PowerShell ile değiştirirken `manifest.xml`'e **UTF-8 BOM**
eklendi, `<?xml` öncesi BOM manifesti geçersiz kılıyor. Kaynak dosyaları PowerShell
`Set-Content` ile düzenlemekten kaçınılmalı.

## Renk ayarı (2026-08-10)

Şablona `Animate ► Fill Color > RGB` ile bir renk animatörü eklenip Essential
Graphics'e verildi. AE parametreyi **`Animator 1 Fill Color`** diye adlandırıyor,
bu yüzden panel isme tam eşleme yapmıyor: içinde `color`/`colour`/`renk` geçen ilk
parametreyi kullanıyor.

**Yazma yolu ve argüman sırası ölçüldü:**

| Deneme | Sonuç |
|---|---|
| `setValue([r,g,b,a])` 0-1 dizi | `Illegal Parameter type` |
| `setColorValue(255, 212, 0, 255)` — (r,g,b,a) sanılarak | ekranda **macenta** |
| `setColorValue(255, 255, 212, 0)` | ekranda **kırmızı** |
| `setColorValue(alpha, r, g, b)` = `(255, 255, 212, 0)` | ekranda **sarı** ✓ |

Doğru imza: **`setColorValue(alpha, red, green, blue, updateUI)`**, değerler **0-255**.
İlk argüman alpha olduğu için (r,g,b,a) varsayımı bütün kanalları bir sola kaydırıyor —
Probe 8'de Adobe şablonunda görülen mor da aynı kaymaydı, o zaman yanlış teşhis etmiştim.

Panelde renk seçici: `<input type="color">` + 6 hazır renk + "uygula" kutucuğu.
Şablon renk parametresi taşımıyorsa log'a "renk parametresi yok, atlandı" düşer,
basma işlemi bozulmaz.

## Nest desteği (2026-08-11)

**Sorun:** nest'lenmiş klip seçilince `clip.projectItem` bir **sequence** dönüyor,
medya dosyası değil. `getMediaPath()` boş, panel "dosya yolu yok" deyip kalıyordu.

**Çözüm iki parçalı:**

1. `PP_sequenceForItem` — bir project item'ın sequence olup olmadığını
   `app.project.sequences` içinde nodeId eşleyerek anlıyor.
2. `PP_walkOccurrences` — sequence ağacında yürüyor, nest'lerin içine iniyor
   (derinlik sınırı 3) ve her kullanımı **dış sequence koordinatlarına** çeviriyor.

Zaman çevrimi iki kademe:

```
medya zamanı m  ->  iç sequence:  n = innerStart + (m - innerIn)
iç sequence n   ->  dış sequence: o = nestStart  + (n - nestIn)
```

Yürüyüşte iki şey taşınıyor: `shift` (bu sequence zamanına eklenince dış zamanı verir)
ve `win` (bu sequence zamanında gerçekten görünen aralık — nest kırpılmışsa dışarıda
kalan kısım sayılmamalı). Çıktı normal occurrence ile aynı biçimde
(`start`, `inPoint`, `outPoint`), böylece `chunker.mapToSequence` **değişmeden** çalışıyor.

Nest birden fazla kaynak içerebilir; `PP_dominantSourceInSequence` süreye göre en çok
yer kaplayanı seçiyor ve panel kaç kaynak bulunduğunu yazıyor.

**Gerçek Premiere'de doğrulandı:**

| Adım | Sonuç |
|---|---|
| Nest seçimi | `andre.mp4` bulundu, "Nested Sequence 01 nest'i içinden seçildi" |
| Basma | 111 klip, ekranda doğru zamanda |
| Nest 99.167 sn sağa kaydırıldı | SRT: öbek 1 `0:04.88` → `00:01:44,047` |
| Kayma tutarlılığı | Öbek 2 de tam 99.167 sn kaymış |

## Ses track'indeki klipler (2026-09-01)

**Sorun:** efektli mod "Klip timeline'da bulunamadı - efektli mod sequence konumu
gerektiriyor." diyip duruyordu. `PP_walkOccurrences` yalnızca `seq.videoTracks`
geziyordu; ses dosyaları, videosu silinmiş kayıtlar ve sadece A1'e atılmış
voiceover'lar hiçbir zaman bulunmuyor, occurrence sayısı 0 kalıyordu. SRT modu
kaynak zamanına düştüğü için çalışıyor, MOGRT modu düşemediği için duruyordu.

**Çözüm:** `PP_trackGroups` video + audio track'lerin ikisini de veriyor;
`PP_walkOccurrences` ve `PP_dominantSourceInSequence` bu grupların üzerinden
yürüyor. Bulunan kayıtlar `audio` bayrağı taşıyor, panel "N yerde (ses track'i)"
yazıyor.

**Neden eleme gerekti:** A/V bağlı klip hem video hem audio track'te duruyor, yani
aynı yer iki occurrence üretiyor ve her öbek iki kez basılırdı. `PP_sameMapping`
aynı kaymaya (`start − inPoint`, 10 ms tolerans) sahip ve zamanda örtüşen
kayıtlardan yalnızca ilkini tutuyor; video kayıtları önce sıralandığı için tutulan
hep video oluyor. Aynı kaynağın timeline'daki başka kullanımı farklı kayma taşıdığı
için elenmiyor. Nest'in `seconds` sayımı da artık video/ses ayrı tutulup
`max` alınıyor — toplasaydı A/V kaynak iki kat uzun görünürdü.

## Arşiv açıcı zinciri (2026-09-01)

**Sorun:** kurulum "sadece 7-Zip kabul ediyor" gibi davranıyordu. `findExtractor`
yalnızca `Program Files-Zipz.exe` ve `tar.exe` biliyordu; 7-Zip kurulu
olmayan makinede tar.exe'ye düşüyor, bsdtar Faster-Whisper arşivinin BCJ2
filtresini çözemediği için kod ≠ 0 ile patlıyordu. Kaynakta `.zip` varlık yok,
tek dağıtım biçimi `.7z`.

**Çözüm:** `findExtractors` sıralı aday listesi döndürüyor —
7-Zip / winget shim / NanaZip / PeaZip / Bandizip / PATH'teki `7z|7za|7zr.exe`,
sonra **WinRAR** (7z açıyor, Türkiye'de çok yaygın), en son `tar.exe`.
`extractArchive` adayları sırayla deniyor, hepsi düşerse 7-Zip'in tek dosyalık
konsol sürümünü (`7zr.exe`, ~600 KB, 7-zip.org) `tools/` içine indirip son bir
deneme yapıyor. İnen dosya boyut + `MZ` başlığıyla doğrulanıyor, geçersizse
siliniyor. `allowExtractorDownload: false` ile indirme kapatılabilir.

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
