(function (main, modules) {
  'use strict';
  var cache = {};
  var wd = function (c) {
    return c.split(/\//).slice(0, -1).join('/');
  };
  window.process = {
    cwd: function () {
      return wd(location.pathname) || '/';
    }
  };
  var require = function (id) {
    var exports = cache[id];
    if (!exports) {
      var module = modules[id];
      if (!module)
        throw new Error('module ' + id + ' not found');
      var mod = {};
      exports = mod.exports = {};
      var cwd = wd(location.pathname), mwd = wd(id);
      var __dirname = mwd ? cwd + '/' + mwd : cwd, __filename = cwd + '/' + id;
      module.call(exports, require, mod, exports, window, __filename, __dirname);
      exports = cache[id] = mod.exports;
    }
    return exports;
  };
  var atLoc = /(@loc)\b/g;
  var join_ = Array.prototype.join;
  var resolve = function (id, lang, script, region) {
    var attempt = function (m) {
      return modules[m] ? m : null;
    };
    var options = [];
    var add = function (option) {
      option = join_.call(arguments, '-');
      if (options.indexOf(option) === -1)
        options.push(option);
    };
    if (region) {
      add(lang, script, region);
      add(lang, region);
    }
    if (script)
      add(lang, script);
    add(lang);
    add('en');
    var i, key;
    for (i = 0; i < supportedLanguages.length; i++)
      add(supportedLanguages[i]);
    for (i = 0; i < options.length; i++) {
      var m = id.replace(atLoc, options[i]);
      if (key = attempt(m))
        return key;
    }
    return m;
  };
  var done = function (LANG) {
    var loc = LANG.replace(/_/g, '-').toLowerCase().split('-');
    var lang = loc[0];
    var script = loc[1];
    var region = loc[2];
    var _require = require;
    require = function (id) {
      return _require(id.match(atLoc) ? resolve(id, lang, script, region) : id);
    };
    require(main);
  };
  require('node_modules/quickstart-spotify/api-core.js');
  try {
    var supportedLanguages = require('supported-languages.json');
  } catch (err) {
  }
  if (supportedLanguages) {
    SP.request('session_query', [], null, function (data) {
      done(data.language);
    }, function () {
      done('en');
    });
  } else {
    done('en');
  }
}('scripts/main.js', {
  'node_modules/api/scripts/core.js': function (require, module, exports, global, __filename, __dirname) {
    var spotify = {};
    function SpotifyApi() {
      this._modules = {};
      this._requested = {};
      this._moduleQueue = [];
      this._delayedFns = [];
      this._parallelReqs = 4;
      this._contextStack = [];
      this._deferredFlush = false;
      this._useLoadingTimeout = false;
      this._patchRequestOpen();
    }
    SpotifyApi.AnalyticsContext = function (name) {
      this.name = name;
      this.id = SpotifyApi.AnalyticsContext._nextId++;
      this.references = 0;
      this._begin();
    };
    SpotifyApi.AnalyticsContext._nextId = 1;
    SpotifyApi.AnalyticsContext.prototype.addReference = function () {
      this.references++;
    };
    SpotifyApi.AnalyticsContext.prototype.removeReference = function () {
      this.references--;
      if (this.references === 0) {
        this._end();
      }
    };
    SpotifyApi.AnalyticsContext.prototype._begin = function () {
      SpotifyApi.api.request('core_context_begin', [
        this.id,
        this.name
      ], this);
    };
    SpotifyApi.AnalyticsContext.prototype._end = function () {
      SpotifyApi.api.request('core_context_end', [this.id], this);
    };
    SpotifyApi.prototype.analyticsContext = function (name, func) {
      var context = new SpotifyApi.AnalyticsContext(name);
      context.addReference();
      this._contextStack.push(context);
      try {
        func();
      } finally {
        this._contextStack.pop();
        context.removeReference();
      }
    };
    SpotifyApi.Callback = function (func, opt_contextStack) {
      this._func = func;
      this._setContextStack(opt_contextStack || SpotifyApi.api._contextStack);
    };
    SpotifyApi.Callback.prototype.apply = function (context, args) {
      try {
        var oldContextStack = SpotifyApi.api._contextStack;
        SpotifyApi.api._contextStack = this._contextStack;
        this._func.apply(context, args);
      } catch (error) {
        setTimeout(function () {
          throw error;
        }, 0);
      } finally {
        SpotifyApi.api._contextStack = oldContextStack;
        this.clear();
      }
    };
    SpotifyApi.Callback.prototype.call = function (context, var_args) {
      this.apply(context, Array.prototype.slice.call(arguments, 1));
    };
    SpotifyApi.Callback.prototype.copy = function () {
      return new this.constructor(this._func, this._contextStack);
    };
    SpotifyApi.Callback.prototype.clear = function () {
      this._releaseContextStack();
      delete this._func;
      delete this._contextStack;
    };
    SpotifyApi.Callback.prototype._setContextStack = function (contextStack) {
      for (var i = 0, l = contextStack.length; i < l; ++i) {
        contextStack[i].addReference();
      }
      this._contextStack = contextStack.slice(0);
    };
    SpotifyApi.Callback.prototype._releaseContextStack = function () {
      var contextStack = this._contextStack;
      for (var i = 0, l = contextStack.length; i < l; ++i) {
        contextStack[l - i - 1].removeReference();
      }
    };
    SpotifyApi.prototype.callback = function (func) {
      return new SpotifyApi.Callback(func);
    };
    SpotifyApi.prototype._getContextIdForRequest = function () {
      var contexts = this._contextStack;
      return contexts.length ? contexts[contexts.length - 1].id : 0;
    };
    window.addEventListener('message', function (event) {
      if (event.source == window && event.data == 'api-delay') {
        event.stopPropagation();
        var functions = SpotifyApi.api._delayedFns.splice(0);
        for (var i = 0, l = functions.length; i < l; i++) {
          functions[i].call();
        }
      }
    });
    SpotifyApi.prototype._prepareFlush = function (name) {
      if (!this._deferredFlush && name != 'core_flush') {
        this._deferredFlush = true;
        this.defer(this, this._flushRequests);
      }
    };
    SpotifyApi.prototype._flushRequests = function () {
      this._deferredFlush = false;
      this.request('core_flush', []);
    };
    SpotifyApi.prototype.defer = function (self, func) {
      if (this._delayedFns.push(this.bind(this.callback(func), self)) == 1)
        window.postMessage('api-delay', '*');
    };
    SpotifyApi.prototype._evalModule = function (meta, graph, module, code) {
      return !/\.lang$/.test(module) ? this._evalJSModule(meta, graph, module, code) : this._evalLangModule(module, code);
    };
    SpotifyApi.prototype._evalJSModule = function (meta, graph, module, code) {
      var self = this;
      var exports = { __name: module };
      var require = function (modules, fn) {
        exports.__waiting = true;
        var callback = function () {
          exports.__waiting = false;
          return fn.apply(this, arguments);
        };
        callback.__native = true;
        return self._require(module, meta, graph, modules, callback);
      };
      try {
        code = '\'use strict\';' + code + '\n//@ sourceURL=' + module;
        new Function('require', 'exports', 'SP', '_code', 'eval(_code)').call({}, require, exports, this, code);
        return exports;
      } catch (error) {
        error.message += ' in ' + module;
        throw error;
      }
    };
    SpotifyApi.LangModule = function (name, strings) {
      this.__name = name;
      this.strings = strings;
    };
    SpotifyApi.LangModule.prototype.get = function (key, var_args) {
      var format = this.strings.hasOwnProperty(key) ? this.strings[key] : key;
      var out = '', lastIndex = 0, startIndex, endIndex;
      while ((startIndex = format.indexOf('{', lastIndex)) > -1) {
        endIndex = format.indexOf('}', startIndex + 1);
        if (endIndex == -1) {
          break;
        }
        var value = arguments[parseInt(format.substring(startIndex + 1, endIndex)) + 1];
        if (value !== undefined) {
          out += format.substring(lastIndex, startIndex) + value;
        } else {
          out += format.substring(lastIndex, endIndex + 1);
        }
        lastIndex = endIndex + 1;
      }
      return lastIndex ? out + format.substring(lastIndex) : format;
    };
    SpotifyApi.prototype._evalLangModule = function (module, code) {
      try {
        return new SpotifyApi.LangModule(module, JSON.parse(code));
      } catch (error) {
        throw new Error('Cannot import language file "' + module + '": ' + error.message);
      }
    };
    SpotifyApi.prototype._fireCallbacks = function (meta) {
      while (meta) {
        meta.waiting--;
        if (meta.waiting)
          break;
        meta.unpacked.forEach(function (unpacked) {
          var pos = unpacked.position;
          var exported = meta.args[pos];
          var property = unpacked.property;
          if (!(property in exported))
            throw new Error('No "' + property + '" exported in module "' + exported.__name + '"');
          meta.args[pos] = exported[property];
        });
        meta.callback.apply({}, meta.args);
        meta.waiting = 1 / 0;
        meta = meta.parent;
      }
    };
    SpotifyApi.prototype._createRequest = function (path, callback) {
      var request, timeoutMS, xmlHttpTimeout, timedOut;
      request = new XMLHttpRequest();
      request.open('GET', path, true);
      request.onreadystatechange = function () {
        var isDone, iOSHack, isOK;
        isDone = request.readyState === 4;
        if (isDone) {
          clearTimeout(xmlHttpTimeout);
          if (timedOut) {
            throw new Error('Could not load file "' + path + '"; Timed out.');
          }
          iOSHack = request.status === 0 && !!request.responseText;
          isOK = request.status === 200 || iOSHack;
          if (!isOK) {
            throw new Error('Could not load file "' + path + '"; Not found.');
          }
          callback(request.responseText);
        }
      };
      if (this._useLoadingTimeout) {
        timeoutMS = 1500;
        xmlHttpTimeout = setTimeout(function () {
          timedOut = true;
          request.abort();
        }, timeoutMS);
      }
      request.send(null);
    };
    SpotifyApi.prototype._loadModule = function (meta, graph, module, position, property) {
      var self = this;
      var cached = this._modules[module];
      if (cached && !cached.__waiting) {
        meta.args[position] = this._modules[module];
        if (property)
          meta.unpacked.push({
            property: property,
            position: position
          });
        this._fireCallbacks(meta);
      } else if (this._requested[module] || !this._parallelReqs) {
        this.defer(this, function () {
          this._loadModule(meta, graph, module, position, property);
        });
      } else {
        this._requested[module] = true;
        this._parallelReqs--;
        this._createRequest(module, function (responseText) {
          self._parallelReqs++;
          var exported = self._modules[module] = self._evalModule(meta, graph, module, responseText);
          meta.args[position] = exported;
          if (property)
            meta.unpacked.push({
              property: property,
              position: position
            });
          self._fireCallbacks(meta);
        });
      }
    };
    SpotifyApi.prototype._resolveModule = function (module) {
      if (!/\.lang$/.test(module)) {
        var _module = module.match(/^(\$(?:[^\/]+)\/)(?!scripts)(.*)/);
        if (_module)
          module = _module[1] + 'scripts/' + _module[2];
        module += '.js';
      }
      return module;
    };
    SpotifyApi.prototype._require = function (name, parent, graph, modules, fn) {
      if (typeof modules == 'string')
        modules = [modules];
      if (!modules || !modules.length)
        throw new Error('Missing modules argument to require().');
      if (!fn || typeof fn != 'function')
        throw new Error('Missing callback function argument to require().');
      var len = modules.length;
      var meta = {
        name: name,
        parent: parent,
        waiting: len,
        callback: fn,
        args: new Array(len),
        unpacked: []
      };
      parent.waiting++;
      for (var i = 0, l = len; i < l; i++) {
        var module = modules[i];
        if (!module)
          throw new Error('Empty module name in require.');
        var property = module.split('#');
        module = this._resolveModule(property[0]);
        property = property[1];
        var modGraph = graph.slice(0);
        var index = graph.indexOf(module);
        modGraph.push(module);
        if (index != -1) {
          modGraph = modGraph.slice(index).join(' -> ');
          throw new Error('Circular Dependency on Module "' + module + '": ' + modGraph);
        }
        this._loadModule(meta, modGraph, module, i, property);
      }
    };
    SpotifyApi.prototype.varargs = function (values, opt_offset, opt_copy) {
      if (!opt_offset)
        opt_offset = 0;
      if (Array.isArray(values[opt_offset])) {
        if (values.length > opt_offset + 1)
          throw new Error('Ambiguous use of varargs');
        values = values[opt_offset];
        opt_offset = 0;
      }
      return opt_offset || opt_copy ? Array.prototype.slice.call(values, opt_offset) : values;
    };
    SpotifyApi.prototype.uris = function (values, opt_offset) {
      var objs = this.varargs(values, opt_offset), uris = [];
      for (var i = 0, len = objs.length; i < len; i++) {
        uris.push(objs[i].uri);
      }
      return uris;
    };
    SpotifyApi.prototype.bind = function (func, that, var_args) {
      if (arguments.length > 2) {
        var slice = Array.prototype.slice;
        var bind = Function.prototype.bind;
        if (bind && func.bind === bind)
          return bind.apply(func, slice.call(arguments, 1));
        var args = slice.call(arguments, 2);
        return function () {
          return func.apply(that, arguments.length ? args.concat(slice.call(arguments)) : args);
        };
      } else {
        return function () {
          return func.apply(that, arguments);
        };
      }
    };
    SpotifyApi.prototype.inherit = function (childConstructor, parentConstructor) {
      var TempConstructor = function () {
      };
      TempConstructor.prototype = childConstructor._superClass = parentConstructor.prototype;
      childConstructor.prototype = new TempConstructor();
      childConstructor.prototype.constructor = childConstructor;
      return childConstructor;
    };
    SpotifyApi.prototype._patchRequestOpen = function () {
      var open = XMLHttpRequest.prototype.open;
      var link = document.createElement('a');
      var location = window.location;
      XMLHttpRequest.prototype.open = function (method, url) {
        var result = open.apply(this, arguments);
        link.href = url;
        if (link.protocol == ':' && !link.hostname || link.protocol == location.protocol && link.hostname == location.hostname) {
          this.setRequestHeader('X-Spotify-Requested-With', 'XMLHttpRequest');
        }
        return result;
      };
    };
    SpotifyApi.prototype.resolvePath = function (path) {
      return path;
    };
    function require(modules, callback) {
      return SpotifyApi.api._require('__main__', {
        callback: function () {
        },
        waiting: 1 / 0
      }, [], modules, callback);
    }
    spotify.require = require;
    String;
    String.prototype.decodeForText = function () {
      return this.toString();
    };
    String.prototype.decodeForHtml = function () {
      var e = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;'
      };
      var r = function (c) {
        return e[c];
      };
      return function () {
        return this.replace(/[&<>]/g, r);
      };
    }();
    String.prototype.decodeForLink = function () {
      return encodeURI(this);
    };
    SpotifyApi.Bases = {
      uri: 'spotify',
      url: 'http://open.spotify.com'
    };
    SpotifyApi.Exps = {
      spotify: /^spotify:(.+)$/,
      http: /^https?:\/\/(play|open)\.spotify\.com\/(.+)$/
    };
    String.prototype.toSpotifyURL = function () {
      var matches = this.match(SpotifyApi.Exps.spotify);
      if (!matches)
        return this;
      var parts = matches.pop().replace(/:$/, '').split(/:/);
      var type = parts.shift();
      if (type == 'search')
        parts = [parts.join(':')];
      parts.unshift(SpotifyApi.Bases.url, type);
      return parts.join('/');
    };
    String.prototype.toSpotifyURI = function () {
      var matches = this.match(SpotifyApi.Exps.http);
      if (!matches)
        return this;
      var parts = matches.pop().replace(/\/$/, '').split(/\//);
      parts.unshift(SpotifyApi.Bases.uri);
      return parts.join(':');
    };
    String.prototype.toSpotifyLink = function () {
      return this.toSpotifyURI();
    };
    module.exports = SpotifyApi;
  },
  'node_modules/api/scripts/core.desktop.js': function (require, module, exports, global, __filename, __dirname) {
    (function () {
      SpotifyApi.prototype._throwError = true;
      var bridge = window._getSpotifyModule('bridge');
      var core;
      try {
        core = window._getSpotifyModule('core');
      } catch (err) {
      }
      if (core)
        SpotifyApi.prototype._createRequest = function (module, callback) {
          this.defer(this, function () {
            var code = core.readFile(module);
            if (undefined === code) {
              throw new Error('Could not load module "' + module + '"; Not found.');
            } else {
              callback(code);
            }
          });
        };
      SpotifyApi.prototype.request = function (name, args, caller, success, failed) {
        var contextId = this._getContextIdForRequest();
        var message = JSON.stringify({
          name: name,
          args: args,
          context: contextId
        });
        bridge.executeRequest(message, {
          onSuccess: function (data) {
            if (success) {
              success.call(caller, JSON.parse(data));
            }
          },
          onFailure: function (data) {
            data = JSON.parse(data);
            if (failed) {
              failed.call(caller, data);
            }
          }
        });
        this._prepareFlush(name);
      };
      SpotifyApi.api = new SpotifyApi();
      SpotifyApi.api.container = 'desktop';
    }());
  },
  'node_modules/api/scripts/core.browser.js': function (require, module, exports, global, __filename, __dirname) {
    (function () {
      var uid = 0;
      var callbacks = {};
      SpotifyApi.prototype._throwError = true;
      SpotifyApi.prototype._useLoadingTimeout = true;
      var manifest = window.manifest;
      var appVendor = manifest && manifest.VendorIdentifier || 'unknown';
      var appVersion = manifest && manifest.BundleVersion || '';
      if (!appVersion.match(/^\d+\.\d+\.\d+$/)) {
        appVersion = '0.0.0';
      }
      var deps = window.dependencies;
      var staticDeps = deps['static'];
      var rootDepsBare = staticDeps.replace(/\/([^\/]*)$/, '');
      var rootDeps = rootDepsBare + '/';
      var preferredLocales = ['en.loc'];
      var localeStringMatch = window.location.search.match(/locale=([^&]+)/);
      if (localeStringMatch) {
        preferredLocales = localeStringMatch.pop().split(',');
        var len = preferredLocales.length;
        while (len--) {
          var preferredLocale = preferredLocales[len];
          preferredLocales[len] = preferredLocale.indexOf('.loc') != -1 ? preferredLocale : preferredLocale + '.loc';
        }
      }
      var locale;
      var localeFilesAvailable = {};
      var defaultLocale = 'en';
      if (deps.locale && !Array.isArray(deps.locale)) {
        var locales = deps.locale;
        for (var localeName in locales) {
          locale = locales[localeName];
          localeName = localeName + '.loc';
          for (var i = 0, l = locale.length; i < l; i++) {
            localeFilesAvailable[localeName + '/' + locale[i]] = true;
          }
          localeFilesAvailable[localeName + '/scripts/momentLang.js'] = true;
        }
        for (var x = 0, y = preferredLocales.length; x < y; x++) {
          locale = preferredLocales[x].replace('.loc', '');
          if (deps.locale[locale] && deps.locale[locale].length) {
            defaultLocale = locale;
            break;
          }
        }
      }
      if (window.manifest && Array.isArray(manifest.SupportedLanguages)) {
        var supportedLanguages = manifest.SupportedLanguages;
        for (var m = 0, n = preferredLocales.length; m < n; m++) {
          locale = preferredLocales[m].replace('.loc', '');
          var index = supportedLanguages.indexOf(locale);
          if (index != -1) {
            defaultLocale = locale;
            break;
          }
        }
      }
      var resolve = SpotifyApi.prototype._resolveModule;
      SpotifyApi.prototype._resolveModule = function (module) {
        var result = resolve(module);
        var match = result.match(/^\$([a-z\-\_]+)(\/.*)/);
        var framework = false, path, leadingSlash = false;
        if (match) {
          framework = match[1];
          path = match[2];
        } else if (/^\//.exec(result)) {
          leadingSlash = true;
        }
        var lang = false;
        if (/\.lang$/.exec(result) || /momentLang\.js$/.exec(result)) {
          if (framework) {
            lang = preferredLocales[0];
            result = '$' + framework + '/' + (path = '/' + lang + path);
          } else {
            result = /^\//.test(result) ? result : '/' + result;
            var file = '';
            for (var i = 0, l = preferredLocales.length; i < l; i++) {
              lang = preferredLocales[i];
              file = lang + result;
              if (localeFilesAvailable[file])
                break;
            }
            result = (leadingSlash ? '/' : '') + file;
          }
        }
        if (framework && deps[framework]) {
          result = deps[framework] + path;
        } else {
          if (framework)
            result = '/' + framework + path;
          else if (!leadingSlash)
            result = '/' + result;
          result = (framework ? rootDepsBare : staticDeps) + result;
        }
        return result;
      };
      var MutationObserver = window.MutationObserver || window.WebKitMutationObserver;
      if (MutationObserver) {
        var observer = new MutationObserver(function (mutations) {
          for (var j = 0, m = mutations.length; j < m; j++) {
            var mutation = mutations[j];
            var links = mutation.addedNodes;
            if (!links.length)
              return this;
            var matcher = staticDeps + '/$';
            for (var i = 0, l = links.length; i < l; i++) {
              var link = links[i];
              if (link.tagName.toLowerCase() != 'link' || !/^\$/.test(link.getAttribute('href')))
                continue;
              var href = link.href;
              link.href = href.replace(matcher, rootDeps);
            }
          }
        });
        observer.observe(document.head, { childList: true });
      } else {
        var listenSubtree = function (event) {
          if (event.target !== document.head)
            return;
          var links = document.head.querySelectorAll('link[href^="$"]');
          var matcher = staticDeps + '/$';
          for (var i = 0, l = links.length; i < l; i++) {
            var link = links[i];
            if (!/^\$/.test(link.getAttribute('href')))
              continue;
            var href = link.href;
            link.href = href.replace(matcher, rootDeps);
          }
        };
        document.head.addEventListener('DOMSubtreeModified', listenSubtree);
      }
      if ('XDomainRequest' in window) {
        var createXHR = SpotifyApi.prototype._createRequest;
        SpotifyApi.prototype._createRequest = function (module, callback) {
          if (!/^http/.test(module))
            return createXHR(module, callback);
          var request = new XDomainRequest();
          request.onprogress = function () {
          };
          request.onerror = function () {
            throw new Error('Could not load module "' + module + '"; Not found.');
          };
          request.onload = function () {
            callback(request.responseText);
          };
          request.open('GET', module);
          request.send(null);
        };
      }
      var sendDependencies = { hermes_register_schema: 1 };
      SpotifyApi.prototype.request = function (name, args, caller, success, failed) {
        var top = window.top;
        if (top === window)
          return this;
        var data = {
          type: 'bridge_request',
          id: uid++,
          name: name,
          args: args,
          appVendor: appVendor,
          appVersion: appVersion
        };
        if (sendDependencies[name])
          data.deps = deps;
        if (name == 'session_query') {
          var oldSuccess = success;
          success = function (payload) {
            if (payload) {
              payload.language = defaultLocale;
            }
            return oldSuccess.call(this, payload);
          };
        }
        top.postMessage(JSON.stringify(data), '*');
        if (!success)
          return this;
        callbacks[data.id] = {
          success: success,
          failed: failed,
          caller: caller
        };
        this._prepareFlush(name);
      };
      SpotifyApi.prototype._requestReply = function (e) {
        var data = e.data;
        if (typeof data == 'string') {
          try {
            data = JSON.parse(data);
          } catch (e) {
            return this;
          }
        }
        var callback = callbacks[data.id];
        if (!callback)
          return this;
        if (data.success && callback.success)
          callback.success.call(callback.caller, data.payload);
        else if (!data.success && callback.failed)
          callback.failed.call(callback.caller, data.payload);
      };
      SpotifyApi.prototype.resolvePath = function (path) {
        var dummyExtension = '._resolve_';
        var resolvedPath = this._resolveModule(path + dummyExtension);
        var originalSplit = path.split('.');
        if (originalSplit.length > 1) {
          var extension = originalSplit[originalSplit.length - 1];
          if (extension !== 'js') {
            resolvedPath = resolvedPath.replace('scripts/', '');
          }
          var jsExtension = '.js';
          resolvedPath = resolvedPath.slice(0, -(dummyExtension.length + jsExtension.length));
        } else {
          resolvedPath = resolvedPath.replace(dummyExtension, '');
        }
        return resolvedPath;
      };
      SpotifyApi.api = new SpotifyApi();
      SpotifyApi.api.container = 'web';
      window.addEventListener('message', SpotifyApi.api._requestReply, false);
      SpotifyApi.Bases.url = 'https://play.spotify.com';
      String.prototype.toSpotifyLink = function () {
        return this.toSpotifyURL();
      };
      document.documentElement.addEventListener('click', function (e) {
        var target = e.target;
        do {
          if (target.nodeName.toLowerCase() === 'a') {
            break;
          }
        } while ((target = target.parentNode) && target !== document.body);
        if (!target || target === document.body)
          return;
        var href = target.href;
        var uri = null;
        if (SpotifyApi.Exps.http.test(href)) {
          uri = href.toSpotifyURI();
        } else if (SpotifyApi.Exps.spotify.test(href)) {
          uri = href;
        }
        if (!uri)
          return;
        if (e.defaultPrevented)
          return;
        e.preventDefault();
        SpotifyApi.api.request('application_open_uri', [
          uri,
          null
        ]);
      });
      var slice = Array.prototype.slice;
      if (!Array.prototype.indexOf) {
        Array.prototype.indexOf = function (item, from) {
          var length = this.length >>> 0;
          for (var i = from < 0 ? Math.max(0, length + from) : from || 0; i < length; i++) {
            if (this[i] === item)
              return i;
          }
          return -1;
        };
      }
      if (!String.prototype.trim) {
        String.prototype.trim = function () {
          return String(this).replace(/^\s+|\s+$/g, '');
        };
      }
      if (!Function.prototype.bind) {
        Function.prototype.bind = function (that) {
          var self = this, args = arguments.length > 1 ? slice.call(arguments, 1) : null, F = function () {
            };
          var bound = function () {
            var context = that, length = arguments.length;
            if (this instanceof bound) {
              F.prototype = self.prototype;
              context = new F();
            }
            var result = !args && !length ? self.call(context) : self.apply(context, args && length ? args.concat(slice.call(arguments)) : args || arguments);
            return context == that ? result : context;
          };
          return bound;
        };
      }
      (function () {
        if (!window.metadata)
          return;
        var appid = '[' + window.metadata.identifier + ' ' + window.metadata.version + ']';
        var console = window.console;
        var apply = Function.prototype.apply;
        var patch = [
          'debug',
          'error',
          'info',
          'log',
          'warn'
        ];
        if (!console)
          return;
        patch.forEach(function (p) {
          var origFunc = console[p];
          if (!origFunc)
            return;
          console[p] = function () {
            var args = slice.call(arguments);
            if (typeof args[0] === 'string') {
              args[0] = appid + ' ' + args[0];
            } else {
              args.unshift(appid);
            }
            return apply.call(origFunc, console, args);
          };
        });
      }());
      var kbd = {
        _modifiers: {},
        _keymap: {},
        _ignore: {},
        _bindings: {},
        _empty: function () {
        },
        init: function () {
          SpotifyApi.api.request('keyboard_get_bindings', [], this, function (directives) {
            for (var i in directives) {
              if (!directives.hasOwnProperty(i))
                continue;
              this[i] = directives[i];
            }
          }.bind(this), this._empty);
          window.addEventListener('keydown', this.handleOwn.bind(this, false));
          window.addEventListener('keyup', this.handleOwn.bind(this, true));
        },
        handleOwn: function (request, e) {
          var target = e.target;
          if (this._ignore[target.tagName.toLowerCase()])
            return this;
          var key = this._keymap[e.which || e.keyCode];
          if (!key)
            return this;
          var modifiers = this._modifiers;
          if (e.altKey)
            key |= modifiers.alt;
          if (e.metaKey)
            key |= modifiers.meta;
          if (e.ctrlKey)
            key |= modifiers.ctrl;
          if (e.shiftKey)
            key |= modifiers.shift;
          var binding = this._bindings[key];
          if (!binding)
            return this;
          e.preventDefault();
          e.stopPropagation();
          if (request)
            SpotifyApi.api.request('keyboard_trigger_binding', [binding], this, this._empty, this._empty);
        }
      };
      kbd.init();
    }());
  },
  'node_modules/quickstart-spotify/api-core.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    if (!window.SpotifyApi) {
      window.SpotifyApi = require('node_modules/api/scripts/core.js');
      if (window._getSpotifyModule)
        require('node_modules/api/scripts/core.desktop.js');
      else
        require('node_modules/api/scripts/core.browser.js');
    }
    window.SP = window.SpotifyApi.api;
  },
  'scripts/playlist-utils.js': function (require, module, exports, global, __filename, __dirname) {
    function _empty(node) {
      while (node.firstChild) {
        node.removeChild(node.firstChild);
      }
      return node;
    }
    function _hasClassList() {
      return 'classList' in document.createElement('a');
    }
    function _hasClass(ele, cls) {
      if (_hasClassList()) {
        return ele.classList.contains(cls);
      }
      return ele.className.match(new RegExp('(\\s|^)' + cls + '(\\s|$)'));
    }
    function _addClass(ele, cls) {
      if (!_hasClass(ele, cls)) {
        if (_hasClassList()) {
          ele.classList.add(cls);
        } else {
          ele.className += ' ' + cls;
        }
      }
    }
    function _removeClass(ele, cls) {
      if (_hasClass(ele, cls)) {
        if (_hasClassList()) {
          ele.classList.remove(cls);
        } else {
          var reg = new RegExp('(\\s|^)' + cls + '(\\s|$)');
          ele.className = ele.className.replace(reg, ' ');
        }
      }
    }
    function _inArray(needle, haystack) {
      var length = haystack.length;
      for (var i = 0; i < length; i++) {
        if (haystack[i] == needle)
          return true;
      }
      return false;
    }
    var Notifier = function () {
      var _method = 'log';
      var _name = 'Playlist notifier';
      var _active = false;
      var _output = function () {
        if (_active) {
          if (window.console && window.console[_method] && window.console[_method].apply) {
            window.console[_method].apply(console, [
              _name,
              arguments
            ]);
          }
        }
      };
      return {
        log: function () {
          _method = 'log';
          _output.apply(this, arguments);
        },
        info: function () {
          _method = 'info';
          _output.apply(this, arguments);
        },
        warn: function () {
          _method = 'warn';
          _output.apply(this, arguments);
        },
        error: function () {
          _method = 'error';
          _output.apply(this, arguments);
        },
        enable: function () {
          _active = true;
        },
        setName: function (name) {
          _name = name;
        }
      };
    }();
    exports.empty = _empty;
    exports.hasClass = _hasClass;
    exports.addClass = _addClass;
    exports.removeClass = _removeClass;
    exports.inArray = _inArray;
    exports.Notifier = Notifier;
  },
  'scripts/contextwidget.events.js': function (require, module, exports, global, __filename, __dirname) {
    function EventManager() {
      this.listeners = {};
    }
    EventManager.prototype.subscribe = function (event, callback, context) {
      if (this.listeners[event] === undefined) {
        this.listeners[event] = [];
      }
      this.listeners[event].push([
        callback,
        context || null
      ]);
    };
    EventManager.prototype.unsubscribe = function (event, callback) {
      if (this.listeners[event] === undefined) {
        return;
      }
      var count = this.listeners[event].length;
      for (var i = 0; i < count; i++) {
        if (this.listeners[event][i][0] === callback) {
          this.listeners[event].splice(i, 1);
          break;
        }
      }
    };
    EventManager.prototype.trigger = function (event, data) {
      if (this.listeners[event] === undefined) {
        return;
      }
      var count = this.listeners[event].length;
      for (var i = 0; i < count; i++) {
        var func = this.listeners[event][i][0];
        var context = this.listeners[event][i][1] || this;
        func.call(context, data || {});
      }
    };
    EventManager.prototype.Events = function () {
      return {
        ACTIVATE_VIEW: 'ACTIVATE_VIEW',
        ADD_CONTEXT_TO_PLAYLIST: 'ADD_CONTEXT_TO_PLAYLIST',
        CONTEXT_ADDED: 'CONTEXT_ADDED',
        CLOSE: 'CLOSE',
        PLAYLISTS_LOADED: 'PLAYLISTS_LOADED',
        PLAYLISTS_UPDATE: 'PLAYLISTS_UPDATE',
        PLAYLIST_CHANGE: 'PLAYLIST_CHANGE',
        LOADING_COMPLETE: 'LOADING_COMPLETE'
      };
    }();
    exports.EventManager = EventManager;
  },
  'scripts/contextwidget.scroller.js': function (require, module, exports, global, __filename, __dirname) {
    (function (utils) {
      function Scroller(el) {
        this._el = this._getWrapper(el);
        this._scrollbarHidden = false;
        this._init();
      }
      Scroller.prototype._getWrapper = function (el) {
        if (typeof el === 'string') {
          if (el.charAt(0) === '#') {
            return document.getElementById(el);
          } else if (el.charAt(0) === '.') {
            return document.querySelector(el);
          } else {
            throw new Error('please use an element, or id/class selector');
          }
        } else {
          return el;
        }
      };
      Scroller.prototype._init = function () {
        this._scrollPosition = this._scrollerAt = 0;
        this._build();
        this._bindEvents();
        this._setDimensions();
      };
      Scroller.prototype._build = function () {
        this._scrollbar = document.createElement('div');
        this._scrollbar.className = 'scrollbar';
        this._scrollDragArea = document.createElement('div');
        this._scrollDragArea.className = 'scroller-drag-area';
        this._scroller = document.createElement('div');
        this._scroller.className = 'scroller';
        this._innerPane = document.getElementById('playlist-list');
        this._scroller.appendChild(this._scrollDragArea);
        this._scrollbar.appendChild(this._scroller);
        this._el.appendChild(this._scrollbar);
        this._scrollbarHeight = this._scrollbar.offsetHeight;
      };
      Scroller.prototype._setDimensions = function () {
        this._elHeight = this._el.offsetHeight;
        this._contentHeight = this._innerPane.offsetHeight;
        this._scrollMax = this._elHeight - this._contentHeight;
        var visibleRatio = this._elHeight / this._contentHeight;
        var newScrollerHeight = this._scrollbarHeight * visibleRatio;
        if (newScrollerHeight < 20) {
          newScrollerHeight = 20;
        }
        this._scroller.style.height = newScrollerHeight + 'px';
        this._scrollerSpace = this._scrollbarHeight - newScrollerHeight;
        if (this._contentHeight < this._elHeight) {
          this._hideBar();
        } else {
          this._showBar();
        }
      };
      Scroller.prototype._hideBar = function () {
        this._scrollbar.style.display = 'none';
        this._scrollbarHidden = true;
      };
      Scroller.prototype._showBar = function () {
        this._scrollbar.style.display = 'block';
        this._scrollbarHidden = false;
      };
      Scroller.prototype._onMouseWheel = function (e) {
        if (!this._scrollbarHidden) {
          e.preventDefault();
          var deltaY = 0;
          if (e.wheelDeltaY) {
            deltaY = e.wheelDeltaY / 3;
          } else if (e.detail) {
            deltaY = -e.detail * 3;
          } else if (e.wheelDelta) {
            deltaY = e.wheelDelta / 3;
          }
          this._scrollPosition += deltaY;
          this._doScroll();
        }
      };
      Scroller.prototype._doScroll = function () {
        if (this._scrollPosition > 1) {
          this._scrollPosition = 1;
        }
        if (this._scrollPosition < this._scrollMax) {
          this._scrollPosition = this._scrollMax;
        }
        this._innerPane.style.top = this._scrollPosition + 'px';
        this._setScrollerPosition();
        var el = this._el;
        utils.addClass(el, 'scrolling');
        this.scrollingTimeout = setTimeout(function () {
          utils.removeClass(el, 'scrolling');
        }, 1000);
      };
      Scroller.prototype._setScrollerPosition = function () {
        var percentageScrolled = Math.round(this._scrollPosition / this._scrollMax * 100);
        if (percentageScrolled > 100) {
          percentageScrolled = 100;
        }
        this._scrollerAt = this._scrollerSpace / 100 * percentageScrolled;
        this._scroller.style.top = this._scrollerAt + 'px';
      };
      Scroller.prototype._bindEvents = function () {
        var self = this;
        this._el.addEventListener('mousewheel', function (e) {
          self._onMouseWheel(e);
        }, false);
        this._el.addEventListener('DOMMouseScroll', function (e) {
          self._onMouseWheel(e);
        }, false);
        this._scroller.addEventListener('mousedown', function (e) {
          self._startDragScroller(e);
        }, false);
        this._scrollbar.addEventListener('mousedown', function (e) {
          if (e.target === self._scrollDragArea) {
            return false;
          }
          self._handleBarClick(e);
        }, false);
      };
      Scroller.prototype._startDragScroller = function (e) {
        e.preventDefault();
        this._startY = this._scroller.offsetTop;
        this._initialMouseY = e.clientY;
        var self = this;
        this.listener = function (ev) {
          self._doMoveMouse(ev);
        };
        window.addEventListener('mousemove', this.listener, false);
        window.addEventListener('mouseup', self._endMoveMouse.bind(this), false);
        document.addEventListener('mouseout', self._mouseOutWindow.bind(this), false);
        utils.addClass(el, 'dragging');
      };
      Scroller.prototype._mouseOutWindow = function (e) {
        e = e ? e : window.event;
        var from = e.relatedTarget || e.toElement;
        if (!from || from.nodeName == 'HTML') {
          window.removeEventListener('mousemove', this.listener, false);
          utils.removeClass(el, 'dragging');
        }
      };
      Scroller.prototype._doMoveMouse = function (e) {
        e = e ? e : window.event;
        var dY = e.clientY - this._initialMouseY;
        this._scrollerAt = dY + this._startY;
        var percentageScrolled = this._scrollerAt / this._scrollerSpace * 100;
        this._setMainScrollPercent(percentageScrolled);
      };
      Scroller.prototype._endMoveMouse = function (e) {
        window.removeEventListener('mousemove', this.listener, false);
        utils.removeClass(el, 'dragging');
      };
      Scroller.prototype.jumpToPx = function (px) {
        this._scrollPosition = -px;
        this._innerPane.style.top = this._scrollPosition + 'px';
        this._setScrollerPosition();
      };
      Scroller.prototype._handleBarClick = function (e) {
        e.preventDefault();
        if (e.target !== this._scroller) {
          var clickedPos = e.layerY || e.offsetY;
          clickedPos -= this._scroller.offsetHeight / 2;
          var percentageScrolled = clickedPos / this._scrollerSpace * 100;
          this._setMainScrollPercent(percentageScrolled);
          this._startDragScroller(e);
        }
      };
      Scroller.prototype._setMainScrollPercent = function (percent) {
        this._scrollPosition = -1 * (Math.abs(this._scrollMax) / 100 * percent);
        this._doScroll();
      };
      Scroller.prototype.resize = function () {
        this._setDimensions();
      };
      exports.Scroller = Scroller;
    }(require('scripts/playlist-utils.js')));
  },
  'supported-languages.json': function (require, module, exports, global, __filename, __dirname) {
    module.exports = [
      'arb',
      'de',
      'en',
      'el',
      'es',
      'es-419',
      'fr',
      'fr-ca',
      'fi',
      'hu',
      'id',
      'it',
      'ja',
      'nl',
      'pl',
      'pt-br',
      'ru',
      'sv',
      'th',
      'tr',
      'zh-hant',
      'zsm'
    ];
  },
  'node_modules/escape-html/index.js': function (require, module, exports, global, __filename, __dirname) {
    module.exports = function (html) {
      return String(html).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };
  },
  'node_modules/api/supported-languages.json': function (require, module, exports, global, __filename, __dirname) {
    module.exports = [
      'arb',
      'de',
      'el',
      'en',
      'es',
      'es-la',
      'es-419',
      'fi',
      'fr',
      'hu',
      'id',
      'it',
      'ja',
      'nl',
      'pl',
      'pt-br',
      'ro',
      'ru',
      'sv',
      'th',
      'tr',
      'zh-hant',
      'zsm'
    ];
  },
  'arb.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('arb.loc/strings/main.lang', {
      'add-to-collection': 'Add to collection',
      'remove-from-collection': 'Remove from collection',
      'save': 'Save',
      'remove': 'Remove',
      'loading-collection-status': 'Loading...',
      'starred': 'Starred',
      'star': 'Star',
      'unstar': 'Unstar',
      'add-to': 'Add to\u2026',
      'share': 'Share\u2026',
      'start-radio': 'Start Radio',
      'copy-url': 'Copy Spotify URL',
      'play-next': 'Play Next',
      'play-next-remove': 'Remove From \'Up Next\'',
      'play-next-clear': 'Clear \'Up Next\'',
      'queue-add': 'Add to Play Queue',
      'queue-remove': 'Remove from Play Queue',
      'delete': 'Delete',
      'cancel': 'Cancel',
      'delete-playlist': 'Delete Playlist?',
      'delete-playlist-confirmation': 'Do you really want to delete the playlist <a href=\'{1}\'>{0}</a>?',
      'new-playlist': 'New playlist',
      'name': 'Name',
      'create-playlist': 'Create Playlist',
      'following': 'Following',
      'follow': 'Follow',
      'unfollow': 'Unfollow',
      'publish': 'Make public',
      'unpublish': 'Make secret',
      'play': 'Play',
      'play-track': 'Play track',
      'play-artist': 'Play artist',
      'play-album': 'Play album',
      'play-playlist': 'Play playlist',
      'rename': 'Rename',
      'rename-playlist': 'Rename playlist'
    });
  },
  'de.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('de.loc/strings/main.lang', {
      'add-to-collection': 'Zur Sammlung hinzuf\xFCgen',
      'remove-from-collection': 'Aus der Sammlung entfernen',
      'save': 'Speichern',
      'remove': 'Entfernen',
      'loading-collection-status': 'Laden\u2026',
      'starred': 'Starred',
      'star': 'Star',
      'unstar': 'Unstar',
      'add-to': 'Hinzuf\xFCgen zu...',
      'share': 'Teilen\u2026',
      'start-radio': 'Radio starten',
      'copy-url': 'Spotify URL kopieren',
      'play-next': 'Als n\xE4chstes abspielen',
      'play-next-remove': 'Von Warteschlange entfernen',
      'play-next-clear': 'Warteschlange leeren',
      'queue-add': 'Zu Warteschlange hinzuf\xFCgen',
      'queue-remove': 'Aus Warteschlange entfernen',
      'delete': 'L\xF6schen',
      'cancel': 'Abbrechen',
      'delete-playlist': 'Playlist l\xF6schen?',
      'delete-playlist-confirmation': 'Willst du die Playlist <a href=\'{1}\'>{0}</a> wirklich l\xF6schen?',
      'new-playlist': 'Neue Playlist',
      'name': 'Name',
      'create-playlist': 'Playlist erstellen',
      'following': 'Folge ich',
      'follow': 'Folgen',
      'unfollow': 'Nicht folgen',
      'publish': 'Ver\xF6ffentlichen',
      'unpublish': 'Geheim halten',
      'play': 'Play',
      'play-track': 'Titel abspielen',
      'play-artist': 'K\xFCnstler abspielen',
      'play-album': 'Album abspielen',
      'play-playlist': 'Playlist abspielen',
      'rename': 'Umbenennen',
      'rename-playlist': 'Playlist umbenennen'
    });
  },
  'en.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('en.loc/strings/main.lang', {
      'add-to-collection': 'Add to collection',
      'remove-from-collection': 'Remove from collection',
      'save': 'Save',
      'remove': 'Remove',
      'loading-collection-status': 'Loading...',
      'starred': 'Starred',
      'star': 'Star',
      'unstar': 'Unstar',
      'add-to': 'Add to\u2026',
      'share': 'Share\u2026',
      'start-radio': 'Start Radio',
      'copy-url': 'Copy Spotify URL',
      'play-next': 'Play Next',
      'play-next-remove': 'Remove From \'Up Next\'',
      'play-next-clear': 'Clear \'Up Next\'',
      'queue-add': 'Add to Play Queue',
      'queue-remove': 'Remove from Play Queue',
      'delete': 'Delete',
      'cancel': 'Cancel',
      'delete-playlist': 'Delete Playlist?',
      'delete-playlist-confirmation': 'Do you really want to delete the playlist <a href=\'{1}\'>{0}</a>?',
      'new-playlist': 'New playlist',
      'name': 'Name',
      'create-playlist': 'Create Playlist',
      'following': 'Following',
      'follow': 'Follow',
      'unfollow': 'Unfollow',
      'publish': 'Make public',
      'unpublish': 'Make secret',
      'play': 'Play',
      'play-track': 'Play track',
      'play-artist': 'Play artist',
      'play-album': 'Play album',
      'play-playlist': 'Play playlist',
      'rename': 'Rename',
      'rename-playlist': 'Rename playlist'
    });
  },
  'el.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('el.loc/strings/main.lang', {
      'add-to-collection': '\u03A0\u03C1\u03BF\u03C3\u03B8\u03AE\u03BA\u03B7 \u03C3\u03C4\u03B7 \u03C3\u03C5\u03BB\u03BB\u03BF\u03B3\u03AE',
      'remove-from-collection': '\u0391\u03C6\u03B1\u03AF\u03C1\u03B5\u03C3\u03B7 \u03B1\u03C0\u03CC \u03C4\u03B7 \u03C3\u03C5\u03BB\u03BB\u03BF\u03B3\u03AE',
      'save': '\u0391\u03C0\u03BF\u03B8\u03AE\u03BA\u03B5\u03C5\u03C3\u03B7',
      'remove': '\u0391\u03C6\u03B1\u03AF\u03C1\u03B5\u03C3\u03B7',
      'loading-collection-status': '\u03A6\u03CC\u03C1\u03C4\u03C9\u03C3\u03B7...',
      'starred': '\u0391\u03B3\u03B1\u03C0\u03B7\u03BC\u03AD\u03BD\u03B1',
      'star': '\u03A0\u03C1\u03BF\u03C3\u03B8\u03AE\u03BA\u03B7 \u03C3\u03C4\u03B1 \u03B1\u03B3\u03B1\u03C0\u03B7\u03BC\u03AD\u03BD\u03B1',
      'unstar': '\u0391\u03C6\u03B1\u03AF\u03C1\u03B5\u03C3\u03B7 \u03B1\u03C0\u03CC \u03C4\u03B1 \u03B1\u03B3\u03B1\u03C0\u03B7\u03BC\u03AD\u03BD\u03B1',
      'add-to': '\u03A0\u03C1\u03BF\u03C3\u03B8\u03AE\u03BA\u03B7 \u03C3\u03B5\u2026',
      'share': '\u039A\u03BF\u03B9\u03BD\u03BF\u03C0\u03BF\u03AF\u03B7\u03C3\u03B7\u2026',
      'start-radio': '\u0388\u03BD\u03B1\u03C1\u03BE\u03B7 \u03C1\u03B1\u03B4\u03B9\u03BF\u03C6\u03CE\u03BD\u03BF\u03C5',
      'copy-url': '\u0391\u03BD\u03C4\u03B9\u03B3\u03C1\u03B1\u03C6\u03AE \u03B4\u03B9\u03B5\u03CD\u03B8\u03C5\u03BD\u03C3\u03B7\u03C2 URL \u03C4\u03BF\u03C5 Spotify',
      'play-next': '\u0391\u03BD\u03B1\u03C0\u03B1\u03C1\u03B1\u03B3\u03C9\u03B3\u03AE \u03B5\u03C0\u03CC\u03BC\u03B5\u03BD\u03BF\u03C5',
      'play-next-remove': '\u0391\u03C6\u03B1\u03AF\u03C1\u03B5\u03C3\u03B7 \u03B1\u03C0\u03CC \u03C4\u03BF \xAB\u0391\u03BA\u03BF\u03BB\u03BF\u03C5\u03B8\u03B5\u03AF\xBB',
      'play-next-clear': '\u0391\u03C0\u03B1\u03BB\u03BF\u03B9\u03C6\u03AE \u03B1\u03C0\u03CC \u03C4\u03BF \xAB\u0391\u03BA\u03BF\u03BB\u03BF\u03C5\u03B8\u03B5\u03AF\xBB',
      'queue-add': '\u03A0\u03C1\u03BF\u03C3\u03B8\u03AE\u03BA\u03B7 \u03C3\u03C4\u03B7\u03BD \u039F\u03C5\u03C1\u03AC \u03B1\u03BD\u03B1\u03C0\u03B1\u03C1\u03B1\u03B3\u03C9\u03B3\u03AE\u03C2',
      'queue-remove': '\u0391\u03C6\u03B1\u03AF\u03C1\u03B5\u03C3\u03B7 \u03B1\u03C0\u03CC \u03C4\u03B7\u03BD \u039F\u03C5\u03C1\u03AC \u03B1\u03BD\u03B1\u03C0\u03B1\u03C1\u03B1\u03B3\u03C9\u03B3\u03AE\u03C2',
      'delete': '\u0394\u03B9\u03B1\u03B3\u03C1\u03B1\u03C6\u03AE',
      'cancel': '\u0386\u03BA\u03C5\u03C1\u03BF',
      'delete-playlist': '\u0394\u03B9\u03B1\u03B3\u03C1\u03B1\u03C6\u03AE \u03BB\u03AF\u03C3\u03C4\u03B1\u03C2;',
      'delete-playlist-confirmation': '\u0398\u03AD\u03BB\u03B5\u03B9\u03C2 \u03C0\u03C1\u03B1\u03B3\u03BC\u03B1\u03C4\u03B9\u03BA\u03AC \u03BD\u03B1 \u03B4\u03B9\u03B1\u03B3\u03C1\u03AC\u03C8\u03B5\u03B9\u03C2 \u03C4\u03B7 \u03BB\u03AF\u03C3\u03C4\u03B1 <a href=\'{1}\'>{0}</a>;',
      'new-playlist': '\u039D\u03AD\u03B1 \u03BB\u03AF\u03C3\u03C4\u03B1',
      'name': '\u038C\u03BD\u03BF\u03BC\u03B1',
      'create-playlist': '\u0394\u03B7\u03BC\u03B9\u03BF\u03C5\u03C1\u03B3\u03AF\u03B1 \u03BB\u03AF\u03C3\u03C4\u03B1\u03C2',
      'following': '\u0386\u03C4\u03BF\u03BC\u03B1 \u03C0\u03BF\u03C5 \u03B1\u03BA\u03BF\u03BB\u03BF\u03C5\u03B8\u03BF\u03CD\u03BD\u03C4\u03B1\u03B9',
      'follow': '\u0391\u03BA\u03BF\u03BB\u03BF\u03CD\u03B8\u03B7\u03C3\u03B5',
      'unfollow': '\u0386\u03C1\u03C3\u03B7 \u03B1\u03BA\u03BF\u03BB\u03BF\u03CD\u03B8\u03B7\u03C3\u03B7\u03C2',
      'publish': '\u039D\u03B1 \u03B3\u03AF\u03BD\u03B5\u03B9 \u03B4\u03B7\u03BC\u03CC\u03C3\u03B9\u03BF',
      'unpublish': '\u039D\u03B1 \u03B3\u03AF\u03BD\u03B5\u03B9 \u03BC\u03C5\u03C3\u03C4\u03B9\u03BA\u03CC',
      'play': 'Play',
      'play-track': '\u0391\u03BD\u03B1\u03C0\u03B1\u03C1\u03B1\u03B3\u03C9\u03B3\u03AE \u03BA\u03BF\u03BC\u03BC\u03B1\u03C4\u03B9\u03BF\u03CD',
      'play-artist': '\u0391\u03BD\u03B1\u03C0\u03B1\u03C1\u03B1\u03B3\u03C9\u03B3\u03AE \u03BA\u03B1\u03BB\u03BB\u03B9\u03C4\u03AD\u03C7\u03BD\u03B7',
      'play-album': '\u0391\u03BD\u03B1\u03C0\u03B1\u03C1\u03B1\u03B3\u03C9\u03B3\u03AE \u03AC\u03BB\u03BC\u03C0\u03BF\u03C5\u03BC',
      'play-playlist': '\u0391\u03BD\u03B1\u03C0\u03B1\u03C1\u03B1\u03B3\u03C9\u03B3\u03AE \u03BB\u03AF\u03C3\u03C4\u03B1\u03C2',
      'rename': '\u039C\u03B5\u03C4\u03BF\u03BD\u03BF\u03BC\u03B1\u03C3\u03AF\u03B1',
      'rename-playlist': '\u039C\u03B5\u03C4\u03BF\u03BD\u03BF\u03BC\u03B1\u03C3\u03AF\u03B1 \u03BB\u03AF\u03C3\u03C4\u03B1\u03C2'
    });
  },
  'es.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('es.loc/strings/main.lang', {
      'add-to-collection': 'A\xF1adir a la colecci\xF3n',
      'remove-from-collection': 'Retirar de la colecci\xF3n',
      'save': 'Guardar',
      'remove': 'Eliminar',
      'loading-collection-status': 'Cargando...',
      'starred': 'Favoritos',
      'star': 'A\xF1adir a favoritos',
      'unstar': 'Quitar favorita',
      'add-to': 'A\xF1adir a\u2026',
      'share': 'Compartir\u2026',
      'start-radio': 'Iniciar radio',
      'copy-url': 'Copiar URL de Spotify',
      'play-next': 'Reproducir a continuaci\xF3n',
      'play-next-remove': 'Retirar de "Siguientes"',
      'play-next-clear': 'Borrar "Siguientes"',
      'queue-add': 'A\xF1adir a la cola de reproducci\xF3n',
      'queue-remove': 'Retirar de la cola de reproducci\xF3n',
      'delete': 'Borrar',
      'cancel': 'Cancelar',
      'delete-playlist': '\xBFEliminar la playlist?',
      'delete-playlist-confirmation': '\xBFSeguro que quieres eliminar la playlist <a href=\'{1}\'>{0}</a>?',
      'new-playlist': 'Nueva playlist',
      'name': 'Nombre',
      'create-playlist': 'Crear playlist',
      'following': 'Siguiendo',
      'follow': 'Seguir',
      'unfollow': 'No seguir',
      'publish': 'Hacer p\xFAblica',
      'unpublish': 'Hacer secreta',
      'play': 'Reproducir',
      'play-track': 'Reproducir canci\xF3n',
      'play-artist': 'Reproducir artista',
      'play-album': 'Reproducir \xE1lbum',
      'play-playlist': 'Reproducir playlist',
      'rename': 'Cambiar nombre',
      'rename-playlist': 'Cambiar nombre de playlist'
    });
  },
  'es-419.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('es-419.loc/strings/main.lang', {
      'add-to-collection': 'Agregar a la colecci\xF3n',
      'remove-from-collection': 'Retirar de la colecci\xF3n',
      'save': 'Guardar',
      'remove': 'Eliminar',
      'loading-collection-status': 'Cargando...',
      'starred': 'Seleccionadas',
      'star': 'Destacar',
      'unstar': 'No destacar',
      'add-to': 'Agregar a\u2026',
      'share': 'Compartir\u2026',
      'start-radio': 'Iniciar radio',
      'copy-url': 'Copiar URL de Spotify',
      'play-next': 'Reproducir a continuaci\xF3n',
      'play-next-remove': 'Retirar de "Siguientes"',
      'play-next-clear': 'Borrar "Siguientes"',
      'queue-add': 'Agregar a cola de reproducci\xF3n',
      'queue-remove': 'Eliminar de la cola de reproducci\xF3n',
      'delete': 'Borrar',
      'cancel': 'Cancelar',
      'delete-playlist': '\xBFEliminar playlist?',
      'delete-playlist-confirmation': '\xBFDe verdad quieres eliminar la playlist <a href=\'{1}\'>{0}</a>?',
      'new-playlist': 'Nueva playlist',
      'name': 'Nombre',
      'create-playlist': 'Crear playlist',
      'following': 'Siguiendo',
      'follow': 'Seguir',
      'unfollow': 'No seguir',
      'publish': 'Hacer p\xFAblica',
      'unpublish': 'Hacer privada',
      'play': 'Reproducir',
      'play-track': 'Reproducir canci\xF3n',
      'play-artist': 'Reproducir artista',
      'play-album': 'Reproducir \xE1lbum',
      'play-playlist': 'Reproducir playlist',
      'rename': 'Cambiar nombre',
      'rename-playlist': 'Cambiar nombre de playlist'
    });
  },
  'fr.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('fr.loc/strings/main.lang', {
      'add-to-collection': 'Ajouter \xE0 la collection',
      'remove-from-collection': 'Supprimer de la collection',
      'save': 'Enregistrer',
      'remove': 'Supprimer',
      'loading-collection-status': 'Chargement...',
      'starred': 'S\xE9lection',
      'star': 'S\xE9lectionner',
      'unstar': 'D\xE9s\xE9lectionner',
      'add-to': 'Ajouter \xE0...',
      'share': 'Partager...',
      'start-radio': 'Lancer la radio',
      'copy-url': 'Copier l\'URL Spotify',
      'play-next': 'Titre suivant',
      'play-next-remove': 'Supprimer de la file d\'attente',
      'play-next-clear': 'Effacer la file d\'attente',
      'queue-add': 'Ajouter \xE0 la file d\'attente de lecture',
      'queue-remove': 'Supprimer de la file d\'attente de lecture',
      'delete': 'Supprimer',
      'cancel': 'Annuler',
      'delete-playlist': 'Supprimer la playlist\xA0?',
      'delete-playlist-confirmation': 'Voulez-vous vraiment supprimer la playlist <a href=\'{1}\'>{0}</a>\xA0?',
      'new-playlist': 'Nouvelle playlist',
      'name': 'Nom',
      'create-playlist': 'Cr\xE9er une playlist',
      'following': 'Suivi',
      'follow': 'Suivre',
      'unfollow': 'Ne plus suivre',
      'publish': 'Publier',
      'unpublish': 'Cacher',
      'play': 'Lire',
      'play-track': '\xC9couter le titre',
      'play-artist': '\xC9couter l\'artiste',
      'play-album': '\xC9couter l\'album',
      'play-playlist': '\xC9couter la playlist',
      'rename': 'Renommer',
      'rename-playlist': 'Renommer la playlist'
    });
  },
  'fr-ca.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('fr-ca.loc/strings/main.lang', {
      'add-to-collection': 'Ajouter \xE0 la collection',
      'remove-from-collection': 'Supprimer de la collection',
      'save': 'Enregistrer',
      'remove': 'Supprimer',
      'loading-collection-status': 'Chargement...',
      'starred': 'S\xE9lection',
      'star': 'S\xE9lectionner',
      'unstar': 'D\xE9s\xE9lectionner',
      'add-to': 'Ajouter \xE0...',
      'share': 'Partager...',
      'start-radio': 'Lancer la radio',
      'copy-url': 'Copier l\'URL Spotify',
      'play-next': 'Piste suivante',
      'play-next-remove': 'Supprimer de la file d\'attente',
      'play-next-clear': 'Effacer la file d\'attente',
      'queue-add': 'Ajouter \xE0 la file d\'attente de lecture',
      'queue-remove': 'Supprimer de la file d\'attente de lecture',
      'delete': 'Supprimer',
      'cancel': 'Annuler',
      'delete-playlist': 'Supprimer la liste de lecture?',
      'delete-playlist-confirmation': 'Voulez-vraiment supprimer la liste de lecture <a href=\'{1}\'>{0}</a>?',
      'new-playlist': 'Nouvelle liste de lecture',
      'name': 'Nom',
      'create-playlist': 'Cr\xE9er une liste de lecture',
      'following': 'Abonnements',
      'follow': 'Suivre',
      'unfollow': 'Ne plus suivre',
      'publish': 'Publier',
      'unpublish': 'Cacher',
      'play': 'Lire',
      'play-track': 'Lire la piste',
      'play-artist': '\xC9couter l\'artiste',
      'play-album': 'Lire l\'album',
      'play-playlist': 'Lire la liste de lecture',
      'rename': 'Renommer',
      'rename-playlist': 'Renommer la liste de lecture'
    });
  },
  'fi.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('fi.loc/strings/main.lang', {
      'add-to-collection': 'Lis\xE4\xE4 kokoelmaan',
      'remove-from-collection': 'Poista kokoelmasta',
      'save': 'Tallenna',
      'remove': 'Poista',
      'loading-collection-status': 'Ladataan...',
      'starred': 'T\xE4hdell\xE4 merkityt',
      'star': 'Anna t\xE4hti',
      'unstar': 'Poista t\xE4hti',
      'add-to': 'Lis\xE4\xE4 kohteeseen...',
      'share': 'Jaa...',
      'start-radio': 'K\xE4ynnist\xE4 radio',
      'copy-url': 'Kopioi Spotify-URL',
      'play-next': 'Toista seuraava',
      'play-next-remove': 'Poista Tulossa-listasta',
      'play-next-clear': 'Tyhjenn\xE4 Tulossa-lista',
      'queue-add': 'Lis\xE4\xE4 toistojonoon',
      'queue-remove': 'Poista toistojonosta',
      'delete': 'Poista',
      'cancel': 'Peruuta',
      'delete-playlist': 'Poistetaanko soittolista?',
      'delete-playlist-confirmation': 'Haluatko varmasti poistaa soittolistan <a href=\'{1}\'>{0}</a>?',
      'new-playlist': 'Uusi soittolista',
      'name': 'Nimi',
      'create-playlist': 'Luo soittolista',
      'following': 'Seuratut',
      'follow': 'Seuraa',
      'unfollow': 'Lopeta seuraaminen',
      'publish': 'M\xE4\xE4rit\xE4 julkiseksi',
      'unpublish': 'M\xE4\xE4rit\xE4 salaiseksi',
      'play': 'Toista',
      'play-track': 'Toista kappale',
      'play-artist': 'Toista artisti',
      'play-album': 'Toista albumi',
      'play-playlist': 'Toista soittolista',
      'rename': 'Nime\xE4 uudelleen',
      'rename-playlist': 'Nime\xE4 soittolista uudelleen'
    });
  },
  'hu.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('hu.loc/strings/main.lang', {
      'add-to-collection': 'Hozz\xE1ad\xE1s a gy\u0171jtem\xE9nyhez',
      'remove-from-collection': 'Elt\xE1vol\xEDt\xE1s a gy\u0171jtem\xE9nyb\u0151l',
      'save': 'Ment\xE9s',
      'remove': 'Elt\xE1vol\xEDt\xE1s',
      'loading-collection-status': 'Bet\xF6lt\xE9s...',
      'starred': 'Kedvenc',
      'star': 'Kedvenc',
      'unstar': 'T\xF6rl\xE9s a kedvencek k\xF6z\xFCl',
      'add-to': 'Hozz\xE1ad\xE1s ehhez\u2026',
      'share': 'Megoszt\xE1s\u2026',
      'start-radio': 'R\xE1di\xF3 ind\xEDt\xE1sa',
      'copy-url': 'Spotify URL-c\xEDm m\xE1sol\xE1sa',
      'play-next': 'K\xF6vetkez\u0151 lej\xE1tsz\xE1sa',
      'play-next-remove': 'Elt\xE1vol\xEDt\xE1s a \u201ER\xF6gt\xF6n k\xF6vetkez\u0151k\u201D k\xF6z\xFCl',
      'play-next-clear': '\u201ER\xF6gt\xF6n k\xF6vetkez\u0151k\u201D t\xF6rl\xE9se',
      'queue-add': 'M\u0171sorra t\u0171z\xE9s',
      'queue-remove': 'T\xF6rl\xE9s a m\u0171sorb\xF3l',
      'delete': 'T\xF6rl\xE9s',
      'cancel': 'M\xE9gse',
      'delete-playlist': 'T\xF6rl\xF6d a lej\xE1tsz\xE1si list\xE1t?',
      'delete-playlist-confirmation': 'T\xE9nyleg t\xF6rl\xF6d ezt a lej\xE1tsz\xE1si list\xE1t: <a href=\'{1}\'>{0}</a>?',
      'new-playlist': '\xDAj lej\xE1tsz\xE1si lista',
      'name': 'N\xE9v',
      'create-playlist': 'Lej\xE1tsz\xE1si lista l\xE9trehoz\xE1sa',
      'following': 'K\xF6vet\xE9sek',
      'follow': 'K\xF6vet\xE9s',
      'unfollow': 'Nem k\xF6vetem',
      'publish': 'Legyen nyilv\xE1nos',
      'unpublish': 'Legyen titkos',
      'play': 'Lej\xE1tsz\xE1s',
      'play-track': 'Sz\xE1m lej\xE1tsz\xE1sa',
      'play-artist': 'El\u0151ad\xF3 lej\xE1tsz\xE1sa',
      'play-album': 'Album lej\xE1tsz\xE1sa',
      'play-playlist': 'Lej\xE1tsz\xE1si lista lej\xE1tsz\xE1sa',
      'rename': '\xC1tnevez\xE9s',
      'rename-playlist': 'Lej\xE1tsz\xE1si lista \xE1tnevez\xE9se'
    });
  },
  'it.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('it.loc/strings/main.lang', {
      'add-to-collection': 'Aggiungi alla libreria',
      'remove-from-collection': 'Rimuovi dalla libreria',
      'save': 'Salva',
      'remove': 'Elimina',
      'loading-collection-status': 'Caricamento in corso...',
      'starred': 'Preferiti',
      'star': 'Aggiungi a brani preferiti',
      'unstar': 'Rimuovi dai preferiti',
      'add-to': 'Aggiungi a...',
      'share': 'Condividi\u2026',
      'start-radio': 'Avvia radio',
      'copy-url': 'Copia URL Spotify',
      'play-next': 'Riproduci successivo',
      'play-next-remove': 'Rimuovi da "Avanza successivo"',
      'play-next-clear': 'Cancella "Avanza successivo"',
      'queue-add': 'Aggiungi alla coda di riproduzione',
      'queue-remove': 'Rimuovi dalla coda di riproduzione',
      'delete': 'Elimina',
      'cancel': 'Annulla',
      'delete-playlist': 'Elimina playlist?',
      'delete-playlist-confirmation': 'Vuoi eliminare la playlist <a href=\'{1}\'>{0}</a>?',
      'new-playlist': 'Nuova playlist',
      'name': 'Nome',
      'create-playlist': 'Crea playlist',
      'following': 'Following',
      'follow': 'Segui',
      'unfollow': 'Non seguire',
      'publish': 'Rendi pubblica',
      'unpublish': 'Rendi segreta',
      'play': 'Play',
      'play-track': 'Riproduci brano',
      'play-artist': 'Riproduci artista',
      'play-album': 'Riproduci album',
      'play-playlist': 'Riproduci playlist',
      'rename': 'Rinomina',
      'rename-playlist': 'Rinomina playlist'
    });
  },
  'ja.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('ja.loc/strings/main.lang', {
      'add-to-collection': '\u30B3\u30EC\u30AF\u30B7\u30E7\u30F3\u306B\u8FFD\u52A0',
      'remove-from-collection': '\u30B3\u30EC\u30AF\u30B7\u30E7\u30F3\u304B\u3089\u524A\u9664',
      'save': '\u4FDD\u5B58',
      'remove': '\u524A\u9664',
      'loading-collection-status': '\u30ED\u30FC\u30C9\u3057\u3066\u3044\u307E\u3059...',
      'starred': '\u30B9\u30BF\u30FC',
      'star': '\u30B9\u30BF\u30FC\u3092\u4ED8\u3051\u308B',
      'unstar': '\u30B9\u30BF\u30FC\u3092\u5916\u3059',
      'add-to': '\u6B21\u306B\u8FFD\u52A0\u2026',
      'share': '\u5171\u6709\u2026',
      'start-radio': '\u30E9\u30B8\u30AA\u3092\u958B\u59CB',
      'copy-url': 'Spotify URL\u3092\u30B3\u30D4\u30FC',
      'play-next': '\u6B21\u306B\u8074\u3044\u3066\u307F\u308B',
      'play-next-remove': '[\u6B21\u306B\u30A2\u30C3\u30D7]\u304B\u3089\u524A\u9664',
      'play-next-clear': '[\u6B21\u306B\u30A2\u30C3\u30D7]\u304B\u3089\u30AF\u30EA\u30A2',
      'queue-add': '[\u6B21\u306E\u66F2\u3092\u8074\u304F]\u306B\u8FFD\u52A0',
      'queue-remove': '[\u6B21\u306E\u66F2\u3092\u8074\u304F]\u304B\u3089\u524A\u9664',
      'delete': '\u524A\u9664',
      'cancel': '\u30AD\u30E3\u30F3\u30BB\u30EB',
      'delete-playlist': '\u30D7\u30EC\u30A4\u30EA\u30B9\u30C8\u3092\u524A\u9664\u3057\u307E\u3059\u304B?',
      'delete-playlist-confirmation': '\u30D7\u30EC\u30A4\u30EA\u30B9\u30C8<a href=\'{1}\'>{0}</a>\u3092\u524A\u9664\u3057\u307E\u3059\u304B?',
      'new-playlist': '\u65B0\u898F\u30D7\u30EC\u30A4\u30EA\u30B9\u30C8',
      'name': '\u540D\u524D',
      'create-playlist': '\u30D7\u30EC\u30A4\u30EA\u30B9\u30C8\u306E\u4F5C\u6210',
      'following': '\u30D5\u30A9\u30ED\u30FC\u4E2D',
      'follow': '\u30D5\u30A9\u30ED\u30FC',
      'unfollow': '\u30D5\u30A9\u30ED\u30FC\u3092\u3084\u3081\u308B',
      'publish': '\u516C\u958B\u3059\u308B',
      'unpublish': '\u975E\u516C\u958B\u306B\u3059\u308B',
      'play': '\u518D\u751F',
      'play-track': '\u30C8\u30E9\u30C3\u30AF\u3092\u8074\u304F',
      'play-artist': '\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u306E\u66F2\u3092\u8074\u304F',
      'play-album': '\u30A2\u30EB\u30D0\u30E0\u3092\u8074\u304F',
      'play-playlist': '\u30D7\u30EC\u30A4\u30EA\u30B9\u30C8\u306E\u66F2\u3092\u8074\u304F',
      'rename': '\u540D\u524D\u3092\u5909\u66F4',
      'rename-playlist': '\u30D7\u30EC\u30A4\u30EA\u30B9\u30C8\u540D\u3092\u5909\u66F4'
    });
  },
  'id.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('id.loc/strings/main.lang', {
      'add-to-collection': 'Tambahkan ke koleksi',
      'remove-from-collection': 'Hapus dari koleksi',
      'save': 'Simpan',
      'remove': 'Hapus',
      'loading-collection-status': 'Memuat...',
      'starred': 'Diberi bintang',
      'star': 'Beri bintang',
      'unstar': 'Batalkan bintang',
      'add-to': 'Tambahkan ke\u2026',
      'share': 'Bagikan\u2026',
      'start-radio': 'Mulai Radio',
      'copy-url': 'Salin URL Spotify',
      'play-next': 'Putar Berikutnya',
      'play-next-remove': 'Hapus Dari \'Berikutnya\'',
      'play-next-clear': 'Kosongkan \'Berikutnya\'',
      'queue-add': 'Tambahkan ke Antrean Putar',
      'queue-remove': 'Hapus dari Antrean Putar',
      'delete': 'Hapus',
      'cancel': 'Batalkan',
      'delete-playlist': 'Hapus Daftar Putar?',
      'delete-playlist-confirmation': 'Yakin ingin menghapus daftar putar <a href=\'{1}\'>{0}</a>?',
      'new-playlist': 'Daftar putar baru',
      'name': 'Nama',
      'create-playlist': 'Buat Daftar Putar',
      'following': 'Mengikuti',
      'follow': 'Ikuti',
      'unfollow': 'Berhenti Mengikuti',
      'publish': 'Jadikan publik',
      'unpublish': 'Rahasiakan',
      'play': 'Putar',
      'play-track': 'Putar lagu',
      'play-artist': 'Putar artis',
      'play-album': 'Putar album',
      'play-playlist': 'Putar daftar putar',
      'rename': 'Ganti nama',
      'rename-playlist': 'Ganti nama daftar putar'
    });
  },
  'nl.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('nl.loc/strings/main.lang', {
      'add-to-collection': 'Toevoegen aan collectie',
      'remove-from-collection': 'Verwijderen uit collectie',
      'save': 'Opslaan',
      'remove': 'Verwijderen',
      'loading-collection-status': 'Wordt geladen...',
      'starred': 'Favorieten',
      'star': 'Toevoegen aan favorieten',
      'unstar': 'Verwijderen uit favorieten',
      'add-to': 'Toevoegen aan\u2026',
      'share': 'Delen...',
      'start-radio': 'Radiozender beginnen',
      'copy-url': 'Spotify-URL kopi\xEBren',
      'play-next': 'Volgende afspelen',
      'play-next-remove': 'Verwijderen uit wachtrij',
      'play-next-clear': 'Wachtrij wissen',
      'queue-add': 'Aan afspeelwachtrij toevoegen',
      'queue-remove': 'Uit afspeelwachtrij verwijderen',
      'delete': 'Verwijderen',
      'cancel': 'Annuleren',
      'delete-playlist': 'Afspeellijst verwijderen?',
      'delete-playlist-confirmation': 'Wil je deze afspeellijst echt verwijderen <a href=\'{1}\'>{0}</a>?',
      'new-playlist': 'Nieuwe afspeellijst',
      'name': 'Naam',
      'create-playlist': 'Afspeellijst maken',
      'following': 'Volgend',
      'follow': 'Volgen',
      'unfollow': 'Ontvolgen',
      'publish': 'Openbaar maken',
      'unpublish': 'Priv\xE9 maken',
      'play': 'Afspelen',
      'play-track': 'Nummer afspelen',
      'play-artist': 'Artiest afspelen',
      'play-album': 'Album afspelen',
      'play-playlist': 'Afspeellijst afspelen',
      'rename': 'Naam wijzigen',
      'rename-playlist': 'Naam afspeellijst wijzigen'
    });
  },
  'pt-br.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('pt-br.loc/strings/main.lang', {
      'add-to-collection': 'Adicionar \xE0 cole\xE7\xE3o',
      'remove-from-collection': 'Tirar da cole\xE7\xE3o',
      'save': 'Salvar',
      'remove': 'Tirar',
      'loading-collection-status': 'Carregando...',
      'starred': 'Favoritos',
      'star': 'Adicionar aos favoritos',
      'unstar': 'Remover dos favoritos',
      'add-to': 'Adicionar a\u2026',
      'share': 'Compartilhar\u2026',
      'start-radio': 'Abrir r\xE1dio',
      'copy-url': 'Copiar URL do Spotify',
      'play-next': 'Tocar em seguida',
      'play-next-remove': 'Tirar de \'Pr\xF3ximas\'',
      'play-next-clear': 'Limpar \'Pr\xF3ximas\'',
      'queue-add': 'Adicionar \xE0 fila para tocar',
      'queue-remove': 'Tirar da fila para tocar',
      'delete': 'Apagar',
      'cancel': 'Cancelar',
      'delete-playlist': 'Apagar a playlist?',
      'delete-playlist-confirmation': 'Quer mesmo apagar a playlist <a href=\'{1}\'>{0}</a>?',
      'new-playlist': 'Nova playlist',
      'name': 'Nome',
      'create-playlist': 'Criar playlist',
      'following': 'Seguindo',
      'follow': 'Seguir',
      'unfollow': 'Deixar de seguir',
      'publish': 'Tornar p\xFAblica',
      'unpublish': 'Tornar secreta',
      'play': 'Play',
      'play-track': 'Tocar faixa',
      'play-artist': 'Tocar artista',
      'play-album': 'Tocar \xE1lbum',
      'play-playlist': 'Tocar playlist',
      'rename': 'Renomear',
      'rename-playlist': 'Renomear playlist'
    });
  },
  'pl.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('pl.loc/strings/main.lang', {
      'add-to-collection': 'Dodaj do kolekcji',
      'remove-from-collection': 'Usu\u0144 z kolekcji',
      'save': 'Zapisz',
      'remove': 'Usu\u0144',
      'loading-collection-status': '\u0141adowanie...',
      'starred': 'Oznaczone gwiazdk\u0105',
      'star': 'Oznacz gwiazdk\u0105',
      'unstar': 'Usu\u0144 gwiazdk\u0119',
      'add-to': 'Dodaj do\u2026',
      'share': 'Udost\u0119pnij\u2026',
      'start-radio': 'W\u0142\u0105cz radio',
      'copy-url': 'Skopiuj adres URL Spotify',
      'play-next': 'Odtw\xF3rz nast\u0119pnie',
      'play-next-remove': 'Usu\u0144 z "Nast\u0119pne"',
      'play-next-clear': 'Wyczy\u015B\u0107 "Nast\u0119pne"',
      'queue-add': 'Dodaj do kolejki odtwarzania',
      'queue-remove': 'Usu\u0144 z kolejki odtwarzania',
      'delete': 'Usu\u0144',
      'cancel': 'Anuluj',
      'delete-playlist': 'Usun\u0105\u0107 playlist\u0119?',
      'delete-playlist-confirmation': 'Czy na pewno chcesz usun\u0105\u0107 playlist\u0119 <a href=\'{1}\'>{0}</a>?',
      'new-playlist': 'Nowa playlista',
      'name': 'Nazwa',
      'create-playlist': 'Utw\xF3rz playlist\u0119',
      'following': 'Obserwujesz',
      'follow': 'Obserwuj',
      'unfollow': 'Nie obserwuj',
      'publish': 'Upublicznij',
      'unpublish': 'Utajnij',
      'play': 'Odtwarzaj',
      'play-track': 'Odtwarzaj utw\xF3r',
      'play-artist': 'Odtwarzaj wykonawc\u0119',
      'play-album': 'Odtwarzaj album',
      'play-playlist': 'Odtwarzaj playlist\u0119',
      'rename': 'Zmie\u0144 nazw\u0119',
      'rename-playlist': 'Zmie\u0144 nazw\u0119 playlisty'
    });
  },
  'sv.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('sv.loc/strings/main.lang', {
      'add-to-collection': 'L\xE4gg till i samling',
      'remove-from-collection': 'Ta bort fr\xE5n samling',
      'save': 'Spara',
      'remove': 'Ta bort',
      'loading-collection-status': 'L\xE4ser in\xA0\u2026',
      'starred': 'Favoriter',
      'star': 'Favoritmarkera',
      'unstar': 'Ta bort favoritmarkering',
      'add-to': 'L\xE4gg till i\xA0\u2026',
      'share': 'Dela\xA0\u2026',
      'start-radio': 'Starta radio',
      'copy-url': 'Kopiera Spotify URL',
      'play-next': 'Spela upp h\xE4rn\xE4st',
      'play-next-remove': 'Ta bort fr\xE5n N\xE4sta sp\xE5r',
      'play-next-clear': 'Rensa N\xE4sta sp\xE5r',
      'queue-add': 'L\xE4gg till i uppspelningsk\xF6n',
      'queue-remove': 'Ta bort fr\xE5n uppspelningsk\xF6',
      'delete': 'Ta bort',
      'cancel': 'Avbryt',
      'delete-playlist': 'Vill du ta bort spellistan?',
      'delete-playlist-confirmation': 'Vill du ta bort spellistan <a href=\'{1}\'>{0}</a>?',
      'new-playlist': 'Ny spellista',
      'name': 'Namn',
      'create-playlist': 'Skapa spellista',
      'following': 'F\xF6ljer',
      'follow': 'F\xF6lj',
      'unfollow': 'Sluta f\xF6lja',
      'publish': 'G\xF6r offentlig',
      'unpublish': 'G\xF6r hemlig',
      'play': 'Spela upp',
      'play-track': 'Spela upp sp\xE5r',
      'play-artist': 'Spela upp artist',
      'play-album': 'Spela upp album',
      'play-playlist': 'Spela upp spellista',
      'rename': 'Byt namn',
      'rename-playlist': 'Byt namn p\xE5 spellista'
    });
  },
  'ru.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('ru.loc/strings/main.lang', {
      'add-to-collection': '\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u043A\u043E\u043B\u043B\u0435\u043A\u0446\u0438\u044E',
      'remove-from-collection': '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0438\u0437 \u043A\u043E\u043B\u043B\u0435\u043A\u0446\u0438\u0438',
      'save': '\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C',
      'remove': '\u0423\u0434\u0430\u043B\u0438\u0442\u044C',
      'loading-collection-status': '\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...',
      'starred': '\u0418\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0435',
      'star': '\u041E\u0442\u043C\u0435\u0442\u0438\u0442\u044C',
      'unstar': '\u0423\u0431\u0440\u0430\u0442\u044C \u043E\u0442\u043C\u0435\u0442\u043A\u0443',
      'add-to': '\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C\u2026',
      'share': '\u041F\u043E\u0434\u0435\u043B\u0438\u0442\u044C\u0441\u044F\u2026',
      'start-radio': '\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0440\u0430\u0434\u0438\u043E',
      'copy-url': '\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C URL Spotify',
      'play-next': '\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439',
      'play-next-remove': '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0438\u0437 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 \u043D\u0430 \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u0435',
      'play-next-clear': '\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043E\u0447\u0435\u0440\u0435\u0434\u044C \u043D\u0430 \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u0435',
      'queue-add': '\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u044C \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u044F',
      'queue-remove': '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0438\u0437 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u044F',
      'delete': '\u0423\u0434\u0430\u043B\u0438\u0442\u044C',
      'cancel': '\u041E\u0442\u043C\u0435\u043D\u0430',
      'delete-playlist': '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442?',
      'delete-playlist-confirmation': '\u0412\u044B \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0442\u0435\u043B\u044C\u043D\u043E \u0445\u043E\u0442\u0438\u0442\u0435 \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 <a href=\'{1}\'>{0}</a>?',
      'new-playlist': '\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442',
      'name': '\u0418\u043C\u044F',
      'create-playlist': '\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442',
      'following': '\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0438',
      'follow': '\u041F\u043E\u0434\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F',
      'unfollow': '\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0443',
      'publish': '\u041E\u0442\u043A\u0440\u044B\u0442\u044C',
      'unpublish': '\u0421\u043A\u0440\u044B\u0442\u044C',
      'play': '\u0412\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0441\u0442\u0438',
      'play-track': '\u0412\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0441\u0442\u0438 \u0442\u0440\u0435\u043A',
      'play-artist': '\u0412\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0441\u0442\u0438 \u0438\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044F',
      'play-album': '\u0412\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0441\u0442\u0438 \u0430\u043B\u044C\u0431\u043E\u043C',
      'play-playlist': '\u0412\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0441\u0442\u0438 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442',
      'rename': '\u041F\u0435\u0440\u0435\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u0442\u044C',
      'rename-playlist': '\u041F\u0435\u0440\u0435\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u0442\u044C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442'
    });
  },
  'th.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('th.loc/strings/main.lang', {
      'add-to-collection': '\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E44\u0E1B\u0E17\u0E35\u0E48\u0E04\u0E2D\u0E25\u0E40\u0E25\u0E04\u0E0A\u0E31\u0E19',
      'remove-from-collection': '\u0E25\u0E1A\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E04\u0E2D\u0E25\u0E40\u0E25\u0E04\u0E0A\u0E31\u0E19',
      'save': '\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01',
      'remove': '\u0E19\u0E33\u0E2D\u0E2D\u0E01',
      'loading-collection-status': '\u0E01\u0E33\u0E25\u0E31\u0E07\u0E42\u0E2B\u0E25\u0E14...',
      'starred': '\u0E43\u0E2B\u0E49\u0E04\u0E30\u0E41\u0E19\u0E19\u0E41\u0E25\u0E49\u0E27',
      'star': '\u0E43\u0E2B\u0E49\u0E04\u0E30\u0E41\u0E19\u0E19',
      'unstar': '\u0E19\u0E33\u0E04\u0E30\u0E41\u0E19\u0E19\u0E2D\u0E2D\u0E01',
      'add-to': '\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E44\u0E1B\u0E17\u0E35\u0E48\u2026',
      'share': '\u0E41\u0E0A\u0E23\u0E4C\u2026',
      'start-radio': '\u0E40\u0E23\u0E34\u0E48\u0E21\u0E43\u0E0A\u0E49\u0E27\u0E34\u0E17\u0E22\u0E38',
      'copy-url': '\u0E04\u0E31\u0E14\u0E25\u0E2D\u0E01 Spotify URL',
      'play-next': '\u0E40\u0E25\u0E48\u0E19\u0E16\u0E31\u0E14\u0E44\u0E1B',
      'play-next-remove': '\u0E19\u0E33\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01 \'\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E40\u0E25\u0E48\u0E19\u0E16\u0E31\u0E14\u0E44\u0E1B\'',
      'play-next-clear': '\u0E25\u0E49\u0E32\u0E07 \'\u200B\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E40\u0E25\u0E48\u0E19\u0E16\u0E31\u0E14\u0E44\u0E1B\'\u200B',
      'queue-add': '\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E25\u0E07\u0E43\u0E19\u0E04\u0E34\u0E27\u0E40\u0E25\u0E48\u0E19\u0E40\u0E1E\u0E25\u0E07',
      'queue-remove': '\u0E25\u0E1A\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E04\u0E34\u0E27\u0E40\u0E25\u0E48\u0E19\u0E40\u0E1E\u0E25\u0E07',
      'delete': '\u0E25\u0E1A',
      'cancel': '\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01',
      'delete-playlist': '\u0E25\u0E1A\u0E40\u0E1E\u0E25\u0E22\u0E4C\u0E25\u0E34\u0E2A\u0E15\u0E4C\u0E43\u0E0A\u0E48\u0E44\u0E2B\u0E21',
      'delete-playlist-confirmation': '\u0E04\u0E38\u0E13\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E17\u0E35\u0E48\u0E08\u0E30\u0E25\u0E1A\u0E40\u0E1E\u0E25\u0E22\u0E4C\u0E25\u0E34\u0E2A\u0E15\u0E4C <a href=\'{1}\'>{0}</a>\u0E43\u0E0A\u0E48\u0E44\u0E2B\u0E21',
      'new-playlist': '\u0E40\u0E1E\u0E25\u0E22\u0E4C\u0E25\u0E34\u0E2A\u0E15\u0E4C\u0E43\u0E2B\u0E21\u0E48',
      'name': '\u0E0A\u0E37\u0E48\u0E2D',
      'create-playlist': '\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E1E\u0E25\u0E22\u0E4C\u0E25\u0E34\u0E2A\u0E15\u0E4C',
      'following': '\u0E01\u0E33\u0E25\u0E31\u0E07\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21',
      'follow': '\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21',
      'unfollow': '\u0E40\u0E25\u0E34\u0E01\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21',
      'publish': '\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32\u0E40\u0E1B\u0E47\u0E19\u0E2A\u0E32\u0E18\u0E32\u0E23\u0E13\u0E30',
      'unpublish': '\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32\u0E40\u0E1B\u0E47\u0E19\u0E04\u0E27\u0E32\u0E21\u0E25\u0E31\u0E1A',
      'play': '\u0E40\u0E25\u0E48\u0E19',
      'play-track': '\u0E40\u0E25\u0E48\u0E19\u0E41\u0E17\u0E23\u0E47\u0E01',
      'play-artist': '\u0E40\u0E25\u0E48\u0E19\u0E40\u0E1E\u0E25\u0E07\u0E08\u0E32\u0E01\u0E28\u0E34\u0E25\u0E1B\u0E34\u0E19',
      'play-album': '\u0E40\u0E25\u0E48\u0E19\u0E2D\u0E31\u0E25\u0E1A\u0E31\u0E49\u0E21',
      'play-playlist': '\u0E40\u0E25\u0E48\u0E19\u0E40\u0E1E\u0E25\u0E22\u0E4C\u0E25\u0E34\u0E2A\u0E15\u0E4C',
      'rename': '\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E0A\u0E37\u0E48\u0E2D',
      'rename-playlist': '\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E0A\u0E37\u0E48\u0E2D\u0E40\u0E1E\u0E25\u0E22\u0E4C\u0E25\u0E34\u0E2A\u0E15\u0E4C'
    });
  },
  'tr.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('tr.loc/strings/main.lang', {
      'add-to-collection': 'Koleksiyona ekle',
      'remove-from-collection': 'Koleksiyondan kald\u0131r',
      'save': 'Kaydet',
      'remove': '\xC7\u0131kar',
      'loading-collection-status': 'Y\xFCkleniyor...',
      'starred': 'Y\u0131ld\u0131zl\u0131lar',
      'star': 'Y\u0131ld\u0131z ekle',
      'unstar': 'Y\u0131ld\u0131z\u0131 kald\u0131r',
      'add-to': '\u015Euraya ekle...',
      'share': 'Payla\u015F...',
      'start-radio': 'Radyo\'yu Ba\u015Flat',
      'copy-url': 'Spotify URL\'sini Kopyala',
      'play-next': '\xC7alma S\u0131ras\u0131na Ekle',
      'play-next-remove': '"S\u0131radakiler"den Kald\u0131r',
      'play-next-clear': '"S\u0131radakiler"i Temizle',
      'queue-add': '\xC7alma S\u0131ras\u0131na ekle',
      'queue-remove': '\xC7alma S\u0131ras\u0131ndan kald\u0131r',
      'delete': 'Sil',
      'cancel': '\u0130ptal',
      'delete-playlist': '\xC7alma Listesi silinsin mi?',
      'delete-playlist-confirmation': '<a href=\'{1}\'>{0}</a> adl\u0131 \xE7alma listesini ger\xE7ekten silmek istiyor musun?',
      'new-playlist': 'Yeni \xE7alma listesi',
      'name': 'Ad',
      'create-playlist': '\xC7alma Listesi Olu\u015Ftur',
      'following': 'Takip Ediliyor',
      'follow': 'Takip Et',
      'unfollow': 'Takip Etmeyi B\u0131rak',
      'publish': 'Herkese a\xE7\u0131k yap',
      'unpublish': 'Gizli yap',
      'play': '\xC7al',
      'play-track': 'Par\xE7ay\u0131 \xE7al',
      'play-artist': 'Sanat\xE7\u0131y\u0131 \xE7al',
      'play-album': 'Alb\xFCm\xFC \xE7al',
      'play-playlist': '\xC7alma listesini \xE7al',
      'rename': 'Yeniden adland\u0131r',
      'rename-playlist': '\xC7alma listesini yeniden adland\u0131r'
    });
  },
  'zh-hant.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('zh-hant.loc/strings/main.lang', {
      'add-to-collection': '\u65B0\u589E\u81F3\u6536\u85CF',
      'remove-from-collection': '\u5F9E\u6536\u85CF\u4E2D\u79FB\u9664',
      'save': '\u5132\u5B58',
      'remove': '\u79FB\u9664',
      'loading-collection-status': '\u8F09\u5165\u4E2D\u2026',
      'starred': '\u5DF2\u661F\u8A55',
      'star': '\u661F\u8A55',
      'unstar': '\u53D6\u6D88\u661F\u8A55',
      'add-to': '\u65B0\u589E\u81F3 \u2026',
      'share': '\u5206\u4EAB...',
      'start-radio': '\u958B\u59CB\u6536\u807D\u96FB\u53F0',
      'copy-url': '\u8907\u88FD Spotify \u8D85\u9023\u7D50',
      'play-next': '\u64AD\u653E\u4E0B\u4E00\u9996',
      'play-next-remove': '\u5F9E\u300C\u7A0D\u5F8C\u64AD\u653E\u300D\u4E2D\u79FB\u9664',
      'play-next-clear': '\u6E05\u9664\u300C\u7A0D\u5F8C\u64AD\u653E\u300D',
      'queue-add': '\u65B0\u589E\u81F3\u64AD\u653E\u4F47\u5217',
      'queue-remove': '\u5F9E\u64AD\u653E\u4F47\u5217\u4E2D\u79FB\u9664',
      'delete': '\u522A\u9664',
      'cancel': '\u53D6\u6D88',
      'delete-playlist': '\u78BA\u5B9A\u8981\u522A\u9664\u64AD\u653E\u6E05\u55AE\uFF1F',
      'delete-playlist-confirmation': '\u4F60\u78BA\u5B9A\u8981\u522A\u9664<a href=\'{1}\'>{0}</a>\u64AD\u653E\u6E05\u55AE\u55CE\uFF1F',
      'new-playlist': '\u6700\u65B0\u64AD\u653E\u6E05\u55AE',
      'name': '\u540D\u7A31',
      'create-playlist': '\u5EFA\u7ACB\u64AD\u653E\u6E05\u55AE',
      'following': '\u6B63\u5728\u95DC\u6CE8',
      'follow': '\u95DC\u6CE8',
      'unfollow': '\u53D6\u6D88\u95DC\u6CE8',
      'publish': '\u8A2D\u70BA\u516C\u958B',
      'unpublish': '\u8A2D\u70BA\u79C1\u5BC6',
      'play': '\u64AD\u653E',
      'play-track': '\u64AD\u653E\u6B4C\u66F2',
      'play-artist': '\u64AD\u653E\u85DD\u4EBA',
      'play-album': '\u64AD\u653E\u5C08\u8F2F',
      'play-playlist': '\u64AD\u653E\u64AD\u653E\u6E05\u55AE',
      'rename': '\u91CD\u65B0\u547D\u540D',
      'rename-playlist': '\u91CD\u65B0\u547D\u540D\u64AD\u653E\u6E05\u55AE'
    });
  },
  'zsm.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('zsm.loc/strings/main.lang', {
      'add-to-collection': 'Tambah ke koleksi',
      'remove-from-collection': 'Keluarkan dari koleksi',
      'save': 'Simpan',
      'remove': 'Keluarkan',
      'loading-collection-status': 'Memuatkan...',
      'starred': 'Dibintangkan',
      'star': 'Bintangkan',
      'unstar': 'Nyahbintang',
      'add-to': 'Tambah ke\u2026',
      'share': 'Kongsi\u2026',
      'start-radio': 'Mulakan Radio',
      'copy-url': 'Salin URL Spotify',
      'play-next': 'Mainkan Seterusnya',
      'play-next-remove': 'Keluarkan Dari \'Lagu Seterusnya\'',
      'play-next-clear': 'Kosongkan \'Lagu Seterusnya\'',
      'queue-add': 'Tambah ke Baris Gilir Main',
      'queue-remove': 'Keluarkan daripada Baris Gilir Main',
      'delete': 'Hapus',
      'cancel': 'Batalkan',
      'delete-playlist': 'Padam Playlist?',
      'delete-playlist-confirmation': 'Adakah anda benar-benar ingin memadamkan playlist ini? <a href=\'{1}\'>{0}</a>?',
      'new-playlist': 'Senarai main baru',
      'name': 'Nama',
      'create-playlist': 'Cipta Senarai main',
      'following': 'Mengikuti',
      'follow': 'Ikuti',
      'unfollow': 'Nyahikut',
      'publish': 'Mengumumkan',
      'unpublish': ' Buat rahsia',
      'play': 'Main',
      'play-track': 'Mainkan lagu',
      'play-artist': 'Mainkan artis',
      'play-album': 'Mainkan album',
      'play-playlist': 'Mainkan senarai main',
      'rename': 'Namakan semula',
      'rename-playlist': 'Namakan semula senarai main'
    });
  },
  'node_modules/api/arb.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/arb.loc/strings/playlist.lang', {
      'Starred': 'Starred',
      'Toplist': 'Top tracks'
    });
  },
  'node_modules/api/de.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/de.loc/strings/playlist.lang', {
      'Starred': 'Starred',
      'Toplist': 'Top-Titel'
    });
  },
  'node_modules/api/el.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/el.loc/strings/playlist.lang', {
      'Starred': '\u0391\u03B3\u03B1\u03C0\u03B7\u03BC\u03AD\u03BD\u03B1',
      'Toplist': '\u039A\u03BF\u03C1\u03C5\u03C6\u03B1\u03AF\u03B1 \u03C4\u03C1\u03B1\u03B3\u03BF\u03CD\u03B4\u03B9\u03B1'
    });
  },
  'node_modules/api/es.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/es.loc/strings/playlist.lang', {
      'Starred': 'Favoritos',
      'Toplist': 'Canciones m\xE1s escuchadas'
    });
  },
  'node_modules/api/en.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/en.loc/strings/playlist.lang', {
      'Starred': 'Starred',
      'Toplist': 'Top tracks'
    });
  },
  'node_modules/api/es-la.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/es-la.loc/strings/playlist.lang', {
      'Starred': 'Seleccionadas',
      'Toplist': 'Canciones favoritas'
    });
  },
  'node_modules/api/es-419.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/es-419.loc/strings/playlist.lang', {
      'Starred': 'Seleccionadas',
      'Toplist': 'Canciones favoritas'
    });
  },
  'node_modules/api/fi.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/fi.loc/strings/playlist.lang', {
      'Starred': 'T\xE4hdell\xE4 merkityt',
      'Toplist': 'Soitetuimmat kappaleet'
    });
  },
  'node_modules/api/fr.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/fr.loc/strings/playlist.lang', {
      'Starred': 'S\xE9lection',
      'Toplist': 'Top titres'
    });
  },
  'node_modules/api/hu.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/hu.loc/strings/playlist.lang', {
      'Starred': 'Megcsillagozott',
      'Toplist': 'N\xE9pszer\u0171 dalok'
    });
  },
  'node_modules/api/id.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/id.loc/strings/playlist.lang', {
      'Starred': 'Diberi bintang',
      'Toplist': 'Lagu teratas'
    });
  },
  'node_modules/api/it.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/it.loc/strings/playlist.lang', {
      'Starred': 'Preferiti',
      'Toplist': 'Brani top'
    });
  },
  'node_modules/api/ja.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/ja.loc/strings/playlist.lang', {
      'Starred': '\u30B9\u30BF\u30FC',
      'Toplist': '\u30C8\u30C3\u30D7\u66F2'
    });
  },
  'node_modules/api/nl.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/nl.loc/strings/playlist.lang', {
      'Starred': 'Favorieten',
      'Toplist': 'Topnummers'
    });
  },
  'node_modules/api/pl.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/pl.loc/strings/playlist.lang', {
      'Starred': 'Oznaczone gwiazdk\u0105',
      'Toplist': 'Najlepsze utwory'
    });
  },
  'node_modules/api/pt-br.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/pt-br.loc/strings/playlist.lang', {
      'Starred': 'Favoritos',
      'Toplist': 'As mais tocadas'
    });
  },
  'node_modules/api/ro.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/ro.loc/strings/playlist.lang', {
      'Starred': 'Marcat cu stea',
      'Toplist': 'Melodii de top'
    });
  },
  'node_modules/api/ru.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/ru.loc/strings/playlist.lang', {
      'Starred': '\u0418\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0435',
      'Toplist': '\u041B\u0443\u0447\u0448\u0438\u0435 \u0442\u0440\u0435\u043A\u0438'
    });
  },
  'node_modules/api/sv.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/sv.loc/strings/playlist.lang', {
      'Starred': 'Favoritmarkerad',
      'Toplist': 'Popul\xE4ra sp\xE5r'
    });
  },
  'node_modules/api/th.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/th.loc/strings/playlist.lang', {
      'Starred': '\u0E43\u0E2B\u0E49\u0E04\u0E30\u0E41\u0E19\u0E19\u0E41\u0E25\u0E49\u0E27',
      'Toplist': '\u0E41\u0E17\u0E23\u0E47\u0E01\u0E2D\u0E31\u0E19\u0E14\u0E31\u0E1A\u0E15\u0E49\u0E19\u0E46'
    });
  },
  'node_modules/api/tr.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/tr.loc/strings/playlist.lang', {
      'Starred': 'Y\u0131ld\u0131zl\u0131lar',
      'Toplist': 'En \xE7ok dinlenen par\xE7alar'
    });
  },
  'node_modules/api/zh-hant.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/zh-hant.loc/strings/playlist.lang', {
      'Starred': '\u5DF2\u661F\u8A55',
      'Toplist': '\u7576\u7D05\u6B4C\u66F2'
    });
  },
  'node_modules/api/zsm.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/zsm.loc/strings/playlist.lang', {
      'Starred': 'Dibintangkan',
      'Toplist': 'Lagu paling popular'
    });
  },
  'node_modules/api/scripts/models.js': function (require, module, exports, global, __filename, __dirname) {
    var _resolveResult = function (result) {
      this.object.resolveMany(0, result);
      this.setDone();
    };
    var _setDone = function () {
      this.setDone();
    };
    var promisedRequest = function (object, request, args, opt_resolveResult) {
      var promise = new Promise(object);
      SP.request(request, args, promise, opt_resolveResult ? _resolveResult : _setDone, promise.setFail);
      return promise;
    };
    var _artists = function (metadataWithUri) {
      return Artist.fromURI(metadataWithUri.uri, metadataWithUri);
    };
    var _albums = function (metadataWithUri) {
      return Album.fromURI(metadataWithUri.uri, metadataWithUri);
    };
    var _discs = function (metadataWithUri) {
      return Disc.fromURI(metadataWithUri.uri, metadataWithUri);
    };
    function Cache(itemClass) {
      this._items = {};
      this._class = itemClass;
    }
    Cache.lookup = function (uri, opt_metadata) {
      return this._cache.lookup(uri, opt_metadata);
    };
    Cache.lookupMany = function (uris) {
      var result = [];
      for (var i = 0, len = uris.length; i < len; i++) {
        result.push(this._cache.lookup(uris[i]));
      }
      return result;
    };
    Cache.prototype.cache = function (uri, item) {
      this._items[uri] = item;
    };
    Cache.prototype.lookup = function (uri, opt_metadata) {
      if (!uri)
        return null;
      var item = this._items[uri];
      if (!(item instanceof this._class)) {
        item = new this._class(uri);
        item.resolveMany(0, opt_metadata);
        this._items[uri] = item;
      }
      return item;
    };
    Cache.prototype.remove = function (uri) {
      delete this._items[uri];
    };
    Cache.prototype.update = function (uris, data) {
      for (var i = 0, len = uris.length; i < len; i++) {
        var item = this._items[uris[i]];
        if (item)
          item.resolveMany(0, data);
      }
    };
    function Observable() {
    }
    Observable.prototype._observed = function () {
    };
    Observable.prototype.addEventListener = function (eventType, observer) {
      if (!observer)
        return;
      if (!this._ob) {
        this._ob = {};
        this._obcount = 0;
      }
      var callbacks = this._ob[eventType];
      if (callbacks)
        callbacks.push(observer);
      else
        this._ob[eventType] = [observer];
      this._obcount++;
      if (this._obcount == 1)
        this._observed();
    };
    Observable.prototype.removeEventListener = function (eventType, observer) {
      var observers = this._ob || {};
      var callbacks = observers[eventType] || [];
      var index = callbacks.indexOf(observer);
      if (index != -1) {
        this._obcount--;
        callbacks.splice(index, 1);
        if (!callbacks.length)
          delete observers[eventType];
        if (!this._obcount)
          delete this._ob;
      }
    };
    Observable.prototype.dispatchEvent = function (evt) {
      if (typeof evt == 'string') {
        evt = { type: evt };
      }
      if (!evt || !evt.type) {
        throw new Error('Dispatched event must have a type.');
      }
      if (!evt.target) {
        evt.target = this;
      }
      var observers = this._ob || {};
      var callbacks = (observers[evt.type] || []).slice(0);
      if (!callbacks.length)
        return true;
      var ret = true;
      evt.preventDefault = function () {
        ret = false;
      };
      for (var i = 0; i < callbacks.length; i++) {
        try {
          if (callbacks[i].call(this, evt) === false)
            ret = false;
        } catch (error) {
          console.error(error);
          if (SP._throwError)
            throw error;
        }
      }
      return ret;
    };
    function Promise(opt_object) {
      this.object = opt_object;
      this._done = [];
      this._fail = [];
    }
    Promise.prototype.always = function (callbackOrThis, opt_callback) {
      var cbFunc, cbThis;
      if (opt_callback) {
        cbFunc = opt_callback;
        cbThis = callbackOrThis;
      } else {
        cbFunc = callbackOrThis;
        cbThis = this;
      }
      if (typeof cbFunc != 'function')
        throw new Error('A callback function is required');
      if (this._done) {
        this._done.push(SP.callback(SP.bind(cbFunc, cbThis)));
        this._fail.push(SP.callback(SP.bind(cbFunc, cbThis)));
      } else {
        cbFunc.apply(cbThis, this._args);
      }
      return this;
    };
    Promise.prototype.done = function (callbackOrThis, opt_callback) {
      var cbFunc, cbThis;
      if (opt_callback) {
        cbFunc = opt_callback;
        cbThis = callbackOrThis;
      } else {
        cbFunc = callbackOrThis;
        cbThis = this;
      }
      if (typeof cbFunc != 'function')
        throw new Error('A callback function is required');
      if (this._isDone)
        cbFunc.apply(cbThis, this._args);
      else if (this._done)
        this._done.push(SP.callback(SP.bind(cbFunc, cbThis)));
      return this;
    };
    Promise.prototype.fail = function (callbackOrThis, opt_callback) {
      var cbFunc, cbThis;
      if (opt_callback) {
        cbFunc = opt_callback;
        cbThis = callbackOrThis;
      } else {
        cbFunc = callbackOrThis;
        cbThis = this;
      }
      if (typeof cbFunc != 'function')
        throw new Error('A callback function is required');
      if (this._isFail)
        cbFunc.apply(cbThis, this._args);
      else if (this._fail)
        this._fail.push(SP.callback(SP.bind(cbFunc, cbThis)));
      return this;
    };
    Promise.prototype.each = function (callbackOrThis, opt_callback) {
      if (this._objs) {
        var cbFunc, cbThis;
        if (opt_callback) {
          cbFunc = opt_callback;
          cbThis = callbackOrThis;
        } else {
          cbFunc = callbackOrThis;
          cbThis = this;
        }
        if (typeof cbFunc != 'function')
          throw new Error('A callback function is required');
        if (this._each) {
          this._each.push(SP.callback(SP.bind(cbFunc, cbThis)));
        }
        for (var i = 0, l = this._objs.length; i < l; i++)
          cbFunc.call(cbThis, this._objs[i]);
      }
      return this;
    };
    Promise.prototype.setDone = function (opt_object) {
      if (!this._done)
        return;
      var done = this._done;
      var fail = this._fail;
      delete this._done;
      delete this._fail;
      if (arguments.length == 1) {
        this.object = opt_object;
      }
      this._isDone = true;
      this._args = [this.object];
      for (var i = 0, l = done.length; i < l; i++)
        done[i].apply(undefined, this._args);
      for (var j = 0, k = fail.length; j < k; j++)
        fail[j].clear();
      delete this._each;
      delete this._join;
      delete this._numResolved;
      delete this._oneFailed;
    };
    Promise.prototype.setFail = function (error) {
      if (!this._done)
        return;
      var fail = this._fail;
      var done = this._done;
      delete this._done;
      delete this._fail;
      this._isFail = true;
      this._args = [
        this.object,
        error
      ];
      for (var i = 0, l = fail.length; i < l; i++)
        fail[i].apply(undefined, this._args);
      for (var j = 0, k = done.length; j < k; j++)
        done[j].clear();
      delete this._each;
      delete this._join;
      delete this._numResolved;
      delete this._oneFailed;
    };
    Promise.join = function (promises) {
      var promise = new Promise();
      promises = SP.varargs(arguments, 0, true);
      promise._join = promises;
      promise._each = [];
      promise._objs = [];
      promise._numResolved = 0;
      if (promises.length === 0)
        promise.setDone([]);
      for (var i = 0, l = promises.length; i < l; i++)
        promises[i].done(promise, promise._oneDone).fail(promise, promise._oneFail);
      return promise;
    };
    Promise.prototype._oneEither = function (object) {
      this._numResolved++;
      if (this._numResolved < this._join.length)
        return;
      this.object = [];
      for (var i = 0, l = this._join.length; i < l; i++)
        this.object.push(this._join[i].object);
      for (var j = 0, k = this._each.length; j < k; j++)
        this._each[j].clear();
      if (this._oneFailed)
        this.setFail();
      else
        this.setDone();
    };
    Promise.prototype._oneDone = function (object) {
      if (!this._done)
        return;
      this._objs.push(object);
      var nextEach = [];
      for (var i = 0, l = this._each.length; i < l; i++) {
        var cb = this._each[i];
        nextEach.push(cb.copy());
        cb.call(undefined, object);
      }
      this._each = nextEach;
      this._oneEither(object);
    };
    Promise.prototype._oneFail = function (object, error) {
      if (!this._done)
        return;
      this._oneFailed = true;
      this._oneEither(object);
    };
    function Loadable() {
      Observable.call(this);
    }
    SP.inherit(Loadable, Observable);
    Loadable.define = function (clazz, names, opt_func) {
      var proto = clazz.prototype;
      if (!proto._prop)
        proto._prop = {};
      if (!proto._next)
        proto._next = 0;
      var group = {
        mask: 0,
        func: opt_func
      };
      for (var i = 0, l = names.length; i < l; i++) {
        var mask = 1 << proto._next++;
        group.mask |= mask;
        proto._prop[names[i]] = {
          mask: mask,
          group: group
        };
      }
    };
    Loadable.prototype._make = function (name, value) {
      name = '_make_' + name;
      var func = this[name];
      return func ? func(value) : value;
    };
    Loadable.prototype.resolve = function (name, value, opt_silent) {
      var prop = this._prop[name];
      if (!prop)
        return;
      this._done |= this._prop[name].mask;
      this._wait &= ~this._done;
      var newValue = this._make(name, value);
      if (this.hasOwnProperty(name) && !opt_silent) {
        var oldValue = this[name];
        if (oldValue !== newValue) {
          this[name] = newValue;
          this.dispatchEvent({
            type: 'change:' + name,
            property: name,
            oldValue: oldValue
          });
        }
      } else {
        this[name] = newValue;
      }
      if (!this._wait)
        delete this._wait;
    };
    Loadable.prototype.resolveMany = function (propsMask, data, opt_silent) {
      for (var name in data)
        this.resolve(name, data[name], opt_silent);
      this._done |= propsMask;
      this._wait &= ~propsMask;
      this.resolveDone();
    };
    Loadable.prototype.resolveDone = function () {
      if (!this._reqs)
        return;
      var done = [];
      for (var i = 0; i < this._reqs.length; i++) {
        if (!(this._reqs[i]._need & ~this._done))
          done.push(this._reqs.splice(i--, 1)[0]);
      }
      if (!this._reqs.length)
        delete this._reqs;
      if (!this._wait)
        delete this._wait;
      for (var j = 0, l = done.length; j < l; j++) {
        done[j].setDone();
      }
    };
    Loadable.prototype.resolveFail = function (propsMask, error) {
      this._wait &= ~propsMask;
      if (!this._reqs)
        return;
      var fail = [];
      for (var i = 0; i < this._reqs.length; i++) {
        if (this._reqs[i]._need & propsMask)
          fail.push(this._reqs.splice(i--, 1)[0]);
      }
      if (!this._reqs.length)
        delete this._reqs;
      if (!this._wait)
        delete this._wait;
      for (var j = 0, l = fail.length; j < l; j++) {
        fail[j].setFail(error);
      }
    };
    Loadable.prototype.load = function (properties) {
      var args = SP.varargs(arguments);
      var req = new Promise(this);
      req._need = this._neededForLoad(args);
      if (req._need) {
        if (this._reqs)
          this._reqs.push(req);
        else
          this._reqs = [req];
        this._requestProperties(req._need);
      } else {
        req.setDone();
      }
      return req;
    };
    Loadable.prototype._neededForLoad = function (properties) {
      var neededMask = 0;
      for (var i = 0, l = properties.length; i < l; i++) {
        var name = properties[i];
        var prop = this._prop[name];
        if (!prop)
          throw new Error(name + ' is not a property.');
        neededMask |= prop.mask;
      }
      return neededMask & ~this._done;
    };
    Loadable.prototype._requestProperties = function (propsMask) {
      var groups = [];
      for (var name in this._prop) {
        var prop = this._prop[name];
        var mask = prop.group.mask;
        if (!(mask & propsMask))
          continue;
        if (mask & this._wait)
          continue;
        groups.push(prop.group);
        this._wait |= mask;
        propsMask &= ~mask;
        if (!propsMask)
          break;
      }
      for (var i = 0, l = groups.length; i < l; i++) {
        var func = this[groups[i].func];
        if (func)
          func.call(this, groups[i].mask);
      }
    };
    function BridgeLoadable() {
      Loadable.call(this);
    }
    SP.inherit(BridgeLoadable, Loadable);
    BridgeLoadable.prototype.bridgeListen = function (requestName, requestArgs) {
      if (!this._listening) {
        this._requestName = requestName;
        this._requestArgs = requestArgs;
        this._listening = true;
        this._eventWait();
      }
    };
    BridgeLoadable.prototype.bridgeUnlisten = function () {
      delete this._requestName;
      delete this._requestArgs;
      delete this._listening;
    };
    BridgeLoadable.prototype._eventWait = function () {
      if (this._listening)
        SP.request(this._requestName, this._requestArgs, this, this._eventDone, this._eventFail);
    };
    BridgeLoadable.prototype._eventDone = function (event) {
      this._eventWait();
      this.eventDone(event);
    };
    BridgeLoadable.prototype.eventDone = function (event) {
      if (event.receiver && this.hasOwnProperty(event.receiver)) {
        var receiver = this[event.receiver];
        receiver.resolveMany(0, event.data);
        receiver.dispatchEvent(event);
      } else {
        this.resolveMany(0, event.data);
        this.dispatchEvent(event);
      }
    };
    BridgeLoadable.prototype._eventFail = function (error) {
      if (error.error == 'timeout')
        this._eventWait();
      this.eventFail(error);
    };
    BridgeLoadable.prototype.eventFail = function (error) {
    };
    function ProxyListener() {
      BridgeLoadable.call(this);
      this._filters = [];
      this._receivers = [];
    }
    SP.inherit(ProxyListener, BridgeLoadable);
    ProxyListener.prototype.filter = function (filter) {
      this._filters.push(filter);
    };
    ProxyListener.prototype.proxyTo = function (receiver) {
      this._receivers.push(receiver);
    };
    ProxyListener.prototype.eventDone = function (evt) {
      var i, len, proxy = true;
      for (i = 0, len = this._filters.length; i < len; i++) {
        if (this._filters[i](evt) === false)
          proxy = false;
      }
      if (!proxy)
        return;
      for (i = 0, len = this._receivers.length; i < len; i++) {
        this._receivers[i].eventDone(evt);
      }
    };
    function MdL(uri) {
      BridgeLoadable.call(this);
    }
    SP.inherit(MdL, BridgeLoadable);
    MdL.init = function (clazz, prefix) {
      clazz._type = prefix;
    };
    MdL.prototype.imageForSize = function (size) {
      var images = this.images;
      size *= window.devicePixelRatio || 1;
      for (var i = 0, l = images ? images.length : 0; i < l; i++) {
        if (images[i][0] >= size || i == l - 1)
          return images[i][1].replace('{size}', size);
      }
      return this.image;
    };
    MdL.prototype._metadata = function (propsMask) {
      var load = function (data) {
        this.resolveMany(propsMask, data);
      };
      var fail = function (oops) {
        this.resolveFail(propsMask, oops);
      };
      SP.request(this.constructor._type + '_metadata', [this.uri], this, load, fail);
    };
    MdL.prototype._profile = function (propsMask) {
      var load = function (data) {
        this.resolveMany(propsMask, data);
      };
      var fail = function (oops) {
        this.resolveFail(propsMask, oops);
      };
      SP.request(this.constructor._type + '_profile', [this.uri], this, load, fail);
    };
    MdL.prototype.toString = function () {
      return this.uri;
    };
    function Album(uri) {
      MdL.call(this);
      this.resolve('uri', uri);
    }
    SP.inherit(Album, MdL);
    Loadable.define(Album, ['uri']);
    Loadable.define(Album, [
      'availability',
      'artists',
      'date',
      'discs',
      'image',
      'images',
      'label',
      'name',
      'playable',
      'popularity',
      'type'
    ], '_metadata');
    Loadable.define(Album, ['copyrights'], '_profile');
    Loadable.define(Album, ['tracks'], '_collections');
    MdL.init(Album, 'album');
    Album.prototype._make_artists = function (value) {
      return value && value.map(_artists);
    };
    Album.prototype._make_discs = function (value) {
      return value && value.map(_discs);
    };
    Album.prototype._collections = function () {
      this.resolve('tracks', new BridgeCollection(Track, this.uri, 'album_tracks'));
      this.resolveDone();
    };
    Album.fromURI = Cache.lookup;
    Album.fromURIs = Cache.lookupMany;
    Album._cache = new Cache(Album);
    function Disc(uri) {
      MdL.call(this);
      this.resolve('uri', uri);
      this.resolve('tracks', new BridgeCollection(Track, uri, 'album_disc_tracks'));
    }
    SP.inherit(Disc, MdL);
    Loadable.define(Disc, [
      'uri',
      'tracks'
    ]);
    Loadable.define(Disc, [
      'album',
      'number'
    ], '_metadata');
    MdL.init(Disc, 'disc');
    Disc.prototype._make_album = function (value) {
      return value && Album.fromURI(value);
    };
    Disc.fromURI = Cache.lookup;
    Disc.fromURIs = Cache.lookupMany;
    Disc._cache = new Cache(Disc);
    function AlbumGroup(uri, metadata) {
      Loadable.call(this);
      this.resolve('albums', metadata && metadata.albums ? metadata.albums.map(_albums) : []);
    }
    SP.inherit(AlbumGroup, Loadable);
    Loadable.define(AlbumGroup, ['albums']);
    AlbumGroup.fromURI = function (uri, metadata) {
      return new this(uri, metadata);
    };
    function Client() {
      BridgeLoadable.call(this);
    }
    SP.inherit(Client, BridgeLoadable);
    Client.prototype._observed = function () {
      this.bridgeListen('client_event_wait', []);
    };
    Loadable.define(Client, ['features'], '_features');
    Loadable.define(Client, ['hide_hpto'], '_hide_hpto');
    Client.prototype._features = function (propsMask) {
      var load = function (data) {
        this.resolveMany(propsMask, data);
      };
      var fail = function (oops) {
        this.resolveFail(propsMask, oops);
      };
      SP.request('client_features', [], this, load, fail);
    };
    Client.prototype._hide_hpto = function (propsMask) {
      var load = function (data) {
        this.resolveMany(propsMask, data);
      };
      var fail = function (oops) {
        this.resolveFail(propsMask, oops);
      };
      SP.request('client_get_hide_hpto', [], this, load, fail);
    };
    Client.prototype.showShareUI = function (item, opt_message, opt_point) {
      var uri = item.uri || item;
      var message = opt_message || '';
      var args = [
        uri,
        message
      ];
      if (opt_point && 'x' in opt_point && 'y' in opt_point) {
        args.push(opt_point.x);
        args.push(opt_point.y);
      }
      return promisedRequest(this, 'client_show_share_ui', args);
    };
    Client.prototype.showContextUI = function (items, opt_point, opt_origin, opt_index) {
      var uris = Array.isArray(items) ? SP.uris(items) : [items.uri];
      var args = [uris];
      if (opt_point && 'x' in opt_point && 'y' in opt_point) {
        args.push(opt_point.x);
        args.push(opt_point.y);
      }
      if (opt_origin && opt_origin.uri) {
        args.push(opt_origin.uri);
      }
      if (typeof opt_index !== 'undefined' && opt_index % 1 === 0) {
        args.push(opt_index);
      }
      return promisedRequest(this, 'client_show_context_ui', args);
    };
    Client.prototype.broadcast = function (message) {
      return promisedRequest(this, 'client_broadcast', [message]);
    };
    function Application() {
      BridgeLoadable.call(this);
    }
    SP.inherit(Application, BridgeLoadable);
    Loadable.define(Application, [
      'arguments',
      'dropped',
      'identifier',
      'name',
      'uri'
    ], '_query');
    Application.prototype._observed = function () {
      this.bridgeListen('application_event_wait', []);
    };
    Application.prototype._make_dropped = function (value) {
      return value && value.map(function (i) {
        return fromURI(i);
      });
    };
    Application.prototype._query = function (propsMask) {
      var load = function (data) {
        this.resolveMany(propsMask, data);
      };
      var fail = function (oops) {
        this.resolveFail(propsMask, oops);
      };
      SP.request('application_query', [], this, load, fail);
    };
    Application.prototype.activate = function () {
      return promisedRequest(this, 'application_activate', [this.uri]);
    };
    Application.prototype.deactivate = function () {
      return promisedRequest(this, 'application_deactivate', [this.uri]);
    };
    Application.prototype.exit = function (opt_statusCode) {
      return promisedRequest(this, 'application_notify_exit', [opt_statusCode || 0]);
    };
    Application.prototype.hideLoadingScreen = function () {
      SP.request('application_notify_loaded', []);
    };
    Application.prototype.readFile = function (path) {
      var promise = new Promise();
      var request = new XMLHttpRequest();
      request.open('GET', path, true);
      request.onreadystatechange = function (e) {
        if (request.readyState !== 4)
          return;
        if (request.status !== 200 && request.status !== 0) {
          promise.setFail();
        } else {
          promise.setDone(request.responseText);
        }
      };
      request.send(null);
      return promise;
    };
    Application.prototype.openURI = function (uri, opt_context) {
      return promisedRequest(this, 'application_open_uri', [
        uri,
        opt_context || null
      ]);
    };
    Application.prototype.openApp = function (app, var_args) {
      var arg = SP.varargs(arguments, 1);
      var uriSegments = [
        'spotify',
        'app',
        app
      ];
      for (var i = 0, l = arg.length; i < l; i++) {
        uriSegments.push(encodeURIComponent(arg[i]));
      }
      return this.openURI(uriSegments.join(':'));
    };
    Application.prototype.setTitle = function (title, opt_subtitle) {
      return promisedRequest(this, 'application_set_title', [
        title,
        opt_subtitle || ''
      ]);
    };
    Application.prototype.setPreferredSize = function (width, height) {
      var promise = new Promise();
      var args = [
        width,
        height
      ];
      SP.request('application_set_preferred_size', args, promise, promise.setDone, promise.setFail);
      return promise;
    };
    Application.prototype.resolvePath = function (path) {
      return SP.resolvePath(path);
    };
    Application.prototype.clientEvent = function (context, event, eventVersion, testVersion, data) {
      return promisedRequest(this, 'application_client_event', [].slice.call(arguments));
    };
    Application.prototype.bannerShownEvent = function (eventInfo) {
      return promisedRequest(this, 'application_banner_shown_event', eventInfo);
    };
    function Artist(uri) {
      MdL.call(this);
      this.resolve('uri', uri);
    }
    SP.inherit(Artist, MdL);
    Loadable.define(Artist, ['uri']);
    Loadable.define(Artist, [
      'image',
      'images',
      'name',
      'popularity'
    ], '_metadata');
    Loadable.define(Artist, [
      'biography',
      'genres',
      'portraits',
      'years'
    ], '_profile');
    Loadable.define(Artist, [
      'albums',
      'appearances',
      'compilations',
      'related',
      'singles'
    ], '_collections');
    Loadable.define(Artist, ['user'], '_associatedUser');
    MdL.init(Artist, 'artist');
    Artist.prototype._collections = function () {
      this.resolve('albums', new BridgeCollection(AlbumGroup, this.uri, 'artist_albums'));
      this.resolve('appearances', new BridgeCollection(AlbumGroup, this.uri, 'artist_appearances'));
      this.resolve('compilations', new BridgeCollection(AlbumGroup, this.uri, 'artist_compilations'));
      this.resolve('related', new BridgeCollection(Artist, this.uri, 'artist_related_artists'));
      this.resolve('singles', new BridgeCollection(AlbumGroup, this.uri, 'artist_singles'));
      this.resolveDone();
    };
    Artist.prototype._associatedUser = function (propsMask) {
      var load = function (data) {
        this.resolveMany(propsMask, data);
      };
      var fail = function (oops) {
        this.resolveFail(propsMask, oops);
      };
      SP.request('artist_associated_user', [this.uri], this, load, fail);
    };
    Artist.prototype._make_user = function (value) {
      return value && User.fromURI(value);
    };
    Artist.fromURI = Cache.lookup;
    Artist.fromURIs = Cache.lookupMany;
    Artist._cache = new Cache(Artist);
    ListDescriptor.Types = {
      LIST: 'list',
      LISTS: 'lists',
      SORT: 'sort',
      FILTER: 'filter',
      RANGE: 'range',
      SHUFFLE: 'shuffle'
    };
    function ListDescriptor(type, opt_params) {
      this.type = type;
      for (var n in opt_params) {
        this[n] = opt_params[n];
      }
    }
    ListDescriptor.compare = function (a, b) {
      if (a.type !== b.type) {
        return false;
      }
      switch (a.type) {
      case ListDescriptor.Types.LIST:
        return a.uri === b.uri;
      case ListDescriptor.Types.LISTS:
        if (a.lists.length !== b.lists.length) {
          return false;
        }
        for (var i = 0; i < a.lists.length; i++) {
          if (!ListDescriptor.compare(a.lists[i], b.lists[i])) {
            return false;
          }
        }
        return true;
      case ListDescriptor.Types.FILTER:
      case ListDescriptor.Types.RANGE:
      case ListDescriptor.Types.SHUFFLE:
      case ListDescriptor.Types.SORT:
        if (a.version !== b.version) {
          return false;
        }
        if (a.args.toString() !== b.args.toString()) {
          return false;
        }
        return ListDescriptor.compare(a.list, b.list);
      default:
        return false;
      }
    };
    ListDescriptor.create = function (uri) {
      return new ListDescriptor(ListDescriptor.Types.LIST, { uri: uri });
    };
    ListDescriptor.createConcatenated = function (lists) {
      return new ListDescriptor(ListDescriptor.Types.LISTS, { lists: lists });
    };
    ListDescriptor.prototype.filter = function (operation, field, value) {
      return new ListDescriptor(ListDescriptor.Types.FILTER, {
        list: this,
        args: [
          operation,
          field,
          value
        ],
        version: 1
      });
    };
    ListDescriptor.prototype.range = function (offset, length) {
      return new ListDescriptor(ListDescriptor.Types.RANGE, {
        list: this,
        args: [
          offset,
          length
        ],
        version: 1
      });
    };
    ListDescriptor.prototype.shuffle = function (opt_seed) {
      return new ListDescriptor(ListDescriptor.Types.SHUFFLE, {
        list: this,
        args: [opt_seed || Math.floor(Math.random() * 200000000)],
        version: 1
      });
    };
    ListDescriptor.prototype.sort = function (field, opt_direction, var_args) {
      if (arguments.length > 2 && arguments.length % 2 != 0) {
        throw new Error('Invalid number of parameters');
      }
      var args = arguments.length == 1 ? [
        field,
        'asc'
      ] : Array.prototype.slice.call(arguments);
      return new ListDescriptor(ListDescriptor.Types.SORT, {
        list: this,
        args: args,
        version: 1
      });
    };
    ListDescriptor.prototype.getBase = function () {
      switch (this.type) {
      case ListDescriptor.Types.LIST:
      case ListDescriptor.Types.LISTS:
        return this;
      case ListDescriptor.Types.FILTER:
      case ListDescriptor.Types.RANGE:
      case ListDescriptor.Types.SHUFFLE:
      case ListDescriptor.Types.SORT:
        return this.list ? this.list.getBase() : null;
      }
      return null;
    };
    function Collection(itemClass, uri, snapshot, opt_descriptor, opt_itemFactory) {
      BridgeLoadable.call(this);
      this.resolve('descriptor', opt_descriptor instanceof ListDescriptor ? opt_descriptor : ListDescriptor.create(opt_descriptor || uri));
      this.resolve('type', itemClass);
      this.resolve('uri', uri);
      this._snapshot = snapshot;
      this._factory = opt_itemFactory || SP.bind(itemClass.fromURI, itemClass);
    }
    SP.inherit(Collection, BridgeLoadable);
    Loadable.define(Collection, [
      'descriptor',
      'type',
      'uri'
    ]);
    Collection.prototype.clone = function (opt_newDescriptor) {
      return new Collection(this.type, this.uri, this._snapshot, opt_newDescriptor || this.descriptor, this._factory);
    };
    Collection.prototype.snapshot = function (opt_start, opt_length, opt_raw) {
      var snapshot = new Snapshot(this, opt_start, opt_length, opt_raw);
      return snapshot.load('length', 'range');
    };
    Collection.prototype.add = function (items) {
      throw new Error('This method has not been implemented.');
    };
    Collection.prototype.insert = function (ref, items) {
      throw new Error('This method has not been implemented.');
    };
    Collection.prototype.remove = function (ref) {
      throw new Error('This method has not been implemented.');
    };
    Collection.prototype.trim = function (ref) {
      throw new Error('This method has not been implemented.');
    };
    Collection.prototype.clear = function () {
      throw new Error('This method has not been implemented.');
    };
    Collection.prototype.sort = function (field, opt_direction, var_args) {
      return this.clone(this.descriptor.sort.apply(this.descriptor, arguments));
    };
    Collection.prototype.filter = function (operation, field, value) {
      return this.clone(this.descriptor.filter(operation, field, value));
    };
    Collection.prototype.range = function (offset, length) {
      return this.clone(this.descriptor.range(offset, length));
    };
    Collection.prototype.shuffle = function (opt_seed) {
      return this.clone(this.descriptor.shuffle(opt_seed));
    };
    Collection.prototype.contains = function (items) {
      throw new Error('This method has not been implemented.');
    };
    function BridgeCollection(itemClass, uri, requestPrefix, opt_descriptor, opt_itemFactory) {
      Collection.call(this, itemClass, uri, this._requestSnapshot, opt_descriptor, opt_itemFactory);
      this._prefix = requestPrefix;
    }
    SP.inherit(BridgeCollection, Collection);
    BridgeCollection.prototype._requestSnapshot = function (descriptor, offset, length, raw) {
      var promise = new Promise();
      if (this._prefix.indexOf('toplist_region_') == 0 && descriptor.uri.match(/:country:USER$/) != null) {
        var onCountryLoaded = function (session) {
          descriptor.uri = descriptor.uri.replace(/:country:USER$/, ':country:' + session.country);
          SP.request(this._prefix + '_snapshot', [
            descriptor,
            offset,
            length,
            raw
          ], promise, promise.setDone, promise.setFail);
        };
        new Session().load('country').done(SP.bind(onCountryLoaded, this)).fail(promise.setFail);
        return promise;
      }
      SP.request(this._prefix + '_snapshot', [
        descriptor,
        offset,
        length,
        raw
      ], promise, promise.setDone, promise.setFail);
      return promise;
    };
    BridgeCollection.prototype.add = function (items) {
      var args = SP.uris(arguments);
      args.unshift(this.descriptor);
      return promisedRequest(this, this._prefix + '_append', args);
    };
    BridgeCollection.prototype.clear = function () {
      return promisedRequest(this, this._prefix + '_clear', [this.descriptor]);
    };
    BridgeCollection.prototype.clone = function (opt_newDescriptor) {
      return new BridgeCollection(this.type, this.uri, this._prefix, opt_newDescriptor || this.descriptor, this._factory);
    };
    BridgeCollection.prototype.insert = function (ref, items) {
      var args = [
        this.descriptor,
        ref.index,
        ref.uri
      ];
      var uris = SP.uris(arguments, 1);
      return promisedRequest(this, this._prefix + '_insert', args.concat(uris));
    };
    BridgeCollection.prototype.remove = function (ref) {
      return promisedRequest(this, this._prefix + '_remove', [
        this.descriptor,
        ref.index,
        ref.uri
      ]);
    };
    BridgeCollection.prototype.trim = function (ref) {
      return promisedRequest(this, this._prefix + '_trim', [
        this.descriptor,
        ref.index,
        ref.uri
      ]);
    };
    BridgeCollection.prototype.contains = function (items) {
      var args = SP.uris(arguments);
      args.unshift(this.descriptor);
      var promise = new Promise();
      var done = function (val) {
        if (args.length == 2 && !(items instanceof Array))
          promise.object = val.in_collection[0];
        else
          promise.object = val.in_collection;
        promise.setDone();
      };
      SP.request(this._prefix + '_contains', args, promise, done, promise.setFail);
      return promise;
    };
    function Context(uri) {
      Loadable.call(this);
      this.resolve('uri', uri);
    }
    SP.inherit(Context, Loadable);
    Loadable.define(Context, ['uri']);
    Context.prototype.toString = function () {
      return this.uri;
    };
    Context.fromURI = function (uri) {
      return new Context(uri);
    };
    function Group() {
      Loadable.call(this);
      this.resolve('descriptor', ListDescriptor.createConcatenated([]));
    }
    SP.inherit(Group, Loadable);
    Loadable.define(Group, ['descriptor']);
    Group.prototype.add = function (context) {
      var descriptor = context.descriptor || ListDescriptor.create(context.uri);
      this.descriptor.lists.push(descriptor);
    };
    Group.create = function () {
      var group = new Group();
      var promise = new Promise();
      promise.setDone(group);
      return promise;
    };
    function Player(id) {
      BridgeLoadable.call(this);
      this.resolve('id', id);
    }
    SP.inherit(Player, BridgeLoadable);
    Loadable.define(Player, [
      'context',
      'contexts',
      'duration',
      'id',
      'index',
      'playing',
      'repeat',
      'shuffle',
      'track',
      'volume'
    ], '_query');
    Loadable.define(Player, ['position'], '_position');
    Player.prototype._observed = function () {
      this.bridgeListen('player_event_wait', [this.id]);
    };
    Player.prototype.eventDone = function (event) {
      Player._superClass.eventDone.call(this, event);
      this._queryPosition();
    };
    Player.prototype._make_context = function (value) {
      return value && Context.fromURI(value.uri, value);
    };
    Player.prototype._make_track = function (value) {
      return value && Track.fromURI(value.uri, value);
    };
    Player.prototype._query = function (propsMask) {
      var load = function (data) {
        delete data.position;
        this.resolveMany(propsMask, data);
      };
      var fail = function (error) {
        this.resolveFail(propsMask, error);
      };
      SP.request('player_query', [this.id], this, load, fail);
      this.bridgeListen('player_event_wait', [this.id]);
    };
    Player.prototype._position = function (propsMask) {
      this._needsPosition = true;
      this._queryPosition(true);
    };
    Player.prototype._queryPosition = function (opt_immediate) {
      if (this._needsPosition) {
        if (opt_immediate || !this._pq && this.playing) {
          var time = opt_immediate ? 0 : 900;
          var self = this;
          this._pq = setTimeout(function () {
            SP.request('player_query', [self.id], self, self._progress);
          }, time);
        }
      }
    };
    Player.prototype._progress = function (data) {
      this._pq = null;
      this.resolve('position', data.position, true);
      delete data.position;
      this.resolveMany(0, data);
      this._queryPosition();
    };
    Player.prototype.mapTrackIdentifiers = function (map) {
      return promisedRequest(this, 'player_map_track_identifiers', [
        this.id,
        map
      ]);
    };
    Player.prototype.setVolume = function (volume) {
      return promisedRequest(this, 'player_set_volume', [
        this.id,
        volume
      ]);
    };
    Player.prototype.setRepeat = function (enabled) {
      return promisedRequest(this, 'player_set_repeat', [
        this.id,
        enabled
      ]);
    };
    Player.prototype.setShuffle = function (enabled) {
      return promisedRequest(this, 'player_set_shuffle', [
        this.id,
        enabled
      ]);
    };
    Player.prototype.play = function () {
      return promisedRequest(this, 'player_play', [this.id]);
    };
    Player.prototype.pause = function () {
      return promisedRequest(this, 'player_pause', [this.id]);
    };
    Player.prototype.stop = function () {
      return promisedRequest(this, 'player_stop', [this.id]);
    };
    Player.prototype.playTrack = function (track, ms, duration) {
      return promisedRequest(this, 'player_play_track', [
        this.id,
        track.uri,
        ms || 0,
        duration != undefined ? duration : -1
      ]);
    };
    Player.prototype.playContext = function (context, index, ms, duration) {
      if (index == null)
        index = -1;
      var descriptor = context.descriptor || ListDescriptor.create(context.uri);
      return promisedRequest(this, 'player_play_context', [
        this.id,
        descriptor,
        index,
        ms || 0,
        duration != undefined ? duration : -1
      ]);
    };
    Player.prototype.playContextGroup = function (group, contextIndex, index, ms) {
      if (contextIndex == undefined)
        contextIndex = -1;
      if (index == undefined)
        index = -1;
      return promisedRequest(this, 'player_play_context_group', [
        this.id,
        group.descriptor,
        contextIndex,
        index,
        ms || 0
      ]);
    };
    Player.prototype.skipToPrevTrack = function () {
      return promisedRequest(this, 'player_skip_to_prev', [this.id]);
    };
    Player.prototype.skipToNextTrack = function () {
      return promisedRequest(this, 'player_skip_to_next', [this.id]);
    };
    Player.prototype.seek = function (ms) {
      return promisedRequest(this, 'player_seek', [
        this.id,
        ms
      ]);
    };
    function Playlist(uri) {
      MdL.call(this);
      this.resolve('uri', uri);
    }
    SP.inherit(Playlist, MdL);
    Loadable.define(Playlist, ['uri']);
    Loadable.define(Playlist, [
      'allows',
      'collaborative',
      'description',
      'subscribed',
      'name',
      'owner',
      'published'
    ], '_metadata');
    Loadable.define(Playlist, [
      'image',
      'images'
    ], '_profile');
    Loadable.define(Playlist, [
      'subscribers',
      'tracks'
    ], '_collections');
    Loadable.define(Playlist, ['popularity'], '_popularity');
    MdL.init(Playlist, 'playlist');
    Playlist.prototype._make_owner = function (value) {
      return value && User.fromURI(value.uri, value);
    };
    Playlist.prototype._collections = function () {
      this.resolve('subscribers', new BridgeCollection(User, this.uri, 'playlist_subscribers'));
      this.resolve('tracks', new BridgeCollection(Track, this.uri, 'playlist_tracks'));
      this.resolveDone();
    };
    Playlist.prototype._popularity = function (propsMask) {
      var load = function (data) {
        this.resolveMany(propsMask, data);
      };
      var fail = function (oops) {
        this.resolveFail(propsMask, oops);
      };
      SP.request('playlist_popularity', [this.uri], this, load, fail);
    };
    Playlist._libraryListener = null;
    Playlist.fromURI = Cache.lookup;
    Playlist.fromURIs = Cache.lookupMany;
    Playlist._cache = new Cache(Playlist);
    Playlist.createTemporary = function (name) {
      var promise = new Promise();
      var done = function (result) {
        var playlist = new Playlist(result.uri);
        Playlist._cache.cache(result.uri, playlist);
        playlist.resolve('name', name);
        promise.setDone(playlist);
      };
      SP.request('playlist_create_temporary', [name], promise, done, promise.setFail);
      return promise;
    };
    Playlist.removeTemporary = function (playlist) {
      var promise = new Promise();
      var done = function (result) {
        Playlist._cache.remove(playlist.uri);
        promise.setDone();
      };
      SP.request('playlist_remove_temporary', [playlist.name], promise, done, promise.setFail);
      return promise;
    };
    Playlist.create = function (name) {
      var promise = new Promise();
      var done = function (result) {
        var playlist = new Playlist(result.uri);
        Playlist._cache.cache(result.uri, playlist);
        playlist.resolve('name', name);
        promise.setDone(playlist);
      };
      SP.request('playlist_create', [name], promise, done, promise.setFail);
      return promise;
    };
    Playlist.getOrCreateLibraryListener = function () {
      var listener = Playlist._libraryListener;
      if (!listener) {
        listener = new ProxyListener();
        listener.bridgeListen('library_event_wait', [exports.session.user.uri]);
        listener.filter(function (evt) {
          if (evt.type != 'insert' && evt.type != 'remove')
            return;
          var newState = evt.type == 'insert';
          switch (evt.receiver) {
          case 'playlists':
            Playlist._cache.update(evt.uris, { subscribed: newState });
            break;
          case 'published':
            Playlist._cache.update(evt.uris, { published: newState });
            break;
          }
        });
        Playlist._libraryListener = listener;
      }
      return listener;
    };
    Playlist.prototype.resolveMany = function (propsMask, data, opt_silent) {
      if (data && this._hasStaticName()) {
        delete data.name;
      }
      Playlist._superClass.resolveMany.call(this, propsMask, data, opt_silent);
    };
    Playlist.prototype.load = function () {
      var args = SP.varargs(arguments);
      if (Array.prototype.indexOf.call(args, 'subscribed') >= 0) {
        Playlist.getOrCreateLibraryListener();
      }
      var nameIndex;
      if ((nameIndex = Array.prototype.indexOf.call(args, 'name')) !== -1 && this._hasStaticName()) {
        var argsWithoutName = Array.prototype.slice.call(args, 0);
        argsWithoutName.splice(nameIndex, 1);
        var argsWithoutNamePromise = Playlist._superClass.load.apply(this, argsWithoutName);
        var promise = new Promise(this);
        Promise.join(argsWithoutNamePromise, this._loadStaticName()).done(function () {
          promise.setDone();
        }).fail(function () {
          promise.setFail();
        });
        return promise;
      } else {
        return Playlist._superClass.load.apply(this, args);
      }
    };
    Playlist._rStaticName = /^spotify:user:[^:]+:(starred|toplist|top:tracks)$/;
    Playlist.prototype._hasStaticName = function () {
      return Playlist._rStaticName.test(this.uri);
    };
    Playlist.prototype._loadStaticName = function () {
      var promise = new Promise(this);
      var matches = this.uri.match(Playlist._rStaticName);
      var type = matches && matches[1];
      if (type) {
        if (type == 'top:tracks') {
          type = 'toplist';
        }
        if (!Playlist._langStrings) {
          var self = this;
          (function (playlistStrings) {
            Playlist._langStrings = playlistStrings;
            self._resolveStaticName(type);
            promise.setDone();
          }(require('node_modules/api/@loc.loc/strings/playlist.lang')));
        } else {
          this._resolveStaticName(type);
          promise.setDone();
        }
      } else {
        promise.setFail('Invalid type');
      }
      return promise;
    };
    Playlist._stringKeyByType = {
      starred: 'Starred',
      toplist: 'Toplist'
    };
    Playlist.prototype._resolveStaticName = function (type) {
      var stringKey = Playlist._stringKeyByType[type];
      this.resolve('name', Playlist._langStrings.get(stringKey));
    };
    Playlist.prototype._observed = function () {
      this.bridgeListen('playlist_event_wait', [this.uri]);
    };
    Playlist.prototype.eventFail = function (error) {
      if (!this._obcount)
        this.bridgeUnlisten();
      Playlist._superClass.eventFail.call(this, error);
    };
    Playlist.prototype.setDescription = function (description) {
      return promisedRequest(this, 'playlist_set_description', [
        this.uri,
        description
      ], true);
    };
    Playlist.prototype.setImage = function (imageUrl) {
      return promisedRequest(this, 'playlist_set_image', [
        this.uri,
        imageUrl
      ], true);
    };
    Playlist.prototype.setName = function (name) {
      return promisedRequest(this, 'playlist_set_name', [
        this.uri,
        name
      ], true);
    };
    Playlist.prototype.setSource = function (source, link) {
      return promisedRequest(this, 'playlist_set_source', [
        this.uri,
        source,
        link
      ]);
    };
    Playlist.prototype.enforceRules = function (rules) {
      return promisedRequest(this, 'playlist_enforce_rules', [
        this.uri,
        rules
      ]);
    };
    function Profile(uri) {
      MdL.call(this);
      this.resolve('uri', uri);
    }
    SP.inherit(Profile, MdL);
    Profile.fromURI = Cache.lookup;
    Profile.fromURIs = Cache.lookupMany;
    Profile._cache = new Cache(Profile);
    Loadable.define(Profile, ['uri']);
    Loadable.define(Profile, [
      'artist',
      'user'
    ], '_loadArtistOrUser');
    Loadable.define(Profile, [
      'name',
      'image',
      'images'
    ], '_metadata');
    Profile.prototype._make_artist = function (uri) {
      return Artist.fromURI(uri);
    };
    Profile.prototype._make_user = function (uri) {
      return User.fromURI(uri);
    };
    Profile.prototype._loadArtistOrUser = function (propsMask) {
      var object = exports.fromURI(this.uri), promise;
      if (object instanceof Artist) {
        promise = object.load('user').done(this, function () {
          var uri = object.user ? object.user.uri : null;
          this.resolveMany(propsMask, {
            artist: object.uri,
            user: uri
          });
        });
      } else if (object instanceof User) {
        promise = object.load('artist').done(this, function () {
          var uri = object.artist ? object.artist.uri : null;
          this.resolveMany(propsMask, {
            artist: uri,
            user: object.uri
          });
        });
      } else {
        throw new Error('Invalid URI for Profile');
      }
      promise.fail(this, function () {
        this.resolveFail(propsMask, { message: 'Failed to resolve artist/user objects' });
      });
    };
    Profile.prototype._metadata = function (propsMask) {
      this.load('artist', 'user').done(this, function () {
        if (this.user) {
          this.user.load('name', 'username', 'image', 'images').done(this, function () {
            var data = {
              name: this.user.name,
              image: this.user.image,
              images: this.user.images
            };
            var nameDefined = data.name && data.name.toLowerCase() !== this.user.username, imageUploaded = data.image;
            if (!this.artist || nameDefined && imageUploaded)
              return this.resolveMany(propsMask, data);
            this.artist.load('name', 'image', 'images').done(this, function (artist) {
              if (!nameDefined)
                data.name = artist.name;
              if (!imageUploaded) {
                data.image = artist.image;
                data.images = artist.images;
              }
            }).always(this, function () {
              this.resolveMany(propsMask, data);
            });
          }).fail(this, function (_, error) {
            this.resolveFail(propsMask, error);
          });
        } else {
          this.artist.load('name', 'image', 'images').done(this, function (artist) {
            this.resolveMany(propsMask, {
              name: artist.name,
              image: artist.image,
              images: artist.images
            });
          }).fail(this, function (_, error) {
            this.resolveFail(propsMask, error);
          });
        }
      });
    };
    Playlist._playlistEventWait = function () {
      SP.request('playlist_event_wait_any', [], this, this._playlistEventDone, this._playlistEventFail);
    };
    Playlist._playlistEventDone = function (event) {
      var playlist = Playlist.fromURI(event.data.uri);
      playlist.resolveMany(0, event.data);
      playlist.dispatchEvent(event);
      this._playlistEventWait();
    };
    Playlist._playlistEventFail = function (error) {
      if (error.error == 'timeout')
        this._playlistEventWait();
    };
    function Reference(index, uri) {
      this.index = index;
      this.uri = uri;
    }
    function Session() {
      BridgeLoadable.call(this);
      this.resolve('user', User.fromURI('spotify:user:@'));
    }
    SP.inherit(Session, BridgeLoadable);
    Loadable.define(Session, ['user']);
    Loadable.define(Session, [
      'catalogue',
      'connecting',
      'connection',
      'country',
      'developer',
      'device',
      'incognito',
      'language',
      'online',
      'partner',
      'product',
      'resolution',
      'streaming',
      'testGroup',
      'capabilities'
    ], '_query');
    Session.prototype._observed = function () {
      this.bridgeListen('session_event_wait', []);
    };
    Session.prototype._query = function (propsMask) {
      var load = function (data) {
        this.resolveMany(propsMask, data);
      };
      var fail = function (oops) {
        this.resolveFail(propsMask, oops);
      };
      SP.request('session_query', [], this, load, fail);
    };
    Session.prototype.testGroupForTest = function (name) {
      var promise = new Promise();
      SP.request('session_test_group', [name], promise, function (result) {
        this.setDone(result.testGroup);
      }, Promise.setFail);
      return promise;
    };
    function Snapshot(collection, opt_start, opt_length, opt_raw) {
      Loadable.call(this);
      this._collection = collection;
      this._off = opt_start === undefined ? 0 : opt_start;
      this._len = opt_length === undefined ? -1 : opt_length;
      this._raw = !!opt_raw;
    }
    SP.inherit(Snapshot, Loadable);
    Loadable.define(Snapshot, [
      'length',
      'range'
    ], '_request');
    Snapshot.prototype._request = function () {
      var col = this._collection;
      col._snapshot(col.descriptor, this._off, this._len, this._raw).done(this, function (result) {
        this._uris = result.array;
        this._meta = result.metadata || [];
        this.resolve('length', result.length);
        this.resolve('range', {
          offset: this._off,
          length: this._uris.length
        });
        this.resolveDone();
      }).fail(this, function (error) {
        var propsMask = this._neededForLoad([
          'length',
          'range'
        ]);
        this.resolveFail(propsMask, error);
      });
    };
    Snapshot.prototype.get = function (index) {
      if (index instanceof Reference)
        index = index.index;
      index -= this._off;
      if (index < 0 || index > this._uris.length)
        return null;
      return this._collection._factory(this._uris[index], this._meta[index]);
    };
    Snapshot.prototype.find = function (item, first) {
      if (first instanceof Reference)
        first = first.index;
      var index = this._uris.indexOf(item.uri, first || 0);
      return index == -1 ? null : new Reference(index + this._off, this._uris[index]);
    };
    Snapshot.prototype.loadAll = function () {
      var promises = [], items = this.toArray();
      for (var i = 0, len = items.length; i < len; i++) {
        var item = items[i];
        promises.push(item.load.apply(item, arguments));
      }
      return Promise.join(promises);
    };
    Snapshot.prototype.ref = function (index) {
      var item = this.get(index);
      return new Reference(index, item ? item.uri : null);
    };
    Snapshot.prototype.toArray = function () {
      var array = [], col = this._collection;
      for (var i = 0, l = this._uris.length; i < l; i++)
        array[i] = col._factory(this._uris[i], this._meta[i]);
      return array;
    };
    Snapshot.prototype.toURIs = function () {
      return this._uris.slice();
    };
    function Track(uri) {
      MdL.call(this);
      this.resolve('uri', uri);
    }
    SP.inherit(Track, MdL);
    Loadable.define(Track, ['uri']);
    Loadable.define(Track, [
      'ad_metadata',
      'advertisement',
      'album',
      'artists',
      'availability',
      'disc',
      'duration',
      'explicit',
      'image',
      'images',
      'local',
      'name',
      'number',
      'placeholder',
      'playable',
      'popularity',
      'starred'
    ], '_metadata');
    MdL.init(Track, 'track');
    Track.prototype._make_album = function (value) {
      return value && Album.fromURI(value.uri, value);
    };
    Track.prototype._make_artists = function (value) {
      return value && value.map(_artists);
    };
    Track.fromURI = Cache.lookup;
    Track.fromURIs = Cache.lookupMany;
    Track._cache = new Cache(Track);
    Track.prototype.star = function () {
      return promisedRequest(this, 'library_star', [
        exports.session.user.uri,
        this.uri
      ]);
    };
    Track.prototype.unstar = function () {
      return promisedRequest(this, 'library_unstar', [
        exports.session.user.uri,
        this.uri
      ]);
    };
    Track._trackEventWait = function () {
      SP.request('track_event_wait_any', [], this, this._trackEventDone, this._trackEventFail);
    };
    Track._trackEventDone = function (event) {
      var track = Track.fromURI(event.data.uri);
      track.resolveMany(0, event.data);
      track.dispatchEvent(event);
      this._trackEventWait();
    };
    Track._trackEventFail = function (error) {
      if (error.error == 'timeout')
        this._trackEventWait();
    };
    function User(uri) {
      MdL.call(this);
      this.resolve('uri', uri);
    }
    SP.inherit(User, MdL);
    Loadable.define(User, ['uri']);
    Loadable.define(User, [
      'currentUser',
      'identifier',
      'image',
      'images',
      'name',
      'subscribed',
      'username'
    ], '_metadata');
    Loadable.define(User, ['artist'], '_associatedArtist');
    MdL.init(User, 'user');
    User.prototype._associatedArtist = function (propsMask) {
      var load = function (data) {
        this.resolveMany(propsMask, data);
      };
      var fail = function (oops) {
        this.resolveFail(propsMask, oops);
      };
      SP.request('user_associated_artist', [this.uri], this, load, fail);
    };
    User.prototype._make_artist = function (value) {
      return value && Artist.fromURI(value);
    };
    User._relationsListener = null;
    User.fromURI = Cache.lookup;
    User.fromURIs = Cache.lookupMany;
    User._cache = new Cache(User);
    User.fromUsername = function (username) {
      var escaped = encodeURIComponent(username), i = -1;
      while ((i = escaped.indexOf('%', i + 1)) > -1) {
        escaped = escaped.substring(0, i + 1) + escaped.substring(i + 1, i + 3).toLowerCase() + escaped.substring(i + 3);
      }
      return User.fromURI('spotify:user:' + escaped);
    };
    User.getOrCreateRelationsListener = function () {
      var listener = User._relationsListener;
      if (!listener) {
        listener = new ProxyListener();
        listener.bridgeListen('relations_event_wait', [exports.session.user.uri]);
        listener.filter(function (evt) {
          if (evt.receiver != 'subscriptions' || evt.type != 'add' && evt.type != 'remove')
            return;
          User._cache.update(evt.uris, { subscribed: evt.type == 'add' });
        });
        User._relationsListener = listener;
      }
      return listener;
    };
    User.prototype.load = function () {
      var args = SP.varargs(arguments);
      if (Array.prototype.indexOf.call(args, 'subscribed') >= 0) {
        User.getOrCreateRelationsListener();
      }
      return User._superClass.load.apply(this, args);
    };
    var fromURI = function (uri, opt_data) {
      var parts = uri.split(':');
      var result = null;
      switch (parts[1]) {
      case 'album':
        if (parts.length == 4)
          result = Disc.fromURI(uri, opt_data);
        else if (parts.length == 3)
          result = Album.fromURI(uri, opt_data);
        break;
      case 'artist':
        if (parts.length == 3)
          result = Artist.fromURI(uri, opt_data);
        break;
      case 'track':
        if (parts.length == 3)
          result = Track.fromURI(uri, opt_data);
        break;
      case 'local':
        if (parts.length === 6)
          result = Track.fromURI(uri, opt_data);
        else if (parts.length === 4)
          result = Album.fromURI(uri, opt_data);
        else if (parts.length === 3)
          result = Artist.fromURI(uri, opt_data);
        break;
      case 'user':
        if (parts.length > 3 && parts[3] == 'collection')
          return new BridgeCollection(Track, uri, 'library_tracks');
        if (parts.length > 3 && parts.length <= 5 && parts[2] != 'facebook')
          result = Playlist.fromURI(uri, opt_data);
        else if (parts.length == 3)
          result = User.fromURI(uri, opt_data);
        break;
      }
      return result;
    };
    Playlist._playlistEventWait();
    Track._trackEventWait();
    exports.Observable = Observable;
    exports.Loadable = Loadable;
    exports.BridgeLoadable = BridgeLoadable;
    exports.MdL = MdL;
    exports.Album = Album;
    exports.Application = Application;
    exports.Artist = Artist;
    exports.Cache = Cache;
    exports.Client = Client;
    exports.Collection = Collection;
    exports.BridgeCollection = BridgeCollection;
    exports.Context = Context;
    exports.Disc = Disc;
    exports.Group = Group;
    exports.ListDescriptor = ListDescriptor;
    exports.Player = Player;
    exports.Playlist = Playlist;
    exports.Profile = Profile;
    exports.Promise = Promise;
    exports.Session = Session;
    exports.Track = Track;
    exports.User = User;
    exports.application = new Application();
    exports.client = new Client();
    exports.fromURI = fromURI;
    exports.player = new Player('main');
    exports.preview = new Player('preview');
    exports.promisedRequest = promisedRequest;
    exports.session = new Session();
  },
  'scripts/contextwidget.view.renameplaylist.js': function (require, module, exports, global, __filename, __dirname) {
    (function (models, utils, localeStrings) {
      exports.RenamePlaylistView = RenamePlaylistView;
      function RenamePlaylistView(options) {
        this.node = options.node;
        this._eventManager = options.eventManager;
        this._currentContext = null;
        this._l = localeStrings.get.bind(localeStrings);
        this._renamePlaylistBackButton = document.getElementById('rename-header');
        this._renamePlaylistInput = document.getElementById('rename-playlist-name');
        this._renamePlaylistLabel = document.getElementById('rename-playlist-label');
        this._renamePlaylistButton = document.getElementById('rename-button');
        this._renameInputClear = document.getElementById('rename-input-clear');
        this._renamePlaylistHeader = document.getElementById('rename-playlist-header');
        this._renamePlaylistInputWrap = this._renamePlaylistHeader.querySelector('input-wrap');
        this._doLocale();
        this._addEventListeners();
      }
      RenamePlaylistView.prototype._doLocale = function () {
        this._renamePlaylistHeader.innerHTML = this._l('rename-playlist');
        this._renamePlaylistLabel.innerHTML = this._l('name');
        this._renamePlaylistButton.innerHTML = this._l('rename-playlist');
      };
      RenamePlaylistView.prototype.setContext = function (currentContext) {
        this._currentContext = currentContext;
      };
      RenamePlaylistView.prototype.setPlaylist = function (currentPlaylist) {
      };
      RenamePlaylistView.prototype.activate = function (currentContext, currentPlaylist) {
        var self = this;
        self._currentContext = currentContext;
        self.clearRenameInput();
        self.focusRenameInput();
        self._renamePlaylistButton._disabled = false;
        self._currentContext.load('name').done(function (playlist) {
          self._clearPlaceholder();
          self._renamePlaylistInput.value = playlist.name;
          self._updateClearButton();
        });
      };
      RenamePlaylistView.prototype._addEventListeners = function () {
        var self = this;
        this._renamePlaylistBackButton.addEventListener('click', function (e) {
          e.preventDefault();
          self._eventManager.trigger(self._eventManager.Events.ACTIVATE_VIEW, 'to-mainmenu');
        });
        this._renamePlaylistBackButton.addEventListener('focus', function (e) {
          self._eventManager.trigger(self._eventManager.Events.ACTIVATE_VIEW, 'to-renameplaylist');
        }, false);
        this._renamePlaylistButton.addEventListener('click', function (e) {
          e.preventDefault();
          self._handleRenamePlaylistAction(e);
        });
        this._renamePlaylistInput.addEventListener('keydown', function (e) {
          self._clearPlaceholder();
        }, false);
        this._renamePlaylistInput.addEventListener('keyup', function (e) {
          if (e.keyCode === 13) {
            self._handleRenamePlaylistAction(e);
            return false;
          }
          self._updateClearButton();
          self._restorePlaceholder();
        }, false);
        this._renamePlaylistInput.addEventListener('blur', function (e) {
          self._restorePlaceholder();
        }, false);
        this._renameInputClear.addEventListener('click', function (e) {
          e.preventDefault();
          self.clearRenameInput();
        });
      };
      RenamePlaylistView.prototype._updateClearButton = function () {
        if (this._renamePlaylistInput.value === '') {
          this._renameInputClear.style.display = 'none';
        } else {
          this._renameInputClear.style.display = 'block';
        }
      };
      RenamePlaylistView.prototype._clearPlaceholder = function () {
        this._renamePlaylistLabel.style.display = 'none';
      };
      RenamePlaylistView.prototype._restorePlaceholder = function () {
        if (this._renamePlaylistInput.value === '') {
          this._renamePlaylistLabel.style.display = 'block';
        }
      };
      RenamePlaylistView.prototype.focusRenameInput = function () {
        var i = this._renamePlaylistInput;
        setTimeout(function () {
          i.focus();
          i.select();
        }, 300);
        utils.removeClass(this._renamePlaylistInput, 'error');
      };
      RenamePlaylistView.prototype.clearRenameInput = function () {
        this._renamePlaylistInput.value = '';
        this._updateClearButton();
        utils.removeClass(this._renamePlaylistInput, 'error');
        this._restorePlaceholder();
      };
      RenamePlaylistView.prototype._handleRenamePlaylistAction = function (e) {
        var self = this;
        e.preventDefault();
        if (self._renamePlaylistButton._disabled) {
          return false;
        }
        self._renamePlaylistButton._disabled = true;
        self._renamePlaylist(self._renamePlaylistInput, function (pl) {
          self._eventManager.trigger(self._eventManager.Events.CLOSE);
        });
      };
      RenamePlaylistView.prototype._renamePlaylist = function (nameInput, cb) {
        var self = this;
        var name = nameInput.value;
        if (!name || name === '') {
          utils.addClass(nameInput, 'error');
          self._renamePlaylistButton._disabled = false;
          return false;
        } else {
          utils.removeClass(nameInput, 'error');
        }
        this._currentContext.setName(name).done(function (playlist) {
          self._renamePlaylistButton._disabled = false;
          cb(playlist);
        }).fail(function () {
          cb(null);
        });
      };
    }(require('node_modules/api/scripts/models.js'), require('scripts/playlist-utils.js'), require('@loc.loc/strings/main.lang')));
  },
  'node_modules/api/scripts/hermes.js': function (require, module, exports, global, __filename, __dirname) {
    (function (models) {
      var Loadable = models.Loadable;
      var Promise = models.Promise;
      var ReadyState = {
        CONNECTING: 0,
        OPEN: 1,
        CLOSING: 2,
        CLOSED: 3
      };
      function _type(type) {
        return type.schema.id + '#' + type.name;
      }
      function Hermes() {
      }
      Hermes.get = function (uri, resultTypes, argumentTypes, timeout) {
        return new Request('GET', uri, resultTypes, argumentTypes, timeout);
      };
      Hermes.request = function (method, uri, resultTypes, argumentTypes, timeout) {
        return new Request(method, uri, resultTypes, argumentTypes, timeout);
      };
      Hermes.subscribe = function (uri, resultTypes, argumentTypes, args) {
        var promise = new models.Promise();
        var done = function (data) {
          promise.setDone(new Subscription(data.subscription_id));
        };
        var fail = function (_, error) {
          promise.setFail(error);
        };
        var rload = Promise.join(resultTypes.map(function (type) {
          return type.schema.load('id');
        }));
        var aload = Promise.join(argumentTypes.map(function (type) {
          return type.schema.load('id');
        }));
        Promise.join(rload, aload).done(function () {
          var rtypes = resultTypes.map(_type);
          var atypes = argumentTypes.map(_type);
          SP.request('hermes_subscribe', [
            uri,
            rtypes,
            atypes,
            args
          ], null, done, fail);
        }).fail(fail);
        return promise;
      };
      function Request(method, uri, resultTypes, argumentTypes, timeout) {
        Loadable.call(this);
        this.resolve('uri', uri);
        this.resolve('method', method);
        this.resolve('timeout', timeout || 0);
        this._rtypes = resultTypes;
        this._atypes = argumentTypes;
        var rload = Promise.join(this._rtypes.map(function (type) {
          return type.schema.load('id');
        }));
        var aload = Promise.join(this._atypes.map(function (type) {
          return type.schema.load('id');
        }));
        this._load = Promise.join(rload, aload);
      }
      SP.inherit(Request, Loadable);
      Loadable.define(Request, [
        'uri',
        'method',
        'timeout'
      ]);
      Request.prototype.send = function (var_args) {
        var promise = new Promise();
        var request = this;
        var reqArg = [].slice.call(arguments);
        this._load.done(function () {
          var done = function (data) {
            promise.setDone(data.result);
          };
          var rtypes = request._rtypes.map(_type);
          var atypes = request._atypes.map(_type);
          var requestArgs = [
            request.uri,
            request.method,
            rtypes,
            atypes,
            reqArg,
            request.timeout
          ];
          SP.request('hermes_send_request', requestArgs, promise, done, promise.setFail);
        }).fail(function (o, error) {
          promise.setFail(error);
        });
        return promise;
      };
      function Schema(urls) {
        Loadable.call(this);
        this._urls = urls;
      }
      SP.inherit(Schema, Loadable);
      Loadable.define(Schema, ['id'], '_register');
      Schema.fromURL = function (urls) {
        if (typeof urls === 'string')
          urls = [urls];
        return new this(urls);
      };
      Schema.prototype.type = function (name) {
        return {
          schema: this,
          name: name
        };
      };
      Schema.prototype._register = function (propsMask) {
        var load = function (data) {
          this.resolveMany(propsMask, data);
        };
        var fail = function (oops) {
          this.resolveFail(propsMask, oops);
        };
        SP.request('hermes_register_schema', this._urls, this, load, fail);
      };
      function Subscription(id) {
        models.BridgeLoadable.call(this);
        this.readyState = ReadyState.OPEN;
        this._id = id;
      }
      SP.inherit(Subscription, models.BridgeLoadable);
      Subscription.prototype._observed = function () {
        if (this.readyState != ReadyState.OPEN)
          return;
        this.bridgeListen('hermes_event_wait', [this._id]);
        this.addEventListener('close', function onClose() {
          this.removeEventListener('close', onClose);
          this.bridgeUnlisten();
          this.readyState = ReadyState.CLOSED;
        });
      };
      Subscription.prototype.close = function () {
        if (this.readyState != ReadyState.OPEN)
          return;
        this.readyState = ReadyState.CLOSING;
        SP.request('hermes_unsubscribe', [this._id]);
      };
      exports.Hermes = Hermes;
      exports.ReadyState = ReadyState;
      exports.Schema = Schema;
      exports.Subscription = Subscription;
    }(require('node_modules/api/scripts/models.js')));
  },
  'node_modules/api/scripts/library.js': function (require, module, exports, global, __filename, __dirname) {
    (function (models, hermes) {
      var slice = Array.prototype.slice;
      function _updateStarredCache(evt) {
        models.Track._cache.update(evt.uris, { starred: evt.type == 'insert' });
      }
      function Library(uri) {
        models.BridgeLoadable.call(this);
        var self = this;
        var owner = models.User.fromURI(uri);
        this._initPromise = models.Promise.join([
          models.session.load('device'),
          owner.load('username')
        ]);
        this._initPromise.done(function () {
          self._useBridgeForCollection = models.session.device === 'desktop';
        });
        this.resolve('owner', owner);
        this.resolve('tracks', new LibraryTracksCollection(this, owner));
        this.resolve('albums', new LibraryAlbumsCollection(this, owner));
        this.resolve('artists', null);
        this.resolve('playlists', new models.BridgeCollection(models.Playlist, null, 'library_playlists', owner.uri));
        this.resolve('published', new models.BridgeCollection(models.Playlist, null, 'library_published', owner.uri));
        this.resolve('starred', models.Playlist.fromURI(owner.uri + ':starred'));
        this.resolve('toplist', models.Playlist.fromURI(owner.uri + ':toplist'));
        if (owner.uri == models.session.user.uri) {
          models.Playlist.getOrCreateLibraryListener().proxyTo(this);
          this.starred.addEventListener('insert', _updateStarredCache);
          this.starred.addEventListener('remove', _updateStarredCache);
        } else {
          var observedHandler = function () {
            self.bridgeListen('library_event_wait', [owner.uri]);
          };
          this.playlists._observed = observedHandler;
          this.published._observed = observedHandler;
        }
      }
      SP.inherit(Library, models.BridgeLoadable);
      Library.fromURI = models.Cache.lookup;
      Library._cache = new models.Cache(Library);
      models.Loadable.define(Library, [
        'albums',
        'artists',
        'owner',
        'playlists',
        'published',
        'starred',
        'toplist',
        'tracks'
      ]);
      Library.Item;
      Library.prototype.publish = function (playlists) {
        return models.promisedRequest(this, 'library_publish', [this.owner.uri].concat(SP.uris(arguments)));
      };
      Library.prototype.star = function (items) {
        return models.promisedRequest(this, 'library_star', [this.owner.uri].concat(SP.uris(arguments)));
      };
      Library.prototype.subscribe = function (items) {
        return models.promisedRequest(this, 'library_subscribe', [this.owner.uri].concat(SP.uris(arguments)));
      };
      Library.prototype.unpublish = function (playlists) {
        return models.promisedRequest(this, 'library_unpublish', [this.owner.uri].concat(SP.uris(arguments)));
      };
      Library.prototype.unstar = function (items) {
        return models.promisedRequest(this, 'library_unstar', [this.owner.uri].concat(SP.uris(arguments)));
      };
      Library.prototype.unsubscribe = function (items) {
        return models.promisedRequest(this, 'library_unsubscribe', [this.owner.uri].concat(SP.uris(arguments)));
      };
      Library.prototype.getUnionSources = function (item) {
        var promise = new models.Promise();
        promise.setDone({
          collection: true,
          playlists: []
        });
        return promise;
      };
      Library.prototype._urisToIds = function (uris) {
        return uris.map(function (uri) {
          return uri.substr(-22);
        });
      };
      Library.forCurrentUser = function () {
        return Library.forUser(models.session.user);
      };
      Library.forUser = function (user) {
        return Library.fromURI(user.uri);
      };
      function AbstractLibraryCollection(library, owner, uri, itemClass, entityName) {
        this._library = library;
        this.owner = owner;
        this.entityName = entityName;
        this.requestPrefix = 'library_' + entityName;
        models.BridgeCollection.call(this, itemClass, uri, self.requestPrefix, owner.uri);
      }
      SP.inherit(AbstractLibraryCollection, models.BridgeCollection);
      AbstractLibraryCollection.prototype.makeUri = function (resource) {
        return 'hm://collection-web/v1/' + encodeURIComponent(this.owner.username) + (resource || '') + '/' + this.entityName;
      };
      AbstractLibraryCollection.prototype.contains = function (items) {
        var self = this;
        var uris = SP.uris(arguments);
        var promise = new models.Promise();
        if (!items || items.length == 0) {
          if (!Array.isArray(items))
            promise.setDone(false);
          else
            promise.setDone(uris.map(function () {
              return false;
            }));
          return promise;
        }
        this._library._initPromise.done(function () {
          if (self._library._useBridgeForCollection) {
            var done = function (val) {
              if (!Array.isArray(items))
                promise.setDone(val.in_collection[0]);
              else
                promise.setDone(val.in_collection);
            };
            SP.request(self.requestPrefix + '_contains', [self.descriptor].concat(uris), promise, done, promise.setFail);
          } else {
            var ids = self._library._urisToIds(uris);
            hermes.Hermes.request('POST', self.makeUri('/contains'), [], []).send(JSON.stringify(ids)).done(function (result) {
              var contains = JSON.parse(result[0]);
              if (!Array.isArray(items))
                promise.setDone(contains[0]);
              else
                promise.setDone(contains);
            }).fail(function (_, res) {
              if (res && res.code && res.code.code === 404) {
                promise.setDone(false);
              } else {
                promise.setFail(res);
              }
            });
          }
        });
        return promise;
      };
      AbstractLibraryCollection.prototype.add = function (items) {
        var uris = SP.uris(arguments);
        var self = this;
        var promise = new models.Promise();
        this._library._initPromise.done(function () {
          if (self._library._useBridgeForCollection) {
            SP.request(self.requestPrefix + '_append', [self.descriptor].concat(uris), promise, promise.setDone, promise.setFail);
          } else {
            var ids = self._library._urisToIds(uris);
            hermes.Hermes.request('POST', self.makeUri(), [], []).send(JSON.stringify(ids)).done(function (result) {
              promise.setDone();
              models.client.broadcast('collection-changed');
            }).fail(promise.setFail.bind(promise));
          }
        });
        return promise;
      };
      AbstractLibraryCollection.prototype.remove = function (ref) {
        var self = this;
        var promise = new models.Promise();
        this._library._initPromise.done(function () {
          if (self._library._useBridgeForCollection) {
            SP.request(self.requestPrefix + '_remove', [
              self.descriptor,
              ref.index,
              ref.uri
            ], promise, promise.setDone, promise.setFail);
          } else {
            var ids = self._library._urisToIds([ref.uri]);
            hermes.Hermes.request('DELETE', self.makeUri(), [], []).send(JSON.stringify(ids)).done(function (result) {
              promise.setDone();
              models.client.broadcast('collection-changed');
            }).fail(promise.setFail.bind(promise));
          }
        });
        return promise;
      };
      AbstractLibraryCollection.prototype.clear = function () {
        throw new Error('Not implemented');
      };
      AbstractLibraryCollection.prototype.insert = function (ref, items) {
        throw new Error('Not implemented');
      };
      AbstractLibraryCollection.prototype.trim = function (ref) {
        throw new Error('Not implemented');
      };
      function LibraryTracksCollection(library, owner) {
        var self = this;
        AbstractLibraryCollection.call(this, library, owner, owner.uri + ':collection', models.Track, 'tracks');
        this._observed = function () {
          this._library._initPromise.done(function () {
            if (self._library._useBridgeForCollection) {
              self.bridgeListen('library_tracks_event_wait', [owner.uri]);
            } else {
              models.client.addEventListener('broadcast', function (event) {
                if (event.message == 'collection-changed') {
                  self.dispatchEvent({ type: 'changed' });
                }
              });
            }
          });
        };
      }
      SP.inherit(LibraryTracksCollection, AbstractLibraryCollection);
      function LibraryAlbumsCollection(library, owner) {
        var self = this;
        AbstractLibraryCollection.call(this, library, owner, null, models.Album, 'albums');
        this._observed = function () {
          this._library._initPromise.done(function () {
            if (self._library._useBridgeForCollection) {
              self.bridgeListen('library_albums_event_wait', [owner.uri]);
            }
          });
        };
      }
      SP.inherit(LibraryAlbumsCollection, AbstractLibraryCollection);
      exports.Library = Library;
    }(require('node_modules/api/scripts/models.js'), require('node_modules/api/scripts/hermes.js')));
  },
  'scripts/contextwidget.view.playlistdeleteconfirm.js': function (require, module, exports, global, __filename, __dirname) {
    var escapeHTML = require('node_modules/escape-html/index.js');
    (function (models, Library, utils, localeStrings) {
      exports.PlaylistDeleteConfirmView = PlaylistDeleteConfirmView;
      function PlaylistDeleteConfirmView(options) {
        this.node = options.node;
        this._eventManager = options.eventManager;
        this._currentContext = null;
        this._l = localeStrings.get.bind(localeStrings);
        this._playlistDeleteConfirmButton = document.getElementById('playlist-delete-confirm-button');
        this._playlistDeleteCancelButton = document.getElementById('playlist-delete-cancel-button');
        this._playlistDeleteConfirmHeader = document.getElementById('playlist-delete-confirm-header');
        this._playlistDeleteConfirmMessage = document.getElementById('playlist-delete-confirm-message');
        this._doLocale();
        this._addEventListeners();
      }
      PlaylistDeleteConfirmView.prototype._doLocale = function () {
        this._playlistDeleteConfirmHeader.innerHTML = this._l('delete-playlist');
        this._playlistDeleteConfirmButton.innerHTML = this._l('delete');
        this._playlistDeleteCancelButton.innerHTML = this._l('cancel');
      };
      PlaylistDeleteConfirmView.prototype.setContext = function (currentContext) {
        var self = this;
        this._currentContext = currentContext;
        this._currentContext.load('name').done(function (playlist) {
          self._playlistDeleteConfirmMessage.innerHTML = self._l('delete-playlist-confirmation', escapeHTML(playlist.name), playlist.uri.toSpotifyURL());
        });
      };
      PlaylistDeleteConfirmView.prototype.activate = function (currentContext, currentPlaylist) {
        var self = this;
        self._currentContext = currentContext;
        self._currentContext.load('name').done(function (playlist) {
        });
      };
      PlaylistDeleteConfirmView.prototype._addEventListeners = function () {
        var self = this;
        this._playlistDeleteConfirmButton.addEventListener('click', function (e) {
          e.preventDefault();
          self._playlistDeleteConfirm();
        });
        this._playlistDeleteCancelButton.addEventListener('click', function (e) {
          e.preventDefault();
          self._playlistDeleteCancel();
        });
      };
      PlaylistDeleteConfirmView.prototype._playlistDeleteConfirm = function (e) {
        var self = this;
        Library.forCurrentUser().unsubscribe(self._currentContext).done(function () {
          self._eventManager.trigger(self._eventManager.Events.CLOSE);
        });
      };
      PlaylistDeleteConfirmView.prototype._playlistDeleteCancel = function (e) {
        this._eventManager.trigger(this._eventManager.Events.CLOSE);
      };
    }(require('node_modules/api/scripts/models.js'), require('node_modules/api/scripts/library.js').Library, require('scripts/playlist-utils.js'), require('@loc.loc/strings/main.lang')));
  },
  'scripts/playlisthelper.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    (function (utils, Library) {
      var IndexItem = function (data) {
        if (typeof data != 'object') {
          data = {};
        }
        this.data = {
          rendered: false,
          sortIndex: data.hasOwnProperty('sortIndex') ? data.sortIndex : 0,
          identifier: data.hasOwnProperty('identifier') ? data.identifier : new Date().getTime(),
          dataObj: data.hasOwnProperty('dataObj') ? data.dataObj : {}
        };
      };
      IndexItem.prototype = {
        getIdentifier: function () {
          return this.data.identifier;
        },
        getDataObject: function () {
          return this.data.dataObj;
        },
        getSortIndex: function () {
          return this.data.sortIndex;
        },
        setSortIndex: function (index) {
          this.data.sortIndex = index;
        }
      };
      var HelperIndexingService = function () {
        var _items = new Array();
        var _identifier;
        var _find = function (needle) {
          var i = 0, l = _items.length, found = -1;
          for (; i < l; i++) {
            if (_items[i].getIdentifier() === needle) {
              found = i;
              break;
            }
          }
          return found;
        };
        var _addItem = function (item, index) {
          _items[_items.length] = new IndexItem({
            dataObj: item,
            sortIndex: index,
            identifier: item.hasOwnProperty(_identifier) ? item[_identifier] : null
          });
        };
        var _sortItems = function () {
          _items.sort(function (a, b) {
            return a.getSortIndex() - b.getSortIndex();
          });
        };
        var _reassignSortIndices = function () {
          var i = 0, l = _items.length;
          for (; i < l; i++) {
            _items[i].setSortIndex(i);
          }
        };
        return {
          setIdentifier: function (str) {
            if (str && typeof str === 'string') {
              _identifier = str;
            }
          },
          addItem: function (obj, index) {
            if (!obj) {
              return;
            }
            _addItem(obj, index);
          },
          init: function () {
            _items = [];
          },
          length: function () {
            return _items.length;
          },
          getItemByIndex: function (index) {
            if (!index && typeof index != 'number') {
              return null;
            }
            return _items[index];
          },
          getItemByIdentifier: function (str) {
            if (!str && typeof str != 'string') {
              return null;
            }
            return _items[_find(str)];
          },
          getItems: function () {
            return _items;
          },
          sort: function () {
            _sortItems();
            _reassignSortIndices();
          }
        };
      }();
      var PlaylistHelper = function () {
        var _then;
        var _offset = 200;
        var _upperLimit = 500;
        var _batchIndex = 0;
        var _library = null;
        var _playlistsBatchToLoad = 0;
        var _playlistsLoaded = 0;
        var _totalPlaylistsToLoad = 0;
        var _loadLibrary = function () {
          var library = Library.forCurrentUser();
          _loadSnapshot(library);
        };
        var _loadPlaylists = function () {
          Library.load('playlists').done(_loadSnapshot);
        };
        var _loadSnapshot = function (lib) {
          if (lib && !_library) {
            _library = lib;
          }
          _library.playlists.snapshot(_batchIndex, _offset).done(_resolvePlaylistSnapshot).fail(function (s, e) {
            utils.Notifier.error('(Playlist.Helper) playlist snapshot failed', s, e);
          });
        };
        var _resolvePlaylistSnapshot = function (s) {
          var i = 0;
          if (s.length) {
            utils.Notifier.info('(Playlist.Helper) playlist snapshot taken', s);
            if (!_totalPlaylistsToLoad) {
              _totalPlaylistsToLoad = s.length;
              HelperIndexingService.init();
            }
            _playlistsBatchToLoad = s.range.length;
            for (; i < _playlistsBatchToLoad; i++) {
              var pos = _batchIndex + i;
              _getIndexedItemFromSnapshot(s, pos);
            }
            _batchIndex += _playlistsBatchToLoad;
            if (_batchIndex < _totalPlaylistsToLoad) {
              _loadSnapshot(null);
            }
          } else if (s.length === 0) {
            _handleNoPlaylists();
          }
        };
        var _getIndexedItemFromSnapshot = function (ss, i) {
          ss.get(i).load('name', 'uri', 'owner', 'allows').done(function (p) {
            _appendPlaylistFromSnapshot(p, i);
          }).fail(_handleFailedPlaylist);
        };
        var _appendPlaylistFromSnapshot = function (p, i) {
          HelperIndexingService.addItem(p, i);
          _resolveLoadedPlaylist();
        };
        var _handleFailedPlaylist = function (p, e) {
          utils.Notifier.error('(Playlist.Helper) playlist not loaded', p, e);
          _resolveLoadedPlaylist();
        };
        var _handleNoPlaylists = function () {
          utils.Notifier.info('(Playlist.Helper) no playlists for user');
          if (_then && typeof _then === 'function') {
            _then.call(this, _filterPlaylists());
          }
        };
        var _resolveLoadedPlaylist = function () {
          _playlistsLoaded++;
          if (_playlistsLoaded === _totalPlaylistsToLoad) {
            if (_then && typeof _then === 'function') {
              _then.call(this, _filterPlaylists());
            }
          }
        };
        var _filterPlaylists = function () {
          var i = 0, l = HelperIndexingService.length(), results = [], item;
          HelperIndexingService.sort();
          for (; i < l; i++) {
            item = HelperIndexingService.getItemByIndex(i);
            if (item && !_inList(item.getIdentifier(), results)) {
              results.push(item);
            }
          }
          return results;
        };
        var _reset = function () {
          _batchIndex = 0;
          _playlistsBatchToLoad = 0;
          _playlistsLoaded = 0;
          _totalPlaylistsToLoad = 0;
          HelperIndexingService.init();
          HelperIndexingService.setIdentifier('uri');
        };
        var _inList = function (needle, arr) {
          var i = 0, l = arr.length;
          for (; i < l; i++) {
            if (arr[i].getIdentifier() === needle)
              return true;
          }
          return false;
        };
        return {
          registerCallback: function (callback) {
            if (!callback || typeof callback != 'function') {
              return;
            }
            _then = callback;
          },
          load: function () {
            _reset();
            _loadLibrary();
          }
        };
      }();
      exports.registerCallback = PlaylistHelper.registerCallback;
      exports.load = PlaylistHelper.load;
    }(require('scripts/playlist-utils.js'), require('node_modules/api/scripts/library.js').Library));
  },
  'scripts/contextwidget.userplaylists.js': function (require, module, exports, global, __filename, __dirname) {
    (function (helper) {
      'use strict';
      exports.UserPlaylists = UserPlaylists;
      function UserPlaylists(cb, caller) {
        var self = this;
        this._caller = caller;
        this._getAll(function (playlists) {
          self._prepPlaylists.call(self, playlists);
        });
        this._cb = cb;
        this._playlists = [];
      }
      UserPlaylists.prototype._getAll = function (cb) {
        helper.registerCallback(cb);
        helper.load();
      };
      UserPlaylists.prototype._prepPlaylists = function (playlists) {
        for (var i = 0; i < playlists.length; i++) {
          var pl = playlists[i].data.dataObj;
          if (pl.collaborative || pl.allows.insertTracks) {
            this._playlists.push({
              'name': playlists[i].data.dataObj.name,
              'uri': playlists[i].data.identifier,
              'data': playlists[i].data.dataObj
            });
          }
        }
        this._onPlaylistsPrepared();
      };
      UserPlaylists.prototype._onPlaylistsPrepared = function () {
        this._cb.call(this._caller, this._playlists);
      };
    }(require('scripts/playlisthelper.js')));
  },
  'node_modules/logging-utils/scripts/logger.js': function (require, module, exports, global, __filename, __dirname) {
    (function (app, session) {
      'use strict';
      var CONSOLE_METHOD = {
        DEBUG: 'debug',
        LOG: 'log',
        WARN: 'warn',
        ERROR: 'error'
      };
      var loggers = {};
      function Logger(tag, context) {
        this.tag = tag;
        this.context = context;
        this.timerData = {};
        this.timerOptions = {};
        this.inRolloutPercentage = true;
        this.setLogOutputLevel();
      }
      Logger.forTag = function (tag, context) {
        if (typeof tag != 'string' || tag.length < 1) {
          throw 'Improper tag name.';
        }
        var returnLogger = loggers[tag];
        if (!returnLogger) {
          returnLogger = new Logger(tag, context);
          loggers[tag] = returnLogger;
        }
        return returnLogger;
      };
      Logger.OUTPUT_LEVEL = {
        DEBUG: 4,
        LOG: 3,
        INFO: 2,
        ERROR: 1,
        NONE: 0
      };
      Logger.prototype.setLogOutputLevel = function (logOutputLevel) {
        var logOutputGobalOverride = null, debuggingEnabled = false;
        if (logOutputGobalOverride) {
          this.logOutputLevel = logOutputGobalOverride;
        } else if (logOutputLevel === undefined || logOutputLevel < Logger.OUTPUT_LEVEL.NONE || logOutputLevel > Logger.OUTPUT_LEVEL.DEBUG) {
          var suffix = 'spotify.net';
          var hostname = window.location.hostname;
          try {
            debuggingEnabled = window.localStorage && !!localStorage.getItem('logging_debug');
          } catch (e) {
          }
          if (debuggingEnabled) {
            this.logOutputLevel = Logger.OUTPUT_LEVEL.DEBUG;
          } else if (hostname.indexOf(suffix, hostname.length - suffix.length) !== -1) {
            this.logOutputLevel = Logger.OUTPUT_LEVEL.ERROR;
          } else {
            this.logOutputLevel = Logger.OUTPUT_LEVEL.NONE;
          }
        } else {
          this.logOutputLevel = logOutputLevel;
        }
      };
      Logger._testVersion = 'base';
      Logger.setTestVersion = function (testVersion) {
        if (typeof testVersion != 'string' || testVersion.length < 1) {
          throw 'Improper test name.';
        }
        Logger._testVersion = testVersion;
      };
      Logger.prototype.setTestRollout = function (percentage) {
        var self = this;
        this.inRolloutPercentage = false;
        if (percentage > 0) {
          session.load('testGroup').done(function (s) {
            var tg = parseInt(s.testGroup, 10);
            if (tg <= percentage * 10) {
              self.inRolloutPercentage = true;
            }
          });
        }
      };
      var ALLOWED_EVENTS = {
        USER_HOLD_TIMER: 'user:hold',
        USER_HIT: 'user:hit',
        USER_SELECT: 'user:select',
        USER_HOVER: 'user:hover',
        USER_IMPRESSION: 'user:impression',
        INFO_TIMER_DEFAULT: 'info:timer',
        INFO_STATE_LOAD_TIMER: 'info:state_load_timer',
        INFO_DEFAULT: 'info:default',
        INFO_WARN: 'info:warn',
        ERROR_DEFAULT: 'error:user_action_fail',
        ERROR_USER_ACTION_FAIL: 'error:user_action_fail',
        ERROR_RENDER_FAIL: 'error:render_fail',
        DEBUG: 'debug'
      };
      var C = CONSOLE_METHOD, O = Logger.OUTPUT_LEVEL, E = ALLOWED_EVENTS;
      Logger.prototype.debug = function (eventVersion, data, opt_context) {
        return this._log(C.DEBUG, E.DEBUG, O.DEBUG, eventVersion, data, opt_context, true, true);
      };
      Logger.prototype.log = function (eventVersion, data, opt_context) {
        return this._log(C.LOG, E.DEBUG, O.LOG, eventVersion, data, opt_context, true);
      };
      Logger.prototype.userHit = function (eventVersion, data, opt_context) {
        return this._log(C.LOG, E.USER_HIT, O.INFO, eventVersion, data, opt_context);
      };
      Logger.prototype.userSelect = function (eventVersion, data, opt_context) {
        return this._log(C.LOG, E.USER_SELECT, O.INFO, eventVersion, data, opt_context);
      };
      Logger.prototype.userHover = function (eventVersion, data, opt_context) {
        return this._log(C.LOG, E.USER_HOVER, O.INFO, eventVersion, data, opt_context);
      };
      Logger.prototype.userImpression = function (eventVersion, data, opt_context) {
        return this._log(C.LOG, E.USER_IMPRESSION, O.INFO, eventVersion, data, opt_context);
      };
      Logger.prototype.info = function (eventVersion, data, opt_context) {
        return this._log(C.LOG, E.INFO_DEFAULT, O.INFO, eventVersion, data, opt_context);
      };
      Logger.prototype.infoWarn = function (eventVersion, data, opt_context) {
        return this._log(C.WARN, E.INFO_WARN, O.INFO, eventVersion, data, opt_context);
      };
      Logger.prototype.error = function (eventVersion, data, opt_context) {
        return this._log(C.ERROR, E.ERROR_DEFAULT, O.ERROR, eventVersion, data, opt_context);
      };
      Logger.prototype.errorUserActionFail = function (eventVersion, data, opt_context) {
        return this._log(C.ERROR, E.ERROR_USER_ACTION_FAIL, O.ERROR, eventVersion, data, opt_context);
      };
      Logger.prototype.errorRenderFail = function (eventVersion, data, opt_context) {
        return this._log(C.ERROR, E.ERROR_RENDER_FAIL, O.ERROR, eventVersion, data, opt_context);
      };
      Logger.prototype.startHoldTimer = function (eventVersion, data, opt_context) {
        this._startTimer(eventVersion, data, E.USER_HOLD_TIMER, opt_context);
      };
      Logger.prototype.startTimer = function (eventVersion, data, opt_context) {
        this._startTimer(eventVersion, data, E.INFO_TIMER_DEFAULT, opt_context);
      };
      Logger.prototype.startStateLoadTimer = function (eventVersion, data, opt_context) {
        this._startTimer(eventVersion, data, E.INFO_STATE_LOAD_TIMER, opt_context);
      };
      Logger.prototype.startDebugTimer = function (eventVersion, data, opt_context) {
        this._startTimer(eventVersion, data, E.DEBUG_TIMER, opt_context);
      };
      Logger.prototype.hasTimer = function (eventVersion) {
        return this.timerData[eventVersion] ? true : false;
      };
      Logger.prototype.overrideStartTime = function (eventVersion, newStartTime) {
        this.timerData[eventVersion].timerStart = newStartTime;
      };
      Logger.prototype.cancelTimer = function (eventVersion) {
        delete this.timerData[eventVersion];
        delete this.timerOptions[eventVersion];
      };
      Logger.prototype.tickTimer = function (eventVersion, tickName) {
        if (!this.timerData[eventVersion]) {
          return this.error('cannot_tick_unstarted_timer', { timerName: eventVersion });
        }
        tickName = 'timer_tick_' + tickName;
        var data = this.timerData[eventVersion];
        var tickDiff = new Date().getTime() - data.timerStart;
        data[tickName] = tickDiff;
        return true;
      };
      Logger.prototype.endTimer = function (eventVersion, opt_overrideTotalTime) {
        if (!this.timerData[eventVersion]) {
          return this.error('cannot_end_unstarted_timer', { timerName: eventVersion });
        }
        var data = this.timerData[eventVersion];
        if (typeof opt_overrideTotalTime == 'number') {
          data['timer_total_time'] = opt_overrideTotalTime;
        } else {
          var timerEnd = new Date().getTime();
          data['timer_total_time'] = timerEnd - data.timerStart;
        }
        delete data.timerStart;
        var opts = this.timerOptions[eventVersion];
        var isDebug = opts.timerEvent == ALLOWED_EVENTS.DEBUG_TIMER;
        var retVal = this._log(isDebug ? CONSOLE_METHOD.DEBUG : CONSOLE_METHOD.LOG, opts.timerEvent, isDebug ? Logger.OUTPUT_LEVEL.DEBUG : Logger.OUTPUT_LEVEL.INFO, eventVersion, data, opts.context, isDebug);
        this.cancelTimer(eventVersion);
        return retVal;
      };
      Logger.prototype.addDataToTimer = function (eventVersion, propName, propValue) {
        if (!this.timerData[eventVersion]) {
          return this.error('cannot_add_data_to_unstarted_timer', { timerName: eventVersion });
        }
        var tickNamePattern = /^timer_tick_\d*/;
        if (propName == 'timerStart' || tickNamePattern.test(propName)) {
          return this.error('cant_override_tick_info', { timerName: eventVersion });
        } else {
          this.timerData[eventVersion][propName] = propValue;
        }
      };
      Logger.prototype._startTimer = function (eventVersion, data, timerEvent, opt_context) {
        if (this.timerData[eventVersion]) {
          return this.error('cannot_restart_timer', { timerName: eventVersion });
        }
        data = data ? data : {};
        data.timerStart = new Date().getTime();
        this.timerData[eventVersion] = data;
        this.timerOptions[eventVersion] = {
          timerEvent: timerEvent,
          context: opt_context
        };
        return true;
      };
      Logger.prototype._getErrorObject = function () {
        try {
          throw new Error('');
        } catch (err) {
          return err;
        }
      };
      Logger.prototype._getBackendData = function (data) {
        if (!data) {
          return {};
        }
        Object.keys(data).forEach(function (key) {
          var val = data[key];
          data[key] = typeof val === 'undefined' ? '' : val;
        });
        if (typeof data == 'string' || typeof data == 'number' || typeof data == 'boolean') {
          return { data: data };
        }
        if (typeof data != 'object') {
          return { error: 'unparsable_data' };
        }
        var backendData = {};
        for (var key in data) {
          if (data.hasOwnProperty(key) && (typeof data[key] == 'string' || typeof data[key] == 'number' || typeof data[key] == 'boolean')) {
            backendData[key] = data[key];
          }
        }
        return backendData;
      };
      Logger.prototype._log = function (consoleMethod, event, minOutputLevel, eventVersion, data, opt_context, opt_debugOnly, opt_printStacktrace) {
        var sole = typeof console !== 'undefined';
        var context;
        if (opt_context)
          context = opt_context;
        else
          context = this.context ? this.context : '';
        event = event ? event : '';
        eventVersion = eventVersion ? eventVersion : '';
        if (!opt_debugOnly && this.inRolloutPercentage) {
          var backendData = this._getBackendData(data);
          var promise = app.clientEvent(context, event, eventVersion, Logger._testVersion, backendData);
          promise.fail(function () {
            sole && console.error('could_not_log_to_backend');
          });
        }
        if (!sole || this.logOutputLevel < minOutputLevel) {
          return false;
        }
        var stackTrace = '';
        if (opt_printStacktrace) {
          var err = this._getErrorObject();
          stackTrace = '{no stack-trace available}';
          if (err.stack) {
            stackTrace = err.stack.split('\n').slice(1);
          }
        }
        var consoleFunction = console[consoleMethod] ? console[consoleMethod] : console.log;
        if (typeof consoleFunction == 'object') {
          consoleFunction = Function.prototype.bind.call(consoleFunction, console);
        }
        data = data ? data : '';
        consoleFunction.apply(console, [
          '[' + this.tag + ']',
          context,
          event,
          eventVersion,
          data,
          stackTrace
        ]);
        return true;
      };
      exports.Logger = Logger;
    }(require('node_modules/api/scripts/models.js').application, require('node_modules/api/scripts/models.js').session));
  },
  'node_modules/api/scripts/private/relationsartist.js': function (require, module, exports, global, __filename, __dirname) {
    (function (hermes, models) {
      var Relationship = {
        NOT_SUBSCRIBED: 0,
        SUBSCRIBED: 1
      };
      var ARTIST_GRAPH_ROOT = 'hm://socialgraph/';
      var ARTIST_GRAPH_SUBSCRIPTIONS = ARTIST_GRAPH_ROOT + 'subscriptions/artist';
      var ARTIST_GRAPH_SUBSCRIBERS = ARTIST_GRAPH_ROOT + 'subscribers/artist';
      var COMBINED_GRAPH_SUBSCRIPTIONS = ARTIST_GRAPH_ROOT + 'subscriptions/combined';
      var _schema = hermes.Schema.fromURL('$api/proto/socialgraph.proto');
      function artistSubscriptions(opt_userUri) {
        var promise = new models.Promise();
        var canonicalUsername = opt_userUri ? _trimUri('user', opt_userUri) : '';
        if (canonicalUsername == '@')
          canonicalUsername = '';
        var requestPromise = _request('GET', ARTIST_GRAPH_SUBSCRIPTIONS + '/' + canonicalUsername, 'ArtistListReply', 'UserListRequest', { include_length: true });
        requestPromise.done(function (data) {
          var response = [], result = data[0].artists || [];
          for (var i = 0, len = result.length; i < len; i++) {
            response.push(models.Artist.fromURI('spotify:artist:' + result[i].artistid));
          }
          promise.setDone(response);
        }).fail(function (_, error) {
          promise.setFail(error);
        });
        return promise;
      }
      function categorizeUsersAndArtists(uris) {
        var artistUris = [], userUris = [], artistUriSet = {}, userUriSet = {}, mergedUriSet = {};
        for (var i = 0, len = uris.length; i < len; i++) {
          var uri = uris[i];
          if (uri.indexOf('spotify:artist:') === 0) {
            artistUris.push(uri);
          } else {
            userUriSet[uri] = true;
            userUris.push(uri);
          }
        }
        var promises;
        promises = models.Artist.fromURIs(artistUris).map(function (artist) {
          return artist.load('user');
        });
        var artistsPromise = models.Promise.join(promises);
        artistsPromise.each(function (artist) {
          if (artist.user) {
            userUriSet[artist.user.uri] = true;
            mergedUriSet[artist.uri] = true;
          } else {
            artistUriSet[artist.uri] = true;
          }
        });
        promises = models.User.fromURIs(userUris).map(function (user) {
          return user.load('artist');
        });
        var usersPromise = models.Promise.join(promises);
        usersPromise.each(function (user) {
          if (user.artist) {
            mergedUriSet[user.artist.uri] = true;
          }
        });
        var promise = new models.Promise();
        models.Promise.join(artistsPromise, usersPromise).always(function () {
          promise.setDone({
            artistUris: Object.keys(artistUriSet),
            userUris: Object.keys(userUriSet),
            mergedUris: Object.keys(mergedUriSet)
          });
        });
        return promise;
      }
      function changeRelation(artistUris, relationship) {
        if (artistUris.length === 0) {
          var promise = new models.Promise();
          promise.setDone();
          return promise;
        }
        var method = relationship === Relationship.SUBSCRIBED ? 'POST' : 'DELETE';
        var promise = _request(method, ARTIST_GRAPH_SUBSCRIPTIONS, 'StringListReply', 'StringListRequest', { args: artistUris.map(_trimArtistUri) });
        promise.done(this, function () {
          models.Artist._cache.update(artistUris, { subscribed: relationship === Relationship.SUBSCRIBED });
        });
        return promise;
      }
      function combinedSubscriptionCount(userUri) {
        var canonicalUsername = _trimUri('user', userUri);
        var username;
        var usernamePromise;
        if (canonicalUsername === '@') {
          usernamePromise = models.session.user.load('username').done(function (user) {
            username = user.username;
          }).fail(function (_, error) {
            usernamePromise.setFail(error);
          });
        } else {
          username = decodeURIComponent(canonicalUsername);
          usernamePromise = new models.Promise();
          usernamePromise.setDone();
        }
        var promise = new models.Promise();
        usernamePromise.done(function () {
          _batchRequest('combinedSubscriptionCount', username, promise);
        });
        return promise;
      }
      function updateCache(artistUris, relationship) {
        models.Artist._cache.update(artistUris, { subscribed: relationship === Relationship.SUBSCRIBED });
      }
      function isSubscribed(artistUri) {
        return _batchRequest('isSubscribed', _trimArtistUri(artistUri));
      }
      function subscriberCount(artistUri) {
        return _batchRequest('subscriberCount', _trimArtistUri(artistUri));
      }
      var _batchable = {
        combinedSubscriptionCount: function (values, promises) {
          return _request('GET', COMBINED_GRAPH_SUBSCRIPTIONS + '/count', 'CountReply', 'StringListRequest', { args: values }).done(function (frames) {
            var counts = frames[0].counts;
            for (var i = 0, len = counts.length; i < len; i++) {
              promises[i].setDone(counts[i]);
            }
          });
        },
        isSubscribed: function (values, promises) {
          return _request('GET', ARTIST_GRAPH_SUBSCRIPTIONS + '/exists', 'StringListReply', 'StringListRequest', { args: values }).done(function (frames) {
            var subscribed = frames[0].reply;
            for (var i = 0, len = subscribed.length; i < len; i++) {
              promises[i].setDone(subscribed[i] == 'True');
            }
          });
        },
        subscriberCount: function (values, promises) {
          return _request('GET', ARTIST_GRAPH_SUBSCRIBERS + '/count', 'CountReply', 'StringListRequest', { args: values }).done(function (frames) {
            var counts = frames[0].counts;
            for (var i = 0, len = counts.length; i < len; i++) {
              promises[i].setDone(counts[i]);
            }
          });
        }
      };
      var _batch = {};
      var _batchDeferred = false;
      function _batchRequest(request, value, opt_promise) {
        if (!opt_promise) {
          opt_promise = new models.Promise();
        }
        if (_batch[request]) {
          _batch[request].values.push(value);
          _batch[request].promises.push(opt_promise);
        } else {
          _batch[request] = {
            values: [value],
            promises: [opt_promise]
          };
        }
        if (!_batchDeferred) {
          SP.defer(null, _runBatchedRequests);
          _batchDeferred = true;
        }
        return opt_promise;
      }
      function _request(method, url, opt_replyType, opt_requestType, var_args) {
        var request = hermes.Hermes.request(method, url, opt_replyType ? [_schema.type(opt_replyType)] : [], opt_requestType ? [_schema.type(opt_requestType)] : []);
        return request.send.apply(request, SP.varargs(arguments, 4));
      }
      function _runBatchedRequests() {
        if (_batchDeferred) {
          _batchDeferred = false;
        }
        for (var request in _batch) {
          var promise = _batchable[request](_batch[request].values, _batch[request].promises);
          promise.fail(_batch[request], function (_, error) {
            for (var i = 0, len = this.promises.length; i < len; i++) {
              this.promises[i].setFail(error);
            }
          });
        }
        _batch = {};
      }
      function _trimArtistUri(artistUri) {
        return _trimUri('artist', artistUri);
      }
      function _trimUri(prefix, uri) {
        var prefix = 'spotify:' + prefix, idx = uri.indexOf(prefix);
        return idx >= 0 ? uri.substr(idx + prefix.length + 1) : uri;
      }
      exports.Relationship = Relationship;
      exports.artistSubscriptions = artistSubscriptions;
      exports.categorizeUsersAndArtists = categorizeUsersAndArtists;
      exports.changeRelation = changeRelation;
      exports.combinedSubscriptionCount = combinedSubscriptionCount;
      exports.updateCache = updateCache;
      exports.isSubscribed = isSubscribed;
      exports.subscriberCount = subscriberCount;
    }(require('node_modules/api/scripts/hermes.js'), require('node_modules/api/scripts/models.js')));
  },
  'node_modules/api/scripts/relations.js': function (require, module, exports, global, __filename, __dirname) {
    (function (models, relationsartist) {
      function _combinedSubscriptionsSnapshot(descriptor, offset, length, raw) {
        var promises = [];
        var base = descriptor.getBase();
        if (base.type != models.ListDescriptor.Types.LIST) {
          throw new Error('Unexpected descriptor: ' + base.type);
        }
        var uri = base.uri;
        if (length != 0) {
          var allSubscriptionsPromise = models.Promise.join([
            relationsartist.artistSubscriptions(uri),
            Relations.forUser(models.User.fromURI(uri)).subscriptions.snapshot()
          ]);
          var itemsPromise = new models.Promise();
          allSubscriptionsPromise.done(function (results) {
            var artistUris = results[0].map(function (artist) {
              return artist.uri;
            });
            var userUris = results[1].toURIs();
            var uris = artistUris.concat(userUris);
            relationsartist.categorizeUsersAndArtists(uris).done(function (result) {
              itemsPromise.setDone(result);
            }).fail(function (_, error) {
              itemsPromise.setFail(error);
            });
          });
          allSubscriptionsPromise.fail(function (_, error) {
            itemsPromise.setFail(error);
          });
          promises.push(itemsPromise);
        }
        var countPromise = relationsartist.combinedSubscriptionCount(uri);
        promises.push(countPromise);
        var resultPromise = new models.Promise();
        models.Promise.join(promises).done(function () {
          var result = { array: [] };
          if (length != 0) {
            result.metadata = [];
            var i, items = itemsPromise.object;
            for (i = 0; i < items.artistUris.length; i++) {
              var artistUri = items.artistUris[i];
              if (items.mergedUris.indexOf(artistUri) >= 0)
                continue;
              result.array.push(artistUri);
              result.metadata.push({
                artist: artistUri,
                user: null
              });
            }
            for (i = 0; i < items.userUris.length; i++) {
              var user = models.User.fromURI(items.userUris[i]);
              if (user.artist) {
                result.array.unshift(user.uri);
                result.metadata.unshift({
                  artist: user.artist.uri,
                  user: user.uri
                });
              } else {
                result.array.push(user.uri);
                result.metadata.push({
                  artist: null,
                  user: user.uri
                });
              }
            }
            if (offset || length > -1) {
              var end = offset + (length > -1 ? length : result.array.length);
              result.array = result.array.slice(offset, end);
              result.metadata = result.metadata.slice(offset, end);
            }
          }
          result.length = countPromise.object;
          resultPromise.setDone(result);
        }).fail(function (_, error) {
          resultPromise.setFail(error);
        });
        return resultPromise;
      }
      function Relations(uri) {
        models.BridgeLoadable.call(this);
        var owner = models.User.fromURI(uri);
        this.resolve('owner', owner);
        this.resolve('subscribers', new models.BridgeCollection(models.User, null, 'relations_subscribers_users', owner.uri));
        this.resolve('subscriptions', new models.BridgeCollection(models.User, null, 'relations_subscriptions_users', owner.uri));
        this.resolve('combinedSubscriptions', new models.Collection(models.Profile, null, _combinedSubscriptionsSnapshot, owner.uri));
      }
      SP.inherit(Relations, models.BridgeLoadable);
      Relations.fromURI = models.Cache.lookup;
      Relations._cache = new models.Cache(Relations);
      models.Loadable.define(Relations, [
        'owner',
        'subscribers',
        'subscriptions',
        'combinedSubscriptions'
      ]);
      function CurrentUserRelations(uri) {
        Relations.call(this, uri);
        this.resolve('blocked', new models.BridgeCollection(models.User, null, 'relations_blocked_users', this.owner.uri));
        this.resolve('dismissed', new models.BridgeCollection(models.User, null, 'relations_dismissed_users', this.owner.uri));
        this.resolve('hidden', new models.BridgeCollection(models.User, null, 'relations_hidden_users', this.owner.uri));
        models.User.getOrCreateRelationsListener().proxyTo(this);
      }
      SP.inherit(CurrentUserRelations, Relations);
      models.Loadable.define(CurrentUserRelations, [
        'blocked',
        'dismissed',
        'hidden'
      ]);
      CurrentUserRelations.prototype.block = function (users) {
        return models.promisedRequest(this, 'relations_block', [this.owner.uri].concat(SP.uris(arguments)));
      };
      CurrentUserRelations.prototype.dismiss = function (users) {
        return models.promisedRequest(this, 'relations_dismiss', [this.owner.uri].concat(SP.uris(arguments)));
      };
      CurrentUserRelations.prototype.subscribe = function (profiles) {
        return this._changeRelation(SP.uris(arguments), relationsartist.Relationship.SUBSCRIBED);
      };
      CurrentUserRelations.prototype.undismiss = function (users) {
        return models.promisedRequest(this, 'relations_undismiss', [this.owner.uri].concat(SP.uris(arguments)));
      };
      CurrentUserRelations.prototype.unblock = function (users) {
        return models.promisedRequest(this, 'relations_unblock', [this.owner.uri].concat(SP.uris(arguments)));
      };
      CurrentUserRelations.prototype.unsubscribe = function (profiles) {
        return this._changeRelation(SP.uris(arguments), relationsartist.Relationship.NOT_SUBSCRIBED);
      };
      CurrentUserRelations.prototype._changeRelation = function (uris, relationship) {
        var promise = new models.Promise();
        var suffix = relationship === relationsartist.Relationship.SUBSCRIBED ? 'subscribe' : 'unsubscribe';
        relationsartist.categorizeUsersAndArtists(uris).done(this, function (result) {
          var promises = [];
          if (result.userUris.length) {
            var subscribeUsersPromise = models.promisedRequest(this, 'relations_' + suffix, [this.owner.uri].concat(result.userUris));
            subscribeUsersPromise.done(this, function () {
              relationsartist.updateCache(result.mergedUris, relationship);
            });
            promises.push(subscribeUsersPromise);
          }
          if (result.artistUris.length) {
            var subscribeArtistsPromise = relationsartist.changeRelation(result.artistUris, relationship);
            subscribeArtistsPromise.done(this, function (frames) {
              var uris = result.artistUris;
              if (frames[0] && frames[0].reply) {
                uris = uris.filter(function (artistUri) {
                  return frames[0].reply.indexOf(artistUri.substr(15)) == -1;
                });
              }
              if (!uris.length)
                return;
              this.eventDone({
                type: relationship === relationsartist.Relationship.SUBSCRIBED ? 'add' : 'remove',
                receiver: 'combinedSubscriptions',
                uris: uris
              });
            });
            promises.push(subscribeArtistsPromise);
          }
          models.Promise.join(promises).done(this, function () {
            promise.setDone(this);
          }).fail(function (_, error) {
            promise.setFail(error);
          });
        });
        return promise;
      };
      Relations._currentUser = null;
      Relations.forCurrentUser = function () {
        if (!Relations._currentUser) {
          Relations._currentUser = new CurrentUserRelations(models.session.user.uri);
        }
        return Relations._currentUser;
      };
      Relations.forUser = function (user) {
        return Relations.fromURI(user.uri);
      };
      models.Loadable.define(models.Artist, ['subscribed'], '_relations__temp_patch');
      models.Artist.prototype._relations__temp_patch = function (propsMask) {
        relationsartist.isSubscribed(this.uri).done(this, function (subscribed) {
          this.resolveMany(propsMask, { subscribed: subscribed });
        }).fail(this, function () {
          this.resolveFail(propsMask, { error: 'Cannot load subscribed property' });
        });
      };
      function _userRelationChangeHandler(evt) {
        for (var i = 0; i < evt.uris.length; i++) {
          models.User.fromURI(evt.uris[i]).load('artist').done(function (user) {
            if (!user.artist)
              return;
            user.artist.resolve('subscribed', evt.type == 'add');
          });
        }
        Relations.forCurrentUser().eventDone({
          type: evt.type,
          receiver: 'combinedSubscriptions',
          uris: evt.uris
        });
      }
      var subs = Relations.forCurrentUser().subscriptions;
      subs.addEventListener('add', _userRelationChangeHandler);
      subs.addEventListener('remove', _userRelationChangeHandler);
      exports.Relations = Relations;
    }(require('node_modules/api/scripts/models.js'), require('node_modules/api/scripts/private/relationsartist.js')));
  },
  'node_modules/views/scripts/utils/dom.js': function (require, module, exports, global, __filename, __dirname) {
    var slice = Array.prototype.slice;
    exports.id = function (id) {
      return document.getElementById(id);
    };
    exports.query = function (selector, context) {
      context = context || document;
      return context.querySelector(selector);
    };
    exports.queryAll = function (selector, context) {
      context = context || document;
      return slice.call(context.querySelectorAll(selector));
    };
    exports.queryClasses = function (className, context) {
      context = context || document;
      return slice.call(context.getElementsByClassName(className));
    };
    exports.queryTags = function (tag, context) {
      context = context || document;
      return slice.call(context.getElementsByTagName(className));
    };
    exports.addEventListener = function (elem, event, handler, useCapture) {
      if (elem.addEventListener) {
        elem.addEventListener(event, handler, !!useCapture);
      } else if (elem.attachEvent) {
        var wrapperHandler = function (e) {
          handler.call(elem, e);
        };
        handler.wrapperHandler = wrapperHandler;
        elem.attachEvent('on' + event, wrapperHandler);
      }
    };
    exports.removeEventListener = function (elem, event, handler, useCapture) {
      if (elem.removeEventListener) {
        elem.removeEventListener(event, handler, !!useCapture);
      } else if (elem.detachEvent) {
        elem.detachEvent('on' + event, handler.wrapperHandler || handler);
      }
    };
  },
  'node_modules/views/scripts/utils/css.js': function (require, module, exports, global, __filename, __dirname) {
    (function (models) {
      var css = exports;
      var head = document.head || document.getElementsByTagName('head')[0];
      var importCache = {};
      css.importSheet = function (path) {
        var resolved = models.application.resolvePath(path);
        resolved = resolved.replace('scripts/', '');
        if (!importCache[resolved]) {
          importCache[resolved] = true;
          var link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = resolved;
          head.appendChild(link);
          return true;
        }
        return false;
      };
      css.importSheets = function () {
        for (var i = 0, l = arguments.length; i < l; i++) {
          this.importSheet(arguments[i]);
        }
        return this;
      };
      var insertedStyles = {};
      css.appendStyles = function (id, selectors) {
        id = 'sp-' + id;
        if (insertedStyles[id])
          return getElementById(id);
        insertedStyles[id] = 1;
        var style = document.createElement('style');
        style.id = style.name = id;
        if (!selectors)
          return style;
        var styleStr = '', rules, key;
        for (key in selectors) {
          if (!selectors.hasOwnProperty(key))
            continue;
          var selector = selectors[key];
          styleStr += key;
          rules = [];
          for (key in selector) {
            if (!selector.hasOwnProperty(key))
              continue;
            rules.push(key + ': ' + selector[key]);
          }
          styleStr += ' {' + rules.join('; ') + '}\n';
        }
        style.innerHTML = styleStr;
        head.appendChild(style);
        return style;
      };
      css.getStyle = 'currentStyle' in head ? function (el, style) {
        return el.currentStyle[style];
      } : function (el, style) {
        var defaultView = el.ownerDocument.defaultView;
        if (!defaultView)
          return null;
        var computed = defaultView.getComputedStyle(el, null);
        return !computed ? null : computed.getPropertyValue(style);
      };
      function _trim(string) {
        return string.replace(/^\s+|\s+$/g, '');
      }
      exports.addClass = function (elements, className) {
        if (elements.nodeType === 1) {
          elements = [elements];
        }
        for (var i = 0; i < elements.length; i++) {
          var element = elements[i];
          if (element.nodeType === 1 && (' ' + element.className + ' ').indexOf(' ' + className + ' ') === -1) {
            element.className = _trim(element.className + ' ' + className);
          }
        }
      };
      exports.removeClass = function (elements, className) {
        if (elements.nodeType === 1) {
          elements = [elements];
        }
        for (var i = 0; i < elements.length; i++) {
          var element = elements[i];
          if (element.nodeType === 1 && (' ' + element.className + ' ').indexOf(' ' + className + ' ') > -1) {
            element.className = _trim(element.className.replace(new RegExp('(\\s|^)' + className + '(\\s|$)', 'gi'), ' '));
          }
        }
      };
      exports.hasClass = function (element, className) {
        if (!element)
          return false;
        return !!~(' ' + element.className + ' ').indexOf(' ' + className + ' ');
      };
      css.classList = {
        add: function (elem, className) {
          if (elem && !this.contains(elem, className)) {
            elem.className = this.trim(elem.className + ' ' + className);
          }
        },
        remove: function (elem, className) {
          if (elem) {
            elem.className = this.trim(elem.className.replace(new RegExp('(\\s|^)' + className + '(\\s|$)', 'gi'), ' '));
          }
        },
        contains: function (elem, className) {
          return elem ? !!~(' ' + elem.className + ' ').indexOf(' ' + className + ' ') : false;
        },
        trim: function (string) {
          return string.replace(/^\s+|\s+$/g, '');
        }
      };
    }(require('node_modules/api/scripts/models.js')));
  },
  'node_modules/views/scripts/utils/device.js': function (require, module, exports, global, __filename, __dirname) {
    (function (css) {
      var ua = navigator.userAgent;
      var touch = function () {
        return 'ontouchstart' in window;
      }();
      var mobile = function () {
        var match = ua.match(/iPhone|iPod|iPad|Android/i);
        return match ? match[0].toLowerCase() : false;
      }();
      var browser = function () {
        var match = ua.match(/ie|firefox|chrome|safari/i);
        return match ? match[0].toLowerCase() : 'other';
      }();
      var container = function () {
        var head = document.getElementsByTagName('head')[0];
        var scripts = head.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
          var src = scripts[i].src;
          var match = src.match(/\/core\.(\w+)\.js/);
          if (match) {
            var result = match[1];
            return result === 'browser' ? 'web' : result;
          }
        }
        return 'web';
      }();
      css.addClass(document.documentElement, 'sp-for-' + (touch && mobile ? 'touch' : 'mouse'));
      css.addClass(document.documentElement, 'sp-device-' + container);
      exports.container = container;
      exports.browser = browser;
      exports.mobile = mobile;
      exports.touch = touch;
    }(require('node_modules/views/scripts/utils/css.js')));
  },
  'node_modules/views/scripts/throbber.js': function (require, module, exports, global, __filename, __dirname) {
    (function (device, css, dom, models) {
      function Throbber(element, opt_delay) {
        this.contentElement = element;
        this.delay = opt_delay;
        this.position = {
          x: 0,
          y: 0
        };
        this.isActive = true;
        this._createNode();
        this.hideContent();
        if (typeof opt_delay === 'number') {
          var self = this;
          setTimeout(function () {
            if (self.isActive) {
              self._addNode();
              self.setPosition('center', 'center');
            }
          }, opt_delay);
        } else {
          this._addNode();
          this.setPosition('center', 'center');
        }
      }
      SP.inherit(Throbber, models.Observable);
      Throbber.forElement = function (element, opt_delay) {
        return new Throbber(element, opt_delay);
      };
      Throbber.prototype.setPosition = function (opt_x, opt_y) {
        if (!this.node.parentNode)
          return;
        var x = opt_x === undefined ? this.position.x : opt_x;
        var y = opt_y === undefined ? this.position.y : opt_y;
        this.position.x = x;
        this.position.y = y;
        var throbberBounds = this.node.getBoundingClientRect();
        var elementBounds = this.contentElement.getBoundingClientRect();
        var scroll = {
          x: document.body.scrollLeft,
          y: document.body.scrollTop
        };
        if (typeof x === 'string') {
          if (x === 'left') {
            x = 0;
          }
          if (x === 'right') {
            x = elementBounds.width - throbberBounds.width + 'px';
          }
          if (x === 'center') {
            x = (elementBounds.width - throbberBounds.width) / 2 + 'px';
          }
        } else if (typeof x === 'number') {
          x = x + 'px';
        }
        if (typeof y === 'string') {
          if (y === 'top') {
            y = 0;
          }
          if (y === 'bottom') {
            y = elementBounds.height - throbberBounds.height + 'px';
          }
          if (y === 'center') {
            y = (elementBounds.height - throbberBounds.height) / 2 + 'px';
          }
        } else if (typeof y === 'number') {
          y = y + 'px';
        }
        if (x < 0)
          x = 0;
        if (y < 0)
          y = 0;
        this.node.style.left = x;
        this.node.style.top = y;
      };
      Throbber._sizes = {
        normal: '',
        small: 'sp-throbber-small'
      };
      Throbber.prototype.setSize = function (size) {
        if (this.size === size)
          return;
        if (!(size in Throbber._sizes)) {
          throw new Error(size + ' is not a valid size');
        }
        css.removeClass(this.node, Throbber._sizes[this.size]);
        css.addClass(this.node, Throbber._sizes[size]);
        this.size = size;
        this.setPosition();
      };
      Throbber.prototype.hideContent = function () {
        this.contentElement.style.visibility = 'hidden';
        this.contentElement.style.pointerEvents = 'none';
        this.contentHidden = true;
        this._removeBackground();
      };
      Throbber.prototype.showContent = function () {
        this.contentElement.style.visibility = 'visible';
        this.contentElement.style.pointerEvents = 'auto';
        this.contentHidden = false;
        this._addBackground();
      };
      Throbber.prototype.hide = function () {
        if (this.isAddedToDOM) {
          this._removeNode();
        }
        if (this.contentHidden) {
          this.showContent();
        }
        this.isActive = false;
        if (this._showTimeout) {
          clearTimeout(this._showTimeout);
          this._showTimeout = null;
        }
      };
      Throbber.prototype.show = function () {
        if (!this.isAddedToDOM) {
          if (typeof this.delay === 'number') {
            var self = this;
            this._showTimeout = setTimeout(function () {
              self._addNode();
              self.hideContent();
              self.isActive = true;
            }, this.delay);
          } else {
            this._addNode();
            this.hideContent();
            this.isActive = true;
          }
        }
      };
      Throbber.prototype._createNode = function () {
        var node = document.createElement('div');
        node.className = 'sp-throbber';
        this.node = node;
      };
      Throbber.prototype._addNode = function () {
        if (this.node.parentNode) {
          this._removeNode();
        }
        this.contentElement.appendChild(this.node);
        this.isAddedToDOM = true;
        this.oldContentPosition = css.getStyle(this.contentElement, 'position');
        if (this.oldContentPosition === 'static') {
          this.contentElement.style.position = 'relative';
        }
      };
      Throbber.prototype._removeNode = function () {
        this.node.parentNode.removeChild(this.node);
        this.isAddedToDOM = false;
        this.contentElement.style.position = this.oldContentPosition;
      };
      Throbber.prototype._addBackground = function () {
        css.addClass(this.node, 'sp-throbber-background');
        this.setSize('small');
      };
      Throbber.prototype._removeBackground = function () {
        css.removeClass(this.node, 'sp-throbber-background');
        this.setSize('normal');
      };
      exports.Throbber = Throbber;
    }(require('node_modules/views/scripts/utils/device.js'), require('node_modules/views/scripts/utils/css.js'), require('node_modules/views/scripts/utils/dom.js'), require('node_modules/api/scripts/models.js')));
  },
  'scripts/contextwidget.view.playlist.js': function (require, module, exports, global, __filename, __dirname) {
    (function (models, helper, utils, Scroller, Throbber, localeStrings) {
      exports.PlaylistView = PlaylistView;
      function PlaylistView(options) {
        var self = this;
        this.node = options.node;
        this.logger = options.logger;
        this._l = localeStrings.get.bind(localeStrings);
        this._currentContext = null;
        this._eventManager = options.eventManager;
        this._backButton = document.getElementById('add-header');
        this._playlistList = this.node.querySelector('#playlist-list');
        this._mainWrapper = document.getElementById('playlist-wrapper');
        this._addHeaderLabel = document.querySelector('.add-header-label');
        this._playlists = null;
        this._playlistsWithChangeEventBindToThem = {};
        this._loadingInProgress = false;
        this._showDemotedStarred = false;
        this._eventManager.subscribe(this._eventManager.Events.PLAYLIST_CHANGE, function (event) {
          self._updatePlaylistName(event.target.uri, event.data.name);
        });
        this._doLocale();
      }
      ;
      PlaylistView.prototype._doLocale = function () {
        this._addHeaderLabel.innerHTML = this._l('add-to');
      };
      PlaylistView.prototype._updatePlaylistName = function () {
        this._renderPlaylists();
      };
      PlaylistView.prototype.setContext = function (currentContext) {
        this._currentContext = currentContext;
      };
      PlaylistView.prototype.showDemotedStarred = function () {
        this._showDemotedStarred = true;
      };
      PlaylistView.prototype.hideDemotedStarred = function () {
        this._showDemotedStarred = false;
      };
      PlaylistView.prototype.setPlaylist = function (currentPlaylist) {
      };
      PlaylistView.prototype.activate = function (currentContext, currentPlaylist) {
        var _self = this;
        this._currentContext = currentContext;
        if (this._searchField) {
          this._searchField.value = '';
          this._renderPlaylists();
        }
        if (this._playlists !== null) {
          this.startSearch();
          if (this._throbber) {
            this._hideThrobber();
          }
        } else {
          this.loadPlaylists();
        }
      };
      PlaylistView.prototype.hideBackButton = function () {
        this._backButton.style.display = 'none';
      };
      PlaylistView.prototype.showBackButton = function () {
        this._backButton.style.display = 'inline-block';
      };
      PlaylistView.prototype.loadPlaylists = function () {
        if (this._loadingInProgress) {
          return;
        }
        if (this._throbber) {
          this._hideThrobber();
        }
        if (this._playlists === null) {
          this._throbber = Throbber.forElement(this.node);
          this._loadingInProgress = true;
          var userPlaylists = new helper.UserPlaylists(this._onPlaylistsLoaded, this);
        }
      };
      PlaylistView.prototype._onPlaylistsLoaded = function (playlists) {
        this._loadingInProgress = false;
        this._playlists = playlists;
        this._bindChangeEvents();
        this._build();
        this.startSearch();
        this._hideThrobber();
        this._mainWrapper.style.height = 'auto';
        this._eventManager.trigger(this._eventManager.Events.PLAYLISTS_LOADED);
      };
      PlaylistView.prototype._bindChangeEvents = function () {
        var self = this;
        for (var i = 0; i < this._playlists.length; i++) {
          if (typeof this._playlistsWithChangeEventBindToThem[this._playlists[i].uri] === 'undefined') {
            this._playlistsWithChangeEventBindToThem[this._playlists[i].uri] = true;
            this._playlists[i].data.addEventListener('change', function (event) {
              self._eventManager.trigger(self._eventManager.Events.PLAYLIST_CHANGE, event);
            });
          }
        }
      };
      PlaylistView.prototype._onPlaylistsReloaded = function (playlists) {
        this._playlists = playlists;
        this._bindChangeEvents();
        this._renderPlaylists();
        this._eventManager.trigger(this._eventManager.Events.PLAYLISTS_LOADED);
      };
      PlaylistView.prototype._reloadPlaylists = function () {
        var self = this;
        var userPlaylists = new helper.UserPlaylists(this._onPlaylistsReloaded, this);
      };
      PlaylistView.prototype._build = function () {
        var output = document.createDocumentFragment();
        this._outerWrapper = document.getElementById('wrapper');
        this._searchFieldWrapper = document.createElement('div');
        this._searchFieldWrapper.className = 'search-wrapper';
        this._searchField = document.createElement('input');
        this._searchField.setAttribute('type', 'search');
        this._searchField.setAttribute('class', 'form-control');
        this._searchField.setAttribute('placeholder', 'Search');
        this._searchInputWrapper = document.createElement('div');
        this._searchInputWrapper.className = 'input-wrap';
        this._searchInputWrapper.appendChild(this._searchField);
        this._inputClearButton = document.createElement('a');
        this._inputClearButton.id = 'input-clear';
        this._searchInputWrapper.appendChild(this._inputClearButton);
        this._searchFieldWrapper.appendChild(this._searchInputWrapper);
        output.appendChild(this._searchFieldWrapper);
        this._playlistWrapper = document.createElement('ul');
        this._playlistWrapper.className = 'dropdown-interior-menu icon-menu';
        this._renderPlaylists();
        output.appendChild(this._playlistWrapper);
        this._playlistList.appendChild(output);
        this._playlistNewButton = document.getElementById('playlist-new');
        this._addEventListeners();
        this._scroller = new Scroller(this._mainWrapper);
      };
      PlaylistView.prototype._renderPlaylists = function (items) {
        if (!items) {
          items = this._playlists;
        }
        this._playlistWrapper.innerHTML = '';
        var resultHtml = '<li><a id="playlist-new" class="spoticon-plus-16" data-href="spotify:playlist:new">' + this._l('new-playlist');
        resultHtml += (this._searchField.value === '' ? '' : ' - "' + this._searchField.value.decodeForHtml() + '"') + '<span></span></a></li>';
        if (this._showDemotedStarred) {
          resultHtml += '<li><a class="spoticon-star-16" data-href="spotify:user:@:starred">' + this._l('starred') + '<span></span></a></li>';
        }
        var tempHtmlString = '';
        var thisPlaylist = null;
        var output = 'select';
        for (var i = 0; i < items.length; i++) {
          thisPlaylist = items[i].data;
          if (thisPlaylist.name !== '-') {
            tempHtmlString = '<li><a data-href="' + items[i].uri + '"';
            tempHtmlString += thisPlaylist.collaborative ? ' class="spoticon-collabrative-playlist-16">' : ' class="spoticon-playlist-16">';
            tempHtmlString += thisPlaylist.name.decodeForHtml() + '<span></span></a></li>';
          } else {
            tempHtmlString = '<li class="divider"><a data-href="' + items[i].uri + '"></a></li>';
          }
          resultHtml += tempHtmlString;
        }
        this._playlistWrapper.innerHTML = resultHtml;
        if (this._scroller) {
          this._scroller.resize();
        }
        if (this._throbber) {
          this._hideThrobber();
        }
      };
      PlaylistView.prototype._addEventListeners = function () {
        var self = this;
        this._backButton.addEventListener('click', function (e) {
          e.preventDefault();
          self._eventManager.trigger(self._eventManager.Events.ACTIVATE_VIEW, 'to-mainmenu');
        }, false);
        this._backButton.addEventListener('focus', function (e) {
          self._eventManager.trigger(self._eventManager.Events.ACTIVATE_VIEW, 'to-playlists');
        }, false);
        this._searchField.addEventListener('keyup', function (e) {
          self._handleSearchKeyPress(e);
        }, false);
        this._playlistWrapper.addEventListener('click', function (e) {
          e.preventDefault();
          self._handlePlaylistClick(e);
        }, false);
        this._inputClearButton.addEventListener('click', function (e) {
          e.preventDefault();
          self.clearSearch();
          self._searchField.focus();
        });
        this._eventManager.subscribe(this._eventManager.Events.PLAYLISTS_UPDATE, this._reloadPlaylists, this);
      };
      PlaylistView.prototype._handleSearchKeyPress = function (e) {
        var results = this._filterArray(this._playlists, 'name', this._searchField.value);
        if (this._searchField.value === '') {
          this._inputClearButton.style.display = 'none';
        } else {
          this._inputClearButton.style.display = 'block';
        }
        this._scroller.jumpToPx(0);
        this._renderPlaylists(results);
      };
      PlaylistView.prototype._filterArray = function (lookup, key, toFind) {
        var found = [];
        for (var i = 0; i < lookup.length; i++) {
          if (lookup[i][key].toLowerCase().indexOf(toFind.toLowerCase()) !== -1) {
            found.push(lookup[i]);
          }
        }
        return found;
      };
      PlaylistView.prototype._linkEnabled = function (link) {
        if (!link) {
          link = this;
        }
        if (typeof link._enabled === 'undefined') {
          link._enabled = true;
        }
        setTimeout(function () {
          blockLink();
        }, 20);
        return link._enabled;
        function blockLink() {
          link._enabled = false;
          setTimeout(function () {
            link._enabled = true;
          }, 1000);
        }
      };
      PlaylistView.prototype._handlePlaylistClick = function (e) {
        var targetURI = e.target.getAttribute('data-href');
        if (!this._currentContext) {
          return false;
        }
        if (!this._linkEnabled.apply(e.target)) {
          return false;
        }
        var self = this;
        if (targetURI === 'spotify:playlist:new') {
          this.logger.userHit('playlist_create', { track_id: self._currentContext.uri });
          if (this._searchField.value === '') {
            self._eventManager.trigger(self._eventManager.Events.ACTIVATE_VIEW, 'to-newplaylist');
          } else {
            models.Playlist.create(this._searchField.value).done(function (playlist) {
              playlist.load('name', 'tracks').done(function (playlist) {
                self._eventManager.trigger(self._eventManager.Events.ADD_CONTEXT_TO_PLAYLIST, {
                  playlist: playlist,
                  link: e.target
                });
              });
            }).fail(function () {
              console.error('playlist creation failed');
            });
          }
        } else if (targetURI === 'spotify:user:@:starred') {
          this.logger.userHit('demoted_starred', { track_id: self._currentContext.uri });
          if (this._currentContext instanceof models.Track) {
            this._currentContext.load('starred').done(function (track) {
              if (!track.starred) {
                self._currentContext.star();
              }
              self._eventManager.trigger(self._eventManager.Events.CLOSE);
            }).fail(function () {
              self._eventManager.trigger(self._eventManager.Events.CLOSE);
            });
          }
        } else {
          self._eventManager.trigger(self._eventManager.Events.ADD_CONTEXT_TO_PLAYLIST, {
            playlist: targetURI,
            link: e.target
          });
        }
      };
      PlaylistView.prototype.startSearch = function () {
        this._scroller.jumpToPx(this._searchFieldWrapper.offsetHeight);
        var f = this._searchField;
        var self = this;
        setTimeout(function () {
          if (self._outerWrapper.className === 'to-playlists') {
            f.focus();
          }
        }, 300);
      };
      PlaylistView.prototype.clearSearch = function () {
        if (!this._searchField) {
          return false;
        }
        this._searchField.value = '';
        this._inputClearButton.style.display = 'none';
        this._handleSearchKeyPress();
      };
      PlaylistView.prototype.focus = function () {
        this._searchField.focus();
      };
      PlaylistView.prototype.blur = function () {
        this._searchField.blur();
      };
      PlaylistView.prototype._hideThrobber = function () {
        this._throbber.hide();
        this.node.style.removeProperty('visibility');
      };
    }(require('node_modules/api/scripts/models.js'), require('scripts/contextwidget.userplaylists.js'), require('scripts/playlist-utils.js'), require('scripts/contextwidget.scroller.js').Scroller, require('node_modules/views/scripts/throbber.js').Throbber, require('@loc.loc/strings/main.lang')));
  },
  'scripts/contextwidget.view.newplaylist.js': function (require, module, exports, global, __filename, __dirname) {
    (function (models, helper, utils, Throbber, localeStrings) {
      exports.NewPlaylistView = NewPlaylistView;
      function NewPlaylistView(options) {
        this.node = options.node;
        this._eventManager = options.eventManager;
        this._currentContext = null;
        this._throbber;
        this._l = localeStrings.get.bind(localeStrings);
        this._addNewPlaylistBackButton = document.getElementById('new-header');
        this._newPlaylistInput = document.getElementById('new-playlist-name');
        this._newPlaylistLabel = document.getElementById('new-playlist-label');
        this._newPlaylistButton = document.getElementById('create-new');
        this._newPlaylistButtonLabel = document.getElementById('create-new-label');
        this._newListInputClear = document.getElementById('new-input-clear');
        this._newPlaylistHeader = document.getElementById('new-playlist-header');
        this._newPlaylistInputWrap = this._newPlaylistHeader.querySelector('input-wrap');
        this._doLocale();
        this._addEventListeners();
      }
      NewPlaylistView.prototype._doLocale = function () {
        this._newPlaylistHeader.innerHTML = this._l('new-playlist');
        this._newPlaylistLabel.innerHTML = this._l('name');
        this._newPlaylistButtonLabel.innerHTML = this._l('create-playlist');
      };
      NewPlaylistView.prototype.setContext = function (currentContext) {
        this._currentContext = currentContext;
      };
      NewPlaylistView.prototype.setPlaylist = function (currentPlaylist) {
      };
      NewPlaylistView.prototype.activate = function (currentContext, currentPlaylist) {
        var self = this;
        self._currentContext = currentContext;
        self.clearCreateNew();
        self.focusCreateNew();
        self._newPlaylistButton._disabled = false;
        if (self._currentContext.uri.indexOf('album') !== -1) {
          self._currentContext.load('name').done(function (album) {
            album.load('artists').done(function () {
              self._clearPlaceholder();
              self._newPlaylistInput.value = album.artists[0].name + ' - ' + album.name;
              self._updateClearButton();
            });
          });
        }
      };
      NewPlaylistView.prototype._addEventListeners = function () {
        var self = this;
        this._addNewPlaylistBackButton.addEventListener('click', function (e) {
          e.preventDefault();
          self._eventManager.trigger(self._eventManager.Events.ACTIVATE_VIEW, 'to-playlists');
        });
        this._addNewPlaylistBackButton.addEventListener('focus', function (e) {
          self._eventManager.trigger(self._eventManager.Events.ACTIVATE_VIEW, 'to-newplaylist');
        }, false);
        this._newPlaylistButton.addEventListener('click', function (e) {
          e.preventDefault();
          self._handleNewPlaylistAction(e);
        });
        this._newPlaylistInput.addEventListener('keydown', function (e) {
          self._clearPlaceholder();
        }, false);
        this._newPlaylistInput.addEventListener('keyup', function (e) {
          if (e.keyCode === 13) {
            self._handleNewPlaylistAction(e);
            return false;
          }
          self._updateClearButton();
          self._restorePlaceholder();
        }, false);
        this._newPlaylistInput.addEventListener('blur', function (e) {
          self._restorePlaceholder();
        }, false);
        this._newListInputClear.addEventListener('click', function (e) {
          e.preventDefault();
          self.clearCreateNew();
        });
      };
      NewPlaylistView.prototype._updateClearButton = function () {
        if (this._newPlaylistInput.value === '') {
          this._newListInputClear.style.display = 'none';
        } else {
          this._newListInputClear.style.display = 'block';
        }
      };
      NewPlaylistView.prototype._clearPlaceholder = function () {
        this._newPlaylistLabel.style.display = 'none';
      };
      NewPlaylistView.prototype._restorePlaceholder = function () {
        if (this._newPlaylistInput.value === '') {
          this._newPlaylistLabel.style.display = 'block';
        }
      };
      NewPlaylistView.prototype.focusCreateNew = function () {
        var i = this._newPlaylistInput;
        setTimeout(function () {
          i.focus();
        }, 300);
        utils.removeClass(this._newPlaylistInput, 'error');
      };
      NewPlaylistView.prototype.clearCreateNew = function () {
        this._newPlaylistInput.value = '';
        this._updateClearButton();
        utils.removeClass(this._newPlaylistInput, 'error');
        this._restorePlaceholder();
      };
      NewPlaylistView.prototype._handleNewPlaylistAction = function (e) {
        var self = this;
        e.preventDefault();
        if (self._newPlaylistButton._disabled) {
          return false;
        }
        self._newPlaylistButton._disabled = true;
        self._createNewPlaylist(self._newPlaylistInput, function (pl) {
          if (!pl) {
            self._eventManager.trigger(self._eventManager.Events.CLOSE);
            return;
          }
          self._eventManager.trigger(self._eventManager.Events.ADD_CONTEXT_TO_PLAYLIST, {
            playlist: pl,
            link: e.target
          });
        });
      };
      NewPlaylistView.prototype._createNewPlaylist = function (nameInput, cb) {
        var self = this;
        var name = nameInput.value;
        if (!name || name === '') {
          utils.addClass(nameInput, 'error');
          self._newPlaylistButton._disabled = false;
          return false;
        } else {
          utils.removeClass(nameInput, 'error');
        }
        self._throbber = Throbber.forElement(self.node);
        self._throbber.showContent();
        models.Playlist.create(name).done(function (playlist) {
          playlist.load('name', 'tracks').done(function (playlist) {
            cb(playlist);
            self._throbber.hide();
          });
        }).fail(function () {
          cb(null);
          self._throbber.hide();
        });
      };
    }(require('node_modules/api/scripts/models.js'), require('scripts/contextwidget.userplaylists.js'), require('scripts/playlist-utils.js'), require('node_modules/views/scripts/throbber.js').Throbber, require('@loc.loc/strings/main.lang')));
  },
  'node_modules/spotify-cosmos-api/scripts/serializables/serializable.js': function (require, module, exports, global, __filename, __dirname) {
    function Serializable(allowedProps, opt_initData) {
      if (!(this instanceof Serializable))
        return new Serializable(allowedProps, opt_initData);
      this._props = allowedProps || [];
      this._data = {};
      return this.setFromObject(opt_initData);
    }
    Serializable.prototype.set = function (key, value) {
      if (this._props.indexOf(key) > -1) {
        this._data[key] = value;
      }
    };
    Serializable.prototype.setFromObject = function (dataObj) {
      if (dataObj instanceof Serializable) {
        return this.setFromObject(dataObj.serialize());
      }
      if (dataObj && typeof dataObj !== 'object') {
        throw new TypeError('Object was expected, got `' + dataObj + '` of type `' + typeof dataObj + '` instead');
      }
      if (dataObj) {
        var keys = Object.keys(dataObj);
        for (var i = 0, l = keys.length; i < l; i++) {
          if (this._props.indexOf(keys[i]) > -1) {
            this._data[keys[i]] = dataObj[keys[i]];
          }
        }
      }
    };
    Serializable.prototype.get = function (key) {
      if (this._props.indexOf(key) > -1) {
        return this._data[key];
      }
    };
    Serializable.prototype.serialize = function () {
      var data = {};
      var key;
      var prop;
      for (var i = 0, l = this._props.length; i < l; i++) {
        key = this._props[i];
        prop = this._data[key];
        if (prop !== undefined) {
          if (prop instanceof Array) {
            data[key] = [];
            for (var j = 0, n = prop.length; j < n; j++) {
              data[key].push(this._serializeSingle(prop[j]));
            }
          } else {
            data[key] = this._serializeSingle(prop);
          }
        }
      }
      return data;
    };
    Serializable.prototype._serializeSingle = function (property) {
      if (property instanceof Serializable) {
        return property.serialize();
      } else {
        return property;
      }
    };
    exports.Serializable = Serializable;
  },
  'node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/src/message.js': function (require, module, exports, global, __filename, __dirname) {
    exports.Headers;
    exports.Body;
    exports.SerializedMessage;
    function Message(uri, opt_headers, opt_body) {
      if (uri == null)
        throw new TypeError('Invalid `uri` argument for Message.');
      this._uri = uri;
      this._headers = {};
      this._body = this._encodeBody(opt_body || '');
      if (opt_headers)
        this._setHeaders(opt_headers);
    }
    exports.Message = Message;
    Message.fromObject = function (object) {
      return object && object.uri ? new Message(object.uri, object.headers, object.body) : null;
    };
    Message.prototype._encodeBody = function (body) {
      if (typeof body != 'string') {
        body = JSON.stringify(body);
      }
      return body;
    };
    Message.prototype.getURI = function () {
      return this._uri;
    };
    Message.prototype.getMimeType = function () {
      return this._headers['accept'];
    };
    Message.prototype.getHeader = function (name) {
      return this._headers[name.toLowerCase()] || null;
    };
    Message.prototype.getHeaders = function () {
      var _headers = this._headers;
      var headers = {};
      for (var name in _headers) {
        if (!_headers.hasOwnProperty(name))
          continue;
        headers[name] = _headers[name];
      }
      return headers;
    };
    Message.prototype._setHeaders = function (headers) {
      var _headers = this._headers;
      for (var name in headers) {
        if (!headers.hasOwnProperty(name))
          continue;
        _headers[name.toLowerCase()] = headers[name];
      }
      return this;
    };
    Message.prototype.getBody = function () {
      return this._body;
    };
    Message.prototype.getJSONBody = function () {
      try {
        return JSON.parse(this._body);
      } catch (e) {
        return null;
      }
    };
    Message.prototype.copy = function (opt_headers, opt_body) {
      return new Message(this._uri, this._copyHeaders(opt_headers), typeof opt_body != 'undefined' ? opt_body : this._body);
    };
    Message.prototype._copyHeaders = function (opt_headers) {
      var headers;
      if (opt_headers) {
        var _headers = this._headers;
        var name;
        headers = {};
        for (name in _headers) {
          if (!_headers.hasOwnProperty(name))
            continue;
          headers[name] = _headers[name];
        }
        for (name in opt_headers) {
          if (!opt_headers.hasOwnProperty(name))
            continue;
          headers[name.toLowerCase()] = opt_headers[name];
        }
      } else {
        headers = this._headers;
      }
      return headers;
    };
    Message.prototype.serialize = function () {
      return this.toJSON();
    };
    Message.prototype.toJSON = function () {
      return {
        uri: this._uri,
        headers: this._headers,
        body: this._body
      };
    };
  },
  'node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/node_modules/js-common/src/environment.js': function (require, module, exports, global, __filename, __dirname) {
    var windowMock = {
      addEventListener: function () {
      },
      postMessage: function () {
      },
      location: {
        hostname: '',
        origin: '',
        protocol: ''
      }
    };
    exports.environment = global.window || windowMock;
  },
  'node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/node_modules/js-common/src/postrouter.js': function (require, module, exports, global, __filename, __dirname) {
    exports.MessageHandler;
    var env = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/node_modules/js-common/src/environment.js').environment;
    var handlers = {};
    function routeMessage(event) {
      var data = event.data;
      if (typeof data == 'string') {
        try {
          data = JSON.parse(data);
        } catch (e) {
          return;
        }
      }
      var handler = handlers[data.type];
      if (!handler)
        return;
      handler.call(this, event, data);
    }
    if (env.attachEvent && !env.addEventListener) {
      env.attachEvent('onmessage', routeMessage);
    } else {
      env.addEventListener('message', routeMessage, false);
    }
    exports.addMessageHandler = function (type, fn) {
      if (handlers[type])
        throw new Error('Rehandling of message "' + type + '" not allowed.');
      handlers[type] = fn;
      return;
    };
    exports.removeMessageHandler = function (type, fn) {
      if (handlers[type] == fn) {
        handlers[type] = null;
        return true;
      }
      return false;
    };
  },
  'node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/node_modules/js-common/src/defer.js': function (require, module, exports, global, __filename, __dirname) {
    var postrouter = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/node_modules/js-common/src/postrouter.js');
    var env = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/node_modules/js-common/src/environment.js').environment;
    var deferred = [];
    var send = env.postMessage.bind(env, '{"type": "execute_deferreds"}', env.location.origin || [
      env.location.protocol,
      env.location.hostname
    ].join('//'));
    function executeDeferreds() {
      var fns = deferred.splice(0);
      if (!fns.length)
        return;
      for (var i = 0, l = fns.length; i < l; i++) {
        var retry = true;
        try {
          fns[i]();
          retry = false;
        } finally {
          if (retry) {
            var trigger = !deferred.length;
            deferred = fns.slice(++i).concat(deferred);
            if (trigger)
              send();
          }
        }
      }
    }
    postrouter.addMessageHandler('execute_deferreds', executeDeferreds);
    exports.defer = function (fn) {
      var trigger = !deferred.length;
      deferred.push(fn);
      if (trigger)
        send();
    };
  },
  'node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/node_modules/js-common/src/helpers.js': function (require, module, exports, global, __filename, __dirname) {
    exports.shallowCopy = function (obj) {
      function Object() {
      }
      Object.prototype = obj;
      return new Object();
    };
    exports.inherit = function (Sub, Super) {
      var superProto = Super.prototype;
      function Superclass() {
      }
      Superclass.prototype = Sub._super = superProto;
      Superclass.prototype.constructor = Super;
      Sub.prototype = new Superclass();
      Sub.prototype._super = function (fn, args) {
        args = typeof args == 'arguments' || Array.isArray(args) ? args : slice.call(arguments, 1);
        return superProto[fn].apply(this, args);
      };
    };
  },
  'node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/node_modules/js-common/src/promise.js': function (require, module, exports, global, __filename, __dirname) {
    var defer = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/node_modules/js-common/src/defer.js').defer;
    var toString = Object.prototype.toString;
    var slice = Array.prototype.slice;
    function pipe(promiseA, promiseB) {
      promiseA.then(function (object) {
        promiseB.fulfill(object);
      }, function (error) {
        promiseB.fail(error);
      });
    }
    var states = {
      UNFULFILLED: 0,
      FULFILLED: 1,
      FAILED: 2
    };
    function Promise() {
      this._state = states.UNFULFILLED;
      this._value = null;
      this._handlers = [];
      this._deferred = false;
    }
    exports.Promise = Promise;
    Promise.defer = typeof setImmediate == 'function' ? function (fn) {
      setImmediate(fn);
    } : defer || function (fn) {
      setTimeout(fn, 0);
    };
    Promise.prototype.isUnfulfilled = function () {
      return this._state == states.UNFULFILLED;
    };
    Promise.prototype.isFulfilled = function () {
      return this._state == states.FULFILLED;
    };
    Promise.prototype.isFailed = function () {
      return this._state == states.FAILED;
    };
    Promise.prototype.fulfill = function (value) {
      var self = this;
      if (this._state !== states.UNFULFILLED)
        return;
      this._value = value;
      this._state = states.FULFILLED;
      if (!this._deferred) {
        Promise.defer(function () {
          self._runHandlers();
        });
        this._deferred = true;
      }
      return;
    };
    Promise.prototype.fail = function (error) {
      var self = this;
      if (this._state !== states.UNFULFILLED)
        return;
      this._value = error;
      this._state = states.FAILED;
      if (!this._deferred) {
        Promise.defer(function () {
          self._runHandlers();
        });
        this._deferred = true;
      }
      return;
    };
    Promise.prototype.then = function (fulfilledHandler, failedHandler) {
      var self = this;
      var promise = new Promise();
      this._handlers.push({
        fulfilled: fulfilledHandler,
        failed: failedHandler,
        promise: promise
      });
      if (this._state !== states.UNFULFILLED && !this._deferred) {
        Promise.defer(function () {
          self._runHandlers();
        });
        this._deferred = true;
      }
      return promise;
    };
    Promise.prototype.pipe = function (promise) {
      this.then(function (value) {
        promise.fulfill(value);
      }, function (error) {
        promise.fail(error);
      });
      return;
    };
    Promise.prototype._runHandlers = function () {
      this._deferred = false;
      var value = this._value;
      if (this._state == states.UNFULFILLED)
        return;
      var fulfilled = this._state === states.FULFILLED;
      var handlers = this._handlers.splice(0);
      for (var i = 0, l = handlers.length; i < l; i++) {
        var handler = handlers[i];
        var callback = handler[fulfilled ? 'fulfilled' : 'failed'];
        var promise = handler.promise;
        if (!callback || typeof callback != 'function') {
          if (value && typeof value.then == 'function') {
            pipe(value, promise);
            continue;
          } else {
            if (fulfilled) {
              promise.fulfill(value);
            } else {
              promise.fail(value);
            }
            continue;
          }
        }
        try {
          var returnValue = callback(value);
        } catch (e) {
          promise.fail(e);
          continue;
        }
        if (returnValue && typeof returnValue.then == 'function') {
          pipe(returnValue, promise);
        } else {
          promise.fulfill(returnValue);
        }
      }
    };
    Promise.prototype.catchError = function (failedHandler) {
      return this.then(null, failedHandler);
    };
    Promise.prototype.get = function (property) {
      var promise = new Promise();
      this.then(function (object) {
        promise.fulfill(object[property]);
      }, function (error) {
        promise.fail(error);
      });
      return promise;
    };
    Promise.prototype.call = function (method, var_args) {
      var args = slice.call(arguments, 1);
      var promise = new Promise();
      this.then(function (object) {
        try {
          promise.fulfill(object[method].apply(object, args));
        } catch (e) {
          promise.fail(e);
        }
      }, function (error) {
        promise.fail(error);
      });
      return promise;
    };
    Promise.prototype.thenSpread = function (fulfilledHandler, failedHandler) {
      return this.then(function (value) {
        return Array.isArray(value) ? fulfilledHandler.apply(this, value) : fulfilledHandler.call(this, value);
      }, failedHandler);
    };
    Promise.join = function (promises) {
      promises = Array.isArray(promises) ? promises : slice.call(arguments);
      var promise = new Promise();
      var length = promises.length;
      var result = [];
      var aggregator = function (index, obj) {
        result[index] = obj;
        length--;
        if (!length)
          promise.fulfill(result);
      };
      for (var i = 0, l = length; i < l; i++) {
        promises[i].then(aggregator.bind(null, i));
      }
      return promise;
    };
    Promise.group = function (promises) {
      promises = Array.isArray(promises) ? promises : slice.call(arguments);
      var promise = new Promise();
      for (var i = 0, l = promises.length; i < l; i++) {
        promise.pipe(promises[i]);
      }
      return promise;
    };
  },
  'node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/node_modules/js-common/index.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    exports.defer = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/node_modules/js-common/src/defer.js');
    exports.helpers = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/node_modules/js-common/src/helpers.js');
    exports.postrouter = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/node_modules/js-common/src/postrouter.js');
    exports.promise = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/node_modules/js-common/src/promise.js');
    exports.environment = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/node_modules/js-common/src/environment.js');
  },
  'node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/src/request.js': function (require, module, exports, global, __filename, __dirname) {
    var helpers = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/node_modules/js-common/index.js').helpers;
    var Message = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/src/message.js').Message;
    exports.Action = {
      DELETE: 'DELETE',
      GET: 'GET',
      HEAD: 'HEAD',
      POST: 'POST',
      PUT: 'PUT',
      SUB: 'SUB'
    };
    exports.SerializedRequest;
    function Request(action, uri, opt_headers, opt_body) {
      if (!(this instanceof Request))
        return new Request(action, uri, opt_headers, opt_body);
      if (!action)
        throw new TypeError('Invalid `action` argument for Request.');
      Message.call(this, uri, opt_headers, opt_body);
      this._action = action;
    }
    helpers.inherit(Request, Message);
    exports.Request = Request;
    Request.fromObject = function (object) {
      return object && object.action && object.uri ? new Request(object.action, object.uri, object.headers, object.body) : null;
    };
    Request.prototype.getAction = function () {
      return this._action;
    };
    Request.prototype.copy = function (opt_headers, opt_body) {
      return new Request(this._action, this._uri, this._copyHeaders(opt_headers), typeof opt_body != 'undefined' ? opt_body : this._body);
    };
    Request.prototype.toJSON = function () {
      return {
        action: this._action,
        uri: this._uri,
        headers: this._headers,
        body: this._body
      };
    };
  },
  'node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/src/response.js': function (require, module, exports, global, __filename, __dirname) {
    var helpers = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/node_modules/js-common/index.js').helpers;
    var Message = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/src/message.js').Message;
    exports.StatusCode = {
      OK: 200,
      CREATED: 201,
      ACCEPTED: 202,
      BAD_REQUEST: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      METHOD_NOT_ALLOWED: 405,
      TIMED_OUT: 408,
      CONFLICT: 409,
      GONE: 410,
      INTERNAL_SERVER_ERROR: 500,
      NOT_IMPLEMENTED: 501,
      BAD_GATEWAY: 502,
      SERVICE_UNAVAILABLE: 503
    };
    exports.SerializedResponse;
    function Response(uri, status, opt_headers, opt_body) {
      if (!(this instanceof Response))
        return new Response(uri, status, opt_headers, opt_body, opt_requestURI);
      if (typeof status == 'undefined' || status == null)
        throw new TypeError('Invalid `status` argument for Response.');
      Message.call(this, uri, opt_headers, opt_body);
      this._status = status;
    }
    helpers.inherit(Response, Message);
    exports.Response = Response;
    Response.fromObject = function (object) {
      return object && object.uri && object.status ? new Response(object.uri, object.status, object.headers, object.body) : null;
    };
    Response.prototype.getMimeType = function () {
      return this._headers['content-type'];
    };
    Response.prototype.getStatusCode = function () {
      return this._status;
    };
    Response.prototype.copy = function (opt_headers, opt_body) {
      return new Response(this._uri, this._status, this._copyHeaders(opt_headers), typeof opt_body != 'undefined' ? opt_body : this._body);
    };
    Response.prototype.toJSON = function () {
      return {
        uri: this._uri,
        status: this._status,
        headers: this._headers,
        body: this._body
      };
    };
  },
  'node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/src/player_state.js': function (require, module, exports, global, __filename, __dirname) {
    var helpers = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/node_modules/js-common/index.js').helpers;
    function PlayerState(stateData) {
      Serializable.call(this, [
        'action',
        'context',
        'tracks',
        'index',
        'playing',
        'loading',
        'track',
        'position',
        'duration',
        'volume',
        'options',
        'play_origin',
        'next_page_url',
        'prev_page_url'
      ]);
      stateData = stateData || {};
      this.action = stateData.action;
      this.context = stateData.context;
      this.tracks = stateData.tracks;
      this.index = stateData.index;
      this.playing = stateData.playing;
      this.loading = stateData.loading;
      this.track = stateData.track;
      this.position = stateData.position;
      this.volume = stateData.volume;
      this.duration = stateData.duration;
      this.options = new PlayOptions(stateData.options);
      this.play_origin = new PlayOrigin(stateData.play_origin);
      this.next_page_url = stateData.next_page_url;
      this.prev_page_url = stateData.prev_page_url;
    }
    helpers.inherit(PlayerState, Serializable);
    PlayerState.prototype.serialize = function () {
      if (this.options && !(this.options instanceof PlayOptions)) {
        this.options = new PlayOptions(this.options);
      }
      if (this.play_origin && !(this.play_origin instanceof PlayOrigin)) {
        this.play_origin = new PlayOrigin(this.play_origin);
      }
      return this._super('serialize', []);
    };
    PlayerState.ACTIONS = {
      UNKNOWN: 'unknown',
      PLAY: 'play',
      UPDATE: 'update',
      STOP: 'stop',
      RESUME: 'resume',
      PAUSE: 'pause',
      SKIP_PREV: 'skip_prev',
      SKIP_NEXT: 'skip_next'
    };
    function PlayOrigin(data) {
      Serializable.call(this, [
        'source',
        'reason',
        'referrer',
        'referrer_version',
        'referrer_vendor'
      ]);
      data = data || {};
      this.source = data.source || 'unknown';
      this.reason = data.reason || 'unknown';
      this.referrer = data.referrer || 'unknown';
      this.referrer_version = data.referrer_version || 'unknown';
      this.referrer_vendor = data.referrer_vendor || 'unknown';
    }
    helpers.inherit(PlayOrigin, Serializable);
    function PlayOptions(options) {
      Serializable.call(this, [
        'repeat',
        'shuffle',
        'can_repeat',
        'can_shuffle',
        'can_skip_prev',
        'can_skip_next',
        'can_seek',
        'use_dmca_rules'
      ]);
      options = options || {};
      this.repeat = options.repeat !== undefined ? options.repeat : false;
      this.shuffle = options.shuffle !== undefined ? options.shuffle : false;
      this.can_repeat = options.can_repeat !== undefined ? options.can_repeat : true;
      this.can_shuffle = options.can_shuffle !== undefined ? options.can_shuffle : true;
      this.can_skip_prev = options.can_skip_prev !== undefined ? options.can_skip_prev : true;
      this.can_skip_next = options.can_skip_next !== undefined ? options.can_skip_next : true;
      this.can_seek = options.can_seek !== undefined ? options.can_seek : true;
      this.use_dmca_rules = options.use_dmca_rules !== undefined ? options.use_dmca_rules : false;
    }
    helpers.inherit(PlayOptions, Serializable);
    function Serializable(allowedProps) {
      this._props = allowedProps || [];
    }
    Serializable.prototype.serialize = function () {
      var data = {};
      var prop;
      for (var i = 0, l = this._props.length; i < l; i++) {
        prop = this._props[i];
        if (this[prop] !== undefined) {
          if (this[prop] instanceof Serializable) {
            data[prop] = this[prop].serialize();
          } else {
            data[prop] = this[prop];
          }
        }
      }
      return data;
    };
    exports.PlayerState = PlayerState;
  },
  'node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/index.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    exports.helpers = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/node_modules/js-common/index.js').helpers;
    exports.message = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/src/message.js');
    exports.request = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/src/request.js');
    exports.response = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/src/response.js');
    exports.playerstate = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/src/player_state.js');
  },
  'node_modules/spotify-cosmos-api/scripts/player_v1.js': function (require, module, exports, global, __filename, __dirname) {
    var common = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/index.js');
    var PlayerState = common.playerstate.PlayerState;
    var Request = common.request.Request;
    var Response = common.response.Response;
    var Action = common.request.Action;
    var PLAYER_URI = 'sp://player/v1/main';
    var TRACK_RESOLVER_URI = 'hm://track-resolver/v1?uri=';
    function Player(resolver, referrer, referrer_version, referrer_vendor) {
      if (!resolver || !referrer || !referrer_version || !referrer_vendor) {
        throw new TypeError('Missing parameters for Player');
      }
      this._resolver = resolver;
      this._referrer = referrer;
      this._referrer_version = referrer_version;
      this._referrer_vendor = referrer_vendor;
      this._addReferrerInfo = this._addReferrerInfo.bind(this);
    }
    Player.stateFromUri = function (uri) {
      var playerState = new PlayerState();
      playerState.tracks = [];
      playerState.context = uri;
      if (/^spotify:user:[^:]+:(playlist:|starred)/.test(uri)) {
        playerState.next_page_url = uri;
      } else {
        playerState.next_page_url = TRACK_RESOLVER_URI + encodeURI(uri);
      }
      return playerState;
    };
    Player.prototype.play = function (playerState, opt_callback) {
      if (!(playerState instanceof PlayerState)) {
        throw new TypeError('Invalid `playerState` argument');
      }
      playerState.action = PlayerState.ACTIONS.PLAY;
      return this._sendRequest(playerState, opt_callback);
    };
    Player.prototype.update = function (playerState, opt_callback) {
      if (!(playerState instanceof PlayerState)) {
        throw new TypeError('Invalid `playerState` argument');
      }
      playerState.action = PlayerState.ACTIONS.UPDATE;
      return this._sendRequest(playerState, opt_callback);
    };
    Player.prototype.stop = function (opt_callback) {
      var playerState = new PlayerState();
      playerState.action = PlayerState.ACTIONS.STOP;
      return this._sendRequest(playerState, opt_callback);
    };
    Player.prototype.resume = function (opt_callback) {
      var playerState = new PlayerState();
      playerState.action = PlayerState.ACTIONS.RESUME;
      return this._sendRequest(playerState, opt_callback);
    };
    Player.prototype.pause = function (opt_callback) {
      var playerState = new PlayerState();
      playerState.action = PlayerState.ACTIONS.PAUSE;
      return this._sendRequest(playerState, opt_callback);
    };
    Player.prototype.skipPrev = function (opt_callback) {
      var playerState = new PlayerState();
      playerState.action = PlayerState.ACTIONS.SKIP_PREV;
      return this._sendRequest(playerState, opt_callback);
    };
    Player.prototype.skipNext = function (opt_callback) {
      var playerState = new PlayerState();
      playerState.action = PlayerState.ACTIONS.SKIP_NEXT;
      return this._sendRequest(playerState, opt_callback);
    };
    Player.prototype._sendRequest = function (playerState, opt_callback) {
      this._addReferrerInfo(playerState);
      var request = new Request(Action.POST, PLAYER_URI, null, playerState.serialize());
      return this._resolver.resolve(request, opt_callback);
    };
    Player.prototype._addReferrerInfo = function (playerState) {
      playerState.play_origin.referrer = this._referrer;
      playerState.play_origin.referrer_version = this._referrer_version;
      playerState.play_origin.referrer_vendor = this._referrer_vendor;
      return playerState;
    };
    Player.prototype._parseState = function (body) {
      try {
        var state = JSON.parse(body);
        state = new PlayerState(state);
        return JSON.stringify(state.serialize());
      } catch (e) {
        return body;
      }
    };
    Player.prototype.getState = function (callback) {
      var self = this;
      var request = new Request(Action.GET, PLAYER_URI);
      return this._resolver.resolve(request, function (err, response) {
        var body = response && response.getBody();
        if (body) {
          var playerState = self._parseState(body);
          response = new Response(response.getURI(), response.getStatusCode(), response.getHeaders(), playerState);
        }
        if (typeof callback === 'function') {
          callback(err, response);
        }
      });
    };
    Player.prototype.setReferrer = function (referrer) {
      if (referrer) {
        this._referrer = referrer;
      }
    };
    Player.prototype.subscribe = function (callback) {
      var request = new Request(Action.SUB, PLAYER_URI);
      return this._resolver.resolve(request, callback);
    };
    exports.Player = Player;
  },
  'node_modules/spotify-cosmos-api/scripts/resolver.js': function (require, module, exports, global, __filename, __dirname) {
    var common = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/index.js');
    var Request = common.request.Request;
    var Action = common.request.Action;
    var Response = common.response.Response;
    function Resolver(spResolver) {
      if (!spResolver || typeof spResolver.resolve !== 'function') {
        throw TypeError('Incorrect resolver argument');
      }
      this._resolver = spResolver;
    }
    Resolver.prototype.resolve = function (request, callback) {
      return this._resolve(request, callback);
    };
    Resolver.prototype.get = function (options, callback) {
      return this._resolveFromParams(Action.GET, options, callback);
    };
    Resolver.prototype.post = function (options, callback) {
      return this._resolveFromParams(Action.POST, options, callback);
    };
    Resolver.prototype.subscribe = function (options, callback) {
      return this._resolveFromParams(Action.SUB, options, callback);
    };
    Resolver.prototype._resolve = function (request, callback) {
      if (!callback || typeof callback !== 'function') {
        callback = function () {
        };
      }
      function onSuccess(serverResponse) {
        var response = Response.fromObject(serverResponse);
        if (!response) {
          return callback(new Error('Cannot create a response from object: ' + JSON.stringify(serverResponse)));
        }
        return callback(null, response);
      }
      function onError(serverResponse) {
        var response = Response.fromObject(serverResponse);
        return callback(response || new Error('Cannot create a response from object: ' + JSON.stringify(serverResponse)));
      }
      var resolveFn = request.getAction() === Action.SUB ? this._resolver.subscribe : this._resolver.resolve;
      var clientRequest = resolveFn.call(this._resolver, request, onSuccess, onError);
      return new RequestHandler(clientRequest);
    };
    Resolver.prototype._resolveFromParams = function (method, options, callback) {
      options = options || {};
      var url = typeof options === 'string' ? options : options.url;
      var headers = options.headers;
      var body = options.body;
      var request = new Request(method, url, headers, body);
      return this._resolve(request, callback);
    };
    function RequestHandler(request) {
      if (!request || typeof request.close !== 'function')
        throw new TypeError('Invalid `request` argument.');
      this._request = request;
    }
    RequestHandler.prototype.cancel = function () {
      if (this._request) {
        this._request.close();
        this._request = null;
      }
    };
    exports.Resolver = Resolver;
  },
  'node_modules/spotify-cosmos-api/node_modules/spotify-inheritance/inherit.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var inherit = function (Sub, Super) {
      var superProto = Super.prototype;
      function Superclass() {
      }
      Superclass.prototype = Sub._super = superProto;
      Superclass.prototype.constructor = Super;
      Sub.prototype = new Superclass();
    };
    module.exports = inherit;
  },
  'node_modules/spotify-cosmos-api/node_modules/spotify-inheritance/extend.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var extend = function (obj, args) {
      var source;
      for (var i = 1; i < arguments.length; i++) {
        source = arguments[i];
        if (source) {
          for (var prop in source) {
            if (source.hasOwnProperty(prop)) {
              obj[prop] = source[prop];
            }
          }
        }
      }
      return obj;
    };
    module.exports = extend;
  },
  'node_modules/spotify-cosmos-api/node_modules/spotify-inheritance/index.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    module.exports = {
      inherit: require('node_modules/spotify-cosmos-api/node_modules/spotify-inheritance/inherit.js'),
      extend: require('node_modules/spotify-cosmos-api/node_modules/spotify-inheritance/extend.js')
    };
  },
  'node_modules/spotify-cosmos-api/scripts/serializables/play_origin.js': function (require, module, exports, global, __filename, __dirname) {
    var inherit = require('node_modules/spotify-cosmos-api/node_modules/spotify-inheritance/index.js').inherit;
    var Serializable = require('node_modules/spotify-cosmos-api/scripts/serializables/serializable.js').Serializable;
    function PlayOrigin(originData) {
      if (!(this instanceof PlayOrigin))
        return new PlayOrigin(originData);
      Serializable.call(this, [
        'feature_identifier',
        'feature_version',
        'view_uri',
        'external_referrer'
      ], originData);
    }
    inherit(PlayOrigin, Serializable);
    exports.PlayOrigin = PlayOrigin;
  },
  'node_modules/spotify-cosmos-api/scripts/serializables/restrictions.js': function (require, module, exports, global, __filename, __dirname) {
    var inherit = require('node_modules/spotify-cosmos-api/node_modules/spotify-inheritance/index.js').inherit;
    var Serializable = require('node_modules/spotify-cosmos-api/scripts/serializables/serializable.js').Serializable;
    function PlayerRestrictions(restrictionsData) {
      if (!(this instanceof PlayerRestrictions))
        return new PlayerRestrictions(restrictionsData);
      Serializable.call(this, [
        'disallow_skipping_prev',
        'disallow_skipping_next',
        'disallow_peeking_prev',
        'disallow_peeking_next',
        'disallow_skipping_to',
        'disallow_pausing',
        'disallow_resuming',
        'disallow_repeating_context',
        'disallow_repeating_track',
        'disallow_shuffling',
        'disallow_seeking',
        'disallow_muting'
      ], restrictionsData);
    }
    inherit(PlayerRestrictions, Serializable);
    exports.PlayerRestrictions = PlayerRestrictions;
  },
  'node_modules/spotify-cosmos-api/scripts/serializables/track.js': function (require, module, exports, global, __filename, __dirname) {
    var inherit = require('node_modules/spotify-cosmos-api/node_modules/spotify-inheritance/index.js').inherit;
    var Serializable = require('node_modules/spotify-cosmos-api/scripts/serializables/serializable.js').Serializable;
    function PlayerTrack(trackData) {
      if (!(this instanceof PlayerTrack))
        return new PlayerTrack(trackData);
      Serializable.call(this, [
        'uri',
        'album_uri',
        'artist_uri',
        'source_uri',
        'custom'
      ], trackData);
    }
    inherit(PlayerTrack, Serializable);
    exports.PlayerTrack = PlayerTrack;
  },
  'node_modules/spotify-cosmos-api/scripts/serializables/page.js': function (require, module, exports, global, __filename, __dirname) {
    var inherit = require('node_modules/spotify-cosmos-api/node_modules/spotify-inheritance/index.js').inherit;
    var Serializable = require('node_modules/spotify-cosmos-api/scripts/serializables/serializable.js').Serializable;
    var PlayerTrack = require('node_modules/spotify-cosmos-api/scripts/serializables/track.js').PlayerTrack;
    function PlayerContextPage(pageData) {
      if (!(this instanceof PlayerContextPage))
        return new PlayerContextPage(pageData);
      Serializable.call(this, [
        'page_url',
        'next_page_url',
        'tracks'
      ], pageData);
    }
    inherit(PlayerContextPage, Serializable);
    exports.PlayerContextPage = PlayerContextPage;
    PlayerContextPage.fromTrackList = function (trackList) {
      if (!(trackList instanceof Array))
        throw new TypeError('trackList needs to be an array');
      var page = new PlayerContextPage();
      page.set('tracks', page._makeTracksFromList(trackList || []));
      return page;
    };
    PlayerContextPage.prototype._makeTracksFromList = function (tracksList) {
      var tracks = [];
      var track;
      for (var i = 0, l = tracksList.length; i < l; i++) {
        track = new PlayerTrack(tracksList[i]);
        if (Object.keys(track.serialize()).length) {
          tracks.push(track);
        }
      }
      return tracks;
    };
    PlayerContextPage.prototype.serialize = function () {
      var tracks = this.get('tracks');
      this.set('tracks', this._makeTracksFromList(tracks || []));
      return this.constructor.prototype.serialize.call(this);
    };
  },
  'node_modules/spotify-cosmos-api/scripts/serializables/context.js': function (require, module, exports, global, __filename, __dirname) {
    var inherit = require('node_modules/spotify-cosmos-api/node_modules/spotify-inheritance/index.js').inherit;
    var Serializable = require('node_modules/spotify-cosmos-api/scripts/serializables/serializable.js').Serializable;
    var PlayerRestrictions = require('node_modules/spotify-cosmos-api/scripts/serializables/restrictions.js').PlayerRestrictions;
    var PlayerContextPage = require('node_modules/spotify-cosmos-api/scripts/serializables/page.js').PlayerContextPage;
    var TRACK_RESOLVER_URI = 'hm://track-resolver/v1?uri=';
    function PlayerContext(contextData) {
      if (!(this instanceof PlayerContext))
        return new PlayerContext(contextData);
      Serializable.call(this, [
        'entity_uri',
        'pages',
        'fallback_pages',
        'restrictions'
      ], contextData);
    }
    inherit(PlayerContext, Serializable);
    exports.PlayerContext = PlayerContext;
    PlayerContext.contextWithTracks = function (trackList) {
      if (!(trackList instanceof Array))
        throw new TypeError('trackList needs to be an array');
      var page = PlayerContextPage.fromTrackList(trackList);
      var context = new PlayerContext();
      context.set('pages', [page]);
      return context;
    };
    PlayerContext.prototype._makePagesFromList = function (pagesList) {
      var pages = [];
      for (var i = 0, l = pagesList.length; i < l; i++) {
        pages.push(new PlayerContextPage(pagesList[i]));
      }
      return pages;
    };
    PlayerContext.prototype.serialize = function () {
      var restrictions = this.get('restrictions');
      var pages = this.get('pages');
      var fallbackPages = this.get('fallback_pages');
      this.set('restrictions', new PlayerRestrictions(restrictions));
      this.set('pages', this._makePagesFromList(pages || []));
      this.set('fallback_pages', this._makePagesFromList(fallbackPages || []));
      return this.constructor.prototype.serialize.call(this);
    };
  },
  'node_modules/spotify-cosmos-api/scripts/serializables/index_path.js': function (require, module, exports, global, __filename, __dirname) {
    var inherit = require('node_modules/spotify-cosmos-api/node_modules/spotify-inheritance/index.js').inherit;
    var Serializable = require('node_modules/spotify-cosmos-api/scripts/serializables/serializable.js').Serializable;
    function IndexPath(data) {
      if (!(this instanceof IndexPath))
        return new IndexPath(data);
      Serializable.call(this, [
        'page',
        'track'
      ], data);
    }
    inherit(IndexPath, Serializable);
    exports.IndexPath = IndexPath;
  },
  'node_modules/spotify-cosmos-api/scripts/serializables/options.js': function (require, module, exports, global, __filename, __dirname) {
    var inherit = require('node_modules/spotify-cosmos-api/node_modules/spotify-inheritance/index.js').inherit;
    var Serializable = require('node_modules/spotify-cosmos-api/scripts/serializables/serializable.js').Serializable;
    var IndexPath = require('node_modules/spotify-cosmos-api/scripts/serializables/index_path.js').IndexPath;
    function PlayOptions(optionsData) {
      if (!(this instanceof PlayOptions))
        return new PlayOptions(optionsData);
      Serializable.call(this, [
        'skip_to_index',
        'seek_to',
        'initially_paused',
        'update_without_interruption',
        'player_options_override'
      ], optionsData);
    }
    inherit(PlayOptions, Serializable);
    exports.PlayOptions = PlayOptions;
    PlayOptions.prototype.serialize = function () {
      var index = this.get('skip_to_index');
      this.set('skip_to_index', new IndexPath(index));
      return this.constructor.prototype.serialize.call(this);
    };
  },
  'node_modules/spotify-cosmos-api/scripts/serializables/index.js': function (require, module, exports, global, __filename, __dirname) {
    exports.PlayerContext = require('node_modules/spotify-cosmos-api/scripts/serializables/context.js').PlayerContext;
    exports.PlayOptions = require('node_modules/spotify-cosmos-api/scripts/serializables/options.js').PlayOptions;
    exports.PlayOrigin = require('node_modules/spotify-cosmos-api/scripts/serializables/play_origin.js').PlayOrigin;
    exports.PlayerRestrictions = require('node_modules/spotify-cosmos-api/scripts/serializables/restrictions.js').PlayerRestrictions;
    exports.PlayerTrack = require('node_modules/spotify-cosmos-api/scripts/serializables/track.js').PlayerTrack;
    exports.PlayerContextPage = require('node_modules/spotify-cosmos-api/scripts/serializables/page.js').PlayerContextPage;
    exports.IndexPath = require('node_modules/spotify-cosmos-api/scripts/serializables/index_path.js').IndexPath;
    exports.Base = require('node_modules/spotify-cosmos-api/scripts/serializables/serializable.js').Serializable;
  },
  'node_modules/spotify-cosmos-api/scripts/player_v2.js': function (require, module, exports, global, __filename, __dirname) {
    var common = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/index.js');
    var Request = common.request.Request;
    var Response = common.response.Response;
    var Action = common.request.Action;
    var serializables = require('node_modules/spotify-cosmos-api/scripts/serializables/index.js');
    var PlayerContext = serializables.PlayerContext;
    var PlayOptions = serializables.PlayOptions;
    var PlayOrigin = serializables.PlayOrigin;
    var Serializeable = serializables.Base;
    var PLAYER_URI = 'sp://player/v2/';
    var DEFAULT_PLAYER_ID = 'main';
    function Player(resolver, viewUri, featureIdentifier, featureVersion, opt_options) {
      if (!(this instanceof Player)) {
        return new Player(resolver, viewUri, featureIdentifier, featureVersion);
      }
      if (!resolver || !viewUri || !featureIdentifier || !featureVersion) {
        throw new TypeError('Missing parameters for Player');
      }
      this._id = opt_options && opt_options.playerId || DEFAULT_PLAYER_ID;
      this._resolver = resolver;
      this._viewUri = viewUri;
      this._featureId = featureIdentifier;
      this._featureVersion = featureVersion;
    }
    Player.Actions = {
      PLAY: 'play',
      PAUSE: 'pause',
      RESUME: 'resume',
      STOP: 'stop',
      SKIP_NEXT: 'skip_next',
      SKIP_PREV: 'skip_prev',
      SHUFFLE: 'set_shuffling_context',
      REPEAT_CONTEXT: 'set_repeating_context',
      REPEAT_TRACK: 'set_repeating_track',
      SEEK_TO: 'seek_to'
    };
    Player.prototype.play = function (contextConfig, opt_options, opt_callback) {
      contextConfig = contextConfig || {};
      var context = contextConfig instanceof PlayerContext ? contextConfig : contextConfig.context;
      var viewUri = contextConfig.viewUri;
      var externalReferrer = contextConfig.externalReferrer;
      if (!(context instanceof PlayerContext))
        throw new TypeError('Invalid `context` object');
      var origin = this._makePlayOrigin(viewUri, externalReferrer);
      if (arguments.length == 2 && arguments[1] instanceof Function) {
        opt_callback = arguments[1];
        opt_options = null;
      }
      var params = {};
      params.context = context.serialize();
      params.play_origin = origin.serialize();
      if (opt_options) {
        params.options = new PlayOptions(opt_options).serialize();
      }
      return this._sendRequestWithParams(Player.Actions.PLAY, params, opt_callback);
    };
    Player.prototype.stop = function (opt_callback) {
      return this._sendRequestWithAction(Player.Actions.STOP, opt_callback);
    };
    Player.prototype.resume = function (opt_callback) {
      return this._sendRequestWithAction(Player.Actions.RESUME, opt_callback);
    };
    Player.prototype.pause = function (opt_callback) {
      return this._sendRequestWithAction(Player.Actions.PAUSE, opt_callback);
    };
    Player.prototype.skipToPrev = function (opt_callback) {
      return this._sendRequestWithAction(Player.Actions.SKIP_PREV, opt_callback);
    };
    Player.prototype.skipToNext = function (opt_callback) {
      return this._sendRequestWithAction(Player.Actions.SKIP_NEXT, opt_callback);
    };
    Player.prototype.setShufflingContext = function (isShuffling, opt_callback) {
      return this._sendRequestWithParam(Player.Actions.SHUFFLE, isShuffling, opt_callback);
    };
    Player.prototype.setRepeatingContext = function (isRepeating, opt_callback) {
      return this._sendRequestWithParam(Player.Actions.REPEAT_CONTEXT, isRepeating, opt_callback);
    };
    Player.prototype.setRepeatingTrack = function (isRepeating, opt_callback) {
      return this._sendRequestWithParam(Player.Actions.REPEAT_TRACK, isRepeating, opt_callback);
    };
    Player.prototype.seekTo = function (positionInMs, opt_callback) {
      return this._sendRequestWithParam(Player.Actions.SEEK_TO, positionInMs, opt_callback);
    };
    Player.prototype.getState = function (callback) {
      var request = new Request(Action.GET, this.getPlayerEndpointUri());
      return this._resolver.resolve(request, callback);
    };
    Player.prototype.subscribe = function (callback) {
      var request = new Request(Action.SUB, this.getPlayerEndpointUri());
      return this._resolver.resolve(request, callback);
    };
    Player.prototype.onError = function (callback) {
      var request = new Request(Action.SUB, this.getPlayerEndpointUri() + '/error');
      return this._resolver.resolve(request, callback);
    };
    Player.prototype._makePlayOrigin = function (viewUri, externalReferrer) {
      var origin = new PlayOrigin();
      origin.set('view_uri', viewUri || this._viewUri);
      if (externalReferrer) {
        origin.set('external_referrer', externalReferrer);
      }
      origin.set('feature_identifier', this._featureId);
      origin.set('feature_version', this._featureVersion);
      return origin;
    };
    Player.prototype.getPlayerEndpointUri = function () {
      return PLAYER_URI + this._id;
    };
    Player.prototype._sendRequestWithAction = function (action, opt_callback) {
      return this._sendRequestWithParams(action, null, opt_callback);
    };
    Player.prototype._sendRequestWithParam = function (action, paramValue, opt_callback) {
      var params = { value: paramValue };
      return this._sendRequestWithParams(action, params, opt_callback);
    };
    Player.prototype._sendRequestWithParams = function (action, params, opt_callback) {
      var requestUri = this.getPlayerEndpointUri() + '/' + action;
      var requestBody = new Serializeable([
        'context',
        'options',
        'play_origin',
        'value'
      ]);
      requestBody.setFromObject(params);
      var request = new Request(Action.POST, requestUri, null, requestBody.serialize());
      return this._resolver.resolve(request, opt_callback);
    };
    exports.Player = Player;
  },
  'node_modules/spotify-cosmos-api/node_modules/spotify-deferred/node_modules/spotify-postrouter/src/postrouter.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var setImmediate = setImmediate ? setImmediate : setTimeout;
    var CURRENT_WINDOW_ORIGIN = undefined;
    if (typeof window !== 'undefined') {
      CURRENT_WINDOW_ORIGIN = window.location.origin || window.location.protocol + '//' + window.location.hostname;
    }
    var handlers = {};
    var isListening = false;
    function handleImmediateMessage(data) {
      var handler = handlers[data.type];
      if (!handler)
        return;
      handler.fn.call(this, data);
    }
    function handlePostMessage(event) {
      var data = event.data;
      if (typeof data == 'string') {
        try {
          data = JSON.parse(data);
        } catch (e) {
          return;
        }
      }
      var handler = handlers[data.type];
      if (!handler || handler.origin != '*' && event.origin !== handler.origin) {
        return;
      }
      handler.fn.call(this, data, event);
    }
    var startListening = function () {
      if (window.attachEvent && !window.addEventListener) {
        window.attachEvent('onmessage', handlePostMessage);
      } else {
        window.addEventListener('message', handlePostMessage, false);
      }
    };
    var addMessageHandler = function (type, fn, origin) {
      if (typeof window !== 'undefined' && !isListening) {
        startListening();
        isListening = true;
      }
      if (!origin) {
        origin = CURRENT_WINDOW_ORIGIN;
      }
      if (handlers[type]) {
        throw new Error('Rehandling of message "' + type + '" not allowed.');
      }
      handlers[type] = {
        fn: fn,
        origin: origin
      };
      return;
    };
    var removeMessageHandler = function (type, fn) {
      if (handlers[type] && (!fn || handlers[type].fn === fn)) {
        handlers[type] = null;
        return true;
      }
      return false;
    };
    var sendMessage = function (type, data, destWindow, origin) {
      data = data || {};
      data.type = type;
      if (typeof window === 'undefined') {
        return setImmediate(handleImmediateMessage.bind(null, data));
      }
      destWindow = destWindow || window;
      if (!origin) {
        origin = CURRENT_WINDOW_ORIGIN;
      }
      destWindow.postMessage(JSON.stringify(data), origin);
    };
    module.exports = {
      addMessageHandler: addMessageHandler,
      removeMessageHandler: removeMessageHandler,
      sendMessage: sendMessage,
      WINDOW_ORIGIN: CURRENT_WINDOW_ORIGIN
    };
  },
  'node_modules/spotify-cosmos-api/node_modules/spotify-deferred/src/deferred.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var PostRouter = require('node_modules/spotify-cosmos-api/node_modules/spotify-deferred/node_modules/spotify-postrouter/src/postrouter.js');
    var deferred = [];
    var send = function () {
      PostRouter.sendMessage('execute_deferreds');
    };
    function executeDeferreds() {
      var fns = deferred.splice(0);
      if (!fns.length)
        return;
      for (var i = 0, l = fns.length; i < l; i++) {
        try {
          fns[i]();
        } finally {
          null;
        }
      }
    }
    PostRouter.addMessageHandler('execute_deferreds', executeDeferreds);
    var defer = function (fn) {
      var trigger = !deferred.length;
      deferred.push(fn);
      if (trigger)
        send();
    };
    module.exports = defer;
  },
  'node_modules/spotify-cosmos-api/env/request.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var defer = require('node_modules/spotify-cosmos-api/node_modules/spotify-deferred/src/deferred.js');
    function ClientRequest(resolver, requestId, data, onsuccess, onerror) {
      this._requestId = requestId;
      this._resolver = resolver;
      this._requestData = data;
      this._successCallback = onsuccess;
      this._errorCallback = onerror;
      this._status = ClientRequest.status.INITIALIZED;
    }
    exports.ClientRequest = ClientRequest;
    ClientRequest.status = {
      INITIALIZED: 'INITIALIZED',
      CLOSED: 'CLOSED',
      OPEN: 'OPEN'
    };
    ClientRequest.messages = {
      OPEN: 'cosmos_request_create',
      PULL: 'cosmos_request_pull',
      CLOSE: 'cosmos_request_cancel'
    };
    ClientRequest.prototype.open = function () {
      if (this._status === ClientRequest.status.INITIALIZED) {
        this._status = ClientRequest.status.OPEN;
        this._sendRequest(ClientRequest.messages.OPEN, this._requestData);
      }
    };
    ClientRequest.prototype.pull = function () {
      if (this._status === ClientRequest.status.OPEN) {
        this._sendRequest(ClientRequest.messages.PULL, this._requestData);
      }
      return this._status;
    };
    ClientRequest.prototype.close = function () {
      if (this._status === ClientRequest.status.OPEN) {
        this._status = ClientRequest.status.CLOSE;
        this._sendRequest(ClientRequest.messages.CLOSE);
      }
    };
    ClientRequest.prototype.onClose = function () {
    };
    ClientRequest.prototype._sendRequest = function (requestName, data) {
      this._resolver._sendRequest(requestName, this._requestId, data || {});
    };
    ClientRequest.prototype._handleResponse = function (requestName, data) {
      var self = this;
      var status = data && data.status;
      var callback;
      if (requestName === ClientRequest.messages.CLOSE) {
        this._successCallback = null;
        this._errorCallback = null;
        this._requestData = null;
        this.onClose(this._requestId);
        return;
      }
      if (this._isSuccessStatus(status)) {
        callback = this._successCallback;
      } else {
        callback = this._errorCallback;
      }
      callback = typeof callback === 'function' ? callback : function () {
      };
      defer(callback.bind(this, data));
    };
    ClientRequest.prototype._isSuccessStatus = function (status) {
      return status >= 200 && status <= 299;
    };
  },
  'node_modules/spotify-cosmos-api/env/bootstrap.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var ClientRequest = require('node_modules/spotify-cosmos-api/env/request.js').ClientRequest;
    var resolverUID = 0;
    function Resolver() {
      if (!(this instanceof Resolver))
        return new Resolver();
      this._id = resolverUID++;
      this._requestID = 0;
      this._handlers = {};
    }
    exports.Resolver = Resolver;
    Resolver.prototype._addHandler = function (requestID, handler) {
      this._handlers[requestID] = handler;
      return this;
    };
    Resolver.prototype._removeHandler = function (requestID) {
      this._handlers[requestID] = null;
      return this;
    };
    Resolver.prototype._sendRequest = function (requestID, data) {
      throw new Error('Resolver _sendRequest not implemented.');
    };
    Resolver.prototype._handleResponse = function (response) {
      throw new Error('Resolver _handleResponse not implemented.');
    };
    Resolver.prototype._dispatchResponse = function (requestID, requestType, data) {
      var handler = this._handlers[requestID];
      if (!handler)
        return;
      handler._handleResponse(requestType, data);
    };
    Resolver.prototype._resolve = function (data, onsuccess, onerror) {
      if (!data || !onsuccess || !onerror || typeof onsuccess != 'function' || typeof onerror != 'function')
        throw new TypeError('Invalid argument length for `resolve`.');
      var requestID = ++this._requestID;
      var request = new ClientRequest(this, requestID, data, onsuccess, onerror);
      this._addHandler(requestID, request);
      request.onClose = this._removeHandler.bind(this);
      request.open();
      return request;
    };
    Resolver.prototype.resolve = function (data, onsuccess, onerror) {
      throw new Error('Resolver resolve not implemented.');
    };
    Resolver.prototype.subscribe = function (data, onsuccess, onerror) {
      throw new Error('Resolver subscribe not implemented.');
    };
  },
  'node_modules/spotify-cosmos-api/env/bootstrap.native.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var SpotifyApi = global.SpotifyApi;
    var useApiRequest = !!(SpotifyApi && SpotifyApi.api && typeof SpotifyApi.api.request === 'function');
    var Resolver = require('node_modules/spotify-cosmos-api/env/bootstrap.js').Resolver;
    var defer = require('node_modules/spotify-cosmos-api/node_modules/spotify-deferred/src/deferred.js');
    function NativeResolver(spBridge) {
      if (!(this instanceof NativeResolver))
        return new NativeResolver();
      if (!spBridge) {
        throw new TypeError('Missing `spBridge` parameter');
      }
      Resolver.call(this);
      this._bridge = spBridge;
      this._deferredFlush = false;
    }
    NativeResolver.prototype = new Resolver();
    NativeResolver.prototype.constructor = NativeResolver;
    exports.NativeResolver = NativeResolver;
    NativeResolver.prototype._prepareCoreFlush = function () {
      if (!this._deferredFlush) {
        this._deferredFlush = true;
        this._defer(this, this._flushRequests);
      }
    };
    NativeResolver.prototype._flushRequests = function () {
      this._deferredFlush = false;
      var flushMsg = JSON.stringify({
        name: 'core_flush',
        args: []
      });
      this._sendBridgeRequest(flushMsg, {
        onSuccess: function () {
        },
        onFailure: function () {
        }
      });
    };
    NativeResolver.prototype._defer = function (context, callback) {
      defer(callback.bind(context));
    };
    NativeResolver.prototype._sendRequest = function (requestName, requestId, data) {
      var self = this;
      data = data.serialize ? data.serialize() : data;
      var args = [
        requestId,
        data
      ];
      var caller = {
        self: this,
        id: requestId,
        type: requestName
      };
      if (useApiRequest) {
        this._sendApiRequest(requestName, args, caller, this._handleResponse, this._handleError);
      } else {
        this._sendCosmosRequest(requestName, args, caller, this._handleResponse, this._handleError);
      }
    };
    NativeResolver.prototype._sendCosmosRequest = function (requestName, args, caller, onSuccess, onError) {
      var message = JSON.stringify({
        name: requestName,
        args: args
      });
      this._sendBridgeRequest(message, {
        onSuccess: function (data) {
          onSuccess.call(caller, JSON.parse(data));
        },
        onFailure: function (data) {
          data = JSON.parse(data);
          onError.call(caller, data);
        }
      });
      this._prepareCoreFlush();
    };
    NativeResolver.prototype._sendBridgeRequest = function (message, callbackMap) {
      this._bridge.executeRequest(message, callbackMap || {});
    };
    NativeResolver.prototype._sendApiRequest = function (requestName, args, caller, onSuccess, onError) {
      SpotifyApi.api.request(requestName, args, caller, onSuccess, onError);
    };
    NativeResolver.prototype._handleResponse = function (data) {
      this.self._dispatchResponse(this.id, this.type, data.responses && data.responses[0] || data);
    };
    NativeResolver.prototype._handleError = function (error) {
      this.self._dispatchResponse(this.id, this.type, error);
    };
    NativeResolver.prototype.resolve = function (data, onsuccess, onerror) {
      function onResult(callback, response) {
        this._defer(this, callback.bind(this, response));
        request.close();
      }
      var request = this._resolve(data, onResult.bind(this, onsuccess), onResult.bind(this, onerror));
      return request;
    };
    NativeResolver.prototype.subscribe = function (data, onsuccess, onerror) {
      function onResult(callback, response) {
        callback.call(this, response);
        request.pull();
      }
      var request = this._resolve(data, onResult.bind(this, onsuccess), onResult.bind(this, onerror));
      return request;
    };
  },
  'node_modules/spotify-cosmos-api/env/bootstrap.web.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var defer = require('node_modules/spotify-cosmos-api/node_modules/spotify-deferred/src/deferred.js');
    var Resolver = require('node_modules/spotify-cosmos-api/env/bootstrap.js').Resolver;
    function WebResolver(opt_target) {
      if (!(this instanceof WebResolver))
        return new WebResolver(opt_target);
      Resolver.call(this);
      this._target = opt_target || '*';
      this._handleResponse = this._handleResponse.bind(this);
      this._requestMessageType = 'cosmos-request';
      this._responseMessageType = 'cosmos-response';
      this._requestIdPrefix = 'cosmos_';
      this.attach();
    }
    WebResolver.prototype = new Resolver();
    WebResolver.prototype.constructor = WebResolver;
    exports.WebResolver = WebResolver;
    WebResolver.prototype._sendRequest = function (requestName, requestID, data) {
      var top = global.window.top;
      var message = {
        type: this._requestMessageType,
        resolver: this._id,
        id: this._requestIdPrefix + requestID,
        name: requestName,
        payload: data.serialize ? data.serialize() : data
      };
      top.postMessage(JSON.stringify(message), this._target);
    };
    WebResolver.prototype._handleResponse = function (response) {
      var data = response.data;
      if (typeof data == 'string') {
        try {
          data = JSON.parse(response.data);
        } catch (e) {
          return;
        }
      }
      if (data.type != this._responseMessageType || data.resolver != this._id || !data.payload)
        return;
      var id = data.id || '';
      var requestID = parseInt(id.replace(this._requestIdPrefix, ''), 10);
      var requestName = data.name || '';
      if (!requestID || !requestName)
        return;
      this._dispatchResponse(requestID, requestName, data.payload);
    };
    WebResolver.prototype.attach = function () {
      var win = global.window;
      if (win.addEvent && !win.addEventListener) {
        win.addEvent('onmessage', this._handleResponse);
      } else {
        win.addEventListener('message', this._handleResponse, false);
      }
    };
    WebResolver.prototype.detach = function () {
      var win = global.window;
      if (win.removeEvent && !win.removeEventListener) {
        win.removeEvent('onmessage', this._handleResponse);
      } else {
        win.removeEventListener('message', this._handleResponse, false);
      }
    };
    WebResolver.prototype.resolve = function (data, onsuccess, onerror) {
      function onResult(callback, response) {
        defer(callback.bind(this, response));
        request.close();
      }
      var request = this._resolve(data, onResult.bind(this, onsuccess), onResult.bind(this, onerror));
      return request;
    };
    WebResolver.prototype.subscribe = function (data, onsuccess, onerror) {
      return this._resolve(data, onsuccess, onerror);
    };
  },
  'node_modules/spotify-cosmos-api/index.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var window = global.window || {};
    var process = global.process;
    var common = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/index.js');
    var Resolver = require('node_modules/spotify-cosmos-api/scripts/resolver.js').Resolver;
    var SPResolver = null;
    var spResolver = null;
    var hasNativeBridge = window._getSpotifyModule && typeof window._getSpotifyModule === 'function' && window._getSpotifyModule('bridge');
    var isNodeJs = process && process.title && process.title.match(/node$/);
    if (!isNodeJs) {
      if (hasNativeBridge) {
        SPResolver = require('node_modules/spotify-cosmos-api/env/bootstrap.native.js').NativeResolver;
        spResolver = new SPResolver(hasNativeBridge);
      } else {
        SPResolver = require('node_modules/spotify-cosmos-api/env/bootstrap.web.js').WebResolver;
        spResolver = new SPResolver();
      }
    }
    exports.Resolver = Resolver;
    exports.Player = require('node_modules/spotify-cosmos-api/scripts/player_v1.js').Player;
    exports.PlayerState = common.playerstate.PlayerState;
    exports.Action = common.request.Action;
    exports.Request = common.request.Request;
    exports.resolver = spResolver ? new Resolver(spResolver) : null;
    var serializables = require('node_modules/spotify-cosmos-api/scripts/serializables/index.js');
    exports.Player2 = require('node_modules/spotify-cosmos-api/scripts/player_v2.js').Player;
    exports.PlayerContext = serializables.PlayerContext;
    exports.PlayOrigin = serializables.PlayOrigin;
    exports.PlayOptions = serializables.PlayOptions;
    exports.PlayerRestrictions = serializables.PlayerRestrictions;
    exports.PlayerTrack = serializables.PlayerTrack;
    exports.PlayerContextPage = serializables.PlayerContextPage;
    exports.IndexPath = serializables.IndexPath;
  },
  'scripts/contextwidget.view.mainmenu.js': function (require, module, exports, global, __filename, __dirname) {
    var cosmos = require('node_modules/spotify-cosmos-api/index.js');
    (function (models, Library, Relations, localeStrings) {
      var rels = Relations.forCurrentUser();
      var lib = Library.forCurrentUser();
      exports.MainMenuView = MainMenuView;
      function MainMenuView(options) {
        this.node = options.node;
        this.logger = options.logger;
        this.supports = options.supports;
        this._l = localeStrings.get.bind(localeStrings);
        this._eventManager = options.eventManager;
        this._starredButton = document.getElementById('starred');
        this._starLabel = document.getElementById('star-label');
        this._collectionButton = document.getElementById('collection');
        this._collectionLabel = document.getElementById('collection-label');
        this._shareButton = document.getElementById('share');
        this._radioButton = document.getElementById('start-radio');
        this._addToPlaylistButton = document.getElementById('add-to');
        this._deletePlaylistTrackButton = document.getElementById('delete-playlist-track');
        this._deletePlaylistButton = document.getElementById('delete-playlist');
        this._copyURLButton = document.getElementById('copy-url');
        this._playNextButton = document.getElementById('play-next');
        this._removeFromQueueButton = document.getElementById('remove-from-queue');
        this._followButton = document.getElementById('follow');
        this._publishButton = document.getElementById('publish');
        this._playButton = document.getElementById('play');
        this._renamePlaylistButton = document.getElementById('rename');
        this._listeners = [];
        this._clipBoard = null;
        this._currentItem = null;
        this.AUTOCLOSE_DELAY = 400;
        this._doLocale();
        this._addEventListeners();
        this._initClipboard();
        var self = this;
        self._showCollectionPromise = new models.Promise();
        self._showQueuePromise = new models.Promise();
        self._showSharePromise = new models.Promise();
        self._showFollowPromise = new models.Promise();
        models.client.load('features').done(function (client) {
          self._showCollectionPromise.object = client.features.collection;
          self._showQueuePromise.object = !!client.features.queue;
          self._showSharePromise.object = !!client.features.share;
          self._showFollowPromise.object = !!client.features.followUser;
        }).fail(function () {
          self._showCollectionPromise.object = false;
          self._showQueuePromise.object = false;
          self._showSharePromise.object = false;
          self._showFollowPromise.object = false;
        }).always(function () {
          self._showCollectionPromise.setDone();
          self._showQueuePromise.setDone();
          self._showSharePromise.setDone();
          self._showFollowPromise.setDone();
        });
      }
      MainMenuView.prototype._doLocale = function () {
        this._collectionLabel.innerHTML = this._l('loading-collection-status');
        this._starLabel.innerHTML = this._l('star');
        this._shareButton.innerHTML = this._l('share');
        this._addToPlaylistButton.innerHTML = this._l('add-to');
        this._radioButton.innerHTML = this._l('start-radio');
        this._copyURLButton.innerHTML = this._l('copy-url') + '<span></span>';
        this._playNextButton.innerHTML = this._l('queue-add');
        this._removeFromQueueButton.innerHTML = this._l('queue-remove');
        this._deletePlaylistTrackButton.innerHTML = this._l('delete') + '<span class="delete-check"></span>';
        this._deletePlaylistButton.innerHTML = this._l('delete') + '<span class="delete-check"></span>';
        this._followButton.innerHTML = this._l('follow');
        this._publishButton.innerHTML = this._l('publish');
        this._playButton.innerHTML = this._l('play');
        this._renamePlaylistButton.innerHTML = this._l('rename');
      };
      MainMenuView.prototype.resize = function () {
        this._eventManager.trigger(this._eventManager.Events.ACTIVATE_VIEW, 'to-mainmenu');
      };
      MainMenuView.prototype.setItem = function (item) {
        this._removeAllManagedEventListeners();
        if (!item) {
          return;
        }
        var self = this;
        this._currentItem = item;
        if (this.supports.PLAY) {
          this._showButton(this._playButton);
          this.logger.userImpression('play_item', getLoggingDataForItem(this._currentItem));
        } else {
          this._hideButton(this._playButton);
        }
        if (this.supports.RENAME_PLAYLIST) {
          this._showButton(this._renamePlaylistButton);
        } else {
          this._hideButton(this._renamePlaylistButton);
        }
        if (this.supports.COLLECTION) {
          self._showCollectionPromise.done(function (showCollection) {
            if (showCollection) {
              var collection;
              if (self._currentItem instanceof models.Track) {
                collection = lib.tracks;
              } else if (self._currentItem instanceof models.Album) {
                collection = lib.albums;
              } else {
                return;
              }
              self._addManagedEventListener(collection, 'changed', self._handleCollectionChangedEvent.bind(self));
              self._addManagedEventListener(collection, 'insert', self._handleCollectionInsertRemoveEvent.bind(self));
              self._addManagedEventListener(collection, 'remove', self._handleCollectionInsertRemoveEvent.bind(self));
              self._collectionCollection = collection;
              self._showButton(self._collectionButton);
              self._updateCollectionButton();
            } else {
              self._hideButton(self._collectionButton);
            }
          });
        } else {
          this._hideButton(this._collectionButton);
        }
        if (this.supports.STARRED) {
          this._showButton(this._starredButton);
          this._updateStarredButton();
        } else {
          this._hideButton(this._starredButton);
        }
        if (this.supports.PLAYLIST_ADD) {
          this._showButton(this._addToPlaylistButton);
        } else {
          this._hideButton(this._addToPlaylistButton);
        }
        if (this.supports.SHARE) {
          this._showSharePromise.done(this, function (showShare) {
            if (showShare) {
              this._showButton(this._shareButton);
            } else {
              this._hideButton(this._shareButton);
            }
          });
        } else {
          this._hideButton(this._shareButton);
        }
        if (this.supports.RADIO) {
          this._showButton(this._radioButton);
        } else {
          this._hideButton(this._radioButton);
        }
        if (this.supports.COPY_URL) {
          this._showButton(this._copyURLButton);
          this._clipBoard.setClipboardText(this._currentItem.uri.toSpotifyURL());
        } else {
          this._hideButton(this._copyURLButton);
        }
        if (this.supports.QUEUE) {
          self._showQueuePromise.done(function (showQueue) {
            if (showQueue) {
              self._showButton(self._playNextButton);
            } else {
              self._hideButton(self._playNextButton);
            }
          });
        } else {
          this._hideButton(this._playNextButton);
        }
        if (this.supports.FOLLOW) {
          self._showFollowPromise.done(function (showFollow) {
            if (showFollow) {
              self._updateFollowButton();
              self._addManagedEventListener(self._currentItem, 'change:subscribed', function () {
                self._updateFollowButton();
              });
              self._showButton(self._followButton);
            } else {
              self._hideButton(self._followButton);
            }
          });
        } else {
          this._hideButton(this._followButton);
        }
        if (this.supports.PUBLISH) {
          self._updatePublishButton();
          self._addManagedEventListener(self._currentItem, 'change:published', self._updatePublishButton.bind(self));
          self._addManagedEventListener(self._currentItem, 'change:collaborative', self._updatePublishButton.bind(self));
          self._addManagedEventListener(self._currentItem, 'change:subscribed', self._updatePublishButton.bind(self));
        } else {
          this._hideButton(this._publishButton);
        }
        if (this.supports.DELETE_PLAYLIST_TRACK) {
          self._showButton(self._deletePlaylistTrackButton);
        } else {
          self._hideButton(self._deletePlaylistTrackButton);
        }
        if (this.supports.DELETE_PLAYLIST) {
          self._showButton(self._deletePlaylistButton);
        } else {
          self._hideButton(self._deletePlaylistButton);
        }
        self._eventManager.trigger(self._eventManager.Events.LOADING_COMPLETE);
      };
      MainMenuView.prototype.setContext = function (currentContext, index) {
        this._currentContext = currentContext;
        this._currentItemIndex = index;
      };
      MainMenuView.prototype.activate = function (currentItem, currentContext) {
        this.setContext(currentContext);
        this.setItem(currentItem);
      };
      MainMenuView.prototype.showQueueOptions = function (show, opt_queue_id) {
        if (!show || !opt_queue_id) {
          this._hideButton(this._removeFromQueueButton);
        } else {
          this._showButton(this._removeFromQueueButton);
          this._removeFromQueueButton.setAttribute('data-queue-id', opt_queue_id);
        }
      };
      MainMenuView.prototype._showButton = function (button) {
        button.style.display = 'block';
        this.resize();
      };
      MainMenuView.prototype._hideButton = function (button) {
        button.style.display = 'none';
        this.resize();
      };
      MainMenuView.prototype._addEventListeners = function () {
        var self = this;
        this._starredButton.addEventListener('click', function (e) {
          self._starUnstar(e);
        }, false);
        this._collectionButton.addEventListener('click', function (e) {
          self._toggleCollectionStatus(e);
        }, false);
        this._shareButton.addEventListener('click', function (e) {
          self._share(e);
        }, false);
        this._radioButton.addEventListener('click', function (e) {
          self._startRadio(e);
        }, false);
        this._addToPlaylistButton.addEventListener('click', function (e) {
          e.preventDefault();
          self.logger.userHit('playlist', getLoggingDataForItem(self._currentItem));
          self._eventManager.trigger(self._eventManager.Events.ACTIVATE_VIEW, 'to-playlists');
        }, false);
        this._deletePlaylistTrackButton.addEventListener('click', function (e) {
          e.preventDefault();
          self._removeFromPlaylist();
        }, false);
        this._deletePlaylistButton.addEventListener('click', function (e) {
          e.preventDefault();
          self.logger.userHit('playlist_delete', getLoggingDataForItem(self._currentItem));
          self._handleDeletePlaylistButton();
        }, false);
        this._playNextButton.addEventListener('click', function (e) {
          self._playNext(e);
        }, false);
        this._removeFromQueueButton.addEventListener('click', function (e) {
          self._removeFromQueue(e);
        }, false);
        this._followButton.addEventListener('click', function (e) {
          self._followUnfollow(e);
        }, false);
        this._publishButton.addEventListener('click', function (e) {
          self._publishUnpublish(e);
        }, false);
        this._playButton.addEventListener('click', function (e) {
          e.preventDefault();
          self._playCurrentItem();
        }, false);
        this._renamePlaylistButton.addEventListener('click', function (e) {
          e.preventDefault();
          self.logger.userHit('rename_playlist', getLoggingDataForItem(self._currentItem));
          self._eventManager.trigger(self._eventManager.Events.ACTIVATE_VIEW, 'to-renameplaylist');
        }, false);
        Array.prototype.forEach.call(this.node.querySelectorAll('a'), function (element) {
          element.addEventListener('mouseenter', function () {
            self._updateHoveredElement(this);
          });
        });
      };
      MainMenuView.prototype._initClipboard = function () {
        var self = this;
        var isIE = typeof window.clipboardData !== 'undefined';
        var clipBoardSuccess = function () {
          self._copyURLButton.className = 'success';
          setTimeout(function () {
            self._copyURLButton.className = '';
            self._eventManager.trigger(self._eventManager.Events.CLOSE);
          }, 1000);
        };
        function logClipboardHit() {
          self.logger.userHit('copy_url', getLoggingDataForItem(self._currentItem));
        }
        if (isIE) {
          this._clipBoard = {
            setClipboardText: function (text) {
              self._clipBoard._data = text;
            }
          };
          this._copyURLButton.addEventListener('click', function (e) {
            e.preventDefault();
            if (window.clipboardData.setData('text', self._clipBoard._data)) {
              clipBoardSuccess();
            }
            logClipboardHit();
          }, false);
        } else {
          ZeroClipboard.config({
            moviePath: 'vendor/ZeroClipboard/ZeroClipboard.swf',
            trustedDomains: '*',
            hoverClass: 'hover',
            forceHandCursor: false,
            debug: false
          });
          this._clipBoard = new ZeroClipboard(this._copyURLButton);
          this._clipBoard.setClipboardText = function (text) {
            self._copyURLButton.setAttribute('data-clipboard-text', text);
          };
          this._clipBoard.on('mouseup', function () {
            clipBoardSuccess();
            logClipboardHit();
          });
          this._clipBoard.on('mousedown', function () {
            self._clipBoard.setClipboardText(self._currentItem.uri.toSpotifyURL());
          });
        }
        this._clipBoard.isIE = isIE;
      };
      MainMenuView.prototype._updateHoveredElement = function (element) {
      };
      MainMenuView.prototype._share = function (e) {
        if (e) {
          e.preventDefault();
        }
        this._eventManager.trigger(this._eventManager.Events.CLOSE, {});
        var itemType = this._currentItem instanceof models.Track ? '-track' : this._currentItem instanceof models.Album ? '-album' : this._currentItem instanceof models.Artist ? '-artist' : '-unknown';
        this.logger.userHit('share' + itemType, getLoggingDataForItem(self._currentItem));
        models.client.showShareUI(this._currentItem.uri);
      };
      MainMenuView.prototype._updateFollowButton = function () {
        var self = this;
        if (!this._currentItem) {
          return false;
        }
        this._currentItem.load('subscribed').done(function (item) {
          self._followButton.innerHTML = self._l(item.subscribed ? 'unfollow' : 'follow');
        });
      };
      MainMenuView.prototype._updatePublishButton = function () {
        var self = this;
        if (!this._currentItem) {
          return false;
        }
        this._currentItem.load('published', 'collaborative', 'subscribed').done(function (item) {
          if (item.subscribed && !item.collaborative) {
            self._publishButton.innerHTML = self._l(item.published ? 'unpublish' : 'publish');
            self._showButton(self._publishButton);
          } else {
            self._hideButton(self._publishButton);
          }
        }).fail(function () {
          self._hideButton(self._publishButton);
        });
      };
      MainMenuView.prototype._followUnfollow = function (e) {
        var self = this;
        if (e) {
          e.preventDefault();
        }
        this._currentItem.load('subscribed').done(function (item) {
          if (item instanceof models.Playlist) {
            lib[item.subscribed ? 'unsubscribe' : 'subscribe'](self._currentItem);
          } else {
            rels[item.subscribed ? 'unsubscribe' : 'subscribe'](self._currentItem);
          }
          self._followButton.className = 'success';
          setTimeout(function () {
            self._followButton.className = '';
            self._eventManager.trigger(self._eventManager.Events.CLOSE);
          }, 600);
        });
      };
      MainMenuView.prototype._deletePlaylist = function (e) {
        var self = this;
        if (e) {
          e.preventDefault();
        }
        lib.unsubscribe(self._currentItem).done(function () {
          self._deletePlaylistButton.className = 'success';
          setTimeout(function () {
            self._deletePlaylistButton.className = '';
            self._eventManager.trigger(self._eventManager.Events.CLOSE);
          }, self.AUTOCLOSE_DELAY);
        });
      };
      MainMenuView.prototype._publishUnpublish = function (e) {
        var self = this;
        if (e) {
          e.preventDefault();
        }
        this._currentItem.load('published').done(function (item) {
          if (item instanceof models.Playlist) {
            lib[item.published ? 'unpublish' : 'publish'](self._currentItem);
          }
          self._publishButton.className = 'success';
          setTimeout(function () {
            self._publishButton.className = '';
            self._eventManager.trigger(self._eventManager.Events.CLOSE);
          }, 600);
        });
      };
      MainMenuView.prototype._playCurrentItem = function () {
        if (this._currentItem instanceof models.Artist || this._currentItem instanceof models.Album || this._currentItem instanceof models.Playlist) {
          models.player.playContext(this._currentItem, 0);
        } else if (this._currentContext instanceof models.Album || this._currentContext instanceof models.Playlist || this._currentContext instanceof models.BridgeCollection) {
          models.player.playContext(this._currentContext, this._currentItemIndex || 0);
        } else {
          models.player.playTrack(this._currentItem);
        }
        this._eventManager.trigger(this._eventManager.Events.CLOSE);
        this.logger.userHit('play_item', getLoggingDataForItem(this._currentItem));
      };
      MainMenuView.prototype._startRadio = function (e) {
        if (e) {
          e.preventDefault();
        }
        models.application.openURI(this._currentItem.uri.replace('spotify:', 'spotify:radio:'));
        this.logger.userHit('radio_start', getLoggingDataForItem(this._currentItem));
        this._eventManager.trigger(this._eventManager.Events.CLOSE, {});
      };
      MainMenuView.prototype._removeFromPlaylist = function () {
        var self = this;
        var thePlaylist = self._currentContext;
        var trackToRemove;
        var trackIndexInPlaylist = self._currentItemIndex;
        function logRemoveFromPlaylistFail() {
          self.logger.errorUserActionFail('playlist_remove', getLoggingDataForItem(self._currentItem));
        }
        thePlaylist.load(['tracks']).done(function (playlist) {
          if (trackIndexInPlaylist && !isNaN(trackIndexInPlaylist)) {
            playlist.tracks.snapshot(trackIndexInPlaylist, 1).done(function (snapshot) {
              trackToRemove = snapshot.find(self._currentItem);
              if (trackToRemove) {
                playlist.tracks.remove(trackToRemove).done(function () {
                  self._eventManager.trigger(self._eventManager.Events.CLOSE);
                }).fail(logRemoveFromPlaylistFail);
              }
            });
          } else {
            playlist.tracks.snapshot().done(function (snapshot) {
              trackToRemove = snapshot.find(self._currentItem);
              if (trackToRemove) {
                playlist.tracks.remove(snapshot.find(trackToRemove)).done(function () {
                  self._eventManager.trigger(self._eventManager.Events.CLOSE);
                }).fail(logRemoveFromPlaylistFail);
              }
            });
          }
        });
        self.logger.userHit('playlist_remove', getLoggingDataForItem(self._currentItem));
      };
      MainMenuView.prototype._starUnstar = function (e) {
        if (e) {
          e.preventDefault();
        }
        var self = this;
        var starSuccess = function () {
          self._starredButton.className = 'checked';
          self._currentItem.starred = true;
          setTimeout(function () {
            self._updateStarredButton();
            self._starredButton.className = '';
            self._eventManager.trigger(self._eventManager.Events.CLOSE);
          }, self.AUTOCLOSE_DELAY);
        };
        var unstarSuccess = function () {
          self._starredButton.className = 'checked';
          self._currentItem.starred = false;
          setTimeout(function () {
            self._updateStarredButton();
            self._starredButton.className = '';
            self._eventManager.trigger(self._eventManager.Events.CLOSE);
          }, self.AUTOCLOSE_DELAY);
        };
        self._currentItem.load('starred').done(function () {
          if (!self._currentItem.starred) {
            self._currentItem.star().done(function () {
              starSuccess();
            }).fail(function () {
              self._eventManager.trigger(self._eventManager.Events.CLOSE);
              self._currentItem.starred = false;
              self._updateStarredButton();
              self.logger.errorUserActionFail('star', getLoggingDataForItem(self._currentItem));
            });
            self.logger.userHit('star', getLoggingDataForItem(self._currentItem));
          } else {
            self._currentItem.unstar().done(function () {
              unstarSuccess();
            }).fail(function () {
              self._eventManager.trigger(self._eventManager.Events.CLOSE);
              self._currentItem.starred = true;
              self._updateStarredButton();
              self.logger.errorUserActionFail('unstar', getLoggingDataForItem(self._currentItem));
            });
            self.logger.userHit('unstar', getLoggingDataForItem(self._currentItem));
          }
        });
      };
      MainMenuView.prototype._toggleCollectionStatus = function (e) {
        this._togglingCollectionStatus = true;
        if (e) {
          e.preventDefault();
        }
        var deferredUpdateCollectionButton = function () {
          self._togglingCollectionStatus = false;
          setTimeout(function () {
            self._updateCollectionButton();
          }, self.AUTOCLOSE_DELAY);
        };
        var self = this;
        self._collectionCollection.contains(self._currentItem).done(function (inCollection) {
          if (!inCollection) {
            self._collectionCollection.add(self._currentItem).done(function () {
              self._collectionButton.className = 'checked';
              setTimeout(function () {
                self._collectionButton.className = '';
                self._eventManager.trigger(self._eventManager.Events.CLOSE);
                deferredUpdateCollectionButton();
              }, self.AUTOCLOSE_DELAY);
              broadcastCosmosCollectionState(self._currentItem.uri, true);
            }).fail(function () {
              deferredUpdateCollectionButton();
              self.logger.errorUserActionFail('collection_add', getLoggingDataForItem(self._currentItem));
            });
            self.logger.userHit('collection_add', getLoggingDataForItem(self._currentItem));
          } else {
            self._collectionCollection.remove(self._currentItem).done(function () {
              self._collectionButton.className = 'checked';
              setTimeout(function () {
                self._collectionButton.className = '';
                self._eventManager.trigger(self._eventManager.Events.CLOSE);
                deferredUpdateCollectionButton();
              }, self.AUTOCLOSE_DELAY);
              broadcastCosmosCollectionState(self._currentItem.uri, false);
            }).fail(function () {
              deferredUpdateCollectionButton();
              self.logger.errorUserActionFail('collection_remove', getLoggingDataForItem(self._currentItem));
            });
            self.logger.userHit('collection_remove', getLoggingDataForItem(self._currentItem));
          }
        });
      };
      MainMenuView.prototype._updateStarredButton = function () {
        var self = this;
        self._currentItem.load('starred').done(function () {
          if (self._currentItem.starred) {
            self._starredButton.childNodes[0].innerHTML = self._l('unstar');
          } else {
            self._starredButton.childNodes[0].innerHTML = self._l('star');
          }
        });
      };
      MainMenuView.prototype._updateCollectionButton = function () {
        var self = this;
        this._collectionLabel.innerHTML = this._l('loading-collection-status');
        this._collectionCollection.contains(self._currentItem).done(this._setCollectionButtonStatus.bind(this));
      };
      MainMenuView.prototype._setCollectionButtonStatus = function (inCollection) {
        var self = this;
        if (inCollection) {
          self._collectionLabel.innerHTML = self._l('remove');
        } else {
          self._collectionLabel.innerHTML = self._l('save');
        }
      };
      MainMenuView.prototype._playNext = function (e) {
        if (e) {
          e.preventDefault();
        }
        var uri = this._currentItem.uri;
        if (this._currentItem instanceof models.Track) {
          this._addToQueue([uri]);
        } else {
          SP.request('context_playable_snapshot', [
            {
              type: 'list',
              uri: uri
            },
            0,
            -1
          ], this, function (response) {
            this._addToQueue(response.array);
          }, function () {
            this._eventManager.trigger(this._eventManager.Events.CLOSE, {});
          });
        }
      };
      MainMenuView.prototype._addToQueue = function (tracks) {
        SP.request('player_queue_tracks_append', ['main'].concat(tracks));
        this._eventManager.trigger(this._eventManager.Events.CLOSE, {});
      };
      MainMenuView.prototype._removeFromQueue = function (e) {
        if (e) {
          e.preventDefault();
        }
        var index = parseInt(this._removeFromQueueButton.getAttribute('data-queue-id'), 10);
        SP.request('player_queue_tracks_remove', [
          'main',
          index,
          1
        ]);
        this._eventManager.trigger(this._eventManager.Events.CLOSE, {});
      };
      MainMenuView.prototype._handleCollectionInsertRemoveEvent = function (e) {
        if (this._togglingCollectionStatus) {
          return;
        }
        var inCollection = e.type === 'insert';
        if (e.uris.indexOf(this._currentItem.uri) !== -1) {
          this._setCollectionButtonStatus(inCollection);
        }
      };
      MainMenuView.prototype._handleCollectionChangedEvent = function (e) {
        if (this._togglingCollectionStatus) {
          return;
        }
        this._updateCollectionButton();
      };
      MainMenuView.prototype._addManagedEventListener = function (item, event, callback, opt_capture) {
        this._listeners.push({
          item: item,
          event: event,
          callback: callback,
          capture: opt_capture
        });
        item.addEventListener(event, callback);
      };
      MainMenuView.prototype._removeAllManagedEventListeners = function () {
        this._listeners.splice(0, this._listeners.length).forEach(function (listener) {
          listener.item.removeEventListener(listener.event, listener.callback, listener.capture);
        });
      };
      MainMenuView.prototype._handleDeletePlaylistButton = function () {
        var self = this;
        this._currentItem.load('tracks').done(function (playlist) {
          playlist.tracks.snapshot(0, 0).done(function (snapshot) {
            if (snapshot.length) {
              self._eventManager.trigger(self._eventManager.Events.ACTIVATE_VIEW, 'to-playlistdeleteconfirm');
            } else {
              lib.unsubscribe(playlist).done(function () {
                self._eventManager.trigger(self._eventManager.Events.CLOSE);
              });
            }
          });
        });
      };
      function getLoggingDataForItem(item) {
        var data = {};
        if (item instanceof models.Track) {
          data.track_id = item.uri;
        } else if (item instanceof models.Album) {
          data.album_id = item.uri;
        } else if (item instanceof models.Artist) {
          data.artist_id = item.uri;
        }
        return data;
      }
      function broadcastCosmosCollectionState(uri, isInCollection, opt_callback) {
        var request = new cosmos.Request('POST', 'sp://messages/v1/collectionstate', null, {
          uri: uri,
          isInCollection: isInCollection
        });
        cosmos.resolver.resolve(request, typeof opt_callback === 'function' ? opt_callback : function () {
        });
      }
    }(require('node_modules/api/scripts/models.js'), require('node_modules/api/scripts/library.js').Library, require('node_modules/api/scripts/relations.js').Relations, require('@loc.loc/strings/main.lang')));
  },
  'scripts/contextwidget.js': function (require, module, exports, global, __filename, __dirname) {
    (function (models, utils, plhelper, plview, mmview, npview, rpview, pdcview, events, Library, Logger) {
      exports.ContextWidget = ContextWidget;
      function ContextWidget() {
        this.isActive = false;
        this._currentItem = null;
        this._currentContext = null;
        this._eventManager = new events.EventManager();
        this._view = null;
        this._views = {};
        this._closeTimer = null;
        this._openTimeoutPeriod = null;
        this._defaultWidth = 220;
        this._maxHeight = 361;
        this.logger = Logger.forTag('ContextWidget');
        this.supports = {};
        this._modes = [
          'add-to-playlist',
          'queue-item'
        ];
        this._defaultViewName = 'to-mainmenu';
        this._defaultHeight;
        this.initView = this._defaultViewName;
      }
      var KeyCode = {
        escape: 27,
        upArrow: 38,
        downArrow: 40,
        leftArrow: 37,
        rightArrow: 39,
        tab: 9
      };
      ContextWidget.prototype._getNodes = function () {
        this._mainWrapper = document.getElementById('wrapper');
        this._innerWrapper = document.getElementById('wrap-inner');
        this._menu = document.getElementById('menu');
        this._playlists = document.getElementById('playlists');
        this._newList = document.getElementById('new-list');
        this._rename = document.getElementById('rename-view');
        this._playlistDeleteConfirm = document.getElementById('playlist-delete-confirm-view');
      };
      ContextWidget.prototype.init = function () {
        var self = this;
        this._getNodes();
        this._views['to-mainmenu'] = new mmview.MainMenuView({
          node: this._menu,
          eventManager: this._eventManager,
          logger: this.logger,
          supports: this.supports
        });
        this._views['to-playlists'] = new plview.PlaylistView({
          node: this._playlists,
          eventManager: this._eventManager,
          logger: this.logger
        });
        this._views['to-newplaylist'] = new npview.NewPlaylistView({
          node: this._newList,
          eventManager: this._eventManager
        });
        this._views['to-renameplaylist'] = new rpview.RenamePlaylistView({
          node: this._rename,
          eventManager: this._eventManager,
          logger: this.logger
        });
        this._views['to-playlistdeleteconfirm'] = new pdcview.PlaylistDeleteConfirmView({
          node: this._playlistDeleteConfirm,
          eventManager: this._eventManager,
          logger: this.logger
        });
        models.session.load('user').done(function (session) {
          session.user.load('username').done(function (user) {
            self.user = user.uri.replace('@', user.username);
            models.application.load('arguments').done(function (application) {
              self.setArguments(application.arguments);
            });
          });
        });
        this._eventManager.subscribe(this._eventManager.Events.CLOSE, this.close, this);
        this._eventManager.subscribe(this._eventManager.Events.CONTEXT_ADDED, this._onContextAddedToPlaylist, this);
        this._eventManager.subscribe(this._eventManager.Events.ADD_CONTEXT_TO_PLAYLIST, this._addCurrentContextToPlaylist, this);
        this._eventManager.subscribe(this._eventManager.Events.ACTIVATE_VIEW, this.activateAndDisplayView, this);
        this._eventManager.subscribe(this._eventManager.Events.PLAYLISTS_LOADED, this._resetCloseTimer, this);
        this._eventManager.subscribe(this._eventManager.Events.LOADING_COMPLETE, this._onLoadingComplete, this);
        var f = document.getElementById('create-playlist-form');
        f.addEventListener('submit', function (e) {
          e.preventDefault();
        });
        var f = document.getElementById('rename-form');
        f.addEventListener('submit', function (e) {
          e.preventDefault();
        });
        document.addEventListener('keydown', function (e) {
          self._resetCloseTimer();
          self._handleKeyDown(e);
        }, false);
        document.addEventListener('dragstart', function (e) {
          e.preventDefault();
        }, false);
        document.addEventListener('mousemove', function () {
          self._resetCloseTimer();
        }, false);
        this.isActive = true;
        var lib = Library.forCurrentUser();
        lib.load('playlists').done(function (lib) {
          lib.playlists.addEventListener('insert', function () {
            self._eventManager.trigger(self._eventManager.Events.PLAYLISTS_UPDATE);
          });
          lib.playlists.addEventListener('remove', function () {
            self._eventManager.trigger(self._eventManager.Events.PLAYLISTS_UPDATE);
          });
        });
      };
      ContextWidget.prototype._onLoadingComplete = function () {
        models.application.hideLoadingScreen();
        if (!this._defaultHeight) {
          this._defaultHeight = this._views[this._defaultViewName].node.offsetHeight;
        }
      };
      ContextWidget.prototype.buildViews = function () {
        switch (this.mode) {
        case 'add-to-playlist':
          this.initView = 'to-playlists';
          this._views['to-playlists'].hideBackButton();
          break;
        case 'queue-item':
          this._views['to-mainmenu'].showQueueOptions(true, this.queueItemId);
          break;
        default:
          break;
        }
      };
      ContextWidget.prototype.reset = function () {
        this.initView = this._defaultViewName;
        this._views['to-playlists'].showBackButton();
        this._views['to-mainmenu'].showQueueOptions(false);
        this.activateView(this._defaultViewName);
      };
      ContextWidget.prototype.displayView = function (view) {
        if (this._activeView !== view) {
          this._lastView = this._activeView ? this._activeView.replace(/^to\-/, 'from-') : '';
          this._activeView = view;
          this._mainWrapper.className = this._lastView + ' ' + this._activeView;
        }
        this.resize(this._views[view].node.offsetHeight);
      };
      ContextWidget.prototype.activateView = function (view) {
        if (this._view === this._views[view]) {
          return;
        }
        this._view = this._views[view];
        this._view.activate(this._currentItem, this._currentContext);
      };
      ContextWidget.prototype.activateAndDisplayView = function (view) {
        this.activateView(view);
        this.displayView(view);
      };
      ContextWidget.prototype.resize = function (height) {
        if (height > 372) {
          height = 372;
        }
        if (height == 0) {
          height = this._defaultHeight;
        }
        if (height !== this._maxHeight) {
          this._maxHeight = height;
          models.application.setPreferredSize(this._defaultWidth, this._maxHeight);
        }
      };
      ContextWidget.prototype.open = function () {
        var wrapper = this._innerWrapper;
        utils.removeClass(wrapper, 'transition');
        this.buildViews();
        this.activateAndDisplayView(this.initView);
        setTimeout(function () {
          utils.addClass(wrapper, 'transition');
        }, 1);
        this._postMessage({ type: 'POPUP_WINDOW_OPEN' });
        this._resetCloseTimer();
      };
      ContextWidget.prototype._resetCloseTimer = function () {
        if (this._openTimeoutPeriod === null) {
          return;
        }
        var self = this;
        clearTimeout(self._closeTimer);
        self._closeTimer = setTimeout(function () {
          if (self._views['to-playlists'] && self._views['to-playlists']._throbber.isActive) {
            return self._resetCloseTimer();
          }
          self.close();
        }, self._openTimeoutPeriod);
      };
      ContextWidget.prototype.close = function () {
        this._postMessage({ type: 'POPUP_WINDOW_CLOSE' });
      };
      ContextWidget.prototype.afterClose = function () {
        this.activateAndDisplayView(this.initView);
        this._views['to-newplaylist'].clearCreateNew();
        this._views['to-playlists'].clearSearch();
      };
      ContextWidget.prototype._postMessage = function (data) {
        window.parent.postMessage(JSON.stringify(data), '*');
      };
      ContextWidget.prototype.setItem = function (item) {
        if (typeof item === 'string') {
          try {
            item = models.fromURI(item);
          } catch (e) {
          }
        }
        this._currentItem = item;
      };
      ContextWidget.prototype._checkItemSupport = function (item, cb) {
        var self = this;
        var isTrack = item instanceof models.Track;
        var isAlbum = item instanceof models.Album;
        var isArtist = item instanceof models.Artist;
        var isPlaylist = item instanceof models.Playlist;
        var isUser = item instanceof models.User;
        this.supports.ITEM = isTrack || isAlbum || isArtist || isPlaylist || isUser;
        this.supports.PLAY = isTrack || isAlbum || isArtist || isPlaylist;
        this.supports.RENAME_PLAYLIST = false;
        this.supports.QUEUE = this.supports.PLAY;
        this.supports.STARRED = isTrack;
        this.supports.COLLECTION = isTrack || isAlbum;
        this.supports.PLAYLIST_ADD = isTrack || isAlbum;
        this.supports.DELETE_PLAYLIST_TRACK = false;
        this.supports.DELETE_PLAYLIST = false;
        this.supports.SHARE = isTrack || isAlbum || isArtist || isPlaylist || isUser;
        this.supports.RADIO = isTrack || isAlbum || isArtist || isPlaylist;
        this.supports.COPY_URL = isTrack || isAlbum || isArtist || isPlaylist || isUser;
        this.supports.FOLLOW = isUser && item.uri !== this.user || isArtist || isPlaylist;
        this.supports.PUBLISH = isPlaylist;
        if (isTrack) {
          var trackPromises = [];
          var demoteStarredPromise = models.client.load('features').done(function (client) {
            if (client.features.collection) {
              self.supports.STARRED = false;
              self.supports.DEMOTED_STARRED = true;
            }
          });
          trackPromises.push(demoteStarredPromise);
          if (this._currentContext instanceof models.Playlist) {
            var allowsDeletePromise = this._currentContext.load('allows').done(function (playlist) {
              self.supports.DELETE_PLAYLIST_TRACK = playlist.allows.removeTracks;
            });
            trackPromises.push(allowsDeletePromise);
          }
          models.Promise.join(trackPromises).always(function () {
            cb.apply(self);
          });
        } else if (isPlaylist) {
          item.load('owner', 'allows', 'subscribed').done(function () {
            item.owner.load('currentUser').done(function () {
              self.supports.FOLLOW = !item.owner.currentUser;
              self.supports.PUBLISH = item.subscribed;
              self.supports.RENAME_PLAYLIST = item.allows.rename;
              self.supports.DELETE_PLAYLIST = item.allows.delete;
              cb.apply(self);
            });
          });
        } else {
          cb.apply(this);
        }
      };
      ContextWidget.prototype.setArguments = function (args) {
        this._currentItem = null;
        this._currentContext = null;
        var itemURI = args[0];
        var viewMode = args[1];
        if (args.length === 3) {
          args[3] = null;
        }
        var numArgs = args.length;
        var contextId = args[numArgs - 3];
        try {
          this._currentContext = models.fromURI(contextId);
        } catch (e) {
        }
        var itemIndex = parseInt(args[numArgs - 2], 10);
        var parentLoggingContext = args[numArgs - 1];
        this.logger.context = (parentLoggingContext ? parentLoggingContext + '/' : '') + 'context_menu';
        if (!this._modes.indexOf(viewMode) > -1) {
          this.mode = viewMode;
          if (this.mode == 'queue-item') {
            this.queueItemId = args[2];
          }
        }
        this.setItem(itemURI);
        if (!this._currentItem) {
          return this.close();
        }
        this._checkItemSupport(this._currentItem, function () {
          if (!this.supports.ITEM) {
            return this.close();
          }
          this._views['to-mainmenu'].setContext(this._currentContext, itemIndex);
          this._views['to-mainmenu'].setItem(this._currentItem, this.supports);
          if (this.supports.RENAME_PLAYLIST) {
            this._views['to-renameplaylist'].setContext(this._currentItem);
            this._views['to-renameplaylist'].setPlaylist(this._currentContext);
          }
          if (this.supports.DELETE_PLAYLIST) {
            this._views['to-playlistdeleteconfirm'].setContext(this._currentItem);
          }
          if (this.supports.PLAYLIST_ADD) {
            if (this.supports.DEMOTED_STARRED) {
              this._views['to-playlists'].showDemotedStarred();
            } else {
              this._views['to-playlists'].hideDemotedStarred();
            }
            this._views['to-playlists'].setContext(this._currentItem);
            this._views['to-playlists'].setPlaylist(this._currentContext);
            this._views['to-newplaylist'].setContext(this._currentItem);
            this._views['to-newplaylist'].setPlaylist(this._currentContext);
          }
        });
      };
      ContextWidget.prototype._onContextAddedToPlaylist = function (link) {
        var self = this;
        utils.addClass(link, 'success');
        setTimeout(function () {
          self.close();
        }, 250);
      };
      ContextWidget.prototype._handleKeyDown = function (e) {
        switch (e.keyCode) {
        case KeyCode.tab:
          if (e.target.nodeName !== 'INPUT') {
            e.preventDefault();
          }
          break;
        case KeyCode.escape:
          this.close();
          break;
        case KeyCode.downArrow:
          this._handleDownArrow();
          break;
        case KeyCode.upArrow:
          this._handleUpArrow();
          break;
        }
      };
      ContextWidget.prototype._handleDownArrow = function () {
        console.log('down arrow');
        if (this._view.handleDownArrow) {
          this._view.handleDownArrow();
        }
      };
      ContextWidget.prototype._handleUpArrow = function () {
        console.log('up arrow');
        if (this._view.handleUpArrow) {
          this._view.handleUpArrow();
        }
      };
      ContextWidget.prototype._addCurrentContextToPlaylist = function (params) {
        var targetPlaylist;
        var self = this;
        var itemsToAdd = [];
        if (typeof params.playlist === 'string') {
          targetPlaylist = models.Playlist.fromURI(params.playlist);
        } else {
          targetPlaylist = params.playlist;
        }
        if (self._currentItem.uri.indexOf('album') !== -1) {
          self._currentItem.load('tracks').done(function (album) {
            album.tracks.snapshot().done(function (snapshot) {
              for (var i = 0; i < snapshot.length; i++) {
                itemsToAdd.push(snapshot.get(i));
              }
              doPlaylistAdd();
            });
          });
        } else {
          itemsToAdd.push(self._currentItem);
          doPlaylistAdd();
        }
        function doPlaylistAdd() {
          self._eventManager.trigger(self._eventManager.Events.CONTEXT_ADDED, params.link);
          targetPlaylist.load('tracks').done(function (playlist) {
            playlist.tracks.add(itemsToAdd).done(function () {
            }).fail(function (obj, error) {
              console.error('Failed to add to the playlist', error);
              logAddToPlaylistFail();
            });
          }).fail(function () {
            console.log('Failed to get the tracks of the playlist', arguments);
            logAddToPlaylistFail();
          });
          self.logger.userHit('playlist_add', { track_id: self._currentItem.uri });
        }
        function logAddToPlaylistFail() {
          self.logger.errorUserActionFail('playlist_add', { track_id: self._currentItem.uri });
        }
      };
    }(require('node_modules/api/scripts/models.js'), require('scripts/playlist-utils.js'), require('scripts/contextwidget.userplaylists.js'), require('scripts/contextwidget.view.playlist.js'), require('scripts/contextwidget.view.mainmenu.js'), require('scripts/contextwidget.view.newplaylist.js'), require('scripts/contextwidget.view.renameplaylist.js'), require('scripts/contextwidget.view.playlistdeleteconfirm.js'), require('scripts/contextwidget.events.js'), require('node_modules/api/scripts/library.js').Library, require('node_modules/logging-utils/scripts/logger.js').Logger));
  },
  'scripts/main.js': function (require, module, exports, global, __filename, __dirname) {
    (function (widget, models) {
      'use strict';
      var widget = new widget.ContextWidget();
      models.application.addEventListener('arguments', function () {
        widget.reset();
        widget.setArguments(this.arguments);
        widget.open();
      });
      models.application.load('arguments').done(function (app) {
        widget.setArguments(app.arguments);
        widget.open();
      });
      window.addEventListener('message', function (event) {
        var message;
        try {
          message = JSON.parse(event.data);
        } catch (e) {
          return;
        }
        if (message.type === 'WINDOW_CLOSED') {
          widget.afterClose();
        }
      });
      widget.init();
    }(require('scripts/contextwidget.js'), require('node_modules/api/scripts/models.js')));
  }
}));  // QuickStart 0.9.1
