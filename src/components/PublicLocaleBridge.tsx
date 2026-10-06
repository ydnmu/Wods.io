import { useEffect, useState } from 'react'
import type { SiteLocale } from '../hooks/useLocale'
import { improvePublicTranslations } from '../i18n/publicTranslationQuality'

type TranslationMap = Record<string, string>
const emptyTranslations: TranslationMap = {}
const reverseTranslationCache = new Map<Exclude<SiteLocale, 'en'>, Map<string, string>>()

const translationLoaders: Record<Exclude<SiteLocale, 'en'>, () => Promise<TranslationMap>> = {
  zh: () => import('../i18n/publicTranslations.zh').then((module) => improvePublicTranslations('zh', module.default)),
  tr: () => import('../i18n/publicTranslations.tr').then((module) => improvePublicTranslations('tr', module.default)),
  es: () => import('../i18n/publicTranslations.es').then((module) => improvePublicTranslations('es', module.default)),
}

const originalText = new WeakMap<Text, string>()
const appliedText = new WeakMap<Text, string>()
const originalAttributes = new WeakMap<Element, Map<string, string>>()
const appliedAttributes = new WeakMap<Element, Map<string, string>>()
const translatedAttributes = ['aria-label', 'placeholder', 'title']
const ignoredElements = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'SVG'])

const patternTranslations: Record<Exclude<SiteLocale, 'en'>, Array<{
  pattern: RegExp
  replace: (...groups: string[]) => string
}>> = {
  zh: [
    { pattern: /^\/ month$/, replace: () => '/ 月' },
    { pattern: /^\$(.+) \/ mo$/, replace: (price) => `$${price} / 月` },
    { pattern: /^\$(.+) \/ yr$/, replace: (price) => `$${price} / 年` },
    { pattern: /^\/ month · \$(.+) billed yearly$/, replace: (price) => `/ 月 · 每年支付 $${price}` },
    { pattern: /^Secure (.+) checkout$/, replace: (provider) => `由 ${provider} 提供安全结账` },
    { pattern: /^Card details are entered on (.+) after you continue\.$/, replace: (provider) => `继续后，您将在 ${provider} 输入银行卡信息。` },
    { pattern: /^Hosted payment via (.+)\.$/, replace: (provider) => `付款由 ${provider} 安全处理。` },
    { pattern: /^Continue to Polar · \$(.+)$/, replace: (price) => `前往 Polar 付款 · $${price}` },
    { pattern: /^(.+)h \/ mo$/, replace: (hours) => `${hours} 小时/月` },
    { pattern: /^Up to (\d+)$/, replace: (count) => `最多 ${count}` },
    { pattern: /^(\d+) failed$/, replace: (count) => `${count} 个失败` },
    { pattern: /^(\d+)\/(\d+) processed$/, replace: (done, total) => `已处理 ${done}/${total}` },
  ],
  tr: [
    { pattern: /^\/ month$/, replace: () => '/ ay' },
    { pattern: /^\$(.+) \/ mo$/, replace: (price) => `$${price} / ay` },
    { pattern: /^\$(.+) \/ yr$/, replace: (price) => `$${price} / yıl` },
    { pattern: /^\/ month · \$(.+) billed yearly$/, replace: (price) => `/ ay · yıllık $${price} faturalandırılır` },
    { pattern: /^Secure (.+) checkout$/, replace: (provider) => `${provider} ile güvenli ödeme` },
    { pattern: /^Card details are entered on (.+) after you continue\.$/, replace: (provider) => `Devam ettiğinizde kart bilgilerinizi ${provider} ödeme sayfasına girersiniz.` },
    { pattern: /^Hosted payment via (.+)\.$/, replace: (provider) => `${provider} üzerinden güvenli ödeme.` },
    { pattern: /^Continue to Polar · \$(.+)$/, replace: (price) => `Polar ile ödemeye geç · $${price}` },
    { pattern: /^(.+)h \/ mo$/, replace: (hours) => `${hours} sa/ay` },
    { pattern: /^Up to (\d+)$/, replace: (count) => `En fazla ${count}` },
    { pattern: /^(\d+) failed$/, replace: (count) => `${count} başarısız` },
    { pattern: /^(\d+)\/(\d+) processed$/, replace: (done, total) => `${done}/${total} işlendi` },
  ],
  es: [
    { pattern: /^\/ month$/, replace: () => '/ mes' },
    { pattern: /^\$(.+) \/ mo$/, replace: (price) => `$${price} / mes` },
    { pattern: /^\$(.+) \/ yr$/, replace: (price) => `$${price} / año` },
    { pattern: /^\/ month · \$(.+) billed yearly$/, replace: (price) => `/ mes · $${price} facturados al año` },
    { pattern: /^Secure (.+) checkout$/, replace: (provider) => `Pago seguro con ${provider}` },
    { pattern: /^Card details are entered on (.+) after you continue\.$/, replace: (provider) => `Los datos de la tarjeta se introducen en ${provider} después de continuar.` },
    { pattern: /^Hosted payment via (.+)\.$/, replace: (provider) => `Pago seguro gestionado por ${provider}.` },
    { pattern: /^Continue to Polar · \$(.+)$/, replace: (price) => `Continuar con Polar · $${price}` },
    { pattern: /^(.+)h \/ mo$/, replace: (hours) => `${hours} h/mes` },
    { pattern: /^Up to (\d+)$/, replace: (count) => `Hasta ${count}` },
    { pattern: /^(\d+) failed$/, replace: (count) => `${count} ${count === '1' ? 'fallido' : 'fallidos'}` },
    { pattern: /^(\d+)\/(\d+) processed$/, replace: (done, total) => `${done}/${total} procesados` },
  ],
}

