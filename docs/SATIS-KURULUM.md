# Mimar Not'u satışa açma rehberi

Bu sürümle Mimar Not **aylık abonelikle** satılır. Mimar hiçbir API anahtarı girmez: e-postasıyla hesap açar, 7 gün ücretsiz dener, havale/EFT ile öder; siz yönetim panelinden aboneliğini açarsınız. Claude ve render ücretini sizin sunucunuz öder ve her kullanıcının aylık hakkı (kota) sunucuda tutulur.

```
Windows / Android / tarayıcı  ──►  Mimar Not sunucusu (sizin)  ──►  Claude API (Anthropic)
        (hesapla giriş)              hesaplar, kota, yönetim          Higgsfield (render)
                                     tanıtım sitesi, web uygulaması
```

## 1. Hesaplar ve anahtarlar

1. **Anthropic (Claude)**: <https://platform.claude.com> → hesap açın, kredi yükleyin, **Settings → Keys** bölümünden bir API anahtarı oluşturun. **Settings → Limits** bölümünden aylık harcama sınırı koyun (ör. 200 $); beklenmedik bir durumda faturanız bu sınırı aşmaz.
2. **Higgsfield (gerçekçi render, isteğe bağlı)**: <https://cloud.higgsfield.ai> → API Keys → Key ID ve Secret. Bakiye yükleyin. Boş bırakırsanız render kapalı olur.
3. **Yönetici parolası**: en az 12 karakterlik, tahmin edilemez bir parola belirleyin (`ADMIN_TOKEN`).

## 2. Sunucuyu yayına alma

### Seçenek A: Render.com (en kolayı, ayda yaklaşık 7-8 $)

1. <https://render.com> hesabı açın, GitHub hesabınızı bağlayın.
2. **New → Blueprint** → `furrmaz/mimar-not` deposunu seçin. Depodaki `render.yaml` dosyası sunucuyu ve kalıcı diski (veritabanı için) otomatik tanımlar.
3. İstenen ortam değişkenlerini girin (aşağıdaki tablo). `ADMIN_TOKEN` otomatik üretilir; Render panelinde **Environment** sekmesinden görebilirsiniz.
4. Kurulum bitince `https://mimar-not-xxxx.onrender.com` gibi bir adres alırsınız. Kendi alan adınızı **Settings → Custom Domains** bölümünden ekleyin (ör. `mimarnot.com.tr`).

### Seçenek B: Kendi sunucunuz (VPS / VDS)

Ubuntu 22.04 ya da 24.04, en az 2 GB RAM. Sunucuda başka projeler çalışıyorsa onlara dokunulmaz. Sunucuya SSH ile bağlanıp tek komut:

```bash
curl -fsSL https://raw.githubusercontent.com/furrmaz/mimar-not/main/deploy/install.sh -o mimarnot-kur.sh && sudo bash mimarnot-kur.sh
```

Betik Docker'ı kurar (yoksa), kodu `/opt/mimar-not` klasörüne indirir, alan adını, Claude anahtarını ve havale bilgilerini sorar, yönetici parolasını kendisi üretir ve uygulamayı başlatır:

- 80/443 portları boşsa HTTPS'i kendisi kurar (Caddy, Let's Encrypt).
- Sunucuda nginx çalışıyorsa nginx'e yeni bir site ekler ve certbot ile sertifika alır; mevcut siteler değişmez.
- Alan adınız yoksa geçici olarak `104-233-4-32.sslip.io` biçiminde bir adres kullanır; alan adı alınca `/opt/mimar-not/deploy/.env` içindeki `DOMAIN` satırını değiştirip betiği yeniden çalıştırın.

Sonunda site, panel adresi ve yönetici parolası ekrana yazılır ve `/root/mimarnot-bilgiler.txt` dosyasına kaydedilir. Güncellemek için aynı betiği yeniden çalıştırın: `sudo bash /opt/mimar-not/deploy/install.sh`.

### Ortam değişkenleri

| Değişken | Açıklama |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API anahtarı (zorunlu) |
| `ADMIN_TOKEN` | Yönetim paneli parolası, en az 12 karakter (zorunlu) |
| `DATA_DIR` | Veritabanı klasörü; Docker'da `/data` (kalıcı disk) |
| `HF_API_KEY_ID`, `HF_API_KEY_SECRET` | Higgsfield anahtarı (render için) |
| `PAY_BANK`, `PAY_HOLDER`, `PAY_IBAN` | Havale bilgileri: banka, hesap sahibi, IBAN |
| `CONTACT_EMAIL`, `CONTACT_WHATSAPP` | Dekontların gönderileceği e-posta ve WhatsApp (ör. `905321234567`) |
| `COMPANY_NAME`, `COMPANY_ADDRESS` | Satıcı unvanı ve adresi (kullanım koşulları ve KVKK sayfalarına yazılır) |
| `TRIAL_DAYS`, `TRIAL_GENERATE`, `TRIAL_RENDER` | Deneme süresi ve hakları (varsayılan 7 gün, 3 üretim, 2 render) |
| `PLANS_JSON` | Planları ve fiyatları değiştirmek için (aşağıda) |

Sunucu açılınca şu adresler çalışır:

- `/` tanıtım ve fiyat sayfası
- `/app/` tarayıcıdan kullanılan uygulama
- `/admin/` yönetim paneli
- `/kosullar` kullanım koşulları, `/kvkk` KVKK aydınlatma metni

