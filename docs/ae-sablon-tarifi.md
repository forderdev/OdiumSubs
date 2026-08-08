# AE şablon tarifi — Odium Subs

Bu dosya, plugin'in kullanacağı `.mogrt` şablonlarının nasıl yapılacağını anlatır.
Buradaki isimler **sözleşme**: plugin parametreleri isimle arıyor, tek harf farkı
o şablonu sessizce yazısız bırakır.

Neden AE: Premiere'de yazılan `.mogrt` timeline'a düz grafik olarak açılıyor,
Essential Graphics parametresi taşımıyor (`getMGTComponent()` → `null`) ve
4 kat yavaş basılıyor. Ölçümler: [DECISIONS.md](../DECISIONS.md).

**Son kullanıcıda AE gerekmez.** Premiere 13.0+ AE şablonlarını kendi render eder.
AE sadece şablonu yazarken lazım.

---

## 1. Komp ayarları

| Ayar | Değer |
|---|---|
| Boyut | 1920 × 1080 |
| Frame rate | 30 fps (Premiere sequence'ından bağımsız, MOGRT uyum sağlar) |
| Süre | 3 sn (giriş + çıkış rahat sığsın) |
| Arka plan | şeffaf kalacak — solid katman koyma |
| **Motion blur** | Komp ayarları → **Motion Blur sekmesi → Shutter Angle = 360** |

Zaman çizelgesinde **Enable Motion Blur** düğmesi açık olmalı, ve animasyonlu
katmanın kendi motion blur anahtarı da açık olmalı. İkisi birden açık değilse blur çıkmaz.

---

## 2. Katman yapısı

```
[1] TEXT      — metin katmanı (asıl altyazı)
[2] BG        — arka plan kutusu (shape layer, opsiyonel)
```

- `TEXT` katmanı: paragraf hizası **ortalı**, anchor point yazının **merkezinde**
  (Layer → Transform → Center Anchor Point in Layer Content). Zoom animasyonu
  merkezden büyümezse yazı yana kayar.
- `BG` katmanı: `TEXT`'in altında. Boyutu yazıya göre otomatik büyüsün istiyorsan
  expression'la bağla, istemiyorsan sabit bırak (öbek modunda yazılar kısa, sabit yeter).

---

## 3. Giriş animasyonu (senin verdiğin spek)

`TEXT` katmanının **Scale** ve **Opacity** özelliğine keyframe:

| Zaman | Scale | Opacity |
|---|---|---|
| 0 f | 75 % | 0 |
| 4 f | 125 % | 100 |
| 8 f | 100 % | 100 |

- Keyframe'leri seç → **F9** (Easy Ease). Sonra Graph Editor'de çıkış eğrisini
  biraz dikleştir — pop hissi oradan gelir.
- Motion blur bu ölçekte kendini gösterir; komp shutter angle 360 olduğu için ayrıca
  bir şey yapmana gerek yok.

## 4. Çıkış animasyonu

Kompun sonundan geriye doğru, 6 frame:

| Zaman | Scale | Opacity |
|---|---|---|
| son − 6 f | 100 % | 100 |
| son | 90 % | 0 |

---

## 5. Responsive Design – Time (atlanırsa animasyon bozulur)

Plugin klip süresini öbeğin süresine çekiyor (0.6 sn – 2.5 sn arası değişken).
Koruma yoksa uzatma/kısaltma animasyonu ortadan böler.

1. **Window → Essential Graphics** → **Responsive Design – Time** bölümü
2. **Intro** süresi = giriş animasyonunun bittiği ana kadar (8 frame)
3. **Outro** süresi = çıkış animasyonunun başladığı andan sona (6 frame)

Böylece klip uzayıp kısaldığında sadece ortadaki sabit kısım esner.

---

## 6. Essential Graphics parametreleri — SÖZLEŞME

Essential Graphics panelinde şablonun adını yaz, sonra aşağıdakileri **tam bu isimlerle** ekle.
İsim değiştirmek serbest değil; plugin bunları isimle arıyor.

| Parametre adı | Nasıl eklenir | Zorunlu |
|---|---|---|
| `Text` | `TEXT` katmanının **Source Text** özelliğini panele sürükle | **evet** |
| `Fill Color` | `TEXT` → Text → Animator → Fill Color, ya da doğrudan renk özelliği | hayır |
| `Stroke Width` | `TEXT` stroke genişliği (0 = kapalı) | hayır |
| `Stroke Color` | `TEXT` stroke rengi | hayır |
| `BG Opacity` | `BG` katmanının Opacity'si (0 = kutu yok) | hayır |

**Font ve boyut ayrı parametre değil.** `Source Text`'i panele eklediğinde AE onun
yanında font düzenleme kutucuklarını da gösterir:

- **Font** kutucuğunu işaretle → `capPropFontEdit: true`
- **Font Size** kutucuğunu işaretle → `capPropFontSizeEdit: true`

İkisi de işaretli olmalı. Plugin fontu ve boyutu bu parametrenin içinden yazıyor:

```json
{"capPropFontEdit":true,"capPropFontSizeEdit":true,"capPropTextRunCount":1,
 "fontEditValue":["Montserrat-Bold"],"fontSizeEditValue":[64],
 "fontTextRunLength":[20],"textEditValue":"Merhaba dünya ÇĞİÖŞÜ"}
```

`fontTextRunLength` = metnin karakter sayısı. Plugin bunu her yazımda güncelliyor
(Probe 8'de doğrulandı — güncellenmezse stil metnin bir kısmına uygulanmıyor).

> Konum ve boyut **şablon parametresi değil**: plugin klibin Motion efektine
> (`Position`, `Scale`) yazıyor. Yani ekranda aşağı/yukarı/sağ/sol ve genel büyüklük
> şablondan bağımsız çalışıyor, sen bunlar için parametre eklemeyeceksin.

---

## 7. Export

`File → Export → Motion Graphics Template…`

- **Destination:** Local Templates Folder (test için) — sonra `.mogrt` dosyasını
  depodaki `templates/` klasörüne kopyala
- **Compatibility:** uyarı çıkarsa hangi efektin desteklenmediğini söyler.
  Desteklenmeyen efekt varsa **çıkar** — yoksa son kullanıcıda "After Effects gerekli"
  hatası verir. Scale/Opacity/motion blur zaten sorunsuz.

---

## 8. Yapılacak dört şablon

Hepsi aynı parametre sözleşmesini taşıyacak, sadece animasyon farkı olacak:

| Dosya | Giriş | Çıkış |
|---|---|---|
| `odium-zoom-pop.mogrt` | 75 → 125 → 100 scale + fade | 100 → 90 scale + fade |
| `odium-slide-up.mogrt` | alttan 40 px yukarı + fade | yukarı 20 px + fade |
| `odium-bounce.mogrt` | 60 → 115 → 95 → 100 (overshoot) | küçülerek fade |
| `odium-flat.mogrt` | animasyon yok, anında görün | anında kaybol |

`odium-flat` en hızlı ve en güvenli olan; uzun videolarda varsayılan öneri o olacak.

---

## 9. Şablonu test etme

Panelde `8 · Dogru yazma yolu` bölümüne şablonun yolunu ver, çalıştır. Beklenen:

```
[n] "Text" -> metin parametresi
    SONUC: metin dogru=EVET | font korundu=EVET
```

`metin parametresi` satırı hiç çıkmıyorsa `Source Text` panele eklenmemiş demektir.
`font korundu=HAYIR` ise font kutucuğu işaretlenmemiştir.
