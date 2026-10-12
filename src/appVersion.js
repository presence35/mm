/*
 * The app version.
 *
 * Injected by Vite at build time from package.json (vite.config.js `define`),
 * so there is one place to bump it and no way for the number on screen to
 * disagree with what was actually built.
 *
 * `typeof` rather than a bare reference: this module is imported by plain node
 * tests that never go through Vite, where the identifier does not exist.
 */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
