(function () {
  window.startDataLayerLogger = function (settings) {
    if (!settings) return console.error('datalayer log: "settings" is missing');

    var endpoint = settings.endpoint || 'https://logs.larsfriis.io';
    var website_id = settings.website_id;
    var secret = settings.secret;
    var ignore_events = settings.ignore_events || [];
    var cmp_log = settings.cmp_log;
    var cmp_cookie_val = settings.cmp_cookie_val;
    var buffer = [];
    var cmp_required = false;

    // ---- Unique page ID ----
    var page_id = "page_" + crypto.randomUUID();

    // ---- Event counter ----
    var event_counter = 0;

    function newEventId() {
      event_counter++;
      return "evt_" + event_counter + "_" + crypto.randomUUID();
    }

    // ---- Simple UTM params ----
    function getQueryParam(name) {
      var params = new URLSearchParams(window.location.search);
      return params.get(name);
    }

    var utm_source = getQueryParam("utm_source");
    var utm_medium = getQueryParam("utm_medium");

    // ---- Validation ----
    if (!website_id || !secret)
      return console.error('datalayer log: "website_id" or "secret" is missing');

    // ---- Helpers ----
    function shouldSkip(msg) {
      if (msg && msg.event && msg.event.indexOf("gtm") === 0) return true;
      if (msg && msg[0] === "set") return true;
      if (msg && msg[0] === "consent") return true;
      if (msg && msg.event && ignore_events.indexOf(msg.event) !== -1) return true;
      return false;
    }

    function sanitize(obj) {
      if (obj && typeof obj === "object") {
        var clean = {};
        for (var k in obj) {
          if (k.toLowerCase() !== "gtm.uniqueeventid") {
            clean[k] = obj[k];
          }
        }
        return clean;
      }
      return obj;
    }

    // ---- Logging buffer ----
    function addToBuffer(event_name, data, fields) {
      var base = {
        event: event_name,
        client: "Client Side GTM",
        hostname: window.location.hostname,
        page_location: window.location.href,
        event_id: fields.event_id,
        event_index: fields.event_index,
        page_id: page_id,
        utm_source: utm_source,
        utm_medium: utm_medium,
        user_agent: navigator.userAgent,
        device_type:
          /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
            ? "mobile"
            : "desktop",

        datalayer: sanitize(data || {})
      };

      buffer.push(base);
    }

    function flush() {
      if (!buffer.length) return;

      var payload = {
        website_id: website_id,
        secret: secret,
        events: buffer.splice(0, buffer.length)
      };

      navigator.sendBeacon(endpoint, JSON.stringify(payload));
    }

    // ---- CMP Logic ----
    function handleCmpLoadEvent(dlEvent) {
      if (cmp_log && dlEvent && dlEvent.event === "gtm.load") {
        if (cmp_cookie_val === undefined) {
          cmp_required = true;

          var cookie_list = [];
          var raw = (document.cookie || "").split(";");
          for (var i = 0; i < raw.length; i++) {
            var name = raw[i].split("=")[0].trim();
            if (name) cookie_list.push(name);
          }

          addToBuffer("consent_required", {}, { 
            event_id: newEventId(),
            event_index: event_counter
          });
        }
      }
    }

    function handleConsentUpdateEvent(dlEvent) {
      if (
        cmp_required &&
        dlEvent &&
        dlEvent[0] === "consent" &&
        dlEvent[1] === "update" &&
        typeof dlEvent[2] === "object"
      ) {
        addToBuffer("consent_given", {}, { 
          event_id: newEventId(),
          event_index: event_counter
        });
        cmp_required = false;
      }
    }

    // ---- Hook into dataLayer ----
    if (Array.isArray(window.dataLayer)) {

      // Process existing items
      for (var i = 0; i < window.dataLayer.length; i++) {
        var obj = window.dataLayer[i];
        if (obj && typeof obj === "object") {

          var id = newEventId();
          obj.event_id = id; // Insert into actual dataLayer object

          var fields = {
            event_id: id,
            event_index: event_counter
          };

          if (!shouldSkip(obj)) addToBuffer(obj.event || "message", obj, fields);

          handleCmpLoadEvent(obj);
          handleConsentUpdateEvent(obj);
        }
      }

      // Monkey patch push()
      var originalPush = window.dataLayer.push;
      window.dataLayer.push = function () {
        var args = Array.prototype.slice.call(arguments);
        var msg = args[0];

        if (msg && typeof msg === "object") {
          var idPush = newEventId();
          msg.event_id = idPush; // Insert into datalayer object

          var fieldsPush = {
            event_id: idPush,
            event_index: event_counter
          };

          if (!shouldSkip(msg)) addToBuffer(msg.event || "message", msg, fieldsPush);
          handleCmpLoadEvent(msg);
          handleConsentUpdateEvent(msg);
        }

        return originalPush.apply(window.dataLayer, args);
      };

    } else {
      console.error("datalayer log: dataLayer is missing");
    }

    // ---- Flush ----
    addEventListener("pagehide", flush);
    addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flush();
    });

  };
})();
