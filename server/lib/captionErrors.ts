export function platformCaptionError(message: string) {
  switch (message) {
    case 'bilibili_session_required':
      return { status: 503, error: 'bilibili_auth_required', message: 'Bilibili captions require an authenticated server connection. Please try again after access is restored.' }
    case 'bilibili_access_restricted':
      return { status: 503, error: 'bilibili_access_restricted', message: 'Bilibili is temporarily refusing caption access. Please try again later.' }
    case 'bilibili_provider_unavailable':
      return { status: 502, error: 'bilibili_provider_unavailable', message: 'Bilibili could not be reached. Please try again later.' }
    case 'dailymotion_provider_unavailable':
      return { status: 502, error: 'caption_provider_unavailable', message: 'Dailymotion could not be reached. Please try again later.' }
    case 'source_unavailable':
      return { status: 404, error: 'source_unavailable', message: 'This video is unavailable or has been removed.' }
    case 'no_captions':
      return { status: 422, error: 'no_captions', message: 'This video does not expose a usable caption track.' }
    default:
      return null
  }
}
