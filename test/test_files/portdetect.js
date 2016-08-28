(function() {

  function empty() {}

  function getRequest() {
    if (window.XDomainRequest) {
      return new window.XDomainRequest();
    } else if (window.XMLHttpRequest) {
      return new window.XMLHttpRequest();
    } else {
      try { return new ActiveXObject('Microsoft.XMLHTTP'); } catch (e) {}
      try { return new ActiveXObject('Msxml2.XMLHTTP.6.0'); } catch (e) {}
      try { return new ActiveXObject('Msxml2.XMLHTTP.3.0'); } catch (e) {}
      try { return new ActiveXObject('Msxml2.XMLHTTP'); } catch (e) {}
    }
    return null;
  }

  function clean(request) {
    request.onload = empty;
    request.onerror = empty;
    request.onprogress = empty;
    request.ontimeout = empty;
  }

  var domain = (function() {
    var subdomain = '';
    var min = 97;
    var max = 122;
    for (var i = 0; i < 10; ++i) {
      subdomain += String.fromCharCode(
          Math.floor(Math.random() * (max - min + 1)) + min);
    }
    return '//' + subdomain + '.spotilocal.com';
  })();

  var startPort = 4370;
  var endPort = 4379;
  if (location.protocol == 'http:') {
    startPort = 4380;
    endPort = 4389;
  }

  function detect(port, cb) {
    if (port > endPort) {
      return cb(null, {port: null});
    }
    var request = getRequest();
    if (!request) {
      return cb(new Error('Cannot create request.'));
    }
    request.onload = function() {
      var error = null;
      var payload;
      try {
        payload = {
          port: port,
          response: JSON.parse(request.responseText)
        };
      } catch (e) {
        error = e;
      }
      clean(request);
      cb(error, payload);
    };
    request.timeout = 5000;
    request.onerror = function() {
      clean(request);
      detect(port + 1, cb);
    };
    request.ontimeout = function() {
      clean(request);
      detect(port + 1, cb);
    };
    request.onprogress = function() {};
    request.open('GET', domain + ':' + port +
                 '/service/version.json?service=remote', true);
    request.send();
  }

  detect(startPort, function(error, data) {
    if (error) {
      return;
    }
    if (data.port != null) {
      Spotify.Web.GA.trackEvent('port-detect', 'webhelper-available');
    }
  });

})();
