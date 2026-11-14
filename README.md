# Planhane

Mimarın müşteri görüşmesinde aldığı notlardan, tek tuşla ön tasarım çizim seti üreten web uygulaması.

**Akış:** görüşme notu (yazarak ya da Türkçe sesli dikteyle) → Claude API notlardan yapılandırılmış **bina programı** çıkarır (mekânlar, alanlar, kat dağılımı, imar değerleri, varsayımlar, müşteriye sorulacak sorular) → uygulama aynı modelden **kat planlarını, A-A kesitini, 4 cepheyi, vaziyet planını, 3D modeli** ve **TAKS/KAKS/çekme mesafesi kontrolünü** deterministik olarak üretir.

Program ekranında oda alanlarını, oturum ölçüsünü, kat yüksekliğini, çatı tipini değiştirdiğinizde bütün çizimler anında güncellenir. "Notlarla güncelle" mevcut programı koruyarak yeni notları uygular.

## Satış (abonelik) sürümü

v0.6'dan itibaren Planhane, sizin barındırdığınız **Planhane Bulut** sunucusu üzerinden aylık abonelikle satılır: mimar e-postasıyla hesap açar, ücretsiz dener, havale/EFT ile öder; abonelik yönetim panelinden açılır. Claude ve render ücretini sunucu öder, her hesabın aylık üretim/render hakkı sunucuda tutulur. Kurulum ve günlük işleyiş: **[docs/SATIS-KURULUM.md](docs/SATIS-KURULUM.md)**.

```bash
cp cloud/.env.example .env   # ANTHROPIC_API_KEY ve ADMIN_TOKEN girin
npm run cloud:dev            # http://localhost:8080  (/, /app, /admin)
```

Sunucu kodu `cloud/` (hesap, kota, işler, yönetim API'si), tanıtım sitesi ve yasal metinler `site/`, yönetim paneli `cloud/public/admin/`. Yayına alma: `Dockerfile`, `render.yaml`, `deploy/docker-compose.yml`. Uygulamalar derlenirken `VITE_CLOUD_URL` (GitHub'da `CLOUD_URL` değişkeni) verilmezse eskisi gibi kullanıcının kendi API anahtarıyla çalışır.

## Windows masaüstü uygulaması

`Planhane-Kurulum-0.1.0.exe` kurulum dosyasıdır (masaüstü ve Başlat menüsü kısayolu oluşturur). `Planhane-Tasinabilir-0.1.0.exe` kurulum gerektirmeden çalışır.

- İlk açılışta **Ayarlar** penceresi Claude API anahtarını ister. Anahtar Windows kullanıcı hesabınıza bağlı şifreleme (DPAPI) ile yalnızca bu bilgisayarda saklanır.
- **AutoCAD'de aç**: planlar, A-A kesiti, 4 cephe ve vaziyet planını tek bir DXF dosyasına yazar, `Belgeler\Planhane\<proje>` klasörüne kaydeder ve DXF ile ilişkili programda (AutoCAD) açar. Birim m / cm / mm seçilebilir (varsayılan cm).
- DXF katmanları `MN-` önekiyle ayrılır: DUVAR, DUVAR-DOLGU (poşe), PENCERE, KAPI, MERDIVEN, MAHAL, OLCU, KESIT-HATTI, DOSEME, CATI, CEPHE, ARSA, CEKME…
- **Çizim seti (PDF)**: A3 yatay PDF olarak kaydeder.
- Sesle yazmak için imleç not alanındayken Windows'un yerleşik sesli yazmasını kullanın: **Win + H**.
- Uygulama imzasız olduğu için Windows SmartScreen ilk açılışta uyarabilir: "Ek bilgi" → "Yine de çalıştır".

