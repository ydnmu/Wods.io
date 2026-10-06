// Free, key-less translation via Google's public gtx endpoint.
// Batches paragraphs to keep request count low, with per-item fallback for correctness.

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single'
const SEP = '\n'
const MAX_CHUNK = 1500

type GtxPart = [string, string, ...unknown[]]

async function translateChunk(text: string, target: string, source = 'auto'): Promise<string> {
  const url =
    `${ENDPOINT}?client=gtx&sl=${encodeURIComponent(source)}` +
    `&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`

  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; easytran/1.0)' },
  })

  if (!response.ok) throw new Error(`translate_failed_${response.status}`)

  const data = (await response.json()) as unknown
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error('translate_bad_response')
  }

  return (data[0] as GtxPart[]).map((part) => (Array.isArray(part) ? part[0] : '')).join('')
}

export async function translateTexts(texts: string[], target: string): Promise<string[]> {
  if (texts.length === 0) return []

  const results = new Array<string>(texts.length)

  // Group paragraph indexes into batches under MAX_CHUNK chars.
  const batches: number[][] = []
  let batch: number[] = []
  let length = 0

  texts.forEach((text, index) => {
    const add = text.length + SEP.length
    if (batch.length && length + add > MAX_CHUNK) {
      batches.push(batch)
      batch = []
      length = 0
    }
    batch.push(index)
    length += add
  })
  if (batch.length) batches.push(batch)

  for (const group of batches) {
    // Collapse internal newlines so the SEP count stays predictable.
    const joined = group.map((i) => texts[i].replace(/\s*\n\s*/g, ' ')).join(SEP)

    try {
      const translated = await translateChunk(joined, target)
      const lines = translated.split(SEP)

      if (lines.length === group.length) {
        group.forEach((index, position) => {
          results[index] = lines[position]
        })
        continue
      }

      // Line count drifted — fall back to per-paragraph translation.
      for (const index of group) {
        results[index] = await translateChunk(texts[index].replace(/\s*\n\s*/g, ' '), target)
      }
    } catch {
      for (const index of group) {
        try {
          results[index] = await translateChunk(texts[index].replace(/\s*\n\s*/g, ' '), target)
        } catch {
          results[index] = texts[index] // keep original on hard failure
        }
      }
    }
  }

  return results
}
