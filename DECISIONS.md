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