const dynamicLabels = {
  tr: { words: 'kelime', segments: 'bölüm', video: 'video', videos: 'video', saved: 'kaydedilen kelime', completed: 'tamamlandı', failed: 'başarısız', job: 'İşlem', hours: 'sa', workers: 'paralel işlem' },
  es: { words: 'palabras', segments: 'segmentos', video: 'vídeo', videos: 'vídeos', saved: 'palabras guardadas', completed: 'completados', failed: 'fallidos', job: 'Proceso', hours: 'h', workers: 'procesos en paralelo' },
  zh: { words: '词', segments: '个文本片段', video: '个视频', videos: '个视频', saved: '个已保存的词', completed: '个已完成', failed: '个失败', job: '任务', hours: '小时', workers: '个并行处理任务' },
} as const

for (const locale of ['tr', 'es', 'zh'] as const) {
  const labels = dynamicLabels[locale]
  patternTranslations[locale].push(
    { pattern: /^(~?[\d,.]+) (words|segments|videos?)$/, replace: (count, unit) => {
      const label = locale === 'es' && count === '1' ? { words: 'palabra', segments: 'segmento', video: 'vídeo', videos: 'vídeo' }[unit] : labels[unit as 'words' | 'segments' | 'video' | 'videos']
      return `${count} ${label}`
    } },
    { pattern: /^([\d,.]+) words saved$/, replace: (count) => `${count} ${locale === 'es' && count === '1' ? 'palabra guardada' : labels.saved}` },
    { pattern: /^([\d,.]+) completed · ([\d,.]+) failed$/, replace: (completed, failed) => `${completed} ${locale === 'es' && completed === '1' ? 'completado' : labels.completed} · ${failed} ${locale === 'es' && failed === '1' ? 'fallido' : labels.failed}` },
    { pattern: /^(?:JOB|Job) (.+)$/, replace: (id) => `${labels.job} ${id}` },
    { pattern: /^([\d,.]+)h$/, replace: (hours) => `${hours} ${labels.hours}` },
    { pattern: /^([\d,.]+) parallel workers$/, replace: (count) => `${count} ${locale === 'es' && count === '1' ? 'proceso en paralelo' : labels.workers}` },
    { pattern: /^([\d,.]+) videos? checked$/, replace: (count) => locale === 'tr' ? `${count} video kontrol edildi` : locale === 'es' ? `${count} ${count === '1' ? 'vídeo comprobado' : 'vídeos comprobados'}` : `已检查 ${count} 个视频` },
    { pattern: /^Caption estimate based on ([\d,.]+) videos sampled across the source$/, replace: (count) => locale === 'tr' ? `Altyazı tahmini, kaynaktan seçilen ${count} video örneğine dayanır` : locale === 'es' ? `Estimación de subtítulos basada en una muestra de ${count} vídeos de la fuente` : `字幕估算基于来源中抽样的 ${count} 个视频` },
    { pattern: /^Source analysis (\d+)% complete$/, replace: (percent) => locale === 'tr' ? `Kaynak analizi %${percent} tamamlandı` : locale === 'es' ? `Análisis de la fuente completado al ${percent} %` : `来源分析已完成 ${percent}%` },
    { pattern: /^Open job (.+) transcripts$/, replace: (id) => locale === 'tr' ? `${id} işleminin transkriptlerini aç` : locale === 'es' ? `Abrir las transcripciones del proceso ${id}` : `打开任务 ${id} 的转录文本` },
    { pattern: /^(\d+)% remaining$/, replace: (percent) => locale === 'tr' ? `%${percent} kaldı` : locale === 'es' ? `${percent} % disponible` : `剩余 ${percent}%` },
    { pattern: /^This workspace can use up to (\d+) webhooks\.$/, replace: (count) => locale === 'tr' ? `Bu çalışma alanında en fazla ${count} webhook kullanılabilir.` : locale === 'es' ? `Este espacio de trabajo admite hasta ${count} webhooks.` : `此工作区最多可使用 ${count} 个 Webhook。` },
    { pattern: /^Rotate (.+) access key$/, replace: (name) => locale === 'tr' ? `${name} için erişim anahtarını yenile` : locale === 'es' ? `Renovar la clave de acceso de ${name}` : `更换 ${name} 的访问密钥` },
  )
}

