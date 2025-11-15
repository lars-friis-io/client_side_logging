(function () {
  window.startDataLayerLogger = function (settings) {

    if (!settings)
      return console.error('datalayer log: "settings" is missing');

    const endpoint = settings.endpoint || 'https://logs.larsfriis.io';
    const website_id = settings.website_id;
    const secret = settings.secret;
    const page_id = settings.page_id || null;
    const ignore_events = settings.ignore_events || [];
    const cmp_log = settings.cmp_log;
    const cmp_cookie_val = settings.cmp_cookie_val;
    const buffer = [];
    let cmp_required = false;

    if (!website_id || !secret)
      return console.error('datalayer log: "website_id" or "secret" is missing');

    function getQueryParam(name) {
      const params = new URLSearchParams(window.location.search);
      return params.get(name);
    }

    const utm_source = getQueryParam("utm_source");
    const utm_medium = getQueryParam("utm_medium");

    function shouldSkip(msg) {
      if (msg?.event && msg.event.startsWith('gtm')) return true;
      if (msg?.[0] === 'set' || msg?.[0] === 'consent') return true;
      if (msg?.event && ignore_events.includes(msg.event)) return true;
      return false;
    }

    function addToBuffer(event_name, data, extraFields = {}) {
      const eventIndex = data?.["gtm.uniqueEventId"] || -1;

      const base = {
        event: event_name,
        client: 'Client Side GTM',
        hostname: window.location.hostname,
        page_location: window.location.href,
        user_agent: navigator.userAgent,
        device_type: /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
          ? 'mobile'
          : 'desktop',
        event_index: eventIndex,
        ...extraFields,
        datalayer: data || {}
      };

      if (page_id) {
        base.page_id = page_id;
        base.event_id = page_id + "_" + eventIndex;
      }

      if (utm_source) base.utm_source = utm_source;
      if (utm_medium) base.utm_medium = utm_medium;

      buffer.push(base);
    }

    function queueEvent(dlEvent) {
      if (shouldSkip(dlEvent)) return;
      addToBuffer(dlEvent?.event || 'message', dlEvent);
    }

    function flush() {
      if (!buffer.length) return;
      const payload = { website_id, secret, events: buffer.splice(0, buffer.length) };
      navigator.sendBeacon(endpoint, JSON.stringify(payload));
    }

    function handleCmpLoadEvent(dlEvent) {
      if (cmp_log && dlEvent?.event === 'gtm.load') {
        if (cmp_cookie_val === undefined) {
          cmp_required = true;
          const cookie_list = (document.cookie || '')
            .split(';')
            .map(c => c.trim().split('=')[0])
            .filter(Boolean);
          addToBuffer('consent_required', {}, { cookie_list });
        }
      }
    }

    function handleConsentUpdateEvent(dlEvent) {
      if (
        cmp_required &&
        dlEvent?.[0] === 'consent' &&
        dlEvent?.[1] === 'update' &&
        typeof dlEvent?.[2] === 'object'
      ) {
       addToBuffer('consent_given', {}, { consent: dlEvent[2] });
       cmp_required = false;
      }
    }

    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.forEach((obj) => {
        if (obj && typeof obj === 'object') {
          queueEvent(obj);
          handleCmpLoadEvent(obj);
          handleConsentUpdateEvent(obj);
        }
      });

      const originalPush = window.dataLayer.push;
      window.dataLayer.push = function () {
        const args = Array.from(arguments);
        const msg = args[0];
        if (msg && typeof msg === 'object') {
          queueEvent(msg);
          handleCmpLoadEvent(msg);
          handleConsentUpdateEvent(msg);
        }
        return originalPush.apply(window.dataLayer, args);
      };
    } else {
      console.error('datalayer log: dataLayer is missing');
    }

    addEventListener('pagehide', flush);
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  };
})();
