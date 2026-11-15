# Planhane mimari bilgi tabanı

Bu not, uygulamanın plan/kesit/cephe/3D üretimini "eğitmek" için okunan kaynaklardan damıtılan kuralları toplar.
Model ince ayarı (fine-tuning) yapılmaz: kurallar iki yere işlenir:

1. **Claude istemi** (`src/shared/prompt.ts`): Claude notlardan programı çıkarırken kütle biçimini (`massing`) ve yerleşim kararlarını bu kurallarla seçer.
2. **Deterministik çizim motoru** (`src/geometry/massing.ts`, `layout.ts`): seçilen kütle, planda, kesitte, cephede, 3D'de, DXF ve IFC'de aynı biçimde çizilir.

Belirli bir yayımlanmış projenin planı kopyalanmaz; yalnız genel örüntüler ve ölçü kuralları alınır.

## 1. Kütle örüntüleri (çağdaş konut)

| Örüntü | Uygulamadaki karşılığı | Ne zaman |
|---|---|---|
| Üst kat konsolu, altında giriş | `on_konsol`: zemin kat ön şeridi geri çekilir, üst kat taşar, altı **Giriş Sundurması** | Modern üslup, girişi vurgulamak, yağmurdan korunan giriş/araç önü |
| Bahçe tarafında gölgeli kapalı teras | `arka_konsol`: zemin kat arka şeridi geri çekilir, altı **Kapalı Teras** | Bahçe güneye bakıyorsa: yaz güneşini keser, kış güneşini alır |
| Yana taşan üst kat | `yan_konsol`: zemin kat sağ şeridi geri çekilir, altı **Araç Sundurması** | Yan bahçe ≥ 5 m |
| Kademeli kütle, çatı terası | `ust_kat_teras`: en üst kat bahçe tarafında küçülür, alt katın çatısı **Teras** olur | Manzara, teras isteği; düz çatı |
| L kütle + avlu | `kose_oyugu`: arka sağ köşe bütün katlarda oyulur, zeminde **Avlu**, üstte boşluk | Geniş arsa, mahremiyet, sıcak-kuru iklim; düz çatı |

