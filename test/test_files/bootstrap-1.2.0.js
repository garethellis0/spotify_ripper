(function() {
  var appVendor = manifest && manifest.VendorIdentifier || "unknown";
  var appVersion = manifest && manifest.BundleVersion || "0.0.0";
  var uid = 0;
  var callbacks = {};
  var top = window.top;

  // Feature removal test: hide radio from context menu
  if (top.Spotify.removeRadio) {
    var css = '#start-radio { display: none !important;}';
    var head = document.head || document.getElementsByTagName('head')[0];
    var style = document.createElement('style');
    style.type = 'text/css';
    if (style.styleSheet){
      style.styleSheet.cssText = css;
    } else {
      style.appendChild(document.createTextNode(css));
    }
    head.appendChild(style);
  }

  window.__apiRequest = function(name, args, success, failure) {
    var id = 'internal_' + (uid++);
    if (success || failure) {
      callbacks[id] = {success: success, failure: failure};
    }
    top.postMessage(JSON.stringify({
      type: 'bridge_request',
      id: id,
      name: name,
      args: args,
      appVersion: appVersion,
      appVendor: appVendor
    }), '*');
  };

  window.addEventListener('message', function(event) {
    var message;
    try {
      message = JSON.parse(event.data);
    }
    catch(e) {
      return;
    }
    // Focus fixes
    if (message && message.type === 'WINDOW_FOCUS') {
      window.focus();
    } else if (message.id && callbacks[message.id]) {
      var callback = callbacks[message.id];
      if (message.success && callback.success) {
        callback.success.call(null, message.payload);
      } else if (!message.success && callback.failure) {
        callback.failure.call(null, message.payload);
      }
    }
  });

}());

// External links
(function() {
  var enabledIds = {
    hub: 1
  };
  var manifest = window.manifest;
  if (!manifest || !manifest.BundleIdentifier ||
      !enabledIds[manifest.BundleIdentifier]) {
    return;
  }

  window.addEventListener('click', function(e) {
    var target = e.target;
    if (!target || !target.tagName || target.tagName != 'A' ||
        !(/^https?:\/\//).test(target.href)) {
      return;
    }
    target.target = '_blank';
  });

}());

// Inactivity tracking
(function() {

  var debounce = function(fn, delay) {
    var timer = null;
    return function () {
      var context = this, args = arguments;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        fn.apply(context, args);
      }, delay);
    };
  };

  window.addEventListener('mousemove', debounce(function() {
    window.parent.postMessage(JSON.stringify({type: 'USER_ACTIVE'}), '*');
  }, 100));

}());


// Send events to parent window when dragging started and ended
(function() {

  window.addEventListener('dragstart', function(e) {
    window.parent.postMessage(JSON.stringify({
      type: 'DRAG_STARTED'
    }), '*');
  }, false);

  window.addEventListener('dragend', function(e) {
    window.parent.postMessage(JSON.stringify({
      type: 'DRAG_ENDED'
    }), '*');
  }, false);

}());

// Right-click handler
(function() {

  var getLinkWithData = function(link) {
    if (link.className === 'hero-img' || link.className === 'sp-story-hero') {
      // Discovery/now-playing-recs image urgh
      return link.querySelector('.musicItem');
    }
    while (link
            && !(link instanceof HTMLAnchorElement
            || (typeof link.hasAttribute === 'function' && (link.hasAttribute('data-uri')
            || link.hasAttribute('data-itemuri'))))) {
      link = link.parentNode;
    }
    return link;
  };

  var cleanCollectionLink = function(uri) {
    var cleanUri;
    var re;
    var options = ['track', 'album', 'artist'];
    for (var i = 0; i < options.length; i++) {
      try {
        re = new RegExp(options[i] + ':[0-9a-zA-Z]*');
        cleanUri = 'spotify:' + re.exec(uri)[0];
        break;
      }
      catch (e) {
        // no worky
      }
    }
    return cleanUri;
  };

  window.addEventListener('contextmenu', function(e) {
    var uri;
    if (!e.shiftKey && !e.altKey) {
      // Allow people to open native menu by holding shift or alt
      e.preventDefault();
      var link = getLinkWithData(e.target);
      if (link) {
        uri = (link.getAttribute('data-itemuri') || link.href);
        if (uri === '' || typeof uri === 'undefined') {
          return false;
        }
        uri = uri.toSpotifyURI();
        if (uri.indexOf('collection') !== -1) {
          uri = cleanCollectionLink(uri);
          if (!uri) { return false; }
        }
        if (uri.indexOf('spotify:') === -1) { return; } // not a valid URI
        if (uri.indexOf('following') !== -1) { return; } // not supported
        if (uri.indexOf('followers') !== -1) { return; } // not supported
        if (uri.indexOf('browse') !== -1) { return; } // internal browse links not supported
        if (uri.indexOf('app') !== -1) { return; } // App: links not supported
        var args = [e.clientX, e.clientY, 0, 5, encodeURIComponent(uri)].join(':');
        __apiRequest('application_open_uri', ['spotify:app:context-actions:' + args, null]);
    }
    }
  }, false);

}());

var securityLog = function(logType, args) {
  if (window.parent.location.origin.indexOf('.spotify.net') != -1) {
    return;
  }

  try {
    security.XY.Z;
  } catch (e) {
    var data = {
      'args': args,
      'url': window.location.href,
      'referrer': document.referrer,
      'trace': e.stack || 'N/A'
    };

    __apiRequest("application_client_event", ['Security warning', 'alert', '1', '', data]);

    __apiRequest("application_query", [], function(appRes) {
      __apiRequest("session_query", [], function(sessRes) {
        var params = {
          'site': window.parent.location.origin,
          'source': appRes.uri,
          'method': logType,
          'username': sessRes._username,
          'data': JSON.stringify(data)
        };

        var encParams = Object.keys(params).map(function(k) {
          return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        }).join('&');

        var xhr = new XMLHttpRequest();
        xhr.open('POST', params['site'] + '/xhr/json/security_monitor.php');
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.send(encParams);
      });
    });

  }
};

// Wrapping alert in a naive attempt to catch externally found XSS vulns
(function(fn) {
  window.alert = function() {
    var args = Array.prototype.slice.call(arguments);
    securityLog('alert', args);
    return fn.apply(window, args);
  };
})(window.alert);

(function(fn) {
  window.prompt = function() {
    var args = Array.prototype.slice.call(arguments);
    securityLog('prompt', args);
    return fn.apply(window, args);
  };
})(window.prompt);

(function(fn) {
  window.confirm = function() {
    var args = Array.prototype.slice.call(arguments);
    securityLog('confirm', args);
    return fn.apply(window, args);
  };
})(window.confirm);
