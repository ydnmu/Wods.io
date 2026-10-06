export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://i.ytimg.com https://img.youtube.com https://yt3.googleusercontent.com https://images.unsplash.com https://plus.unsplash.com https://i.vimeocdn.com https://*.dmcdn.net https://*.tedcdn.com https://*.hdslb.com https://pic.bstarstatic.com https://pic.bstarstatic.net",
  "connect-src 'self' https://www.youtube.com https://2outube.com",
  'frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://www.dailymotion.com https://geo.dailymotion.com https://embed.ted.com https://player.bilibili.com https://www.bilibili.tv',
  "font-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')
