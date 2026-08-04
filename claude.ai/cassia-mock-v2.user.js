// ==UserScript==
// @name         Cassia Mock v2
// @namespace    local.cassia.checkout
// @version      2.0.0
// @description  Mock checkout_capabilities + force SEPA debit
// @match        *://claude.ai/*
// @match        *://*.claude.ai/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// ==/UserScript==

(function () {
  "use strict";

  const TARGET_HOST = "claude.ai";
  const CAPS_PATH = /^\/api\/organizations\/[^/]+\/subscription\/checkout_capabilities\/?$/;
  const SESSION_PATH = /^\/api\/organizations\/[^/]+\/subscription\/checkout_session\/?$/;

  const MOCK_DATA = { checkout_flow: "cassia" };
  const MOCK_BODY = JSON.stringify(MOCK_DATA);
  const MOCK_LENGTH = new TextEncoder().encode(MOCK_BODY).byteLength;

  function matchTarget(input, method, pathPattern) {
    try {
      let rawUrl;
      if (typeof input === "string" || input instanceof URL) {
        rawUrl = String(input);
      } else if (input && typeof input.url === "string") {
        rawUrl = input.url;
      } else return null;
      const url = new URL(rawUrl, location.href);
      if (String(method).toUpperCase() !== (pathPattern === SESSION_PATH ? "POST" : "GET")) return null;
      const hostOk = url.hostname === TARGET_HOST || url.hostname.endsWith("." + TARGET_HOST);
      if (!hostOk) return null;
      if (!pathPattern.test(url.pathname)) return null;
      return url;
    } catch (e) { return null; }
  }

  function createMockResponse(originalResponse) {
    const headers = new Headers(originalResponse.headers);
    headers.delete("content-length"); headers.delete("content-encoding");
    headers.delete("etag"); headers.delete("content-md5");
    headers.set("content-type", "application/json; charset=utf-8");
    headers.set("content-length", String(MOCK_LENGTH));
    headers.set("cache-control", "no-store");
    const response = new Response(MOCK_BODY, { status: 200, statusText: "OK", headers });
    try {
      Object.defineProperties(response, {
        url: { value: originalResponse.url, configurable: true },
        redirected: { value: originalResponse.redirected, configurable: true },
        type: { value: originalResponse.type, configurable: true }
      });
    } catch (_) {}
    return response;
  }

  const nativeFetch = window.fetch;

  window.fetch = async function(input, init) {
    const method = init?.method || (input instanceof Request ? input.method : "GET");

    // Modify checkout_session POST: force SEPA debit
    const sessionUrl = matchTarget(input, method, SESSION_PATH);
    if (sessionUrl) {
      try {
        let bodyStr;
        if (input instanceof Request) {
          bodyStr = await input.clone().text();
        } else if (init?.body) {
          bodyStr = typeof init.body === "string" ? init.body : init.body;
        }
        if (bodyStr) {
          const body = JSON.parse(bodyStr);
          body.paymentMethodTypes = ["sepa_debit"];
          const newBody = JSON.stringify(body);
          if (input instanceof Request) {
            input = new Request(input, { body: newBody, method: "POST" });
            init = undefined;
          } else if (init) {
            init = { ...init, body: newBody };
          }
          console.warn("[Cassia Mock] payment methods → sepa_debit");
        }
      } catch (e) { console.error("[Cassia Mock] session error:", e); }
    }

    const response = await nativeFetch.call(window, input, init);

    // Mock checkout_capabilities GET
    const capsUrl = matchTarget(input, method, CAPS_PATH);
    if (capsUrl) {
      console.warn("[Cassia Mock] checkout_capabilities → cassia");
      return createMockResponse(response);
    }

    return response;
  };
})();