## 3. Uygulamaları sunucunuza bağlama

GitHub'da depo → **Settings → Secrets and variables → Actions → Variables** sekmesi → **New repository variable**:

- Ad: `CLOUD_URL`
- Değer: sunucu adresiniz, ör. `https://mimarnot.com.tr` (sonunda `/` olmadan)

Sonra `main` dalına yapılan ilk gönderimde (ya da **Actions → Sürüm → Run workflow**) Windows, Android ve web paneli bu adrese bağlı olarak derlenir. Bu değişken tanımlı değilken uygulamalar eskisi gibi "kendi API anahtarınla" çalışır.

## 4. Günlük işleyiş

1. Mimar uygulamada hesap açar ve denemeye başlar.
2. Abone olmak istediğinde **Hesap → Abone ol** ekranında planı ve süreyi seçer; ekranda IBAN'ınız ve **müşteri numarası (MN-0012 gibi)** görünür. Havale açıklamasına bu numarayı yazar, dekontu WhatsApp ya da e-postayla gönderir.
3. Siz `https://alanadiniz/admin/` → aramaya müşteri numarasını yazın → kullanıcıyı açın → plan ve ay sayısını seçip **Aboneliği aç**. Kullanıcı bunu uygulamada hemen görür.
4. Süresi bitmemiş bir aboneliği yeniden açarsanız kalan sürenin üstüne eklenir.
5. Parolasını unutan kullanıcı için **Parola sıfırla**: yeni parola ekranda görünür, kullanıcıya iletin.

Panelin üst kısmında bu ayki tahsilat, Claude/render maliyeti, ortalama üretim maliyeti ve kaba kâr görünür. İlk haftalarda **ortalama üretim maliyetine** bakıp plan haklarını gerekirse ayarlayın.

## 5. Fiyatlar ve maliyet

Varsayılan planlar:

| Plan | Fiyat / ay | Üretim | Render |
|---|---|---|---|
| Başlangıç | 990 TL | 25 | 10 |
| Profesyonel | 1.990 TL | 80 | 40 |
| Ofis | 4.490 TL | 250 | 120 |

Tahmini maliyet: bir üretim (Claude Opus 5.5; 4 $ / 20 $ milyon token) ortalama **0,3-0,6 $**, bir render **0,03-0,04 $**. Profesyonel planı sonuna kadar kullanan bir kullanıcının en kötü durumdaki maliyeti yaklaşık 80 × 0,5 $ + 40 × 0,04 $ ≈ 42 $ (≈ 1.700 TL); çoğu kullanıcı hakkının tamamını kullanmaz. Gerçek ortalama yönetim panelinde görünür.

Planları değiştirmek için `PLANS_JSON` değişkenine bir JSON dizisi yazın:

```json
[{"id":"baslangic","label":"Başlangıç","priceTry":1190,"generate":25,"render":10,"features":["Ayda 25 proje üretimi / düzeltme","Ayda 10 gerçekçi render"]},
 {"id":"profesyonel","label":"Profesyonel","priceTry":2290,"generate":80,"render":40,"highlight":true,"features":["Ayda 80 proje üretimi / düzeltme","Ayda 40 gerçekçi render"]}]
```

`id` değerini değiştirmeyin; mevcut abonelikler bu kimlikle eşleşir. Fiyatlar tanıtım sayfasında ve uygulamada kendiliğinden güncellenir.

## 6. Yedekleme

Yönetim panelinde **Yedek indir** tüm hesapların, ödemelerin ve kullanım kayıtlarının tek dosyalık kopyasını indirir. Haftada bir indirin. Geri yüklemek için dosyayı sunucudaki `DATA_DIR` klasörüne `mimarnot.db` adıyla koyup sunucuyu yeniden başlatın.

## 7. Satıştan önce yapılması gerekenler (sizin tarafınızda)

- **Şirket ve fatura**: satış için şahıs ya da limited şirket ve e-Arşiv fatura gerekir. Mali müşavirinize "yurt içi yazılım aboneliği (SaaS), havale ile tahsilat" olarak danışın.
- **Yasal metinler**: `/kosullar` ve `/kvkk` sayfalarındaki metinler taslaktır; özellikle iade koşulunu (abonelikten sonraki 14 gün içinde hiç kullanılmadıysa iade) ve yetkili mahkemeyi bir avukata kontrol ettirin. Metinler `site/kosullar.html` ve `site/kvkk.html` dosyalarındadır.
- **Windows uyarısı**: uygulama imzasız olduğu için Windows ilk açılışta "bilinmeyen yayıncı" uyarısı verir. Kod imzalama sertifikası (yılda yaklaşık 200-400 $; ör. Certum, Sectigo) alındığında derlemeye eklenebilir.
- **Kaynak kodu**: depo şu an herkese açık. Rakiplerin kodu kopyalamasını istemiyorsanız depoyu özel yapın. Bu durumda otomatik güncellemenin çalışması için sürümleri ayrı, herkese açık bir "sürümler" deposuna yayınlamak gerekir; bunu birlikte ayarlayabiliriz.
- **Kart ile ödeme**: ileride iyzico ya da Paddle eklenebilir; sunucu ve yönetim paneli buna hazırdır (ödeme gelince aynı "aboneliği aç" işlemi otomatik çalıştırılır).