const rememberTranslations = (locale: Exclude<SiteLocale, 'en'>, translations: TranslationMap) => {
  if (reverseTranslationCache.has(locale)) return
  const reverse = new Map<string, string>()
  Object.entries(translations).forEach(([source, translated]) => {
    if (!reverse.has(translated)) reverse.set(translated, source)
  })
  reverseTranslationCache.set(locale, reverse)
}

const recoverSourcePhrase = (value: string) => {
  for (const reverse of reverseTranslationCache.values()) {
    const recovered = reverse.get(value)
    if (recovered) return recovered
  }
  return value
}

const translatePhrase = (source: string, locale: SiteLocale, translations: TranslationMap) => {
  const normalized = source.replace(/\s+/g, ' ')
  const canonicalSource = recoverSourcePhrase(normalized)
  if (locale === 'en') return canonicalSource
  const exact = translations[canonicalSource] ?? translations[normalized]
  if (exact) return exact

  for (const translation of patternTranslations[locale]) {
    const match = canonicalSource.match(translation.pattern)
    if (match) return translation.replace(...match.slice(1))
  }
  return canonicalSource
}

const shouldSkip = (node: Node) => {
  const parent = node instanceof Element ? node : node.parentElement
  return Boolean(parent?.closest('code, pre, script, style, svg, [data-no-translate]'))
}

const translateTextNode = (node: Text, locale: SiteLocale, translations: TranslationMap) => {
  if (shouldSkip(node)) return
  const current = node.nodeValue ?? ''
  const lastApplied = appliedText.get(node)
  if (!originalText.has(node) || (lastApplied !== undefined && current !== lastApplied)) {
    originalText.set(node, current)
  }
  const source = originalText.get(node) ?? current
  const trimmed = source.trim()
  if (!trimmed) return

  const translated = translatePhrase(trimmed, locale, translations)
  const leading = source.match(/^\s*/)?.[0] ?? ''
  const trailing = source.match(/\s*$/)?.[0] ?? ''
  const next = `${leading}${translated}${trailing}`
  appliedText.set(node, next)
  if (node.nodeValue !== next) node.nodeValue = next
}

const translateAttributes = (element: Element, locale: SiteLocale, translations: TranslationMap) => {
  if (ignoredElements.has(element.tagName) || element.closest('[data-no-translate]')) return
  let originals = originalAttributes.get(element)
  if (!originals) {
    originals = new Map()
    originalAttributes.set(element, originals)
  }
  let applied = appliedAttributes.get(element)
  if (!applied) {
    applied = new Map()
    appliedAttributes.set(element, applied)
  }

  translatedAttributes.forEach((attribute) => {
    const current = element.getAttribute(attribute)
    if (!current) return
    const lastApplied = applied.get(attribute)
    if (!originals.has(attribute) || (lastApplied !== undefined && current !== lastApplied)) {
      originals.set(attribute, current)
    }
    const source = originals.get(attribute) ?? current
    const translated = translatePhrase(source, locale, translations)
    applied.set(attribute, translated)
    if (current !== translated) element.setAttribute(attribute, translated)
  })
}

const translateSubtree = (root: Node, locale: SiteLocale, translations: TranslationMap) => {
  if (root instanceof Text) {
    translateTextNode(root, locale, translations)
    return
  }
  if (!(root instanceof Element) || shouldSkip(root)) return

  translateAttributes(root, locale, translations)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current) {
    if (current instanceof Text) translateTextNode(current, locale, translations)
    else if (current instanceof Element) translateAttributes(current, locale, translations)
    current = walker.nextNode()
  }
}

export function PublicLocaleBridge({ locale }: { locale: SiteLocale }) {
  const [loadedTranslations, setLoadedTranslations] = useState<{
    locale: SiteLocale
    translations: TranslationMap
  }>({ locale: 'en', translations: emptyTranslations })
  const translations = locale !== 'en' && loadedTranslations.locale === locale
    ? loadedTranslations.translations
    : emptyTranslations

  useEffect(() => {
    if (locale === 'en') return
    let cancelled = false

    translationLoaders[locale]().then((nextTranslations) => {
      rememberTranslations(locale, nextTranslations)
      if (!cancelled) setLoadedTranslations({ locale, translations: nextTranslations })
    })
    return () => { cancelled = true }
  }, [locale])

  useEffect(() => {
    const root = document.getElementById('root')
    if (!root) return

    translateSubtree(root, locale, translations)
    const observer = new MutationObserver((mutations) => {
      observer.disconnect()
      mutations.forEach((mutation) => {
        if (mutation.type === 'characterData') translateSubtree(mutation.target, locale, translations)
        if (mutation.type === 'attributes' && mutation.target instanceof Element) {
          translateAttributes(mutation.target, locale, translations)
        }
        mutation.addedNodes.forEach((node) => translateSubtree(node, locale, translations))
      })
      observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: translatedAttributes })
    })
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: translatedAttributes })
    return () => observer.disconnect()
  }, [locale, translations])

  return null
}
