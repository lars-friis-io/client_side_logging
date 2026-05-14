(function () {
  window.startDataLayerLogger = function (settings) {
    if (!settings || !settings.customer || !settings.token) {
      console.error('datalayer log: "customer" or "token" is missing');
      return;
    }
    
    if (window.dataLayerLoggerStarted === true) {
      return;
    }

    window.dataLayerLoggerStarted = true;

    const endpoint = "https://browser-intake-datadoghq.eu/api/v2/logs";
    const token = settings.token;

    /* ---------------- BOT FILTERING ---------------- */

    const ua = navigator.userAgent || "";

    const namedBotRe =
      /(CookieInformationScanner|Morningscore|Googlebot|AdsBot-Google|Mediapartners-Google|APIs-Google|Google-InspectionTool|Storebot-Google|AhrefsBot|AhrefsSiteAudit)/i;

    const automationRe =
      /(HeadlessChrome|phantomjs|selenium|webdriver|playwright|puppeteer|chromedriver)/i;

    if (
      namedBotRe.test(ua) ||
      automationRe.test(ua) ||
      navigator.webdriver === true
    ) {
      return;
    }

    /* ---------------- HELPERS ---------------- */

    function getDeviceType() {
      return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
        ? "mobile"
        : "desktop";
    }

    function readAllCookies() {
      const cookies = {
        cookie_values: {},
        cookie_names: [],
      };

      document.cookie.split("; ").forEach(c => {
        const idx = c.indexOf("=");

        if (idx > -1) {
          const key = c.substring(0, idx);
          const value = c.substring(idx + 1);

          cookies.cookie_values[key] = value;
          cookies.cookie_names.push(key);
        }
      });

    return cookies;
    }

    function attachMissingDataLayers() {
      for (let i = 0; i < window.dataLayerlog.length; i++) {
        const queuedEvent = window.dataLayerlog[i];

        if (!queuedEvent.needs_datalayer_lookup) continue;

        const uniqueEventId = queuedEvent.uniqueEventId;
        if (!uniqueEventId) continue;

        for (let j = 0; j < window.dataLayer.length; j++) {
          const dlItem = window.dataLayer[j];
          let candidate = null;

          if (typeof dlItem.getUntrustedMessageValue === "function") {
            try {
              candidate = dlItem.getUntrustedMessageValue();
            } catch {
              continue;
            }
          }

          if (
            candidate &&
            candidate["gtm.uniqueEventId"] === uniqueEventId
          ) {
            queuedEvent.datalayer = candidate;
            delete queuedEvent.needs_datalayer_lookup;
            break;
          }
        }
      }
    }

    /* ---------------- FLUSH ---------------- */

    function flush() {
      if (!Array.isArray(window.dataLayerlog)) return;
      if (!window.dataLayerlog.length) return;

      const analyticsStorage =
        window.google_tag_data?.ics?.getConsentState?.("analytics_storage");

      const adStorage =
        window.google_tag_data?.ics?.getConsentState?.("ad_storage");

      if (analyticsStorage !== 1 || adStorage !== 1) {
        return;
      }

      // add missing datalayers
      attachMissingDataLayers();

      const payload = window.dataLayerlog
        .map(event => {

          event.user_agent = navigator.userAgent;
          event.device_type = getDeviceType();

          if (event.key_event === 1 || event.key_event === true) {
            event.full_datalayer = window.dataLayer;
            event.referrer = document.referrer || null;
            event.cookies = readAllCookies();
          }

          return JSON.stringify(event);
        })
        .join("\n");

      navigator.sendBeacon(
        endpoint + "?dd-api-key=" + token,
        payload
      );

      // Clear queue
      window.dataLayerlog.length = 0;
    }

    /* ---------------- lifecycle ---------------- */

    setInterval(flush, 5000);

    addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });

    addEventListener("pagehide", flush);
    addEventListener("beforeunload", flush);
    addEventListener("popstate", flush);
  };
})();
