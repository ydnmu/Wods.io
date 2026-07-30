import fs from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const sourceFiles = [
  'src/pages/HomePage.tsx',
  'src/pages/DashboardPage.tsx',
  'src/pages/DocsPage.tsx',
  'src/pages/BusinessPage.tsx',
  'src/pages/CheckoutPage.tsx',
  'src/pages/CheckoutCompletePage.tsx',
  'src/pages/AuthVerifyPage.tsx',
  'src/pages/LegalPage.tsx',
  'src/components/Footer.tsx',
  'src/components/NoCaptionsModal.tsx',
  'src/components/ThemeBackdrop.tsx',
  'src/lib/languages.ts',
  'src/lib/plans.ts',
]

const ignoredExact = new Set([
  'active', 'api', 'button', 'cancelled', 'code', 'dark', 'en', 'hidden', 'idle',
  'json', 'light', 'none', 'original', 'pending', 'sending', 'success', 'tr', 'txt',
  'url', 'vtt', 'zh',
])

const shouldTranslate = (value) => {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length < 2 || text.length > 900 || !/[A-Za-z]/.test(text)) return false
  if (ignoredExact.has(text.toLowerCase())) return false
  if (/^(https?:|mailto:|\/|#|--|et_|application\/|Bearer |POST$|GET$)/.test(text)) return false
  if (/[{}[\]<>]|\\n|=>|;\s*$/.test(text)) return false
  return true
}

const phrases = new Set()
const decodeJsxEntities = (text) => text
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&apos;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')

for (const relativePath of sourceFiles) {
  const source = await fs.readFile(path.join(root, relativePath), 'utf8')
  const file = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  const visit = (node) => {
    if (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = decodeJsxEntities(node.text).replace(/\s+/g, ' ').trim()
      if (shouldTranslate(text)) phrases.add(text)
    }
    ts.forEachChild(node, visit)
  }

  visit(file)
}

const cachePath = path.join(root, '.cache', 'public-translations.json')
await fs.mkdir(path.dirname(cachePath), { recursive: true })
let cache = {}
try {
  cache = JSON.parse(await fs.readFile(cachePath, 'utf8'))
} catch {
  cache = {}
}

const targets = ['zh-CN', 'tr', 'es']
const sortedPhrases = [...phrases].sort((a, b) => a.localeCompare(b))

const translate = async (text, target) => {
  const key = `${target}:${text}`
  if (cache[key]) return cache[key]

  const url = new URL('https://translate.googleapis.com/translate_a/single')
  url.searchParams.set('client', 'gtx')
  url.searchParams.set('sl', 'en')
  url.searchParams.set('tl', target)
  url.searchParams.set('dt', 't')
  url.searchParams.set('q', text)

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (response.ok) {
      const payload = await response.json()
      const translated = payload[0].map((part) => part[0]).join('').trim()
      cache[key] = translated
      return translated
    }
    if (attempt === 4) {
      throw new Error(`Translation failed (${response.status}) for ${target}: ${text.slice(0, 80)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 700))
  }
  return text
}

const maps = { zh: {}, tr: {}, es: {} }
const targetKeys = { 'zh-CN': 'zh', tr: 'tr', es: 'es' }

for (const target of targets) {
  const key = targetKeys[target]
  for (let index = 0; index < sortedPhrases.length; index += 8) {
    const batch = sortedPhrases.slice(index, index + 8)
    const translated = await Promise.all(batch.map((phrase) => translate(phrase, target)))
    batch.forEach((phrase, phraseIndex) => {
      maps[key][phrase] = translated[phraseIndex]
    })
    process.stdout.write(`\r${target}: ${Math.min(index + batch.length, sortedPhrases.length)}/${sortedPhrases.length}`)
    await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
  }
  process.stdout.write('\n')
  await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
}

const manualOverrides = {
  zh: {
    'Architecture': '系统架构',
    'AI fallback': 'AI 备用转录',
    'AI fallback available': '可使用 AI 备用转录',
    'AI fallback when available': '可用时启用 AI 备用转录',
    'Use AI fallback': '使用 AI 备用转录',
    '50 AI fallback hours / month': '每月 50 小时 AI 备用转录',
    '500 AI fallback hours / month': '每月 500 小时 AI 备用转录',
    'Bearer token required': '需要 Bearer 令牌',
    'Business': '商业版',
    'Custom': '定制',
    'Developer': '开发者版',
    'EasyTran': 'EasyTran',
    'Enterprise': '企业版',
    'Free': '免费',
    'Fireworks AI': 'Fireworks AI',
    'Merchant of Record': 'Merchant of Record',
    'OpenAI': 'OpenAI',
    'Polar': 'Polar',
    'Popular': '热门',
    'Resend': 'Resend',
    'Supabase': 'Supabase',
    'Price!': '价格',
    'Start free': '免费开始',
    'Start transcribing': '开始转录',
    'Start building': '开始开发',
    'Talk to sales': '联系销售',
    'Due today': '今日应付',
    'Home': '首页',
    'home': '首页',
    'Library': '转录库',
    'Usage': '用量',
    'John Doe': 'John Doe',
    'JOB': '任务',
    'Recent jobs': '最近任务',
    'processed': '已处理',
    'failed': '失败',
    'Developer': '开发者',
    'Output': '输出',
    'Sign out': '退出登录',
    'From payment to your first transcript.': '从付款到第一份转录文本',
    'month': '月',
    'mo': '月',
    'Choose Developer': '选择开发者版',
    'Choose Business': '选择商业版',
    'Contact sales': '联系销售',
    'Back to free web transcribe': '返回免费网页转录',
    'Transcript workspace': '转录工作区',
    'Everything after you press Transcribe.': '点击“转录”之后的一切。',
    'Saved transcripts, scheduled channels, API keys and team access—kept in one place.': '已保存的转录、定时频道、API 密钥和团队访问权限，集中管理。',
    'Private workspace': '私有工作区',
    'Secure session · 7 days': '安全会话 · 7 天',
    'Member access': '成员登录',
    'First access': '首次登录',
    'Use your access key': '使用访问密钥',
    'Open your existing EasyTran workspace.': '打开现有的 EasyTran 工作区。',
    'Paste the temporary key sent by email or issued by your workspace admin.': '粘贴邮件中收到或工作区管理员签发的临时密钥。',
    'Access key': '访问密钥',
    'Enter your username': '输入用户名',
    'Enter your password': '输入密码',
    'Temporary access key': '临时访问密钥',
    'Paste the key from your email': '粘贴邮件中的密钥',
    'Enter workspace': '进入工作区',
    'Continue setup': '继续设置',
    'Session stays active for 7 days': '会话保持 7 天',
    'Back to transcribe': '返回转录',
    'Coming soon': '即将推出',
    'Webhooks': 'Webhooks',
  },
  tr: {
    'Architecture': 'Mimari',
    'AI fallback': 'AI yedek transkripsiyonu',
    'AI fallback available': 'AI yedek transkripsiyonu kullanılabilir',
    'AI fallback when available': 'Gerektiğinde AI yedek transkripsiyonu',
    'Use AI fallback': 'AI yedek transkripsiyonunu kullan',
    '50 AI fallback hours / month': 'Aylık 50 saat AI yedek transkripsiyonu',
    '500 AI fallback hours / month': 'Aylık 500 saat AI yedek transkripsiyonu',
    'Bearer token required': 'Bearer token gerekli',
    'Business': 'Business',
    'Custom': 'Özel',
    'Developer': 'Developer',
    'EasyTran': 'EasyTran',
    'Enterprise': 'Enterprise',
    'Free': 'Ücretsiz',
    'Fireworks AI': 'Fireworks AI',
    'Merchant of Record': 'Merchant of Record',
    'OpenAI': 'OpenAI',
    'Polar': 'Polar',
    'Popular': 'Popüler',
    'Resend': 'Resend',
    'Supabase': 'Supabase',
    'Price!': 'Fiyatlar',
    'Start free': 'Ücretsiz başla',
    'Start transcribing': 'Transkript oluşturmaya başla',
    'Start building': 'Geliştirmeye başla',
    'Talk to sales': 'Satış ekibiyle görüş',
    'Due today': 'Bugün ödenecek',
    'Home': 'Ana Sayfa',
    'home': 'ana sayfa',
    'Library': 'Arşiv',
    'Team': 'Ekip',
    'team': 'ekip',
    'John Doe': 'John Doe',
    'processed': 'işlendi',
    'Developer': 'Geliştirici',
    'Output': 'Çıktı',
    'Sign out': 'Oturumu kapat',
    'From payment to your first transcript.': 'Ödemeden ilk transkriptinize kadar.',
    'month': 'ay',
    'mo': 'ay',
    'Choose Developer': 'Developer planını seç',
    'Choose Business': 'Business planını seç',
    'Contact sales': 'Satış ekibiyle görüş',
    'Back to free web transcribe': 'Ücretsiz web transkriptine dön',
    'Transcript workspace': 'Transkript çalışma alanı',
    'Everything after you press Transcribe.': 'Transcribe’a bastıktan sonraki her şey.',
    'Saved transcripts, scheduled channels, API keys and team access—kept in one place.': 'Kaydedilen transkriptler, planlanan kanallar, API anahtarları ve ekip erişimi—hepsi tek yerde.',
    'Private workspace': 'Özel çalışma alanı',
    'Secure session · 7 days': 'Güvenli oturum · 7 gün',
    'Member access': 'Üye girişi',
    'First access': 'İlk giriş',
    'Use your access key': 'Erişim anahtarınızı kullanın',
    'Open your existing EasyTran workspace.': 'Mevcut EasyTran çalışma alanınızı açın.',
    'Paste the temporary key sent by email or issued by your workspace admin.': 'E-postayla gönderilen veya çalışma alanı yöneticinizin verdiği geçici anahtarı yapıştırın.',
    'Access key': 'Erişim anahtarı',
    'Enter your username': 'Kullanıcı adınızı girin',
    'Enter your password': 'Şifrenizi girin',
    'Temporary access key': 'Geçici erişim anahtarı',
    'Paste the key from your email': 'E-postanızdaki anahtarı yapıştırın',
    'Enter workspace': 'Çalışma alanına gir',
    'Continue setup': 'Kuruluma devam et',
    'Session stays active for 7 days': 'Oturum 7 gün açık kalır',
    'Back to transcribe': 'Transkripte dön',
    'Coming soon': 'Yakında',
    'caption video': 'altyazılı video',
    'Webhooks': 'Webhooks',
  },
  es: {
    'Architecture': 'Arquitectura',
    'AI fallback': 'Transcripción alternativa con IA',
    'AI fallback available': 'Transcripción alternativa con IA disponible',
    'AI fallback when available': 'Transcripción alternativa con IA cuando sea necesaria',
    'Use AI fallback': 'Usar transcripción alternativa con IA',
    '50 AI fallback hours / month': '50 horas de transcripción alternativa con IA al mes',
    '500 AI fallback hours / month': '500 horas de transcripción alternativa con IA al mes',
    'Bearer token required': 'Se requiere un token Bearer',
    'Business': 'Business',
    'Custom': 'Personalizado',
    'Developer': 'Developer',
    'EasyTran': 'EasyTran',
    'Enterprise': 'Enterprise',
    'Free': 'Gratis',
    'Fireworks AI': 'Fireworks AI',
    'Merchant of Record': 'Merchant of Record',
    'OpenAI': 'OpenAI',
    'Polar': 'Polar',
    'Popular': 'Popular',
    'Resend': 'Resend',
    'Supabase': 'Supabase',
    'Price!': 'Precios',
    'Start free': 'Empezar gratis',
    'Start transcribing': 'Empezar a transcribir',
    'Start building': 'Empezar a desarrollar',
    'Talk to sales': 'Hablar con ventas',
    'Due today': 'Total de hoy',
    'Home': 'Inicio',
    'home': 'inicio',
    'John Doe': 'John Doe',
    'JOB': 'TAREA',
    'Recent jobs': 'Trabajos recientes',
    'Developer': 'Desarrollador',
    'Output': 'Salida',
    'Sign out': 'Cerrar sesión',
    'From payment to your first transcript.': 'Del pago a tu primera transcripción.',
    'month': 'mes',
    'mo': 'mes',
    'Choose Developer': 'Elegir Developer',
    'Choose Business': 'Elegir Business',
    'Contact sales': 'Contactar con ventas',
    'Back to free web transcribe': 'Volver a la transcripción web gratuita',
    'Transcript workspace': 'Espacio de trabajo de transcripción',
    'Everything after you press Transcribe.': 'Todo lo que ocurre después de pulsar Transcribir.',
    'Saved transcripts, scheduled channels, API keys and team access—kept in one place.': 'Transcripciones guardadas, canales programados, claves de API y acceso de equipo, todo en un solo lugar.',
    'Private workspace': 'Espacio de trabajo privado',
    'Secure session · 7 days': 'Sesión segura · 7 días',
    'Member access': 'Acceso de miembros',
    'First access': 'Primer acceso',
    'Use your access key': 'Usa tu clave de acceso',
    'Open your existing EasyTran workspace.': 'Abre tu espacio de trabajo existente de EasyTran.',
    'Paste the temporary key sent by email or issued by your workspace admin.': 'Pega la clave temporal enviada por correo o proporcionada por el administrador de tu espacio de trabajo.',
    'Access key': 'Clave de acceso',
    'Enter your username': 'Introduce tu nombre de usuario',
    'Enter your password': 'Introduce tu contraseña',
    'Temporary access key': 'Clave de acceso temporal',
    'Paste the key from your email': 'Pega la clave de tu correo',
    'Enter workspace': 'Entrar al espacio de trabajo',
    'Continue setup': 'Continuar configuración',
    'Session stays active for 7 days': 'La sesión permanece activa durante 7 días',
    'Back to transcribe': 'Volver a transcribir',
    'Coming soon': 'Próximamente',
    'Webhooks': 'Webhooks',
  },
}

for (const locale of Object.keys(manualOverrides)) Object.assign(maps[locale], manualOverrides[locale])

Object.keys(maps.zh).forEach((source) => {
  maps.zh[source] = maps.zh[source]
    .replaceAll('成绩单', '转录文本')
    .replaceAll('人工智能后备', 'AI 备用转录')
    .replaceAll('AI 后备', 'AI 备用转录')
    .replaceAll('AI 回退', 'AI 备用转录')
})
Object.keys(maps.tr).forEach((source) => {
  maps.tr[source] = maps.tr[source]
    .replaceAll('Yapay zeka geri dönüşü', 'AI yedek transkripsiyonu')
    .replaceAll('AI geri dönüşü', 'AI yedek transkripsiyonu')
    .replaceAll('AI geri dönüş', 'AI yedek transkripsiyon')
})
Object.keys(maps.es).forEach((source) => {
  maps.es[source] = maps.es[source]
    .replaceAll('expedientes académicos', 'transcripciones')
    .replaceAll('expediente académico', 'transcripción')
    .replaceAll('respaldo de la IA', 'transcripción alternativa con IA')
    .replaceAll('respaldo de IA', 'transcripción alternativa con IA')
    .replaceAll('reserva de IA', 'transcripción alternativa con IA')
})

const outputDirectory = path.join(root, 'src', 'i18n')
await fs.mkdir(outputDirectory, { recursive: true })
for (const locale of ['zh', 'tr', 'es']) {
  const output = `/* Generated by scripts/generate-public-translations.mjs. */\n` +
    `const translations = ${JSON.stringify(maps[locale], null, 2)} as const\n` +
    `export default translations\n`
  await fs.writeFile(path.join(outputDirectory, `publicTranslations.${locale}.generated.ts`), output, 'utf8')
}
console.log(`Generated ${sortedPhrases.length} public phrases.`)
