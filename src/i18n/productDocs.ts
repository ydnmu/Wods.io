import type { SiteLocale } from '../hooks/useLocale'

type DocumentationCopy = {
  title: string
  purposeTitle: string
  purpose: string
  privacyTitle: string
  privacy: ReadonlyArray<readonly [string, string]>
  deletionTitle: string
  deletion: string
  privacyLink: string
  limitsTitle: string
  limits: ReadonlyArray<readonly [string, string]>
  paidTitle: string
  paidIntro: string
  paidFeatures: readonly string[]
  projectTitle: string
  projectLinks: string
}

export const productDocs: Record<SiteLocale, DocumentationCopy> = {
  en: {
    title: 'Documentation',
    purposeTitle: 'Purpose',
    purpose: 'WODS was created to turn video URLs into usable transcripts without requiring users to download the source video or configure transcription software. It retrieves available captions and can transcribe audio when captions are missing. Read, search, copy or export the result in your browser without creating an account.',
    privacyTitle: 'Privacy',
    privacy: [
      ['What data is processed?', 'Video URLs, source metadata, captions and transcript text. AI fallback also processes the source audio.'],
      ['What data is stored?', 'Free web transcript text is not saved to the server archive. Email signups, feedback, site usage events and aggregate response metrics are stored separately. Usage events include visitor/session IDs and successful video IDs.'],
      ['How long is it retained?', 'Free transcript results live in the open page; temporary audio files are cleaned up after processing. Signup and operational records currently have no automatic expiry.'],
      ['Third-party services', 'Source video platforms provide captions and audio. AI fallback sends audio to the configured transcription provider. Supabase handles stored service data; email notifications use Resend. Third-party retention policies also apply.'],
    ],
    deletionTitle: 'Account deletion',
    deletion: 'Free transcription needs no account. For account or personal-data deletion, contact',
    privacyLink: 'Privacy Policy',
    limitsTitle: 'Current limits',
    limits: [
      ['Maximum video length', 'No fixed duration cap is defined for free web use. Long videos can exceed audio-size limits or processing timeouts.'],
      ['Supported sources', 'YouTube, Vimeo, TED, Dailymotion and Bilibili.'],
      ['Transcript limits', 'No monthly transcript-count quota for free web use. Temporary rate limits and abuse protection still apply.'],
      ['Export formats', 'TXT, JSON, SRT and VTT.'],
      ['Known limitations', 'Private, restricted or removed videos may fail. Caption access and AI provider capacity affect availability. Bilibili captions may require a configured server session; AI output can contain errors.'],
    ],
    paidTitle: 'Paid plan',
    paidIntro: 'Paid plans are not available yet. Planned features include:',
    paidFeatures: [
      '1,000,000 hours of video transcription',
      '50,000 hours of AI fallback transcription',
      'Playlist transcription',
      'Channel transcription and auto-sync',
      'Website transcription',
      'Bulk and parallel transcription',
      'AI-edited transcripts',
      'API access and API key management',
      'Automations and completion webhooks',
      'MCP server integration',
      'Searchable transcript archives',
    ],
    projectTitle: 'Project',
    projectLinks: 'Project links',
  },
  tr: {
    title: 'Dokümantasyon',
    purposeTitle: 'Amaç',
    purpose: 'WODS, videoyu indirmenize veya transkripsiyon yazılımı kurmanıza gerek kalmadan video bağlantılarından transkript oluşturur. Mevcut altyazıları kullanır; altyazı bulunamadığında sesi yapay zekâ ile metne dönüştürebilir. Hesap oluşturmadan sonucu tarayıcınızda okuyabilir, metin içinde arama yapabilir, kopyalayabilir veya dışa aktarabilirsiniz.',
    privacyTitle: 'Gizlilik',
    privacy: [
      ['İşlenen veriler', 'Video bağlantıları, kaynak bilgileri, altyazılar ve transkript metni işlenir. Yapay zekâ ile transkripsiyon sırasında videonun sesi de işlenir.'],
      ['Saklanan veriler', 'Ücretsiz web transkriptleri sunucu arşivine kaydedilmez. E-posta kayıtları, geri bildirimler, site kullanım kayıtları ve toplu yanıt süresi ölçümleri ayrı saklanır. Kullanım kayıtları ziyaretçi ve oturum kimliklerini, ayrıca başarıyla işlenen videoların kimliklerini içerir.'],
      ['Saklama süresi', 'Ücretsiz transkript sonuçları açık olan sayfada tutulur; geçici ses dosyaları işlemden sonra silinir. E-posta kayıtları ve hizmetin işleyişine ilişkin kayıtlar için henüz otomatik silme süresi belirlenmemiştir.'],
      ['Üçüncü taraf hizmetler', 'Altyazılar ve ses, videonun bulunduğu platformdan alınır. Yapay zekâ ile transkripsiyon için ses, yapılandırılmış transkripsiyon sağlayıcısına gönderilir. Hizmet verileri Supabase’de saklanır; e-posta bildirimleri Resend aracılığıyla gönderilir. Bu hizmetlerin veri saklama politikaları da geçerlidir.'],
    ],
    deletionTitle: 'Hesap silme',
    deletion: 'Ücretsiz transkript için hesap gerekmez. Hesap veya kişisel veri silme talepleri için iletişim:',
    privacyLink: 'Gizlilik politikası',
    limitsTitle: 'Mevcut sınırlar',
    limits: [
      ['En uzun video süresi', 'Ücretsiz web kullanımında sabit bir video süresi sınırı yoktur. Uzun videolar ses dosyası boyutu sınırını aşabilir veya işlem zaman aşımına uğrayabilir.'],
      ['Desteklenen kaynaklar', 'YouTube, Vimeo, TED, Dailymotion ve Bilibili.'],
      ['Transkript sınırları', 'Ücretsiz web kullanımında aylık transkript sayısı kotası yoktur. Geçici istek sınırları ve kötüye kullanım önlemleri uygulanır.'],
      ['Dışa aktarma biçimleri', 'TXT, JSON, SRT ve VTT.'],
      ['Bilinen kısıtlamalar', 'Gizli, erişimi kısıtlı veya kaldırılmış videolar işlenemeyebilir. Altyazılara erişim ve yapay zekâ sağlayıcısının kapasitesi işlemin tamamlanmasını etkiler. Bilibili altyazıları için sunucuda yapılandırılmış bir oturum gerekebilir. Yapay zekâ ile oluşturulan metinler hata içerebilir.'],
    ],
    paidTitle: 'Ücretli plan',
    paidIntro: 'Ücretli planlar henüz kullanıma açık değil. Planlanan özellikler:',
    paidFeatures: [
      '1.000.000 saat video transkripsiyonu',
      '50.000 saat yapay zekâ ile transkripsiyon',
      'Oynatma listelerinden transkript oluşturma',
      'Kanal transkripsiyonu ve otomatik senkronizasyon',
      'Web sitelerindeki içeriklerden transkript oluşturma',
      'Toplu ve paralel transkripsiyon',
      'Yapay zekâ ile düzenlenmiş transkriptler',
      'API erişimi ve API anahtarı yönetimi',
      'Otomasyonlar ve tamamlanma webhook’ları',
      'MCP sunucusu entegrasyonu',
      'Aranabilir transkript arşivleri',
    ],
    projectTitle: 'Proje',
    projectLinks: 'Proje bağlantıları',
  },
  es: {
    title: 'Documentación',
    purposeTitle: 'Propósito',
    purpose: 'WODS convierte URL de vídeos en transcripciones útiles sin tener que descargar el vídeo ni configurar software de transcripción. Recupera los subtítulos disponibles y puede transcribir el audio cuando no hay subtítulos. Lee, busca, copia o exporta el resultado en tu navegador sin crear una cuenta.',
    privacyTitle: 'Privacidad',
    privacy: [
      ['Datos que se procesan', 'URL de vídeos, metadatos de origen, subtítulos y texto transcrito. La transcripción con IA también procesa el audio original.'],
      ['Datos que se almacenan', 'El texto de las transcripciones web gratuitas no se guarda en el archivo del servidor. Los registros de correo, comentarios, eventos de uso y métricas agregadas se almacenan por separado. Los eventos incluyen identificadores de visitante/sesión y de vídeos procesados correctamente.'],
      ['Tiempo de conservación', 'Los resultados gratuitos permanecen en la página abierta; los archivos de audio temporales se eliminan después del procesamiento. Los registros de correo y operativos no tienen actualmente un plazo de borrado automático.'],
      ['Servicios de terceros', 'Las plataformas de vídeo proporcionan subtítulos y audio. La IA envía el audio al proveedor de transcripción configurado. Supabase almacena los datos del servicio; Resend envía las notificaciones por correo. También se aplican las políticas de conservación de los terceros.'],
    ],
    deletionTitle: 'Eliminación de cuenta',
    deletion: 'La transcripción gratuita no requiere cuenta. Para solicitar la eliminación de una cuenta o datos personales, contacta con',
    privacyLink: 'Política de Privacidad',
    limitsTitle: 'Límites actuales',
    limits: [
      ['Duración máxima del vídeo', 'El uso web gratuito no tiene un límite fijo de duración. Los vídeos largos pueden superar los límites de tamaño de audio o los tiempos de procesamiento.'],
      ['Fuentes compatibles', 'YouTube, Vimeo, TED, Dailymotion y Bilibili.'],
      ['Límites de transcripciones', 'No hay cuota mensual de transcripciones para el uso web gratuito. Se aplican límites temporales de solicitudes y medidas contra el abuso.'],
      ['Formatos de exportación', 'TXT, JSON, SRT y VTT.'],
      ['Limitaciones conocidas', 'Los vídeos privados, restringidos o eliminados pueden fallar. La disponibilidad depende del acceso a subtítulos y de la capacidad del proveedor de IA. Bilibili puede requerir una sesión configurada en el servidor; los resultados de IA pueden contener errores.'],
    ],
    paidTitle: 'Plan de pago',
    paidIntro: 'Los planes de pago aún no están disponibles. Las funciones previstas incluyen:',
    paidFeatures: [
      '1.000.000 de horas de transcripción de vídeo',
      '50.000 horas de transcripción con IA',
      'Transcripción de listas de reproducción',
      'Transcripción de canales y sincronización automática',
      'Transcripción de sitios web',
      'Transcripción por lotes y en paralelo',
      'Transcripciones editadas con IA',
      'Acceso a la API y gestión de claves de API',
      'Automatizaciones y webhooks de finalización',
      'Integración con servidor MCP',
      'Archivos de transcripciones con búsqueda',
    ],
    projectTitle: 'Proyecto',
    projectLinks: 'Enlaces del proyecto',
  },
  zh: {
    title: '文档',
    purposeTitle: '用途',
    purpose: 'WODS 将视频链接转换为可用的转录文本，无需下载源视频或配置转录软件。它获取已有字幕，并可在没有字幕时通过 AI 转录音频。无需创建账户，即可在浏览器中阅读、搜索、复制或导出结果。',
    privacyTitle: '隐私',
    privacy: [
      ['处理的数据', '视频链接、源视频元数据、字幕和转录文本。AI 转录还会处理源音频。'],
      ['存储的数据', '免费网页转录文本不会保存到服务器归档。邮件订阅、反馈、网站使用事件和汇总响应指标单独存储。使用事件包含访客/会话标识符和成功处理的视频标识符。'],
      ['保留时间', '免费转录结果保留在当前打开的页面中；临时音频文件在处理后清理。邮件订阅和运行记录目前没有自动删除期限。'],
      ['第三方服务', '源视频平台提供字幕和音频。AI 转录将音频发送到已配置的转录服务商。Supabase 存储服务数据，Resend 发送邮件通知。第三方的数据保留政策也适用。'],
    ],
    deletionTitle: '删除账户',
    deletion: '免费转录无需账户。如需删除账户或个人数据，请联系',
    privacyLink: '隐私政策',
    limitsTitle: '当前限制',
    limits: [
      ['视频最大时长', '免费网页使用没有固定时长上限。长视频可能超过音频文件大小限制或处理超时。'],
      ['支持的来源', 'YouTube、Vimeo、TED、Dailymotion 和 Bilibili。'],
      ['转录数量限制', '免费网页使用没有每月转录数量配额。仍适用临时请求限制和防滥用措施。'],
      ['导出格式', 'TXT、JSON、SRT 和 VTT。'],
      ['已知限制', '私密、受限或已删除的视频可能无法处理。字幕访问和 AI 服务容量会影响可用性。Bilibili 字幕可能需要配置服务器会话；AI 输出可能包含错误。'],
    ],
    paidTitle: '付费方案',
    paidIntro: '付费方案尚未开放。计划功能包括：',
    paidFeatures: [
      '1,000,000 小时视频转录',
      '50,000 小时 AI 转录',
      '播放列表转录',
      '频道转录与自动同步',
      '网站转录',
      '批量与并行转录',
      'AI 编辑的转录文本',
      'API 访问与 API 密钥管理',
      '自动化与完成通知 webhook',
      'MCP 服务器集成',
      '可搜索的转录归档',
    ],
    projectTitle: '项目',
    projectLinks: '项目链接',
  },
}
