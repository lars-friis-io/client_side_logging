(function () {
  window.larsFriis = window.larsFriis || {};

  window.larsFriis.sendLog = function (event_name,event_settings,event_data) {
    console.log(event_name);
    console.log(event_settings);
    console.log(event_data);
    
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
