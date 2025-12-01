(function () {
  window.startDataLayerLogger = function (settings) {
    if (!settings)
      return console.error('datalayer log: "settings" is missing');

    const endpoint = settings.endpoint || 'https://logs.larsfriis.io';
    const website_id = settings.website_id;
    const secret = settings.secret;
    const page_id = settings.page_id || null;
    const debug_mode_enabled = settings.debug_mode === true;
    const ignore_events = settings.ignore_events || [];
    const cmp_log = settings.cmp_log;
    const cmp_cookie_val = settings.cmp_cookie_val;

    const buffer = [];
    let cmp_required = false;
    let datalayer_index_counter = 0;
    let pageViewFired = false;

    if (!website_id || !secret)
      return console.error('datalayer log: "website_id" or "secret" is missing');

    const queryParams = new URLSearchParams(window.location.search);

    function shouldSkip(msg) {
      if (!msg) return true;
      if (msg?.[0] === 'set' || msg?.[0] === 'consent') return true;
      if (msg?.event && msg.event.startsWith('gtm.')) {
        return msg.event !== 'gtm.js';
      }
      if (msg?.event) {
        for (let i = 0; i < ignore_events.length; i++) {
          const rule = ignore_events[i];
          if (typeof rule !== 'object') continue;
          if (rule.match === "equal" && msg.event === rule.event_name) return true;
          if (rule.match === "contains" && msg.event.includes(rule.event_name)) return true;
        }
      }
      return false;
    }

    function addCommonTrafficData(base) {
      queryParams.forEach((value, key) => {
        if (key.startsWith("utm_")) base[key] = value;
      });

      base.referer = document.referrer || null;
      base.google_ads_click = queryParams.has("gclid") || queryParams.has("gbraid") || queryParams.has("wbraid") ? 1 : 0;
    }

    function addToBuffer(event_name, data, extraFields = {}) {
      const uniqueId = data?.["gtm.uniqueEventId"] || null;

      const base = {
        event_name,
        source: "datalayer", // default værdi, overskrives evt. af extraFields
        hostname: window.location.hostname,
        page_location: window.location.href,
        user_agent: navigator.userAgent,
        device_type: /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? "mobile" : "desktop",
        datalayer_index: datalayer_index_counter,
        page_id,
        ...extraFields,
        datalayer: data || {}
      };

      if (extraFields.source === "consent") {
        delete base.datalayer_index;
        delete base.datalayer;
      }

      if (uniqueId !== null && base.datalayer) {
        base.event_id = `${page_id}_${uniqueId}`;
      }

      if (debug_mode_enabled) base.debug_mode = true;

      if (event_name === "page_view") {
        const referrer = document.referrer;
        if (!referrer) return;
        const refHost = new URL(referrer).hostname;
        if (refHost !== window.location.hostname) {
          base.first_page = true;
          addCommonTrafficData(base);
        }
      }

      if (event_name === "consent_required" || event_name === "consent_defined") {
        addCommonTrafficData(base);
      }

      buffer.push(base);
    }

    function queueEvent(dlEvent) {
      if (shouldSkip(dlEvent)) return;
      datalayer_index_counter++;

      let eventName;
      if (dlEvent?.event === "gtm.js") {
        if (pageViewFired) return;
        pageViewFired = true;
        eventName = "page_view";
      } else {
        eventName = dlEvent?.event || "message";
      }

      addToBuffer(eventName, dlEvent);
    }

    function flush() {
      if (!buffer.length) return;
      const payload = { website_id, secret, events: buffer.splice(0, buffer.length) };
      navigator.sendBeacon(endpoint, JSON.stringify(payload));
    }

    if (cmp_log && cmp_cookie_val === undefined) {
      cmp_required = true;
      addToBuffer("consent_required", null, { source: "consent" });
    }

    function handleConsentUpdateEvent(dlEvent) {
      if (
        cmp_required &&
        dlEvent?.[0] === "consent" &&
        dlEvent?.[1] === "update" &&
        typeof dlEvent?.[2] === "object"
      ) {
        // Formatér consent-values til 1/0
        const consentPayload = {};
        Object.entries(dlEvent[2]).forEach(([key, value]) => {
          if (value === "granted") consentPayload[key] = 1;
          else if (value === "denied") consentPayload[key] = 0;
        });
        consentPayload.source = "consent";

        // Fyres uanset granted/denied
        addToBuffer("consent_defined", null, consentPayload);

        // Hvis denied → fyr consent_denied efter 2 sek med cookie liste
        if (consentPayload["ad_storage"] === 0 && consentPayload["analytics_storage"] === 0) {
          setTimeout(() => {
            const cookie_list = (document.cookie || "")
              .split(";")
              .map((c) => c.trim().split("=")[0])
              .filter(Boolean);

            addToBuffer("consent_denied", null, {
              cookie_list,
              cookie_count: cookie_list.length,
              source: "consent"
            });
          }, 2000);
        }

        cmp_required = false;
      }
    }

    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.forEach((obj) => {
        if (obj && typeof obj === "object") {
          queueEvent(obj);
          handleConsentUpdateEvent(obj);
        }
      });

      const originalPush = window.dataLayer.push;
      window.dataLayer.push = function () {
        const args = Array.from(arguments);
        const msg = args[0];
        const result = originalPush.apply(window.dataLayer, args);

        if (msg && typeof msg === "object") {
          queueEvent(msg);
          handleConsentUpdateEvent(msg);
        }

        return result;
      };
    } else {
      console.error("datalayer log: dataLayer mangler");
    }
   addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
    });
    addEventListener("pagehide", flush);
    addEventListener("beforeunload", flush);
    addEventListener("popstate", flush);
  };
})();
