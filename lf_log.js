(function () {
  window.startDataLayerLogger = function (settings) {
    if (!settings) {
      console.error('datalayer log: "settings" is missing');
      return;
    }

    // settings
    const endpoint =
      settings.endpoint ||
      "https://browser-intake-datadoghq.eu/api/v2/logs";
    const customer = settings.customer;
    const token = settings.token;
    const page_id = settings.page_id || null;
    const session_id = settings.session_id || null;
    const debug_mode_enabled = settings.debug_mode === true;
    const ignore_events = settings.ignore_events || [];

    const log_cookies = settings.log_cookies === true;
    const log_traffic = settings.log_traffic === true;

    if (!customer || !token) {
      console.error('datalayer log: "token" or "customer" is missing');
      return;
    }

    // sampling
    const samplingSetting = settings.sampling ?? settings.samling;
    const sampling_enabled =
      samplingSetting === true &&
      debug_mode_enabled !== true &&
      !(typeof session_id === "string" && session_id.endsWith("1"));

    // bot filtering
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

    // session / traffic data
    const SESSION_COOKIE_NAME = "gtm_log_session";

    function readSessionCookie() {
      const match = document.cookie
        .split("; ")
        .find(c => c.startsWith(SESSION_COOKIE_NAME + "="));
      if (!match) return null;
      try {
        return JSON.parse(decodeURIComponent(match.split("=")[1]));
      } catch {
        return null;
      }
    }

    function writeSessionCookie(data) {
      document.cookie =
        SESSION_COOKIE_NAME +
        "=" +
        encodeURIComponent(JSON.stringify(data)) +
        "; path=/; SameSite=Lax";
    }

    function parseUtmParams(url) {
      const utm = {};
      try {
        const parsed = new URL(url);
        parsed.searchParams.forEach((value, key) => {
          if (key.startsWith("utm_")) {
            utm[key] = value;
          }
        });
      } catch {}
      return utm;
    }

    const existingSession = log_traffic ? readSessionCookie() : null;

    const sessionData = log_traffic
      ? existingSession || {
          landing_page: window.location.href,
          referrer: document.referrer || null
        }
      : null;

    // state
    const buffer = [];
    let datalayer_index_counter = 0;
    let pageViewFired = false;
    let pageHasKeyEvent = false;

    const key_events = Array.isArray(settings.key_events)
      ? settings.key_events.map(e => e?.event_name).filter(Boolean)
      : [];

    // helpers
    function shouldSkip(msg) {
      if (!msg) return true;
      if (msg?.[0] === "set") return true;

      if (msg?.event && msg.event.startsWith("gtm.")) {
        return msg.event !== "gtm.js";
      }

      if (msg?.event) {
        for (let i = 0; i < ignore_events.length; i++) {
          const rule = ignore_events[i];
          if (!rule || typeof rule !== "object") continue;
          if (rule.match === "equal" && msg.event === rule.event_name) return true;
          if (rule.match === "contains" && msg.event.includes(rule.event_name)) return true;
        }
      }
      return false;
    }

    function sanitizeDataLayer(data) {
      if (!data || typeof data !== "object") return data;
      const clean = { ...data };
      delete clean["gtm.uniqueEventId"];
      return clean;
    }

    function isKeyEvent(eventName) {
      return key_events.includes(eventName);
    }

    function readAllCookies() {
      if (!log_cookies) return undefined;
      const cookies = {};
      document.cookie.split("; ").forEach(c => {
        const idx = c.indexOf("=");
        if (idx > -1) {
          cookies[c.substring(0, idx)] = c.substring(idx + 1);
        }
      });
      return cookies;
    }

    // payload
    function buildEventPayload(event_name, data, isKeyEventFlag) {
      const uniqueId = data?.["gtm.uniqueEventId"] ?? null;

      const payload = {
        event_name,
        service: "datalayer",
        customer,
        hostname: window.location.hostname,
        page_location: window.location.origin + window.location.pathname,
        user_agent: navigator.userAgent,
        device_type: /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
          ? "mobile"
          : "desktop",
        datalayer_index: datalayer_index_counter,
        page_id,
        session_id,
        timestamp: Date.now(),
        datalayer: sanitizeDataLayer(data)
      };

      if (log_traffic && sessionData?.landing_page) {
        payload.session = {
          landing_page: sessionData.landing_page,
          referrer: sessionData.referrer,
          ...parseUtmParams(sessionData.landing_page)
        };
      }

      if (log_cookies) {
        payload.cookies = readAllCookies();
      }

      if (isKeyEventFlag === true) {
        payload.key_event = true;
      }

      if (uniqueId !== null) {
        payload.event_id = `${page_id}_${uniqueId}`;
      }

      if (debug_mode_enabled) {
        payload.debug_mode = true;
      }

      return payload;
    }

    // buffer handling
    function addToBuffer(event_name, data, isKeyEventFlag) {
      buffer.push(
        buildEventPayload(event_name, data, isKeyEventFlag)
      );
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

      if (isKeyEvent(eventName)) {
        pageHasKeyEvent = true;
        addToBuffer(eventName, dlEvent, true);
        return;
      }

      addToBuffer(eventName, dlEvent, false);
    }

    // flush
    function flush() {
      if (!buffer.length) return;

      const analyticsStorage =
        window.google_tag_data.ics.getConsentState("analytics_storage");
      const adStorage =
        window.google_tag_data.ics.getConsentState("ad_storage");

      if (analyticsStorage !== 1 || adStorage !== 1) {
        return;
      }

      if (log_traffic && sessionData) {
        writeSessionCookie(sessionData);
      }

      if (sampling_enabled === true && pageHasKeyEvent === false) {
        return;
      }

      const isSampledSession =
        sampling_enabled === true && pageHasKeyEvent === true;

      const payload = buffer
        .splice(0)
        .map(e => {
          if (isSampledSession) {
            e.sampled_session = true;
          }
          return JSON.stringify(e);
        })
        .join("\n");

      navigator.sendBeacon(
        endpoint + "?dd-api-key=" + token,
        payload
      );
    }

    // datalayer interception
    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.forEach(obj => {
        if (obj && typeof obj === "object") {
          queueEvent(obj);
        }
      });

      const originalPush = window.dataLayer.push;
      window.dataLayer.push = function () {
        const msg = arguments[0];
        const result = originalPush.apply(window.dataLayer, arguments);
        if (msg && typeof msg === "object") {
          queueEvent(msg);
        }
        return result;
      };
    }

    // timers and lifecycle
    setInterval(flush, 5000);
    addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    addEventListener("pagehide", flush);
    addEventListener("beforeunload", flush);
    addEventListener("popstate", flush);
  };
})();
