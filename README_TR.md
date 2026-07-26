# LogHarbor

[![License: GPL v3](https://img.shields.io/badge/license-GPL%20v3-1a1a1a?style=flat-square&labelColor=1a1a1a&color=8a6f3a)](LICENSE)
[![Built with Claude Code](https://img.shields.io/badge/built%20with-Claude%20Code-1a1a1a?style=flat-square&labelColor=1a1a1a&color=d8b66b)](https://claude.com/claude-code)
[![Status](https://img.shields.io/badge/status-active-1a1a1a?style=flat-square&labelColor=1a1a1a&color=4a9e6b)](https://github.com)
[![.NET](https://img.shields.io/badge/.NET-8.0-1a1a1a?style=flat-square&labelColor=1a1a1a&color=512bd4)](https://dotnet.microsoft.com)
[![React](https://img.shields.io/badge/React-18-1a1a1a?style=flat-square&labelColor=1a1a1a&color=61dafb)](https://react.dev)
[![SQLite](https://img.shields.io/badge/SQLite-JSON1%20%2B%20FTS5-1a1a1a?style=flat-square&labelColor=1a1a1a&color=003b57)](https://www.sqlite.org)
[![Docker](https://img.shields.io/badge/docker-ready-1a1a1a?style=flat-square&labelColor=1a1a1a&color=2496ed&logo=docker&logoColor=fff)](https://www.docker.com)

[Seq](https://datalust.co/seq)'ten esinlenmiş, kendi sunucunda barındırılan yapısal log
sunucusu. Yapısal log olaylarını (CLEF/JSON) toplar, tek bir SQLite dosyasında saklar; arama,
canlı akış, panolar ve uyarılar için bir web arayüzü sunar.

*[English README](README.md)*

**Yeni misin?** [5 dakikada çalıştır](docs/running-in-5-minutes.md) — container'ı
başlat, giriş yap, anahtar oluştur, ilk log satırını ekranda gör.

- **Arama**: Seq benzeri filtre dili (`@Level = 'Error' and Elapsed > 500`)
- **Canlı akış (live tail)**: SignalR üzerinden, filtre sunucu tarafında uygulanır
- **Signal**: kaydedilmiş filtreler, tek tıkla açılıp kapanır
- **Pano**: seviye histogramı, özet kartları, yoğunluk haritası
- **Analiz**: mesaj şablonuna göre gruplanmış en sık hatalar, en sık exception tipleri,
  ve kendi p95 baseline'ından yavaşlayan işlemler
- **Servisler**: loglardan servis başına RED özeti (olay hızı, hata %, p95)
- **Lens sayfaları**: aynı veriyi dört ayrı açıdan okur — İstekler (uç noktalar + durum
  kodları), İstisnalar (kaynak konumlu canlı akış), Sorgular (maliyete göre SQL),
  Kullanıcılar (id başına etkinlik)
- **Trace**: bir isteği servisler arasında izle; OTLP span'leri waterfall olarak çizilir
- **Uyarı**: bir signal belirlenen sürede N olayı yakalarsa webhook — ya da bir signal
  sustuğunda dead man's switch; Slack / Discord / generic gövde
- **Arşiv**: eski olaylar günlük Brotli parçalarına sıkıştırılır, istendiğinde geri açılır
- **Seq uyumlu**: mevcut Seq sink'leri LogHarbor'a olduğu gibi log gönderebilir — Seq'in
  her iki gövde formatı da, gerçek Serilog, winston-seq ve seqlog istemcileriyle doğrulandı
- **Sessiz kayıp yok**: LogHarbor'un reddettiği her toplama isteği sayılır, loglanır ve
  gösterilir; yanlış yapılandırılmış bir istemci olayları fark edilmeden kaybedemez
- Tek süreç, tek container, tek SQLite dosyası

---

## Hızlı başlangıç (Docker)

```bash
docker compose up -d
```

compose olmadan:

```bash
docker build -t logharbor .
docker run -d --name logharbor -p 5000:5000 -v logharbor-data:/data logharbor
```

http://localhost:5000 adresini aç ve **admin / admin** ile gir. LogHarbor hemen yeni bir parola
ister ve o parolayı belirleyene kadar başka hiçbir isteğe cevap vermez; yani varsayılan parola
ilk temastan sonra ortadan kalkar. Ardından **Settings** sayfasından bir API key oluştur —
token **yalnızca bir kez** gösterilir.

Ortam değişkeni yok, `.env` yok, açıkta kalan kurulum yok. Parolayı baştan kendin vermek
istersen (elle müdahale edilmeyen kurulumlar için) bu adımı atlayabilirsin:

```bash
docker run -d --name logharbor -p 5000:5000 -v logharbor-data:/data \
  -e LOGHARBOR_ADMIN_PASSWORD='parolan' logharbor
```

Her iki durumda da `admin` hesabı yalnızca ilk açılışta oluşturulur; sonraki hesaplar
(`admin` / `viewer` rolleri) Settings sayfasından yönetilir. Log gönderimi her zaman API key
ile çalışır, bunlardan etkilenmez.

### Düz HTTP üzerinde test (ev / yerel ağ)

Canlıda LogHarbor bir HTTPS reverse proxy arkasında çalışır; bu yüzden geliştirme dışında
oturum çerezi `Secure` olarak verilir. Siteye düz HTTP ile eriştiğinde — `http://localhost:5000`
ya da `http://192.168.1.50:5000` gibi bir yerel ağ adresi — giriş bozulur: tarayıcı `Secure`
çerezi saklamaz, giriş "tutmaz" ve **admin / admin** doğru olsa bile parola-değiştirme adımı
yerine tekrar giriş ekranına düşersin.

HTTP testi için bu davranıştan `LogHarbor__AllowInsecureCookie=true` ile açıkça çık. `docker run` ile:

```bash
docker run -d --name logharbor -p 5000:5000 -v logharbor-data:/data \
  -e LogHarbor__AllowInsecureCookie=true logharbor
```

Ya da `docker-compose.yml` içindeki `environment:` bloğuna ekle, sonra `docker compose up -d`:

```yaml
    environment:
      - LogHarbor__AllowInsecureCookie=true
```

Artık düz HTTP üzerinden **admin / admin** ile girip istendiğinde yeni parolanı belirleyebilirsin.
Önünde TLS sonlandıran bir reverse proxy varsa bunu **kapalı bırak** (varsayılan) — orada çerez
`Secure` kalmalı. Bu yalnızca bir test kolaylığıdır; güvendiğin yerel ağ dışına açılan hiçbir
kurulumda kullanma.

## Hızlı başlangıç (kaynaktan)

.NET 8 SDK ve Node 22+ gerekir.

```bash
# terminal 1 — backend :5000 (Swagger arayüzü /swagger)
dotnet run --project backend/LogHarbor.Api

# terminal 2 — frontend geliştirme sunucusu :5173, /api ve /hubs'ı backend'e yönlendirir
cd frontend && npm install && npm run dev
```

Testler:

```bash
dotnet test backend
cd frontend && npm run build && npm run lint
```

---

## Web arayüzü

Her şey giriş kapısının arkasındadır. Üst çubukta sayfa menüsünün yanında EN/TR dil ve
açık/koyu tema düğmeleri bulunur.

**Zaman boyutu olan her sayfada** (Panel, Olaylar, İstekler, İstisnalar, Sorgular, Servisler,
Kullanıcılar, Analiz) sağ üstte aynı iki kontrol durur:

```
[ ● Canlı ]  |  [ Son 1 saat ▾ ]
```

- **Canlı** kayan bir pencere tutar ve 10 saniyede bir tazeler. Panel'de ve üç lens sayfasında
  varsayılan olarak açıktır (son 1 saat); Servisler, Kullanıcılar ve Analiz'de kapalıdır ve
  pencereleri 24 saattir. Olaylar sayfasında Canlı gerçek bir soket aboneliğidir (SignalR) ve
  noktanın rengi bağlantıyı gösterir: yeşil bağlı, amber bağlanıyor, kırmızı koptu.
- **Zaman aralığı** hazır bir aralık ya da elle başlangıç/bitiş seçer. Aralık seçmek Canlı'dan
  çıkar — belirli bir pencere ile "şu an" birbiriyle çelişir — böylece ikili imlecin altında
  kaymaz.

Seviye renkleri her yerde aynıdır (rozetlerde, grafiklerde, çiplerde): Verbose mor, Debug
camgöbeği, Information mavi, Warning amber, Error kırmızı, Fatal gül.

### Panel (`/`)

İkinci ekranda açık bırakılacak sayfa. Dört bölüm: **Etkinlik** (Olaylar ve Hatalar kartları —
her biri büyük bir rakam, kırılımı ve yığılmış histogramı), **Analiz** (en sık hatalar, en sık
istisnalar, en yavaş işlemler), **Servisler ve kullanıcılar**, ve sistemin gerçekte ne zaman
yoğun olduğunu gösteren **saat × haftanın günü yoğunluk haritası**.

Histogramda bir çubuğa tıklayınca o dilim Olaylar'da açılır; histogram üzerinde sürükleyerek
daha dar bir pencereye yakınlaşırsın (bu aynı zamanda Canlı'yı durdurur). Her kart özetlediği
sayfaya bağlanır.

Bir panel yalnızca söyleyecek sözü varken çıkar: en üstteki **Reddedilen toplama**, son 7
günde LogHarbor'un geri çevirdiği istekler için. O olaylar aşağıdaki hiçbir grafikte yok —
hiç kaydedilmediler — dolayısıyla görünecekleri tek yer burası.

### Olaylar (`/events`)

Akışın kendisi; bütün derin bağlantıların vardığı yer.

- **Arama çubuğu** [filtre dilini](#sorgu-dili) alır ve gönderirken doğrular; yazarken property
  adlarını ve değerlerini tamamlar, son 10 filtreni hatırlar.
- **Seviye çipleri** bir veya birkaç seviyeye daraltır. `|` işaretinin sağındaki her şey senin
  kaydettiğin **Sinyaller**'dir — açtığında filtreye AND'lenirler.
- **Liste** sanallaştırılmıştır ve keyset ile sayfalanır; ne kadar aşağı inersen in akıcı kalır.
  Canlı açıkken yeni olaylar vurguyla başa eklenir; aşağı kaydırdığında ekleme durur ve bir
  şerit bekleyen olay sayısını sayar.
- **Bir satıra tıkla**, detay paneli açılır: tıklayınca filtreleyen kimlik çipleri, property
  ağacı (iç içe değerler katlanır) ve property başına filtrele/kopyala, kaynak konumuyla
  birlikte exception, "bu olayın çevresi" (±2 dk) ve en altta katlanmış ham JSON.
  Olay bir trace id taşıyorsa **İzi görüntüle** filtreyi `@TraceId = '…'` yapar ve isteği
  waterfall olarak çizer — OTLP span'i gönderiyorsan gerçek span'lerle, göndermiyorsan log
  zaman damgalarından çıkarılarak.
- **Sütunlar** herhangi bir property'yi listeye sütun olarak ekler, **Zaman** mutlak/göreceli
  damga arasında geçiş yapar, **Dışa aktar** mevcut filtre + aralığı JSON veya CSV indirir.
- **Klavye**: `/` aramaya odaklan, `j`/`k` seçimi gezdir, `Esc` paneli kapat, `?` yardım.

### İstekler (`/requests`)

HTTP uç noktaları RED tablosu olarak: işlem başına olay/dk, hata %, p95 `Elapsed` ve eğilim
sparkline'ı; her sütuna göre sıralanabilir. Üstünde saat ekseni ve imleç ipucu olan yığılmış
**durum kodu grafiği** (1/2/3xx, 4xx, 5xx); bir gösterge çipine tıklamak o sınıfı yalnızlaştırır
ve tabloyu da onunla daraltır. Satırlar ilgili Olaylar aramasına gider.

Beslemek için istek tamamlandı olayında `StatusCode` ve `Elapsed` logla — ASP.NET Core ve pek
çok framework bunu zaten yapıyor.

### İstisnalar (`/exceptions`)

İstisna tipine göre gruplanmış canlı akış: sayı, eğilim, ilk ve son görülme, ve **Kaynak** —
en son stack trace'inden ayrıştırılan `dosya:satır` (.NET, PHP, Python ve Node biçimleri).
Bir satırı açtığında en son oluşumu, yanında da aynı trace'in diğer olaylarıyla birlikte gelir;
hatayı aramak yerine bağlamıyla okursun.

### Sorgular (`/queries`)

Veritabanı işlerin, SQL metnine göre gruplanmış: solda ifade başına çağrı sayısı, toplam süre,
ortalama ve p95; birini seçtiğinde sağ panelde tam SQL, istatistik kutucukları, bağlantı,
eğilim ve son oluşumlar, Olaylar'a bir bağlantıyla birlikte.

Varsayılan olarak EF Core'un `Executed DbCommand` biçimini okur; logger'ın farklı adlar
kullanıyorsa sayfanın üstünden property adlarını (`commandText` / `elapsed`) değiştir.

### Servisler (`/services`)

Servis başına tek satır; kimlik `service.name` (OTLP) ya da `Service` (CLEF/Seq): olay hızı,
hata %, p95 `Elapsed`, eğilim. "Hangi servisin günü kötü geçiyor" sorusunun en hızlı cevabı.

Üstünde, sunucunun kendi servisleri için bir **durum panosu** — systemd unit'leri ve Docker
container'ları — bir makineye [`tools/service-probe`](docs/service-status.md) kurduysanız.
Servis başına bir kutu: yeşil ayakta, kırmızı kapalı, sarı sağlıksız ya da sinyal yok, gri
"sonda bakamadı". Birine tıklayınca o servisin bütün açılma/kapanma geçmişi Olaylar'da açılır.
Sonda yoksa pano da yok.

### Kullanıcılar (`/users`)

Aynı biçim, kullanıcı başına: olay, hata, son görülme, eğilim. Varsayılan gruplama property'si
`UserId` — başka bir tane yaz (`TenantId`, `AccountId`, …) ve yeniden gruplansın. Derin
bağlantılar sayısal ve metin id'leri doğru işler.

### Analiz (`/analysis`)

Tek sayfada üç soru:

- **En sık hatalar**, mesaj şablonuna göre gruplanmış; yani `Order {OrderId} failed` kaç farklı
  sipariş numarası basmış olursa olsun tek satırdır.
- **En sık istisna tipleri**, aralık içinde ilk kez görülenlerde `yeni` rozetiyle.
- **Normalden yavaş** — bu penceredeki p95'i, kendisinin önceki baseline'ını aşan işlemler.
  Kimsenin henüz bildirmediği yavaşlamayı bulan bölüm burasıdır.

### Sinyaller (`/signals`)

Kaydedilmiş filtreler; kaydederken doğrulanır. Olaylar sayfasında birer düğmedir ve uyarı
kurallarının girdisidir — arama çubuğuna yazabildiğin her şey sinyal olabilir.

### Uyarılar (`/alerts`)

Bir kural = sinyal + koşul + webhook; dakikada bir değerlendirilir:

- **at-least** — sinyal pencere içinde N olay yakalarsa tetikler.
- **silence** (ölü adam düğmesi) — bir zamanlar *canlı olan* bir sinyal tam bir pencere boyunca
  hiçbir şey üretmezse tetikler. Nabız izleyen budur: log basmayı bırakan bir servis, ölen bir
  prob, kaybolan bir makine.

Gövde biçimi Slack, Discord veya generic JSON — incoming webhook URL'sini yapıştır ve uygun
biçimi seç. Tetikledikten sonra kural bir pencere boyunca soğur; bozuk bir webhook her dakika
dövülmez.

### Ayarlar (`/settings`)

API anahtarları (oluştur, bir kez kopyala, iptal et), kullanıcılar ve roller, sağlık bilgisi ve
veritabanı boyutu, tek tıkla veritabanı yedeği, ve arşiv bölümü: olaylar kaç gün sonra
sıkıştırılsın, çıkarılmış veri ne kadar tutulsun, arşivler ne zaman silinsin — ayrıca
arşivlenmiş günlerin listesi ve her birinde bir **Çıkar** düğmesi; sıkıştırılmış bir günü
aramaya geri getirmenin yolu budur.

Tam UI referansı: [docs/frontend.md](docs/frontend.md).
---

## Log gönderme

Birbirinden bağımsız üç yol var; birini ya da birkaçını birden kullanabilirsin.

### Uygulamanın içinden — yapısal alanlarla

LogHarbor'un ingestion ucu Seq ile aynı teli konuşur: aynı yol, Seq'in her iki gövde formatı
(CLEF ve `{"Events":[...]}` zarfı), ve `X-LogHarbor-ApiKey` yanında `X-Seq-ApiKey` header'ı da
kabul edilir. Yani **mevcut bir Seq sink'ini LogHarbor'a yönlendirmen yeterli** — batching,
retry ve tampon (buffer) desteğiyle birlikte gelir.

Serilog (.NET), `dotnet add package Serilog.Sinks.Seq`:

```csharp
Log.Logger = new LoggerConfiguration()
    .WriteTo.Seq("http://localhost:5000", apiKey: Environment.GetEnvironmentVariable("LOGHARBOR_API_KEY"))
    .CreateLogger();

Log.Error(ex, "Order {OrderId} failed for {Customer}", 123, "acme");
```

`OrderId` ve `Customer` artık sorgulanabilir birer alan; ayrıca `Order {OrderId} failed`
olaylarının hepsi, id'si ne olursa olsun, Analiz sayfasında tek bir hata olarak gruplanır.

`seqlog` (Python) ve `@datalust/winston-seq` (Node) da aynı şekilde çalışır. Örnekleri
[docs/ingestion-app.md](docs/ingestion-app.md) içinde — tahmin etmek yerine oradan bak,
çünkü ikisinde de olayı sessizce kaybettiren tuzaklar var.

#### Gerçekten doğrulanan ne

Aşağıdaki sink'lerin her biri çalışan bir LogHarbor'a yönlendirildi, bir yapısal olay
gönderildi ve kaydedilen satır geri okundu. Bilerek tekrar tekrar: burada asıl arıza türü,
bir kez teslim edip sonraki dördünü düşüren sink — ve tek bir yeşil çalıştırma bu ikisini
birbirinden ayırmıyor.

| SDK | Gönderdiği | Doğrulama | Dikkat |
|---|---|---|---|
| `Serilog.Sinks.Seq` (.NET) | CLEF | 3 / 3 | kısa ömürlü process çıkmadan `Log.CloseAndFlush()` |
| `@datalust/winston-seq` (Node) | `Events` zarfı | 5 / 5 | yalnızca ESM — `require` değil `import`; `logger.close()` transport'u **boşaltmaz**, `await transport.flush()` boşaltır |
| `seqlog` (Python) | `Events` zarfı | 5 / 5 | `logging.error()` değil, adlandırılmış `getLogger()`; flush asenkron, process onu geçirmeli (tek başına `logging.shutdown()` olayı kaybediyor) |
| `NLog.Targets.Seq` (.NET) | CLEF | test edilmedi | aynı `serverUrl` + `apiKey` ayarları; çalışması beklenir ama bu çıkarım, sonuç değil |

Doğrulanan üç sink de aynı satırı üretiyor: `Error` seviyesi, gruplama için korunmuş
şablon, ve sorgulanabilir `OrderId` / `Customer` alanları.

#### Hiçbir şey gelmiyorsa

Reddedilen bir sink ile söyleyecek sözü olmayan sink birbirinin aynısı görünür. Çoğu hatayı
yutar — ki doğrusu budur, loglama uygulamanın içine hata fırlatmamalı — yani uygulama
sorunsuz çalışır, olaylar da ortada yoktur.

LogHarbor geri çevirdiği her toplama isteğini kaydediyor, yani bakılacak bir yer var:
Dashboard'un tepesinde kırmızı panel (sadece gösterecek bir şey varken çıkar), aynı veri
`GET /api/stats/ingest-rejections` ucunda, ve her reddediş için sunucu log'unda bir uyarı.
API anahtarını, sebebi, kaç isteği ve son hatayı söyler — genelde bozuk istemciyi ona
dokunmadan teşhis etmeye yeter.

Orada da hiçbir şey yoksa istekler LogHarbor'a hiç ulaşmıyordur: yanlış URL veya port,
araya giren bir proxy, ya da hiç flush etmemiş bir sink.

Başka bir dil/kütüphane kullanıyorsan CLEF'i kendin gönder (satır satır, JSON dizisi değil):

```bash
curl -X POST http://localhost:5000/api/events/raw \
  -H "X-LogHarbor-ApiKey: logharbor_token_buraya" \
  -H "Content-Type: application/vnd.serilog.clef" \
  --data-binary '{"@t":"2026-07-13T10:00:00Z","@l":"Error","@mt":"Order {OrderId} failed","OrderId":123}'
```

### OpenTelemetry (OTLP)

Herhangi bir OTel SDK'sı veya Collector, Seq sink'i olmadan doğrudan log gönderebilir:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:5000
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS=X-LogHarbor-ApiKey=<anahtarınız>
```

`/v1/logs` hem protobuf hem JSON kodlamasını kabul eder; OTLP trace'leri ise `/v1/traces`
üzerinden (span'ler Olaylar sayfasında trace waterfall olarak çizilir). Collector
yapılandırması ve alan eşleme tablosu için [docs/ingestion-otlp.md](docs/ingestion-otlp.md).

### Docker container'larından — uygulamaya hiç dokunmadan

İzlenen makinede tek bir Vector container'ı çalıştırırsın. Makinedeki bütün container'ların
stdout/stderr'ini okuyup LogHarbor'a gönderir; compose proje ve servis adını etiket olarak ekler,
böylece `App = 'shop-api'` ve `Service = 'backend'` filtreleri proje başına hiçbir ayar
yapmadan çalışır. Bedeli: log satırları yapısal alanlar olarak değil, düz metin olarak gelir.

Kurulum: [docs/ingestion-docker.md](docs/ingestion-docker.md).

### Servis durumu (ayakta mı?)

"nginx ayakta mı?" sorusu için ayrı bir uptime altyapısı gerekmiyor: makinede çalışan küçük bir
prob dakikada bir `systemctl is-active` / `docker inspect` çalıştırıp cevabı normal bir log olayı
olarak gönderiyor (`up` = 1 veya 0, `Source = 'service-probe'` etiketiyle). Uyarı tarafı zaten
var olan ölü adam düğmesi: `up = 1` nabzını yakalayan bir signal ve bir `silence` kuralı — tek
kural hem servisin, hem probun, hem de makinenin ölmesini yakalıyor.

```bash
python3 service-probe.py --dry-run        # ne göndereceğini gösterir
python3 service-probe.py --setup-alerts --webhook https://hooks.slack.com/... --format slack
```

Araç [tools/service-probe/](tools/service-probe/README.md) altında; tasarım ve olay şeması
[docs/service-status.md](docs/service-status.md) içinde.

---

## Sorgu dili

```
@Level = 'Error' and StatusCode >= 500
(UserId = 42 or UserId = 43) and not RequestPath like '/health%'
@Message contains 'timeout'
Has(OrderId) and @Level = 'Warning'
'connection refused'                     -- serbest metin, tam metin araması yapılır
```

Dilin tamamı: [docs/query-language.md](docs/query-language.md).

---

## Yapılandırma

Ortam değişkenleri (ya da `appsettings.json` içinde `LogHarbor:` altında):

| Ayar | Varsayılan | Anlamı |
|---|---|---|
| `LogHarbor__DatabasePath` | `data/logharbor.db` | SQLite dosyasının konumu |
| `LogHarbor__MaxBatchBytes` | 5 MB | İstek başına en büyük gönderi boyutu |
| `LogHarbor__MaxEventBytes` | 256 KB | Tek bir olayın en büyük boyutu |
| `LogHarbor__IngestRateLimitPerMinute` | 1200 | API key başına dakikalık gönderim sınırı |
| `LogHarbor__LoginRateLimitPerMinute` | 10 | IP başına dakikalık giriş denemesi sınırı |
| `LogHarbor__RetentionDays` | 365 | N günden eski arşivlenmiş veriyi sil |
| `LogHarbor__Archive__CompressAfterDays` | 90 | N günden eski olayları sıkıştır (0 = kapalı) |
| `LogHarbor__SeedDefaultAdmin` | `true` | Kullanıcı tablosu boşsa admin hesabını oluştur |
| `LogHarbor__AllowInsecureCookie` | `false` | Oturum çerezini `Secure` olmadan ver, böylece düz HTTP üzerinde giriş çalışır (yalnızca test/yerel ağ; HTTPS proxy arkasında `false` bırak) |
| `LOGHARBOR_ADMIN_PASSWORD` | *(boş)* | Oluşturulan admin'in parolası; boşsa admin/admin ve ilk girişte değiştirilir |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(boş)* | Ayarlanırsa LogHarbor kendi metriklerini (ingest hızı, sorgu gecikmesi, arşiv işi süresi, HTTP sunucu metrikleri) bu OTLP adresine gönderir; boşsa öz-telemetri tamamen kapalıdır |

Arşiv ayarları Settings sayfasından da değiştirilebilir; oradaki değerler önceliklidir.

---

## Yedekleme ve geri yükleme

`GET /api/admin/backup` (yalnızca admin — Settings sayfasında da bağlantısı
var) bir instance'ın ihtiyaç duyduğu her şeyi tek bir zip olarak indirir:

```
logharbor-backup-YYYYMMDD-HHmmss.zip
├── logharbor.db          veritabanı, VACUUM INTO ile alınmış anlık görüntü
└── archive/              arşivleme çalıştıysa sıkıştırılmış günlük parçalar
    └── events-YYYY-MM-DD.jsonl.br
```

İkisi de gerekli. Arşivleme bir kez çalıştıktan sonra veritabanında yakın
tarihli olaylar ve arşivlenmiş günlerin yalnızca *dosya adları* bulunur —
geçmişin kendisi `archive/` içindedir. Sadece veritabanını yedeklemek, üretemediği
günleri listeleyen bir instance geri getirir.

Geri yükleme — zip'i veri volume'üne aç:

```bash
docker compose stop logharbor
docker run --rm -v logharbor_logharbor-data:/data -v "$PWD":/backup alpine \
  sh -c 'owner=$(stat -c "%u:%g" /data) && \
         apk add --no-cache unzip >/dev/null && \
         unzip -o /backup/logharbor-backup-YYYYMMDD-HHmmss.zip -d /data && \
         chown -R "$owner" /data'
docker compose start logharbor
```

`chown` isteğe bağlı değil. LogHarbor konteyner içinde root olmayan bir
kullanıcı olarak çalışır; root ile açılan dosyalara yazamaz ve sunucu açılışta
`SQLite Error 8: attempt to write a readonly database` ile ölür. Sahipliği
`/data` üzerinden okumak, imaj hangi uid'i kullanırsa kullansın doğru sonucu
verir.

Volume adının başında compose projesinin adı bulunur (proje klasörü
`logharbor` ise `logharbor_...`); tam adı `docker volume ls` gösterir.

Kaynaktan çalıştırıyorsan: backend'i durdur, zip'i `LogHarbor__DatabasePath`
konumunun bulunduğu dizine (varsayılan `data/`) aç, yeniden başlat.

Eski, yalnızca `.db` içeren bir yedek de geri yüklenir — dosyayı
`logharbor.db` olarak yerine koy. Dosyası eksik kalan arşiv günü, Settings
sayfasında çıkarılmak üzere sunulmak yerine **dosya yok** olarak görünür; yani
boşluk sessiz kalmaz.

---

## Dokümanlar

Dokümanlar İngilizcedir (rules.md).

| Dosya | İçerik |
|---|---|
| [docs/running-in-5-minutes.md](docs/running-in-5-minutes.md) | Sıfırdan ilk log satırına, adım adım |
| [docs/architecture.md](docs/architecture.md) | Sistemin genel yapısı ve bileşenleri |
| [docs/data-model.md](docs/data-model.md) | Olay şeması ve depolama tasarımı |
| [docs/api.md](docs/api.md) | HTTP API uçları |
| [docs/query-language.md](docs/query-language.md) | Filtre/arama sözdizimi |
| [docs/frontend.md](docs/frontend.md) | Arayüz yapısı ve sayfalar |
| [docs/ingestion-app.md](docs/ingestion-app.md) | Uygulama içinden log gönderme |
| [docs/ingestion-otlp.md](docs/ingestion-otlp.md) | OpenTelemetry (OTLP) ile log gönderme |
| [docs/ingestion-docker.md](docs/ingestion-docker.md) | Vector ile Docker loglarını toplama |
| [docs/archiving.md](docs/archiving.md) | Katmanlı depolama: sıkıştırma, geri açma, saklama |
| [docs/service-status.md](docs/service-status.md) | systemd/Docker servisleri için ayakta-mı durumu |
