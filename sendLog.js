(function () {
  window.larsFriis = window.larsFriis || {};

  window.larsFriis.sendLog = function (datalayer) {
    const page_location = window.location.href;
    const user_agent = navigator.userAgent;
    const device_type = /Mobi|Android|iPhone|iPad|iPod/i.test(user_agent)
      ? "mobile"
      : "desktop";
    const source = "client";

    // Hent event fra datalayer eller fallback
    const event =
      datalayer && typeof datalayer === "object" && datalayer.event
        ? datalayer.event
        : "message";

    const trackingData = {
      page_location,
      user_agent,
      device_type,
      source,
      event,
      datalayer, // hele input-objektet
    };

    console.log("Client tracking data:", trackingData);
    return trackingData;
  };
})();
