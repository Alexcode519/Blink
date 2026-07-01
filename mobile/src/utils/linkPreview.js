// Fetches Open Graph / meta data directly from the user's device.
// The server never sees the URL — fully privacy-preserving.

const URL_REGEX = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi

export function extractUrl(text) {
  const matches = text?.match(URL_REGEX)
  return matches?.[0] ?? null
}

export async function fetchLinkPreview(url) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Blink/1.0)' },
    })
    clearTimeout(timer)
    const html = await res.text()

    function meta(prop) {
      const patterns = [
        new RegExp(`<meta[^>]*property=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${prop}["']`, 'i'),
        new RegExp(`<meta[^>]*name=["']${prop.replace('og:', '')}["'][^>]*content=["']([^"']+)["']`, 'i'),
      ]
      for (const p of patterns) {
        const m = html.match(p)
        if (m?.[1]) return m[1].trim()
      }
      return null
    }

    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)

    return {
      url,
      title:       meta('og:title') ?? meta('twitter:title') ?? titleTag?.[1]?.trim() ?? null,
      description: meta('og:description') ?? meta('twitter:description') ?? meta('description') ?? null,
      image:       meta('og:image') ?? meta('twitter:image') ?? null,
      siteName:    meta('og:site_name') ?? new URL(url).hostname,
    }
  } catch {
    return null
  }
}
