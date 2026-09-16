/**
 * The app name as a mark, for the header and the login page.
 *
 * Capitals, not small caps: Google Fonts' Charis SIL build carries no `smcp` feature, so
 * `font-variant-caps: small-caps` would leave the browser to synthesise it by scaling capitals,
 * which reads thin against the 700 weight. Verified with fontTools against the files `next/font`
 * emits under `.next/static/media`.
 */
export function Wordmark() {
  return <span className="font-display font-semibold uppercase tracking-wide">Provender</span>;
}
