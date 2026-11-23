import assert from "node:assert/strict";
import { markVisibleAction } from "./visible-action.mjs";

// Exercises settings and search controls with the harness's disposable data.
// Native audio and real-model inference are covered by the separate opt-in gates.
export async function runLocalCapabilitiesAcceptance({ api, cdp, evaluate, until, click, fill, snapshot }) {
  async function button(label) {
    assert(await markVisibleAction(cdp, 'button', label, 'data-local-action'), `Missing local capability action: ${label}`);
    await click('[data-local-action="true"]');
    await evaluate("document.querySelector('[data-local-action]')?.removeAttribute('data-local-action')");
  }
  await click('button[aria-label="Settings"]');
  await click('#settings-tab-local-models');
  await button('Speech');
  await until("!!document.querySelector('[role=slider][aria-label=\"Speech volume\"]')");
  await click('[role="slider"][aria-label="Speech volume"]');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home' });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home' });
  await until("document.querySelector('[role=slider][aria-label=\"Speech volume\"]').getAttribute('aria-valuenow')==='0'");
  await fill('textarea[aria-label="Voice preview text"]', '');
  assert.equal(await evaluate("document.querySelector('textarea[aria-label=\"Voice preview text\"]').value"), '');
  await button('Installed');
  await button('Speech');
  assert.equal(await evaluate("document.querySelector('[role=slider][aria-label=\"Speech volume\"]').getAttribute('aria-valuenow')"), '0');
  assert.equal(await evaluate("document.querySelector('textarea[aria-label=\"Voice preview text\"]').value"), '');
  assert.equal((await api('/api/speech/settings')).settings.volume, 0.9, 'Editing the draft changed saved preferences');
  await snapshot('local-speech-draft-desktop');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await snapshot('local-speech-draft-mobile');
  await click('button[aria-label="Close settings"]');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await click('button[aria-label="Tools"]');
  await button('Search local documents');
  await until("!!document.querySelector('[role=slider][aria-label=\"Minimum similarity\"]')");
  await click('[role="slider"][aria-label="Minimum similarity"]');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End' });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End' });
  await until("document.querySelector('[role=slider][aria-label=\"Minimum similarity\"]').getAttribute('aria-valuenow')==='1'");
  await snapshot('local-search-filter-desktop');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await snapshot('local-search-filter-mobile-dark');
}
