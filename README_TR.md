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

- **Arama**: Seq benzeri filtre dili (`@Level = 'Error' and Elapsed > 500`)
- **Canlı akış (live tail)**: SignalR üzerinden, filtre sunucu tarafında uygulanır
- **Signal**: kaydedilmiş filtreler, tek tıkla açılıp kapanır
- **Pano**: seviye histogramı, özet kartları, yoğunluk haritası
- **Analiz**: mesaj şablonuna göre gruplanmış en sık hatalar, en sık exception tipleri
- **Uyarı**: bir signal, belirlenen sürede N olayı yakalarsa webhook tetiklenir
- **Arşiv**: eski olaylar günlük Brotli parçalarına sıkıştırılır, istendiğinde geri açılır
- **Seq uyumlu**: mevcut Seq sink'leri LogHarbor'a olduğu gibi log gönderebilir
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

Canlıda HTTPS yapan bir reverse proxy arkasında çalıştır — oturum çerezi geliştirme dışında
`Secure` olarak veriliyor. HTTPS olmadan (düz HTTP) çalıştıracaksan
`LogHarbor__AllowInsecureCookie=true` ver, aksi halde tarayıcı çerezi reddeder ve giriş yapılamaz.
`docker-compose.yml` düz HTTP yayınladığı için bunu varsayılan olarak `true` yapıyor; önüne TLS
sonlandıran bir proxy koyduğunda `.env` içine `LOGHARBOR_ALLOW_INSECURE_COOKIE=false` yaz.

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

## Log gönderme

Birbirinden bağımsız iki yol var; birini ya da ikisini birden kullanabilirsin.

### Uygulamanın içinden — yapısal alanlarla

LogHarbor'un ingestion ucu Seq ile aynı teli konuşur: aynı yol, aynı CLEF gövdesi, ve
`X-LogHarbor-ApiKey` yanında `X-Seq-ApiKey` header'ı da kabul edilir. Yani **mevcut bir Seq
sink'ini LogHarbor'a yönlendirmen yeterli** — batching, retry ve tampon (buffer) desteğiyle
birlikte gelir.

Serilog (.NET), `dotnet add package Serilog.Sinks.Seq`:

```csharp
Log.Logger = new LoggerConfiguration()
    .WriteTo.Seq("http://localhost:5000", apiKey: Environment.GetEnvironmentVariable("LOGHARBOR_API_KEY"))
    .CreateLogger();

Log.Error(ex, "Order {OrderId} failed for {Customer}", 123, "acme");
```

`OrderId` ve `Customer` artık sorgulanabilir birer alan; ayrıca `Order {OrderId} failed`
olaylarının hepsi, id'si ne olursa olsun, Analiz sayfasında tek bir hata olarak gruplanır.

Aynısı `NLog.Targets.Seq` (.NET), `seqlog` (Python) ve `@datalust/winston-seq` (Node) için de
geçerli — sunucu adresini ve API key'i ver, başka bir şey gerekmez. Dile göre örnekler ve
ayrıntılar: [docs/ingestion-app.md](docs/ingestion-app.md).

Başka bir dil/kütüphane kullanıyorsan CLEF'i kendin gönder (satır satır, JSON dizisi değil):

```bash
curl -X POST http://localhost:5000/api/events/raw \
  -H "X-LogHarbor-ApiKey: logharbor_token_buraya" \
  -H "Content-Type: application/vnd.serilog.clef" \
  --data-binary '{"@t":"2026-07-13T10:00:00Z","@l":"Error","@mt":"Order {OrderId} failed","OrderId":123}'
```

### Docker container'larından — uygulamaya hiç dokunmadan

İzlenen makinede tek bir Vector container'ı çalıştırırsın. Makinedeki bütün container'ların
stdout/stderr'ini okuyup LogHarbor'a gönderir; compose proje ve servis adını etiket olarak ekler,
böylece `App = 'shop-api'` ve `Service = 'backend'` filtreleri proje başına hiçbir ayar
yapmadan çalışır. Bedeli: log satırları yapısal alanlar olarak değil, düz metin olarak gelir.

Kurulum: [docs/ingestion-docker.md](docs/ingestion-docker.md).

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
| `LOGHARBOR_ADMIN_PASSWORD` | *(boş)* | Oluşturulan admin'in parolası; boşsa admin/admin ve ilk girişte değiştirilir |

Arşiv ayarları Settings sayfasından da değiştirilebilir; oradaki değerler önceliklidir.

---

## Dokümanlar

Dokümanlar İngilizcedir (rules.md).

| Dosya | İçerik |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Sistemin genel yapısı ve bileşenleri |
| [docs/data-model.md](docs/data-model.md) | Olay şeması ve depolama tasarımı |
| [docs/api.md](docs/api.md) | HTTP API uçları |
| [docs/query-language.md](docs/query-language.md) | Filtre/arama sözdizimi |
| [docs/frontend.md](docs/frontend.md) | Arayüz yapısı ve sayfalar |
| [docs/ingestion-app.md](docs/ingestion-app.md) | Uygulama içinden log gönderme |
| [docs/ingestion-docker.md](docs/ingestion-docker.md) | Vector ile Docker loglarını toplama |
| [docs/archiving.md](docs/archiving.md) | Katmanlı depolama: sıkıştırma, geri açma, saklama |
