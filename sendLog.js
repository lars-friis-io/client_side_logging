(function () {
  window.larsFriis = window.larsFriis || {};

  window.larsFriis.sendLog = function (containerId) {
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
      event: dataModel.event,
      datalayer: dataModel
    };

    console.log("Client tracking data:", trackingData);
    return trackingData;
  };
})();
