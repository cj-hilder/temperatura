// The Google OAuth client this app signs in with (spec, Storage → Google Drive
// backup). The client ID is public by design: it appears in every sign-in URL
// the browser opens, so it lives in source rather than in an env var. The
// client SECRET is not here and must never be: it is a Worker secret in
// production and a line in the uncommitted .env.development locally.
export const GOOGLE_CLIENT_ID =
  "451966352250-8k81qqnpqj7oi8rk9ehvvm5vourene7o.apps.googleusercontent.com";

// The only scope requested. It reaches the app's own hidden appDataFolder and
// nothing else in the user's Drive, and it is non-sensitive, which is what
// lets the consent screen be published to production without Google review.
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

// Where Google sends the authorisation popup back to. A standalone page, not
// an SPA route: the app's own window must never navigate away while steps may
// be running. It must match a redirect URI registered on the OAuth client
// exactly, for every origin the app is served from.
export const OAUTH_CALLBACK_PATH = "/oauth-callback.html";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
