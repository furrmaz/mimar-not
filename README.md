# Mimar Not

Mimarın müşteri görüşmesinde aldığı notlardan, tek tuşla ön tasarım çizim seti üreten web uygulaması.

**Akış:** görüşme notu (yazarak ya da Türkçe sesli dikteyle) → Claude API notlardan yapılandırılmış **bina programı** çıkarır (mekânlar, alanlar, kat dağılımı, imar değerleri, varsayımlar, müşteriye sorulacak sorular) → uygulama aynı modelden **kat planlarını, A-A kesitini, 4 cepheyi, vaziyet planını, 3D modeli** ve **TAKS/KAKS/çekme mesafesi kontrolünü** deterministik olarak üretir.

Program ekranında oda alanlarını, oturum ölçüsünü, kat yüksekliğini, çatı tipini değiştirdiğinizde bütün çizimler anında güncellenir. "Notlarla güncelle" mevcut programı koruyarak yeni notları uygular.

## Windows masaüstü uygulaması

`MimarNot-Kurulum-0.1.0.exe` kurulum dosyasıdır (masaüstü ve Başlat menüsü kısayolu oluşturur). `MimarNot-Tasinabilir-0.1.0.exe` kurulum gerektirmeden çalışır.

- İlk açılışta **Ayarlar** penceresi Claude API anahtarını ister. Anahtar Windows kullanıcı hesabınıza bağlı şifreleme (DPAPI) ile yalnızca bu bilgisayarda saklanır.
- **AutoCAD'de aç**: planlar, A-A kesiti, 4 cephe ve vaziyet planını tek bir DXF dosyasına yazar, `Belgeler\Mimar Not\<proje>` klasörüne kaydeder ve DXF ile ilişkili programda (AutoCAD) açar. Birim m / cm / mm seçilebilir (varsayılan cm).
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
| Bina programı | JSON |
| Proje dosyası (notlar + program) | .mimarnot (Dosya → Kaydet / Aç, Ctrl+S / Ctrl+O) |
| Çizim seti | Tarayıcıdan PDF (A3 yatay) |

Kurulum sürümü (NSIS) açılışta GitHub Releases'tan yeni sürümü denetler ve indirir; taşınabilir sürüm güncellenmez.

## Yapı

```
server/index.ts          Express API: POST /api/generate → Claude (structured outputs, zod şeması)
server/prompt.ts         Claude sistem talimatı (Türk imar yönetmeliği varsayılanları dahil)
src/shared/schema.ts     Bina programı şeması (sunucu ve arayüz ortak)
src/geometry/layout.ts   Programdan deterministik yerleşim (bantlar, odalar, kapı/pencere, duvarlar)
src/geometry/svg.ts      Plan, kesit, cephe, vaziyet SVG üreticileri
src/geometry/model3d.ts  Three.js modeli
src/geometry/dxf.ts      DXF (R12) dışa aktarma
src/geometry/zoning.ts   TAKS, KAKS, kat adedi, Hmax, çekme mesafeleri
src/App.tsx              Arayüz
```

## Yerleşim yöntemi (sınırlar)

Her kat üç banda ayrılır: sokak tarafı (gündüz mekânları), ortada hol + U merdiven (katlar arasında hizalı), bahçe tarafı (gece mekânları). Bant derinlikleri katların alan paylarından, oda genişlikleri alanlardan hesaplanır; ebeveyn odası, giyinme ve banyosu birlikte tutulur. Bu bir **eskiz** üreticisidir: dikdörtgen oturumlu, bant tipli planlar üretir. Serbest formlu planlar, statik aks sistemi ve mevzuatın tüm ayrıntıları (emsal harici alanlar, otopark, sığınak vb.) kapsam dışıdır.

## Model

Varsayılan `claude-opus-5-5` (değiştirmek için `CLAUDE_MODEL`). İstek, ret durumunda sunucu taraflı yedek modele geçecek şekilde `fallbacks: "default"` ile gönderilir.
