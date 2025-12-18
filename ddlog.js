(function () {
  window.startDataLayerLogger = function (settings) {
    if (!settings) {
      console.error('datalayer log: "settings" is missing');
      return;
    }

    const endpoint = settings.endpoint || "https://browser-intake-datadoghq.eu/api/v2/logs";
    const customer = settings.customer;
    const token = settings.token;
    const page_id = settings.page_id || null;
    const session_id = settings.session_id || null;
    const debug_mode_enabled = settings.debug_mode === true;
    const ignore_events = settings.ignore_events || [];
    const cmp_log = settings.cmp_log;
    const cmp_cookie_val = settings.cmp_cookie_val;

    if (!customer || !token) {
      console.error('datalayer log: "token" or "customer" is missing');
      return;
    }

    const buffer = [];
    let datalayer_index_counter = 0;
    let pageViewFired = false;

    const queryParams = new URLSearchParams(window.location.search);

    function shouldSkip(msg) {
      if (!msg) return true;
      if (msg?.[0] === "set" || msg?.[0] === "consent") return true;

      if (msg?.event && msg.event.startsWith("gtm.")) {
        return msg.event !== "gtm.js";
      }

      if (msg?.event) {
        for (let i = 0; i < ignore_events.length; i++) {
          const rule = ignore_events[i];
          if (typeof rule !== "object") continue;
          if (rule.match === "equal" && msg.event === rule.event_name)
            return true;
          if (
            rule.match === "contains" &&
            msg.event.includes(rule.event_name)
          )
            return true;
        }
      }
      return false;
    }

    function addCommonTrafficData(base) {
      queryParams.forEach((value, key) => {
        if (key.startsWith("utm_")) base[key] = value;
      });

      base.referer = document.referrer || null;
      base.google_ads_click =
        queryParams.has("gclid") ||
        queryParams.has("gbraid") ||
        queryParams.has("wbraid")
          ? 1
          : 0;
    }

    function addToBuffer(event_name, data, extraFields = {}) {
      const uniqueId = data?.["gtm.uniqueEventId"] ?? null;

      const base = {
        event_name,
        service: "datalayer",
        customer,
        hostname: window.location.hostname,
        page_location: window.location.href,
        user_agent: navigator.userAgent,
        device_type: /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
          ? "mobile"
          : "desktop",
        datalayer_index: datalayer_index_counter,
        page_id,
        session_id,
        timestamp: Date.now(),
        ...extraFields,
        datalayer: data || {}
      };

      if (extraFields.service === "cmp") {
        delete base.datalayer_index;
        delete base.datalayer;
      }

      if (uniqueId !== null && base.datalayer) {
        base.event_id = `${page_id}_${uniqueId}`;
      }

      if (debug_mode_enabled) {
        base.debug_mode = true;
      }

      if (event_name === "page_view") {
        const referrer = document.referrer;
        if (!referrer) return;

        const refHost = new URL(referrer).hostname;
        if (refHost !== window.location.hostname) {
          base.first_page = true;
          addCommonTrafficData(base);
        }
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

    let shouldMeasureConsent = false;
    let bannerInteraction = 0;
    let latestConsent = {
      ad_storage: 0,
      analytics_storage: 0
    };

    if (cmp_log && cmp_cookie_val === undefined) {
      shouldMeasureConsent = true;
    }

    function handleConsentUpdateEvent(dlEvent) {
      if (
        !shouldMeasureConsent ||
        dlEvent?.[0] !== "consent" ||
        dlEvent?.[1] !== "update" ||
        typeof dlEvent?.[2] !== "object"
      ) {
        return;
      }

      bannerInteraction = 1;

      Object.entries(dlEvent[2]).forEach(([key, value]) => {
        if (value === "granted") latestConsent[key] = 1;
        else if (value === "denied") latestConsent[key] = 0;
      });
    }

    function buildConsentEvent() {
      if (!shouldMeasureConsent) return null;

      const payload = {
        service: "cmp",
        banner_interaction: bannerInteraction,
        ad_storage: latestConsent.ad_storage,
        analytics_storage: latestConsent.analytics_storage
      };

      if (
        latestConsent.ad_storage === 0 &&
        latestConsent.analytics_storage === 0
      ) {
        const cookie_list = (document.cookie || "")
          .split(";")
          .map(c => c.trim().split("=")[0])
          .filter(Boolean);

        payload.cookie_list = cookie_list;
        payload.cookie_count = cookie_list.length;
      }

      shouldMeasureConsent = false;
      return payload;
    }

    function flush() {
      const consentPayload = buildConsentEvent();
      if (consentPayload) {
        addToBuffer("consent", null, consentPayload);
      }

      if (!buffer.length) return;

      const payload = buffer
        .splice(0)
        .map(e => JSON.stringify(e))
        .join("\n");

      navigator.sendBeacon(
        endpoint + "?dd-api-key=" + token,
        payload
      );
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
