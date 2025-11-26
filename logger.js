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

    // Hent query params én gang
    const queryParams = new URLSearchParams(window.location.search);

    function shouldSkip(msg) {
      if (!msg) return true;

      //Skip ["set", ...] og ["consent", ...]
      if (msg?.[0] === 'set' || msg?.[0] === 'consent') return true;

      // Skip gtm.* events undtagen whitelisted
      if (msg?.event && msg.event.startsWith('gtm.')) {
        const allowedGtmEvents = ['gtm.js'];
        if (!allowedGtmEvents.includes(msg.event)) return true;
      }

      // Skip ignore list
      if (msg?.event && ignore_events.includes(msg.event)) return true;

      return false;
    }

    function addCommonTrafficData(base) {
      queryParams.forEach((value, key) => {
        if (key.startsWith("utm_")) base[key] = value;
      });

      base.referer = document.referrer || null;

      const googleAdsClick =
        queryParams.has("gclid") ||
        queryParams.has("gbraid") ||
        queryParams.has("wbraid");

      base.google_ads_click = googleAdsClick ? 1 : 0;
    }

    function addToBuffer(event_name, data, extraFields = {}) {
      const uniqueId = data?.["gtm.uniqueEventId"] || null;

      const base = {
        event_name,
        source: "datalayer",
        hostname: window.location.hostname,
        page_location: window.location.href,
        user_agent: navigator.userAgent,
        device_type: /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
          ? "mobile"
          : "desktop",
        datalayer_index: datalayer_index_counter,
        page_id,
        ...extraFields,
        datalayer: data || {}
      };

      if (uniqueId !== null) {
        base.event_id = page_id + "_" + uniqueId;
      }

      if (debug_mode_enabled) base.debug_mode = true;

      if (event_name === "page_view") {
        const referrer = document.referrer;
        if (!referrer) return;
        const refHost = new URL(referrer).hostname;
        const isExternalReferrer = refHost !== window.location.hostname;
        if (isExternalReferrer) {
          base.first_page = true;
          addCommonTrafficData(base);
        } 
      }

      if (event_name === "consent_required" || event_name === "consent_given") {
        addCommonTrafficData(base);
      }

      buffer.push(base);
    }

    function queueEvent(dlEvent) {
      if (shouldSkip(dlEvent)) return;
      datalayer_index_counter++;

      let eventName;

      // Page_view fra første gtm.js
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

    function handleCmpLoadEvent(dlEvent) {
      if (cmp_log && dlEvent?.event === "gtm.load") {
        if (cmp_cookie_val === undefined) {
          cmp_required = true;
          const cookie_list = (document.cookie || "")
            .split(";")
            .map((c) => c.trim().split("=")[0])
            .filter(Boolean);

          datalayer_index_counter++;
          addToBuffer("consent_required", {}, { cookie_list });
        }
      }
    }

    function handleConsentUpdateEvent(dlEvent) {
      if (
        cmp_required &&
        dlEvent?.[0] === "consent" &&
        dlEvent?.[1] === "update" &&
        typeof dlEvent?.[2] === "object"
      ) {
        datalayer_index_counter++;
        const consentData = {};
        Object.entries(dlEvent[2]).forEach(([key, value]) => {
          if (value === "granted") consentData[key] = 1;
          else if (value === "denied") consentData[key] = 0;
          else consentData[key] = value; // fallback hvis andre værdier forekommer
        });

        addToBuffer("consent_given", {}, consentData);
        cmp_required = false;
  }
}

    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.forEach((obj) => {
        if (obj && typeof obj === "object") {
          queueEvent(obj);
          handleCmpLoadEvent(obj);
          handleConsentUpdateEvent(obj);
        }
      });

      // Override push efterfølgende
      const originalPush = window.dataLayer.push;
      window.dataLayer.push = function () {
        const args = Array.from(arguments);
        const msg = args[0];

        const result = originalPush.apply(window.dataLayer, args);

        if (msg && typeof msg === "object") {
          queueEvent(msg);
          handleCmpLoadEvent(msg);
          handleConsentUpdateEvent(msg);
        }

        return result;
      };
    } else {
      console.error("datalayer log: dataLayer mangler");
    }

    addEventListener("pagehide", flush);
    addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  };
})();
