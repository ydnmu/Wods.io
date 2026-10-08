import type { SiteLocale } from '../hooks/useLocale'

// Functional documentation copy; code samples and API identifiers remain unchanged.
const rows: ReadonlyArray<readonly [string, string, string, string]> = [
  ['Documentation.', 'Dokümantasyon.', 'Documentación.', '文档。'],
  ['Build with WODS in minutes.', 'WODS ile dakikalar içinde geliştirmeye başlayın.', 'Desarrolla con WODS en minutos.', '几分钟内开始使用 WODS 开发。'],
  ['Quickstart.', 'Hızlı başlangıç.', 'Inicio rápido.', '快速入门。'],
  ['Create one in Dashboard.', 'Panelden bir anahtar oluşturun.', 'Crea una en el panel.', '在控制台创建密钥。'],
  ['Use', 'Kullanın:', 'Usa', '使用'],
  ['Receive the transcript', 'Transkripti alın', 'Recibe la transcripción', '获取转录'],
  ['Get timestamped segments.', 'Zaman damgalı bölümleri alın.', 'Obtén segmentos con marcas de tiempo.', '获取带时间戳的片段。'],
  ['Video URLs to timestamped transcripts.', 'Video URL’lerinden zaman damgalı transkriptler.', 'De URL de vídeos a transcripciones con marcas de tiempo.', '将视频链接转为带时间戳的转录。'],
  ['Bulk and parallel processing.', 'Toplu ve paralel işleme.', 'Procesamiento por lotes y en paralelo.', '批量与并行处理。'],
  ['Zero transcript retention and data handling.', 'Transkript saklamama ve veri işleme.', 'Sin retención de transcripciones y tratamiento de datos.', '零转录保留与数据处理。'],
  ['Read API reference', 'API referansını okuyun', 'Leer referencia de API', '阅读 API 参考'],
  ['Read scale docs', 'Toplu işleme belgelerini okuyun', 'Leer documentación de escala', '阅读规模化文档'],
  ['Read privacy docs', 'Gizlilik belgelerini okuyun', 'Leer documentación de privacidad', '阅读隐私文档'],
  ['More request examples', 'Diğer istek örnekleri', 'Más ejemplos de solicitudes', '更多请求示例'],
  ['Go and PHP.', 'Go ve PHP.', 'Go y PHP.', 'Go 和 PHP。'],
  ['Scale.', 'Yüksek hacim.', 'Escala.', '规模化。'],
  ['Privacy.', 'Gizlilik.', 'Privacidad.', '隐私。'],
  ['Quickstart examples →', 'Hızlı başlangıç örnekleri →', 'Ejemplos de inicio rápido →', '快速入门示例 →'],
  ['Go and PHP →', 'Go ve PHP →', 'Go y PHP →', 'Go 和 PHP →'],
  ['Back to Quickstart', 'Hızlı başlangıca dön', 'Volver al inicio rápido', '返回快速入门'],
  [
    "Build with WODS.",
    "WODS ile geliştirin.",
    "Desarrolla con WODS.",
    "使用 WODS 开发。"
  ],
  [
    "Get started",
    "Başlangıç",
    "Primeros pasos",
    "开始使用"
  ],
  [
    "Overview",
    "Genel bakış",
    "Descripción general",
    "概览"
  ],
  [
    "Quickstart",
    "Hızlı başlangıç",
    "Inicio rápido",
    "快速入门"
  ],
  [
    "Transcripts",
    "Transkriptler",
    "Transcripciones",
    "转录"
  ],
  [
    "Create transcript",
    "Transkript oluşturma",
    "Crear transcripción",
    "创建转录"
  ],
  [
    "Response format",
    "Yanıt biçimi",
    "Formato de respuesta",
    "响应格式"
  ],
  [
    "Languages",
    "Diller",
    "Idiomas",
    "语言"
  ],
  [
    "Scale",
    "Yüksek hacim",
    "Escala",
    "规模化"
  ],
  [
    "Parallel jobs",
    "Paralel işler",
    "Tareas en paralelo",
    "并行任务"
  ],
  [
    "Rate limits",
    "Kullanım sınırları",
    "Límites de uso",
    "使用限制"
  ],
  [
    "Platform",
    "Platform",
    "Plataforma",
    "平台"
  ],
  [
    "Data retention",
    "Veri saklama",
    "Retención de datos",
    "数据保留"
  ],
  [
    "Reference",
    "Referans",
    "Referencia",
    "参考"
  ],
  [
    "Free transcription",
    "Ücretsiz transkripsiyon",
    "Transcripción gratuita",
    "免费转录"
  ],
  [
    "Authentication details",
    "Kimlik doğrulama detayları",
    "Detalles de autenticación",
    "身份验证详情"
  ],
  [
    "Supported languages",
    "Desteklenen diller",
    "Idiomas compatibles",
    "支持的语言"
  ],
  [
    "AI fallback behavior",
    "Yapay zekâ ile transkripsiyonun işleyişi",
    "Funcionamiento de la transcripción con IA",
    "AI 转录的工作方式"
  ],
  [
    "Process video collections",
    "Video koleksiyonlarını işleyin",
    "Procesa colecciones de vídeos",
    "处理视频集合"
  ],
  [
    "Privacy and operation",
    "Gizlilik ve çalışma biçimi",
    "Privacidad y funcionamiento",
    "隐私与运行"
  ],
  [
    "Error responses",
    "Hata yanıtları",
    "Respuestas de error",
    "错误响应"
  ],
  [
    "In this documentation",
    "Bu dokümantasyonda",
    "En esta documentación",
    "本文档"
  ],
  [
    "Documentation section",
    "Dokümantasyon bölümü",
    "Sección de documentación",
    "文档章节"
  ],
  [
    "Documentation sections",
    "Dokümantasyon bölümleri",
    "Secciones de documentación",
    "文档章节"
  ],
  [
    "Start building",
    "Geliştirmeye başlayın",
    "Empieza a desarrollar",
    "开始开发"
  ],
  [
    "Project links",
    "Proje bağlantıları",
    "Enlaces del proyecto",
    "项目链接"
  ],
  [
    "Use WODS without an account.",
    "WODS’u hesap açmadan kullanın.",
    "Usa WODS sin una cuenta.",
    "无需账户即可使用 WODS。"
  ],
  [
    "Bearer API keys, workspace access, and key rotation.",
    "Bearer API anahtarları, çalışma alanı erişimi ve anahtar yenileme.",
    "Claves Bearer, acceso al espacio y rotación de claves.",
    "Bearer API 密钥、工作区访问和密钥轮换。"
  ],
  [
    "JSON segments, plain text, SRT, or VTT.",
    "JSON bölümleri, düz metin, SRT veya VTT.",
    "Segmentos JSON, texto sin formato, SRT o VTT.",
    "JSON 分段、纯文本、SRT 或 VTT。"
  ],
  [
    "Caption availability and transcript translation.",
    "Altyazı kullanılabilirliği ve transkript çevirisi.",
    "Disponibilidad de subtítulos y traducción.",
    "字幕可用性与转录翻译。"
  ],
  [
    "Transcribe audio when a caption source is unavailable.",
    "Altyazı bulunamadığında sesi metne dönüştürün.",
    "Transcribe el audio cuando no hay subtítulos.",
    "无字幕来源时转录音频。"
  ],
  [
    "Queue YouTube collections in eligible paid workspaces.",
    "Uygun ücretli çalışma alanlarında YouTube koleksiyonlarını sıraya alın.",
    "Pon colecciones de YouTube en cola en espacios de pago elegibles.",
    "在符合条件的付费工作区中将 YouTube 集合加入队列。"
  ],
  [
    "Bounded concurrency, automation, and workspace tools.",
    "Sınırlı eşzamanlılık, otomasyon ve çalışma alanı araçları.",
    "Concurrencia limitada, automatización y herramientas.",
    "受限并发、自动化和工作区工具。"
  ],
  [
    "Usage allowances and transient request failures.",
    "Kullanım hakları ve geçici istek hataları.",
    "Cuotas de uso y fallos temporales.",
    "使用配额与临时请求故障。"
  ],
  [
    "Transcript handling and service records.",
    "Transkript işleme ve hizmet kayıtları.",
    "Tratamiento de transcripciones y registros del servicio.",
    "转录处理与服务记录。"
  ],
  [
    "Free web transcripts and workspace archives have different behavior.",
    "Ücretsiz web transkriptleri ile çalışma alanı arşivleri farklı çalışır.",
    "Las transcripciones web gratuitas y los archivos tienen comportamientos distintos.",
    "免费网页转录与工作区存档的行为不同。"
  ],
  [
    "Source adapters, audio fallback, and queued jobs.",
    "Kaynak adaptörleri, ses işleme ve sıradaki işler.",
    "Adaptadores de fuentes, audio y tareas en cola.",
    "来源适配器、音频处理和队列任务。"
  ],
  [
    "HTTP status, error code, and next action.",
    "HTTP durumu, hata kodu ve sonraki adım.",
    "Estado HTTP, código de error y siguiente acción.",
    "HTTP 状态、错误代码和下一步操作。"
  ],
  [
    "Get a transcript from a video URL, use AI fallback when captions are unavailable, or integrate the API for automated workflows.",
    "Video bağlantısından transkript oluşturun. Altyazı bulunamadığında sesi yapay zekâ ile metne dönüştürün veya iş akışlarını otomatikleştirmek için API’yi kullanın.",
    "Genera una transcripción a partir del enlace de un vídeo, transcribe el audio con IA si no hay subtítulos o integra la API para automatizar tus tareas.",
    "通过视频链接生成转录文本，没有字幕时使用 AI 转录音频，或集成 API 来自动化工作流程。"
  ],
  [
    "Normal web transcription is unlimited and free, with no ads. Service protections still apply to abusive traffic.",
    "Normal web transkripsiyonu sınırsız, ücretsiz ve reklamsızdır. Kötüye kullanılan trafiğe karşı hizmet korumaları uygulanır.",
    "La transcripción web normal es ilimitada, gratuita y sin anuncios. Se aplican protecciones frente al tráfico abusivo.",
    "正常网页转录不限量、免费且无广告。滥用流量仍受服务保护措施限制。"
  ],
  [
    "Free web transcripts are returned to your browser and are not saved to the server archive. Caption availability depends on the video source. AI fallback requires a configured audio transcription provider.",
    "Ücretsiz web transkriptleri tarayıcıya gönderilir ve sunucu arşivine kaydedilmez. Altyazıların kullanılabilirliği video kaynağına bağlıdır. Yapay zekâ ile transkripsiyon için bir ses transkripsiyon sağlayıcısının yapılandırılmış olması gerekir.",
    "Las transcripciones web gratuitas se envían al navegador y no se guardan en el archivo del servidor. La disponibilidad de subtítulos depende de la fuente. La transcripción con IA requiere un proveedor de transcripción de audio configurado.",
    "免费网页转录文本返回浏览器，不保存到服务器存档。字幕可用性取决于视频来源。AI 转录需要已配置的音频转录服务。"
  ],
  [
    "Use an API key from an eligible workspace. New paid plans are currently under maintenance.",
    "Uygun bir çalışma alanının API anahtarını kullanın. Yeni ücretli planlar şu anda bakımda.",
    "Usa una clave de un espacio elegible. Los nuevos planes de pago están en mantenimiento.",
    "使用符合条件的工作区 API 密钥。新付费方案目前正在维护。"
  ],
  [
    "Send your API key in the Authorization header. Keys belong to a workspace and can have their own usage limits.",
    "API anahtarınızı Authorization başlığında gönderin. Anahtarlar bir çalışma alanına bağlıdır ve kendi kullanım sınırları olabilir.",
    "Envía la clave en el encabezado Authorization. Las claves pertenecen a un espacio y pueden tener límites propios.",
    "在 Authorization 标头中发送 API 密钥。密钥属于工作区，可设有独立使用限制。"
  ],
  [
    "Never place a secret key in browser or public client code. Rotate exposed keys. Missing, invalid, or expired keys are rejected; an authentication service outage returns 503.",
    "Gizli anahtarları tarayıcıya veya herkese açık istemci koduna koymayın. Açığa çıkan anahtarları yenileyin. Eksik, geçersiz veya süresi dolmuş anahtarlar reddedilir; kimlik doğrulama hizmeti kesintisi 503 döndürür.",
    "No incluyas claves secretas en el navegador ni en código público. Rota las claves expuestas. Se rechazan claves ausentes, inválidas o caducadas; una interrupción de autenticación devuelve 503.",
    "请勿在浏览器或公开客户端代码中放置密钥。轮换泄露的密钥。缺失、无效或过期密钥会被拒绝；身份验证服务中断时返回 503。"
  ],
  [
    "Send one supported video URL and receive its transcript. The server tries captions before audio fallback when available.",
    "Desteklenen bir video URL’si gönderip transkriptini alın. Sunucu, mümkün olduğunda ses işleme öncesinde altyazıları dener.",
    "Envía una URL compatible y recibe la transcripción. El servidor intenta obtener subtítulos antes de procesar el audio, cuando están disponibles.",
    "发送一个受支持的视频 URL 并获取转录。可用时，服务器先尝试字幕，再处理音频。"
  ],
  [
    "JSON is the default. Set format to txt, srt, or vtt for a text response. Segment start and duration values are in seconds.",
    "Varsayılan biçim JSON’dur. Metin yanıtı için format değerini txt, srt veya vtt yapın. Bölümlerin start ve duration değerleri saniye cinsindedir.",
    "JSON es el formato predeterminado. Usa txt, srt o vtt en format para recibir texto. Los valores start y duration de los segmentos están en segundos.",
    "默认格式为 JSON。将 format 设为 txt、srt 或 vtt 可获得文本响应。分段 start 和 duration 的单位为秒。"
  ],
  [
    "Use plainText for a continuous transcript, or segments for timestamped captions. captionSource identifies the transcript source.",
    "Kesintisiz metin için plainText, zaman damgalı altyazı için segments kullanın. captionSource, transkriptin kaynağını belirtir.",
    "Usa plainText para texto continuo o segments para subtítulos con marcas de tiempo. captionSource identifica la fuente.",
    "使用 plainText 获取连续文本，或使用 segments 获取带时间戳字幕。captionSource 标识转录来源。"
  ],
  [
    "Caption languages depend on the source video and provider. The create-transcript endpoint does not accept a language parameter.",
    "Altyazı dilleri kaynak videoya ve sağlayıcıya bağlıdır. Transkript oluşturma uç noktası language parametresini kabul etmez.",
    "Los idiomas de subtítulos dependen del vídeo y el proveedor. El endpoint de creación no acepta el parámetro language.",
    "字幕语言取决于来源视频与服务商。创建转录端点不接受 language 参数。"
  ],
  [
    "Transcript translation is a separate operation. The translation catalog currently includes",
    "Transkript çevirisi ayrı bir işlemdir. Çeviri kataloğunda şu anda",
    "La traducción es una operación independiente. El catálogo incluye actualmente",
    "转录翻译是独立操作。翻译目录目前包含"
  ],
  [
    "languages.",
    "dil bulunur.",
    "idiomas.",
    "种语言。"
  ],
  [
    "Audio fallback requires a configured transcription provider. It may take longer than fetching captions and consumes separate AI processing hours in paid workspaces.",
    "Sesin metne dönüştürülmesi için yapılandırılmış bir transkripsiyon sağlayıcısı gerekir. Bu işlem altyazı almaktan daha uzun sürebilir. Ücretli çalışma alanlarında yapay zekâ ile transkripsiyon için ayrılan kotadan düşülür.",
    "El procesamiento de audio requiere un proveedor configurado. Puede tardar más que obtener subtítulos y consume horas de IA separadas en los espacios de pago.",
    "音频处理需要已配置的转录服务。它可能比获取字幕耗时更长，并在付费工作区中消耗独立 AI 处理时数。"
  ],
  [
    "For YouTube, allowAiFallback defaults to true. Set it to false to require confirmation before audio transcription, or set forceAiFallback to true to bypass captions. Other platform adapters manage their own fallback behavior.",
    "YouTube için allowAiFallback varsayılan olarak true’dur. Sesin metne dönüştürülmesinden önce onay istemek için bu değeri false yapın. Altyazılar yerine doğrudan sesi işlemek için forceAiFallback değerini true yapın. Diğer platform adaptörleri alternatif işleme yöntemlerini kendileri yönetir.",
    "En YouTube, allowAiFallback es true por defecto. Usa false para pedir confirmación antes de transcribir audio, o forceAiFallback: true para omitir subtítulos. Los demás adaptadores gestionan su propio comportamiento.",
    "YouTube 的 allowAiFallback 默认为 true。设为 false 可要求音频转录前确认，或将 forceAiFallback 设为 true 来跳过字幕。其他平台适配器管理各自的回退行为。"
  ],
  [
    "If a transcript cannot be produced, the request returns an error. No captions and missing audio-provider configuration are distinct failures; see",
    "Transkript üretilemezse istek hata döndürür. Altyazı bulunmaması ile ses sağlayıcısının yapılandırılmaması farklı hatalardır; bkz.",
    "Si no se puede generar una transcripción, la solicitud devuelve un error. La falta de subtítulos y de configuración de audio son fallos distintos; consulta",
    "无法生成转录时请求返回错误。无字幕与未配置音频服务是不同故障；请参阅"
  ],
  [
    "error responses",
    "hata yanıtları",
    "respuestas de error",
    "错误响应"
  ],
  [
    "Bulk jobs require Business or Custom workspace access. Business accepts up to 1,000 YouTube URLs per batch. Custom limits follow the active contract. Other video platforms are currently supported only by the single-video endpoint.",
    "Toplu işleme, Business veya Custom çalışma alanı erişimi gerektirir. Business planında her toplu işlem için en fazla 1.000 YouTube bağlantısı gönderilebilir. Custom planının sınırları etkin sözleşmeye bağlıdır. Diğer platformlar şu anda yalnızca tek video uç noktasında desteklenir.",
    "Los lotes requieren acceso Business o Custom. Business admite hasta 1.000 URL de YouTube por lote. Los límites Custom dependen del contrato. Otros sitios solo se admiten en el endpoint de vídeo individual.",
    "批量任务需要 Business 或 Custom 工作区权限。Business 每批最多接受 1,000 个 YouTube URL。Custom 限制遵循当前合同。其他平台目前仅受单视频端点支持。"
  ],
  [
    "Send a urls array. The server validates every URL, removes duplicate YouTube video IDs, and queues the job.",
    "Bir urls dizisi gönderin. Sunucu her URL’yi doğrular, tekrarlanan YouTube video kimliklerini kaldırır ve işi sıraya alır.",
    "Envía un array urls. El servidor valida las URL, elimina los ID de YouTube duplicados y pone la tarea en cola.",
    "发送 urls 数组。服务器验证每个 URL，移除重复 YouTube 视频 ID，并将任务加入队列。"
  ],
  [
    "Poll the returned poll_url for total, completed, failed, and status. Fetch the per-video records from the results endpoint.",
    "total, completed, failed ve status değerlerini almak için yanıttaki poll_url adresini sorgulayın. Video bazındaki kayıtları results uç noktasından alın.",
    "Consulta poll_url para obtener total, completed, failed y status. Obtén los registros por vídeo en el endpoint results.",
    "轮询返回的 poll_url 以获取 total、completed、failed 和 status。从 results 端点获取每个视频的记录。"
  ],
  [
    "Results contain each item's URL, status, transcript_id, and error. Failed items remain visible so you can retry only the affected videos.",
    "Sonuçlar her öğenin URL, status, transcript_id ve error alanlarını içerir. Başarısız öğeler görünür kalır; yalnızca etkilenen videoları yeniden deneyebilirsiniz.",
    "Los resultados incluyen URL, status, transcript_id y error de cada elemento. Los fallos siguen visibles para reintentar solo los vídeos afectados.",
    "结果包含每项的 URL、status、transcript_id 和 error。失败项保持可见，便于仅重试受影响的视频。"
  ],
  [
    "A batch is processed concurrently within the worker's configured capacity. Batch size is not the number of videos running simultaneously. Throughput depends on server configuration, source availability, and the active workspace contract.",
    "Toplu işlemdeki videolar, işleme hizmetinin yapılandırılmış kapasitesine göre eşzamanlı işlenir. Toplu işlemdeki video sayısı, aynı anda işlenen video sayısını belirlemez. İşleme hızı; sunucu yapılandırmasına, kaynağa erişime ve etkin çalışma alanı sözleşmesine bağlıdır.",
    "Un lote se procesa en paralelo dentro de la capacidad del worker. El tamaño del lote no es la cantidad de vídeos ejecutándose simultáneamente. La capacidad depende del servidor, la fuente y el contrato activo.",
    "批次在 worker 配置容量内并发处理。批次大小不等于同时运行的视频数。吞吐量取决于服务器配置、来源可用性和当前工作区合同。"
  ],
  [
    "Eligible workspaces support API workflows, completion webhooks, scheduled YouTube channel sync, and a searchable transcript archive. Feature access and usage allowances depend on the plan.",
    "Uygun çalışma alanları API iş akışlarını, tamamlanma webhook’larını, zamanlanmış YouTube kanal eşitlemesini ve aranabilir transkript arşivini destekler. Özellik erişimi ve kullanım hakları plana bağlıdır.",
    "Los espacios elegibles admiten API, webhooks de finalización, sincronización programada de canales YouTube y archivo consultable. El acceso y las cuotas dependen del plan.",
    "符合条件的工作区支持 API 工作流、完成 webhook、定时 YouTube 频道同步和可搜索转录存档。功能权限与使用配额取决于方案。"
  ],
  [
    "Make webhook handlers idempotent. Read the batch status and per-item errors before retrying; avoid resubmitting a whole collection on every poll.",
    "Webhook işleyicileri tekrar gelen olayları güvenli işlemeli. Yeniden denemeden önce grup durumunu ve öğe hatalarını okuyun; her sorguda koleksiyonun tamamını yeniden göndermeyin.",
    "Haz que los handlers de webhook sean idempotentes. Revisa el estado y los errores por elemento antes de reintentar; no reenvíes toda la colección en cada consulta.",
    "Webhook 处理器应具备幂等性。重试前读取批次状态与逐项错误；避免每次轮询都重新提交整个集合。"
  ],
  [
    "Public web endpoints have configurable abuse protection. API requests also respect workspace processing allowances and per-key limits. There is no single published requests-per-minute value for every endpoint.",
    "Herkese açık web uç noktalarında yapılandırılabilir kötüye kullanım önlemleri vardır. API istekleri de çalışma alanının işlem kotasına ve anahtarın kullanım sınırlarına tabidir. Tüm uç noktalar için geçerli, yayımlanmış tek bir dakika başına istek sınırı yoktur.",
    "Los endpoints web tienen protección configurable contra abuso. Las solicitudes API respetan cuotas del espacio y límites de clave. No hay un único valor público de solicitudes por minuto para todos los endpoints.",
    "公开网页端点设有可配置的滥用保护。API 请求也遵守工作区处理配额和密钥限制。各端点没有统一公布的每分钟请求数。"
  ],
  [
    "A 429 response can indicate a traffic limit, an exhausted processing allowance, or an API-key limit. Check the error code before retrying. Use exponential backoff with jitter for transient 429 and 5xx responses; exhausted quotas require a workspace limit change.",
    "429 yanıtı trafik sınırını, tükenmiş işleme hakkını veya API anahtarı sınırını gösterebilir. Yeniden denemeden önce hata kodunu kontrol edin. Geçici 429 ve 5xx yanıtlarında rastgele paylı üstel geri çekilme kullanın; tükenmiş kotalar çalışma alanı sınırının değiştirilmesini gerektirir.",
    "Un 429 puede indicar límite de tráfico, cuota agotada o límite de clave. Revisa el código antes de reintentar. Usa backoff exponencial con jitter para 429 y 5xx temporales; las cuotas agotadas requieren cambiar el límite del espacio.",
    "429 响应可能表示流量限制、处理配额耗尽或密钥限制。重试前检查错误代码。临时 429 和 5xx 响应使用带随机抖动的指数退避；配额耗尽需调整工作区限制。"
  ],
  [
    "Free web transcription does not save transcripts to the server archive. Account, billing, feedback, and security records may be retained to operate the service.",
    "Ücretsiz web transkripsiyonu transkriptleri sunucu arşivine kaydetmez. Hizmetin işletilmesi için hesap, faturalandırma, geri bildirim ve güvenlik kayıtları saklanabilir.",
    "La transcripción web gratuita no guarda transcripciones en el archivo del servidor. Se pueden conservar registros de cuenta, facturación, comentarios y seguridad para operar el servicio.",
    "免费网页转录不保存到服务器存档。账户、账单、反馈和安全记录可能为服务运行而保留。"
  ],
  [
    "Free web transcripts are returned to the browser without server-side transcript retention. Aggregate usage metrics and technical service records are separate from transcript storage.",
    "Ücretsiz web transkriptleri sunucuda saklanmadan tarayıcıya döner. Toplu kullanım metrikleri ve teknik hizmet kayıtları, transkript saklamadan ayrıdır.",
    "Las transcripciones web gratuitas se devuelven sin retención de transcripciones en el servidor. Las métricas agregadas y registros técnicos son independientes del almacenamiento de transcripciones.",
    "免费网页转录返回浏览器，服务器不保留转录。汇总使用指标和技术服务记录与转录存储分开。"
  ],
  [
    "Archive-enabled paid workspaces save transcripts for search and automation. Retention and deletion requirements depend on the feature and active workspace contract; the free-web policy is not a blanket promise for paid archives.",
    "Arşiv özellikli ücretli çalışma alanları transkriptleri arama ve otomasyon için kaydeder. Saklama ve silme koşulları özelliğe ve etkin sözleşmeye bağlıdır; ücretsiz web politikası ücretli arşivlere genel bir taahhüt oluşturmaz.",
    "Los espacios de pago con archivo guardan transcripciones para búsqueda y automatización. La retención y eliminación dependen de la función y el contrato; la política web gratuita no se aplica como garantía general a los archivos de pago.",
    "启用存档的付费工作区保存转录以用于搜索和自动化。保留与删除要求取决于功能和当前合同；免费网页政策并非对付费存档的通用承诺。"
  ],
  [
    "The browser submits a URL to the server. A platform adapter fetches available captions or uses configured audio transcription. Single-video responses return directly; bulk requests enter a persistent job queue with bounded worker concurrency.",
    "Tarayıcı video bağlantısını sunucuya gönderir. Platform adaptörü mevcut altyazıları alır veya yapılandırılmış ses transkripsiyonunu kullanır. Tek video için sonuç doğrudan gönderilir. Toplu istekler ise eşzamanlı işlem kapasitesi sınırlı olan kalıcı bir işlem kuyruğuna alınır.",
    "El navegador envía la URL al servidor. Un adaptador obtiene subtítulos o usa transcripción de audio configurada. Las respuestas individuales vuelven directamente; los lotes entran en una cola persistente con concurrencia limitada.",
    "浏览器将 URL 提交到服务器。平台适配器获取可用字幕或使用已配置的音频转录。单视频响应直接返回；批量请求进入具备受限 worker 并发的持久任务队列。"
  ],
  [
    "API keys scope requests to a workspace. Supabase stores workspace records and queued jobs; saved transcripts are available only in archive-enabled workflows. Public homepage statistics use aggregate metrics.",
    "API anahtarları istekleri çalışma alanıyla sınırlar. Supabase çalışma alanı kayıtlarını ve sıradaki işleri saklar; kaydedilen transkriptler yalnızca arşiv özellikli iş akışlarında bulunur. Ana sayfa istatistikleri toplu metrikleri kullanır.",
    "Las claves API delimitan las solicitudes al espacio. Supabase almacena registros y tareas en cola; las transcripciones guardadas solo existen en flujos con archivo. Las estadísticas públicas usan métricas agregadas.",
    "API 密钥将请求限定于工作区。Supabase 存储工作区记录和队列任务；保存的转录仅用于启用存档的工作流。公开首页统计使用汇总指标。"
  ],
  [
    "Purpose",
    "Amaç",
    "Propósito",
    "用途"
  ],
  [
    "Create a transcript from one video URL.",
    "Bir video URL’sinden transkript oluşturun.",
    "Crea una transcripción de una URL.",
    "从一个视频 URL 创建转录。"
  ],
  [
    "Bearer API key from an eligible workspace.",
    "Uygun çalışma alanından Bearer API anahtarı.",
    "Clave Bearer de un espacio elegible.",
    "符合条件工作区的 Bearer API 密钥。"
  ],
  [
    "Request",
    "İstek",
    "Solicitud",
    "请求"
  ],
  [
    "JSON body; Content-Type: application/json.",
    "JSON gövdesi; Content-Type: application/json.",
    "Cuerpo JSON; Content-Type: application/json.",
    "JSON 请求体；Content-Type: application/json。"
  ],
  [
    "A supported video URL.",
    "Desteklenen bir video URL’si.",
    "Una URL de vídeo compatible.",
    "受支持的视频 URL。"
  ],
  [
    "Use lowercase json, txt, srt, or vtt.",
    "Küçük harfle json, txt, srt veya vtt kullanın.",
    "Usa json, txt, srt o vtt en minúsculas.",
    "使用小写 json、txt、srt 或 vtt。"
  ],
  [
    "Allow audio transcription when YouTube captions are missing.",
    "YouTube altyazıları yoksa ses transkripsiyonuna izin verin.",
    "Permite transcribir audio si faltan subtítulos de YouTube.",
    "YouTube 无字幕时允许音频转录。"
  ],
  [
    "Use audio transcription directly for YouTube.",
    "YouTube için doğrudan ses transkripsiyonu kullanın.",
    "Usa transcripción de audio directamente en YouTube.",
    "YouTube 直接使用音频转录。"
  ],
  [
    "Only the fields above are supported. Caption language selection is not a request parameter. AI flags apply to the YouTube adapter.",
    "Yalnızca yukarıdaki alanlar desteklenir. Altyazı dili seçimi istek parametresi değildir. AI seçenekleri YouTube adaptörüne uygulanır.",
    "Solo se admiten los campos anteriores. La selección de idioma no es un parámetro. Las opciones de IA se aplican al adaptador YouTube.",
    "仅支持上述字段。字幕语言选择不是请求参数。AI 选项适用于 YouTube 适配器。"
  ],
  [
    "Example and response",
    "Örnek ve yanıt",
    "Ejemplo y respuesta",
    "示例与响应"
  ],
  [
    "Errors return a JSON error code. The entries below cover common single-video and workspace failures; platform adapters may return additional source-specific errors.",
    "Hatalar JSON hata kodu döndürür. Aşağıdaki liste yaygın tek video ve çalışma alanı hatalarını kapsar; platform adaptörleri kaynağa özgü ek hatalar döndürebilir.",
    "Los errores devuelven un código JSON. La lista cubre fallos comunes de vídeo y espacio; los adaptadores pueden devolver errores específicos de la fuente.",
    "错误返回 JSON 错误代码。下表涵盖常见单视频和工作区故障；平台适配器可能返回其他来源特定错误。"
  ],
  [
    "Send a valid Bearer API key.",
    "Geçerli bir Bearer API anahtarı gönderin.",
    "Envía una clave Bearer válida.",
    "发送有效的 Bearer API 密钥。"
  ],
  [
    "Bulk processing requires Business or Custom access.",
    "Toplu işleme Business veya Custom erişimi gerektirir.",
    "Los lotes requieren acceso Business o Custom.",
    "批量处理需要 Business 或 Custom 权限。"
  ],
  [
    "Enable allowAiFallback to permit audio transcription.",
    "Ses transkripsiyonuna izin vermek için allowAiFallback’i etkinleştirin.",
    "Activa allowAiFallback para permitir transcripción de audio.",
    "启用 allowAiFallback 以允许音频转录。"
  ],
  [
    "Audio transcription failed; retry or check the source.",
    "Ses transkripsiyonu başarısız; yeniden deneyin veya kaynağı kontrol edin.",
    "Falló la transcripción de audio; reintenta o revisa la fuente.",
    "音频转录失败；请重试或检查来源。"
  ],
  [
    "Check workspace and API-key usage limits.",
    "Çalışma alanı ve API anahtarı sınırlarını kontrol edin.",
    "Revisa los límites del espacio y la clave API.",
    "检查工作区与 API 密钥使用限制。"
  ],
  [
    "The workspace processing-hour allowance is exhausted.",
    "Çalışma alanının işleme saati hakkı tükendi.",
    "Se ha agotado la cuota de horas del espacio.",
    "工作区处理时数配额已耗尽。"
  ],
  [
    "An audio transcription provider is not configured.",
    "Ses transkripsiyon sağlayıcısı yapılandırılmamış.",
    "No hay proveedor de audio configurado.",
    "未配置音频转录服务。"
  ],
  [
    "YouTube caption access is temporarily restricted.",
    "YouTube altyazı erişimi geçici olarak kısıtlı.",
    "El acceso a subtítulos de YouTube está restringido temporalmente.",
    "YouTube 字幕访问暂时受限。"
  ],
  [
    "Single-video transcription supports YouTube, Vimeo, TED, Dailymotion, and Bilibili. Bilibili captions may require a configured server session. Bulk jobs currently accept YouTube URLs only.",
    "Tek video transkripsiyonu YouTube, Vimeo, TED, Dailymotion ve Bilibili’yi destekler. Bilibili altyazıları yapılandırılmış sunucu oturumu gerektirebilir. Toplu işler şu anda yalnızca YouTube URL’lerini kabul eder.",
    "La transcripción individual admite YouTube, Vimeo, TED, Dailymotion y Bilibili. Bilibili puede requerir una sesión de servidor. Los lotes solo aceptan URL YouTube.",
    "单视频转录支持 YouTube、Vimeo、TED、Dailymotion 和 Bilibili。Bilibili 字幕可能需要已配置的服务器会话。批量任务目前仅接受 YouTube URL。"
  ],
  [
    "Can I choose a caption language in the API request?",
    "API isteğinde altyazı dili seçebilir miyim?",
    "¿Puedo elegir un idioma de subtítulos en la solicitud?",
    "可以在 API 请求中选择字幕语言吗？"
  ],
  [
    "No. The create-transcript endpoint does not accept a language parameter. Caption availability depends on the source; transcript translation is a separate operation.",
    "Hayır. Transkript oluşturma uç noktası language parametresini kabul etmez. Altyazıların kullanılabilirliği kaynağa bağlıdır; transkript çevirisi ayrı bir işlemdir.",
    "No. El endpoint de creación no acepta language. La disponibilidad depende de la fuente; la traducción es independiente.",
    "不可以。创建转录端点不接受 language 参数。字幕可用性取决于来源；转录翻译是独立操作。"
  ],
  [
    "Are paid plans available now?",
    "Ücretli planlar şu an açık mı?",
    "¿Están disponibles los planes de pago?",
    "付费方案现在可用吗？"
  ],
  [
    "New paid plans are under maintenance. The API examples describe implemented workflows for eligible existing workspaces.",
    "Yeni ücretli planlar bakımda. API örnekleri, uygun mevcut çalışma alanlarında uygulanmış iş akışlarını gösterir.",
    "Los nuevos planes están en mantenimiento. Los ejemplos describen flujos implementados para espacios existentes elegibles.",
    "新付费方案正在维护。API 示例描述符合条件的现有工作区中已实现的工作流。"
  ],
  [
    "Transcribe a video →",
    "Videoyu metne dönüştürün →",
    "Transcribe un vídeo →",
    "转录视频 →"
  ],
  [
    "Data retention →",
    "Veri saklama →",
    "Retención de datos →",
    "数据保留 →"
  ],
  [
    "Open dashboard →",
    "Paneli aç →",
    "Abrir panel →",
    "打开控制台 →"
  ],
  [
    "Parameters and endpoint details →",
    "Parametreler ve uç nokta ayrıntıları →",
    "Parámetros y detalles del endpoint →",
    "参数与端点详情 →"
  ],
  [
    "Pricing and availability →",
    "Fiyatlandırma ve erişim →",
    "Precios y disponibilidad →",
    "定价与可用性 →"
  ],
  [
    "Parallel jobs →",
    "Paralel işler →",
    "Tareas en paralelo →",
    "并行任务 →"
  ],
  [
    "Request examples in five runtimes →",
    "Beş ortamda istek örnekleri →",
    "Ejemplos en cinco entornos →",
    "五种运行环境的请求示例 →"
  ],
  [
    "Response fields and export formats →",
    "Yanıt alanları ve dışa aktarma biçimleri →",
    "Campos y formatos de exportación →",
    "响应字段与导出格式 →"
  ],
  [
    "JSON request",
    "JSON isteği",
    "Solicitud JSON",
    "JSON 请求"
  ],
  [
    "JSON response · example",
    "JSON yanıtı · örnek",
    "Respuesta JSON · ejemplo",
    "JSON 响应 · 示例"
  ],
  [
    "Batch request",
    "Toplu istek",
    "Solicitud por lotes",
    "批量请求"
  ],
  [
    "Queued response · example",
    "Sıraya alınan yanıt · örnek",
    "Respuesta en cola · ejemplo",
    "队列响应 · 示例"
  ],
  [
    "Authenticated polling",
    "Kimliği doğrulanmış sorgulama",
    "Consulta autenticada",
    "经过身份验证的轮询"
  ],
  [
    "Header",
    "Başlık",
    "Encabezado",
    "标头"
  ],
  [
    "Optional · json",
    "İsteğe bağlı · json",
    "Opcional · json",
    "可选 · json"
  ],
  [
    "Optional · true",
    "İsteğe bağlı · true",
    "Opcional · true",
    "可选 · true"
  ],
  [
    "Optional · false",
    "İsteğe bağlı · false",
    "Opcional · false",
    "可选 · false"
  ],
  [
    "Copy failed",
    "Kopyalanamadı",
    "Error al copiar",
    "复制失败"
  ],
  [
    "Code copied.",
    "Kod kopyalandı.",
    "Código copiado.",
    "代码已复制。"
  ],
  [
    "Clipboard access was denied.",
    "Pano erişimi reddedildi.",
    "Se denegó el acceso al portapapeles.",
    "剪贴板访问被拒绝。"
  ]
]

export function docsTranslations(locale: Exclude<SiteLocale, 'en'>): Record<string, string> {
  const index = locale === 'tr' ? 1 : locale === 'es' ? 2 : 3
  return Object.fromEntries(rows.map(row => [row[0], row[index]]))
}
