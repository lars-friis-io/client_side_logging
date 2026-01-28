(function () {
  window.startDataLayerLogger = function (settings) {
    if (!settings) return;

    const endpoint = settings.endpoint || "https://browser-intake-datadoghq.eu/api/v2/logs";
    const customer = settings.customer;
    const token = settings.token;
    const page_id = settings.page_id || null;
    const session_id = settings.session_id || null;
    const debug_mode_enabled = settings.debug_mode === true;
    const ignore_events = settings.ignore_events || [];

    if (!customer || !token) return;

    /* ---------------- Consent state (global) ---------------- */

    let latestConsent = {
      ad_storage: 0,
      analytics_storage: 0
    };

    /* ---------------- CMP state ---------------- */

    const cmp_log = settings.cmp_log === true;
    const cmp_cookie_val = settings.cmp_cookie_val;

    let shouldMeasureConsent = false;
    let bannerInteraction = 0;
    let consentUpdateTimestamp = null;

    if (cmp_log && cmp_cookie_val === undefined) {
      shouldMeasureConsent = true;
    }

    /* ---------------- Consent update ---------------- */

    function handleConsentUpdateEvent(dlEvent) {
      if (
        dlEvent[0] !== "consent" ||
        dlEvent[1] !== "update" ||
        typeof dlEvent[2] !== "object"
      ) {
        return;
      }

      Object.keys(dlEvent[2]).forEach(function (key) {
        const value = dlEvent[2][key];
        if (value === "granted") latestConsent[key] = 1;
        else if (value === "denied") latestConsent[key] = 0;
      });

      if (shouldMeasureConsent) {
        bannerInteraction = 1;

        if (consentUpdateTimestamp === null) {
          consentUpdateTimestamp = Date.now();
        }
      }
    }

    /* ---------------- Sampling ---------------- */

    const sampling_enabled =
      settings.sampling === true && debug_mode_enabled !== true;

    const sampling_session_included =
      typeof session_id === "string" &&
      session_id.charAt(session_id.length - 1) === "1";

    function shouldBlockBySampling(hasKeyEvent) {
      if (!sampling_enabled) return false;
      if (sampling_session_included) return false;
      if (hasKeyEvent) return false;
      return true;
    }

    function shouldBlockCmpBySampling() {
      if (!sampling_enabled) return false;
      if (sampling_session_included) return false;
      return true;
    }

    /* ---------------- Attribution (cookie) ---------------- */

    function getCookie(name) {
      const parts = document.cookie.split("; ");
      for (let i = 0; i < parts.length; i++) {
        const kv = parts[i].split("=");
        if (kv[0] === name) return kv.slice(1).join("=");
      }
      return null;
    }

    function setCookie(name, value) {
      const host = window.location.hostname;
      const parts = host.split(".");
      const domain = "." + parts.slice(-2).join(".");

      document.cookie =
        name +
        "=" +
        value +
        "; path=/; domain=" +
        domain +
        "; SameSite=Lax";
    }

    function buildAttribution() {
      const params = new URLSearchParams(window.location.search);
      const attribution = {
        landing_page: window.location.href,
        referrer: document.referrer || null
      };

      params.forEach(function (value, key) {
        if (key.indexOf("utm_") === 0) {
          attribution[key] = value;
        }
      });

      return attribution;
    }

    let attribution;
    const storedAttribution = getCookie("gtm_log_attribution");

    if (storedAttribution) {
      attribution = JSON.parse(storedAttribution);
    } else {
      attribution = buildAttribution();
      setCookie(
        "gtm_log_attribution",
        JSON.stringify(attribution)
      );
    }

    function getCookiesObject() {
      const cookies = {};
      const raw = document.cookie || "";
      if (!raw) return cookies;

      raw.split(";").forEach(function (part) {
        const kv = part.trim().split("=");
        if (kv[0]) cookies[kv[0]] = kv.slice(1).join("=") || "";
      });

      return cookies;
    }

    /* ---------------- Key events ---------------- */

    const key_events = settings.key_events || [];

    function isKeyEvent(eventName) {
      return key_events.some(function (e) {
        return e && e.event_name === eventName;
      });
    }

    /* ---------------- Bot guard ---------------- */

    const ua = navigator.userAgent || "";
    const botRe =
      /(Googlebot|AdsBot-Google|AhrefsBot|HeadlessChrome|phantomjs|selenium|webdriver)/i;

    if (botRe.test(ua) || navigator.webdriver === true) return;

    /* ---------------- Core ---------------- */

    const buffer = [];
    let datalayer_index_counter = 0;
    let pageViewFired = false;

    function shouldSkip(msg) {
      if (!msg) return true;
      if (msg[0] === "set") return true;

      if (msg.event && msg.event.indexOf("gtm.") === 0) {
        return msg.event !== "gtm.js";
      }

      if (msg.event) {
        return ignore_events.some(function (rule) {
          if (!rule) return false;
          if (rule.match === "equal")
            return msg.event === rule.event_name;
          if (rule.match === "contains")
            return msg.event.indexOf(rule.event_name) !== -1;
          return false;
        });
      }

      return false;
    }

    function sanitizeDataLayer(data) {
      if (!data || typeof data !== "object") return data;
      const clean = {};
      Object.keys(data).forEach(function (k) {
        if (k !== "gtm.uniqueEventId") clean[k] = data[k];
      });
      return clean;
    }

    function buildEventPayload(event_name, data, isKey) {
      const uniqueId = data["gtm.uniqueEventId"];

      const payload = {
        event_name: event_name,
        service: "datalayer",
        customer: customer,
        hostname: window.location.hostname,
        page_location: window.location.origin + window.location.pathname,
        user_agent: navigator.userAgent,
        device_type:
          /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
            ? "mobile"
            : "desktop",
        datalayer_index: datalayer_index_counter,
        page_id: page_id,
        session_id: session_id,
        timestamp: Date.now(),
        ad_storage: latestConsent.ad_storage,
        analytics_storage: latestConsent.analytics_storage,
        attribution: attribution,
        cookies: getCookiesObject(),
        datalayer: sanitizeDataLayer(data)
      };

      if (
        sampling_enabled &&
        !sampling_session_included &&
        isKey === true
      ) {
        payload.sampled_session = true;
      }

      if (isKey === true) payload.key_event = true;

      if (uniqueId != null) {
        payload.event_id = page_id + "_" + uniqueId;
      }

      if (debug_mode_enabled) payload.debug_mode = true;

      return payload;
    }

    function flush() {
      if (!buffer.length) return;

      let hasKeyEvent = buffer.some(function (e) {
        return e.key_event === true;
      });

      if (shouldBlockBySampling(hasKeyEvent)) {
        buffer.length = 0;
        return;
      }

      navigator.sendBeacon(
        endpoint + "?dd-api-key=" + token,
        buffer.map(function (e) {
          return JSON.stringify(e);
        }).join("\n")
      );

      buffer.length = 0;
    }

    function queueEvent(dlEvent) {
      if (shouldSkip(dlEvent)) return;

      datalayer_index_counter++;

      let eventName;
      if (dlEvent.event === "gtm.js") {
        if (pageViewFired) return;
        pageViewFired = true;
        eventName = "page_view";
      } else {
        eventName = dlEvent.event || "message";
      }

      const isKey = isKeyEvent(eventName);
      buffer.push(buildEventPayload(eventName, dlEvent, isKey));
    }

    /* ---------------- DataLayer hook ---------------- */

    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.forEach(function (obj) {
        if (obj && typeof obj === "object") {
          handleConsentUpdateEvent(obj);
          queueEvent(obj);
        }
      });

      const originalPush = window.dataLayer.push;
      window.dataLayer.push = function () {
        const msg = arguments[0];
        const result = originalPush.apply(window.dataLayer, arguments);

        if (msg && typeof msg === "object") {
          handleConsentUpdateEvent(msg);
          queueEvent(msg);
        }

        return result;
      };
    }

    /* ---------------- Timers ---------------- */

    setInterval(flush, 5000);
    addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flush();
    });
    addEventListener("pagehide", flush);
    addEventListener("beforeunload", flush);

    /* ---------------- CMP (separat, 1x, exit-only) ---------------- */

    function buildConsentEvent() {
      if (!shouldMeasureConsent) return null;
      if (shouldBlockCmpBySampling()) return null;

      const payload = {
        service: "cmp",
        banner_interaction: bannerInteraction,
        ad_storage: latestConsent.ad_storage,
        analytics_storage: latestConsent.analytics_storage,
        timestamp: consentUpdateTimestamp
      };

      if (
        latestConsent.ad_storage === 0 &&
        latestConsent.analytics_storage === 0
      ) {
        const cookies = getCookiesObject();
        const cookie_list = Object.keys(cookies);
        payload.cookie_list = cookie_list;
        payload.cookie_count = cookie_list.length;
      }

      shouldMeasureConsent = false;
      return payload;
    }

    function sendCmpOnUnload() {
      const payload = buildConsentEvent();
      if (!payload) return;

      navigator.sendBeacon(
        endpoint + "?dd-api-key=" + token,
        JSON.stringify(payload)
      );
    }

    addEventListener("pagehide", sendCmpOnUnload);
    addEventListener("beforeunload", sendCmpOnUnload);
  };
})();