Kaynaklar: L planda uzun kanatta gündüz, kısa kanatta gece mekânları, köşede sirkülasyon/servis düğümü ve kanatların sardığı korunaklı avlu ([ArchUp – L-shaped house](https://archup.net/l-shaped-house-massing-and-context/));
konsolun konuttaki kullanımları: korunaklı yürüyüş yolu ve güney cephesini gölgeleme, araç sundurması, manzaraya uzanan oda, pencere çıkması ([Construction Dive](https://www.constructiondive.com/news/the-leading-edge-8-ways-to-use-cantilevers-in-residential-design/431307/)).

## 2. Yönetmelik (Planlı Alanlar İmar Yönetmeliği md. 41 – Çıkmalar)

- Kapalı çıkma yol cephesinde yapı yaklaşma sınırından en fazla **1,50 m** taşabilir; arka ve yan bahçede 1,50 m, parsel sınırına **3,00 m**'den fazla yaklaşamaz. Bitişik nizamda açık çıkma komşu sınırına 2,00 m'den fazla yaklaşamaz.
- Çıkmanın altı ile zemin arasında en az **2,40 m** düşey mesafe olmalıdır.
- Motif çıkma ≤ 0,20 m, güneş kırıcı ≤ 0,50 m, giriş saçağı ≤ 2,50 m (alt kotu ≥ 2,50 m).
- Uygulama: konsol varsayılanı 1,5 m; zemin kat geri çekildiği için üst kat taşması taban alanı dışında kalır, TAKS zemin katın gerçek oturumundan hesaplanır.

Kaynaklar: [imarx – Madde 41 özeti](https://www.imarx.com.tr/imar-yonetmeligi-madde-41-acik-ve-kapali-cikma/), [mevzuat – Madde 41](https://mevzuat.mturkoglu.av.tr/belge/23722/madde/41). Yerel plan notları bu değerleri değiştirebilir; imar durumu belgesi esastır.

## 3. Yönlenme, güneş ve iklim

- Yaşam mekânları güney / güneydoğu / güneybatı; mutfak, kiler ve serin kalması gereken hacimler kuzey ([Habitat Derneği – Güneş Mimarlığı](https://www.habitatdernegi.org/wp-content/uploads/2023/06/Gunes_Mimarligii.pdf)).
- Güney cephede büyük, kuzey/doğu/batıda küçük açıklıklar; doğu-batı alçak güneşten yatay saçakla korunamaz → dikey güneş kırıcı.
- İklim: sıcak-kuru → kalın duvar, avlu, düz çatı; nemli → geniş saçak, çapraz havalandırma; soğuk → kompakt plan, küçük pencere.
- Saçak derinliği P = H / (tan β_yaz − tan β_kış); 36° enlemde P ≈ 0,39 H (2,2 m pencere → ≈ 0,9 m). 1,5 m konsol güney cephesini rahatça gölgeler ([ARE – passive solar](https://open-exam-prep.com/study-guides/are/ch14-ppd-envelope-materials-cost/ppd-passive-solar-ventilation-daylight)).
- Gün ışığı yan pencereden lento yüksekliğinin ≈ 1,5–2 katı derinliğe ulaşır; cam alanı döşeme alanının %10–20'si.

## 4. Plan kuralları

- Üç bölge: gündüz (salon, yemek, antre), gece (yatak, banyo), servis (mutfak, çamaşır, depo) ([build-construct – floor planning](https://build-construct.com/architecture/floor-planning-principles-of-functional-space-layout-and-room-arrangement-in-residential-design/)).
- Oda en/boy oranı çoğu mekânda ≤ 1,5:1; koridor ≥ 0,9 m (erişilebilir yol ≥ 1,07 m).
- Islak hacimler katlarda üst üste; sirkülasyon net alanın %10–15'i.

## 5. Motorun güvenceleri

- Oyma yalnız odanın dış cepheye değen kenarından yapılır; oda dikdörtgen kalır, kapılar ve erişim bozulmaz.
- Oyulduktan sonra asgari ölçünün (PAİY md. 29'dan sadeleştirilmiş) ya da istenen alanın %82'sinin altına düşecek oda oyulmaz; konsol hattı, kesintisiz en uzun oda dizisinden (girişi içeren dizi önceliklidir) seçilir.
- Konsol seçilince oturum konsolun %60'ı kadar derinleşir (zemin kat odaları küçülmez, fark üst katta çıkma olur); köşe oyuğunda oturum avlu kadar genişler.
- `npm run test:layout` kütle birleşimlerini rastgele konutlarda dener: oyuk ile çakışma, erişim, dış açıklığın dış duvarda olması denetlenir.

## 6. Üslup paketleri, cephe ayrıntıları, güneş (v0.13.0)

- `src/stylepacks.ts`: Modern minimal, Çağdaş avlulu, Akdeniz / Ege, Bodrum evi, İskandinav, Taş ev, Endüstriyel. Paket çatıyı, malzemeyi, renkleri, pencere biçimini, cephe ayrıntılarını ve kütleyi birlikte ayarlar; odalara dokunmaz.
- `facade.details`: pergola, gunes_kirici, giris_cercevesi, kutu_cerceve, cati_feneri (3D modelde çizilir).
- Güneş çalışması (`src/geometry/sun.ts`): 39° enlem, ay ve saate göre güneş yüksekliği/azimutu; bahçe cephesinin yönü arsa yön metninden okunur.
- İmar kontrolüne md. 41 çıkma satırları ve DXF vaziyet paftasına "İmar özeti" tablosu eklendi.

## 7. Galeri, kaydırılmış kutular, çekme kat, havuz, eğimli arsa (v0.16.0)

- `galeri`: zemin kattaki boydan boya salonun üstünde üst kat döşemesi açılır ("Galeri Boşluğu"); dış duvarlar sürer, üst kat holü cam korkulukla salona bakar. Oturum boşluk kadar büyür.
- `kaydirilmis_kutu`: zemin kat sağdan, en üst kat soldan geri çekilir; bir yanda konsol, öbür yanda alt katın çatısında teras oluşur.
- `cekme_kat` (apartman): en üst kat sokak ve bahçe cephesinde 1,5–3 m geri çekilir, daireler daralan derinliğe yeniden yerleşir, çıkma balkon yerine teras kapısı açılır. En üst kat dubleks üst katıysa uygulanmaz.
- Havuz: programda adı "Havuz" olan dış mekân ya da "Havuz" seçeneği; arka bahçeye (sığmazsa yan bahçeye) çekme mesafeleri içinde verandasıyla yerleşir; vaziyet planı, 3D ve DXF'te çizilir.
- Eğimli arsa: `site.slope` / `design.slope` (%; sokaktan arkaya artı yükselir). Bina düz bir platforma oturur; kesitte doğal zemin kesikli çizgiyle, arkadaki kot farkı ve istinat hattıyla gösterilir; yan ve arka cephelerde, 3D'de ve DXF'te zemin eğimlidir. Kademeli (yarım kat kaydırmalı) plan henüz üretilmez.
