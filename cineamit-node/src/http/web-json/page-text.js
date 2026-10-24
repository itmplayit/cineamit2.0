'use strict';

// Static app page texts (about/privacy/terms/dmca/legal/download/totp/faq).
const PAGE_TEXT = {
  about: 'CineAmit — watch movies, series, anime and Live TV. Same catalogue as the website. Browse without an account; sign in for watchlist, profiles, history, playlists and Live TV.',
  privacy: 'We store your login session, watchlist, profiles and watch history on your CineAmit server. Streams are proxied; provider URLs are not sent to the app. Cookies keep you signed in. See the website /privacy page for the full policy.',
  terms: 'CineAmit is a free streaming index. Use the app lawfully. Do not share account credentials. Kids Mode filters catalogue. We may suspend accounts that abuse the service. Full terms: website /terms.',
  dmca: 'Copyright complaints: use the website /dmca form or email the operator listed on /legal. Include the title, URL and your contact details. We respond to valid notices.',
  legal: 'CineAmit is a catalogue + player shell. Embed sources are third-party. You are responsible for complying with local law. Privacy, terms and DMCA pages apply to the Android app the same as the website.',
  download: 'On Watch / Details tap Download — Saver / High / Best. The file saves under Account → Downloads (MKV/MP4). Please sign in. Links stay valid for 6 hours.',
  totp: 'Two-Factor Authentication uses an authenticator app (Google Authenticator / Authy). Enable or disable it on the website under Profile → 2FA. Sign-in will ask for a 6-digit code.',
  faq: 'Is CineAmit free?\nYes — no subscription. Account optional for watching; needed for watchlist, history, Live TV, playlists.\n\nDo I need an account?\nNo for movies/shows. Yes for Live TV, watchlist, profiles, Cine Match.\n\nBuffering?\nSwitch server on the Watch page, check Wi-Fi, try again.\n\nKids Mode?\nCreate a Kids profile. Some pages (history, Cine Match) stay hidden.\n\nPassword reset?\nForgot password page — OTP email, then new password.\n\n2FA?\nEnable on the website profile. App login asks for the 6-digit code.',
};

module.exports = { PAGE_TEXT };
