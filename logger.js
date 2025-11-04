(function () {
  window.startDataLayerLogger = function (settings) {
    if (!settings)
      return console.error('datalayer log: "settings" is missing');
    const endpoint = settings.endpoint || 'https://logs.larsfriis.io';
    const website_id = settings.website_id || null;
    const secret = settings.secret || null;
    const ignore_events = settings.ignore_events || [];
    const buffer = [];

    if (!website_id || !secret)
      return console.error('datalayer log: "website_id" or "secret" is missing');

    function shouldSkip(msg) {
      if (msg?.event && msg.event.startsWith('gtm')) return true;
      if (msg && msg[0] === 'set') return true;
      if (msg && msg[0] === 'consent') return true;
      if (msg?.event && ignore_events.includes(msg.event)) return true;
      return false;
    }
    
    function sanitize(obj) {
      if (obj && typeof obj === 'object' && 'gtm.uniqueEventId' in obj) {
        const clean = { ...obj };
        delete clean['gtm.uniqueEventId'];
        return clean;
      }
      return obj;
    }
    
    function queueEvent(dlEvent) {
      if (shouldSkip(dlEvent)) return;
      buffer.push({
        page_location: window.location.href,
        user_agent: navigator.userAgent,
        device_type: /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
          ? 'mobile'
          : 'desktop',
        event: dlEvent?.event || 'message',
        datalayer: sanitize(dlEvent),
      });
    }

    function flush() {
      if (!buffer.length) return;
      const payload = { website_id, secret, events: buffer.splice(0, buffer.length) };
      navigator.sendBeacon(endpoint, JSON.stringify(payload));
    }

    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.forEach((obj) => {
        if (obj && typeof obj === 'object') queueEvent(obj);
      });

      const originalPush = window.dataLayer.push;
      window.dataLayer.push = function () {
        const args = Array.from(arguments);
        const msg = args[0];
        if (msg && typeof msg === 'object') queueEvent(msg);
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
