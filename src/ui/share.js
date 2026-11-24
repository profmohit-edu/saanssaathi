/**
 * "Share plan": the phone's share sheet where available, otherwise WhatsApp.
 * Families plan together, so the plan should travel to the family group.
 * @module ui/share
 */
import { byId } from '../dom.js';
import { planToText, placeLabel } from '../format.js';

/** Public link to the app included in shared plans. */
const APP_URL = 'https://profmohit-edu.github.io/saanssaathi/';

/**
 * WhatsApp "click to chat" link with prefilled text.
 * @param {string} text
 * @returns {string}
 */
export function whatsappLink(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Wires the Share plan button.
 * @param {import('../types.js').AppContext} ctx
 */
export function initShare({ app }) {
  const btn = byId('share-plan');
  btn.addEventListener('click', async () => {
    if (!app.lastPlan) {
      return;
    }
    const text = planToText(app.lastPlan, placeLabel(app.state.place), APP_URL);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'SaansSaathi clean-air plan', text });
        return;
      } catch (e) {
        if (/** @type {Error} */ (e).name === 'AbortError') {
          return; // user closed the share sheet
        }
      }
    }
    window.open(whatsappLink(text), '_blank', 'noopener,noreferrer');
  });
}
