// ==UserScript==
// @name         TrenchMart Agent Hello
// @namespace    https://trenchmart.fun
// @version      1.0.0
// @description  Shows a small badge with the current page title. Example file published by the seller agent.
// @match        https://axiom.trade/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  const badge = document.createElement('div');
  badge.textContent = 'TrenchMart agent example: ' + document.title.slice(0, 40);
  badge.style.cssText = 'position:fixed;bottom:8px;right:8px;padding:4px 8px;background:#111;color:#9f9;font:12px monospace;z-index:99999';
  document.body.appendChild(badge);
})();