Kendiniz derlemek için (Windows'ta): `npm install && npm run dist:win` → `release/` klasörü. Geliştirirken: `npm run desktop`.

## Web sürümü (geliştirme)

```bash
npm install
cp .env.example .env      # ANTHROPIC_API_KEY değerini girin
npm run dev               # arayüz: http://localhost:5173  (API: 8787)
```

Üretim için:

```bash
npm run build
npm start                 # http://localhost:8787 hem arayüzü hem API'yi sunar
```

API anahtarı olmadan da "Örnek görüşmeyi yükle" ile bütün çizimleri ve dışa aktarmaları deneyebilirsiniz.

## Çıktılar

| Çıktı | Biçim |
|---|---|
| Kat planları (ölçülü, kapı/pencere, merdiven, mobilya, kesit hattı) | SVG, PNG, DXF (tüm katlar, katmanlı; mobilya MN-MOBILYA katmanında) |
| A-A kesiti (kotlar, döşemeler, çatı) | SVG, PNG |
| Ön / arka / yan cepheler | SVG, PNG |
| Vaziyet planı + imar kontrolü | SVG, PNG |
| 3D model (çatı aç/kapa, kat seçimi, maket kesiti) | GLB, PNG |
| Alan tablosu, yaklaşık maliyet, asgari ölçü uyarıları | Alanlar & Maliyet sekmesi |
| BIM modeli (katlar, duvarlar, kapı/pencere boşlukları, döşemeler, mahaller) | IFC4 |
| Bina programı | JSON |
| Proje dosyası (notlar + program) | .planhane (eski .mimarnot dosyaları da açılır; Dosya → Kaydet / Aç, Ctrl+S / Ctrl+O) |
| Çizim seti | Tarayıcıdan PDF (A3 yatay) |

Kat Planları sekmesinde üç plan alternatifi (A: gündüz sokak tarafında, B: gündüz bahçe tarafında, C: oda sırası ters) komşuluk isteklerine ve asgari ölçülere göre puanlanır; biri seçilir. "Sınırları düzenle" ile oda sınırları ve hol bandı sürüklenerek ayarlanır. Ayarlar'a girilen ofis / mimar bilgileri tüm paftaların antetine yazılır.

### Apartman ve çok bloklu siteler (v0.4)

Müteahhit projelerinde Claude programı blok ve daire tipi olarak çıkarır (ör. A-B-C-D blokları; 2+1, 3+1, 4+1 dubleks). Her blokta katın ortasında merdiven + asansör + kat holünden oluşan çekirdek bulunur; daireler ön ve arka cepheye dizilir, yaşam mekânları ve yatak odaları cepheye, antre ve ıslak hacimler çekirdeğe bakar. Dubleks dairelerin üst katı ve iç merdiveni otomatik eklenir. Vaziyet planı blokları arsaya, çekme ve bloklar arası mesafeye göre yerleştirir; TAKS/KAKS tüm site için hesaplanır. 3D görünüm tüm siteyi, Alanlar sekmesi daire listesini (tip, adet, net alan) ve site toplamını gösterir. Planlar, kesit, cepheler, DXF ve IFC seçili blok içindir. "Örnek görüşme: 4 bloklu site" API anahtarı olmadan denenebilir.

### Notlar ekranı

"Proje bilgileri ve üslup" bölümünde arsa ve bina ölçüleri, kat ve blok sayısı, TAKS/KAKS, Hmax, çekmeler, üslup ve çatı seçilebilir; en çok 3 referans görsel eklenebilir ("bu tarz olsun"). "Düzeltme iste" kutusu üretilen projeyi yalnız istenen yerde değiştirir (geri alınabilir); üretim "Durdur" ile kesilebilir.

Kurulum sürümü (NSIS) açılışta GitHub Releases'tan yeni sürümü denetler ve indirir; taşınabilir sürüm güncellenmez.

## Yapı

```
server/index.ts          Express API: POST /api/generate → Claude (structured outputs, zod şeması)
server/prompt.ts         Claude sistem talimatı (Türk imar yönetmeliği varsayılanları dahil)
src/shared/schema.ts     Bina programı şeması (sunucu ve arayüz ortak)
src/geometry/layout.ts   Programdan deterministik yerleşim (bantlar, odalar, kapı/pencere, duvarlar; apartman çekirdeği ve daireler)
src/geometry/blocks.ts   Blok / daire tiplerini katlara açar, blok görünümleri
src/geometry/svg.ts      Plan, kesit, cephe, vaziyet SVG üreticileri
src/geometry/model3d.ts  Three.js modeli
src/geometry/dxf.ts      DXF (R12) dışa aktarma
src/geometry/zoning.ts   TAKS, KAKS, kat adedi, Hmax, çekme mesafeleri
src/App.tsx              Arayüz
```

## Yerleşim yöntemi (sınırlar)

Her kat üç banda ayrılır: sokak tarafı (gündüz mekânları), ortada 1.25 m'lik dar koridor, bahçe tarafı (gece mekânları). v0.9 itibarıyla merdiven koridora dik, kendi bant kolonunda durur (U dönüşlü, rıht ≤ 18 cm, 2r + b ≈ 63 cm; sahanlık cephede), katlar arasında hizalıdır. Salon iki bandı kaplayan uç oda olabilir, açık mutfak salonla aynı hacimde çizilir, ebeveyn yatak – giyinme – ebeveyn banyosu süit sırasıyla dizilir. Apartmanda daire genişlikleri alanına göre ayarlanır, asansörlü çekirdekte kat holü merdiven ve asansöre doğrudan bağlanır. Plan ve DXF'te üç sıra dış ölçü zinciri (açıklıklar, odalar, toplam) ve kuzey oku vardır.

`npm run test:layout` rastgele programlarla planları denetler (her mekâna kapıdan ulaşılabilirlik, ıslak hacimden geçmeme, asgari genişlik, çakışma, merdivenin katlar arasında hizası). `N=300` ile daha çok örnek, `SHOW=1` ile sorunlu planların ayrıntısı.

Bu bir **eskiz** üreticisidir: dikdörtgen oturumlu, bant tipli planlar üretir. Serbest formlu planlar, statik aks sistemi ve mevzuatın tüm ayrıntıları (emsal harici alanlar, otopark, sığınak vb.) kapsam dışıdır.

## Model

Varsayılan `claude-opus-5-5` (değiştirmek için `CLAUDE_MODEL`). İstek, ret durumunda sunucu taraflı yedek modele geçecek şekilde `fallbacks: "default"` ile gönderilir.
