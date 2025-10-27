(function () {
  window.larsFriis = window.larsFriis || {};

  window.larsFriis.sendLog = function (containerId,event,consent) {
    const dataModel = window.google_tag_manager[containerId].dataLayer.get({
      split: function () {
        return [];
      }
    });

    const trackingData = {
      page_location: window.location.href,
      user_agent: navigator.userAgent,
      device_type: /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
        ? "mobile"
        : "desktop",
      source: "client",
      event: event,
      consent: consent,
      datalayer: dataModel
    };

    console.log("Client tracking data:", trackingData);
    return trackingData;
  };
})();
