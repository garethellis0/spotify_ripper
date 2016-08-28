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
  'scripts/player.events.js': function (require, module, exports, global, __filename, __dirname) {
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
        TRACK_CHANGED: 'TRACK_CHANGED',
        AD_CLICKED: 'AD_CLICKED',
        TRACK_SKIPPED: 'TRACK_SKIPPED',
        BACK_BUTTON_PRESS_START: 'BACK_BUTTON_PRESS_START',
        BACK_BUTTON_PRESS_COMPLETE: 'BACK_BUTTON_PRESS_COMPLETE'
      };
    }();
    exports.EventManager = EventManager;
  },
  'scripts/player-utils.js': function (require, module, exports, global, __filename, __dirname) {
    function trackHistory(length) {
      this._maxLength = length;
      this._items = new Array();
    }
    trackHistory.prototype.add = function (item) {
      var oldItems = this._items.slice(0);
      for (var i = 0; i < oldItems.length; i++) {
        if (oldItems[i].uri === item.uri) {
          return false;
        }
      }
      this._items[0] = item;
      for (var i = 1; i < this._maxLength; i++) {
        if (typeof oldItems[i - 1] !== 'undefined') {
          this._items[i] = oldItems[i - 1];
        }
      }
      return this._items;
    };
    trackHistory.prototype.show = function (field) {
      if (!field || typeof this.get(0)[field] === 'undefined') {
        return this._items;
      }
      var output = [];
      for (var i = 0; i < this._items.length; i++) {
        output[i] = this._items[i][field];
      }
      return output;
    };
    trackHistory.prototype.get = function (i) {
      return this._items[i];
    };
    trackHistory.prototype.size = function () {
      return this._items.length;
    };
    trackHistory.prototype.forEach = function (cb) {
      for (var i = 0; i < this._items.length; i++) {
        cb(this._items[i]);
      }
    };
    function playerStorage() {
      try {
        this.store = typeof window.localStorage != 'undefined' ? window.localStorage : false;
      } catch (e) {
        this.store = false;
      }
    }
    playerStorage.prototype.set = function (item, val) {
      if (!this.store) {
        return false;
      }
      try {
        this.store.setItem(item, val);
      } catch (e) {
        return false;
      }
    };
    playerStorage.prototype.get = function (item) {
      if (!this.store) {
        return false;
      }
      return this.store.getItem(item);
    };
    var Konami = function () {
      'use strict';
      var _CODE = [
          38,
          38,
          40,
          40,
          37,
          39,
          37,
          39,
          66,
          65,
          13
        ], _CODE_LEN = _CODE.length, _listenerTarget = null, _onSuccess = null, next = 0, _keydown_listener = function (e) {
          if (e.keyCode === _CODE[next]) {
            next += 1;
            if (next === _CODE_LEN) {
              _onSuccess();
              next = 0;
            }
          } else {
            next = 0;
          }
        }, _addEventListeners = function () {
          if (_listenerTarget.addEventListener) {
            _listenerTarget.addEventListener('keydown', _keydown_listener, false);
          } else if (_listenerTarget.attachEvent) {
            _listenerTarget.attachEvent('onkeydown', _keydown_listener);
          } else {
            if (typeof _listenerTarget.onkeydown === 'function') {
              var preservedListenerTargetFunction = _listenerTarget.onkeydown;
              _listenerTarget.onkeydown = function (e) {
                preservedListenerTargetFunction(e);
                _keydown_listener(e);
              };
            } else {
              _listenerTarget.onkeydown = _keydown_listener;
            }
          }
        };
      return {
        onSuccess: function () {
        },
        listenerTarget: window,
        init: function () {
          _onSuccess = this.onSuccess;
          _listenerTarget = this.listenerTarget;
          _addEventListeners();
        }
      };
    };
    var playerUtils = {
      hasClassList: 'classList' in document.createElement('a'),
      secsToMins: function (secs, keepMs) {
        var secsRounded = Math.floor(secs);
        var mins = Math.floor(secsRounded / 60) + ':' + ('0' + secsRounded % 60).slice(-2);
        if (undefined !== keepMs && keepMs) {
          mins += '.' + Math.round((secs - secsRounded) * 1000);
        }
        return mins;
      },
      getId: function (id) {
        return document.getElementById(id);
      },
      hasClass: function (ele, cls) {
        if (this.hasClassList) {
          return ele.classList.contains(cls);
        }
        return ele.className.match(new RegExp('(\\s|^)' + cls + '(\\s|$)'));
      },
      addClass: function (ele, cls) {
        if (!this.hasClass(ele, cls)) {
          if (this.hasClassList) {
            ele.classList.add(cls);
          } else {
            ele.className += ' ' + cls;
          }
        }
      },
      removeClass: function (ele, cls) {
        if (this.hasClass(ele, cls)) {
          if (this.hasClassList) {
            ele.classList.remove(cls);
          } else {
            var reg = new RegExp('(\\s|^)' + cls + '(\\s|$)');
            ele.className = ele.className.replace(reg, ' ');
          }
        }
      },
      addEventSimple: function (obj, evt, fn) {
        if (obj.addEventListener)
          obj.addEventListener(evt, fn, false);
        else if (obj.attachEvent)
          obj.attachEvent('on' + evt, fn);
      },
      removeEventSimple: function (obj, evt, fn) {
        if (obj.removeEventListener)
          obj.removeEventListener(evt, fn, false);
        else if (obj.detachEvent)
          obj.detachEvent('on' + evt, fn);
      },
      extendObject: function (destination, source) {
        for (var property in source) {
          if (source[property] && source[property].constructor && source[property].constructor === Object) {
            destination[property] = destination[property] || {};
            arguments.callee(destination[property], source[property]);
          } else {
            destination[property] = source[property];
          }
        }
        return destination;
      },
      proxy: function (fn, context) {
        return function () {
          return fn.apply(context, arguments);
        };
      },
      appNameFromUri: function (uri) {
        var parts = uri.split(':');
        var appName = parts[1];
        if (appName === 'app') {
          appName = parts[2];
        } else if (appName === 'user' && parts[3] === 'playlist') {
          appName = 'playlist';
        }
        return appName;
      }
    };
    function Marquee(element, maxWidth) {
      this.utils = playerUtils;
      this.element = element;
      this.maxWidth = maxWidth;
      this.timer = null;
      this.left = 0;
      this.hovered = false;
      this.scrolling = false;
      this.shouldScroll = false;
    }
    Marquee.prototype.init = function () {
      this.onMouseOver = this.onMouseOver.bind(this);
      this.onMouseOut = this.onMouseOut.bind(this);
      this.scroll = this.scroll.bind(this);
      this.utils.addEventSimple(this.element, 'mouseover', this.onMouseOver);
      this.utils.addEventSimple(this.element, 'mouseout', this.onMouseOut);
      this.element.style.position = 'relative';
      this.titlePadderWidth = 40;
      this.titlePadder = '<span style="padding-left:' + this.titlePadderWidth + 'px;"></span>';
    };
    Marquee.prototype.refresh = function () {
      if (this.scrolling) {
        this.stop();
      }
      this.textWidth = this.element.offsetWidth;
      this.shouldScroll = this.textWidth > this.maxWidth;
      if (this.shouldScroll) {
        this.element.style.left = '0px';
        this.left = 0;
      } else {
        this.element.style.left = (this.maxWidth - this.element.offsetWidth) / 2 + 'px';
      }
    };
    Marquee.prototype.widthAdjust = function (width) {
      this.maxWidth = width;
      this.refresh();
    };
    Marquee.prototype.stop = function () {
      if (!this.timer) {
        return;
      }
      clearInterval(this.timer);
      this.element.innerHTML = this._originalText;
      this.scrolling = false;
      this.refresh();
    };
    Marquee.prototype.scroll = function () {
      if (Math.abs(this.left) === this.textWidth + this.titlePadderWidth) {
        this.element.style.left = '0px';
        this.left = 0;
        if (!this.hovered) {
          this.stop();
        }
        return;
      }
      this.left--;
      this.element.style.left = '' + this.left + 'px';
    };
    Marquee.prototype.onMouseOver = function (e) {
      if (this.shouldScroll && !this.scrolling) {
        this.scrolling = true;
        this._originalText = this.element.innerHTML;
        this.element.innerHTML = this._originalText + this.titlePadder + this._originalText;
        this.timer = setInterval(this.scroll, 15);
      }
    };
    Marquee.prototype.onMouseOut = function (e) {
      this.hovered = false;
    };
    exports.trackHistory = trackHistory;
    exports.playerStorage = playerStorage;
    exports.playerUtils = playerUtils;
    exports.Marquee = Marquee;
    exports.kc = Konami;
  },
  'supported-languages.json': function (require, module, exports, global, __filename, __dirname) {
    module.exports = [
      'de',
      'en',
      'el',
      'es',
      'es-419',
      'fi',
      'fr',
      'fr-ca',
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
      'zsm',
      'zh-hant'
    ];
  },
  'de.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('de.loc/strings/main.lang', {
      'play': 'Play',
      'pause': 'Pause',
      'next': 'Weiter',
      'back': 'Zur\xFCck',
      'add-collection': 'Zur Sammlung hinzuf\xFCgen',
      'added-collection': 'Zur Sammlung hinzugef\xFCgt',
      'remove-collection': 'Aus der Sammlung entfernen',
      'removed-collection': 'Von der Sammlung entfernt',
      'shuffle': 'Shuffle',
      'repeat': 'Wiederholen',
      'start-radio-suggestion': 'Klick unten, um eine Radiostation, basierend auf diesen Empfehlungen, zu erstellen.'
    });
  },
  'en.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('en.loc/strings/main.lang', {
      'play': 'Play',
      'pause': 'Pause',
      'next': 'Next',
      'back': 'Back',
      'add-collection': 'Add to collection',
      'added-collection': 'Added to collection',
      'remove-collection': 'Remove from collection',
      'removed-collection': 'Removed from collection',
      'shuffle': 'Shuffle',
      'repeat': 'Repeat',
      'start-radio-suggestion': 'Click below to start a radio station from one of these recommended tracks.'
    });
  },
  'el.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('el.loc/strings/main.lang', {
      'play': 'Play',
      'pause': '\u03A0\u03B1\u03CD\u03C3\u03B7',
      'next': '\u0395\u03C0\u03CC\u03BC\u03B5\u03BD\u03BF',
      'back': '\u03A0\u03AF\u03C3\u03C9',
      'add-collection': '\u03A0\u03C1\u03BF\u03C3\u03B8\u03AE\u03BA\u03B7 \u03C3\u03C4\u03B7 \u03C3\u03C5\u03BB\u03BB\u03BF\u03B3\u03AE',
      'added-collection': '\u03A0\u03C1\u03BF\u03C3\u03C4\u03AD\u03B8\u03B7\u03BA\u03B5 \u03C3\u03C4\u03B7 \u03C3\u03C5\u03BB\u03BB\u03BF\u03B3\u03AE',
      'remove-collection': '\u0391\u03C6\u03B1\u03AF\u03C1\u03B5\u03C3\u03B7 \u03B1\u03C0\u03CC \u03C4\u03B7 \u03C3\u03C5\u03BB\u03BB\u03BF\u03B3\u03AE',
      'removed-collection': '\u0391\u03C6\u03B1\u03B9\u03C1\u03AD\u03B8\u03B7\u03BA\u03B5 \u03B1\u03C0\u03CC \u03C4\u03B7 \u03C3\u03C5\u03BB\u03BB\u03BF\u03B3\u03AE',
      'shuffle': '\u03A4\u03C5\u03C7\u03B1\u03AF\u03B1 \u03C3\u03B5\u03B9\u03C1\u03AC',
      'repeat': '\u0395\u03C0\u03B1\u03BD\u03AC\u03BB\u03B7\u03C8\u03B7',
      'start-radio-suggestion': '\u039A\u03AC\u03BD\u03B5 \u03BA\u03BB\u03B9\u03BA \u03C0\u03B1\u03C1\u03B1\u03BA\u03AC\u03C4\u03C9 \u03B3\u03B9\u03B1 \u03BD\u03B1 \u03BE\u03B5\u03BA\u03B9\u03BD\u03AE\u03C3\u03B5\u03B9\u03C2 \u03AD\u03BD\u03B1 \u03C1\u03B1\u03B4\u03B9\u03BF\u03C6\u03C9\u03BD\u03B9\u03BA\u03CC \u03C3\u03C4\u03B1\u03B8\u03BC\u03CC \u03BC\u03B5 \u03AD\u03BD\u03B1 \u03B1\u03C0\u03CC \u03B1\u03C5\u03C4\u03AC \u03C4\u03B1 \u03C0\u03C1\u03BF\u03C4\u03B5\u03B9\u03BD\u03CC\u03BC\u03B5\u03BD\u03B1 \u03BA\u03BF\u03BC\u03BC\u03AC\u03C4\u03B9\u03B1.'
    });
  },
  'es-419.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('es-419.loc/strings/main.lang', {
      'play': 'Reproducir',
      'pause': 'Pausa',
      'next': 'Siguiente',
      'back': 'Atr\xE1s',
      'add-collection': 'Agregar a la colecci\xF3n',
      'added-collection': 'Agregada a colecci\xF3n',
      'remove-collection': 'Retirar de la colecci\xF3n',
      'removed-collection': 'Eliminada de colecci\xF3n',
      'shuffle': 'Aleatorio',
      'repeat': 'Repetir',
      'start-radio-suggestion': 'Haz clic para iniciar una estaci\xF3n de radio con una de estas canciones recomendadas.'
    });
  },
  'fi.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('fi.loc/strings/main.lang', {
      'play': 'Toista',
      'pause': 'Tauko',
      'next': 'Seuraava',
      'back': 'Takaisin',
      'add-collection': 'Lis\xE4\xE4 kokoelmaan',
      'added-collection': 'Lis\xE4tty kokoelmaan',
      'remove-collection': 'Poista kokoelmasta',
      'removed-collection': 'Poistettu kokoelmasta',
      'shuffle': 'Satunnaistoisto',
      'repeat': 'Toista',
      'start-radio-suggestion': 'K\xE4ynnist\xE4 radioasema jostakin n\xE4ist\xE4 suositelluista kappaleista napsauttamalla alla olevaa linkki\xE4.'
    });
  },
  'es.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('es.loc/strings/main.lang', {
      'play': 'Reproducir',
      'pause': 'Pausa',
      'next': 'Siguiente',
      'back': 'Atr\xE1s',
      'add-collection': 'A\xF1adir a la colecci\xF3n',
      'added-collection': 'A\xF1adido/a a la colecci\xF3n',
      'remove-collection': 'Retirar de la colecci\xF3n',
      'removed-collection': 'Retirado/a de la colecci\xF3n',
      'shuffle': 'Aleatoria',
      'repeat': 'Repetir',
      'start-radio-suggestion': 'Haz click a continuaci\xF3n para iniciar una emisora de radio a partir de una de estas canciones recomendadas.'
    });
  },
  'fr.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('fr.loc/strings/main.lang', {
      'play': 'Lire',
      'pause': 'Pause',
      'next': 'Suivant',
      'back': 'Retour',
      'add-collection': 'Ajouter \xE0 la collection',
      'added-collection': 'Ajout\xE9 \xE0 la collection',
      'remove-collection': 'Supprimer de la collection',
      'removed-collection': 'Supprim\xE9 de la collection',
      'shuffle': 'Lecture al\xE9atoire',
      'repeat': 'R\xE9p\xE9ter',
      'start-radio-suggestion': 'Cliquez ci-dessous pour lancer la radio \xE0 partir de l\'un de ces titres recommand\xE9s.'
    });
  },
  'fr-ca.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('fr-ca.loc/strings/main.lang', {
      'play': 'Lire',
      'pause': 'Pause',
      'next': 'Suivant',
      'back': 'Retour',
      'add-collection': 'Ajouter \xE0 la collection',
      'added-collection': 'Ajout\xE9 \xE0 la collection',
      'remove-collection': 'Supprimer de la collection',
      'removed-collection': 'Supprim\xE9 de la collection',
      'shuffle': 'Lecture al\xE9atoire',
      'repeat': 'R\xE9p\xE9ter',
      'start-radio-suggestion': 'Cliquez ci-dessous pour lancer la station de radio \xE0 partir de l\'une de ces pistes recommand\xE9es.'
    });
  },
  'id.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('id.loc/strings/main.lang', {
      'play': 'Putar',
      'pause': 'Jeda',
      'next': 'Berikutnya',
      'back': 'Kembali',
      'add-collection': 'Tambahkan ke koleksi',
      'added-collection': 'Ditambahkan ke koleksi',
      'remove-collection': 'Hapus dari koleksi',
      'removed-collection': 'Dihapus dari koleksi',
      'shuffle': 'Acak',
      'repeat': 'Ulangi',
      'start-radio-suggestion': 'Klik di bawah ini untuk memulai stasiun radio dari salah satu lagu yang disarankan ini.'
    });
  },
  'ja.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('ja.loc/strings/main.lang', {
      'play': '\u518D\u751F',
      'pause': '\u4E00\u6642\u505C\u6B62',
      'next': '\u6B21\u3078',
      'back': '\u623B\u308B',
      'add-collection': '\u30B3\u30EC\u30AF\u30B7\u30E7\u30F3\u306B\u8FFD\u52A0',
      'added-collection': '\u30B3\u30EC\u30AF\u30B7\u30E7\u30F3\u306B\u8FFD\u52A0\u6E08\u307F',
      'remove-collection': '\u30B3\u30EC\u30AF\u30B7\u30E7\u30F3\u304B\u3089\u524A\u9664',
      'removed-collection': '\u30B3\u30EC\u30AF\u30B7\u30E7\u30F3\u304B\u3089\u524A\u9664\u6E08\u307F',
      'shuffle': '\u30B7\u30E3\u30C3\u30D5\u30EB',
      'repeat': '\u7E70\u308A\u8FD4\u3057',
      'start-radio-suggestion': '\u3053\u308C\u3089\u3044\u305A\u308C\u304B\u306E\u304A\u3059\u3059\u3081\u30C8\u30E9\u30C3\u30AF\u304B\u3089\u30B9\u30C6\u30FC\u30B7\u30E7\u30F3\u3092\u958B\u59CB\u3059\u308B\u306B\u306F\u4EE5\u4E0B\u3092\u30AF\u30EA\u30C3\u30AF\u3057\u3066\u304F\u3060\u3055\u3044\u3002'
    });
  },
  'it.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('it.loc/strings/main.lang', {
      'play': 'Play',
      'pause': 'Pausa',
      'next': 'Avanti',
      'back': 'Indietro',
      'add-collection': 'Aggiungi alla libreria',
      'added-collection': 'Aggiunto alla libreria',
      'remove-collection': 'Rimuovi dalla libreria',
      'removed-collection': 'Rimosso dalla libreria',
      'shuffle': 'Shuffle',
      'repeat': 'Ripeti',
      'start-radio-suggestion': 'Clicca sotto per avviare una stazione radio partendo da uno di questi brani consigliati.'
    });
  },
  'nl.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('nl.loc/strings/main.lang', {
      'play': 'Afspelen',
      'pause': 'Pauze',
      'next': 'Volgende',
      'back': 'Terug',
      'add-collection': 'Toevoegen aan collectie',
      'added-collection': 'Toegevoegd aan collectie',
      'remove-collection': 'Verwijderen uit collectie',
      'removed-collection': 'Verwijderd uit collectie',
      'shuffle': 'Shuffle',
      'repeat': 'Herhalen',
      'start-radio-suggestion': 'Klik hieronder om een radiostation te starten vanuit een van deze aanbevolen nummers.'
    });
  },
  'pl.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('pl.loc/strings/main.lang', {
      'play': 'Odtwarzaj',
      'pause': 'Pauza',
      'next': 'Dalej',
      'back': 'Powr\xF3t',
      'add-collection': 'Dodaj do kolekcji',
      'added-collection': 'Dodano do kolekcji',
      'remove-collection': 'Usu\u0144 z kolekcji',
      'removed-collection': 'Usuni\u0119to z kolekcji',
      'shuffle': 'Losowo',
      'repeat': 'Powt\xF3rz',
      'start-radio-suggestion': 'Kliknij poni\u017Cej, aby w\u0142\u0105czy\u0107 stacj\u0119 radiow\u0105 dla jednej z tych rekomendowanych utwor\xF3w.'
    });
  },
  'pt-br.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('pt-br.loc/strings/main.lang', {
      'play': 'Play',
      'pause': 'Pausar',
      'next': 'Avan\xE7ar',
      'back': 'Voltar',
      'add-collection': 'Adicionar \xE0 cole\xE7\xE3o',
      'added-collection': 'Adicionado \xE0 cole\xE7\xE3o',
      'remove-collection': 'Tirar da cole\xE7\xE3o',
      'removed-collection': 'Tirada da cole\xE7\xE3o',
      'shuffle': 'Tocar em ordem aleat\xF3ria',
      'repeat': 'Repetir',
      'start-radio-suggestion': 'Clique abaixo para iniciar uma esta\xE7\xE3o de r\xE1dio com uma destas faixas recomendadas.'
    });
  },
  'ru.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('ru.loc/strings/main.lang', {
      'play': '\u0412\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0441\u0442\u0438',
      'pause': '\u041F\u0430\u0443\u0437\u0430',
      'next': '\u0414\u0430\u043B\u0435\u0435',
      'back': '\u041D\u0430\u0437\u0430\u0434',
      'add-collection': '\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u043A\u043E\u043B\u043B\u0435\u043A\u0446\u0438\u044E',
      'added-collection': '\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E \u0432 \u043A\u043E\u043B\u043B\u0435\u043A\u0446\u0438\u044E',
      'remove-collection': '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0438\u0437 \u043A\u043E\u043B\u043B\u0435\u043A\u0446\u0438\u0438',
      'removed-collection': '\u0423\u0434\u0430\u043B\u0435\u043D\u043E \u0438\u0437 \u043A\u043E\u043B\u043B\u0435\u043A\u0446\u0438\u0438',
      'shuffle': '\u041F\u0435\u0440\u0435\u043C\u0435\u0448\u0430\u0442\u044C',
      'repeat': '\u041F\u043E\u0432\u0442\u043E\u0440',
      'start-radio-suggestion': '\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u043D\u0430 \u043B\u044E\u0431\u043E\u0439 \u043F\u0443\u043D\u043A\u0442 \u0432 \u0441\u043F\u0438\u0441\u043A\u0435, \u0447\u0442\u043E\u0431\u044B \u0432\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0440\u0430\u0434\u0438\u043E\u0441\u0442\u0430\u043D\u0446\u0438\u044E \u0438 \u043D\u0430\u0447\u0430\u0442\u044C \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u0435 \u0441 \u043E\u0434\u043D\u043E\u0433\u043E \u0438\u0437 \u0440\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u043E\u0432\u0430\u043D\u043D\u044B\u0445 \u0442\u0440\u0435\u043A\u043E\u0432.'
    });
  },
  'sv.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('sv.loc/strings/main.lang', {
      'play': 'Spela upp',
      'pause': 'Pausa',
      'next': 'N\xE4sta',
      'back': 'Bak\xE5t',
      'add-collection': 'L\xE4gg till i samling',
      'added-collection': 'Lades till i samlingen',
      'remove-collection': 'Ta bort fr\xE5n samling',
      'removed-collection': 'Togs bort fr\xE5n samlingen',
      'shuffle': 'Shuffle',
      'repeat': 'Repetera',
      'start-radio-suggestion': 'Klicka nedan om du vill starta en radiostation fr\xE5n n\xE5got av dessa rekommenderade sp\xE5r.'
    });
  },
  'th.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('th.loc/strings/main.lang', {
      'play': '\u0E40\u0E25\u0E48\u0E19',
      'pause': '\u0E2B\u0E22\u0E38\u0E14\u0E0A\u0E31\u0E48\u0E27\u0E04\u0E23\u0E32\u0E27',
      'next': '\u0E16\u0E31\u0E14\u0E44\u0E1B',
      'back': '\u0E01\u0E25\u0E31\u0E1A',
      'add-collection': '\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E44\u0E1B\u0E17\u0E35\u0E48\u0E04\u0E2D\u0E25\u0E40\u0E25\u0E04\u0E0A\u0E31\u0E19',
      'added-collection': '\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E44\u0E1B\u0E17\u0E35\u0E48\u0E04\u0E2D\u0E25\u0E40\u0E25\u0E04\u0E0A\u0E31\u0E19\u0E41\u0E25\u0E49\u0E27',
      'remove-collection': '\u0E25\u0E1A\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E04\u0E2D\u0E25\u0E40\u0E25\u0E04\u0E0A\u0E31\u0E19',
      'removed-collection': '\u0E25\u0E1A\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E04\u0E2D\u0E25\u0E40\u0E25\u0E04\u0E0A\u0E31\u0E19\u0E41\u0E25\u0E49\u0E27',
      'shuffle': '\u0E2A\u0E38\u0E48\u0E21',
      'repeat': '\u0E0B\u0E49\u0E33',
      'start-radio-suggestion': '\u0E04\u0E25\u0E34\u0E01\u0E14\u0E49\u0E32\u0E19\u0E25\u0E48\u0E32\u0E07\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E40\u0E23\u0E34\u0E48\u0E21\u0E2A\u0E16\u0E32\u0E19\u0E35\u0E27\u0E34\u0E17\u0E22\u0E38\u0E08\u0E32\u0E01\u0E2B\u0E19\u0E36\u0E48\u0E07\u0E43\u0E19\u0E41\u0E17\u0E23\u0E47\u0E01\u0E17\u0E35\u0E48\u0E41\u0E19\u0E30\u0E19\u0E33\u0E40\u0E2B\u0E25\u0E48\u0E32\u0E19\u0E35\u0E49'
    });
  },
  'tr.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('tr.loc/strings/main.lang', {
      'play': '\xC7al',
      'pause': 'Duraklat',
      'next': 'Sonraki',
      'back': 'Geri',
      'add-collection': 'Koleksiyona ekle',
      'added-collection': 'Koleksiyona eklendi',
      'remove-collection': 'Koleksiyondan kald\u0131r',
      'removed-collection': 'Koleksiyondan \xE7\u0131kar\u0131ld\u0131',
      'shuffle': 'Kar\u0131\u015F\u0131k \xC7al',
      'repeat': 'Tekrarla',
      'start-radio-suggestion': 'Bu \xF6nerilen par\xE7alar\u0131n birinden bir radyo istasyonu olu\u015Fturmak i\xE7in a\u015Fa\u011F\u0131ya t\u0131kla.'
    });
  },
  'zsm.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('zsm.loc/strings/main.lang', {
      'play': 'Main',
      'pause': 'Jeda',
      'next': 'Seterusnya',
      'back': 'Kembali',
      'add-collection': 'Tambah ke koleksi',
      'added-collection': 'Ditambah ke koleksi',
      'remove-collection': 'Keluarkan dari koleksi',
      'removed-collection': 'Dikeluarkan dari koleksi',
      'shuffle': 'Shuffle',
      'repeat': 'Ulang',
      'start-radio-suggestion': 'Klik di bawah untuk memulakan stesen radio dari salah satu lagu dicadangkan.'
    });
  },
  'zh-hant.loc/strings/main.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('zh-hant.loc/strings/main.lang', {
      'play': '\u64AD\u653E',
      'pause': '\u66AB\u505C',
      'next': '\u4E0B\u4E00\u6B65',
      'back': '\u8FD4\u56DE',
      'add-collection': '\u65B0\u589E\u81F3\u6536\u85CF',
      'added-collection': '\u5DF2\u65B0\u589E\u81F3\u6536\u85CF',
      'remove-collection': '\u5F9E\u6536\u85CF\u4E2D\u79FB\u9664',
      'removed-collection': '\u5F9E\u6536\u85CF\u4E2D\u79FB\u9664',
      'shuffle': '\u96A8\u6A5F\u64AD\u653E',
      'repeat': '\u91CD\u8907',
      'start-radio-suggestion': '\u6309\u4E0B\u65B9\u7684\u63A8\u85A6\u6B4C\u66F2\u958B\u555F\u96FB\u53F0\u983B\u9053\u3002'
    });
  },
  'scripts/utils.draggable.js': function (require, module, exports, global, __filename, __dirname) {
    function Draggable(element, userOpts) {
      var initialMouseX = undefined, initialMouseY = undefined, startX = undefined, startY = undefined, draggedObject = undefined, container = false, opts = {
          constrainDir: false,
          constrainParent: false,
          onStart: function () {
          },
          onMove: function () {
          },
          onComplete: function () {
          }
        };
      self.element = element;
      if (typeof element === 'string') {
        self.element = document.getElementById(element);
      }
      element.onmousedown = function (e) {
        startDragMouse(e);
      };
      for (var property in userOpts) {
        opts[property] = userOpts[property];
      }
      this.setContainerSize = function () {
        container = setContainer(element.offsetParent);
      };
      if (opts.constrainParent) {
        this.setContainerSize();
      }
      function setContainer(ele) {
        return {
          maxW: ele.offsetWidth,
          maxH: ele.offsetHeight
        };
      }
      var startDragMouse = function (e) {
        var doStart = opts.onStart(element);
        if (doStart === false) {
          return false;
        }
        startDrag(element);
        var evt = e || window.event;
        evt.preventDefault();
        initialMouseX = evt.clientX;
        initialMouseY = evt.clientY;
        document.addEventListener('mousemove', dragMouse);
        document.addEventListener('mouseup', releaseElement);
        document.addEventListener('mouseout', mouseOutWindow);
        return false;
      };
      var startDrag = function (obj) {
        if (draggedObject) {
          releaseElement();
        }
        startX = obj.offsetLeft;
        startY = obj.offsetTop;
        draggedObject = obj;
      };
      var dragMouse = function (e) {
        var evt = e || window.event;
        evt.preventDefault();
        var dX = evt.clientX - initialMouseX;
        var dY = evt.clientY - initialMouseY;
        setPosition(dX, dY);
        return false;
      };
      var setPosition = function (dx, dy) {
        var posX = startX + dx, posY = startY + dy;
        if (opts.constrainDir !== 'y') {
          if (container) {
            if (posX < 0) {
              posX = 0;
            }
            if (posX > container.maxW - draggedObject.offsetWidth) {
              posX = container.maxW - draggedObject.offsetWidth;
            }
          }
          draggedObject.style.left = posX + 'px';
        }
        if (opts.constrainDir !== 'x') {
          if (container) {
            if (posY < 0) {
              posY = 0;
            }
            if (posY > container.maxH - draggedObject.offsetHeight) {
              posY = container.maxH - draggedObject.offsetHeight;
            }
          }
          draggedObject.style.top = posY + 'px';
        }
        opts.onMove(draggedObject, posX, posY);
      };
      var mouseOutWindow = function (e) {
        e = e ? e : window.event;
        var from = e.relatedTarget || e.toElement;
        if (!from || from.nodeName == 'HTML') {
          releaseElement();
        }
      };
      var releaseElement = function () {
        document.removeEventListener('mousemove', dragMouse);
        document.removeEventListener('mouseup', releaseElement);
        document.removeEventListener('mouseout', mouseOutWindow);
        opts.onComplete(draggedObject);
        draggedObject = null;
      };
      this.startDrag = startDragMouse;
    }
    exports.Draggable = Draggable;
  },
  'scripts/utils.slider.js': function (require, module, exports, global, __filename, __dirname) {
    (function (Draggable) {
      function Slider(element, handle, userOpts) {
        var self = this;
        self._opts = {
          steps: 100,
          start: 0,
          onStart: function () {
          },
          onChange: function () {
          },
          onComplete: function () {
          }
        };
        self._disabled = false;
        self._element = element;
        self._handle = handle;
        if (typeof element === 'string') {
        }
        if (typeof handle === 'string') {
          self._handle = document.getElementById(handle);
        }
        self.step = self._opts.start;
        self.totalPx = element.offsetWidth - self._handle.offsetWidth;
        for (var property in userOpts) {
          self._opts[property] = userOpts[property];
        }
        self._moveHandle = function () {
          self._handle.style.left = self.step / self._opts.steps * self.totalPx + 'px';
        };
        var _calculateStep = function (posX) {
          self.step = Math.round(posX / self.totalPx * self._opts.steps);
          self._opts.onChange.apply(self);
        };
        var _startDragHandle = function (element) {
          if (self._disabled) {
            return false;
          }
          element.className = 'dragging';
          self._opts.onStart.apply(self);
        };
        var _onHandleMove = function (handle, posX, posY) {
          _calculateStep(posX);
        };
        var _endDragHandle = function (handle) {
          self._handle.className = '';
          self._opts.onComplete.apply(self);
        };
        this._handleClick = function (e, opt_pos) {
          var self = this;
          if (self._disabled || e.target === handle) {
            return false;
          }
          e.stopPropagation();
          var posX = opt_pos || e.offsetX || e.layerX;
          posX = posX - self._handle.offsetWidth / 2;
          posX = posX < 0 ? 0 : posX > self.totalPx ? self.totalPx : posX;
          _calculateStep(posX);
          self._moveHandle();
          self._opts.onChange.apply(self);
          self._knob.startDrag(e);
        };
        this._knob = new Draggable(handle, {
          constrainParent: true,
          constrainDir: 'x',
          onStart: _startDragHandle,
          onMove: _onHandleMove,
          onComplete: _endDragHandle
        });
        element.addEventListener('mousedown', function (e) {
          self._handleClick(e);
        }, false);
        self.handle = self._handle;
        self.jumpToStep(self._opts.start, false);
      }
      Slider.prototype.jumpToStep = function (step, doComplete) {
        if (self._disabled) {
          return false;
        }
        this.step = step;
        this._opts.onChange.apply(this);
        this._moveHandle();
        if (doComplete !== false) {
          this._opts.onComplete.apply(this);
        }
      };
      Slider.prototype.handleResize = function () {
        this.totalPx = this._element.offsetWidth - this._handle.offsetWidth;
        this._moveHandle();
        this._knob.setContainerSize();
        this._opts.onChange.apply(this);
      };
      Slider.prototype.setSteps = function (steps) {
        this._opts.steps = steps;
      };
      Slider.prototype.disable = function () {
        this._disabled = true;
      };
      Slider.prototype.enable = function () {
        this._disabled = false;
      };
      Slider.prototype.handleClick = function (e, opt_pos) {
        this._handleClick(e, opt_pos);
      };
      exports.Slider = Slider;
    }(require('scripts/utils.draggable.js').Draggable));
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
  'node_modules/spotify-events/util/type.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var FOLLOW = 'follow';
    var COLLECTION = 'collection';
    var UNKNOWN = 'unknown';
    module.exports = function (uri) {
      if (/^spotify:user:(.*):playlist:/.test(uri)) {
        return FOLLOW;
      } else if (/^spotify:user:/.test(uri)) {
        return FOLLOW;
      } else if (/^spotify:artist:/.test(uri)) {
        return FOLLOW;
      } else if (/^spotify:album:/.test(uri)) {
        return COLLECTION;
      } else if (/^spotify:track:/.test(uri)) {
        return COLLECTION;
      }
      return UNKNOWN;
    };
  },
  'node_modules/spotify-live-models/util/bridge.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var request = function (name, args, callback) {
      SP.request(name, args || [], null, function (data) {
        if (callback)
          callback(null, data);
      }, function (data) {
        var _args = JSON.stringify(args);
        var debug = ' (bridge message: \'' + name + '\', args: ' + _args + ')';
        var msg = data.message + debug;
        var error = new Error(msg);
        error.name = data.error;
        if (callback)
          callback(error);
      });
    };
    exports.request = request;
  },
  'node_modules/api/arb.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/arb.loc/strings/playlist.lang', {
      'Starred': 'Starred',
      'Toplist': 'Top tracks'
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
  'node_modules/api/de.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/de.loc/strings/playlist.lang', {
      'Starred': 'Starred',
      'Toplist': 'Top-Titel'
    });
  },
  'node_modules/api/es-la.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/es-la.loc/strings/playlist.lang', {
      'Starred': 'Seleccionadas',
      'Toplist': 'Canciones favoritas'
    });
  },
  'node_modules/api/en.loc/strings/playlist.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/api/en.loc/strings/playlist.lang', {
      'Starred': 'Starred',
      'Toplist': 'Top tracks'
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
  'scripts/player.widgets.js': function (require, module, exports, global, __filename, __dirname) {
    (function (models, utils, Marquee) {
      function ArtistWidget(element, initialSize, eventManager, logger) {
        var _this = this;
        this.element = element;
        this.eventManager = eventManager;
        this.track = null;
        this.artistsWanted = 0;
        this.artistsAdded = 0;
        this.logger = logger;
        this.marquee = new Marquee(element, initialSize);
        this.marquee.init();
        this.eventManager.subscribe(this.eventManager.Events.TRACK_CHANGED, this.setTrack, this);
      }
      ArtistWidget.prototype.init = function () {
        this.onArtistLoaded = this.onArtistLoaded.bind(this);
        this.onArtistClicked = this.onArtistClicked.bind(this);
        utils.addEventSimple(this.element, 'click', this.onArtistClicked);
      };
      ArtistWidget.prototype.resize = function (width) {
        this.marquee.widthAdjust(width);
      };
      ArtistWidget.prototype.onArtistClicked = function (e) {
        e.preventDefault();
        if (!e.target.href) {
          return;
        }
        if (this.track.advertisement) {
          this.eventManager.trigger(this.eventManager.Events.AD_CLICKED);
        } else {
          this.logger.userHit('arist_link', { artist_id: e.target.href.toSpotifyURI() });
          models.application.openURI(e.target.href.toSpotifyURI());
        }
      };
      ArtistWidget.prototype.onArtistLoaded = function (artist) {
        this.addArtist(artist);
      };
      ArtistWidget.prototype.setTrack = function (track) {
        var self = this;
        track.load('artists').done(function (track) {
          self.clear();
          self.track = track;
          self.artistsWanted = track.artists && track.artists.length || 0;
          var size = self.artistsWanted;
          for (var i = 0; i < size; i++) {
            track.artists[i].load([
              'name',
              'uri'
            ]).done(function (artist) {
              self.onArtistLoaded(artist);
            });
          }
        });
      };
      ArtistWidget.prototype.addArtist = function (artist) {
        if (this.artistsAdded > 0) {
          this.element.appendChild(document.createTextNode(', '));
        }
        var a = document.createElement('a');
        a.innerHTML = artist.name.decodeForHtml();
        a.href = artist.uri.toSpotifyURL();
        this.element.appendChild(a);
        this.artistsAdded++;
        if (this.artistsAdded === this.artistsWanted) {
          this.marquee.refresh();
        }
      };
      ArtistWidget.prototype.clear = function () {
        if (this.track === null) {
          return;
        }
        this.track = null;
        this.element.innerHTML = '';
        this.artistsAdded = 0;
      };
      exports.ArtistWidget = ArtistWidget;
    }(require('node_modules/api/scripts/models.js'), require('scripts/player-utils.js').playerUtils, require('scripts/player-utils.js').Marquee));
  },
  'scripts/player.shufflebutton.js': function (require, module, exports, global, __filename, __dirname) {
    (function (models, pu) {
      var playerUtils = pu.playerUtils;
      var playerStorage = pu.playerStorage;
      models.Loadable.define(models.Player, ['__rules'], '_playapp');
      function ShuffleButton(domID, logger, adBreak) {
        var self = this;
        var player = models.player;
        self._node = document.getElementById(domID);
        self._store = new playerStorage();
        self._adBreak = adBreak;
        self.logger = logger;
        player.load(['shuffle']).done(function (player) {
          self._player = player;
          self.init();
        });
      }
      ShuffleButton.prototype.init = function () {
        var self = this;
        self._player.addEventListener('change:shuffle', function () {
          self.updateStatus();
        });
        playerUtils.addEventSimple(self._node, 'click', function () {
          self.toggle();
          self.logger.userHit('shuffle_button', { track_id: self._player.track.uri });
        });
        self._player.addEventListener('change', function () {
          self._handleRules();
        });
        if (self._store.get('spShuffle') === 'true') {
          self.on();
        }
      };
      ShuffleButton.prototype._handleRules = function () {
        var rules = this._player.__rules;
        if (!rules.shuffle || this._adBreak.inProgress()) {
          this.disableButton();
        } else {
          this.enableButton();
        }
      };
      ShuffleButton.prototype.updateStatus = function () {
        if (this._player.shuffle) {
          playerUtils.addClass(this._node, 'active');
          this._store.set('spShuffle', 'true');
        } else {
          playerUtils.removeClass(this._node, 'active');
          if (this._player.__rules && this._player.__rules.shuffle) {
            this._store.set('spShuffle', 'false');
          }
        }
      };
      ShuffleButton.prototype.on = function () {
        playerUtils.addClass(this._node, 'active');
        var self = this;
        self._player.setShuffle(true).done(function () {
          self.updateStatus();
        });
      };
      ShuffleButton.prototype.off = function () {
        playerUtils.removeClass(this._node, 'active');
        var self = this;
        self._player.setShuffle(false).done(function () {
          self.updateStatus();
        });
      };
      ShuffleButton.prototype.toggle = function () {
        var self = this;
        if (playerUtils.hasClass(self._node, 'disabled')) {
          return false;
        }
        if (!self._player.shuffle) {
          self.on();
        } else {
          self.off();
        }
      };
      ShuffleButton.prototype.disableButton = function () {
        playerUtils.addClass(this._node, 'disabled');
        this.updateStatus();
      };
      ShuffleButton.prototype.enableButton = function () {
        playerUtils.removeClass(this._node, 'disabled');
        this.updateStatus();
      };
      exports.ShuffleButton = ShuffleButton;
    }(require('node_modules/api/scripts/models.js'), require('scripts/player-utils.js')));
  },
  'scripts/player.repeatbutton.js': function (require, module, exports, global, __filename, __dirname) {
    (function (models, pu) {
      var playerUtils = pu.playerUtils;
      var playerStorage = pu.playerStorage;
      models.Loadable.define(models.Player, ['__rules'], '_playapp');
      function RepeatButton(domID, logger, adBreak) {
        var self = this;
        var player = models.player;
        self._node = document.getElementById(domID);
        self._store = new playerStorage();
        self._disabled = false;
        self._adBreak = adBreak;
        self.logger = logger;
        player.load(['repeat']).done(function (player) {
          self._player = player;
          self.init(domID);
        });
      }
      RepeatButton.prototype.init = function () {
        var self = this;
        self._player.addEventListener('change:repeat', function () {
          self.updateStatus();
        });
        self._player.addEventListener('change', function () {
          self._handleRules();
        });
        playerUtils.addEventSimple(self._node, 'click', function () {
          self.toggle();
          self.logger.userHit('repeat_button', { track_id: self._player.track.uri });
        });
        if (self._store.get('spRepeat') === 'true') {
          self.on();
        }
      };
      RepeatButton.prototype._handleRules = function () {
        var rules = this._player.__rules;
        if (!rules.repeat || this._adBreak.inProgress()) {
          this.disableButton();
        } else {
          this.enableButton();
        }
      };
      RepeatButton.prototype.updateStatus = function () {
        if (this._player.repeat) {
          playerUtils.addClass(this._node, 'active');
          this._store.set('spRepeat', 'true');
        } else {
          playerUtils.removeClass(this._node, 'active');
          if (this._player.__rules && this._player.__rules.repeat) {
            this._store.set('spRepeat', 'false');
          }
        }
      };
      RepeatButton.prototype.on = function () {
        var self = this;
        playerUtils.addClass(this._node, 'active');
        self._player.setRepeat(true).done(function () {
          self.updateStatus();
        });
      };
      RepeatButton.prototype.off = function () {
        playerUtils.removeClass(this._node, 'active');
        var self = this;
        self._player.setRepeat(false).done(function () {
          self.updateStatus();
        });
      };
      RepeatButton.prototype.toggle = function () {
        if (playerUtils.hasClass(this._node, 'disabled')) {
          return false;
        }
        if (!this._player.repeat) {
          this.on();
        } else {
          this.off();
        }
      };
      RepeatButton.prototype.disableButton = function () {
        this._disabled = true;
        playerUtils.addClass(this._node, 'disabled');
        this.updateStatus();
      };
      RepeatButton.prototype.enableButton = function () {
        this._disabled = false;
        playerUtils.removeClass(this._node, 'disabled');
        this.updateStatus();
      };
      exports.RepeatButton = RepeatButton;
    }(require('node_modules/api/scripts/models.js'), require('scripts/player-utils.js')));
  },
  'scripts/player.playpausebutton.js': function (require, module, exports, global, __filename, __dirname) {
    (function (models, pu) {
      var playerUtils = pu.playerUtils;
      function PlayPauseButton(domID, logger, adBreak) {
        var self = this;
        var player = models.player;
        self.logger = logger;
        self._node = document.getElementById(domID);
        self._adBreak = adBreak;
        self._disabled = false;
        player.load([
          'playing',
          'track',
          'context'
        ]).done(function (player) {
          self._player = player;
          self.init();
        });
      }
      PlayPauseButton.prototype.init = function () {
        var self = this;
        playerUtils.addEventSimple(self._node, 'click', function (e) {
          self.toggle(e);
        });
        self._player.addEventListener('change:playing', function () {
          self.updateStatus();
        });
        self._player.addEventListener('change:track', function () {
          self.updateStatus();
        });
        self._adBreak.addEventListener('updateDetails', function () {
          self.updateStatus();
        });
        self.updateStatus();
      };
      PlayPauseButton.prototype.toggle = function (e) {
        if (this._disabled) {
          return false;
        }
        if (e) {
          e.preventDefault();
        }
        if (this.isPlaying()) {
          if (this._adBreak.inProgress()) {
            this._adBreak.pause();
          } else {
            this._player.pause();
          }
        } else {
          if (this._adBreak.inProgress()) {
            this._adBreak.resume();
          } else {
            this._player.play();
          }
        }
        this.logger.userHit('play_pause', { track_id: this._player.track.uri });
      };
      PlayPauseButton.prototype.isPlaying = function () {
        var adBreakDetails = this._adBreak.getDetails();
        return adBreakDetails ? adBreakDetails.playing : this._player.playing;
      };
      PlayPauseButton.prototype.updateStatus = function () {
        if (this.isPlaying()) {
          playerUtils.addClass(this._node, 'playing');
        } else {
          playerUtils.removeClass(this._node, 'playing');
        }
        if (!this._adBreak.inProgress() && !this._player.track && !(this._player.context && this._player.context.uri)) {
          this.disableButton();
        } else {
          this.enableButton();
        }
        this.setPageTitle();
      };
      PlayPauseButton.prototype.setPageTitle = function () {
        var newTitle;
        var currentTrack = this._player.track;
        if (!currentTrack) {
          newTitle = 'Spotify Web Player';
        } else {
          newTitle = currentTrack.name + ' - ' + (currentTrack.artists && currentTrack.artists[0].name) || '';
        }
        newTitle = (this._player.playing ? '\u25B6 ' : '') + newTitle;
        models.application.setTitle(newTitle);
      };
      PlayPauseButton.prototype.disableButton = function () {
        this._disabled = true;
        playerUtils.addClass(this._node, 'disabled');
        playerUtils.removeClass(this._node, 'playing');
      };
      PlayPauseButton.prototype.enableButton = function () {
        this._disabled = false;
        playerUtils.removeClass(this._node, 'disabled');
      };
      exports.PlayPauseButton = PlayPauseButton;
    }(require('node_modules/api/scripts/models.js'), require('scripts/player-utils.js')));
  },
  'scripts/player.nextbackbuttons.js': function (require, module, exports, global, __filename, __dirname) {
    (function (models, pu) {
      var playerUtils = pu.playerUtils;
      var fastSkipTimer = null;
      var player = models.player;
      models.Loadable.define(models.Player, ['__rules'], '_playapp');
      function NextButton(domID, eventManager, logger, adBreak) {
        var self = this;
        self._node = document.getElementById(domID);
        self._eventManager = eventManager;
        self._adBreak = adBreak;
        self.logger = logger;
        self._disabled = false;
        player.load(['playing']).done(function (player) {
          self._player = player;
          self.init();
        });
      }
      NextButton.prototype.init = function () {
        var self = this;
        playerUtils.addEventSimple(self._node, 'click', function (e) {
          e.preventDefault();
          self.playerNext();
          self._node.blur();
        });
        self._player.addEventListener('change', function () {
          self._handleRules();
        });
      };
      NextButton.prototype._handleRules = function () {
        if (this._adBreak.inProgress()) {
          this.disableButton();
          return;
        }
        var rules = this._player.__rules;
        if (!rules.next) {
          this.disableButton();
          return;
        }
        if (!this._player.track || !this._player.context) {
          this.disableButton();
          return;
        }
        if (this._player.repeat === true) {
          this.enableButton();
          return;
        }
        this.enableButton();
      };
      NextButton.prototype.playerNext = function () {
        if (!this._disabled) {
          this._eventManager.trigger(this._eventManager.Events.TRACK_SKIPPED);
          this.logger.userHit('next_button', { track_id: this._player.track.uri });
          this._player.skipToNextTrack();
        }
      };
      NextButton.prototype.disableButton = function () {
        this._disabled = true;
        playerUtils.addClass(this._node, 'disabled');
      };
      NextButton.prototype.enableButton = function () {
        this._disabled = false;
        playerUtils.removeClass(this._node, 'disabled');
      };
      NextButton.prototype.update = function () {
        this._handleRules();
      };
      function BackButton(domID, eventManager, logger, adBreak) {
        var self = this;
        self._eventManager = eventManager;
        self._disabled = false;
        self._node = document.getElementById(domID);
        self._adBreak = adBreak;
        self.logger = logger;
        player.load(['playing']).done(function (player) {
          self._player = player;
          self.init();
        });
      }
      BackButton.prototype.init = function () {
        var self = this;
        playerUtils.addEventSimple(self._node, 'click', function (e) {
          e.preventDefault();
          self.playerBack();
          self._node.blur();
        });
        self._player.addEventListener('change', function () {
          self._handleRules();
        });
      };
      BackButton.prototype._handleRules = function () {
        if (this._adBreak.inProgress()) {
          this.disableButton();
          return;
        }
        var rules = this._player.__rules;
        if (!rules.previous) {
          this.disableButton();
          return;
        } else {
          if (this._disabled) {
            this.enableButton();
          }
        }
        if (!this._player.track || !this._player.context) {
          this.disableButton();
          return;
        } else {
          this.enableButton();
        }
      };
      BackButton.prototype.playerBack = function () {
        if (this._disabled || this._player.track.duration - this._player.position < 500) {
          return false;
        }
        this.logger.userHit('previous_button', { track_id: this._player.track.uri });
        this._eventManager.trigger(this._eventManager.Events.BACK_BUTTON_PRESS_START);
        if (this._player.position > 4000 || this._player.__index === 0 && !this._player.repeat) {
          this._player.seek(0);
          if (!this._player.playing) {
            this._player.play();
          }
        } else {
          this._player.skipToPrevTrack();
          this._eventManager.trigger(this._eventManager.Events.TRACK_SKIPPED);
        }
        this._eventManager.trigger(this._eventManager.Events.BACK_BUTTON_PRESS_COMPLETE);
      };
      BackButton.prototype.disableButton = function () {
        this._disabled = true;
        playerUtils.addClass(this._node, 'disabled');
      };
      BackButton.prototype.enableButton = function () {
        this._disabled = false;
        playerUtils.removeClass(this._node, 'disabled');
      };
      BackButton.prototype.update = function () {
        this._handleRules();
      };
      exports.NextButton = NextButton;
      exports.BackButton = BackButton;
    }(require('node_modules/api/scripts/models.js'), require('scripts/player-utils.js')));
  },
  'scripts/player.progressbar.js': function (require, module, exports, global, __filename, __dirname) {
    (function (models, pu, Slider) {
      var playerUtils = pu.playerUtils;
      var player = models.player;
      models.Loadable.define(models.Player, ['__uid'], '_playapp');
      function ProgressBar(wrapperID, eventManager, logger, adBreak) {
        var self = this;
        self._wrapper = document.getElementById(wrapperID);
        self._eventManager = eventManager;
        self._timer = null;
        self._updateInterval = 310;
        self._control = null;
        self._isScrubbing = false;
        self._seekingTo = null;
        self._timeMarker = null;
        self._timeMarkerCenter = 0;
        self._currentTrackUID = -1;
        self.logger = logger;
        self._maxContainerWidth = null;
        self._timeMarkerWidth = null;
        self._adBreak = adBreak;
        player.load([
          'playing',
          'track',
          'position',
          'duration'
        ]).done(function (player) {
          self._player = player;
          self._currentTrackUID = player.__uid;
          self.init();
        });
      }
      ProgressBar.prototype.init = function () {
        var self = this;
        self.buildNodes();
        self._control = new Slider(self._barClickArea, self._scrubber, {
          steps: self._player.track ? self._player.track.duration : 100,
          onStart: function () {
            self._isScrubbing = true;
            playerUtils.addClass(self._timeMarker, 'active');
            playerUtils.addClass(self._timeMarkerArrow, 'active');
          },
          onChange: function () {
            if (self._player.track) {
              setTimeout(function () {
                self.updateElapsedTime(this.step);
                var handleCentre = this.handle.offsetLeft + this.handle.offsetWidth / 2;
                self.moveTimeMarker(handleCentre);
                self._barInner.style.width = handleCentre + 'px';
              }.bind(this), 1);
            }
          },
          onComplete: function () {
            if (self._player.track && self._player.track.duration - this.step <= 500) {
              self._player.skipToNextTrack();
            } else {
              self._player.seek(this.step);
              self._seekingTo = this.step;
              self._barInner.style.width = this.handle.offsetLeft + this.handle.offsetWidth / 2 + 'px';
            }
            self._isScrubbing = false;
            self.logger.userHit('seek_bar', {
              track_id: self._player.track.uri,
              seek_ms: this.step
            });
            playerUtils.removeClass(self._timeMarker, 'active');
            playerUtils.removeClass(self._timeMarkerArrow, 'active');
            self.pauseTimer(600);
          }
        });
        self._player.addEventListener('change:track', function () {
          self._handleTrackChange();
        });
        self._player.addEventListener('change', function () {
          if (self._currentTrackUID !== player.__uid) {
            self._handleTrackChange();
          }
        });
        self._eventManager.subscribe(self._eventManager.Events.TRACK_SKIPPED, function () {
          self._handleTrackChange();
        });
        self._eventManager.subscribe(self._eventManager.Events.BACK_BUTTON_PRESS_START, function () {
          self._handleTrackChange();
        });
        self._player.addEventListener('change:playing', function () {
          if (self._player.playing) {
            self.runTimer();
          } else {
            self.stopTimer();
          }
        });
        self._adBreak.addEventListener('startBreak', self._handleAdBreakStartEnd.bind(self));
        self._adBreak.addEventListener('endBreak', self._handleAdBreakStartEnd.bind(self));
        self._adBreak.addEventListener('updateDetails', self._handleAdBreakUpdate.bind(self));
        self.moveTimeMarker(0);
        self.runTimer();
      };
      ProgressBar.prototype.moveTimeMarker = function (handlePos) {
        var self = this;
        var getArrowPosition = function (pos) {
          if (pos < self._timeMarkerArrowWidth) {
            pos = self._timeMarkerArrowWidth;
          } else if (pos > self._maxContainerWidth - self._timeMarkerArrowWidth - 2) {
            pos = self._maxContainerWidth - self._timeMarkerArrowWidth - 2;
          }
          pos = pos - self._timeMarkerArrowWidth / 2 + 1;
          return pos;
        };
        var arrowPos = getArrowPosition(handlePos);
        var movingTo = handlePos - self._timeMarkerCenter;
        if (movingTo < 2) {
          movingTo = 2;
        } else if (handlePos > self._maxContainerWidth - self._timeMarkerCenter - 2) {
          movingTo = self._maxContainerWidth - self._timeMarkerWidth - 2;
        }
        self._timeMarkerArrow.style.left = arrowPos + 'px';
        self._timeMarker.style.left = movingTo + 'px';
      };
      ProgressBar.prototype.setPageTitle = function (time, initialSet) {
        var newTitle;
        var currentTrack = this._player.track;
        var adDetails = this._adBreak.getDetails();
        if (adDetails) {
          newTitle = adDetails.title + ' - ' + adDetails.description;
        } else if (!currentTrack) {
          newTitle = '';
        } else {
          newTitle = currentTrack.name + ' - ' + (currentTrack.artists && currentTrack.artists[0].name) || '';
        }
        if (!adDetails && (this._player.playing || time && initialSet)) {
          newTitle = '[' + playerUtils.secsToMins((time || this._player.position) / 1000) + '] ' + newTitle;
        }
        models.application.setTitle(newTitle);
      };
      ProgressBar.prototype.buildNodes = function () {
        this._barClickArea = document.createElement('div');
        this._barClickArea.id = 'bar-click';
        this._barOuter = document.createElement('div');
        this._barOuter.id = 'bar-outer';
        this._barInner = document.createElement('div');
        this._barInner.id = 'bar-inner';
        this._scrubber = document.createElement('span');
        this._scrubber.id = 'position';
        this._barClickArea.appendChild(this._barOuter);
        this._barOuter.appendChild(this._barInner);
        this._barOuter.appendChild(this._scrubber);
        this._wrapper.appendChild(this._barClickArea);
        this._timeWrapper = document.createElement('div');
        this._timeWrapper.id = 'time';
        this._trackCurrentPos = document.createElement('span');
        this._trackCurrentPos.id = 'track-current';
        this._trackLength = document.createElement('span');
        this._trackLength.id = 'track-length';
        this._timeMarker = document.createElement('div');
        this._timeMarker.id = 'time-marker';
        this._timeMarkerText = document.createElement('div');
        this._timeMarkerText.id = 'time-marker-text';
        this._timeMarkerArrow = document.createElement('span');
        this._timeMarkerArrow.id = 'time-marker-arrow';
        this._timeMarker.appendChild(this._timeMarkerText);
        this._timeMarkerText.appendChild(this._trackCurrentPos);
        this._timeMarkerText.appendChild(this._trackLength);
        var duration = (this._player.track && this._player.track.duration || 0) / 1000;
        this._trackLength.textContent = playerUtils.secsToMins(duration);
        this._wrapper.appendChild(this._timeMarker);
        this._wrapper.appendChild(this._timeMarkerArrow);
        this._wrapper.appendChild(this._timeWrapper);
        var self = this;
        setTimeout(function () {
          self.setupMarkerSizing();
        }, 10);
      };
      ProgressBar.prototype.setupMarkerSizing = function () {
        this._timeMarkerWidth = this._timeMarker.offsetWidth;
        this._timeMarkerCenter = this._timeMarkerWidth / 2;
        this._timeMarkerArrowWidth = this._timeMarkerArrow.offsetWidth;
        this._timeMarkerDefaultPos = this._timeMarkerCenter + this._timeMarkerArrowWidth / 2;
        this._maxContainerWidth = this._barOuter.offsetWidth;
        this._maxMarkerRightPos = this._maxContainerWidth - this._timeMarkerWidth - 2;
        this._maxArrowRightPos = this._maxContainerWidth + this._timeMarkerArrowWidth - this._timeMarkerWidth - 2;
      };
      ProgressBar.prototype._handleTrackChange = function () {
        var self = this;
        if (!self._player.track) {
          self.stopTimer();
          return false;
        }
        self._trackLength.textContent = playerUtils.secsToMins(self._player.track.duration / 1000);
        self.updateElapsedTime(0);
        self._seekingTo = null;
        self._control.jumpToStep(0, false);
        self._control.setSteps(self._player.track.duration);
        self._currentTrackUID = player.__uid || -1;
        self.pauseTimer(1500);
        self.setupMarkerSizing();
      };
      ProgressBar.prototype._handleAdBreakStartEnd = function () {
        var self = this;
        if (self._adBreak.inProgress()) {
          self.disable();
        }
      };
      ProgressBar.prototype._handleAdBreakUpdate = function () {
        var self = this;
        var d = self._adBreak.getDetails();
        if (d && d.duration > 0) {
          self._trackLength.textContent = playerUtils.secsToMins(d.duration / 1000);
          self._control.setSteps(d.duration);
          self._control.jumpToStep(d.position, false);
          self.updateElapsedTime(d.position);
          self.setPageTitle();
        }
      };
      ProgressBar.prototype.runTimer = function () {
        var self = this;
        if (!self._timer && self._player.playing) {
          self._timer = setInterval(function () {
            if (!self._isScrubbing) {
              self.updatePosition();
            }
          }.bind(self), self._updateInterval);
        } else if (self._timer && !self._player.playing) {
          self.stopTimer();
        }
      };
      ProgressBar.prototype.stopTimer = function () {
        var self = this;
        clearInterval(self._timer);
        self._timer = null;
      };
      ProgressBar.prototype.pauseTimer = function (ms) {
        if (!ms) {
          throw new Error('You must enter a pause time');
        }
        var self = this;
        self.stopTimer();
        setTimeout(function () {
          self.runTimer();
        }.bind(self), ms);
      };
      ProgressBar.prototype.updateElapsedTime = function (ms) {
        var newTimeSecs = playerUtils.secsToMins(ms / 1000);
        this._trackCurrentPos.textContent = newTimeSecs;
      };
      ProgressBar.prototype.enable = function () {
        if (this._control && !this._adBreak.inProgress()) {
          this._control.enable();
        }
      };
      ProgressBar.prototype.disable = function () {
        this._control.disable();
      };
      ProgressBar.prototype.reload = function () {
        this._control.handleResize();
        this.setupMarkerSizing();
      };
      ProgressBar.prototype.updatePosition = function () {
        var self = this;
        var expectAdBreakUpdates = self._adBreak.inProgress() && self._adBreak.getDetails();
        if (!self._player || !self._player.track || !self._player.playing || self._isScrubbing || expectAdBreakUpdates) {
          self.stopTimer();
          return false;
        }
        var time = self._player.position;
        if (time > self._player.track.duration) {
          time = self._player.track.duration;
        }
        if (self._seekingTo && Math.abs(self._seekingTo - time) > 1500) {
          return false;
        }
        self._seekingTo = null;
        self._control.jumpToStep(time, false);
        self.updateElapsedTime(time);
      };
      exports.ProgressBar = ProgressBar;
    }(require('node_modules/api/scripts/models.js'), require('scripts/player-utils.js'), require('scripts/utils.slider.js').Slider));
  },
  'scripts/player.volumecontrol.js': function (require, module, exports, global, __filename, __dirname) {
    (function (models, pu, Slider) {
      var playerUtils = pu.playerUtils;
      var playerStorage = pu.playerStorage;
      function VolumeControl(wrapperID, logger) {
        var self = this;
        var player = models.player;
        self._wrapper = document.getElementById(wrapperID);
        self._dragging = false;
        self._store = new playerStorage();
        self.logger = logger;
        player.load(['volume']).done(function (player) {
          self._player = player;
          self.init();
        });
      }
      VolumeControl.prototype.reload = function () {
        this._control.handleResize();
      };
      VolumeControl.prototype.buildNodes = function () {
        var self = this;
        this._barClickArea = document.createElement('div');
        this._barClickArea.id = 'volume-click';
        this._barOuter = document.createElement('div');
        this._barOuter.id = 'volume-bar';
        this._handle = document.createElement('span');
        this._handle.id = 'vol-position';
        this._barInner = document.createElement('div');
        this._barInner.id = 'vol-bar-inner';
        this._barClickArea.appendChild(this._barOuter);
        this._barOuter.appendChild(this._barInner);
        this._barOuter.appendChild(this._handle);
        this._wrapper.appendChild(this._barClickArea);
        this._handleWidth = this._handle.offsetWidth;
      };
      VolumeControl.prototype.init = function () {
        var self = this;
        var tempVol = self._store.get('spVolume') || 100;
        tempVol = tempVol < 0 ? 0 : tempVol > 100 ? 100 : tempVol;
        self.buildNodes();
        self._control = new Slider(self._barClickArea, self._handle, {
          steps: 100,
          start: parseInt(tempVol, 10),
          onStart: function () {
            self._dragging = true;
            playerUtils.addClass(self._wrapper, 'in-use');
          },
          onChange: function () {
            self._player.setVolume(this.step / 100);
            var innerBarWidth = Math.floor(this.step / this._opts.steps * this.totalPx + self._handleWidth);
            self._barInner.style.width = innerBarWidth + 'px';
          },
          onComplete: function () {
            self._dragging = false;
            playerUtils.removeClass(self._wrapper, 'in-use');
            self._store.set('spVolume', this.step);
            if (self._player && self._player.track) {
              self.logger.userHit('volume_bar', {
                track_id: self._player.track.uri,
                volume: this.step
              });
            }
          }
        });
        self._player.addEventListener('change:volume', function () {
          if (!self._dragging) {
            self.setVolume(parseInt(self._player.volume * 100, 10));
          }
        });
      };
      VolumeControl.prototype.setVolume = function (vol) {
        if (isNaN(vol) || vol < 0 || vol > 100) {
          throw new Error('Volume must be an integer between 0 and 100');
        }
        this._control.jumpToStep(vol, true);
      };
      exports.VolumeControl = VolumeControl;
    }(require('node_modules/api/scripts/models.js'), require('scripts/player-utils.js'), require('scripts/utils.slider.js').Slider));
  },
  'scripts/player.tracking.js': function (require, module, exports, global, __filename, __dirname) {
    (function (Models) {
      function Tracker() {
        this.DEFAULT_DATA = {};
        this.DEFAULT_CONTEXT = 'player-web';
        this.DEFAULT_EVENT_VERSION = '1';
        this.DEFAULT_TEST_VERSION = 'base';
      }
      Tracker.prototype.track = function (event, data, context, eventVersion, testVersion) {
        data = data || this.DEFAULT_DATA;
        context = context || this.DEFAULT_CONTEXT;
        eventVersion = eventVersion || this.DEFAULT_EVENT_VERSION;
        testVersion = testVersion || this.DEFAULT_TEST_VERSION;
        Models.application.clientEvent(context, event, eventVersion, testVersion, data);
      };
      var Events = { DOWNLOAD_LINK_CLICKED: 'download-link-clicked' };
      exports.Tracker = Tracker;
      exports.Events = Events;
    }(require('node_modules/api/scripts/models.js')));
  },
  'scripts/preview.player.js': function (require, module, exports, global, __filename, __dirname) {
    (function (playerUtils, models) {
      'use strict';
      var preview = null;
      var player = null;
      var previewing = false;
      var playing = false;
      var previewUiActive = false;
      function previewChangeHandler(e) {
        previewing = e.target.playing;
        if (previewing === true) {
          showOverlay();
        } else {
          hideOverlay();
        }
      }
      function playerChangeHandler(e) {
        playing = e.target.playing;
        if (previewing === true && playing === true) {
          hideOverlay();
        }
      }
      function showOverlay() {
        if (!previewUiActive) {
          playerUtils.addClass(document.body, 'audio-previewing');
          previewUiActive = true;
        }
      }
      function hideOverlay() {
        if (previewUiActive) {
          playerUtils.removeClass(document.body, 'audio-previewing');
          previewUiActive = false;
        }
      }
      function init() {
        var players = [
          models.preview,
          models.player
        ];
        var promises = [];
        players.forEach(function (p) {
          promises.push(p.load([
            'playing',
            'track',
            'context'
          ]));
        });
        models.Promise.join(promises).each(function (p) {
          if (p.id === 'main') {
            player = p;
            player.addEventListener('change:playing', playerChangeHandler);
          } else if (p.id === 'preview') {
            preview = p;
            preview.addEventListener('change:playing', previewChangeHandler);
          }
        });
      }
      exports.init = init;
    }(require('scripts/player-utils.js').playerUtils, require('node_modules/api/scripts/models.js')));
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
  'scripts/player.suggestions.js': function (require, module, exports, global, __filename, __dirname) {
    (function (hermes, models) {
      var schema = hermes.Schema.fromURL(['proto/radio.proto']);
      schema.load().done(function () {
        var Hermes = hermes.Hermes;
        function getTrackSuggestions(seed, length, onSuccess, onFail) {
          makeHermesCall(seed, length, onSuccess, onFail);
        }
        ;
        function makeHermesCall(seed, length, onSuccess, onFail) {
          var salt = Math.floor(Math.random() * 1000000);
          var suggestionRequest = {
            salt: salt,
            uris: seed,
            lastTracks: [],
            length: length
          };
          var req = Hermes.get('hm://radio/', [schema.type('Tracks')], [schema.type('RadioRequest')]);
          req.send(suggestionRequest).done(onSuccess).fail(onFail);
        }
        exports.getTrackSuggestions = getTrackSuggestions;
      }).fail(function () {
      });
    }(require('node_modules/api/scripts/hermes.js'), require('node_modules/api/scripts/models.js')));
  },
  'node_modules/revgen-shared/scripts/audioad.js': function (require, module, exports, global, __filename, __dirname) {
    (function (models) {
      var player = models.player;
      var track = models.track;
      function AudioAd() {
      }
      AudioAd.prototype._showLightbox = function (args, opt_origin) {
        var appArguments = ['revgen-modal'];
        appArguments = appArguments.concat(args);
        appArguments.push([
          opt_origin,
          Date.now()
        ]);
        return models.application.openApp.apply(models.application, appArguments);
      };
      AudioAd.prototype.handleAdClick = function (adMetadata, isPlayerTrack) {
        var isLightbox, adURI, embed, backgroundImage;
        if (isPlayerTrack === undefined) {
          isPlayerTrack = true;
        }
        if (adMetadata && typeof adMetadata === 'object' && typeof adMetadata.targetUrl === 'string') {
          backgroundImage = embed.background_image || '';
          isLightbox = adMetadata.type === 'lightbox';
          adURI = adMetadata.targetUrl || '';
          embed = adMetadata.embed || {};
        } else {
          isLightbox = false;
          adURI = adMetadata || '';
          embed = {};
        }
        if (adURI.indexOf('http') !== -1) {
          if (isLightbox) {
            this._showLightbox([
              adURI,
              embed.width,
              embed.height,
              backgroundImage
            ]);
          } else {
            window.open(adURI);
          }
          if (isPlayerTrack) {
            window.parent.postMessage('{"ad_clicked":"' + adURI + '"}', '*');
          }
          return;
        }
        var uri = adURI.toSpotifyURI();
        if (uri.indexOf('spotify:track') !== -1) {
          player.playTrack(track.fromURI(uri));
        } else {
          models.application.openURI(uri);
        }
        if (isPlayerTrack) {
          window.parent.postMessage('ad_clicked', '*');
        }
      };
      exports.AudioAd = new AudioAd();
    }(require('node_modules/api/scripts/models.js')));
  },
  'node_modules/views/scripts/contextapp.js': function (require, module, exports, global, __filename, __dirname) {
    (function (models) {
      exports.ContextApp = ContextApp;
      function ContextApp() {
      }
      ContextApp.show = function (name, args, element, opt_origin, opt_index, opt_loggingContext) {
        var offset = element.getBoundingClientRect();
        var appArguments = [
          name,
          offset.left,
          offset.top,
          offset.width,
          offset.height
        ];
        appArguments = appArguments.concat(args);
        appArguments.push(opt_origin);
        appArguments.push(opt_index);
        appArguments.push(opt_loggingContext);
        return models.application.openApp.apply(models.application, appArguments);
      };
    }(require('node_modules/api/scripts/models.js')));
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
  'node_modules/revgen-shared/scripts/ad_break.js': function (require, module, exports, global, __filename, __dirname) {
    var models = require('node_modules/api/scripts/models.js');
    var Logger = require('node_modules/logging-utils/scripts/logger.js').Logger;
    var L = Logger.forTag('RevGen:AdBreak');
    function AdBreak() {
      L.log('construct');
      models.Observable.call(this);
      this._isActive = true;
      this._adBreakInProgress = false;
      this._details = null;
    }
    SP.inherit(AdBreak, models.Observable);
    AdBreak.prototype.init = function (player) {
      this._player = player;
      if (!player) {
        throw new Error('AdBreak.init: models~Player is a required parameter');
      }
      this._listen();
    };
    AdBreak.prototype.destroy = function () {
      if (this._isActive) {
        this._isActive = false;
      }
    };
    AdBreak.prototype.inProgress = function () {
      if (this._player && this._player.track && this._player.track.advertisement) {
        return true;
      }
      return this._adBreakInProgress;
    };
    AdBreak.prototype.resume = function () {
      if (this._details) {
        L.log('request ads_resume');
        SP.request('ads_resume', []);
      } else {
        if (this._player.volume === 0) {
          this._player.setVolume(0.1);
        }
        this._player.play();
      }
    };
    AdBreak.prototype.pause = function () {
      if (this._details) {
        L.log('request ads_pause');
        SP.request('ads_pause', []);
      } else {
        this._player.pause();
      }
    };
    AdBreak.prototype.getDetails = function () {
      var details = null;
      if (this._details) {
        details = {};
        for (var k in this._details) {
          if (this._details.hasOwnProperty(k)) {
            details[k] = this._details[k];
          }
        }
      }
      return details;
    };
    AdBreak.prototype._listen = function () {
      var _this = this;
      SP.request('ads_event_wait', [], this, function (event) {
        var dispatch = false;
        L.log('event received', event.type, event);
        if (_this._isActive) {
          _this._listen();
          switch (event.type) {
          case 'ads_break_started':
            _this._adBreakInProgress = true;
            _this.dispatchEvent('startBreak');
            break;
          case 'ads_break_ended':
            _this._adBreakInProgress = false;
            _this._details = null;
            _this.dispatchEvent('endBreak');
            break;
          case 'ads_break_change':
            var received = _this._details === null || _this._details.imageUrl != event.data.params.imageUrl;
            _this._details = event.data.params;
            if (received) {
              _this.dispatchEvent('receiveDetails');
            }
            _this.dispatchEvent('updateDetails');
            break;
          }
          if (dispatch) {
          }
        }
      }, function (err) {
        L.error('error listening', err);
      });
    };
    module.exports = AdBreak;
  },
  'node_modules/api/scripts/toplists.js': function (require, module, exports, global, __filename, __dirname) {
    (function (models) {
      var Loadable = models.Loadable;
      var BridgeCollection = models.BridgeCollection;
      var Album = models.Album;
      var Artist = models.Artist;
      var Playlist = models.Playlist;
      var Track = models.Track;
      var session = models.session;
      function Toplist(request, prefix, suffix) {
        Loadable.call(this);
        this.resolve('uri', prefix + 'tracks' + suffix);
        this.resolve('albums', new BridgeCollection(Album, prefix + 'albums' + suffix, request + '_albums'));
        this.resolve('artists', new BridgeCollection(Artist, prefix + 'artists' + suffix, request + '_artists'));
        this.resolve('tracks', new BridgeCollection(Track, prefix + 'tracks' + suffix, request + '_tracks'));
        this.resolve('playlists', new BridgeCollection(Playlist, prefix + 'playlists' + suffix, request + '_playlists'));
      }
      SP.inherit(Toplist, Loadable);
      Loadable.define(Toplist, [
        'albums',
        'artists',
        'tracks',
        'playlists',
        'uri'
      ]);
      Toplist.forCurrentUser = function () {
        var prefix = session.user.uri + ':top:';
        var suffix = '';
        return new this('toplist_user', prefix, suffix);
      };
      Toplist.forUser = function (user) {
        var prefix = user.uri + ':top:';
        var suffix = '';
        return new this('toplist_user', prefix, suffix);
      };
      Toplist.forWorld = function () {
        var prefix = 'spotify:top:';
        var suffix = ':global';
        return new this('toplist_region', prefix, suffix);
      };
      Toplist.forCurrentRegion = function () {
        var prefix = 'spotify:top:';
        var suffix = ':country:USER';
        return new this('toplist_region', prefix, suffix);
      };
      Toplist.forRegion = function (region) {
        var prefix = 'spotify:top:';
        var suffix = ':country:' + region;
        return new this('toplist_region', prefix, suffix);
      };
      Toplist.forArtist = function (artist, region) {
        var prefix = artist.uri + ':top:';
        var suffix = region ? ':country:' + region : '';
        return new this('toplist_artist', prefix, suffix);
      };
      exports.Toplist = Toplist;
    }(require('node_modules/api/scripts/models.js')));
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
  'node_modules/views/scripts/utils/dnd.js': function (require, module, exports, global, __filename, __dirname) {
    function Drag() {
      this.customElementHandlers = [];
      this.hasDragSupport = !!SP.addDragHandler;
      if (this.hasDragSupport) {
        var testCustom = SP.bind(this._testCustom, this);
        var getCustomText = SP.bind(this._getCustomText, this);
        var getCustomData = SP.bind(this._getCustomData, this);
        this.addHandler(testCustom, getCustomText, getCustomData);
      }
    }
    Drag.prototype.addHandler = function (testFunc, getDataFunc, getTextFunc) {
      if (this.hasDragSupport) {
        SP.addDragHandler(testFunc, getDataFunc, getTextFunc);
      }
    };
    Drag.prototype.removeHandler = function (testFunc, getDataFunc, getTextFunc) {
      if (this.hasDragSupport) {
        SP.removeDragHandler(testFunc, getDataFunc, getTextFunc);
      }
    };
    Drag.prototype.enableForElement = function (elem, opt_getData, opt_getText) {
      var getData = opt_getData || function () {
        return { 'text/plain': elem.title || elem.textContent || '' };
      };
      var getText = opt_getText || function () {
        return elem.title || elem.textContent || '';
      };
      var index = this.customElementHandlers.push({
        getText: getText,
        getData: getData
      });
      elem.setAttribute('data-dnd-custom-index', index.toString());
      elem.setAttribute('draggable', 'true');
    };
    Drag.prototype._getCustomIndex = function (elem) {
      var dndCustomIndex = elem.getAttribute('data-dnd-custom-index');
      return dndCustomIndex !== null && dndCustomIndex !== '' ? dndCustomIndex : false;
    };
    Drag.prototype._testCustom = function (elem) {
      var dndCustomIndex = this._getCustomIndex(elem);
      if (dndCustomIndex !== false) {
        if (this.customElementHandlers[dndCustomIndex]) {
          return true;
        }
      }
      return false;
    };
    Drag.prototype._getCustomText = function (elem) {
      var dndCustomIndex = this._getCustomIndex(elem);
      return this.customElementHandlers[dndCustomIndex].getText();
    };
    Drag.prototype._getCustomData = function (elem) {
      var dndCustomIndex = this._getCustomIndex(elem);
      return this.customElementHandlers[dndCustomIndex].getData();
    };
    exports.drag = new Drag();
  },
  'node_modules/views/supported-languages.json': function (require, module, exports, global, __filename, __dirname) {
    module.exports = [
      'arb',
      'bn',
      'de',
      'en',
      'fi',
      'fr',
      'el',
      'es',
      'es-la',
      'es-419',
      'hi',
      'hu',
      'id',
      'ja',
      'ko',
      'nl',
      'pl',
      'pt-br',
      'it',
      'ro',
      'ru',
      'ta',
      'th',
      'tr',
      'zh-hant',
      'zsm'
    ];
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
  'node_modules/views/scripts/utils/touch.js': function (require, module, exports, global, __filename, __dirname) {
    (function (device, css, models) {
      var CustomEvent = window.CustomEvent || function (type, eventInitDict) {
        eventInitDict = eventInitDict || {};
        var event = document.createEvent('CustomEvent');
        if (event.initCustomEvent) {
          event.initCustomEvent(type, !!eventInitDict.bubbles, !!eventInitDict.cancelable, eventInitDict.detail);
        } else {
          event.initEvent(type, !!eventInitDict.bubbles, !!eventInitDict.cancelable);
          event.detail = eventInitDict.detail;
        }
        return event;
      };
      var hasTouch = device.mobile && device.touch;
      if (hasTouch) {
        css.importSheet('$views/css/touch.css');
      }
      var selectionCSSClass = 'sp-ios-selected';
      var hasMovedRight = false;
      var isTouchPending = false;
      var timer = 0;
      var touches = { length: 0 };
      var isScrolling = false;
      var isDown = false;
      var firstID = '';
      var firstEvent = null;
      var numHandlers = 0;
      var tapSelectionDuration = 50;
      var eventHandlerData = {
        'select': [],
        'deselect': [],
        'tap': []
      };
      function Selection() {
        var self = this;
        this._onScroll = function (event) {
          isScrolling = false;
        };
        this._onTouchStart = function (event) {
          self._onTouchEvent(event, '_handleTouchStart');
        };
        this._onTouchMove = function (event) {
          self._onTouchEvent(event, '_handleTouchMove');
        };
        this._onTouchEnd = function (event) {
          self._onTouchEvent(event, '_handleTouchEnd');
        };
      }
      Selection.prototype.on = function (eventType, element, handler) {
        var handlerData = eventHandlerData[eventType];
        if (!handlerData)
          return;
        for (var i = handlerData.length; i--;) {
          var data = handlerData[i];
          if (data.element === element && data.handler === handler) {
            return;
          }
        }
        handlerData.push({
          element: element,
          handler: handler
        });
        numHandlers++;
        if (numHandlers === 1) {
          this._attachHandlers();
        }
      };
      Selection.prototype.off = function (eventType, element, opt_handler) {
        var handlerData = eventHandlerData[eventType];
        if (!handlerData)
          return;
        for (var i = handlerData.length; i--;) {
          var data = handlerData[i];
          if (data.element === element) {
            if (!opt_handler || opt_handler && opt_handler === data.handler) {
              data.splice(i, 1);
              numHandlers--;
              if (opt_handler)
                break;
            }
          }
        }
        if (numHandlers === 0) {
          this._detachHandlers();
        }
      };
      Selection.prototype.emit = function (eventType, element, event, opt_touch) {
        SP.defer(this, function () {
          this.emitSync(eventType, element, event, opt_touch);
        });
      };
      Selection.prototype.emitSync = function (eventType, element, event, opt_touch) {
        var handlerData = eventHandlerData[eventType];
        if (!handlerData)
          return;
        for (var i = 0, l = handlerData.length; i < l; i++) {
          var data = handlerData[i];
          if (data.element === element) {
            data.handler.call(this, event, opt_touch);
          }
        }
      };
      Selection.prototype.enableForElement = function (element, opt_options) {
        var options = opt_options || {};
        var hasTapped = false;
        var delay = options.willOpenNewView ? 1000 : undefined;
        delay = options.removeDelay != null ? options.removeDelay : delay;
        this.on('select', element, function () {
          hasTapped = false;
          selectElement(element, options);
        });
        this.on('deselect', element, function () {
          setTimeout(function () {
            deselectElement(element, options);
          }, hasTapped ? delay : 0);
        });
        this.on('tap', element, function (event) {
          hasTapped = true;
          dispatchEvent(element, 'sp-tap', { touchEndObject: event });
        });
      };
      Selection.prototype.disableForElement = function (element) {
        this.off('select', element);
        this.off('deselect', element);
        this.off('tap', element);
      };
      Selection.prototype._attachHandlers = function () {
        window.addEventListener('scroll', this._onScroll, false);
        document.addEventListener('touchstart', this._onTouchStart, false);
        document.addEventListener('touchmove', this._onTouchMove, false);
        document.addEventListener('touchend', this._onTouchEnd, false);
      };
      Selection.prototype._detachHandlers = function () {
        window.removeEventListener('scroll', this._onScroll, false);
        document.removeEventListener('touchstart', this._onTouchStart, false);
        document.removeEventListener('touchmove', this._onTouchMove, false);
        document.removeEventListener('touchend', this._onTouchEnd, false);
      };
      Selection.prototype._select = function (event, touch) {
        var element = findTargetElement(event.target, 'select');
        if (!element)
          return;
        this.emit('select', element, event, touch);
      };
      Selection.prototype._deselect = function (event, touch) {
        var element = findTargetElement(event.target, 'deselect');
        if (!element)
          return;
        this.emit('deselect', element, event, touch);
      };
      Selection.prototype._tap = function (event, touch) {
        var element = findTargetElement(event.target, 'tap');
        if (!element)
          return;
        this.emit('tap', element, event, touch);
      };
      Selection.prototype._onTouchEvent = function (event, handlerName) {
        var changedTouches = event.changedTouches;
        for (var i = 0, l = changedTouches.length; i < l; i++) {
          this[handlerName](event, changedTouches[i]);
        }
      };
      Selection.prototype._handleTouchStart = function (event, touch) {
        var self = this;
        touches[touch.identifier] = {
          identifier: touch.identifier,
          pageX: touch.pageX,
          pageY: touch.pageY
        };
        touches.length++;
        if (touches.length > 1) {
          return;
        }
        if (touches.length === 1) {
          firstID = touch.identifier;
          firstEvent = event;
        }
        hasMovedRight = false;
        clearTimeout(timer);
        if (!isScrolling) {
          isTouchPending = true;
          timer = setTimeout(function () {
            isTouchPending = false;
            if (!isScrolling && !isDown) {
              isDown = true;
              self._select(event, touch);
            }
          }, 100);
        }
      };
      Selection.prototype._handleTouchMove = function (event, touch) {
        if (!isTouchPending && !isDown)
          return;
        if (isTouchPending && !isDown && touch.identifier !== firstID)
          return;
        var startTouch = touches[touch.identifier];
        if (!startTouch)
          return;
        if (!hasMovedRight) {
          hasMovedRight = touch.pageX > startTouch.pageX;
        }
        var isWithinX = !hasMovedRight;
        var isWithinY = Math.abs(touch.pageY - startTouch.pageY) <= 7;
        if (!isWithinX || !isWithinY) {
          if (!isWithinY && !hasMovedRight) {
            isScrolling = true;
          }
          isTouchPending = false;
          if (isDown) {
            isDown = false;
            this._deselect(firstEvent, touch);
          }
        }
      };
      Selection.prototype._handleTouchEnd = function (event, touch) {
        var id = touch.identifier;
        if (id in touches) {
          touches.length--;
          delete touches[id];
        }
        if (id !== firstID)
          return;
        var self = this;
        var removeDelay = isTouchPending ? tapSelectionDuration : 0;
        clearTimeout(timer);
        if (isScrolling || !isTouchPending && !isDown) {
          isDown = false;
          return;
        }
        isDown = false;
        if (isTouchPending) {
          isTouchPending = false;
          this._select(event, touch);
        }
        setTimeout(function () {
          self._tap(event, touch);
          self._deselect(event, touch);
        }, removeDelay);
      };
      function findTargetElement(element, eventType) {
        var handlerData = eventHandlerData[eventType];
        for (var i = 0, l = handlerData.length; i < l; i++) {
          var handlerElement = handlerData[i].element;
          var elem = element;
          while (elem) {
            if (elem === handlerElement)
              return elem;
            elem = elem.parentNode;
          }
        }
        return null;
      }
      function dispatchEvent(element, eventName, opt_detail) {
        element.dispatchEvent(new CustomEvent(eventName, { detail: opt_detail || {} }));
      }
      function selectElement(element, options) {
        css.addClass(element, selectionCSSClass);
        if (options.selectedClassName) {
          css.addClass(element, options.selectedClassName);
        }
      }
      function deselectElement(element, options) {
        css.removeClass(element, selectionCSSClass);
        if (options.selectedClassName) {
          css.removeClass(element, options.selectedClassName);
        }
      }
      exports.selection = new Selection();
    }(require('node_modules/views/scripts/utils/device.js'), require('node_modules/views/scripts/utils/css.js'), require('node_modules/api/scripts/models.js')));
  },
  'node_modules/mout/lang/kindOf.js': function (require, module, exports, global, __filename, __dirname) {
    var _rKind = /^\[object (.*)\]$/, _toString = Object.prototype.toString, UNDEF;
    function kindOf(val) {
      if (val === null) {
        return 'Null';
      } else if (val === UNDEF) {
        return 'Undefined';
      } else {
        return _rKind.exec(_toString.call(val))[1];
      }
    }
    module.exports = kindOf;
  },
  'node_modules/mout/lang/isPlainObject.js': function (require, module, exports, global, __filename, __dirname) {
    function isPlainObject(value) {
      return !!value && typeof value === 'object' && value.constructor === Object;
    }
    module.exports = isPlainObject;
  },
  'node_modules/mout/array/forEach.js': function (require, module, exports, global, __filename, __dirname) {
    function forEach(arr, callback, thisObj) {
      if (arr == null) {
        return;
      }
      var i = -1, len = arr.length;
      while (++i < len) {
        if (callback.call(thisObj, arr[i], i, arr) === false) {
          break;
        }
      }
    }
    module.exports = forEach;
  },
  'node_modules/mout/array/append.js': function (require, module, exports, global, __filename, __dirname) {
    function append(arr1, arr2) {
      if (arr2 == null) {
        return arr1;
      }
      var pad = arr1.length, i = -1, len = arr2.length;
      while (++i < len) {
        arr1[pad + i] = arr2[i];
      }
      return arr1;
    }
    module.exports = append;
  },
  'node_modules/mout/array/slice.js': function (require, module, exports, global, __filename, __dirname) {
    function slice(arr, start, end) {
      var len = arr.length;
      if (start == null) {
        start = 0;
      } else if (start < 0) {
        start = Math.max(len + start, 0);
      } else {
        start = Math.min(start, len);
      }
      if (end == null) {
        end = len;
      } else if (end < 0) {
        end = Math.max(len + end, 0);
      } else {
        end = Math.min(end, len);
      }
      var result = [];
      while (start < end) {
        result.push(arr[start++]);
      }
      return result;
    }
    module.exports = slice;
  },
  'node_modules/mout/function/bind.js': function (require, module, exports, global, __filename, __dirname) {
    var slice = require('node_modules/mout/array/slice.js');
    function bind(fn, context, args) {
      var argsArr = slice(arguments, 2);
      return function () {
        return fn.apply(context, argsArr.concat(slice(arguments)));
      };
    }
    module.exports = bind;
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
  'node_modules/views/scripts/popup.js': function (require, module, exports, global, __filename, __dirname) {
    (function (Observable, device) {
      function Popup(width, height, optionsOrClassName) {
        Observable.call(this);
        this.width = width;
        this.height = height;
        var options = typeof optionsOrClassName === 'object' ? optionsOrClassName : typeof optionsOrClassName === 'string' ? { className: optionsOrClassName } : {};
        this.glue = !!options.glue;
        if (this.glue) {
          this.cssClass = options.className ? 'tooltip ' + options.className : 'tooltip';
        } else {
          this.cssClass = options.className ? 'sp-popup ' + options.className : 'sp-popup';
        }
        this.hideOnClick = options.hideOnClick !== undefined ? options.hideOnClick : true;
        var self = this;
        window.addEventListener('blur', function (evt) {
          self.hide();
        }, false);
      }
      SP.inherit(Popup, Observable);
      Popup.withContent = function (content, width, height, optionsOrClassName) {
        var popup = new Popup(width, height, optionsOrClassName);
        popup.setContent(content);
        return popup;
      };
      Popup.withText = function (text, optionsOrClassName) {
        var options = typeof optionsOrClassName === 'object' ? optionsOrClassName : typeof optionsOrClassName === 'string' ? { className: optionsOrClassName } : {};
        if (!options.glue) {
          options.className = options.className ? 'sp-text ' + options.className : 'sp-text';
        } else {
          options.className = options.className ? 'text ' + options.className : 'text';
        }
        var popup = new Popup(0, 0, options);
        popup.setText(text);
        return popup;
      };
      Popup.prototype._update = function () {
        if (!this.attachedTo)
          return;
        var arrowWidth = 6, padding = 10, minimumOverlap = 25, border = 2;
        var node = this.getNode();
        node.style.width = this.width !== 0 ? this.width + 'px' : 'auto';
        node.style.height = this.height !== 0 ? this.height + 'px' : 'auto';
        var popup = node.getBoundingClientRect();
        var target = this.attachedTo.getBoundingClientRect();
        var midX = (target.left + target.right) / 2, midY = (target.top + target.bottom) / 2;
        var arrow = this._arrowNode, arrowBorder = this._arrowNode.border, arrowSolid = this._arrowNode.solid;
        var x, y;
        var fitsVertical = Math.min(_viewportWidth - target.left, target.right) > minimumOverlap + padding, fitsAbove = target.top > popup.height + padding, fitsBelow = _viewportHeight - target.bottom > popup.height + padding;
        if (fitsVertical && (fitsBelow || fitsAbove)) {
          x = midX - popup.width / 2;
          var min = Math.max(padding, target.left - popup.width + minimumOverlap), max = Math.min(_viewportWidth - popup.width - padding, target.right - minimumOverlap);
          if (x > max)
            x = max;
          if (x < min)
            x = min;
          var arrowX;
          if (arrowWidth + (minimumOverlap - padding) * 2 > popup.width) {
            arrowX = (popup.width - arrowWidth) / 2;
          } else {
            arrowX = midX - x - border;
            if (arrowX < minimumOverlap - padding) {
              arrowX = minimumOverlap - padding;
            } else if (arrowX > popup.width - minimumOverlap + padding) {
              arrowX = popup.width - minimumOverlap + padding;
            }
          }
          if (!this.glue) {
            arrowBorder.style.left = arrowSolid.style.left = Math.floor(arrowX) + 'px';
            arrowBorder.style.top = arrowSolid.style.top = null;
          } else {
            arrow.style.left = Math.floor(arrowX) + 'px';
            arrow.style.top = null;
          }
          if ((_viewportHeight - target.bottom > target.top || !fitsAbove) && fitsBelow) {
            y = target.bottom + padding + border;
            node.className = this.cssClass + (this.glue ? ' bottom' : ' sp-popup-below');
          } else {
            y = target.top - padding - popup.height - border;
            node.className = this.cssClass + (this.glue ? ' top' : ' sp-popup-above');
          }
        } else {
          y = midY - popup.height / 2;
          var min = Math.max(padding, target.top - popup.height + minimumOverlap), max = Math.min(_viewportHeight - popup.height - padding, target.bottom - minimumOverlap);
          if (y > max)
            y = max;
          if (y < min)
            y = min;
          var arrowY;
          if (arrowWidth + (minimumOverlap - padding) * 2 > popup.height) {
            arrowY = (popup.height - arrowWidth) / 2;
          } else {
            arrowY = midY - y - border;
            if (arrowY < minimumOverlap - padding) {
              arrowY = minimumOverlap - padding;
            } else if (arrowY > popup.height - minimumOverlap + padding) {
              arrowY = popup.height - minimumOverlap + padding;
            }
          }
          if (!this.glue) {
            arrowBorder.style.top = arrowSolid.style.top = Math.floor(arrowY) + 'px';
            arrowBorder.style.left = arrowSolid.style.left = null;
          } else {
            arrow.style.top = Math.floor(arrowY) + 'px';
            arrow.style.left = null;
          }
          var fitsLeft = target.left > popup.width + padding, fitsRight = _viewportWidth - target.right > popup.width + padding;
          if ((_viewportWidth - target.right > target.left || !fitsLeft) && fitsRight) {
            x = target.right + padding + border;
            node.className = this.cssClass + (this.glue ? ' right' : ' sp-popup-right');
          } else if (fitsLeft) {
            x = target.left - padding - popup.width - border;
            node.className = this.cssClass + (this.glue ? ' left' : ' sp-popup-left');
          } else {
            x = 0;
            node.className = this.cssClass;
          }
        }
        node.style.left = Math.ceil(_scrollX + x) + 'px';
        node.style.top = Math.ceil(_scrollY + y) + 'px';
      };
      Popup.prototype.getNode = function () {
        if (this._node)
          return this._node;
        var node = document.createElement('div');
        node.className = this.cssClass;
        node.style.visibility = 'hidden';
        var arrow, arrowBorder, arrowSolid;
        if (this.glue) {
          arrow = document.createElement('span');
          arrow.className = 'tooltip-arrow';
          node.appendChild(arrow);
        } else {
          arrowBorder = document.createElement('div');
          arrowBorder.className = 'sp-arrow-border';
          node.appendChild(arrowBorder);
          arrowSolid = document.createElement('div');
          arrowSolid.className = 'sp-arrow-solid';
          node.appendChild(arrowSolid);
        }
        if (this.content) {
          this.content.className = this.glue ? this.content.className + ' tooltip-inner' : this.content.className;
          node.appendChild(this.content);
        }
        this._node = node;
        this._arrowNode = this.glue ? arrow : {
          solid: arrowSolid,
          border: arrowBorder
        };
        return node;
      };
      Popup.prototype.hide = function (opt_delay) {
        if (!this.attachedTo)
          return;
        if (opt_delay) {
          if (this._hideTimeout && this._hideTimeoutTime - +new Date() > opt_delay + 50) {
            clearTimeout(this._hideTimeout);
          } else if (this._hideTimeout) {
            return;
          }
          var self = this;
          this._hideTimeout = setTimeout(function () {
            self.hide();
          }, opt_delay);
          this._hideTimeoutTime = +new Date() + opt_delay;
          return;
        }
        if (this._hideTimeout) {
          clearTimeout(this._hideTimeout);
          delete this._hideTimeout;
          delete this._hideTimeoutTime;
        }
        if (this.hideOnClick)
          document.removeEventListener('mousedown', this._clickToHideHandler, true);
        if (this._isInDOM) {
          this._isInDOM = false;
          this._node.parentNode.removeChild(this._node);
        }
        this._node.style.visibility = 'hidden';
        delete this.attachedTo;
        _unregister(this);
      };
      Popup.prototype.dispose = function () {
        _unregister(this);
        if (this._clickToHideHandler) {
          document.removeEventListener('mousedown', this._clickToHideHandler, true);
          delete this._clickToHideHandler;
        }
        if (this.content && this.content.parentNode == this._node) {
          this._node.removeChild(this.content);
        }
        if (this._node && this._node.parentNode) {
          this._node.parentNode.removeChild(this._node);
        }
        if (this._hideTimeout) {
          clearTimeout(this._hideTimeout);
          delete this._hideTimeout;
          delete this._hideTimeoutTime;
        }
        delete this.attachedTo;
        delete this.content;
        delete this._node;
        delete this._arrowNode;
        delete this._textContainer;
      };
      Popup.prototype.resize = function (width, height) {
        this.width = width;
        this.height = height;
        this._update();
      };
      Popup.prototype.setContent = function (content, opt_width, opt_height) {
        if (content == this.content)
          return;
        if (this.content) {
          this._node.removeChild(this.content);
        }
        this.content = content;
        if (this._node) {
          this.content.className = this.glue ? this.content.className + ' tooltip-inner' : this.content.className;
          this._node.appendChild(content);
        }
        if (opt_width && opt_height) {
          this.resize(opt_width, opt_height);
        }
      };
      Popup.prototype.setText = function (text, opt_maxWidth) {
        var container = this._textContainer;
        if (!container) {
          container = document.createElement('span');
          this._textContainer = container;
        }
        container.textContent = text;
        var node = this.getNode();
        node.style.width = (opt_maxWidth || 200) + 'px';
        this.setContent(container);
        var rect;
        if (!node.parentNode) {
          document.body.appendChild(node);
          rect = container.getBoundingClientRect();
          document.body.removeChild(node);
        }
        rect = rect || container.getBoundingClientRect();
        if (!this.glue) {
          this.resize(Math.ceil(rect.width), Math.ceil(rect.height));
        }
      };
      Popup.prototype.showFor = function (attachTo) {
        if (attachTo == this.attachedTo) {
          if (this._hideTimeout) {
            clearTimeout(this._hideTimeout);
            delete this._hideTimeout;
            delete this._hideTimeoutTime;
          }
          return;
        }
        var node = this.getNode();
        if (this.attachedTo)
          this.hide();
        this.attachedTo = attachTo;
        document.body.appendChild(node);
        this._isInDOM = true;
        _register(this);
        this._update();
        node.style.visibility = 'visible';
        var self = this;
        if (this.hideOnClick && !this._clickToHideHandler) {
          this._clickToHideHandler = function (evt) {
            var t = evt.target, inside = false;
            while (t) {
              if (t == self._node) {
                inside = true;
                break;
              }
              t = t.parentNode;
            }
            if (!inside) {
              self.dispatchEvent('hiddenOnClick');
              self.hide();
            }
          };
        }
        if (this.hideOnClick && !this._clickLinkHandler) {
          this._clickLinkHandler = function (evt) {
            var t = evt.target, isLink = false;
            while (t && t !== document) {
              if (t == self._node) {
                break;
              }
              if (t.getAttribute('href')) {
                isLink = true;
              }
              t = t.parentNode;
            }
            if (isLink) {
              self.dispatchEvent('hiddenOnClick');
              self.hide();
            }
          };
        }
        if (this.hideOnClick) {
          setTimeout(function () {
            if (!self._node.parentNode)
              return;
            document.addEventListener('mousedown', self._clickToHideHandler, true);
            document.addEventListener('click', self._clickLinkHandler, true);
          }, 0);
        }
      };
      var _popups = [];
      function _register(popup) {
        if (_popups.indexOf(popup) >= 0)
          return;
        if (!_popups.length) {
          _viewportHandler();
          window.addEventListener('resize', _viewportHandler);
          window.addEventListener('scroll', _viewportHandler);
        }
        _popups.push(popup);
      }
      function _unregister(popup) {
        var index = _popups.indexOf(popup);
        if (index >= 0) {
          _popups.splice(index, 1);
          if (!_popups.length) {
            window.removeEventListener('resize', _viewportHandler);
            window.removeEventListener('scroll', _viewportHandler);
          }
        }
      }
      var _viewportWidth, _viewportHeight, _scrollX, _scrollY;
      function _viewportHandler() {
        var root = document.documentElement;
        _viewportWidth = root.clientWidth;
        _viewportHeight = root.clientHeight;
        _scrollX = window.pageXOffset || root.scrollLeft;
        _scrollY = window.pageYOffset || root.scrollTop;
        for (var i = 0; i < _popups.length; i++) {
          _popups[i]._update();
        }
      }
      exports.Popup = Popup;
    }(require('node_modules/api/scripts/models.js').Observable, require('node_modules/views/scripts/utils/device.js')));
  },
  'node_modules/views/scripts/utils/logger.js': function (require, module, exports, global, __filename, __dirname) {
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
        var logOutputGobalOverride = null;
        if (logOutputGobalOverride) {
          this.logOutputLevel = logOutputGobalOverride;
        } else if (logOutputLevel === undefined || logOutputLevel < Logger.OUTPUT_LEVEL.NONE || logOutputLevel > Logger.OUTPUT_LEVEL.DEBUG) {
          var suffix = 'spotify.net';
          var hostname = window.location.hostname;
          if (hostname.indexOf(suffix, hostname.length - suffix.length) !== -1) {
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
        if (typeof data == 'string' || typeof data == 'number' || typeof data == 'boolean') {
          return { data: data };
        }
        if (!data) {
          return {};
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
  'node_modules/views/scripts/utils/frame.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var requestFrame = window.requestAnimationFrame || window.webkitRequestAnimationFrame || window.mozRequestAnimationFrame || window.oRequestAnimationFrame || window.msRequestAnimationFrame || function (callback) {
      return setTimeout(callback, 1000 / 60);
    };
    var callbacks = [];
    var iterator = function (time) {
      if (time == null)
        time = +new Date();
      var split = callbacks.splice(0, callbacks.length);
      for (var i = 0, l = split.length; i < l; i++)
        split[i](time);
    };
    var request = function (callback) {
      if (callbacks.push(callback) === 1)
        requestFrame.call(window, iterator);
    };
    var cancel = function (match) {
      var io = callbacks.indexOf(match);
      if (io > -1)
        callbacks.splice(io, 1);
    };
    var Queue = function () {
      this.list = [];
    };
    Queue.prototype.push = function (fn, ctx) {
      return add.call(this, 'push', fn, ctx);
    };
    Queue.prototype.unshift = function (fn, ctx) {
      return add.call(this, 'unshift', fn, ctx);
    };
    Queue.prototype.count = function () {
      return this.list.length;
    };
    var add = function (how, fn, ctx) {
      var list = this.list;
      var bound = function () {
        return fn.apply(ctx, arguments);
      };
      var next = function () {
        var nextItem = list.shift();
        if (nextItem)
          nextItem();
        if (list.length)
          request(next);
      };
      if (list[how](bound) === 1)
        request(next);
      return function () {
        var io = list.indexOf(bound);
        if (io > -1)
          list.splice(io, 1);
      };
    };
    var throttle = function (fn, ctx) {
      var queued = false;
      var args;
      return function () {
        args = arguments;
        if (!queued) {
          queued = true;
          request(function () {
            queued = false;
            fn.apply(ctx, args);
          });
        }
      };
    };
    exports.throttle = throttle;
    exports.request = request;
    exports.cancel = cancel;
    exports.Queue = Queue;
  },
  'node_modules/views/arb.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/arb.loc/strings/image.lang', {
      'Starred': 'Starred',
      'Toplist': 'Top tracks'
    });
  },
  'node_modules/views/bn.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/bn.loc/strings/image.lang', {
      'Starred': 'Starred',
      'Toplist': 'Top tracks'
    });
  },
  'node_modules/views/de.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/de.loc/strings/image.lang', {
      'Starred': 'Starred',
      'Toplist': 'Top-Titel'
    });
  },
  'node_modules/views/en.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/en.loc/strings/image.lang', {
      'Starred': 'Starred',
      'Toplist': 'Top tracks'
    });
  },
  'node_modules/views/fi.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/fi.loc/strings/image.lang', {
      'Starred': 'T\xE4hdell\xE4 merkityt',
      'Toplist': 'Soitetuimmat kappaleet'
    });
  },
  'node_modules/views/fr.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/fr.loc/strings/image.lang', {
      'Starred': 'S\xE9lection',
      'Toplist': 'Top titres'
    });
  },
  'node_modules/views/el.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/el.loc/strings/image.lang', {
      'Starred': '\u0391\u03B3\u03B1\u03C0\u03B7\u03BC\u03AD\u03BD\u03B1',
      'Toplist': '\u039A\u03BF\u03C1\u03C5\u03C6\u03B1\u03AF\u03B1 \u03C4\u03C1\u03B1\u03B3\u03BF\u03CD\u03B4\u03B9\u03B1'
    });
  },
  'node_modules/views/es.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/es.loc/strings/image.lang', {
      'Starred': 'Favoritos',
      'Toplist': 'Canciones m\xE1s escuchadas'
    });
  },
  'node_modules/views/es-la.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/es-la.loc/strings/image.lang', {
      'Starred': 'Seleccionadas',
      'Toplist': 'Canciones favoritas'
    });
  },
  'node_modules/views/es-419.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/es-419.loc/strings/image.lang', {
      'Starred': 'Seleccionadas',
      'Toplist': 'Canciones favoritas'
    });
  },
  'node_modules/views/hi.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/hi.loc/strings/image.lang', {
      'Starred': 'Starred',
      'Toplist': 'Top tracks'
    });
  },
  'node_modules/views/hu.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/hu.loc/strings/image.lang', {
      'Starred': 'Megcsillagozott',
      'Toplist': 'N\xE9pszer\u0171 dalok'
    });
  },
  'node_modules/views/id.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/id.loc/strings/image.lang', {
      'Starred': 'Diberi bintang',
      'Toplist': 'Lagu teratas'
    });
  },
  'node_modules/views/ja.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/ja.loc/strings/image.lang', {
      'Starred': '\u30B9\u30BF\u30FC',
      'Toplist': '\u30C8\u30C3\u30D7\u66F2'
    });
  },
  'node_modules/views/ko.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/ko.loc/strings/image.lang', {
      'Starred': 'Starred',
      'Toplist': 'Top tracks'
    });
  },
  'node_modules/views/nl.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/nl.loc/strings/image.lang', {
      'Starred': 'Favorieten',
      'Toplist': 'Topnummers'
    });
  },
  'node_modules/views/pl.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/pl.loc/strings/image.lang', {
      'Starred': 'Oznaczone gwiazdk\u0105',
      'Toplist': 'Najlepsze utwory'
    });
  },
  'node_modules/views/pt-br.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/pt-br.loc/strings/image.lang', {
      'Starred': 'Favoritos',
      'Toplist': 'As mais tocadas'
    });
  },
  'node_modules/views/it.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/it.loc/strings/image.lang', {
      'Starred': 'Preferiti',
      'Toplist': 'Brani top'
    });
  },
  'node_modules/views/ro.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/ro.loc/strings/image.lang', {
      'Starred': 'Marcat cu stea',
      'Toplist': 'Melodii de top'
    });
  },
  'node_modules/views/ru.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/ru.loc/strings/image.lang', {
      'Starred': '\u0418\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0435',
      'Toplist': '\u041B\u0443\u0447\u0448\u0438\u0435 \u0442\u0440\u0435\u043A\u0438'
    });
  },
  'node_modules/views/ta.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/ta.loc/strings/image.lang', {
      'Starred': 'Starred',
      'Toplist': 'Top tracks'
    });
  },
  'node_modules/views/th.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/th.loc/strings/image.lang', {
      'Starred': '\u0E43\u0E2B\u0E49\u0E04\u0E30\u0E41\u0E19\u0E19\u0E41\u0E25\u0E49\u0E27',
      'Toplist': '\u0E41\u0E17\u0E23\u0E47\u0E01\u0E2D\u0E31\u0E19\u0E14\u0E31\u0E1A\u0E15\u0E49\u0E19\u0E46'
    });
  },
  'node_modules/views/tr.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/tr.loc/strings/image.lang', {
      'Starred': 'Y\u0131ld\u0131zl\u0131lar',
      'Toplist': 'En \xE7ok dinlenen par\xE7alar'
    });
  },
  'node_modules/views/zh-hant.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/zh-hant.loc/strings/image.lang', {
      'Starred': '\u5DF2\u661F\u8A55',
      'Toplist': '\u7576\u7D05\u6B4C\u66F2'
    });
  },
  'node_modules/views/zsm.loc/strings/image.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/zsm.loc/strings/image.lang', {
      'Starred': 'Dibintangkan',
      'Toplist': 'Lagu paling popular'
    });
  },
  'node_modules/views/arb.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/arb.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'Follow',
      'ButtonSubscribeArtist': 'Follow Artist',
      'ButtonSubscribePlaylist': 'Follow Playlist',
      'ButtonSubscribeUser': 'Follow User',
      'ButtonSubscribed': 'Following',
      'ButtonSubscribedArtist': 'Following Artist',
      'ButtonSubscribedPlaylist': 'Following Playlist',
      'ButtonSubscribedUser': 'Following User',
      'ButtonUnsubscribe': 'Unfollow',
      'ButtonUnsubscribeArtist': 'Unfollow Artist',
      'ButtonUnsubscribePlaylist': 'Unfollow Playlist',
      'ButtonUnsubscribeUser': 'Unfollow User',
      'ButtonShare': 'Share\u2026',
      'ButtonStartRadio': 'Start Radio',
      'PopupPlaylistSubscribeCancel': 'No',
      'PopupPlaylistSubscribeConfirm': 'Okay',
      'PopupPlaylistSubscribeLine1': 'You\'re now also following {0} because you followed this playlist.',
      'PopupPlaylistSubscribeLine2': 'Continue to follow this user?',
      'PopupPlaylistSuggestFollow': '{0} created this playlist. To {2} more music from {1}, just hit {3}.',
      'PopupAviciiAutoFollow': 'You are now following Avicii because you followed this playlist. Keep following Avicii to get notified about future releases!',
      'DiscoverAppName': 'Discover',
      'Followers': 'Followers',
      'SaveToYourMusic': 'Save',
      'RemoveFromYourMusic': 'Remove',
      'SavedToYourMusic': 'Saved',
      'User': 'User',
      'Artist': 'Artist',
      'Album': 'Album',
      'Playlist': 'Playlist'
    });
  },
  'node_modules/views/bn.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/bn.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'Follow',
      'ButtonSubscribeArtist': 'Follow Artist',
      'ButtonSubscribePlaylist': 'Follow Playlist',
      'ButtonSubscribeUser': 'Follow User',
      'ButtonSubscribed': 'Following',
      'ButtonSubscribedArtist': 'Following Artist',
      'ButtonSubscribedPlaylist': 'Following Playlist',
      'ButtonSubscribedUser': 'Following User',
      'ButtonUnsubscribe': 'Unfollow',
      'ButtonUnsubscribeArtist': 'Unfollow Artist',
      'ButtonUnsubscribePlaylist': 'Unfollow Playlist',
      'ButtonUnsubscribeUser': 'Unfollow User',
      'ButtonShare': 'Share\u2026',
      'ButtonStartRadio': 'Start Radio',
      'PopupPlaylistSubscribeCancel': 'No',
      'PopupPlaylistSubscribeConfirm': 'Okay',
      'PopupPlaylistSubscribeLine1': 'You\'re now also following {0} because you followed this playlist.',
      'PopupPlaylistSubscribeLine2': 'Continue to follow this user?',
      'PopupPlaylistSuggestFollow': '{0} created this playlist. To {2} more music from {1}, just hit {3}.',
      'PopupAviciiAutoFollow': 'You are now following Avicii because you followed this playlist. Keep following Avicii to get notified about future releases!',
      'DiscoverAppName': 'Discover',
      'Followers': 'Followers',
      'SaveToYourMusic': 'Save',
      'RemoveFromYourMusic': 'Remove',
      'SavedToYourMusic': 'Saved',
      'User': 'User',
      'Artist': 'Artist',
      'Album': 'Album',
      'Playlist': 'Playlist'
    });
  },
  'node_modules/views/de.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/de.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'Folgen',
      'ButtonSubscribeArtist': 'K\xFCnstler folgen',
      'ButtonSubscribePlaylist': 'Playlist folgen',
      'ButtonSubscribeUser': 'Benutzer folgen',
      'ButtonSubscribed': 'Folge ich',
      'ButtonSubscribedArtist': 'Du folgst diesem K\xFCnstler',
      'ButtonSubscribedPlaylist': 'Folge Playlist ',
      'ButtonSubscribedUser': 'Folge Benutzer',
      'ButtonUnsubscribe': 'Nicht folgen',
      'ButtonUnsubscribeArtist': 'K\xFCnstler nicht mehr folgen',
      'ButtonUnsubscribePlaylist': 'Playlist nicht mehr folgen',
      'ButtonUnsubscribeUser': 'Benutzer nicht mehr folgen',
      'ButtonShare': 'Teilen\u2026',
      'ButtonStartRadio': 'Radio starten',
      'PopupPlaylistSubscribeCancel': 'Nein',
      'PopupPlaylistSubscribeConfirm': 'OK',
      'PopupPlaylistSubscribeLine1': 'Da du dieser Playlist folgst, folgst du jetzt auch {0}.',
      'PopupPlaylistSubscribeLine2': 'Diesem Benutzer weiterhin folgen?',
      'PopupPlaylistSuggestFollow': '{0} hat diese Playlist erstellt. F\xFCr mehr Musik von {1}, hol dir {2} zu Hilfe und klick einfach {3}.',
      'PopupAviciiAutoFollow': 'Du folgst Avicii, weil du dieser Playlist folgst. Wenn du Avicii weiter folgst, bekommst du automatische Benachrichtigungen, sobald er etwas Neues releaset!',
      'DiscoverAppName': 'Entdecken',
      'Followers': 'Followers',
      'SaveToYourMusic': 'Speichern',
      'RemoveFromYourMusic': 'Entfernen',
      'SavedToYourMusic': 'Gespeichert',
      'User': 'Benutzer',
      'Artist': 'K\xFCnstler',
      'Album': 'Album',
      'Playlist': 'Playlist'
    });
  },
  'node_modules/views/en.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/en.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'Follow',
      'ButtonSubscribeArtist': 'Follow Artist',
      'ButtonSubscribePlaylist': 'Follow Playlist',
      'ButtonSubscribeUser': 'Follow User',
      'ButtonSubscribed': 'Following',
      'ButtonSubscribedArtist': 'Following Artist',
      'ButtonSubscribedPlaylist': 'Following Playlist',
      'ButtonSubscribedUser': 'Following User',
      'ButtonUnsubscribe': 'Unfollow',
      'ButtonUnsubscribeArtist': 'Unfollow Artist',
      'ButtonUnsubscribePlaylist': 'Unfollow Playlist',
      'ButtonUnsubscribeUser': 'Unfollow User',
      'ButtonShare': 'Share\u2026',
      'ButtonStartRadio': 'Start Radio',
      'PopupPlaylistSubscribeCancel': 'No',
      'PopupPlaylistSubscribeConfirm': 'Okay',
      'PopupPlaylistSubscribeLine1': 'You\'re now also following {0} because you followed this playlist.',
      'PopupPlaylistSubscribeLine2': 'Continue to follow this user?',
      'PopupPlaylistSuggestFollow': '{0} created this playlist. To {2} more music from {1}, just hit {3}.',
      'PopupAviciiAutoFollow': 'You are now following Avicii because you followed this playlist. Keep following Avicii to get notified about future releases!',
      'DiscoverAppName': 'Discover',
      'Followers': 'Followers',
      'SaveToYourMusic': 'Save',
      'RemoveFromYourMusic': 'Remove',
      'SavedToYourMusic': 'Saved',
      'User': 'User',
      'Artist': 'Artist',
      'Album': 'Album',
      'Playlist': 'Playlist'
    });
  },
  'node_modules/views/fi.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/fi.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'Seuraa',
      'ButtonSubscribeArtist': 'Seuraa artistia',
      'ButtonSubscribePlaylist': 'Seuraa soittolistaa',
      'ButtonSubscribeUser': 'Seuraa k\xE4ytt\xE4j\xE4\xE4',
      'ButtonSubscribed': 'Seuratut',
      'ButtonSubscribedArtist': 'Seurattava artisti',
      'ButtonSubscribedPlaylist': 'Seurattava soittolista',
      'ButtonSubscribedUser': 'Seurattava k\xE4ytt\xE4j\xE4',
      'ButtonUnsubscribe': 'Lopeta seuraaminen',
      'ButtonUnsubscribeArtist': 'Lopeta artistin seuraaminen',
      'ButtonUnsubscribePlaylist': 'Lopeta soittolistan seuraaminen',
      'ButtonUnsubscribeUser': 'Lopeta k\xE4ytt\xE4j\xE4n seuraaminen',
      'ButtonShare': 'Jaa...',
      'ButtonStartRadio': 'K\xE4ynnist\xE4 radio',
      'PopupPlaylistSubscribeCancel': 'EI',
      'PopupPlaylistSubscribeConfirm': 'OK',
      'PopupPlaylistSubscribeLine1': 'Seuraat nyt my\xF6s kohdetta {0}, koska seuraat t\xE4t\xE4 soittolistaa. ',
      'PopupPlaylistSubscribeLine2': 'Jatketaanko t\xE4m\xE4n k\xE4ytt\xE4j\xE4n seuraamista?',
      'PopupPlaylistSuggestFollow': '{0} loi t\xE4m\xE4n soittolistan. Jos haluat {2} lis\xE4\xE4 musiikkia kohteesta {1}, valitse {3}.',
      'PopupAviciiAutoFollow': 'Seuraat nyt Aviciita, koska seurasit t\xE4t\xE4 soittolistaa. Jatka Aviciin seuraamista, niin saat tietoja tulevista julkaisuista!',
      'DiscoverAppName': 'L\xF6yd\xE4',
      'Followers': 'Seuraajat',
      'SaveToYourMusic': 'Tallenna',
      'RemoveFromYourMusic': 'Poista',
      'SavedToYourMusic': 'Tallennettu',
      'User': 'K\xE4ytt\xE4j\xE4',
      'Artist': 'Artisti',
      'Album': 'Albumi',
      'Playlist': 'Soittolista'
    });
  },
  'node_modules/views/fr.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/fr.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'Suivre',
      'ButtonSubscribeArtist': 'Suivre l\'artiste',
      'ButtonSubscribePlaylist': 'Suivre la playlist',
      'ButtonSubscribeUser': 'Suivre l\'utilisateur',
      'ButtonSubscribed': 'Suivi',
      'ButtonSubscribedArtist': 'Artiste suivi',
      'ButtonSubscribedPlaylist': 'Playlist suivie',
      'ButtonSubscribedUser': 'Utilisateur suivi',
      'ButtonUnsubscribe': 'Ne plus suivre',
      'ButtonUnsubscribeArtist': 'Ne plus suivre l\'artiste',
      'ButtonUnsubscribePlaylist': 'Ne plus suivre la playlist',
      'ButtonUnsubscribeUser': 'Ne plus suivre l\'utilisateur',
      'ButtonShare': 'Partager...',
      'ButtonStartRadio': 'Lancer la radio',
      'PopupPlaylistSubscribeCancel': 'Non',
      'PopupPlaylistSubscribeConfirm': 'Oui',
      'PopupPlaylistSubscribeLine1': 'Vous suivez maintenant {0} car vous suivez cette playlist.',
      'PopupPlaylistSubscribeLine2': 'Continuer \xE0 suivre cet utilisateur\xA0?',
      'PopupPlaylistSuggestFollow': '{0} a cr\xE9\xE9 cette playlist. Pour {2} plus de musique de {1}, cliquez sur {3}.',
      'PopupAviciiAutoFollow': 'Vous suivez maintenant Avicii car vous suivez cette playlist. Continuez de le suivre pour rester inform\xE9 de ses nouveaut\xE9s\xA0!',
      'DiscoverAppName': 'D\xE9couvrir',
      'Followers': 'Abonn\xE9s',
      'SaveToYourMusic': 'Enregistrer',
      'RemoveFromYourMusic': 'Supprimer',
      'SavedToYourMusic': 'Enregistr\xE9',
      'User': 'Utilisateur',
      'Artist': 'Artiste',
      'Album': 'Album',
      'Playlist': 'Playlist'
    });
  },
  'node_modules/views/el.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/el.loc/strings/buttons.lang', {
      'ButtonSubscribe': '\u0391\u03BA\u03BF\u03BB\u03BF\u03CD\u03B8\u03B7\u03C3\u03B5',
      'ButtonSubscribeArtist': '\u0391\u03BA\u03BF\u03BB\u03BF\u03CD\u03B8\u03B7\u03C3\u03B5 \u03BA\u03B1\u03BB\u03BB\u03B9\u03C4\u03AD\u03C7\u03BD\u03B7',
      'ButtonSubscribePlaylist': '\u0391\u03BA\u03BF\u03BB\u03BF\u03CD\u03B8\u03B7\u03C3\u03B5 \u03BB\u03AF\u03C3\u03C4\u03B1',
      'ButtonSubscribeUser': 'A\u03BA\u03BF\u03BB\u03BF\u03CD\u03B8\u03B7\u03C3\u03B7 \u03C7\u03C1\u03AE\u03C3\u03C4\u03B7',
      'ButtonSubscribed': '\u0386\u03C4\u03BF\u03BC\u03B1 \u03C0\u03BF\u03C5 \u03B1\u03BA\u03BF\u03BB\u03BF\u03C5\u03B8\u03BF\u03CD\u03BD\u03C4\u03B1\u03B9',
      'ButtonSubscribedArtist': '\u039A\u03B1\u03BB\u03BB\u03B9\u03C4\u03AD\u03C7\u03BD\u03B7\u03C2 \u03C0\u03BF\u03C5 \u03B1\u03BA\u03BF\u03BB\u03BF\u03C5\u03B8\u03B5\u03AF\u03C4\u03B1\u03B9',
      'ButtonSubscribedPlaylist': '\u039B\u03AF\u03C3\u03C4\u03B1 \u03C0\u03BF\u03C5 \u03B1\u03BA\u03BF\u03BB\u03BF\u03C5\u03B8\u03B5\u03AF\u03C4\u03B1\u03B9',
      'ButtonSubscribedUser': '\u03A7\u03C1\u03AE\u03C3\u03C4\u03B7\u03C2 \u03C0\u03BF\u03C5 \u03B1\u03BA\u03BF\u03BB\u03BF\u03C5\u03B8\u03B5\u03AF\u03C4\u03B1\u03B9',
      'ButtonUnsubscribe': '\u0386\u03C1\u03C3\u03B7 \u03B1\u03BA\u03BF\u03BB\u03BF\u03CD\u03B8\u03B7\u03C3\u03B7\u03C2',
      'ButtonUnsubscribeArtist': '\u0386\u03C1\u03C3\u03B7 \u03B1\u03BA\u03BF\u03BB\u03BF\u03CD\u03B8\u03B7\u03C3\u03B7\u03C2 \u03BA\u03B1\u03BB\u03BB\u03B9\u03C4\u03AD\u03C7\u03BD\u03B7',
      'ButtonUnsubscribePlaylist': '\u0386\u03C1\u03C3\u03B7 \u03B1\u03BA\u03BF\u03BB\u03BF\u03CD\u03B8\u03B7\u03C3\u03B7\u03C2 \u03BB\u03AF\u03C3\u03C4\u03B1\u03C2',
      'ButtonUnsubscribeUser': '\u0386\u03C1\u03C3\u03B7 \u03B1\u03BA\u03BF\u03BB\u03BF\u03CD\u03B8\u03B7\u03C3\u03B7\u03C2 \u03C7\u03C1\u03AE\u03C3\u03C4\u03B7',
      'ButtonShare': '\u039A\u03BF\u03B9\u03BD\u03BF\u03C0\u03BF\u03AF\u03B7\u03C3\u03B7\u2026',
      'ButtonStartRadio': '\u0388\u03BD\u03B1\u03C1\u03BE\u03B7 \u03C1\u03B1\u03B4\u03B9\u03BF\u03C6\u03CE\u03BD\u03BF\u03C5',
      'PopupPlaylistSubscribeCancel': '\u038C\u03C7\u03B9',
      'PopupPlaylistSubscribeConfirm': '\u0395\u03BD\u03C4\u03AC\u03BE\u03B5\u03B9',
      'PopupPlaylistSubscribeLine1': '\u03A0\u03BB\u03AD\u03BF\u03BD \u03B1\u03BA\u03BF\u03BB\u03BF\u03C5\u03B8\u03B5\u03AF\u03C2 \u03C4\u03BF\u03BD \u03C7\u03C1\u03AE\u03C3\u03C4\u03B7 {0} \u03B5\u03C0\u03B5\u03B9\u03B4\u03AE \u03AC\u03C1\u03C7\u03B9\u03C3\u03B5\u03C2 \u03BD\u03B1 \u03B1\u03BA\u03BF\u03BB\u03BF\u03C5\u03B8\u03B5\u03AF\u03C2 \u03B1\u03C5\u03C4\u03AE \u03C4\u03B7 \u03BB\u03AF\u03C3\u03C4\u03B1.',
      'PopupPlaylistSubscribeLine2': '\u0398\u03B1 \u03C3\u03C5\u03BD\u03B5\u03C7\u03AF\u03C3\u03B5\u03B9\u03C2 \u03BD\u03B1 \u03B1\u03BA\u03BF\u03BB\u03BF\u03C5\u03B8\u03B5\u03AF\u03C2 \u03B1\u03C5\u03C4\u03CC\u03BD \u03C4\u03BF\u03BD \u03C7\u03C1\u03AE\u03C3\u03C4\u03B7;',
      'PopupPlaylistSuggestFollow': '{0} \u03B4\u03B7\u03BC\u03B9\u03BF\u03CD\u03C1\u03B3\u03B7\u03C3\u03B5 \u03B1\u03C5\u03C4\u03AE \u03C4\u03B7 \u03BB\u03AF\u03C3\u03C4\u03B1. \u0393\u03B9\u03B1 \u03BD\u03B1 {2} \u03C0\u03B5\u03C1\u03B9\u03C3\u03C3\u03CC\u03C4\u03B5\u03C1\u03B7 \u03BC\u03BF\u03C5\u03C3\u03B9\u03BA\u03AE \u03B1\u03C0\u03CC {1}, \u03B1\u03C0\u03BB\u03AC \u03C0\u03B1\u03C4\u03AE\u03C3\u03C4\u03B5 {3}.',
      'PopupAviciiAutoFollow': '\u0391\u03BA\u03BF\u03BB\u03BF\u03C5\u03B8\u03B5\u03AF\u03C2 \u03C4\u03BF\u03BD Avicii \u03B5\u03C0\u03B5\u03B9\u03B4\u03AE \u03B1\u03BA\u03BF\u03BB\u03BF\u03CD\u03B8\u03B7\u03C3\u03B5\u03C2 \u03B1\u03C5\u03C4\u03AE \u03C4\u03B7 \u03BB\u03AF\u03C3\u03C4\u03B1. \u03A3\u03C5\u03BD\u03AD\u03C7\u03B9\u03C3\u03B5 \u03BD\u03B1 \u03B1\u03BA\u03BF\u03BB\u03BF\u03C5\u03B8\u03B5\u03AF\u03C2 \u03C4\u03BF\u03BD Avicii \u03B3\u03B9\u03B1 \u03BD\u03B1 \u03B5\u03BD\u03B7\u03BC\u03B5\u03C1\u03CE\u03BD\u03B5\u03C3\u03B1\u03B9 \u03B3\u03B9\u03B1 \u03BC\u03B5\u03BB\u03BB\u03BF\u03BD\u03C4\u03B9\u03BA\u03AD\u03C2 \u03BA\u03C5\u03BA\u03BB\u03BF\u03C6\u03BF\u03C1\u03AF\u03B5\u03C2!',
      'DiscoverAppName': '\u0391\u03BD\u03B1\u03BA\u03AC\u03BB\u03C5\u03C8\u03B5 ',
      'Followers': '\u039F\u03C0\u03B1\u03B4\u03BF\u03AF',
      'SaveToYourMusic': '\u0391\u03C0\u03BF\u03B8\u03AE\u03BA\u03B5\u03C5\u03C3\u03B7',
      'RemoveFromYourMusic': '\u0391\u03C6\u03B1\u03AF\u03C1\u03B5\u03C3\u03B7',
      'SavedToYourMusic': '\u0391\u03C0\u03BF\u03B8\u03B7\u03BA\u03B5\u03CD\u03C4\u03B7\u03BA\u03B5',
      'User': '\u03A7\u03C1\u03AE\u03C3\u03C4\u03B7\u03C2',
      'Artist': '\u039A\u03B1\u03BB\u03BB\u03B9\u03C4\u03AD\u03C7\u03BD\u03B7\u03C2',
      'Album': '\u0386\u03BB\u03BC\u03C0\u03BF\u03C5\u03BC',
      'Playlist': '\u039B\u03AF\u03C3\u03C4\u03B1'
    });
  },
  'node_modules/views/es.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/es.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'Seguir',
      'ButtonSubscribeArtist': 'Seguir artista',
      'ButtonSubscribePlaylist': 'Seguir playlist',
      'ButtonSubscribeUser': 'Seguir al usuario',
      'ButtonSubscribed': 'Siguiendo',
      'ButtonSubscribedArtist': 'Artista que sigues',
      'ButtonSubscribedPlaylist': 'Playlist que sigues',
      'ButtonSubscribedUser': 'Usuario que sigues',
      'ButtonUnsubscribe': 'No seguir',
      'ButtonUnsubscribeArtist': 'Dejar de seguir al artista',
      'ButtonUnsubscribePlaylist': 'Dejar de seguir la playlist',
      'ButtonUnsubscribeUser': 'Dejar de seguir al usuario',
      'ButtonShare': 'Compartir\u2026',
      'ButtonStartRadio': 'Iniciar radio',
      'PopupPlaylistSubscribeCancel': 'No',
      'PopupPlaylistSubscribeConfirm': 'OK',
      'PopupPlaylistSubscribeLine1': 'Ahora tambi\xE9n sigues a {0} porque sigues esta playlist.',
      'PopupPlaylistSubscribeLine2': '\xBFQuieres continuar siguiendo a este usuario?',
      'PopupPlaylistSuggestFollow': '{0} ha creado esta playlist. Para {2} m\xE1s m\xFAsica de {1}, simplemente dale a {3}.',
      'PopupAviciiAutoFollow': 'Ahora est\xE1s siguiendo a Avicii porque le has dado a seguir a esta playlist. De esta forma, podr\xE1s mantenerte al d\xEDa de pr\xF3ximos lanzamientos.',
      'DiscoverAppName': 'Descubrir',
      'Followers': 'Seguidores',
      'SaveToYourMusic': 'Guardar',
      'RemoveFromYourMusic': 'Eliminar',
      'SavedToYourMusic': 'Guardado/a',
      'User': 'Usuario',
      'Artist': 'Artista',
      'Album': '\xC1lbum',
      'Playlist': 'Playlist'
    });
  },
  'node_modules/views/es-la.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/es-la.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'Seguir',
      'ButtonSubscribeArtist': 'Seguir artista',
      'ButtonSubscribePlaylist': 'Seguir playlist',
      'ButtonSubscribeUser': 'Seguir a usuario',
      'ButtonSubscribed': 'Siguiendo',
      'ButtonSubscribedArtist': 'Siguiendo a artista',
      'ButtonSubscribedPlaylist': 'Siguiendo playlist',
      'ButtonSubscribedUser': 'Siguiendo a usuario',
      'ButtonUnsubscribe': 'No seguir',
      'ButtonUnsubscribeArtist': 'Dejar de seguir a artista',
      'ButtonUnsubscribePlaylist': 'Dejar de seguir playlist',
      'ButtonUnsubscribeUser': 'Dejar de seguir a usuario',
      'ButtonShare': 'Compartir\u2026',
      'ButtonStartRadio': 'Iniciar radio',
      'PopupPlaylistSubscribeCancel': 'No',
      'PopupPlaylistSubscribeConfirm': 'Ok',
      'PopupPlaylistSubscribeLine1': 'Tambi\xE9n sigues a {0} debido a que seguiste su playlist. ',
      'PopupPlaylistSubscribeLine2': '\xBFQuieres continuar siguiendo a este usuario?',
      'PopupPlaylistSuggestFollow': '{0} cre\xF3 esta playlist.  Para {2} m\xE1s m\xFAsica de {1}, simplemente pulsa {3}.',
      'PopupAviciiAutoFollow': 'Ahora sigues a Avicii, ya que comenzaste a seguir esta playlist. \xA1Contin\xFAa siguiendo a Avicii para recibir notificaciones sobre sus lanzamientos futuros!',
      'DiscoverAppName': 'Descubrir',
      'Followers': 'Seguidores',
      'SaveToYourMusic': 'Guardar',
      'RemoveFromYourMusic': 'Eliminar',
      'SavedToYourMusic': 'Guardado/a',
      'User': 'Usuario',
      'Artist': 'Artista',
      'Album': '\xC1lbum',
      'Playlist': 'Playlist'
    });
  },
  'node_modules/views/es-419.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/es-419.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'Seguir',
      'ButtonSubscribeArtist': 'Seguir artista',
      'ButtonSubscribePlaylist': 'Seguir playlist',
      'ButtonSubscribeUser': 'Seguir a usuario',
      'ButtonSubscribed': 'Siguiendo',
      'ButtonSubscribedArtist': 'Siguiendo a artista',
      'ButtonSubscribedPlaylist': 'Siguiendo playlist',
      'ButtonSubscribedUser': 'Siguiendo a usuario',
      'ButtonUnsubscribe': 'No seguir',
      'ButtonUnsubscribeArtist': 'Dejar de seguir a artista',
      'ButtonUnsubscribePlaylist': 'Dejar de seguir playlist',
      'ButtonUnsubscribeUser': 'Dejar de seguir a usuario',
      'ButtonShare': 'Compartir\u2026',
      'ButtonStartRadio': 'Iniciar radio',
      'PopupPlaylistSubscribeCancel': 'No',
      'PopupPlaylistSubscribeConfirm': 'Ok',
      'PopupPlaylistSubscribeLine1': 'Tambi\xE9n sigues a {0} debido a que seguiste su playlist. ',
      'PopupPlaylistSubscribeLine2': '\xBFQuieres continuar siguiendo a este usuario?',
      'PopupPlaylistSuggestFollow': '{0} cre\xF3 esta playlist.  Para {2} m\xE1s m\xFAsica de {1}, simplemente pulsa {3}.',
      'PopupAviciiAutoFollow': 'Ahora sigues a Avicii, ya que comenzaste a seguir esta playlist. \xA1Contin\xFAa siguiendo a Avicii para recibir notificaciones sobre sus lanzamientos futuros!',
      'DiscoverAppName': 'Descubrir',
      'Followers': 'Seguidores',
      'SaveToYourMusic': 'Guardar',
      'RemoveFromYourMusic': 'Eliminar',
      'SavedToYourMusic': 'Guardado/a',
      'User': 'Usuario',
      'Artist': 'Artista',
      'Album': '\xC1lbum',
      'Playlist': 'Playlist'
    });
  },
  'node_modules/views/hi.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/hi.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'Follow',
      'ButtonSubscribeArtist': 'Follow Artist',
      'ButtonSubscribePlaylist': 'Follow Playlist',
      'ButtonSubscribeUser': 'Follow User',
      'ButtonSubscribed': 'Following',
      'ButtonSubscribedArtist': 'Following Artist',
      'ButtonSubscribedPlaylist': 'Following Playlist',
      'ButtonSubscribedUser': 'Following User',
      'ButtonUnsubscribe': 'Unfollow',
      'ButtonUnsubscribeArtist': 'Unfollow Artist',
      'ButtonUnsubscribePlaylist': 'Unfollow Playlist',
      'ButtonUnsubscribeUser': 'Unfollow User',
      'ButtonShare': 'Share\u2026',
      'ButtonStartRadio': 'Start Radio',
      'PopupPlaylistSubscribeCancel': 'No',
      'PopupPlaylistSubscribeConfirm': 'Okay',
      'PopupPlaylistSubscribeLine1': 'You\'re now also following {0} because you followed this playlist.',
      'PopupPlaylistSubscribeLine2': 'Continue to follow this user?',
      'PopupPlaylistSuggestFollow': '{0} created this playlist. To {2} more music from {1}, just hit {3}.',
      'PopupAviciiAutoFollow': 'You are now following Avicii because you followed this playlist. Keep following Avicii to get notified about future releases!',
      'DiscoverAppName': 'Discover',
      'Followers': 'Followers',
      'SaveToYourMusic': 'Save',
      'RemoveFromYourMusic': 'Remove',
      'SavedToYourMusic': 'Saved',
      'User': 'User',
      'Artist': 'Artist',
      'Album': 'Album',
      'Playlist': 'Playlist'
    });
  },
  'node_modules/views/hu.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/hu.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'K\xF6vet\xE9s',
      'ButtonSubscribeArtist': 'El\u0151ad\xF3 k\xF6vet\xE9se',
      'ButtonSubscribePlaylist': 'Lej\xE1tsz\xE1si lista k\xF6vet\xE9se',
      'ButtonSubscribeUser': 'Felhaszn\xE1l\xF3 k\xF6vet\xE9se',
      'ButtonSubscribed': 'K\xF6vet\xE9sek',
      'ButtonSubscribedArtist': 'El\u0151ad\xF3 k\xF6vet\xE9se',
      'ButtonSubscribedPlaylist': 'Lej\xE1tsz\xE1si lista k\xF6vet\xE9se',
      'ButtonSubscribedUser': 'Felhaszn\xE1l\xF3 k\xF6vet\xE9se',
      'ButtonUnsubscribe': 'Nem k\xF6vetem',
      'ButtonUnsubscribeArtist': 'Ne k\xF6vesse az el\u0151ad\xF3t',
      'ButtonUnsubscribePlaylist': 'Ne k\xF6vesse a lej\xE1tsz\xE1si list\xE1t',
      'ButtonUnsubscribeUser': 'Ne k\xF6vesse a felhaszn\xE1l\xF3t',
      'ButtonShare': 'Megoszt\xE1s\u2026',
      'ButtonStartRadio': 'R\xE1di\xF3 ind\xEDt\xE1sa',
      'PopupPlaylistSubscribeCancel': 'Nem',
      'PopupPlaylistSubscribeConfirm': 'Ok\xE9',
      'PopupPlaylistSubscribeLine1': 'Mivel k\xF6vetted ezt a lej\xE1tsz\xE1si list\xE1t, m\xE1r \u0151t is k\xF6veted: {0}.',
      'PopupPlaylistSubscribeLine2': 'Folytatod, \xE9s k\xF6veted a felhaszn\xE1l\xF3t?',
      'PopupPlaylistSuggestFollow': 'Ezt a lej\xE1tsz\xE1si list\xE1t {0} hozta l\xE9tre. Ha {1} t\xF6bb zen\xE9j\xE9t szeretn\xE9d {2}, csak nyomd meg a k\xF6vetkez\u0151t: {3}.',
      'PopupAviciiAutoFollow': 'Mivel k\xF6vetted ezt a lej\xE1tsz\xE1si list\xE1t, most k\xF6veted Aviciit. K\xF6vesd Aviciit tov\xE1bbra is, ha \xE9rtes\xEDt\xE9seket szeretn\xE9l kapni az \xFAjdons\xE1gokr\xF3l.',
      'DiscoverAppName': 'Fedezz fel',
      'Followers': 'K\xF6vet\u0151k',
      'SaveToYourMusic': 'Ment\xE9s',
      'RemoveFromYourMusic': 'Elt\xE1vol\xEDt\xE1s',
      'SavedToYourMusic': 'Mentve',
      'User': 'Felhaszn\xE1l\xF3',
      'Artist': 'El\u0151ad\xF3',
      'Album': 'Album',
      'Playlist': 'Lej\xE1tsz\xE1si lista'
    });
  },
  'node_modules/views/id.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/id.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'Ikuti',
      'ButtonSubscribeArtist': 'Ikuti Artis',
      'ButtonSubscribePlaylist': 'Ikuti Daftar Putar',
      'ButtonSubscribeUser': 'Ikuti Pengguna',
      'ButtonSubscribed': 'Mengikuti',
      'ButtonSubscribedArtist': 'Mengikuti Artis',
      'ButtonSubscribedPlaylist': 'Mengikuti Daftar Putar',
      'ButtonSubscribedUser': 'Mengikuti Pengguna',
      'ButtonUnsubscribe': 'Berhenti Mengikuti',
      'ButtonUnsubscribeArtist': 'Berhenti Mengikuti Artis',
      'ButtonUnsubscribePlaylist': 'Berhenti Mengikuti Daftar Putar',
      'ButtonUnsubscribeUser': 'Berhenti Mengikuti Pengguna',
      'ButtonShare': 'Bagikan\u2026',
      'ButtonStartRadio': 'Mulai Radio',
      'PopupPlaylistSubscribeCancel': 'Tidak',
      'PopupPlaylistSubscribeConfirm': 'Oke',
      'PopupPlaylistSubscribeLine1': 'Sekarang Anda juga mengikuti {0} karena Anda mengikuti daftar putar ini.',
      'PopupPlaylistSubscribeLine2': 'Terus mengikuti pengguna ini?',
      'PopupPlaylistSuggestFollow': '{0} membuat daftar putar ini. Untuk {2} musik lainnya dari {1}, cukup tekan {3}.',
      'PopupAviciiAutoFollow': 'Anda mengikuti Avicii sekarang karena daftar putar ini Anda ikuti. Terus ikuti Avicii untuk memperoleh pemberitahuan tentang rilis mendatang!',
      'DiscoverAppName': 'Temukan',
      'Followers': 'Pengikut',
      'SaveToYourMusic': 'Simpan',
      'RemoveFromYourMusic': 'Hapus',
      'SavedToYourMusic': 'Disimpan',
      'User': 'Pengguna',
      'Artist': 'Artis',
      'Album': 'Album',
      'Playlist': 'Daftar putar'
    });
  },
  'node_modules/views/ja.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/ja.loc/strings/buttons.lang', {
      'ButtonSubscribe': '\u30D5\u30A9\u30ED\u30FC',
      'ButtonSubscribeArtist': '\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u3092\u30D5\u30A9\u30ED\u30FC',
      'ButtonSubscribePlaylist': '\u30D7\u30EC\u30A4\u30EA\u30B9\u30C8\u3092\u30D5\u30A9\u30ED\u30FC',
      'ButtonSubscribeUser': '\u30D5\u30A9\u30ED\u30FC\u3059\u308B',
      'ButtonSubscribed': '\u30D5\u30A9\u30ED\u30FC\u4E2D',
      'ButtonSubscribedArtist': '\u30D5\u30A9\u30ED\u30FC\u3057\u3066\u3044\u308B\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8',
      'ButtonSubscribedPlaylist': '\u30D5\u30A9\u30ED\u30FC\u3057\u3066\u3044\u308B\u30D7\u30EC\u30A4\u30EA\u30B9\u30C8',
      'ButtonSubscribedUser': '\u30D5\u30A9\u30ED\u30FC\u3057\u3066\u3044\u308B\u30E6\u30FC\u30B6\u30FC',
      'ButtonUnsubscribe': '\u30D5\u30A9\u30ED\u30FC\u3092\u3084\u3081\u308B',
      'ButtonUnsubscribeArtist': '\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u306E\u30D5\u30A9\u30ED\u30FC\u3092\u3084\u3081\u308B',
      'ButtonUnsubscribePlaylist': '\u30D7\u30EC\u30A4\u30EA\u30B9\u30C8\u306E\u306E\u30D5\u30A9\u30ED\u30FC\u3092\u3084\u3081\u308B',
      'ButtonUnsubscribeUser': '\u30D5\u30A9\u30ED\u30FC\u3092\u3084\u3081\u308B',
      'ButtonShare': '\u5171\u6709\u2026',
      'ButtonStartRadio': '\u30E9\u30B8\u30AA\u3092\u958B\u59CB',
      'PopupPlaylistSubscribeCancel': '\u3044\u3044\u3048',
      'PopupPlaylistSubscribeConfirm': 'OK',
      'PopupPlaylistSubscribeLine1': '\u3053\u306E\u30D7\u30EC\u30A4\u30EA\u30B9\u30C8\u3092\u30D5\u30A9\u30ED\u30FC\u3057\u305F\u306E\u3067\u3001{0}\u3082\u30D5\u30A9\u30ED\u30FC\u4E2D\u306B\u306A\u3063\u3066\u3044\u307E\u3059\u3002',
      'PopupPlaylistSubscribeLine2': '\u3053\u306E\u30E6\u30FC\u30B6\u30FC\u306E\u30D5\u30A9\u30ED\u30FC\u3092\u7D9A\u3051\u307E\u3059\u304B?',
      'PopupPlaylistSuggestFollow': '{0}\u304C\u3053\u306E\u30D7\u30EC\u30A4\u30EA\u30B9\u30C8\u3092\u4F5C\u6210\u3057\u307E\u3057\u305F\u3002{1}\u304B\u3089\u3082\u3063\u3068\u66F2\u3092{2}\u3059\u308B\u306B\u306F\u3001{3}\u3092\u30AF\u30EA\u30C3\u30AF\u3057\u3066\u304F\u3060\u3055\u3044\u3002',
      'PopupAviciiAutoFollow': 'Avicii\u306E\u30D7\u30EC\u30A4\u30EA\u30B9\u30C8\u3092\u30D5\u30A9\u30ED\u30FC\u3057\u3066\u3044\u308B\u306E\u3067\u3001\u73FE\u5728\u3082Avicii\u3092\u30D5\u30A9\u30ED\u30FC\u4E2D\u306B\u306A\u3063\u3066\u3044\u307E\u3059\u3002\u4ECA\u5F8C\u306E\u30EA\u30EA\u30FC\u30B9\u60C5\u5831\u77E5\u308B\u306B\u306F\u3001Avicii\u306E\u30D5\u30A9\u30ED\u30FC\u3092\u7D99\u7D9A\u3057\u307E\u3057\u3087\u3046\u3002',
      'DiscoverAppName': '\u30C7\u30A3\u30B9\u30AB\u30D0\u30FC',
      'Followers': '\u30D5\u30A9\u30ED\u30EF\u30FC',
      'SaveToYourMusic': '\u4FDD\u5B58',
      'RemoveFromYourMusic': '\u524A\u9664',
      'SavedToYourMusic': '\u4FDD\u5B58\u6E08\u307F',
      'User': '\u30E6\u30FC\u30B6\u30FC',
      'Artist': '\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8',
      'Album': '\u30A2\u30EB\u30D0\u30E0',
      'Playlist': '\u30D7\u30EC\u30A4\u30EA\u30B9\u30C8'
    });
  },
  'node_modules/views/ko.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/ko.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'Follow',
      'ButtonSubscribeArtist': 'Follow Artist',
      'ButtonSubscribePlaylist': 'Follow Playlist',
      'ButtonSubscribeUser': 'Follow User',
      'ButtonSubscribed': 'Following',
      'ButtonSubscribedArtist': 'Following Artist',
      'ButtonSubscribedPlaylist': 'Following Playlist',
      'ButtonSubscribedUser': 'Following User',
      'ButtonUnsubscribe': 'Unfollow',
      'ButtonUnsubscribeArtist': 'Unfollow Artist',
      'ButtonUnsubscribePlaylist': 'Unfollow Playlist',
      'ButtonUnsubscribeUser': 'Unfollow User',
      'ButtonShare': 'Share\u2026',
      'ButtonStartRadio': 'Start Radio',
      'PopupPlaylistSubscribeCancel': 'No',
      'PopupPlaylistSubscribeConfirm': 'Okay',
      'PopupPlaylistSubscribeLine1': 'You\'re now also following {0} because you followed this playlist.',
      'PopupPlaylistSubscribeLine2': 'Continue to follow this user?',
      'PopupPlaylistSuggestFollow': '{0} created this playlist. To {2} more music from {1}, just hit {3}.',
      'PopupAviciiAutoFollow': 'You are now following Avicii because you followed this playlist. Keep following Avicii to get notified about future releases!',
      'DiscoverAppName': 'Discover',
      'Followers': 'Followers',
      'SaveToYourMusic': 'Save',
      'RemoveFromYourMusic': 'Remove',
      'SavedToYourMusic': 'Saved',
      'User': 'User',
      'Artist': 'Artist',
      'Album': 'Album',
      'Playlist': 'Playlist'
    });
  },
  'node_modules/views/nl.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/nl.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'Volgen',
      'ButtonSubscribeArtist': 'Artiest volgen',
      'ButtonSubscribePlaylist': 'Afspeellijst volgen',
      'ButtonSubscribeUser': 'Gebruiker volgen',
      'ButtonSubscribed': 'Volgend',
      'ButtonSubscribedArtist': 'Volgt artiest',
      'ButtonSubscribedPlaylist': 'Volgt afspeellijst',
      'ButtonSubscribedUser': 'Volgt gebruiker',
      'ButtonUnsubscribe': 'Ontvolgen',
      'ButtonUnsubscribeArtist': 'Artiest niet meer volgen',
      'ButtonUnsubscribePlaylist': 'Afspeellijst niet meer volgen',
      'ButtonUnsubscribeUser': 'Gebruiker niet meer volgen',
      'ButtonShare': 'Delen...',
      'ButtonStartRadio': 'Radiozender beginnen',
      'PopupPlaylistSubscribeCancel': 'Nee',
      'PopupPlaylistSubscribeConfirm': 'OK',
      'PopupPlaylistSubscribeLine1': 'Je volgt nu ook {0} omdat je deze afspeellijst volgt.',
      'PopupPlaylistSubscribeLine2': 'Deze gebruiker blijven volgen?',
      'PopupPlaylistSuggestFollow': '{0} heeft deze afspeellijst gemaakt. Als je meer muziek wilt {2} van {1}, selecteer je gewoon {3}.',
      'PopupAviciiAutoFollow': 'Je volgt nu Avicii, omdat je deze afspeellijst hebt gevolgd. Blijf Avicii volgen om op de hoogte te blijven van toekomstige releases!',
      'DiscoverAppName': 'Ontdekken',
      'Followers': 'Volgers',
      'SaveToYourMusic': 'Opslaan',
      'RemoveFromYourMusic': 'Verwijderen',
      'SavedToYourMusic': 'Opgeslagen',
      'User': 'Gebruiker',
      'Artist': 'Artiest',
      'Album': 'Album',
      'Playlist': 'Afspeellijst'
    });
  },
  'node_modules/views/pl.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/pl.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'Obserwuj',
      'ButtonSubscribeArtist': 'Obserwuj wykonawc\u0119',
      'ButtonSubscribePlaylist': 'Obserwuj playlist\u0119',
      'ButtonSubscribeUser': 'Obserwuj u\u017Cytkownika',
      'ButtonSubscribed': 'Obserwujesz',
      'ButtonSubscribedArtist': 'Obserwuje wykonawc\u0119',
      'ButtonSubscribedPlaylist': 'Obserwuje playlist\u0119',
      'ButtonSubscribedUser': 'Obserwuje wykonawc\u0119',
      'ButtonUnsubscribe': 'Nie obserwuj',
      'ButtonUnsubscribeArtist': 'Nie obserwuj wykonawcy',
      'ButtonUnsubscribePlaylist': 'Nie obserwuj playlisty',
      'ButtonUnsubscribeUser': 'Nie obserwuj u\u017Cytkownika',
      'ButtonShare': 'Udost\u0119pnij\u2026',
      'ButtonStartRadio': 'W\u0142\u0105cz radio',
      'PopupPlaylistSubscribeCancel': 'Nie',
      'PopupPlaylistSubscribeConfirm': 'OK',
      'PopupPlaylistSubscribeLine1': 'Poniewa\u017C obserwujesz t\u0119 playlist\u0119 teraz tak\u017Ce obserwujesz {0}.',
      'PopupPlaylistSubscribeLine2': 'Czy nadal chcesz obserwowa\u0107 tego u\u017Cytkownika?',
      'PopupPlaylistSuggestFollow': 'U\u017Cytkownik {0} utworzy\u0142 t\u0119 playlist\u0119. Aby {2} wi\u0119cej muzyki od {1}, po prostu kliknij {3}.',
      'PopupAviciiAutoFollow': 'Obserwujesz teraz Avicii, poniewa\u017C playlista ta by\u0142a ju\u017C przez Ciebie wcze\u015Bniej obserwowana. Obserwuj nadal Avicii, aby otrzymywa\u0107 powiadomienia o przysz\u0142ych wydaniach!',
      'DiscoverAppName': 'Odkrywaj',
      'Followers': 'Obserwuj\u0105cych',
      'SaveToYourMusic': 'Zapisz',
      'RemoveFromYourMusic': 'Usu\u0144',
      'SavedToYourMusic': 'Zapisane',
      'User': 'U\u017Cytkownik',
      'Artist': 'Wykonawca',
      'Album': 'Album',
      'Playlist': 'Playlista'
    });
  },
  'node_modules/views/pt-br.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/pt-br.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'Seguir',
      'ButtonSubscribeArtist': 'Seguir artista',
      'ButtonSubscribePlaylist': 'Seguir playlist',
      'ButtonSubscribeUser': 'Seguir usu\xE1rio',
      'ButtonSubscribed': 'Seguindo',
      'ButtonSubscribedArtist': 'Seguindo artista',
      'ButtonSubscribedPlaylist': 'Seguindo playlist',
      'ButtonSubscribedUser': 'Seguindo usu\xE1rio',
      'ButtonUnsubscribe': 'Deixar de seguir',
      'ButtonUnsubscribeArtist': 'Deixar de seguir artista',
      'ButtonUnsubscribePlaylist': 'Deixar de seguir playlist',
      'ButtonUnsubscribeUser': 'Deixar de seguir usu\xE1rio',
      'ButtonShare': 'Compartilhar\u2026',
      'ButtonStartRadio': 'Iniciar R\xE1dio',
      'PopupPlaylistSubscribeCancel': 'N\xE3o',
      'PopupPlaylistSubscribeConfirm': 'OK',
      'PopupPlaylistSubscribeLine1': 'Agora voc\xEA tamb\xE9m est\xE1 seguindo {0} porque seguiu esta playlist.',
      'PopupPlaylistSubscribeLine2': 'Continuar a seguir esse usu\xE1rio?',
      'PopupPlaylistSuggestFollow': '{0} criou esta playlist. Para {2} mais m\xFAsicas de {1}, basta apertar {3}.',
      'PopupAviciiAutoFollow': 'Agora voc\xEA est\xE1 seguindo Avicii, porque seguiu esta playlist. Continue seguindo Avicii para receber notifica\xE7\xF5es sobre lan\xE7amentos futuros!',
      'DiscoverAppName': 'Descobrir',
      'Followers': 'Seguidores',
      'SaveToYourMusic': 'Salvar',
      'RemoveFromYourMusic': 'Remover',
      'SavedToYourMusic': 'Salvo',
      'User': 'Usu\xE1rio',
      'Artist': 'Artista',
      'Album': '\xC1lbum',
      'Playlist': 'Playlist'
    });
  },
  'node_modules/views/it.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/it.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'Segui',
      'ButtonSubscribeArtist': 'Segui artista',
      'ButtonSubscribePlaylist': 'Segui playlist',
      'ButtonSubscribeUser': 'Segui utente',
      'ButtonSubscribed': 'Following',
      'ButtonSubscribedArtist': 'Artista che segui',
      'ButtonSubscribedPlaylist': 'Playlist che segui',
      'ButtonSubscribedUser': 'Utente che segui',
      'ButtonUnsubscribe': 'Non seguire',
      'ButtonUnsubscribeArtist': 'Smetti di seguire l\'artista',
      'ButtonUnsubscribePlaylist': 'Smetti di seguire la playlist',
      'ButtonUnsubscribeUser': 'Smetti di seguire l\'utente',
      'ButtonShare': 'Condividi\u2026',
      'ButtonStartRadio': 'Avvia radio',
      'PopupPlaylistSubscribeCancel': 'No',
      'PopupPlaylistSubscribeConfirm': 'Ok',
      'PopupPlaylistSubscribeLine1': 'Ora segui anche {0} in quanto seguivi questa playlist.',
      'PopupPlaylistSubscribeLine2': 'Vuoi continuare a seguire questo utente?',
      'PopupPlaylistSuggestFollow': '{0} ha creato questa playlist. {2} pi\xF9 musica da {1}, premendo {3}.',
      'PopupAviciiAutoFollow': 'Ora segui Avicii in quanto seguivi questa playlist. Continua a seguire Avicii per ricevere notifiche sulle sue uscite future.',
      'DiscoverAppName': 'Scopri',
      'Followers': 'Follower',
      'SaveToYourMusic': 'Salva',
      'RemoveFromYourMusic': 'Elimina',
      'SavedToYourMusic': 'Salvato',
      'User': 'Utente',
      'Artist': 'Artista',
      'Album': 'Album',
      'Playlist': 'Playlist'
    });
  },
  'node_modules/views/ro.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/ro.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'Urm\u0103re\u015Fte',
      'ButtonSubscribeArtist': 'Urm\u0103re\u015Fte artistul',
      'ButtonSubscribePlaylist': 'Urm\u0103re\u015Fte playlistul',
      'ButtonSubscribeUser': 'Urm\u0103re\u015Fte utilizatorul',
      'ButtonSubscribed': 'Urm\u0103resc',
      'ButtonSubscribedArtist': 'Se urm\u0103re\u015Fte artistul',
      'ButtonSubscribedPlaylist': 'Se urm\u0103re\u015Fte playlistul',
      'ButtonSubscribedUser': 'Urm\u0103resc utilizatorul',
      'ButtonUnsubscribe': 'Opre\u015Fte urm\u0103rirea',
      'ButtonUnsubscribeArtist': 'Opre\u015Fte urm\u0103rirea artistului',
      'ButtonUnsubscribePlaylist': 'Opre\u015Fte urm\u0103rirea playlistului',
      'ButtonUnsubscribeUser': 'Opre\u015Fte urm\u0103rirea utilizatorului',
      'ButtonShare': 'Partajeaz\u0103...',
      'ButtonStartRadio': 'Creeaz\u0103 un post de radio',
      'PopupPlaylistSubscribeCancel': 'Nu',
      'PopupPlaylistSubscribeConfirm': 'Ok',
      'PopupPlaylistSubscribeLine1': 'Acum urm\u0103re\u015Fti \u015Fi {0} deoarece ai urm\u0103rit acest playlist.',
      'PopupPlaylistSubscribeLine2': 'Vrei s\u0103 continui s\u0103 urm\u0103re\u015Fti acest utilizator?',
      'PopupPlaylistSuggestFollow': '{0} a creat acest playlist. Pentru a {2} mai mult\u0103 muzic\u0103 de la {1}, apas\u0103 {3}.',
      'PopupAviciiAutoFollow': 'Acum urm\u0103re\u015Fti Avicii deoarece ai urm\u0103rit acest playlist. Continu\u0103 s\u0103 urm\u0103re\u015Fti Avicii pentru a primi notific\u0103ri despre lans\u0103rile viitoare!',
      'DiscoverAppName': 'Descoper\u0103',
      'Followers': 'Persoane care urm\u0103resc',
      'SaveToYourMusic': 'Salveaz\u0103',
      'RemoveFromYourMusic': 'Elimin\u0103',
      'SavedToYourMusic': 'Salvat',
      'User': 'Utilizator',
      'Artist': 'Artist',
      'Album': 'Album',
      'Playlist': 'Playlist'
    });
  },
  'node_modules/views/ru.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/ru.loc/strings/buttons.lang', {
      'ButtonSubscribe': '\u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F',
      'ButtonSubscribeArtist': '\u0421\u043B\u0435\u0434\u0438\u0442\u044C \u0437\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F\u043C\u0438',
      'ButtonSubscribePlaylist': '\u0421\u043B\u0435\u0434\u0438\u0442\u044C \u0437\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F\u043C\u0438',
      'ButtonSubscribeUser': '\u0421\u043B\u0435\u0434\u0438\u0442\u044C \u0437\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F\u043C\u0438',
      'ButtonSubscribed': '\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0438',
      'ButtonSubscribedArtist': '\u0412\u044B \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u043D\u044B \u043D\u0430 \u044D\u0442\u043E\u0433\u043E \u0438\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044F',
      'ButtonSubscribedPlaylist': '\u0412\u044B \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u043D\u044B \u043D\u0430 \u044D\u0442\u043E\u0442 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442',
      'ButtonSubscribedUser': '\u0412\u044B \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u043D\u044B \u043D\u0430 \u044D\u0442\u043E\u0433\u043E \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F',
      'ButtonUnsubscribe': '\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0443',
      'ButtonUnsubscribeArtist': '\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0443 \u043D\u0430 \u0438\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044F',
      'ButtonUnsubscribePlaylist': '\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0443 \u043D\u0430 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442',
      'ButtonUnsubscribeUser': '\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0443 \u043D\u0430 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F',
      'ButtonShare': '\u041F\u043E\u0434\u0435\u043B\u0438\u0442\u044C\u0441\u044F\u2026',
      'ButtonStartRadio': '\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0440\u0430\u0434\u0438\u043E',
      'PopupPlaylistSubscribeCancel': '\u041D\u0435\u0442',
      'PopupPlaylistSubscribeConfirm': '\u041E\u041A',
      'PopupPlaylistSubscribeLine1': '\u0422\u0435\u043F\u0435\u0440\u044C \u0432\u044B \u0441\u043B\u0435\u0434\u0438\u0442\u0435 \u0437\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F\u043C\u0438 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F {0}, \u0442\u0430\u043A \u043A\u0430\u043A \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u043B\u0438\u0441\u044C \u043D\u0430 \u0435\u0433\u043E \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442.',
      'PopupPlaylistSubscribeLine2': '\u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C \u0441\u043B\u0435\u0434\u0438\u0442\u044C \u0437\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F\u043C\u0438 \u044D\u0442\u043E\u0433\u043E \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F?',
      'PopupPlaylistSuggestFollow': '\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C {0} \u0441\u043E\u0437\u0434\u0430\u043B \u044D\u0442\u043E\u0442 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442. \u0427\u0442\u043E\u0431\u044B \u0435\u0449\u0435 {2} \u043C\u0443\u0437\u044B\u043A\u0443 {1}, \u043F\u0440\u043E\u0441\u0442\u043E \u043D\u0430\u0436\u043C\u0438\u0442\u0435 {3}.',
      'PopupAviciiAutoFollow': '\u0422\u0435\u043F\u0435\u0440\u044C \u0432\u044B \u0441\u043B\u0435\u0434\u0438\u0442\u0435 \u0437\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F\u043C\u0438 \u0410\u0432\u0438\u0447\u0438, \u0442\u0430\u043A \u043A\u0430\u043A \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u043B\u0438\u0441\u044C \u043D\u0430 \u0435\u0433\u043E \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442. \u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0430\u0439\u0442\u0435 \u0441\u043B\u0435\u0434\u0438\u0442\u044C \u0437\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F\u043C\u0438, \u0447\u0442\u043E\u0431\u044B \u043D\u0435 \u043F\u0440\u043E\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u043D\u043E\u0432\u044B\u0435 \u0440\u0435\u043B\u0438\u0437\u044B.',
      'DiscoverAppName': '\u041F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u044F',
      'Followers': '\u041F\u043E\u0434\u043F\u0438\u0441\u0447\u0438\u043A\u0438',
      'SaveToYourMusic': '\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C',
      'RemoveFromYourMusic': '\u0423\u0434\u0430\u043B\u0438\u0442\u044C',
      'SavedToYourMusic': '\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E',
      'User': '\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C',
      'Artist': '\u0418\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C',
      'Album': '\u0410\u043B\u044C\u0431\u043E\u043C',
      'Playlist': '\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442'
    });
  },
  'node_modules/views/ta.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/ta.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'Follow',
      'ButtonSubscribeArtist': 'Follow Artist',
      'ButtonSubscribePlaylist': 'Follow Playlist',
      'ButtonSubscribeUser': 'Follow User',
      'ButtonSubscribed': 'Following',
      'ButtonSubscribedArtist': 'Following Artist',
      'ButtonSubscribedPlaylist': 'Following Playlist',
      'ButtonSubscribedUser': 'Following User',
      'ButtonUnsubscribe': 'Unfollow',
      'ButtonUnsubscribeArtist': 'Unfollow Artist',
      'ButtonUnsubscribePlaylist': 'Unfollow Playlist',
      'ButtonUnsubscribeUser': 'Unfollow User',
      'ButtonShare': 'Share\u2026',
      'ButtonStartRadio': 'Start Radio',
      'PopupPlaylistSubscribeCancel': 'No',
      'PopupPlaylistSubscribeConfirm': 'Okay',
      'PopupPlaylistSubscribeLine1': 'You\'re now also following {0} because you followed this playlist.',
      'PopupPlaylistSubscribeLine2': 'Continue to follow this user?',
      'PopupPlaylistSuggestFollow': '{0} created this playlist. To {2} more music from {1}, just hit {3}.',
      'PopupAviciiAutoFollow': 'You are now following Avicii because you followed this playlist. Keep following Avicii to get notified about future releases!',
      'DiscoverAppName': 'Discover',
      'Followers': 'Followers',
      'SaveToYourMusic': 'Save',
      'RemoveFromYourMusic': 'Remove',
      'SavedToYourMusic': 'Saved',
      'User': 'User',
      'Artist': 'Artist',
      'Album': 'Album',
      'Playlist': 'Playlist'
    });
  },
  'node_modules/views/th.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/th.loc/strings/buttons.lang', {
      'ButtonSubscribe': '\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21',
      'ButtonSubscribeArtist': '\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E28\u0E34\u0E25\u0E1B\u0E34\u0E19',
      'ButtonSubscribePlaylist': '\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E40\u0E1E\u0E25\u0E22\u0E4C\u0E25\u0E34\u0E2A\u0E15\u0E4C',
      'ButtonSubscribeUser': '\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49',
      'ButtonSubscribed': '\u0E01\u0E33\u0E25\u0E31\u0E07\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21',
      'ButtonSubscribedArtist': '\u0E01\u0E33\u0E25\u0E31\u0E07\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E28\u0E34\u0E25\u0E1B\u0E34\u0E19',
      'ButtonSubscribedPlaylist': '\u0E01\u0E33\u0E25\u0E31\u0E07\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E40\u0E1E\u0E25\u0E22\u0E4C\u0E25\u0E34\u0E2A\u0E15\u0E4C',
      'ButtonSubscribedUser': '\u0E01\u0E33\u0E25\u0E31\u0E07\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49',
      'ButtonUnsubscribe': '\u0E40\u0E25\u0E34\u0E01\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21',
      'ButtonUnsubscribeArtist': '\u0E40\u0E25\u0E34\u0E01\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E28\u0E34\u0E25\u0E1B\u0E34\u0E19',
      'ButtonUnsubscribePlaylist': '\u0E40\u0E25\u0E34\u0E01\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E40\u0E1E\u0E25\u0E22\u0E4C\u0E25\u0E34\u0E2A\u0E15\u0E4C',
      'ButtonUnsubscribeUser': '\u0E40\u0E25\u0E34\u0E01\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49',
      'ButtonShare': '\u0E41\u0E0A\u0E23\u0E4C\u2026',
      'ButtonStartRadio': '\u0E40\u0E23\u0E34\u0E48\u0E21\u0E43\u0E0A\u0E49\u0E27\u0E34\u0E17\u0E22\u0E38',
      'PopupPlaylistSubscribeCancel': '\u0E44\u0E21\u0E48',
      'PopupPlaylistSubscribeConfirm': '\u0E15\u0E01\u0E25\u0E07',
      'PopupPlaylistSubscribeLine1': '\u0E04\u0E38\u0E13\u0E01\u0E33\u0E25\u0E31\u0E07\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21 {0} \u0E14\u0E49\u0E27\u0E22\u0E40\u0E19\u0E37\u0E48\u0E2D\u0E07\u0E08\u0E32\u0E01\u0E04\u0E38\u0E13\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E40\u0E1E\u0E25\u0E22\u0E4C\u0E25\u0E34\u0E2A\u0E15\u0E4C\u0E19\u0E35\u0E49',
      'PopupPlaylistSubscribeLine2': '\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49\u0E19\u0E35\u0E49\u0E15\u0E48\u0E2D\u0E44\u0E1B\u0E2B\u0E23\u0E37\u0E2D\u0E44\u0E21\u0E48',
      'PopupPlaylistSuggestFollow': '{0} \u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E1E\u0E25\u0E22\u0E4C\u0E25\u0E34\u0E2A\u0E15\u0E4C\u0E19\u0E35\u0E49 \u0E2D\u0E22\u0E32\u0E01 {2} \u0E40\u0E1E\u0E25\u0E07\u0E21\u0E32\u0E01\u0E01\u0E27\u0E48\u0E32\u0E19\u0E35\u0E49\u0E08\u0E32\u0E01 {1} \u0E40\u0E1E\u0E35\u0E22\u0E07\u0E41\u0E04\u0E48\u0E04\u0E25\u0E34\u0E01 {3}',
      'PopupAviciiAutoFollow': '\u0E02\u0E13\u0E30\u0E19\u0E35\u0E49\u0E04\u0E38\u0E13\u0E40\u0E23\u0E34\u0E48\u0E21\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21 Avicii \u0E40\u0E19\u0E37\u0E48\u0E2D\u0E07\u0E08\u0E32\u0E01\u0E04\u0E38\u0E13\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E40\u0E1E\u0E25\u0E22\u0E4C\u0E25\u0E34\u0E2A\u0E15\u0E4C\u0E19\u0E35\u0E49 \u0E15\u0E34\u0E14\u0E15\u0E32\u0E21 Avicii \u0E15\u0E48\u0E2D\u0E44\u0E1B\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E23\u0E31\u0E1A\u0E01\u0E32\u0E23\u0E41\u0E08\u0E49\u0E07\u0E40\u0E15\u0E37\u0E2D\u0E19\u0E40\u0E01\u0E35\u0E48\u0E22\u0E27\u0E01\u0E31\u0E1A\u0E1C\u0E25\u0E07\u0E32\u0E19\u0E43\u0E2B\u0E21\u0E48\u0E46 \u0E43\u0E19\u0E2D\u0E19\u0E32\u0E04\u0E15!',
      'DiscoverAppName': 'Discover',
      'Followers': '\u0E1C\u0E39\u0E49\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21',
      'SaveToYourMusic': '\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01',
      'RemoveFromYourMusic': '\u0E19\u0E33\u0E2D\u0E2D\u0E01',
      'SavedToYourMusic': '\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E41\u0E25\u0E49\u0E27',
      'User': '\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49',
      'Artist': '\u0E28\u0E34\u0E25\u0E1B\u0E34\u0E19',
      'Album': '\u0E2D\u0E31\u0E25\u0E1A\u0E31\u0E49\u0E21',
      'Playlist': '\u0E40\u0E1E\u0E25\u0E22\u0E4C\u0E25\u0E34\u0E2A\u0E15\u0E4C'
    });
  },
  'node_modules/views/tr.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/tr.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'Takip Et',
      'ButtonSubscribeArtist': 'Sanat\xE7\u0131y\u0131 Takip Et',
      'ButtonSubscribePlaylist': '\xC7alma Listesini Takip Et',
      'ButtonSubscribeUser': 'Kullan\u0131c\u0131y\u0131 Takip Et',
      'ButtonSubscribed': 'Takip Ediliyor',
      'ButtonSubscribedArtist': 'Sanat\xE7\u0131 Takip Ediliyor',
      'ButtonSubscribedPlaylist': '\xC7alma Listesi Takip Ediliyor',
      'ButtonSubscribedUser': 'Kullan\u0131c\u0131 Takip Ediliyor',
      'ButtonUnsubscribe': 'Takip Etmeyi B\u0131rak',
      'ButtonUnsubscribeArtist': 'Sanat\xE7\u0131y\u0131 Takip Etmeyi B\u0131rak',
      'ButtonUnsubscribePlaylist': '\xC7alma Listesini Takip Etmeyi B\u0131rak',
      'ButtonUnsubscribeUser': 'Kullan\u0131c\u0131y\u0131 Takip Etmeyi B\u0131rak',
      'ButtonShare': 'Payla\u015F...',
      'ButtonStartRadio': 'Radyo\'yu Ba\u015Flat',
      'PopupPlaylistSubscribeCancel': 'Hay\u0131r',
      'PopupPlaylistSubscribeConfirm': 'Tamam',
      'PopupPlaylistSubscribeLine1': 'Bu \xE7alma listesini takip etti\u011Fin i\xE7in {0} adl\u0131 ki\u015Fiyi de takip ediyorsun.',
      'PopupPlaylistSubscribeLine2': 'Bu kullan\u0131c\u0131y\u0131 takip etmeye devam edecek misin?',
      'PopupPlaylistSuggestFollow': '{0} bu \xE7alma listesini olu\u015Fturdu. {3} d\xFC\u011Fmesine bas ve {1} adl\u0131 ki\u015Fiden daha fazla m\xFCzik {2}.',
      'PopupAviciiAutoFollow': '\u015Eu anda Avicii\'yi takip ediyorsun \xE7\xFCnk\xFC bu \xE7alma listesini takip ettin. Gelecek par\xE7alar i\xE7in Avicii\'yi takip etmeye devam et!',
      'DiscoverAppName': 'Ke\u015Ffet',
      'Followers': 'Takip\xE7iler',
      'SaveToYourMusic': 'Kaydet',
      'RemoveFromYourMusic': '\xC7\u0131kar',
      'SavedToYourMusic': 'Kaydedildi',
      'User': 'Kullan\u0131c\u0131',
      'Artist': 'Sanat\xE7\u0131',
      'Album': 'Alb\xFCm',
      'Playlist': '\xC7alma Listesi'
    });
  },
  'node_modules/views/zh-hant.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/zh-hant.loc/strings/buttons.lang', {
      'ButtonSubscribe': '\u95DC\u6CE8',
      'ButtonSubscribeArtist': '\u95DC\u6CE8\u85DD\u4EBA',
      'ButtonSubscribePlaylist': '\u95DC\u6CE8\u64AD\u653E\u6E05\u55AE',
      'ButtonSubscribeUser': '\u95DC\u6CE8\u4F7F\u7528\u8005',
      'ButtonSubscribed': '\u6B63\u5728\u95DC\u6CE8',
      'ButtonSubscribedArtist': '\u95DC\u6CE8\u85DD\u4EBA',
      'ButtonSubscribedPlaylist': '\u95DC\u6CE8\u64AD\u653E\u6E05\u55AE',
      'ButtonSubscribedUser': '\u95DC\u6CE8\u4F7F\u7528\u8005',
      'ButtonUnsubscribe': '\u53D6\u6D88\u95DC\u6CE8',
      'ButtonUnsubscribeArtist': '\u53D6\u6D88\u95DC\u6CE8\u85DD\u4EBA',
      'ButtonUnsubscribePlaylist': '\u53D6\u6D88\u95DC\u6CE8\u64AD\u653E\u6E05\u55AE',
      'ButtonUnsubscribeUser': '\u53D6\u6D88\u95DC\u6CE8\u4F7F\u7528\u8005',
      'ButtonShare': '\u5206\u4EAB...',
      'ButtonStartRadio': '\u958B\u59CB\u6536\u807D\u96FB\u53F0',
      'PopupPlaylistSubscribeCancel': '\u5426',
      'PopupPlaylistSubscribeConfirm': '\u78BA\u5B9A',
      'PopupPlaylistSubscribeLine1': '\u7531\u65BC\u4F60\u95DC\u6CE8\u9019\u500B\u64AD\u653E\u6E05\u55AE\uFF0C\u6240\u4EE5\u4E5F\u540C\u6642\u95DC\u6CE8 {0}\u3002',
      'PopupPlaylistSubscribeLine2': '\u7E7C\u7E8C\u95DC\u6CE8\u9019\u4F4D\u4F7F\u7528\u8005\u55CE\uFF1F',
      'PopupPlaylistSuggestFollow': '{0} \u5EFA\u7ACB\u4E86\u9019\u500B\u64AD\u653E\u6E05\u55AE\u3002 \u60F3{2}\u66F4\u591A\u4F86\u81EA {1} \u7684\u97F3\u6A02\uFF0C\u8ACB\u9EDE\u9078{3}\u3002',
      'PopupAviciiAutoFollow': '\u7531\u65BC\u4F60\u95DC\u6CE8\u4E86 Avicii \u7684\u64AD\u653E\u6E05\u55AE\uFF0C\u8868\u793A\u4F60\u4E5F\u6B63\u5728\u95DC\u6CE8\u4ED6\u3002\u7E7C\u7E8C\u95DC\u6CE8 Avicii\uFF0C\u638C\u63E1\u65B0\u6B4C\u767C\u884C\u6D88\u606F\uFF01',
      'DiscoverAppName': '\u767C\u6398',
      'Followers': '\u7C89\u7D72',
      'SaveToYourMusic': '\u5132\u5B58',
      'RemoveFromYourMusic': '\u79FB\u9664',
      'SavedToYourMusic': '\u5DF2\u5132\u5B58',
      'User': '\u4F7F\u7528\u8005',
      'Artist': '\u85DD\u4EBA',
      'Album': '\u5C08\u8F2F',
      'Playlist': '\u64AD\u653E\u6E05\u55AE'
    });
  },
  'node_modules/views/zsm.loc/strings/buttons.lang': function (require, module, exports, global, __filename, __dirname) {
    module.exports = new SpotifyApi.LangModule('node_modules/views/zsm.loc/strings/buttons.lang', {
      'ButtonSubscribe': 'Ikuti',
      'ButtonSubscribeArtist': 'Ikuti Artis',
      'ButtonSubscribePlaylist': 'Ikuti Senarai main',
      'ButtonSubscribeUser': 'Ikuti Pengguna',
      'ButtonSubscribed': 'Mengikuti',
      'ButtonSubscribedArtist': 'Mengikuti artis',
      'ButtonSubscribedPlaylist': 'Mengikuti Senarai main',
      'ButtonSubscribedUser': 'Mengikuti Pengguna',
      'ButtonUnsubscribe': 'Nyahikut',
      'ButtonUnsubscribeArtist': 'Nyahikut Artis',
      'ButtonUnsubscribePlaylist': 'Nyahikut Senarai main',
      'ButtonUnsubscribeUser': 'Nyahikut Pengguna',
      'ButtonShare': 'Kongsi\u2026',
      'ButtonStartRadio': 'Mulakan Radio',
      'PopupPlaylistSubscribeCancel': 'Tidak',
      'PopupPlaylistSubscribeConfirm': 'Ok',
      'PopupPlaylistSubscribeLine1': 'Anda kini mengikuti {0} kerana anda mengikuti senarai main ini.',
      'PopupPlaylistSubscribeLine2': 'Teruskan untuk mengikuti pengguna ini?',
      'PopupPlaylistSuggestFollow': '{0} mencipta senarai main ini. Untuk {2} lebih banyak muzik daripada {1}, hanya tekan {3}.',
      'PopupAviciiAutoFollow': 'Anda kini mengikuti Avicii kerana anda mengikuti senarai main ini. Pastikan mengikuti Avicii untuk mendapat pemberitahuan tentang keluaran di masa depan!',
      'DiscoverAppName': 'Temui',
      'Followers': 'Pengikut',
      'SaveToYourMusic': 'Simpan',
      'RemoveFromYourMusic': 'Keluarkan',
      'SavedToYourMusic': 'Disimpan',
      'User': 'Pengguna',
      'Artist': 'Artis',
      'Album': 'Album',
      'Playlist': 'Senarai main'
    });
  },
  'node_modules/mout/object/hasOwn.js': function (require, module, exports, global, __filename, __dirname) {
    function hasOwn(obj, prop) {
      return Object.prototype.hasOwnProperty.call(obj, prop);
    }
    module.exports = hasOwn;
  },
  'node_modules/mout/object/forIn.js': function (require, module, exports, global, __filename, __dirname) {
    var hasOwn = require('node_modules/mout/object/hasOwn.js');
    var _hasDontEnumBug, _dontEnums;
    function checkDontEnum() {
      _dontEnums = [
        'toString',
        'toLocaleString',
        'valueOf',
        'hasOwnProperty',
        'isPrototypeOf',
        'propertyIsEnumerable',
        'constructor'
      ];
      _hasDontEnumBug = true;
      for (var key in { 'toString': null }) {
        _hasDontEnumBug = false;
      }
    }
    function forIn(obj, fn, thisObj) {
      var key, i = 0;
      if (_hasDontEnumBug == null)
        checkDontEnum();
      for (key in obj) {
        if (exec(fn, obj, key, thisObj) === false) {
          break;
        }
      }
      if (_hasDontEnumBug) {
        var ctor = obj.constructor, isProto = !!ctor && obj === ctor.prototype;
        while (key = _dontEnums[i++]) {
          if ((key !== 'constructor' || !isProto && hasOwn(obj, key)) && obj[key] !== Object.prototype[key]) {
            if (exec(fn, obj, key, thisObj) === false) {
              break;
            }
          }
        }
      }
    }
    function exec(fn, obj, key, thisObj) {
      return fn.call(thisObj, obj[key], key, obj);
    }
    module.exports = forIn;
  },
  'node_modules/mout/object/forOwn.js': function (require, module, exports, global, __filename, __dirname) {
    var hasOwn = require('node_modules/mout/object/hasOwn.js');
    var forIn = require('node_modules/mout/object/forIn.js');
    function forOwn(obj, fn, thisObj) {
      forIn(obj, function (val, key) {
        if (hasOwn(obj, key)) {
          return fn.call(thisObj, obj[key], key, obj);
        }
      });
    }
    module.exports = forOwn;
  },
  'node_modules/mout/object/mixIn.js': function (require, module, exports, global, __filename, __dirname) {
    var forOwn = require('node_modules/mout/object/forOwn.js');
    function mixIn(target, objects) {
      var i = 0, n = arguments.length, obj;
      while (++i < n) {
        obj = arguments[i];
        if (obj != null) {
          forOwn(obj, copyProp, target);
        }
      }
      return target;
    }
    function copyProp(val, key) {
      this[key] = val;
    }
    module.exports = mixIn;
  },
  'node_modules/mout/array/indexOf.js': function (require, module, exports, global, __filename, __dirname) {
    function indexOf(arr, item, fromIndex) {
      fromIndex = fromIndex || 0;
      if (arr == null) {
        return -1;
      }
      var len = arr.length, i = fromIndex < 0 ? len + fromIndex : fromIndex;
      while (i < len) {
        if (arr[i] === item) {
          return i;
        }
        i++;
      }
      return -1;
    }
    module.exports = indexOf;
  },
  'node_modules/mout/array/contains.js': function (require, module, exports, global, __filename, __dirname) {
    var indexOf = require('node_modules/mout/array/indexOf.js');
    function contains(arr, val) {
      return indexOf(arr, val) !== -1;
    }
    module.exports = contains;
  },
  'node_modules/mout/array/combine.js': function (require, module, exports, global, __filename, __dirname) {
    var indexOf = require('node_modules/mout/array/indexOf.js');
    function combine(arr1, arr2) {
      if (arr2 == null) {
        return arr1;
      }
      var i = -1, len = arr2.length;
      while (++i < len) {
        if (indexOf(arr1, arr2[i]) === -1) {
          arr1.push(arr2[i]);
        }
      }
      return arr1;
    }
    module.exports = combine;
  },
  'node_modules/mout/array/remove.js': function (require, module, exports, global, __filename, __dirname) {
    var indexOf = require('node_modules/mout/array/indexOf.js');
    function remove(arr, item) {
      var idx = indexOf(arr, item);
      if (idx !== -1)
        arr.splice(idx, 1);
    }
    module.exports = remove;
  },
  'node_modules/mout/lang/createObject.js': function (require, module, exports, global, __filename, __dirname) {
    var mixIn = require('node_modules/mout/object/mixIn.js');
    function createObject(parent, props) {
      function F() {
      }
      F.prototype = parent;
      return mixIn(new F(), props);
    }
    module.exports = createObject;
  },
  'node_modules/prime/index.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var hasOwn = require('node_modules/mout/object/hasOwn.js'), mixIn = require('node_modules/mout/object/mixIn.js'), create = require('node_modules/mout/lang/createObject.js'), kindOf = require('node_modules/mout/lang/kindOf.js');
    var hasDescriptors = true;
    try {
      Object.defineProperty({}, '~', {});
      Object.getOwnPropertyDescriptor({}, '~');
    } catch (e) {
      hasDescriptors = false;
    }
    var hasEnumBug = !{ valueOf: 0 }.propertyIsEnumerable('valueOf'), buggy = [
        'toString',
        'valueOf'
      ];
    var verbs = /^constructor|inherits|mixin$/;
    var implement = function (proto) {
      var prototype = this.prototype;
      for (var key in proto) {
        if (key.match(verbs))
          continue;
        if (hasDescriptors) {
          var descriptor = Object.getOwnPropertyDescriptor(proto, key);
          if (descriptor) {
            Object.defineProperty(prototype, key, descriptor);
            continue;
          }
        }
        prototype[key] = proto[key];
      }
      if (hasEnumBug)
        for (var i = 0; key = buggy[i]; i++) {
          var value = proto[key];
          if (value !== Object.prototype[key])
            prototype[key] = value;
        }
      return this;
    };
    var prime = function (proto) {
      if (kindOf(proto) === 'Function')
        proto = { constructor: proto };
      var superprime = proto.inherits;
      var constructor = hasOwn(proto, 'constructor') ? proto.constructor : superprime ? function () {
        return superprime.apply(this, arguments);
      } : function () {
      };
      if (superprime) {
        mixIn(constructor, superprime);
        var superproto = superprime.prototype;
        var cproto = constructor.prototype = create(superproto);
        constructor.parent = superproto;
        cproto.constructor = constructor;
      }
      if (!constructor.implement)
        constructor.implement = implement;
      var mixins = proto.mixin;
      if (mixins) {
        if (kindOf(mixins) !== 'Array')
          mixins = [mixins];
        for (var i = 0; i < mixins.length; i++)
          constructor.implement(create(mixins[i].prototype));
      }
      return constructor.implement(proto);
    };
    module.exports = prime;
  },
  'node_modules/mout/array/reduce.js': function (require, module, exports, global, __filename, __dirname) {
    function reduce(arr, fn, initVal) {
      var hasInit = arguments.length > 2, result = initVal;
      if (arr == null || !arr.length) {
        if (!hasInit) {
          throw new Error('reduce of empty array with no initial value');
        } else {
          return initVal;
        }
      }
      var i = -1, len = arr.length;
      while (++i < len) {
        if (!hasInit) {
          result = arr[i];
          hasInit = true;
        } else {
          result = fn(result, arr[i], i, arr);
        }
      }
      return result;
    }
    module.exports = reduce;
  },
  'node_modules/mout/time/now.js': function (require, module, exports, global, __filename, __dirname) {
    function now() {
      return now.get();
    }
    now.get = typeof Date.now === 'function' ? Date.now : function () {
      return +new Date();
    };
    module.exports = now;
  },
  'node_modules/prime/defer.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var kindOf = require('node_modules/mout/lang/kindOf.js'), now = require('node_modules/mout/time/now.js'), forEach = require('node_modules/mout/array/forEach.js'), indexOf = require('node_modules/mout/array/indexOf.js');
    var callbacks = {
      timeout: {},
      frame: [],
      immediate: []
    };
    var push = function (collection, callback, context, defer) {
      var iterator = function () {
        iterate(collection);
      };
      if (!collection.length)
        defer(iterator);
      var entry = {
        callback: callback,
        context: context
      };
      collection.push(entry);
      return function () {
        var io = indexOf(collection, entry);
        if (io > -1)
          collection.splice(io, 1);
      };
    };
    var iterate = function (collection) {
      var time = now();
      forEach(collection.splice(0), function (entry) {
        entry.callback.call(entry.context, time);
      });
    };
    var defer = function (callback, argument, context) {
      return kindOf(argument) === 'Number' ? defer.timeout(callback, argument, context) : defer.immediate(callback, argument);
    };
    if (global.process && process.nextTick) {
      defer.immediate = function (callback, context) {
        return push(callbacks.immediate, callback, context, process.nextTick);
      };
    } else if (global.setImmediate) {
      defer.immediate = function (callback, context) {
        return push(callbacks.immediate, callback, context, setImmediate);
      };
    } else if (global.postMessage && global.addEventListener) {
      addEventListener('message', function (event) {
        if (event.source === global && event.data === '@deferred') {
          event.stopPropagation();
          iterate(callbacks.immediate);
        }
      }, true);
      defer.immediate = function (callback, context) {
        return push(callbacks.immediate, callback, context, function () {
          postMessage('@deferred', '*');
        });
      };
    } else {
      defer.immediate = function (callback, context) {
        return push(callbacks.immediate, callback, context, function (iterator) {
          setTimeout(iterator, 0);
        });
      };
    }
    var requestAnimationFrame = global.requestAnimationFrame || global.webkitRequestAnimationFrame || global.mozRequestAnimationFrame || global.oRequestAnimationFrame || global.msRequestAnimationFrame || function (callback) {
      setTimeout(callback, 1000 / 60);
    };
    defer.frame = function (callback, context) {
      return push(callbacks.frame, callback, context, requestAnimationFrame);
    };
    var clear;
    defer.timeout = function (callback, ms, context) {
      var ct = callbacks.timeout;
      if (!clear)
        clear = defer.immediate(function () {
          clear = null;
          callbacks.timeout = {};
        });
      return push(ct[ms] || (ct[ms] = []), callback, context, function (iterator) {
        setTimeout(iterator, ms);
      });
    };
    module.exports = defer;
  },
  'node_modules/prime/emitter.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var indexOf = require('node_modules/mout/array/indexOf.js'), forEach = require('node_modules/mout/array/forEach.js');
    var prime = require('node_modules/prime/index.js'), defer = require('node_modules/prime/defer.js');
    var slice = Array.prototype.slice;
    var Emitter = prime({
      on: function (event, fn) {
        var listeners = this._listeners || (this._listeners = {}), events = listeners[event] || (listeners[event] = []);
        if (indexOf(events, fn) === -1)
          events.push(fn);
        return this;
      },
      off: function (event, fn) {
        var listeners = this._listeners, events, key, length = 0;
        if (listeners && (events = listeners[event])) {
          var io = indexOf(events, fn);
          if (io > -1)
            events.splice(io, 1);
          if (!events.length)
            delete listeners[event];
          for (var l in listeners)
            return this;
          delete this._listeners;
        }
        return this;
      },
      emit: function (event) {
        var self = this, args = slice.call(arguments, 1);
        var emit = function () {
          var listeners = self._listeners, events;
          if (listeners && (events = listeners[event])) {
            forEach(events.slice(0), function (event) {
              return event.apply(self, args);
            });
          }
        };
        if (args[args.length - 1] === Emitter.EMIT_SYNC) {
          args.pop();
          emit();
        } else {
          defer(emit);
        }
        return this;
      }
    });
    Emitter.EMIT_SYNC = {};
    module.exports = Emitter;
  },
  'node_modules/spotify-events/center.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var Emitter = require('node_modules/prime/emitter.js');
    var forIn = require('node_modules/mout/object/forIn.js');
    var emitter = new Emitter();
    forIn(emitter, function (method, key) {
      exports[key] = method;
    });
  },
  'node_modules/prime/map.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var indexOf = require('node_modules/mout/array/indexOf.js');
    var prime = require('node_modules/prime/index.js');
    var Map = prime({
      constructor: function Map() {
        this.length = 0;
        this._values = [];
        this._keys = [];
      },
      set: function (key, value) {
        var index = indexOf(this._keys, key);
        if (index === -1) {
          this._keys.push(key);
          this._values.push(value);
          this.length++;
        } else {
          this._values[index] = value;
        }
        return this;
      },
      get: function (key) {
        var index = indexOf(this._keys, key);
        return index === -1 ? null : this._values[index];
      },
      count: function () {
        return this.length;
      },
      forEach: function (method, context) {
        for (var i = 0, l = this.length; i < l; i++) {
          if (method.call(context, this._values[i], this._keys[i], this) === false)
            break;
        }
        return this;
      },
      map: function (method, context) {
        var results = new Map();
        this.forEach(function (value, key) {
          results.set(key, method.call(context, value, key, this));
        }, this);
        return results;
      },
      filter: function (method, context) {
        var results = new Map();
        this.forEach(function (value, key) {
          if (method.call(context, value, key, this))
            results.set(key, value);
        }, this);
        return results;
      },
      every: function (method, context) {
        var every = true;
        this.forEach(function (value, key) {
          if (!method.call(context, value, key, this))
            return every = false;
        }, this);
        return every;
      },
      some: function (method, context) {
        var some = false;
        this.forEach(function (value, key) {
          if (method.call(context, value, key, this))
            return !(some = true);
        }, this);
        return some;
      },
      indexOf: function (value) {
        var index = indexOf(this._values, value);
        return index > -1 ? this._keys[index] : null;
      },
      remove: function (value) {
        var index = indexOf(this._values, value);
        if (index !== -1) {
          this._values.splice(index, 1);
          this.length--;
          return this._keys.splice(index, 1)[0];
        }
        return null;
      },
      unset: function (key) {
        var index = indexOf(this._keys, key);
        if (index !== -1) {
          this._keys.splice(index, 1);
          this.length--;
          return this._values.splice(index, 1)[0];
        }
        return null;
      },
      keys: function () {
        return this._keys.slice();
      },
      values: function () {
        return this._values.slice();
      }
    });
    var map = function () {
      return new Map();
    };
    map.prototype = Map.prototype;
    module.exports = map;
  },
  'node_modules/mout/function/identity.js': function (require, module, exports, global, __filename, __dirname) {
    function identity(val) {
      return val;
    }
    module.exports = identity;
  },
  'node_modules/mout/function/prop.js': function (require, module, exports, global, __filename, __dirname) {
    function prop(name) {
      return function (obj) {
        return obj[name];
      };
    }
    module.exports = prop;
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
  'node_modules/views/scripts/buttons.js': function (require, module, exports, global, __filename, __dirname) {
    (function (device, Library, models, Toplist, Relations, Popup, buttonsStrings, css, dom, dnd, touch, ContextApp, frame, Logger) {
      var _ = SP.bind(buttonsStrings.get, buttonsStrings);
      exports.Button = Button;
      exports.CustomButton = CustomButton;
      exports.ShareButton = ShareButton;
      exports.StartRadioButton = StartRadioButton;
      exports.SubscribeButton = SubscribeButton;
      exports.QuickActionButtons = QuickActionButtons;
      exports.AddToCollectionButton = AddToCollectionButton;
      exports.PlayButton = PlayButton;
      if (device.mobile) {
        var preloadImg = document.createElement('img');
        preloadImg.src = '$views/img/list-mobile-contextbutton' + (window.devicePixelRatio === 2 ? '@2x' : '') + '.png';
      }
      if (dnd.drag.hasDragSupport) {
        window.addEventListener('dragstart', function (e) {
          var element = e.target;
          if (element.hasAttribute('data-sp-button')) {
            e.preventDefault();
          }
        }, false);
      }
      function BaseButton(cssClass, opt_label, opt_icon) {
        this.accentuated = false;
        this.disabled = false;
        this._accentuatedEffect = null;
        this._nodeClass = cssClass;
        this._setupTouch();
        this._buildButton();
        this._addBehavior();
        this.label = '';
        if (typeof opt_label === 'string') {
          this.setLabel(opt_label);
        }
        this.icon = '';
        if (typeof opt_icon === 'string') {
          this.setIcon(opt_icon);
        }
        this.addEventListener('click', this._clicked);
      }
      SP.inherit(BaseButton, models.Observable);
      var measureNode = document.createElement('button');
      measureNode.style.position = 'absolute';
      measureNode.style.visibility = 'hidden';
      var measureNodeSpan = document.createElement('span');
      measureNodeSpan.className = 'sp-button-text';
      measureNode.appendChild(measureNodeSpan);
      var labelMeasurements = {};
      BaseButton.prototype.getTextWidth = function (text, opt_cssClass) {
        var cssClass = opt_cssClass || 'sp-no-classname';
        if (labelMeasurements[text] && labelMeasurements[text][cssClass]) {
          return labelMeasurements[text][cssClass];
        }
        document.body.appendChild(measureNode);
        measureNode.className = opt_cssClass || this.node.className;
        measureNodeSpan.textContent = text;
        var width = measureNodeSpan.getBoundingClientRect().width;
        document.body.removeChild(measureNode);
        if (!labelMeasurements[text])
          labelMeasurements[text] = {};
        labelMeasurements[text][cssClass] = width;
        return width;
      };
      BaseButton.prototype.setWidthFromLabels = function (labels, opt_icons) {
        var padding = this._touchDevice ? 0 : 4;
        var iconWidth = this._touchDevice ? 46 : 20;
        var widths = [];
        var icons = opt_icons || [];
        for (var i = 0, l = labels.length; i < l; i++) {
          icons[i] = icons[i] ? iconWidth : 0;
          widths.push(this.getTextWidth(labels[i]) + icons[i]);
        }
        var width = Math.max.apply(Math, widths);
        this.node.style.minWidth = width + padding * 2 + 'px';
      };
      BaseButton.prototype.setLabel = function (label) {
        this.label = label;
        this._label.data = label || '';
      };
      BaseButton.prototype.setIcon = function (url, opt_cssClass) {
        if (typeof opt_cssClass === 'string') {
          this.setIconClass(opt_cssClass);
        }
        this.icon = url;
        this._icon.style.backgroundImage = url ? 'url("' + url + '")' : null;
        this._icon.style.display = url ? 'inline-block' : 'none';
      };
      BaseButton.prototype.setIconClass = function (cssClass) {
        css.removeClass(this._icon, this._iconClass);
        css.addClass(this._icon, cssClass);
        this._iconClass = cssClass;
      };
      BaseButton.prototype.setDisabled = function (disabled) {
        this.disabled = !!disabled;
        if (this.disabled) {
          this.node.setAttribute('disabled', 'disabled');
        } else {
          this.node.removeAttribute('disabled');
        }
      };
      BaseButton._accentuationEffects = {
        'positive': 'sp-button-accentuated-positive',
        'negative': 'sp-button-accentuated-negative'
      };
      BaseButton.prototype.setAccentuated = function (accentuated, opt_effect) {
        this.accentuated = accentuated;
        var effects = BaseButton._accentuationEffects;
        if (this._accentuatedEffect in effects) {
          css.removeClass(this.node, effects[this._accentuatedEffect]);
          this._accentuatedEffect = null;
        }
        if (accentuated) {
          var defaultEffect = 'positive';
          var effect = effects[opt_effect] ? opt_effect : defaultEffect;
          var effectCSSClass = effects[effect];
          css.addClass(this.node, 'sp-button-accentuated');
          css.addClass(this.node, effectCSSClass);
          this._accentuatedEffect = effect;
        } else {
          css.removeClass(this.node, 'sp-button-accentuated');
        }
      };
      BaseButton.prototype.contains = function (element) {
        var node = this.node;
        if (node === element || node.contains && node.contains(element))
          return true;
        var body = document.body;
        while (element && element !== body) {
          if (element === node)
            return true;
          element = element.parentNode;
        }
        return false;
      };
      BaseButton.prototype._setupTouch = function () {
        this._touchDevice = device.touch && device.mobile;
        this.touchPreventsScrolling = false;
      };
      BaseButton.prototype._buildButton = function () {
        this.node = document.createElement('button');
        this.node.setAttribute('type', 'button');
        if (dnd.drag.hasDragSupport) {
          this.node.setAttribute('draggable', 'true');
        }
        this.node.setAttribute('data-sp-button', 'true');
        css.addClass(this.node, this._nodeClass);
        if (this._touchDevice) {
          css.addClass(this.node, 'sp-button-touch');
        }
        if (this._touchDevice) {
          var hitArea = document.createElement('span');
          css.addClass(hitArea, 'sp-button-hitarea');
          this.node.appendChild(hitArea);
          this.hitArea = hitArea;
        } else {
          this.hitArea = this.node;
        }
        var text = document.createElement('span');
        css.addClass(text, 'sp-button-text');
        this.node.appendChild(text);
        this._icon = document.createElement('div');
        css.addClass(this._icon, 'sp-button-icon');
        if (this.icon) {
          this._icon.style.backgroundImage = 'url("' + this.icon + '")';
        }
        text.appendChild(this._icon);
        this._label = document.createTextNode(this.label || '');
        text.appendChild(this._label);
      };
      BaseButton.prototype._addBehavior = function () {
        var self = this;
        if (this._touchDevice) {
          touch.selection.on('select', this.hitArea, function (event) {
            if (self.disabled)
              return;
            self._active = true;
            self._pushButton();
            event.stopPropagation();
          });
          touch.selection.on('deselect', this.hitArea, function (event) {
            self._releaseButton();
          });
          touch.selection.on('tap', this.hitArea, function (event) {
            if (self.disabled || !self._active)
              return;
            event.stopPropagation();
            self._active = false;
            self.dispatchEvent('pointerend');
            self.dispatchEvent({
              type: 'click',
              browserEvent: event
            });
          });
        } else {
          this.hitArea.addEventListener('mousedown', function (event) {
            self._startHandler(event);
          });
          this._boundMoveHandler = function (event) {
            self._moveHandler(event);
          };
          this._boundEndHandler = function (event) {
            self._endHandler(event);
          };
        }
      };
      BaseButton.prototype._startHandler = function (event) {
        if (this.disabled) {
          return;
        }
        if (event.button !== undefined && event.button !== 0)
          return;
        BaseButton._isMac = BaseButton._isMac || navigator.userAgent.indexOf('Macintosh') > -1 ? true : false;
        if (BaseButton._isMac && event.ctrlKey)
          return;
        if (!this._touchDevice) {
          this._buttonPos = this._getPos();
          document.addEventListener('mousemove', this._boundMoveHandler);
          document.addEventListener('mouseup', this._boundEndHandler);
        }
        this._active = true;
        this._pushButton();
        event.stopPropagation();
      };
      BaseButton.prototype._moveHandler = function (event) {
        if (!this.disabled && this._active) {
          event.stopPropagation();
          if (this._isPointerInside(event))
            this._pushButton();
          else
            this._releaseButton();
        }
      };
      BaseButton.prototype._endHandler = function (event) {
        document.removeEventListener('mousemove', this._boundMoveHandler);
        document.removeEventListener('mouseup', this._boundEndHandler);
        if (!this.disabled && this._active) {
          event.stopPropagation();
          this._active = false;
          this._releaseButton();
          this.dispatchEvent('pointerend');
          if (this._isPointerInside(event)) {
            this.dispatchEvent({
              type: 'click',
              browserEvent: event
            });
          }
        }
      };
      BaseButton.prototype._pushButton = function () {
        css.addClass(this.node, 'sp-button-active');
      };
      BaseButton.prototype._releaseButton = function () {
        css.removeClass(this.node, 'sp-button-active');
      };
      BaseButton.prototype._getPos = function () {
        var scrollValues = this._scrollValues || {};
        scrollValues.x = window.pageXOffset || document.documentElement.scrollLeft;
        scrollValues.y = window.pageYOffset || document.documentElement.scrollTop;
        this._scrollValues = scrollValues;
        var buttonPos = this._buttonPos || {};
        var rect = this.hitArea.getBoundingClientRect();
        buttonPos.left = rect.left + scrollValues.x;
        buttonPos.top = rect.top + scrollValues.y;
        buttonPos.right = buttonPos.left + rect.width;
        buttonPos.bottom = buttonPos.top + rect.height;
        return buttonPos;
      };
      BaseButton.prototype._getPointerPos = function (event) {
        return {
          x: this._touchDevice ? event.changedTouches[0].pageX : event.pageX,
          y: this._touchDevice ? event.changedTouches[0].pageY : event.pageY
        };
      };
      BaseButton.prototype._isPointerInside = function (event) {
        var pos = this._getPointerPos(event);
        var buttonPos = this._buttonPos || this._getPos();
        var isInsideX = pos.x > buttonPos.left && pos.x <= buttonPos.right;
        var isInsideY = pos.y > buttonPos.top && pos.y <= buttonPos.bottom;
        return isInsideX && isInsideY;
      };
      function Button(opt_label, opt_icon) {
        BaseButton.call(this, 'sp-button', opt_label, opt_icon);
        this.size = 'normal';
      }
      SP.inherit(Button, BaseButton);
      Button.withLabel = function (opt_label, opt_icon) {
        return new Button(opt_label, opt_icon);
      };
      Button._sizes = {
        normal: '',
        small: 'sp-button-small',
        large: 'sp-button-large'
      };
      Button.prototype.setSize = function (size) {
        if (this.size == size)
          return;
        if (!(size in Button._sizes)) {
          throw new Error(size + ' is not a valid size');
        }
        css.removeClass(this.node, Button._sizes[this.size]);
        css.addClass(this.node, Button._sizes[size]);
        this.size = size;
      };
      Button.prototype._buildButton = function () {
        Button._superClass._buildButton.call(this);
        var bg = document.createElement('span');
        css.addClass(bg, 'sp-button-background');
        this.node.appendChild(bg);
      };
      var player = models.player;
      function PlayButton(item, opt_options) {
        var options = {
          size: 'medium',
          position: undefined,
          context: null,
          index: -1,
          getIndexInContext: function () {
            return -1;
          }
        };
        if (opt_options) {
          for (var prop in opt_options) {
            if (opt_options.hasOwnProperty(prop)) {
              options[prop] = opt_options[prop];
            }
          }
        }
        this.options = options;
        if (device.container === 'ios' && options.size !== 'medium') {
          options.size = 'medium';
        }
        var baseClass = this._baseClass = 'sp-button-play';
        PlayButton._superClass.constructor.call(this, baseClass);
        this.setItem(item, options.context, options.getIndexInContext, options.getContextGroupData);
        this.setSize(options.size);
        this.setCentered(options.position === 'centered');
        var self = this;
        player.load([
          'playing',
          'track',
          'context'
        ]).done(function () {
          var timeout;
          var changeState = function () {
            if (self.node.parentNode) {
              self._changeState();
              clearTimeout(timeout);
            } else {
              timeout = setTimeout(changeState, 100);
            }
          };
          changeState();
        });
        player.addEventListener('change', function () {
          self._changeState();
        });
        this.addEventListener('click', function () {
          if (self._playing) {
            self._pause();
            self.dispatchEvent('pause-click');
          } else {
            self._play();
            self.dispatchEvent('play-click');
          }
        });
      }
      SP.inherit(PlayButton, BaseButton);
      var playButtonSizes = [
        'xs',
        'small',
        'medium',
        'large',
        'xl'
      ];
      PlayButton.prototype.setSize = function (size) {
        if (playButtonSizes.indexOf(size) === -1)
          return;
        if (size === this._size)
          return;
        css.removeClass(this.node, this._baseClass + '-' + this._size);
        this._size = size;
        css.addClass(this.node, this._baseClass + '-' + size);
      };
      PlayButton.prototype.setCentered = function (enable) {
        var value = enable ? 'centered' : undefined;
        if (this._position === value)
          return;
        this._position = value;
        if (enable) {
          css.addClass(this.node, this._baseClass + '-centered');
        } else {
          css.removeClass(this.node, this._baseClass + '-centered');
        }
      };
      PlayButton.prototype.setItem = function (item, opt_context, opt_getIndexInContext, opt_getContextGroupData) {
        var self = this;
        this.item = item;
        this._user = null;
        var uri = this._uri = item.uri;
        this.setContext(opt_context, opt_getIndexInContext, opt_getContextGroupData);
        this._type = 'context';
        if (item instanceof models.Track)
          this._type = 'track';
        else if (item instanceof models.Artist)
          this._type = 'artist';
        var hasContext = this.context || this._type === 'context';
        if (hasContext) {
          var context = this.context || this.item;
          var match = context.uri.match(/^spotify:user:(.*?):/);
          if (match)
            this._user = match[1];
        }
        if (this._type === 'artist') {
          match = uri.match(/^spotify:artist:(\w+)/);
          if (match) {
            this._uri = 'spotify:artist:' + match[1];
            Toplist.forArtist(this.item).load('tracks').done(function (toplist) {
              self.item = toplist.tracks;
              self._changeState();
            });
          }
        }
        this._changeState();
      };
      PlayButton.prototype.setContext = function (opt_context, opt_getIndexInContext, opt_getContextGroupData) {
        this.context = opt_context || null;
        this.options.getIndexInContext = opt_getIndexInContext;
        this.options.getContextGroupData = opt_getContextGroupData;
      };
      PlayButton.prototype._isPlaying = function () {
        if (!player.track)
          return false;
        var playerContextURI = player.context && player.context.uri || '';
        if (this._user) {
          playerContextURI = playerContextURI.replace(':@:', ':' + this._user + ':');
        }
        if (this._type === 'track') {
          var isSameUri = player.track && player.track.uri === this.item.uri;
          var isSameIndex = this.options.getIndexInContext && player.index === this.options.getIndexInContext(this.item, this.context, this.node);
          var isTrackContext = playerContextURI === player.track.uri;
          var bothHaveContext = playerContextURI && this.context;
          var noneHaveContext = !playerContextURI && !this.context;
          var isSameContext = false;
          if (noneHaveContext) {
            isSameContext = true;
          } else if (bothHaveContext) {
            isSameContext = playerContextURI === this.context.uri || playerContextURI === this.context.uri + ':tracks';
          } else if (isSameUri && isTrackContext) {
            isSameContext = true;
          }
          var isSameTrack = bothHaveContext ? isSameIndex : isSameUri;
          return isSameTrack && isSameContext;
        }
        if (!player.context || !player.context.uri)
          return false;
        if (this._type === 'artist') {
          playerContextURI = playerContextURI.replace(/:top:tracks$/, '');
        }
        var index = this.options.index;
        if (this._type === 'context' && (index > -1 && player.index !== index))
          return false;
        return playerContextURI === this._uri;
      };
      PlayButton.prototype._changeState = function (opt_playing) {
        var playing = opt_playing;
        var node = this.node;
        var baseClass = this._baseClass;
        if (playing === undefined) {
          playing = player.playing;
          if (!this._isPlaying())
            playing = false;
        }
        if (playing && !this._playing) {
          this._playing = true;
          css.addClass(node, baseClass + '-pause');
          this.dispatchEvent('play');
        } else if (!playing && this._playing) {
          this._playing = false;
          css.removeClass(node, baseClass + '-pause');
          this.dispatchEvent('pause');
        }
      };
      PlayButton.prototype._play = function () {
        if (!this._playing) {
          this._changeState(true);
          if (this._isPlaying()) {
            player.play();
          } else {
            if (this.options.getContextGroupData) {
              var contextGroupData = this.options.getContextGroupData();
              if (contextGroupData.group) {
                var indexInContext = this.options.getIndexInContext ? this.options.getIndexInContext(this.item, this.context, this.node) : 0;
                player.playContextGroup(contextGroupData.group, contextGroupData.index || 0, indexInContext).fail(this, function (a, e) {
                  this._changeState(false);
                });
              }
            } else if (this._type === 'track') {
              if (this.context) {
                var index = this.options.getIndexInContext(this.item, this.context, this.node);
                index = index > -1 ? index : null;
                player.playContext(this.context, index).fail(this, function () {
                  this._changeState(false);
                });
              } else {
                player.playTrack(this.item).fail(this, function () {
                  this._changeState(false);
                });
              }
            } else {
              player.playContext(this.item, this.options.index).fail(this, function () {
                this._changeState(false);
              });
            }
          }
        }
      };
      PlayButton.prototype._pause = function () {
        if (this._playing) {
          this._changeState(false);
          player.pause();
        }
      };
      PlayButton.forItem = function (item, opt_options) {
        return new PlayButton(item, opt_options);
      };
      function CustomButton(cssClass, label, icon) {
        BaseButton.call(this, 'sp-button-empty ' + cssClass, label, icon);
      }
      SP.inherit(CustomButton, BaseButton);
      CustomButton.withClass = function (cssClass, opt_label, opt_icon) {
        return new CustomButton(cssClass, opt_label, opt_icon);
      };
      function ShareButton(item) {
        Button.call(this, _('ButtonShare'));
        this.setIconClass('sp-icon-share');
        this.item = item;
      }
      SP.inherit(ShareButton, Button);
      ShareButton.forAlbum = function (album) {
        if (!(album instanceof models.Album))
          throw new Error('not an Album');
        return new ShareButton(album);
      };
      ShareButton.forArtist = function (artist) {
        if (!(artist instanceof models.Artist))
          throw new Error('not an Artist');
        return new ShareButton(artist);
      };
      ShareButton.forPlaylist = function (playlist) {
        if (!(playlist instanceof models.Playlist))
          throw new Error('not a Playlist');
        return new ShareButton(playlist);
      };
      ShareButton.forTrack = function (track) {
        if (!(track instanceof models.Track))
          throw new Error('not a Track');
        return new ShareButton(track);
      };
      ShareButton.prototype._clicked = function () {
        var message = '';
        var rect = this.node.getBoundingClientRect();
        var x = rect.left + rect.width / 2;
        var y = rect.top + rect.height / 2;
        var point = {
          x: x,
          y: y
        };
        models.client.showShareUI(this.item.uri, message, point);
      };
      function StartRadioButton(item) {
        Button.call(this, _('ButtonStartRadio'));
        this.setIconClass('sp-icon-radio');
        this.item = item;
      }
      SP.inherit(StartRadioButton, Button);
      StartRadioButton.forAlbum = function (album) {
        if (!(album instanceof models.Album))
          throw new Error('not an Album');
        return new StartRadioButton(album);
      };
      StartRadioButton.forArtist = function (artist) {
        if (!(artist instanceof models.Artist))
          throw new Error('not an Artist');
        return new StartRadioButton(artist);
      };
      StartRadioButton.forPlaylist = function (playlist) {
        if (!(playlist instanceof models.Playlist))
          throw new Error('not a Playlist');
        return new StartRadioButton(playlist);
      };
      StartRadioButton.forTrack = function (track) {
        if (!(track instanceof models.Track))
          throw new Error('not a Track');
        return new StartRadioButton(track);
      };
      StartRadioButton.prototype._clicked = function () {
        var uri = this.item.uri.replace(/^spotify:/, 'spotify:radio:');
        models.application.openURI(uri);
      };
      function SubscribeButton(item, opt_options) {
        if (!opt_options)
          opt_options = {};
        var size = opt_options.size || '';
        this._useIcon = opt_options.icon === undefined ? true : !!opt_options.icon;
        this._fullLabel = !!opt_options.fullLabel;
        this._initialFollowState = opt_options.initialFollowState === undefined ? null : !!opt_options.initialFollowState;
        var self = this;
        Button.call(this, '');
        this.setDisabled(true);
        this._setLabels(item);
        if (size)
          css.addClass(this.node, 'sp-button-' + size);
        css.addClass(this.node, 'sp-button-subscribe');
        this._pending = false;
        this._subscribed = null;
        this._isAutoAccentuated = true;
        this._isLimited = null;
        var setMode = function (e, hover) {
          self.setAccentuated(!!hover, !!hover ? 'negative' : undefined);
          self.setLabel(!!hover ? self._subscribeLabels.unsubscribe : self._subscribeLabels.subscribed);
        };
        this.addEventListener('pointerend', function (e) {
          if (self._subscribed) {
            setMode(e, false);
          }
        });
        if (!this._touchDevice) {
          var mouseHandler = function (e) {
            if (self.disabled) {
              return;
            }
            self._isMouseHovering = e.type === 'mouseover';
            if (self._subscribed) {
              if (self._active && self._isMouseHovering || !self._active) {
                setMode(e, self._isMouseHovering);
              }
            }
          };
          dom.addEventListener(this.node, 'mouseover', mouseHandler);
          dom.addEventListener(this.node, 'mouseout', mouseHandler);
          this._mouseHandler = mouseHandler;
        }
        this._setSubscribed(false);
        this.setItem(item);
      }
      SP.inherit(SubscribeButton, Button);
      SubscribeButton.prototype.setItem = function (item) {
        var self = this;
        if (this.item) {
          this.item.removeEventListener('change:subscribed', this._update);
        }
        this.item = item;
        this._itemLoaded = true;
        var onLoadedCallbackRun = false;
        if (item instanceof models.Profile) {
          this._itemLoaded = false;
          item.load('artist', 'user').done(function () {
            if (item.user) {
              self.item = item.user;
            } else if (item.artist) {
              self.item = item.artist;
            }
            self._itemLoaded = true;
            onLoaded();
          });
        }
        function onLoaded() {
          if (onLoadedCallbackRun)
            return;
          onLoadedCallbackRun = true;
          if (self._fullLabel) {
            if (item.user && item.artist) {
              self._setLabels(item.artist);
            } else {
              self._setLabels(self.item);
            }
          }
          function update(isSubscribed) {
            self._setSubscribed(isSubscribed);
          }
          self._update = function () {
            update(self.item.subscribed);
          };
          function done(isSubscribed) {
            update(isSubscribed);
            self.setDisabled(false);
            frame.request(function () {
              self.dispatchEvent('load');
            });
            self.item.addEventListener('change:subscribed', self._update);
          }
          models.client.load('features').done(function (client) {
            self._isLimited = client.features['limitedSubscribe'];
            if (self._initialFollowState !== null) {
              done(self._initialFollowState);
              if (!self._isLimited) {
                self.item.load('subscribed').done(function () {
                  self._update();
                });
              }
            } else {
              if (!self._isLimited) {
                self.item.load('subscribed').done(function () {
                  done(self.item.subscribed);
                });
              } else {
                done(false);
              }
            }
          });
        }
        ;
        if (this._itemLoaded)
          onLoaded();
      };
      SubscribeButton.prototype.setSize = function (size) {
        SubscribeButton._superClass.setSize.call(this, size);
        this.setWidthFromLabels(this._subscribeLabels, this._subscribeIcons);
      };
      SubscribeButton.prototype.setAutoAccentuated = function (autoAccentuated) {
        this._isAutoAccentuated = !!autoAccentuated;
        if (this._isAutoAccentuated) {
          this.setAccentuated(!this._subscribed);
        } else {
          this.setAccentuated(false);
        }
      };
      SubscribeButton.prototype._setLabels = function (item) {
        var subscribeLabel, unsubscribeLabel, subscribedLabel;
        if (this._fullLabel) {
          if (item instanceof models.Artist) {
            subscribeLabel = _('ButtonSubscribeArtist');
            unsubscribeLabel = _('ButtonUnsubscribeArtist');
            subscribedLabel = _('ButtonSubscribedArtist');
          } else if (item instanceof models.Playlist) {
            subscribeLabel = _('ButtonSubscribePlaylist');
            unsubscribeLabel = _('ButtonUnsubscribePlaylist');
            subscribedLabel = _('ButtonSubscribedPlaylist');
          } else if (item instanceof models.User) {
            subscribeLabel = _('ButtonSubscribeUser');
            unsubscribeLabel = _('ButtonUnsubscribeUser');
            subscribedLabel = _('ButtonSubscribedUser');
          }
        } else {
          subscribeLabel = _('ButtonSubscribe');
          unsubscribeLabel = _('ButtonUnsubscribe');
          subscribedLabel = _('ButtonSubscribed');
        }
        var _labels = this._subscribeLabels = {
          subscribe: subscribeLabel,
          subscribed: subscribedLabel
        };
        var _icons = this._subscribeIcons = {
          subscribe: this._useIcon,
          subscribed: false
        };
        var labels = [
          _labels.subscribe,
          _labels.subscribed
        ];
        var icons = [
          _icons.subscribe,
          _icons.subscribed
        ];
        if (!this._touchDevice) {
          _labels.unsubscribe = unsubscribeLabel;
          _icons.unsubscribe = false;
          labels.push(_labels.unsubscribe);
          icons.push(_icons.unsubscribe);
        }
        this.setWidthFromLabels(labels, icons);
      };
      SubscribeButton.prototype._clicked = function () {
        if (!this._itemLoaded)
          return;
        var subscribed = this.item.subscribed;
        if (this._isLimited) {
          SP.request('client_show_limited_feature_ui', ['limitedSubscribe'], function () {
          }, function () {
          });
          return;
        }
        if (typeof subscribed != 'boolean' || this._pending)
          return;
        this._setSubscribed(!subscribed);
        this._updateSubscription(!subscribed);
      };
      SubscribeButton.prototype._call = function (object, method) {
        if (!this._itemLoaded)
          return;
        this._pending = true;
        return object[method](this.item).done(this, this._done).fail(this, this._fail);
      };
      SubscribeButton.prototype._done = function () {
        this._pending = false;
        this.dispatchEvent({
          type: this._subscribed ? 'subscribe' : 'unsubscribe',
          item: this.item
        });
      };
      SubscribeButton.prototype._fail = function (error) {
        this._pending = false;
        this.dispatchEvent({
          type: (this._subscribed ? 'subscribe' : 'unsubscribe') + '-fail',
          item: this.item,
          error: error
        });
        this._setSubscribed(this.item.subscribed);
      };
      SubscribeButton.prototype._setSubscribed = function (subscribe) {
        if (!this._itemLoaded)
          return;
        if (this._subscribed === subscribe)
          return;
        this._subscribed = subscribe;
        if (this._isAutoAccentuated) {
          this.setAccentuated(!subscribe);
        }
        this.setLabel(subscribe ? this._subscribeLabels.subscribed : this._subscribeLabels.subscribe);
        if (this._useIcon) {
          this.setIconClass(subscribe ? '' : 'sp-icon-add');
        }
        if (this._isMouseHovering) {
          this._mouseHandler.call(this.node, { type: 'mouseover' });
        }
      };
      SubscribeButton.prototype._updateSubscription = function (subscribe) {
        throw new Error('SubscribeButton _updateSubscription not implemented');
      };
      function SubscribePlaylistButton(playlist, opt_options) {
        if (!(playlist instanceof models.Playlist))
          throw new Error('not a Playlist');
        SubscribeButton.call(this, playlist, opt_options);
      }
      SP.inherit(SubscribePlaylistButton, SubscribeButton);
      SubscribePlaylistButton.prototype._showAutoFollowPopup = function (isAviciiPlaylist) {
        var self = this;
        var logger = Logger.forTag('playlist-follow-popup', 'playlist-auto-follow-popup');
        if (this._popup) {
          this._popup.dispose();
        }
        var fragment = document.createDocumentFragment();
        var paragraph = document.createElement('p');
        paragraph.innerHTML = isAviciiPlaylist ? _('PopupAviciiAutoFollow') : _('PopupPlaylistSubscribeLine1', '<strong>' + this.item.owner.name.decodeForHtml() + '</strong>') + '<br><br>' + _('PopupPlaylistSubscribeLine2');
        fragment.appendChild(paragraph);
        var controls = document.createElement('p');
        controls.className = 'sp-popup-buttons';
        fragment.appendChild(controls);
        var unsubscribe = Button.withLabel(_('PopupPlaylistSubscribeCancel'));
        controls.appendChild(unsubscribe.node);
        var okay = Button.withLabel(_('PopupPlaylistSubscribeConfirm'));
        okay.setAccentuated(true);
        controls.appendChild(okay.node);
        var popup = Popup.withContent(fragment, 250, 0, 'sp-playlist-subscribed');
        popup.addEventListener('hiddenOnClick', function () {
          logger.userHit('hide', self._followLogData);
        });
        var user = this.item.owner;
        unsubscribe.addEventListener('click', function () {
          this.setDisabled(true);
          Relations.forCurrentUser().unsubscribe(user);
          popup.hide(100);
          logger.userHit('no', self._followLogData);
        });
        okay.addEventListener('click', function () {
          popup.hide();
          logger.userHit('ok', self._followLogData);
        });
        Relations.forCurrentUser().subscribe(user).done(function () {
          popup.showFor(self.node);
          var rect = paragraph.getBoundingClientRect();
          popup.resize(popup.width, rect.height + 44);
          logger.userImpression('playlist-follow-popup', self._followLogData);
        });
        this._popup = popup;
      };
      function updateFollowersCount(user, element) {
        Relations.forUser(user).subscribers.snapshot(0, 0).done(function (snapshot) {
          element.textContent = snapshot.length;
        });
      }
      var _followPopup = null;
      SubscribePlaylistButton.prototype._showFollowPopup = function () {
        var self = this;
        var logger = Logger.forTag('playlist-follow-popup', 'playlist-suggest-follow-popup');
        if (_followPopup) {
          logger.userHit('hide', this._followLogData);
          _followPopup.dispose();
        }
        var owner = this.item.owner, ownerName = owner.name.decodeForHtml(), ownerLink = owner.uri.toSpotifyLink(), discoverLink = 'spotify:app:discover'.toSpotifyLink();
        var fragment = document.createDocumentFragment();
        var paragraph = document.createElement('p');
        paragraph.innerHTML = _('PopupPlaylistSuggestFollow', '<a href="' + ownerLink + '"><strong>' + ownerName + '</strong></a>', ownerName, '<a href="' + discoverLink + '"><strong>' + _('DiscoverAppName') + '</strong></a>', '<strong>' + _('ButtonSubscribe') + '</strong>');
        fragment.appendChild(paragraph);
        var container = document.createElement('div');
        container.className = 'sp-playlist-follow-profile-container';
        fragment.appendChild(container);
        var content = document.createElement('div');
        content.className = 'sp-playlist-follow-profile-content';
        container.appendChild(content);
        var portrait;
        if (owner.image) {
          portrait = document.createElement('img');
          portrait.src = owner.image;
        } else {
          portrait = document.createElement('div');
          var width = 45, height = 45, placeholderWidth = 578, placeholderHeight = 1500, bgWidthPercent = placeholderWidth / width * 100, bgHeightPercent = placeholderHeight / height * 100;
          var placeholder = document.createElement('div');
          css.addClass(placeholder, 'sp-image-placeholder sp-image-placeholder-visible');
          placeholder.style.backgroundSize = bgWidthPercent + '% ' + bgHeightPercent + '%';
          portrait.appendChild(placeholder);
        }
        css.addClass(portrait, 'sp-profile-portrait');
        content.appendChild(portrait);
        var nameContainer = document.createElement('div');
        nameContainer.className = 'sp-playlist-follow-profile-name';
        content.appendChild(nameContainer);
        var nameLink = document.createElement('a');
        nameLink.href = ownerLink;
        nameLink.innerHTML = '<strong>' + ownerName + '</strong>';
        nameContainer.appendChild(nameLink);
        var info = document.createElement('div');
        info.className = 'sp-playlist-follow-profile-info';
        content.appendChild(info);
        var followersCount = document.createElement('div');
        followersCount.className = 'sp-profile-followers-count';
        updateFollowersCount(owner, followersCount);
        info.appendChild(followersCount);
        var followersText = document.createElement('div');
        followersText.className = 'sp-profile-followers-text';
        followersText.textContent = _('Followers');
        info.appendChild(followersText);
        var followButton = SubscribeButton.forUser(this.item.owner);
        content.appendChild(followButton.node);
        followButton.addEventListener('subscribe', function () {
          updateFollowersCount(owner, followersCount);
          logger.userHit('follow', self._followLogData);
        });
        followButton.addEventListener('unsubscribe', function () {
          updateFollowersCount(owner, followersCount);
          logger.userHit('unfollow', self._followLogData);
        });
        var popup = Popup.withContent(fragment, 250, 0, 'sp-playlist-follow');
        popup.showFor(this.node);
        popup.addEventListener('hiddenOnClick', function () {
          logger.userHit('hide', self._followLogData);
        });
        var rect = paragraph.getBoundingClientRect();
        popup.resize(popup.width, rect.height + 60);
        logger.userImpression('playlist-follow-popup', this._followLogData);
        _followPopup = this._popup = popup;
      };
      SubscribePlaylistButton.prototype._updateSubscription = function (subscribe) {
        if (!subscribe) {
          this._call(Library.forCurrentUser(), 'unsubscribe');
          if (this._popup) {
            this._popup.hide();
          }
          return;
        }
        var self = this;
        models.session.testGroupForTest('playlist_follow_popup').done(function (testGroup) {
          self.item.load('owner').done(function (playlist) {
            playlist.owner.load('name', 'subscribed', 'image').done(function (user) {
              self._followLogData = {
                uri: playlist.uri,
                follower: models.session.user.username,
                owner: user.username
              };
              self._call(Library.forCurrentUser(), 'subscribe').done(function () {
                if (!user.subscribed) {
                  var isAviciiPlaylist = playlist.uri === 'spotify:user:aviciiofficial:playlist:0Nfd1i1ofRRIXN8Kyk5ms1';
                  if (testGroup <= 50 || isAviciiPlaylist) {
                    self._showAutoFollowPopup(isAviciiPlaylist);
                  } else {
                    self._showFollowPopup();
                  }
                }
              });
            });
          });
        });
      };
      function SubscribeProfileButton(profile, opt_options) {
        var isProfile = profile instanceof models.Profile;
        var isUser = profile instanceof models.User;
        var isArtist = profile instanceof models.Artist;
        if (!(isProfile || isUser || isArtist))
          throw new Error('Supplied object was not a Profile, Artist or User');
        SubscribeButton.call(this, profile, opt_options);
      }
      SP.inherit(SubscribeProfileButton, SubscribeButton);
      SubscribeProfileButton.prototype._updateSubscription = function (subscribe) {
        if (!this._itemLoaded)
          return;
        this._call(Relations.forCurrentUser(), subscribe ? 'subscribe' : 'unsubscribe');
      };
      SubscribeButton.forPlaylist = function (playlist, opt_options) {
        if (!(playlist instanceof models.Playlist))
          throw new Error('not a Playlist');
        return new SubscribePlaylistButton(playlist, opt_options);
      };
      SubscribeButton.forArtist = function (artist, opt_options) {
        if (!(artist instanceof models.Artist))
          throw new Error('not an Artist');
        return new SubscribeProfileButton(artist, opt_options);
      };
      SubscribeButton.forUser = function (user, opt_options) {
        if (!(user instanceof models.User))
          throw new Error('not a valid User object');
        return new SubscribeProfileButton(user, opt_options);
      };
      SubscribeButton.forProfile = function (profile, opt_options) {
        var isProfile = profile instanceof models.Profile;
        var isUser = profile instanceof models.User;
        var isArtist = profile instanceof models.Artist;
        if (!(isProfile || isUser || isArtist))
          throw new Error('Supplied object was not a Profile, Artist or User');
        return new SubscribeProfileButton(profile, opt_options);
      };
      SubscribeButton.availableOptions = {};
      function QuickActionButtons(item, opt_origin, opt_indexGetter, opt_withContextButton) {
        this.item = item;
        this.origin = opt_origin;
        this.indexGetter = opt_indexGetter;
        var container = document.createElement('div');
        css.addClass(container, 'sp-quickactionbuttons');
        var deviceContainer = device.container;
        if (opt_withContextButton === undefined)
          opt_withContextButton = deviceContainer === 'web' || deviceContainer === 'ios';
        var contextMenu;
        if (opt_withContextButton) {
          css.addClass(container, 'sp-with-contextbutton');
          contextMenu = CustomButton.withClass('sp-contextmenu');
          container.appendChild(contextMenu.node);
          contextMenu.addEventListener('click', SP.bind(this._clicked, this));
        }
        if (deviceContainer !== 'ios') {
          models.client.load('features').done(function (client) {
            if (client.features.collection) {
              css.addClass(container, 'sp-with-collection');
              var addToCollection = AddToCollectionButton.forItem(item, { autoAdjustSize: false });
              addToCollection.setAutoAccentuated(false);
              container.insertBefore(addToCollection.node, contextMenu && contextMenu.node);
            }
          });
        }
        this.node = container;
      }
      QuickActionButtons.forItem = function (item, opt_origin, opt_indexGetter, opt_withContextButton) {
        return new QuickActionButtons(item, opt_origin, opt_indexGetter, opt_withContextButton);
      };
      QuickActionButtons.prototype._clicked = function (e) {
        var self = this;
        var event = e.browserEvent || e;
        var appClosedDetecter;
        var moves = 0;
        var index = undefined;
        if (this.indexGetter)
          index = this.indexGetter(event);
        if (device.container === 'web') {
          var origin = this.origin && this.origin.uri;
          ContextApp.show('context-actions', [this.item.uri], event.target, origin, index, this._getLoggingContext()).done(function (contextApp) {
            appClosedDetecter = function () {
              moves++;
              if (moves == 2) {
                css.removeClass(self.node, 'sp-quickactionbuttons-popup');
                document.removeEventListener('mousemove', appClosedDetecter);
              }
            };
            document.addEventListener('mousemove', appClosedDetecter);
          });
        } else {
          var pointer = event.changedTouches ? event.changedTouches[0] : event;
          var x = pointer.pageX - window.pageXOffset;
          var y = pointer.pageY - window.pageYOffset;
          models.client.showContextUI(this.item, {
            x: x,
            y: y
          }, this.origin);
        }
        css.addClass(this.node, 'sp-quickactionbuttons-popup');
      };
      QuickActionButtons.prototype._getLoggingContext = function () {
        var contextParts = [];
        var contextPart;
        var target = this.node;
        if (target) {
          do {
            if (target && target.getAttribute && (contextPart = target.getAttribute('data-log-context'))) {
              contextParts.push(contextPart);
            }
          } while (target = target.parentNode);
        }
        return contextParts.reverse().join('/');
      };
      function AddToCollectionButton(item, opt_options) {
        var self = this;
        Button.call(this, '');
        opt_options = opt_options || {};
        this._autoAdjustSize = true;
        if (opt_options.autoAdjustSize === false)
          this._autoAdjustSize = false;
        this._setLabels();
        this.item = item;
        this.node.setAttribute('data-uri', item.uri);
        this._autoAccentuated = true;
        css.addClass(this.node, 'sp-add-to-collection-button');
        this._library = Library.forCurrentUser();
        this.node.buttonInstance = this;
        this._isInCollection = false;
        this._justAdded = false;
        dom.addEventListener(this.node, 'mouseover', function () {
          self._isMouseHovering = true;
          self._justAdded = false;
          self._updateLooks();
        });
        dom.addEventListener(this.node, 'mouseout', function () {
          self._isMouseHovering = false;
          self._justAdded = false;
          self._updateLooks();
        });
        this._updateLooks();
        AddToCollectionButton.updateStates();
      }
      SP.inherit(AddToCollectionButton, Button);
      AddToCollectionButton.forItem = function (item, opt_options) {
        return new AddToCollectionButton(item, opt_options);
      };
      AddToCollectionButton.availableOptions = {};
      AddToCollectionButton.prototype.setAutoAccentuated = function (autoAccentuated) {
        this._autoAccentuated = autoAccentuated;
        this._updateLooks();
      };
      AddToCollectionButton.prototype._setLabels = function () {
        var _labels = this._collectionLabels = {
          add: _('SaveToYourMusic'),
          inCollection: _('SavedToYourMusic')
        };
        var _icons = this._collectionIcons = {
          add: true,
          inCollection: false
        };
        var labels = [
          _labels.add,
          _labels.inCollection
        ];
        var icons = [
          _icons.add,
          _icons.inCollection
        ];
        if (!this._touchDevice) {
          _labels.remove = _('RemoveFromYourMusic');
          _icons.remove = false;
          labels.push(_labels.remove);
          icons.push(_icons.remove);
        }
        if (this._autoAdjustSize)
          this.setWidthFromLabels(labels, icons);
      };
      AddToCollectionButton.prototype._setInCollectionState = function (inCollection) {
        if (this._isInCollection == inCollection)
          return;
        this._isInCollection = inCollection;
        this._justAdded = this._isInCollection;
        this._updateLooks();
      };
      AddToCollectionButton.prototype._clicked = function (e) {
        var self = this;
        models.client.load('features').done(function (client) {
          var COLLECTION_WITH_UNION = 2;
          if (self._isInCollection) {
            if (self.item instanceof models.Track)
              Logger.forTag('views').userHit('remove-track-from-collection', { data: { uri: self.item.uri } }, 'collection-button');
            else
              Logger.forTag('views').userHit('remove-album-from-collection', { data: { uri: self.item.uri } }, 'collection-button');
            var onSuccess = function () {
            };
            var removeItem = function () {
              self._setInCollectionState(false);
              if (self.item instanceof models.Track)
                self._library.tracks.remove(self.item).fail(self._setInCollectionState.bind(self, true));
              else
                self._library.albums.remove(self.item).fail(self._setInCollectionState.bind(self, true));
            };
            if (client.features.collection === COLLECTION_WITH_UNION) {
              self._library.getUnionSources(self.item).done(function (sources) {
                if (sources && sources.playlists && Object.keys(sources.playlists).length) {
                  SP.request('client_show_collection_union_remove_ui', [
                    models.session.user.uri,
                    self.item.uri
                  ], null, onSuccess, removeItem);
                } else {
                  removeItem();
                }
              }).fail(function () {
                removeItem();
              });
            } else {
              removeItem();
            }
          } else {
            self._setInCollectionState(true);
            if (self.item instanceof models.Track) {
              Logger.forTag('views').userHit('add-track-to-collection', { data: { uri: self.item.uri } }, 'collection-button');
              self._library.tracks.add(self.item).fail(self._setInCollectionState.bind(self, false));
            } else {
              Logger.forTag('views').userHit('add-album-to-collection', { data: { uri: self.item.uri } }, 'collection-button');
              self._library.albums.add(self.item).fail(self._setInCollectionState.bind(self, false));
            }
          }
        });
      };
      AddToCollectionButton.prototype._updateLooks = function () {
        if (this._justAdded)
          css.addClass(this.node, 'sp-just-added-to-collection');
        else
          css.removeClass(this.node, 'sp-just-added-to-collection');
        if (this._isInCollection) {
          this.setIconClass('');
          css.addClass(this.node, 'sp-in-collection');
          css.removeClass(this.node, 'sp-button-accentuated-positive');
          if (this._isMouseHovering) {
            this.setLabel(this._collectionLabels.remove);
            css.addClass(this.node, 'sp-button-accentuated-negative');
            css.addClass(this.node, 'sp-button-accentuated');
          } else {
            this.setLabel(this._collectionLabels.inCollection);
            css.removeClass(this.node, 'sp-button-accentuated-negative');
            css.removeClass(this.node, 'sp-button-accentuated');
          }
        } else {
          this.setIconClass('sp-icon-add');
          this.setLabel(this._collectionLabels.add);
          css.removeClass(this.node, 'sp-in-collection');
          css.removeClass(this.node, 'sp-button-accentuated-negative');
          if (this._autoAccentuated) {
            css.addClass(this.node, 'sp-button-accentuated-positive');
            css.addClass(this.node, 'sp-button-accentuated');
          } else {
            css.removeClass(this.node, 'sp-button-accentuated-positive');
            css.removeClass(this.node, 'sp-button-accentuated');
          }
        }
      };
      AddToCollectionButton._updateSubsetStates = function (buttonInstances, modelConstructor, collection) {
        var buttonInstancesSubset = [];
        var items = [];
        for (var i = 0; i < buttonInstances.length; i++) {
          var item = buttonInstances[i].item;
          if (item instanceof modelConstructor) {
            buttonInstancesSubset.push(buttonInstances[i]);
            items.push(item);
          }
        }
        collection.contains(items).done(function (isInCollection) {
          for (var i = 0; i < items.length; i++) {
            buttonInstancesSubset[i]._setInCollectionState(isInCollection[i]);
          }
        });
      };
      AddToCollectionButton._updateStates = function () {
        var library = Library.forCurrentUser();
        var buttons = AddToCollectionButton._getAllMatching();
        AddToCollectionButton._updateSubsetStates(buttons, models.Track, library.tracks);
        AddToCollectionButton._updateSubsetStates(buttons, models.Album, library.albums);
      };
      AddToCollectionButton.updateStates = function () {
        if (AddToCollectionButton._timer)
          clearTimeout(AddToCollectionButton._timer);
        AddToCollectionButton._timer = setTimeout(AddToCollectionButton._updateStates, 10);
      };
      AddToCollectionButton._initGlobally = function () {
        var library = Library.forCurrentUser();
        library.tracks.addEventListener('changed', AddToCollectionButton._handleChangedEvent);
        library.albums.addEventListener('changed', AddToCollectionButton._handleChangedEvent);
        library.tracks.addEventListener('insert', AddToCollectionButton._handleInsertRemoveEvent);
        library.tracks.addEventListener('remove', AddToCollectionButton._handleInsertRemoveEvent);
        library.albums.addEventListener('insert', AddToCollectionButton._handleInsertRemoveEvent);
        library.albums.addEventListener('remove', AddToCollectionButton._handleInsertRemoveEvent);
      };
      AddToCollectionButton._handleChangedEvent = function (e) {
        AddToCollectionButton.updateStates();
      };
      AddToCollectionButton._handleInsertRemoveEvent = function (e) {
        var isInCollection = e.type === 'insert';
        e.uris.forEach(function (uri) {
          AddToCollectionButton._getAllMatching(uri).forEach(function (button) {
            button._setInCollectionState(isInCollection);
          });
        });
      };
      AddToCollectionButton._getAllMatching = function (opt_uri) {
        var selector = '.sp-add-to-collection-button' + (opt_uri ? '[data-uri="' + opt_uri + '"]' : '');
        return Array.prototype.map.call(document.querySelectorAll(selector), function (button) {
          return button.buttonInstance;
        });
      };
      AddToCollectionButton._initGlobally();
    }(require('node_modules/views/scripts/utils/device.js'), require('node_modules/api/scripts/library.js').Library, require('node_modules/api/scripts/models.js'), require('node_modules/api/scripts/toplists.js').Toplist, require('node_modules/api/scripts/relations.js').Relations, require('node_modules/views/scripts/popup.js').Popup, require('node_modules/views/@loc.loc/strings/buttons.lang'), require('node_modules/views/scripts/utils/css.js'), require('node_modules/views/scripts/utils/dom.js'), require('node_modules/views/scripts/utils/dnd.js'), require('node_modules/views/scripts/utils/touch.js'), require('node_modules/views/scripts/contextapp.js').ContextApp, require('node_modules/views/scripts/utils/frame.js'), require('node_modules/views/scripts/utils/logger.js').Logger));
  },
  'node_modules/views/scripts/image.js': function (require, module, exports, global, __filename, __dirname) {
    (function (imageStrings, device, models, Toplist, css, dom, dnd, touch, buttons) {
      var _ = SP.bind(imageStrings.get, imageStrings);
      exports.Image = Image;
      var Observable = models.Observable;
      function Image(item, options) {
        options = options || {};
        this._title = options.title;
        this._link = options.link || '';
        this._animateLoaded = options.animate === undefined ? true : options.animate;
        this._placeholder = options.placeholder === undefined ? 'auto' : options.placeholder;
        this._player = !!options.player;
        this._quickActionMenu = options.quickActionMenu === undefined ? 'auto' : options.quickActionMenu;
        this._playerItem = options.playerItem;
        this._swap = options.swap === 'immediate' ? 'immediate' : 'wait';
        this._overlay = options.overlay === undefined ? [] : options.overlay;
        this._doAutoOverlay = typeof options.overlay === 'boolean';
        this._playerCentered = options.playerCentered || false;
        var styles = [
          'plain',
          'inset',
          'rounded',
          'embossed'
        ];
        this._style = ~styles.indexOf(options.style) ? options.style : 'inset';
        this._getContextGroupData = options.getContextGroupData;
        this._getIndexInContext = options.getIndexInContext;
        this._acceptedLoadTime = 200;
        this._width = options.width || options.height || 200;
        this._height = options.height || options.width || 200;
        var placeholderTypes = {
          'artist': 'Artist',
          'album': 'Album',
          'track': 'Track',
          'playlist': 'Playlist',
          'user': 'User'
        };
        if (!~' auto none empty '.indexOf(' ' + this._placeholder + ' ') && !(this._placeholder in placeholderTypes)) {
          this._placeholder = 'auto';
        }
        this._placeholderType = placeholderTypes[this._placeholder] || 'auto';
        this._buildNode();
        this._isCustomImage = item ? typeof item === 'string' ? true : false : true;
        if (this._placeholder !== 'none') {
          this._buildPlaceholder();
        }
        if (item !== undefined) {
          this.setImage(item);
        } else if (this._placeholder !== 'none') {
          this._setPlaceholder(this._getSuitableSize('placeholder'));
        }
        if (this._link) {
          this.setLink(this._link);
        }
        if (dnd.drag.hasDragSupport) {
          this._addDragHandler();
        }
        if (device.container === 'desktop' || device.container === 'web') {
          this._addContextUIHandler();
        }
      }
      SP.inherit(Image, Observable);
      Image.forAlbum = function (album, opt_options) {
        if (!(album instanceof models.Album)) {
          throw new Error('The type of the object is not Album');
        }
        return new Image(album, opt_options);
      };
      Image.forArtist = function (artist, opt_options) {
        if (!(artist instanceof models.Artist)) {
          throw new Error('The type of the object is not Artist');
        }
        return new Image(artist, opt_options);
      };
      Image.forPlaylist = function (playlist, opt_options) {
        if (!(playlist instanceof models.Playlist)) {
          throw new Error('The type of the object is not Playlist');
        }
        return new Image(playlist, opt_options);
      };
      Image.forTrack = function (track, opt_options) {
        if (!(track instanceof models.Track)) {
          throw new Error('The type of the object is not Track');
        }
        return new Image(track, opt_options);
      };
      Image.forUser = function (user, opt_options) {
        if (!(user instanceof models.User)) {
          throw new Error('The type of the object is not User');
        }
        return new Image(user, opt_options);
      };
      Image.forProfile = function (profile, opt_options) {
        if (!(profile instanceof models.Profile)) {
          throw new Error('The type of the object is not Profile');
        }
        return new Image(profile, opt_options);
      };
      Image.fromSource = function (source, opt_options) {
        if (typeof source !== 'string') {
          throw new Error('The source path you pass in must be a string.');
        }
        return new Image(source, opt_options);
      };
      Image.availableOptions = {};
      Image.prototype.setImage = function (item) {
        var self = this;
        this.isLoaded = false;
        this._isCustomImage = typeof item === 'string';
        if (this._isCustomImage) {
          this._item = null;
          this._src = item;
        } else {
          var isOldTrack = this._item instanceof models.Track;
          var isOldPlaylist = this._item instanceof models.Playlist;
          if (this._item && (isOldTrack || isOldPlaylist)) {
            this._item.removeEventListener('change:image', this._changeEventHandler);
            this._changeEventHandler = null;
          }
          this._src = null;
          this._item = item;
          var isNewTrack = item instanceof models.Track;
          var isNewPlaylist = item instanceof models.Playlist;
          if (isNewTrack || isNewPlaylist) {
            item.load('image').done(function () {
              self._changeEventHandler = function () {
                self._resetImage();
                self._buildImage();
              };
              item.addEventListener('change:image', self._changeEventHandler);
            });
          }
        }
        if (this._placeholder !== 'none') {
          this._setPlaceholder(this._getSuitableSize('placeholder'));
        }
        if (this._swap === 'immediate') {
          this._resetImage();
        }
        this.setDraggable();
        this._buildImage();
        if (this.playerButton) {
          if (this._isCustomImage && !this._playerItem || !this._isSupportedPlayerItem()) {
            this._hidePlayButton();
          } else {
            this._showPlayButton();
            if (this._isCustomImage) {
              this.playerButton.setItem(this._playerItem);
            } else {
              this.playerButton.setItem(item);
            }
          }
        } else if (this._player && this._isSupportedPlayerItem()) {
          this._buildPlayer();
        }
        if (this._doAutoOverlay)
          this._setAutoOverlay();
        else if (!this.node.overlay && this._overlay.length > 0)
          this._applyOverlay(this._overlay[0], this._overlay[1]);
        var typeIsTrackOrAlbum = this._item instanceof models.Track || this._item instanceof models.Album;
        var okForAutoQuickActionMenu = typeIsTrackOrAlbum && this._getSize().width > 64;
        if (this._quickActionMenu === true || this._quickActionMenu == 'auto' && okForAutoQuickActionMenu) {
          var builtButtons = false;
          models.client.load('features').done(function (client) {
            if (!builtButtons && client.features.collection) {
              builtButtons = true;
              self._buildQuickActionButtons(item);
            }
          });
          if (!builtButtons && device.container === 'web') {
            builtButtons = true;
            this._buildQuickActionButtons(item);
          }
        }
        return this;
      };
      Image.prototype.setOverlay = function (opt_firstLineOrDoAutomatic, opt_secondLine) {
        if (!opt_firstLineOrDoAutomatic && !opt_secondLine) {
          this._clearOverlay();
          return;
        }
        this._doAutoOverlay = opt_firstLineOrDoAutomatic === true;
        if (this._doAutoOverlay)
          this._setAutoOverlay();
        else
          this._applyOverlay(opt_firstLineOrDoAutomatic, opt_secondLine);
      };
      Image.prototype._clearOverlay = function () {
        this._overlay = [];
        if (this.node.overlay) {
          this.node.removeChild(this.node.overlay);
          delete this.node.overlay;
        }
        if (this.playerButton && !this._playerCentered) {
          this.playerButton.setCentered(false);
        }
      };
      Image.prototype._applyOverlay = function (opt_firstLine, opt_secondLine) {
        this._overlay = [];
        this._overlay[0] = opt_firstLine || '';
        if (opt_secondLine) {
          this._overlay[1] = opt_secondLine;
        } else {
          this._overlay.splice(1, 1);
        }
        if (!this.node.overlay) {
          this._buildOverlay();
        }
        var lineNames = [
          'firstLine',
          'secondLine'
        ];
        for (var i = 0, len = lineNames.length; i < len; i++) {
          var line = this._overlay[i] || '';
          var lineName = lineNames[i];
          var lineNode = this.node.overlay[lineName];
          if (lineNode) {
            if (line instanceof HTMLElement) {
              while (lineNode.firstChild) {
                lineNode.removeChild(lineNode.firstChild);
              }
              lineNode.appendChild(line);
            } else {
              lineNode.textContent = line;
            }
          }
        }
        if (this._overlay.length > 1) {
          css.addClass(this.node.overlay, 'sp-image-overlay-2-lines');
        } else {
          css.removeClass(this.node.overlay, 'sp-image-overlay-2-lines');
        }
        if (this.playerButton) {
          this.playerButton.setCentered(true);
        }
      };
      var createLink = function (uri, text) {
        var link = document.createElement('a');
        link.href = uri.toSpotifyLink();
        link.textContent = text;
        return link;
      };
      var getArtists = function (artists, opt_cb) {
        var i = 0, l = artists.length, promises = [], _this = this;
        for (; i < l; i++) {
          promises.push(artists[i].load('name', 'uri'));
        }
        models.Promise.join(promises).done(function (artists) {
          var wrapper = document.createElement('span');
          var i = 0, l = artists.length;
          for (; i < l; i++) {
            wrapper.appendChild(createLink(artists[i].uri, artists[i].name));
            if (i < l - 1) {
              wrapper.appendChild(document.createTextNode(', '));
            }
          }
          if (opt_cb && typeof opt_cb === 'function') {
            opt_cb(wrapper);
          }
        });
      };
      Image.prototype._setAutoOverlay = function () {
        var firstline = null, _this = this;
        if (this._item instanceof models.Playlist) {
          this._item.load('name', 'owner').done(function (playlist) {
            firstline = createLink(_this._item.uri, playlist.name);
            playlist.owner.load('name', 'uri').done(function (user) {
              _this._applyOverlay(firstline, createLink(user.uri, _('by') + ' ' + user.name));
            });
          });
        } else if (this._item instanceof models.Album) {
          this._item.load('name', 'artists').done(function (album) {
            firstline = createLink(_this._item.uri, album.name);
            getArtists(album.artists, function (artists) {
              _this._applyOverlay(firstline, artists);
            });
          });
        } else if (this._item instanceof models.Track) {
          this._item.load('name', 'artists').done(function (track) {
            firstline = createLink(_this._item.uri, track.name);
            getArtists(track.artists, function (artists) {
              _this._applyOverlay(firstline, artists);
            });
          });
        } else if (this._item instanceof models.User) {
          this._item.load('name').done(function (user) {
            if (user.name) {
              _this._applyOverlay(createLink(_this._item.uri, user.name));
            }
          });
        } else if (this._item instanceof models.Artist) {
          this._item.load('name').done(function (artist) {
            if (artist.name) {
              _this._applyOverlay(createLink(_this._item.uri, artist.name));
            }
          });
        } else if (this._item instanceof models.Profile) {
          this._item.load('name').done(function (profile) {
            if (profile.name) {
              _this._applyOverlay(createLink(_this._item.uri, profile.name));
            }
          });
        }
      };
      Image.prototype.setLink = function (link) {
        var node = this.node;
        this._link = link || '';
        if (this._link === 'auto' && !this._isCustomImage) {
          if (this._item && this._item.uri) {
            node.href = this._item.uri.toSpotifyLink();
            node.setAttribute('data-uri', this._item.uri);
          } else {
            node.href = '#';
            node.setAttribute('data-uri', '');
          }
        } else {
          var isSpotifyURI = this._link.indexOf('spotify:') === 0;
          var link = isSpotifyURI ? this._link.toSpotifyLink() : this._link;
          node.href = link;
          node.setAttribute('data-uri', isSpotifyURI ? this._link : '');
        }
      };
      Image.prototype.setSize = function (width, height) {
        this.node.style.width = width + 'px';
        this.node.style.height = height + 'px';
        this._width = width;
        this._height = height;
        if (this._placeholder !== 'none' && this.node.placeholder) {
          this._setPlaceholder(this._getSuitableSize('placeholder'));
        }
        if (this.isImageInitialized && this._player) {
          this._setPlayButtonSize();
        }
        this.dispatchEvent('resize');
        return this;
      };
      Image.prototype.setStyle = function (style) {
        if (this.isImageInitialized && style === this._style)
          return this;
        var stylesWithInsetEl = [
          'inset',
          'embossed'
        ];
        css.removeClass(this.node, 'sp-image-style-' + this._style);
        var inset_shadow = this.node.getElementsByClassName('sp-image-inset')[0];
        if (inset_shadow && !~stylesWithInsetEl.indexOf(style)) {
          this.node.removeChild(inset_shadow);
          css.removeClass(this.node, 'sp-image-style-rounded');
        }
        if (!inset_shadow && ~stylesWithInsetEl.indexOf(style)) {
          css.addClass(this.node, 'sp-image-style-rounded');
          var inset = document.createElement('div');
          css.addClass(inset, 'sp-image-inset');
          this.node.appendChild(inset);
        }
        css.addClass(this.node, 'sp-image-style-' + style);
        this._style = style;
        return this;
      };
      Image.prototype.setPlayer = function (doSetPlayer) {
        if (doSetPlayer && !this._player) {
          this._buildPlayer();
        } else if (!doSetPlayer && this._player) {
          this._removePlayer();
        }
        this._player = !!doSetPlayer;
        return this;
      };
      Image.prototype.setDraggable = function (opt_doActivate) {
        var doActivate = opt_doActivate !== undefined ? opt_doActivate : !this._isCustomImage || !!this._playerItem;
        if (doActivate) {
          this.node.setAttribute('draggable', 'true');
          css.removeClass(this.node, 'sp-image-disable-dnd');
        } else {
          this.node.setAttribute('draggable', 'false');
          css.addClass(this.node, 'sp-image-disable-dnd');
        }
      };
      Image.prototype._buildNode = function () {
        var node;
        var self = this;
        if (this._link) {
          this.node = node = document.createElement('a');
          this.setLink(this._link);
        } else {
          this.node = node = document.createElement('div');
        }
        this._addClickHandler();
        if (this._title) {
          node.title = this._title;
        }
        this.setSize(this._width, this._height);
        css.addClass(node, 'sp-image');
        if (this._animateLoaded) {
          css.addClass(node, 'sp-image-animated');
        }
        this.setStyle(this._style);
        css.addClass(node, 'sp-image-hidden');
        this.isImageInitialized = true;
        return this;
      };
      Image.prototype._addClickHandler = function () {
        var self = this;
        var node = this.node;
        var hasTouch = device.touch && device.mobile;
        var clickEvent = 'click';
        if (hasTouch) {
          clickEvent = 'sp-tap';
          touch.selection.enableForElement(node, { willOpenNewView: true });
          node.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
          });
        }
        node.addEventListener(clickEvent, function (e) {
          self._onClick(e);
        });
      };
      Image.prototype._onClick = function (e) {
        var self = this;
        var target = e.target;
        if (e.type === 'sp-tap' && e.detail && e.detail.touchEndObject) {
          target = e.detail.touchEndObject.target;
        }
        if (this.playerButton && this.playerButton.contains(target)) {
          return;
        }
        do {
          if (target.nodeName.toLowerCase() === 'a') {
            break;
          }
        } while ((target = target.parentNode) && target !== document.body);
        var uri = target.getAttribute('data-uri');
        if (!uri) {
          var href = target.getAttribute('href');
          if (!href)
            return;
          uri = href.toSpotifyURI();
        }
        if (uri && uri.indexOf('spotify:') === 0) {
          e.preventDefault();
          e.stopPropagation();
          models.application.openURI(uri);
          self.dispatchEvent({
            type: 'link-click',
            uri: uri,
            targetElement: target
          });
        }
      };
      var placeHolderStyleCache = null;
      var getPlaceHolderStyle = function () {
        if (placeHolderStyleCache) {
          return placeHolderStyleCache;
        }
        var dummy = document.createElement('div');
        css.addClass(dummy, 'sp-image-placeholder-visible');
        dummy.style.position = 'absolute';
        dummy.style.top = '-9999px';
        document.body.appendChild(dummy);
        placeHolderStyleCache = /url\("?(.*?)"?\)/.exec(css.getStyle(dummy, 'background-image'));
        document.body.removeChild(dummy);
        return placeHolderStyleCache;
      };
      Image.prototype._buildPlaceholder = function () {
        var style = getPlaceHolderStyle();
        var node = document.createElement('div');
        css.addClass(node, 'sp-image-placeholder');
        if (style && typeof style[1] === 'string') {
          var ph = this._placeholder;
          var isCustom = this._isCustomImage;
          if (ph !== 'empty' && !isCustom || isCustom && ph !== 'auto' && ph !== 'empty') {
            css.addClass(node, 'sp-image-placeholder-visible');
          }
        }
        this.node.appendChild(node);
        this.node.placeholder = node;
        css.addClass(node, 'sp-image-placeholder-hidden');
      };
      Image.prototype._buildPlayer = function () {
        var self = this;
        var item = this._playerItem || this._item;
        if (!item)
          return;
        var options = {};
        if (typeof this._getContextGroupData === 'function') {
          options.getContextGroupData = this._getContextGroupData;
        }
        if (typeof this._getIndexInContext === 'function') {
          options.getIndexInContext = this._getIndexInContext;
        }
        if (this._playerCentered) {
          options.position = 'centered';
        }
        var button = buttons.PlayButton.forItem(item, options);
        this.node.appendChild(button.node);
        css.addClass(button.node, 'sp-image-player');
        this.playerButton = button;
        if (!this._isSupportedPlayerItem()) {
          this._hidePlayButton();
        }
        this._playClickHandler = function () {
          self.dispatchEvent('play-click');
        };
        this._pauseClickHandler = function () {
          self.dispatchEvent('pause-click');
        };
        button.addEventListener('play-click', this._playClickHandler);
        button.addEventListener('pause-click', this._pauseClickHandler);
        if (!this.hasOwnProperty('isPlaying')) {
          Object.defineProperty(this, 'isPlaying', {
            get: function () {
              return this.playerButton ? this.playerButton._playing : false;
            }
          });
        }
        this._playButtonSizes = {
          40: 'xs',
          64: 'small',
          128: 'medium',
          200: 'large',
          300: 'xl'
        };
        this._setPlayButtonSize();
        dom.addEventListener(this.playerButton.node, 'click', function (e) {
          e.preventDefault();
          e.stopPropagation();
        });
      };
      Image.prototype._removePlayer = function () {
        var playerButton = this.playerButton;
        var node = playerButton && playerButton.node;
        if (node && node.parentNode)
          node.parentNode.removeChild(node);
        if (playerButton) {
          playerButton.removeEventListener('play-click', this._playClickHandler);
          playerButton.removeEventListener('pause-click', this._pauseClickHandler);
          delete this._playClickHandler;
          delete this._pauseClickHandler;
        }
        this.playerButton = null;
      };
      Image.prototype._isSupportedPlayerItem = function (opt_item) {
        var item = opt_item || this._playerItem || this._item;
        var isAlbum = item instanceof models.Album;
        var isArtist = item instanceof models.Artist;
        var isTrack = item instanceof models.Track;
        var isPlaylist = item instanceof models.Playlist;
        return isAlbum || isArtist || isTrack || isPlaylist;
      };
      Image.prototype._showPlayButton = function () {
        css.removeClass(this.playerButton.node, 'sp-image-player-hidden');
      };
      Image.prototype._hidePlayButton = function () {
        css.addClass(this.playerButton.node, 'sp-image-player-hidden');
      };
      Image.prototype._buildOverlay = function () {
        var container = document.createElement('div');
        css.addClass(container, 'sp-image-overlay');
        var firstLine = document.createElement('p');
        firstLine.className = 'sp-image-overlay-line1';
        container.appendChild(firstLine);
        var secondLine = document.createElement('p');
        secondLine.className = 'sp-image-overlay-line2';
        container.appendChild(secondLine);
        this.node.appendChild(container);
        this.node.overlay = container;
        this.node.overlay.firstLine = firstLine;
        this.node.overlay.secondLine = secondLine;
      };
      Image.prototype._buildQuickActionButtons = function (item) {
        var quickActionButtons = buttons.QuickActionButtons.forItem(item);
        dom.addEventListener(quickActionButtons.node, 'click', function (e) {
          e.preventDefault();
          e.stopPropagation();
        });
        this.node.appendChild(quickActionButtons.node);
      };
      Image.prototype._resetImage = function () {
        if (this.node.wrapper) {
          this.node.wrapper.innerHTML = '';
        }
        css.removeClass(this.node, 'sp-image-loaded');
        css.removeClass(this.node, 'sp-image-hidden');
        if (this.node.placeholder) {
          css.removeClass(this.node.placeholder, 'sp-image-placeholder-hidden');
        }
        this.dispatchEvent('reset');
      };
      Image.prototype._setPlayButtonSize = function () {
        if (!this.playerButton)
          return;
        var size;
        if (device.mobile) {
          size = 'medium';
        } else {
          var lastWidth, width;
          for (width in this._playButtonSizes) {
            if (width > this._width) {
              break;
            }
            lastWidth = width;
          }
          if (lastWidth) {
            size = this._playButtonSizes[lastWidth];
          }
        }
        var isTrack = (this._playerItem || this._item) instanceof models.Track;
        if (!size || size === 'xs' && isTrack) {
          this._hidePlayButton();
          return;
        }
        this.playerButton.setSize(size);
        if (this._isSupportedPlayerItem()) {
          this._showPlayButton();
        }
        var enableCentered = this._overlay.length > 0 || this._playerCentered;
        this.playerButton.setCentered(enableCentered);
      };
      Image.prototype.play = function () {
        if (!this.playerButton)
          return;
        this.playerButton._play();
      };
      Image.prototype.pause = function () {
        if (!this.playerButton)
          return;
        this.playerButton._pause();
      };
      Image.prototype._buildImage = function () {
        if (this._isCustomImage) {
          this._loadingStarted();
          this._createImage(this._src);
          if (this._playerItem) {
            var self = this;
            this._playerItem.load('name').done(function (item) {
              var name = item.name || function () {
                if (item.uri.indexOf(':starred') > -1) {
                  return _('Starred');
                } else if (item.uri.indexOf(':toplist') > -1) {
                  return _('Toplist');
                }
              }();
              if (name) {
                self.node.setAttribute('data-tooltip', name);
              } else {
                self.setDraggable(false);
              }
            });
          }
        } else {
          var props;
          if (this._item instanceof models.Album || this._item instanceof models.Track) {
            props = [
              'image',
              'name',
              'artists'
            ];
          } else {
            props = [
              'image',
              'name'
            ];
          }
          this._loadingStarted();
          this._item.load(props).done(this, function (item) {
            var size = Math.max(this._width, this._height);
            var image = item.imageForSize(size);
            if (image) {
              this._createImage(image);
            } else {
              this._resetImage();
            }
            if (item.artists) {
              var promises = [];
              for (var i = 0, l = item.artists.length; i < l; i++) {
                promises.push(item.artists[i].load('name'));
              }
              models.Promise.join(promises).done(this, function (artists) {
                this.node.setAttribute('data-tooltip', item.name + ' by ' + this._getArtistsAsString(artists));
              });
            } else {
              this.node.setAttribute('data-tooltip', item.name);
            }
            this.node.setAttribute('data-uri', item.uri);
          }).fail(this, function () {
            this._resetImage();
          });
        }
      };
      Image.prototype._loadingStarted = function () {
        var self = this;
        setTimeout(function () {
          if (!self.isLoaded) {
            css.removeClass(self.node, 'sp-image-hidden');
            if (self.node.placeholder) {
              css.removeClass(self.node.placeholder, 'sp-image-placeholder-hidden');
            }
          }
        }, this._acceptedLoadTime);
        this._startLoadTime = +new Date();
      };
      Image.prototype._createImage = function (src) {
        var self = this;
        var dummyImg = document.createElement('img');
        var img = document.createElement('div');
        css.addClass(img, 'sp-image-img');
        dummyImg.src = src;
        dummyImg.onload = function () {
          self._onLoad(img);
        };
        dummyImg.onerror = function () {
          self._resetImage();
        };
        img.style.backgroundImage = 'url(' + src + ')';
      };
      Image.prototype._artificialLoading = function (img) {
        var timeDiff = +new Date() - this._startLoadTime;
        var artificialLoadingTime = 500;
        var low = this._acceptedLoadTime;
        var high = low + artificialLoadingTime;
        if (timeDiff >= low && timeDiff <= high) {
          var self = this;
          setTimeout(function () {
            self._startLoadTime = +new Date();
            self._onLoad(img);
          }, artificialLoadingTime);
          return true;
        }
        return false;
      };
      Image.prototype._onLoad = function (img) {
        if (this._artificialLoading(img))
          return;
        var killOld = false;
        if (this.hasBuiltOnce && this._swap === 'wait') {
          css.addClass(this.node.wrapper, 'sp-image-wrapper-waiting-kill');
          css.removeClass(this.node, 'sp-image-loaded');
          killOld = true;
          var oldWrapper = this.node.wrapper;
        }
        var wrapper = document.createElement('div');
        css.addClass(wrapper, 'sp-image-wrapper');
        wrapper.appendChild(img);
        var playerButtnNode;
        if (this.playerButton)
          playerButtnNode = this.playerButton.node;
        var refElem = this.node.wrapper || this.node.placeholder || playerButtnNode;
        if (refElem) {
          this.node.insertBefore(wrapper, refElem);
        } else {
          this.node.appendChild(wrapper);
        }
        this.node.wrapper = wrapper;
        if (this.hasBuiltOnce && this._swap === 'wait') {
          css.addClass(wrapper, 'sp-image-wrapper-waiting');
        }
        this.hasBuiltOnce = true;
        this.isLoaded = true;
        css.removeClass(this.node, 'sp-image-hidden');
        SP.defer(this, function () {
          css.addClass(this.node, 'sp-image-loaded');
          if (this._link) {
            this.setLink(this._link);
          }
          this.dispatchEvent('load');
          this.dispatchEvent('change');
          if (killOld) {
            var self = this;
            setTimeout(function () {
              oldWrapper.parentNode.removeChild(oldWrapper);
              if (self._swap === 'wait') {
                css.removeClass(wrapper, 'sp-image-wrapper-waiting');
              }
              if (self.node.placeholder) {
                css.removeClass(self.node.placeholder, 'sp-image-placeholder-hidden');
              }
            }, this._animateLoaded ? 150 : 1);
          }
        });
      };
      Image.prototype._getSize = function () {
        return {
          width: this._width,
          height: this._height
        };
      };
      Image.prototype._getSuitableSize = function (type) {
        var imageSize = this._getSize();
        var sizeKey, size, placeholderSize;
        if (type === 'placeholder') {
          if (this._placeholder === 'empty' || this._isCustomImage && this._placeholder === 'auto') {
            return 'empty';
          }
          var images = SIZES.placeholder.images;
          for (sizeKey in images) {
            size = images[sizeKey];
            if (size.width < imageSize.width || size.height < imageSize.height || size.width === undefined) {
              break;
            }
            placeholderSize = sizeKey;
          }
          if (placeholderSize) {
            return placeholderSize;
          } else {
            return sizeKey;
          }
        }
      };
      Image.prototype._setPlaceholder = function (size) {
        var imageSize = this._getSize();
        var placeholder = this.node.placeholder;
        if (size === 'empty' || this._placeholder === 'auto' && !this._item && !this._src) {
          css.removeClass(placeholder, 'sp-image-placeholder-visible');
        } else if (this._item || this._placeholder !== 'auto') {
          css.addClass(placeholder, 'sp-image-placeholder-visible');
          size = SIZES.placeholder.images[size];
          if (size) {
            var total, factorX, factorY, widthOfResized, newPercentage, leftOfResized, topOfResized, newLeftPercentage, newTopPercentage, itemType, typeOffset, offsetOfResized, newOffsetPercentage;
            total = SIZES.placeholder.total;
            factorX = imageSize.width / size.width;
            factorY = imageSize.height / size.height;
            newPercentage = factorX * total.width / imageSize.width * 100;
            newLeftPercentage = factorX * size.x / (total.width * factorX - imageSize.width) * 100;
            newTopPercentage = factorY * size.y / (total.height * factorY - imageSize.height) * 100;
            var itemName;
            if (this._item instanceof models.Album) {
              itemName = 'Album';
            } else if (this._item instanceof models.Artist) {
              itemName = 'Artist';
            } else if (this._item instanceof models.Playlist) {
              itemName = 'Playlist';
            } else if (this._item instanceof models.Profile) {
              itemName = 'User';
            } else if (this._item instanceof models.Track) {
              itemName = 'Track';
            } else if (this._item instanceof models.User) {
              itemName = 'User';
            }
            itemType = this._placeholder === 'auto' ? itemName : this._placeholderType;
            typeOffset = total.height / total.numTypes * SIZES.placeholder.offsets[itemType];
            offsetOfResized = typeOffset * factorY;
            newTopPercentage += offsetOfResized / (total.height * factorY - imageSize.height) * 100;
            var placeholderRatio = total.height / total.width;
            placeholder.style.backgroundSize = newPercentage + '% ' + newPercentage * placeholderRatio + '%';
            placeholder.style.backgroundPosition = newLeftPercentage + '% ' + newTopPercentage + '%';
          }
        }
      };
      Image.prototype._addDragHandler = function () {
        if (!Image.sp_isDndAddedForImages) {
          Image.sp_isDndAddedForImages = true;
          var self = this;
          var dndTest = function (element) {
            if (self._isElementInAnyImage(element)) {
              var imageNode = self._getImageNodeFromElement(element);
              var hasUri = !!imageNode.getAttribute('data-uri');
              var hasText = !!imageNode.getAttribute('data-tooltip');
              return hasUri && hasText;
            } else {
              return false;
            }
          };
          var dndGetData = function (element) {
            var imageNode = self._getImageNodeFromElement(element);
            var uri = imageNode.getAttribute('data-uri');
            var text = imageNode.getAttribute('data-tooltip');
            var urls = [uri.toSpotifyURL()];
            var links = ['<a href="' + urls[0] + '">' + text + '</a>'];
            return {
              'text/plain': urls,
              'text/html': links
            };
          };
          var dndGetText = function (element) {
            var imageNode = self._getImageNodeFromElement(element);
            return imageNode.getAttribute('data-tooltip');
          };
          dnd.drag.addHandler(dndTest, dndGetData, dndGetText);
        }
      };
      Image.prototype._addContextUIHandler = function () {
        var self = this;
        this.node.oncontextmenu = function (e) {
          var isTargetLink = e.target.tagName.toLowerCase() === 'a';
          var isNodeLink = this.tagName.toLowerCase() === 'a';
          if (isTargetLink || isNodeLink) {
            var link = isTargetLink ? e.target : this;
            var uri = link.getAttribute('data-uri');
            uri = uri || link.href;
            var testSpotifyURI = SpotifyApi.Exps.spotify;
            var testSpotifyURL = SpotifyApi.Exps.http;
            if (!uri.match(testSpotifyURI) && !uri.match(testSpotifyURL)) {
              return;
            }
            var item = models.fromURI(uri);
            if (item) {
              var x = e.pageX - window.pageXOffset;
              var y = e.pageY - window.pageYOffset;
              models.client.showContextUI(item, {
                x: x,
                y: y
              });
              return false;
            }
            return;
          }
          if (self._item) {
            var x = e.pageX - window.pageXOffset;
            var y = e.pageY - window.pageYOffset;
            models.client.showContextUI(self._item, {
              x: x,
              y: y
            });
            return false;
          }
        };
      };
      Image.prototype._isElementInAnyImage = function (element) {
        return this._getImageNodeFromElement(element) !== document.documentElement ? true : false;
      };
      Image.prototype._getImageNodeFromElement = function (element) {
        while (!css.hasClass(element, 'sp-image') && element !== document) {
          element = element.parentNode;
        }
        return element !== document ? element : document.documentElement;
      };
      Image.prototype._getArtistsAsString = function (artists) {
        var output = '';
        for (var i = 0, l = artists.length; i < l; i++) {
          output += artists[i].name + (i < l - 1 ? ', ' : '');
        }
        return output;
      };
      var SIZES = {
        placeholder: {
          images: {
            '1': {
              x: 0,
              y: 0,
              width: 300,
              height: 300
            },
            '2': {
              x: 300,
              y: 0,
              width: 150,
              height: 150
            },
            '3': {
              x: 450,
              y: 0,
              width: 128,
              height: 128
            },
            '4': {
              x: 300,
              y: 150,
              width: 64,
              height: 64
            },
            '5': {
              x: 300,
              y: 214,
              width: 40,
              height: 40
            },
            'empty': {}
          },
          total: {
            width: 578,
            height: 1500,
            numTypes: 5
          },
          offsets: {
            'Album': 0,
            'Artist': 1,
            'Playlist': 2,
            'Track': 3,
            'User': 4
          }
        }
      };
      var tempImage = document.createElement('div');
      tempImage.className = 'sp-image-preloader';
      document.body.appendChild(tempImage);
      setTimeout(function () {
        document.body.removeChild(tempImage);
      }, 5000);
    }(require('node_modules/views/@loc.loc/strings/image.lang'), require('node_modules/views/scripts/utils/device.js'), require('node_modules/api/scripts/models.js'), require('node_modules/api/scripts/toplists.js').Toplist, require('node_modules/views/scripts/utils/css.js'), require('node_modules/views/scripts/utils/dom.js'), require('node_modules/views/scripts/utils/dnd.js'), require('node_modules/views/scripts/utils/touch.js'), require('node_modules/views/scripts/buttons.js')));
  },
  'node_modules/mout/collection/make_.js': function (require, module, exports, global, __filename, __dirname) {
    var slice = require('node_modules/mout/array/slice.js');
    function makeCollectionMethod(arrMethod, objMethod, defaultReturn) {
      return function () {
        var args = slice(arguments);
        if (args[0] == null) {
          return defaultReturn;
        }
        return typeof args[0].length === 'number' ? arrMethod.apply(null, args) : objMethod.apply(null, args);
      };
    }
    module.exports = makeCollectionMethod;
  },
  'node_modules/mout/collection/forEach.js': function (require, module, exports, global, __filename, __dirname) {
    var make = require('node_modules/mout/collection/make_.js');
    var arrForEach = require('node_modules/mout/array/forEach.js');
    var objForEach = require('node_modules/mout/object/forOwn.js');
    module.exports = make(arrForEach, objForEach);
  },
  'node_modules/mout/object/values.js': function (require, module, exports, global, __filename, __dirname) {
    var forOwn = require('node_modules/mout/object/forOwn.js');
    function values(obj) {
      var vals = [];
      forOwn(obj, function (val, key) {
        vals.push(val);
      });
      return vals;
    }
    module.exports = values;
  },
  'node_modules/mout/string/WHITE_SPACES.js': function (require, module, exports, global, __filename, __dirname) {
    module.exports = [
      ' ',
      '\n',
      '\r',
      '\t',
      '\f',
      '\x0B',
      '\xA0',
      '\u1680',
      '\u180E',
      '\u2000',
      '\u2001',
      '\u2002',
      '\u2003',
      '\u2004',
      '\u2005',
      '\u2006',
      '\u2007',
      '\u2008',
      '\u2009',
      '\u200A',
      '\u2028',
      '\u2029',
      '\u202F',
      '\u205F',
      '\u3000'
    ];
  },
  'node_modules/mout/lang/toString.js': function (require, module, exports, global, __filename, __dirname) {
    function toString(val) {
      return val == null ? '' : val.toString();
    }
    module.exports = toString;
  },
  'node_modules/mout/string/ltrim.js': function (require, module, exports, global, __filename, __dirname) {
    var toString = require('node_modules/mout/lang/toString.js');
    var WHITE_SPACES = require('node_modules/mout/string/WHITE_SPACES.js');
    function ltrim(str, chars) {
      str = toString(str);
      chars = chars || WHITE_SPACES;
      var start = 0, len = str.length, charLen = chars.length, found = true, i, c;
      while (found && start < len) {
        found = false;
        i = -1;
        c = str.charAt(start);
        while (++i < charLen) {
          if (c === chars[i]) {
            found = true;
            start++;
            break;
          }
        }
      }
      return start >= len ? '' : str.substr(start, len);
    }
    module.exports = ltrim;
  },
  'node_modules/mout/string/rtrim.js': function (require, module, exports, global, __filename, __dirname) {
    var toString = require('node_modules/mout/lang/toString.js');
    var WHITE_SPACES = require('node_modules/mout/string/WHITE_SPACES.js');
    function rtrim(str, chars) {
      str = toString(str);
      chars = chars || WHITE_SPACES;
      var end = str.length - 1, charLen = chars.length, found = true, i, c;
      while (found && end >= 0) {
        found = false;
        i = -1;
        c = str.charAt(end);
        while (++i < charLen) {
          if (c === chars[i]) {
            found = true;
            end--;
            break;
          }
        }
      }
      return end >= 0 ? str.substring(0, end + 1) : '';
    }
    module.exports = rtrim;
  },
  'node_modules/mout/string/trim.js': function (require, module, exports, global, __filename, __dirname) {
    var toString = require('node_modules/mout/lang/toString.js');
    var WHITE_SPACES = require('node_modules/mout/string/WHITE_SPACES.js');
    var ltrim = require('node_modules/mout/string/ltrim.js');
    var rtrim = require('node_modules/mout/string/rtrim.js');
    function trim(str, chars) {
      str = toString(str);
      chars = chars || WHITE_SPACES;
      return ltrim(rtrim(str, chars), chars);
    }
    module.exports = trim;
  },
  'node_modules/mout/lang/isKind.js': function (require, module, exports, global, __filename, __dirname) {
    var kindOf = require('node_modules/mout/lang/kindOf.js');
    function isKind(val, kind) {
      return kindOf(val) === kind;
    }
    module.exports = isKind;
  },
  'node_modules/mout/lang/isObject.js': function (require, module, exports, global, __filename, __dirname) {
    var isKind = require('node_modules/mout/lang/isKind.js');
    function isObject(val) {
      return isKind(val, 'Object');
    }
    module.exports = isObject;
  },
  'node_modules/mout/lang/isArray.js': function (require, module, exports, global, __filename, __dirname) {
    var isKind = require('node_modules/mout/lang/isKind.js');
    var isArray = Array.isArray || function (val) {
      return isKind(val, 'Array');
    };
    module.exports = isArray;
  },
  'node_modules/mout/object/deepMatches.js': function (require, module, exports, global, __filename, __dirname) {
    var forOwn = require('node_modules/mout/object/forOwn.js');
    var isArray = require('node_modules/mout/lang/isArray.js');
    function containsMatch(array, pattern) {
      var i = -1, length = array.length;
      while (++i < length) {
        if (deepMatches(array[i], pattern)) {
          return true;
        }
      }
      return false;
    }
    function matchArray(target, pattern) {
      var i = -1, patternLength = pattern.length;
      while (++i < patternLength) {
        if (!containsMatch(target, pattern[i])) {
          return false;
        }
      }
      return true;
    }
    function matchObject(target, pattern) {
      var result = true;
      forOwn(pattern, function (val, key) {
        if (!deepMatches(target[key], val)) {
          return result = false;
        }
      });
      return result;
    }
    function deepMatches(target, pattern) {
      if (target && typeof target === 'object') {
        if (isArray(target) && isArray(pattern)) {
          return matchArray(target, pattern);
        } else {
          return matchObject(target, pattern);
        }
      } else {
        return target === pattern;
      }
    }
    module.exports = deepMatches;
  },
  'node_modules/mout/function/makeIterator_.js': function (require, module, exports, global, __filename, __dirname) {
    var identity = require('node_modules/mout/function/identity.js');
    var prop = require('node_modules/mout/function/prop.js');
    var deepMatches = require('node_modules/mout/object/deepMatches.js');
    function makeIterator(src, thisObj) {
      if (src == null) {
        return identity;
      }
      switch (typeof src) {
      case 'function':
        return typeof thisObj !== 'undefined' ? function (val, i, arr) {
          return src.call(thisObj, val, i, arr);
        } : src;
      case 'object':
        return function (val) {
          return deepMatches(val, src);
        };
      case 'string':
      case 'number':
        return prop(src);
      }
    }
    module.exports = makeIterator;
  },
  'node_modules/mout/object/filter.js': function (require, module, exports, global, __filename, __dirname) {
    var forOwn = require('node_modules/mout/object/forOwn.js');
    var makeIterator = require('node_modules/mout/function/makeIterator_.js');
    function filterValues(obj, callback, thisObj) {
      callback = makeIterator(callback, thisObj);
      var output = {};
      forOwn(obj, function (value, key, obj) {
        if (callback(value, key, obj)) {
          output[key] = value;
        }
      });
      return output;
    }
    module.exports = filterValues;
  },
  'node_modules/mout/array/filter.js': function (require, module, exports, global, __filename, __dirname) {
    var makeIterator = require('node_modules/mout/function/makeIterator_.js');
    function filter(arr, callback, thisObj) {
      callback = makeIterator(callback, thisObj);
      var results = [];
      if (arr == null) {
        return results;
      }
      var i = -1, len = arr.length, value;
      while (++i < len) {
        value = arr[i];
        if (callback(value, i, arr)) {
          results.push(value);
        }
      }
      return results;
    }
    module.exports = filter;
  },
  'node_modules/mout/array/unique.js': function (require, module, exports, global, __filename, __dirname) {
    var filter = require('node_modules/mout/array/filter.js');
    function unique(arr, compare) {
      compare = compare || isEqual;
      return filter(arr, function (item, i, arr) {
        var n = arr.length;
        while (++i < n) {
          if (compare(item, arr[i])) {
            return false;
          }
        }
        return true;
      });
    }
    function isEqual(a, b) {
      return a === b;
    }
    module.exports = unique;
  },
  'node_modules/mout/array/map.js': function (require, module, exports, global, __filename, __dirname) {
    var makeIterator = require('node_modules/mout/function/makeIterator_.js');
    function map(arr, callback, thisObj) {
      callback = makeIterator(callback, thisObj);
      var results = [];
      if (arr == null) {
        return results;
      }
      var i = -1, len = arr.length;
      while (++i < len) {
        results[i] = callback(arr[i], i, arr);
      }
      return results;
    }
    module.exports = map;
  },
  'node_modules/spotify-live/util/range.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var prime = require('node_modules/prime/index.js');
    var map = require('node_modules/mout/array/map.js'), slice = require('node_modules/mout/array/slice.js');
    var Range = prime({
      constructor: function Range(start, end) {
        this.update(start, end);
      },
      update: function (start, end) {
        if (start != null)
          this.start = start;
        if (end != null)
          this.end = end;
        if (this.start == null || this.end == null)
          throw new Error('invalid range');
        if (this.start > this.end)
          throw new Error('invalid range');
        this.length = this.end - this.start;
        return this;
      },
      copy: function () {
        return new Range(this.start, this.end);
      },
      above: function (range) {
        if (!range)
          return false;
        return this.start >= range.end;
      },
      below: function (range) {
        if (!range)
          return false;
        return this.end <= range.start;
      },
      adjacent: function (range) {
        if (!range)
          return false;
        return this.end === range.start || this.start === range.end;
      },
      intersects: function (range) {
        if (!range)
          return false;
        return !this.above(range) && !this.below(range);
      },
      contains: function (range) {
        if (!range)
          return false;
        return this.start <= range.start && this.end >= range.end;
      },
      contained: function (range) {
        var ranges;
        if (range instanceof Range)
          ranges = arguments;
        else
          ranges = range;
        if (!ranges)
          return false;
        for (var i = 0; range = ranges[i]; i++) {
          if (range.start <= this.start && range.end >= this.end)
            return true;
        }
        return false;
      },
      fits: function (prev, next) {
        if (!prev && !next)
          return true;
        if (!prev)
          return this.end <= next.start;
        if (!next)
          return this.start >= prev.end;
        return this.start >= prev.end && this.end <= next.start;
      },
      between: function (prev, next) {
        if (!prev && !next)
          return this.copy();
        if (!prev)
          return this.start >= next.start ? null : new Range(this.start, Math.min(this.end, next.start));
        if (!next)
          return this.end <= prev.end ? null : new Range(Math.max(prev.end, this.start), this.end);
        return this.end > prev.end && this.start < next.start ? new Range(Math.max(prev.end, this.start), Math.min(next.start, this.end)) : null;
      },
      intersection: function (range) {
        var intersected = [], ranges;
        if (range instanceof Range)
          ranges = arguments;
        else
          ranges = range;
        for (var k = 0; k < ranges.length; k++) {
          var r = ranges[k];
          if (this.below(r))
            break;
          if (r.intersects(this))
            intersected.push(new Range(Math.max(this.start, r.start), Math.min(this.end, r.end)));
        }
        return intersected;
      },
      subtract: function (range) {
        var subtracted = [], ranges;
        if (range instanceof Range)
          ranges = arguments;
        else
          ranges = range;
        for (var k = -1; k < ranges.length; k++) {
          var prev = ranges[k];
          var next = ranges[k + 1];
          var between = this.between(prev, next);
          if (between)
            subtracted.push(between);
        }
        return subtracted;
      },
      extract: function (range) {
        var ranges = range instanceof Range ? slice(arguments) : range.slice();
        for (var k = 0; k < ranges.length; k++) {
          var prev = ranges[k - 1];
          var next = ranges[k];
          var newRange = null;
          if (this.below(next)) {
            newRange = new Range(next.start - this.length, next.end - this.length);
          } else if (this.intersects(next)) {
            var subtracted = next.subtract(this);
            if (subtracted.length === 2) {
              newRange = new Range(subtracted[0].start, subtracted[1].end - this.length);
            } else if (subtracted.length === 1) {
              if (next.end > this.end) {
                newRange = new Range(subtracted[0].start - this.length, subtracted[0].end - this.length);
              } else if (this.start > next.start) {
                newRange = new Range(subtracted[0].start, subtracted[0].end);
              }
            } else {
              ranges.splice(k--, 1);
            }
          } else {
            ranges.splice(k, 1, next.copy());
          }
          if (newRange) {
            if (prev && prev.end === newRange.start) {
              ranges.splice(k-- - 1, 2, new Range(prev.start, newRange.end));
            } else {
              ranges.splice(k, 1, newRange);
            }
          }
        }
        return ranges;
      },
      insert: function (range) {
        var ranges = range instanceof Range ? slice(arguments) : range.slice();
        for (var k = 0; k < ranges.length; k++) {
          var next = ranges[k];
          if (this.start >= next.end) {
            ranges.splice(k, 1, next.copy());
          } else if (this.start > next.start && this.start < next.end) {
            ranges.splice(k, 1, new Range(next.start, this.start), new Range(this.start, next.end));
          } else {
            ranges.splice(k, 1, new Range(next.start + this.length, next.end + this.length));
          }
        }
        return this.merge(ranges);
      },
      merge: function (range) {
        var ranges;
        if (range instanceof Range)
          ranges = arguments;
        else
          ranges = range;
        ranges = map(ranges, function (r) {
          return r.copy();
        });
        if (!ranges.length)
          return [this.copy()];
        for (var k = -1, l = ranges.length; k < l; k++) {
          var prev = ranges[k];
          var next = ranges[k + 1];
          var between = this.between(prev, next);
          if (between) {
            if (!prev && next) {
              if (between.end === next.start) {
                next.update(between.start, next.end);
              } else {
                k++;
                ranges.unshift(between);
              }
            } else if (prev && next) {
              if (prev.end === between.start && between.end === next.start) {
                prev.update(prev.start, next.end);
                ranges.splice(k-- + 1, 1);
              } else if (prev.end === between.start) {
                prev.update(prev.start, between.end);
              } else if (between.end === next.start) {
                next.update(between.start, next.end);
              } else {
                ranges.splice(k + 1, 0, between);
              }
            } else if (prev && !next) {
              if (prev.end === between.start) {
                prev.update(prev.start, between.end);
              } else {
                k++;
                ranges.push(between);
              }
            }
          }
        }
        return ranges;
      },
      remove: function (range) {
        var ranges;
        if (range instanceof Range)
          ranges = arguments;
        else
          ranges = range;
        var result = [];
        for (var i = 0; i < ranges.length; i++) {
          var remaining = ranges[i].subtract(this);
          if (remaining.length) {
            result.push.apply(result, remaining);
          }
        }
        return result;
      },
      toIndices: function () {
        var indices = [];
        for (var i = this.start; i < this.end; i++)
          indices.push(i);
        return indices;
      },
      toString: function () {
        return [
          this.start,
          this.end
        ] + '';
      }
    });
    Range.fromString = function (string) {
      var parts = string.split(',');
      return new Range(+parts[0], +parts[1]);
    };
    Range.fromIndices = function (indices) {
      indices.sort(function (a, b) {
        return a > b ? 1 : -1;
      });
      var ranges = [], rstart, rend;
      for (var i = 0; i < indices.length; i++) {
        rstart = indices[i];
        rend = rstart;
        while (indices[i + 1] - indices[i] === 1) {
          rend = indices[i + 1];
          i++;
        }
        ranges.push(new Range(rstart, rend + 1));
      }
      return ranges;
    };
    var exports = function (start, end) {
      return new Range(start, end);
    };
    module.exports = exports;
    exports.Range = Range;
    exports.fromIndices = Range.fromIndices;
    exports.fromString = Range.fromString;
  },
  'node_modules/spotify-live/util/parser.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var range = require('node_modules/spotify-live/util/range.js');
    var parse = function (string) {
      var results = [];
      var b = '(';
      var e = ')';
      var bs = '[';
      var es = ']';
      var s = ' ';
      var cm = ',';
      var bindex = 0, eindex = 0;
      var count = 0;
      var strings = [];
      var objects = [];
      var key = '';
      var ibs = 0;
      var bnes = 0, snes = 0;
      for (var i = 0; i < string.length + 1; i++) {
        var c = string.charAt(i);
        if (!count) {
          if (!ibs) {
            if (/\w/.exec(c)) {
              key += c;
            } else if (key && (!c || c === s || c === b || c === cm || c === bs)) {
              if (c === bs) {
                snes++;
                ibs = i;
              } else {
                objects.push({ key: key });
                key = '';
              }
            }
          } else {
            if (c === es) {
              snes--;
              var contents = string.substring(ibs + 1, i);
              objects.push({
                key: key,
                range: range.fromString(contents)
              });
              ibs = 0;
              key = '';
            }
          }
        }
        if (c === b) {
          bnes++;
          if (!count++)
            bindex = i + 1;
        } else if (c === e) {
          bnes--;
          if (--count === 0) {
            eindex = i;
            strings[objects.length - 1] = string.substring(bindex, eindex);
          }
        }
        if (bnes === -1 || snes === -1)
          throw new Error('query syntax error');
      }
      if (bnes !== 0 || snes !== 0)
        throw new Error('query syntax error');
      for (var i = 0; i < objects.length; i++) {
        var str = strings[i], obj = objects[i], value = { key: obj.key };
        if (str)
          value.query = parse(str);
        if (obj.range)
          value.range = obj.range;
        results.push(value);
      }
      return results;
    };
    module.exports = parse;
  },
  'node_modules/mout/array/some.js': function (require, module, exports, global, __filename, __dirname) {
    var makeIterator = require('node_modules/mout/function/makeIterator_.js');
    function some(arr, callback, thisObj) {
      callback = makeIterator(callback, thisObj);
      var result = false;
      if (arr == null) {
        return result;
      }
      var i = -1, len = arr.length;
      while (++i < len) {
        if (callback(arr[i], i, arr)) {
          result = true;
          break;
        }
      }
      return result;
    }
    module.exports = some;
  },
  'node_modules/mout/array/difference.js': function (require, module, exports, global, __filename, __dirname) {
    var unique = require('node_modules/mout/array/unique.js');
    var filter = require('node_modules/mout/array/filter.js');
    var some = require('node_modules/mout/array/some.js');
    var contains = require('node_modules/mout/array/contains.js');
    var slice = require('node_modules/mout/array/slice.js');
    function difference(arr) {
      var arrs = slice(arguments, 1), result = filter(unique(arr), function (needle) {
          return !some(arrs, function (haystack) {
            return contains(haystack, needle);
          });
        });
      return result;
    }
    module.exports = difference;
  },
  'node_modules/mout/collection/map.js': function (require, module, exports, global, __filename, __dirname) {
    var isObject = require('node_modules/mout/lang/isObject.js');
    var values = require('node_modules/mout/object/values.js');
    var arrMap = require('node_modules/mout/array/map.js');
    var makeIterator = require('node_modules/mout/function/makeIterator_.js');
    function map(list, callback, thisObj) {
      callback = makeIterator(callback, thisObj);
      if (isObject(list) && list.length == null) {
        list = values(list);
      }
      return arrMap(list, function (val, key, list) {
        return callback(val, key, list);
      });
    }
    module.exports = map;
  },
  'node_modules/finally/index.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var prime = require('node_modules/prime/index.js');
    var kindOf = require('node_modules/mout/lang/kindOf.js');
    var map = require('node_modules/mout/array/map.js');
    var slice = require('node_modules/mout/array/slice.js');
    var forEach = require('node_modules/mout/array/forEach.js');
    var reduce = require('node_modules/mout/array/reduce.js');
    var each = require('node_modules/mout/collection/forEach.js');
    var cmap = require('node_modules/mout/collection/map.js');
    var push_ = Array.prototype.push;
    var Flow = prime({
      constructor: function Flow() {
        this._seq = [];
      },
      then: function () {
        this._push(this._callbacks(arguments));
        return this;
      },
      _parallel: function (parallel, args) {
        var self = this;
        return function () {
          var control = new Controller(self, self._index++);
          self._controls.push(control);
          parallel.apply(control, args ? args.concat(slice(arguments)) : arguments);
        };
      },
      _push: function (parallels, args) {
        if (!parallels.length)
          return;
        this._seq.push(map(parallels, function (parallel) {
          return this._parallel(parallel, args);
        }, this));
      },
      _callbacks: function (callbacks) {
        return reduce(callbacks, function (a, b) {
          if (kindOf(b) === 'Array')
            push_.apply(a, b);
          else
            a.push(b);
          return a;
        }, []);
      },
      sequential: function (object) {
        var callbacks = this._callbacks(slice(arguments, 1));
        each(object, function (value, key) {
          this._push(callbacks, [
            value,
            key
          ]);
        }, this);
        return this;
      },
      parallel: function (object, parallel) {
        var parallels = cmap(object, function (value, key) {
          return this._parallel(parallel, [
            value,
            key
          ]);
        }, this);
        if (parallels.length)
          this._seq.push(parallels);
        return this;
      },
      finally: function () {
        this.then.apply(this, arguments);
        this._continue.call(this);
        return this;
      },
      run: function () {
        this._continue.apply(this, arguments);
        return this;
      },
      _break: function () {
        this._seq.splice(0, this._seq.length - 1);
        this._continue.apply(this, arguments);
      },
      _spread: function (error, args) {
        var seq = this._next();
        if (!seq || !(seq = seq[0]))
          return;
        if (!args || !args.length)
          args = [undefined];
        this._length = args.length;
        forEach(args, function (arg) {
          seq(error, arg);
        });
      },
      _continue: function () {
        var seq = this._next();
        if (!seq)
          return;
        this._length = seq.length;
        var args = arguments;
        forEach(seq, function (parallel) {
          parallel.apply(null, args);
        });
      },
      _next: function () {
        var seq = this._seq.shift();
        if (!seq)
          return;
        if (this._controls)
          forEach(this._controls, function (control) {
            control._kill();
          });
        this._arguments = [];
        this._errors = [];
        this._controls = [];
        this._index = 0;
        return seq;
      },
      _done: function (index, error, data) {
        this._arguments[index] = data;
        if (error)
          this._errors.push(error);
        if (!--this._length) {
          var errors = null;
          if (this._errors.length === 1)
            errors = this._errors[0];
          else if (this._errors.length)
            errors = new Error(map(this._errors, function (e) {
              return e.message;
            }).join('\n'));
          this._continue.apply(this, [errors].concat(this._arguments));
        } else
          this._controls[index]._kill();
      }
    });
    var Controller = function Controller(flow, index) {
      var dead;
      this._kill = function () {
        dead = true;
      };
      this.break = function () {
        if (!dead)
          flow._break.apply(flow, arguments);
      };
      this.continue = function () {
        if (!dead)
          flow._continue.apply(flow, arguments);
      };
      this.spread = function (error, args) {
        if (!dead)
          flow._spread(error, args);
      };
      var done = this.done = function (error, data) {
        if (!dead)
          flow._done.call(flow, index, error, data);
      };
    };
    module.exports = function () {
      var flow = new Flow();
      flow.then.apply(flow, arguments);
      return flow;
    };
  },
  'node_modules/spotify-live/index.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var prime = require('node_modules/prime/index.js'), defer = require('node_modules/prime/defer.js'), Emitter = require('node_modules/prime/emitter.js');
    var kindOf = require('node_modules/mout/lang/kindOf.js'), forIn = require('node_modules/mout/object/forIn.js'), isPlainObject = require('node_modules/mout/lang/isPlainObject.js'), objectFilter = require('node_modules/mout/object/filter.js'), mixIn = require('node_modules/mout/object/mixIn.js'), difference = require('node_modules/mout/array/difference.js'), forEach = require('node_modules/mout/array/forEach.js'), combine = require('node_modules/mout/array/combine.js'), append = require('node_modules/mout/array/append.js'), remove = require('node_modules/mout/array/remove.js'), filter = require('node_modules/mout/array/filter.js'), map = require('node_modules/mout/array/map.js');
    var flow = require('node_modules/finally/index.js');
    var splice_ = Array.prototype.splice, slice_ = Array.prototype.slice;
    var EMIT_SYNC = Emitter.EMIT_SYNC;
    var Range = require('node_modules/spotify-live/util/range.js').Range;
    var parse = require('node_modules/spotify-live/util/parser.js');
    var kind = function (object) {
      if (object instanceof LiveList || object instanceof LiveModel)
        return 'live';
      if (isPlainObject(object))
        return kindOf(object.operations) === 'Array' ? 'list' : 'object';
      var ko = kindOf(object);
      if (ko === 'Array')
        return 'list';
      if (ko === 'String')
        return 'string';
      return null;
    };
    var serialize = function (value) {
      return value instanceof LiveModel || value instanceof LiveList ? value.serialize() : value;
    };
    var LiveList = prime({
      mixin: Emitter,
      constructor: function LiveList(length) {
        this.length = length || 0;
        this._index = [];
      },
      _mesh: function (index, howMany, items, isPublish) {
        index = +index || 0;
        howMany = +howMany || 0;
        if (!items)
          items = [];
        if (index > this.length)
          this.length = index;
        if (index + howMany > this.length)
          howMany = this.length - index;
        var length = items.length;
        var remove = new Range(index, index + howMany);
        var insert = new Range(index, index + length);
        if (howMany) {
          this._index = remove.extract(this._index);
        }
        if (length) {
          this._index = insert.insert(this._index);
        }
        items = map(items, function (item) {
          switch (kind(item)) {
          case 'object':
            return modelify(item, isPublish);
          case 'list':
            return listify(item, isPublish);
          }
          return item;
        });
        var removed;
        var limit = 60000;
        if (items.length > limit) {
          var cursor = 0;
          var doRemove = !!howMany;
          while (cursor < items.length || doRemove) {
            var chunk = items.slice(cursor, cursor + limit);
            var spliced = splice_.apply(this, [
              cursor + index,
              doRemove ? howMany : 0
            ].concat(chunk));
            if (doRemove)
              removed = spliced;
            cursor += limit;
            doRemove = false;
          }
        } else {
          removed = splice_.apply(this, [
            index,
            howMany
          ].concat(items));
        }
        if (howMany || length) {
          var event = {
            index: index,
            insert: items,
            remove: removed
          };
          this.emit('update', event);
          if (isPublish)
            this.emit('publish', event);
        }
        return removed;
      },
      update: function (item) {
        return this._update(item);
      },
      publish: function (item) {
        return this._update(item, true);
      },
      _update: function (item, isPublish) {
        var operations;
        switch (kindOf(item)) {
        case 'Array':
          operations = [{
              index: 0,
              remove: this.length,
              insert: item
            }];
          break;
        case 'Object':
          operations = item.operations;
          break;
        default:
          operations = [];
        }
        forEach(operations, function (op) {
          if (op.length)
            this.length = op.length;
          this._mesh(op.index, op.remove, op.insert, isPublish);
        }, this);
        return this;
      },
      serialize: function () {
        var array;
        if (this._index.length === 1 && this.length === this._index[this._index.length - 1].end)
          array = [];
        else
          array = { length: this.length };
        forEach(this._index, function (range) {
          for (var i = range.start; i < range.end; i++)
            array[i] = serialize(this[i]);
        }, this);
        return array;
      },
      query: function (selector, callback, mode) {
        if (!mode)
          mode = ASYNC;
        var data;
        queryList(this, { query: parse(selector) }, function (error, json, wasSync) {
          if (callback) {
            if (wasSync && mode === ASYNC)
              defer(function () {
                callback(null, json);
              });
            else
              callback(null, json);
          } else {
            data = json;
          }
        }, !callback || mode === SYNC);
        return callback ? this : data;
      },
      _wait: function (required) {
        var self = this;
        if (!this._waiting)
          this._waiting = [];
        if (!this._required)
          this._required = [];
        forEach(this._waiting, function (range) {
          required = range.remove(required);
        });
        if (required.length) {
          var requiredCountForTick = this._required.length;
          forEach(required, function (r) {
            self._required = r.merge(self._required);
          });
          if (requiredCountForTick === 0) {
            defer(function () {
              forEach(this._required, function (r) {
                self._waiting = r.merge(self._waiting);
              });
              this.emit('wait', this._required);
              var timeOut;
              if (live.debug) {
                timeOut = setTimeout(function () {
                  console.warn(self, 'is waiting for', self._waiting);
                  timeOut = null;
                }, 2000);
              }
              forEach(this._required, function (range) {
                self.get(range, function (error) {
                  if (error)
                    return console.error(error);
                  self._waiting = range.remove(self._waiting);
                  if (live.debug) {
                    console.log(self, 'done waiting for', range);
                    if (!self._waiting.length && timeOut) {
                      clearTimeout(timeOut);
                    }
                  }
                });
              });
              delete this._required;
            }, this);
          }
        }
      },
      _get: function (ranges, callback) {
        var self = this;
        var getRequired = function () {
          var diff = self._index;
          forEach(ranges, function (req) {
            diff = req.subtract(diff);
          });
          return diff;
        };
        var required = getRequired();
        if (required.length) {
          this._wait(required);
          var check = function () {
            var r = getRequired();
            if (!r.length) {
              self.off('update', check);
              callback();
            }
          };
          this.on('update', check);
        } else {
          callback(null, true);
        }
      },
      get: function (what, toIndex) {
        if (arguments.length === 1 && typeof what === 'number')
          return this[what];
        var self = this;
        var args = slice_.call(arguments);
        var callback, mode, requested;
        var isResultSet = false;
        var isSingleValue = false;
        forEach(args, function (arg, i) {
          if (kindOf(arg) === 'Function') {
            var split = args.splice(i, 2);
            callback = split[0];
            mode = split[1] || ASYNC;
            return false;
          }
        });
        if (what instanceof Range) {
          requested = args;
          if (requested.length > 1)
            isResultSet = true;
        } else if (kindOf(what) === 'Array') {
          isResultSet = true;
          requested = what;
        } else {
          var hasToIndex = !isNaN(+toIndex);
          if (!hasToIndex)
            toIndex = what + 1;
          isSingleValue = !hasToIndex;
          requested = [new Range(what, toIndex)];
        }
        var result = function (asResultSet) {
          if (isSingleValue)
            return self[what];
          if (asResultSet) {
            return map(requested, function (range) {
              return slice_.call(self, range.start, range.end);
            });
          } else {
            var range = requested[0];
            return slice_.call(self, range.start, range.end);
          }
        };
        var done = function () {
          return callback.apply(null, [null].concat(result(true)));
        };
        if (!callback) {
          return result(isResultSet);
        } else if (mode === SYNC) {
          done();
        } else {
          this._get(requested, function (error, sync) {
            if (sync && mode === ASYNC)
              defer(done);
            else
              done();
          });
        }
        return this;
      }
    });
    var cache = {};
    var LiveModel = prime({
      mixin: Emitter,
      constructor: function LiveModel(uri) {
        this.uri = uri;
        this._data = {};
        this.emit('init', EMIT_SYNC);
      },
      delete: function (key) {
        var data = this._data;
        var value = data[key];
        delete data[key];
        return value;
      },
      emit: function () {
        var uri = this.uri;
        if (uri) {
          var keys = emitters.keys;
          var values = emitters.values;
          var args = slice_.call(arguments);
          args.splice(1, 0, this);
          forEach(keys, function (key, i) {
            if (uri.match(key)) {
              var emitter = values[i];
              emitter.emit.apply(emitter, args);
            }
          });
        }
        Emitter.prototype.emit.apply(this, arguments);
      },
      update: function (object) {
        return this._update(object);
      },
      publish: function (object) {
        return this._update(object, true);
      },
      _update: function (object, isPublish) {
        var data = this._data;
        var _emit = this._emit;
        if (!_emit) {
          var old = mixIn({}, data);
          _emit = this._emit = {
            publish: {},
            update: {}
          };
          defer(function () {
            var update = objectFilter(_emit.update, function (v, key) {
              return data[key] !== old[key];
            });
            var publish = objectFilter(_emit.publish, function (v, key) {
              return data[key] !== old[key];
            });
            delete this._emit;
            var k;
            for (k in update) {
              this.emit('update', update, EMIT_SYNC);
              break;
            }
            for (k in publish) {
              this.emit('publish', publish, EMIT_SYNC);
              break;
            }
          }, this);
        }
        forIn(object, function (value, key) {
          var prev = data[key];
          var k = kind(value);
          if (k === 'list' && prev instanceof LiveList) {
            prev._update(value, isPublish);
          } else {
            if (k === 'object') {
              value = modelify(value, isPublish);
            } else if (k === 'list') {
              value = listify(value, isPublish);
            }
            data[key] = _emit.update[key] = value;
            if (isPublish)
              _emit.publish[key] = value;
          }
        }, this);
        return this;
      },
      serialize: function () {
        var object = {}, self = this._data;
        for (var key in self)
          object[key] = serialize(self[key]);
        return object;
      },
      query: function (selector, callback, mode) {
        if (!mode)
          mode = ASYNC;
        var data;
        queryModel(this, parse(selector), function (error, json, wasSync) {
          if (callback) {
            if (wasSync && mode !== ASAP && mode !== SYNC)
              defer(function () {
                callback(null, json);
              });
            else
              callback(null, json);
          } else {
            data = json;
          }
        }, !callback || mode === SYNC);
        return callback ? this : data;
      },
      _wait: function (required) {
        var _waiting = this._waiting || (this._waiting = []);
        var _required = this._required || (this._required = []);
        var newProperties = difference(required, _waiting);
        if (newProperties.length) {
          var requiredCountForTick = _required.length;
          combine(_required, newProperties);
          if (requiredCountForTick === 0) {
            defer(function () {
              append(_waiting, _required);
              this.emit('wait', _required);
              var uri, timeOut;
              if (live.debug) {
                uri = this.uri;
                timeOut = setTimeout(function () {
                  console.warn(uri, 'is waiting _for', _waiting);
                  timeOut = null;
                }, 2000);
              }
              var self = this;
              forEach(_required, function (property) {
                self.get(property, function (error) {
                  if (error)
                    return console.error(error);
                  remove(_waiting, property);
                  if (live.debug) {
                    console.log(uri, 'done waiting for', property);
                    if (!_waiting.length && timeOut) {
                      clearTimeout(timeOut);
                    }
                  }
                });
              });
              delete this._required;
            }, this);
          }
        }
      },
      _get: function (keys, callback) {
        var self = this;
        var data = this._data;
        var required = filter(keys, function (key) {
          return !(key in data);
        });
        if (required.length) {
          this._wait(required);
          var check = function (event) {
            for (var key in event)
              remove(required, key);
            if (!required.length) {
              self.off('update', check);
              callback();
            }
          };
          this.on('update', check);
        } else {
          callback(null, true);
        }
      },
      get: function (key) {
        var data = this._data;
        if (arguments.length === 1 && typeof key === 'string')
          return data[key];
        var args = slice_.call(arguments);
        var callback, mode, keys;
        forEach(args, function (arg, i) {
          if (kindOf(arg) === 'Function') {
            var split = args.splice(i, 2);
            callback = split[0];
            mode = split[1] || ASYNC;
            return false;
          }
        });
        var isResultSet = false;
        if (kindOf(key) === 'Array') {
          keys = key;
          isResultSet = true;
        } else {
          keys = args;
          if (keys.length > 1)
            isResultSet = true;
        }
        var result = function (asResultSet) {
          if (asResultSet) {
            return map(keys, function (key) {
              return data[key];
            });
          } else {
            return data[keys[0]];
          }
        };
        var done = function () {
          callback.apply(null, [null].concat(result(true)));
        };
        if (!callback) {
          return result(isResultSet);
        } else if (mode === SYNC) {
          done();
        } else {
          this._get(keys, function (error, sync) {
            if (sync && mode === ASYNC)
              defer(done);
            else
              done();
          });
        }
        return this;
      }
    });
    var queryModel = function (object, parsed, callback, forceSync) {
      var data = {};
      if (!parsed)
        parsed = [];
      var keys = map(parsed, 'key');
      if (!keys.length)
        return callback(null, data, true);
      var queryValues = function (error, sync) {
        var query = flow();
        query.parallel(parsed, function (req) {
          var control = this;
          var key = req.key;
          var item = object._data[key];
          if (item instanceof LiveList) {
            queryList(item, req, function (error, json, _sync) {
              if (!_sync)
                sync = false;
              control.done(null, data[key] = json);
            }, forceSync);
          } else if (item instanceof LiveModel) {
            queryModel(item, req.query, function (error, json, _sync) {
              if (!_sync)
                sync = false;
              control.done(null, data[key] = json);
            }, forceSync);
          } else {
            control.done(null, data[key] = item);
          }
        });
        query.finally(function (error) {
          callback(error, data, sync);
        });
      };
      if (forceSync) {
        queryValues(null, true);
      } else {
        object._get(keys, queryValues);
      }
    };
    var queryList = function (list, parsed, callback, forceSync) {
      var data = [];
      var range = parsed.range;
      if (!range)
        range = new Range(0, list.length);
      if (!range.length)
        return callback(null, data, true);
      var start = range.start;
      var end = range.end;
      var queryValues = function (error, sync) {
        var parallels = [];
        var j = 0;
        var loop = function (item) {
          parallels.push(function () {
            var control = this;
            var k = j++;
            if (item instanceof LiveModel) {
              queryModel(item, parsed.query, function (error, json, _sync) {
                if (!_sync)
                  sync = false;
                control.done(null, data[k] = json);
              }, forceSync);
            } else if (item instanceof LiveList) {
              queryList(item, parsed, function (error, json, _sync) {
                if (!_sync)
                  sync = false;
                control.done(null, data[k] = json);
              }, forceSync);
            } else {
              control.done(null, data[k] = item);
            }
          });
        };
        for (var i = start; i < end; i++)
          loop(list[i], i);
        flow(parallels).finally(function (error) {
          callback(error, data, sync);
        });
      };
      if (forceSync) {
        queryValues(null, true);
      } else {
        list._get([range], queryValues);
      }
    };
    var subs = {
      values: [],
      keys: []
    };
    var inits = {
      values: [],
      keys: []
    };
    var modelify = function (object, isPublish) {
      var uri = object.uri;
      var model;
      if (!uri) {
        model = new LiveModel();
      } else {
        var cached = cache[uri];
        if (cached) {
          model = cached;
        } else {
          var Found;
          forEach(subs.keys, function (match, i) {
            if (uri.match(match))
              return !(Found = subs.values[i]);
          });
          model = cache[uri] = Found ? new Found(uri) : new LiveModel(uri);
          forEach(inits.keys, function (match, i) {
            if (uri.match(match))
              inits.values[i].call(model, model);
          });
        }
      }
      return model._update(object, isPublish);
    };
    var listify = function (item, isPublish) {
      var list = new LiveList();
      return list._update(item, isPublish);
    };
    var live = function (item) {
      if (!item)
        item = {};
      switch (kind(item)) {
      case 'list':
        return listify(item);
      case 'string':
        return modelify({ uri: item });
      case 'object':
        return modelify(item);
      case 'live':
        return item;
      }
      return null;
    };
    live.register = function (matches, model) {
      if (arguments.length === 1) {
        model = matches;
        matches = model.matches;
        if (model.register) {
          model.register();
        } else if (kindOf(model) === 'Object') {
          forIn(model, function (model) {
            live.register(model);
          });
          return this;
        }
      }
      if (model.prototype instanceof LiveModel) {
        subs.keys.unshift(matches);
        subs.values.unshift(model);
      } else if (kindOf(model) === 'Function') {
        inits.keys.push(matches);
        inits.values.push(model);
      }
      return this;
    };
    var emitters = {
      keys: [],
      values: []
    };
    live.subscribe = function (match, name, handle) {
      if (match.matches)
        match = match.matches;
      var string = match.toString();
      var keys = emitters.keys;
      var values = emitters.values;
      var emitter;
      forEach(keys, function (key, i) {
        if (key.toString() === string)
          return !(emitter = values[i]);
      });
      if (!emitter) {
        keys.push(match);
        values.push(emitter = new Emitter());
      }
      emitter.on(name, handle);
      return this;
    };
    live.unsubscribe = function (match, name, handle) {
      if (match.matches)
        match = match.matches;
      var string = match.toString();
      var keys = emitters.keys;
      var values = emitters.values;
      var emitter;
      forEach(keys, function (key, i) {
        if (key.toString() === string)
          return !(emitter = values[i]);
      });
      if (emitter)
        emitter.off(name, handle);
      return this;
    };
    var ASYNC = live.ASYNC = 0;
    var SYNC = live.SYNC = 1;
    var ASAP = live.ASAP = 2;
    live.Model = LiveModel;
    live.List = LiveList;
    module.exports = live;
  },
  'node_modules/spotify-live-models/client.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var live = require('node_modules/spotify-live/index.js');
    var bridge = require('node_modules/spotify-live-models/util/bridge.js').request;
    function updateCurrentUser(model) {
      bridge('user_metadata', ['spotify:user:@'], function (error, payload) {
        if (error)
          throw error;
        model.update({
          currentUser: {
            uri: 'spotify:user:' + encodeURIComponent(payload.username),
            name: payload.name,
            username: payload.username
          }
        });
      });
    }
    function updateFeatures(model) {
      bridge('client_features', [], function (error, payload) {
        if (error)
          throw error;
        model.update({ features: payload.features });
      });
    }
    function updateSessionData(model) {
      bridge('session_query', [], function (error, payload) {
        if (error)
          throw error;
        model.update({ session: payload });
      });
    }
    function showContextMenu(model, event) {
      var uris = event.uris;
      var x = event.x;
      var y = event.y;
      var context = event.context && event.context.uri || null;
      var index = event.index;
      bridge('client_show_context_ui', [
        uris,
        x,
        y,
        context,
        index
      ]);
    }
    function onWait(model, properties) {
      if (properties.indexOf('currentUser') > -1) {
        updateCurrentUser(model);
      }
      if (properties.indexOf('features') > -1) {
        updateFeatures(model);
      }
      if (properties.indexOf('session') > -1) {
        updateSessionData(model);
      }
    }
    function onInit(model) {
      if (global.__spotify && global.__spotify.username) {
        model.update({ currentUser: { username: global.__spotify.username } });
      }
      updateCurrentUser(model);
    }
    var regExp = exports.matches = /^spotify:client$/;
    exports.register = function () {
      live.subscribe(regExp, 'wait', onWait);
      live.subscribe(regExp, 'init', onInit);
      live.subscribe(regExp, 'show-context-menu', showContextMenu);
    };
    exports.unregister = function () {
      live.unsubscribe(regExp, 'wait', onWait);
      live.unsubscribe(regExp, 'init', onInit);
      live.unsubscribe(regExp, 'show-context-menu', showContextMenu);
    };
  },
  'node_modules/mout/array/every.js': function (require, module, exports, global, __filename, __dirname) {
    var makeIterator = require('node_modules/mout/function/makeIterator_.js');
    function every(arr, callback, thisObj) {
      callback = makeIterator(callback, thisObj);
      var result = true;
      if (arr == null) {
        return result;
      }
      var i = -1, len = arr.length;
      while (++i < len) {
        if (!callback(arr[i], i, arr)) {
          result = false;
          break;
        }
      }
      return result;
    }
    module.exports = every;
  },
  'node_modules/spotify-events/node_modules/elements/base.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var prime = require('node_modules/prime/index.js');
    var forEach = require('node_modules/mout/array/forEach.js'), map = require('node_modules/mout/array/map.js'), filter = require('node_modules/mout/array/filter.js'), every = require('node_modules/mout/array/every.js'), some = require('node_modules/mout/array/some.js');
    var index = 0, __dc = document.__counter, counter = document.__counter = (__dc ? parseInt(__dc, 36) + 1 : 0).toString(36), key = 'uid:' + counter;
    var uniqueID = function (n) {
      if (n === window)
        return 'window';
      if (n === document)
        return 'document';
      if (n === document.documentElement)
        return 'html';
      return n[key] || (n[key] = (index++).toString(36));
    };
    var instances = {};
    var $ = prime({
      constructor: function $(n, context) {
        if (n == null)
          return this && this.constructor === $ ? new Elements() : null;
        var self, uid;
        if (n.constructor !== Elements) {
          self = new Elements();
          if (typeof n === 'string') {
            if (!self.search)
              return null;
            self[self.length++] = context || document;
            return self.search(n);
          }
          if (n.nodeType || n === window) {
            self[self.length++] = n;
          } else if (n.length) {
            var uniques = {};
            for (var i = 0, l = n.length; i < l; i++) {
              var nodes = $(n[i], context);
              if (nodes && nodes.length)
                for (var j = 0, k = nodes.length; j < k; j++) {
                  var node = nodes[j];
                  uid = uniqueID(node);
                  if (!uniques[uid]) {
                    self[self.length++] = node;
                    uniques[uid] = true;
                  }
                }
            }
          }
        } else {
          self = n;
        }
        if (!self.length)
          return null;
        if (self.length === 1) {
          uid = uniqueID(self[0]);
          return instances[uid] || (instances[uid] = self);
        }
        return self;
      }
    });
    var Elements = prime({
      inherits: $,
      constructor: function Elements() {
        this.length = 0;
      },
      unlink: function () {
        return this.map(function (node) {
          delete instances[uniqueID(node)];
          return node;
        });
      },
      forEach: function (method, context) {
        forEach(this, method, context);
        return this;
      },
      map: function (method, context) {
        return map(this, method, context);
      },
      filter: function (method, context) {
        return filter(this, method, context);
      },
      every: function (method, context) {
        return every(this, method, context);
      },
      some: function (method, context) {
        return some(this, method, context);
      }
    });
    module.exports = $;
  },
  'node_modules/spotify-events/node_modules/elements/attributes.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var $ = require('node_modules/spotify-events/node_modules/elements/base.js');
    var trim = require('node_modules/mout/string/trim.js'), forEach = require('node_modules/mout/array/forEach.js'), filter = require('node_modules/mout/array/filter.js'), indexOf = require('node_modules/mout/array/indexOf.js');
    $.implement({
      setAttribute: function (name, value) {
        return this.forEach(function (node) {
          node.setAttribute(name, value);
        });
      },
      getAttribute: function (name) {
        var attr = this[0].getAttributeNode(name);
        return attr && attr.specified ? attr.value : null;
      },
      hasAttribute: function (name) {
        var node = this[0];
        if (node.hasAttribute)
          return node.hasAttribute(name);
        var attr = node.getAttributeNode(name);
        return !!(attr && attr.specified);
      },
      removeAttribute: function (name) {
        return this.forEach(function (node) {
          var attr = node.getAttributeNode(name);
          if (attr)
            node.removeAttributeNode(attr);
        });
      }
    });
    var accessors = {};
    forEach([
      'type',
      'value',
      'name',
      'href',
      'title',
      'id'
    ], function (name) {
      accessors[name] = function (value) {
        return value !== undefined ? this.forEach(function (node) {
          node[name] = value;
        }) : this[0][name];
      };
    });
    forEach([
      'checked',
      'disabled',
      'selected'
    ], function (name) {
      accessors[name] = function (value) {
        return value !== undefined ? this.forEach(function (node) {
          node[name] = !!value;
        }) : !!this[0][name];
      };
    });
    var classes = function (className) {
      var classNames = trim(className).replace(/\s+/g, ' ').split(' '), uniques = {};
      return filter(classNames, function (className) {
        if (className !== '' && !uniques[className])
          return uniques[className] = className;
      }).sort();
    };
    accessors.className = function (className) {
      return className !== undefined ? this.forEach(function (node) {
        node.className = classes(className).join(' ');
      }) : classes(this[0].className).join(' ');
    };
    $.implement({
      attribute: function (name, value) {
        var accessor = accessors[name];
        if (accessor)
          return accessor.call(this, value);
        if (value != null)
          return this.setAttribute(name, value);
        if (value === null)
          return this.removeAttribute(name);
        if (value === undefined)
          return this.getAttribute(name);
      }
    });
    $.implement(accessors);
    $.implement({
      check: function () {
        return this.checked(true);
      },
      uncheck: function () {
        return this.checked(false);
      },
      disable: function () {
        return this.disabled(true);
      },
      enable: function () {
        return this.disabled(false);
      },
      select: function () {
        return this.selected(true);
      },
      deselect: function () {
        return this.selected(false);
      }
    });
    $.implement({
      classNames: function () {
        return classes(this[0].className);
      },
      hasClass: function (className) {
        return indexOf(this.classNames(), className) > -1;
      },
      addClass: function (className) {
        return this.forEach(function (node) {
          var nodeClassName = node.className;
          var classNames = classes(nodeClassName + ' ' + className).join(' ');
          if (nodeClassName !== classNames)
            node.className = classNames;
        });
      },
      removeClass: function (className) {
        return this.forEach(function (node) {
          var classNames = classes(node.className);
          forEach(classes(className), function (className) {
            var index = indexOf(classNames, className);
            if (index > -1)
              classNames.splice(index, 1);
          });
          node.className = classNames.join(' ');
        });
      }
    });
    $.prototype.toString = function () {
      var tag = this.tag(), id = this.id(), classes = this.classNames();
      var str = tag;
      if (id)
        str += '#' + id;
      if (classes.length)
        str += '.' + classes.join('.');
      return str;
    };
    var textProperty = document.createElement('div').textContent == null ? 'innerText' : 'textContent';
    $.implement({
      tag: function () {
        return this[0].tagName.toLowerCase();
      },
      html: function (html) {
        return html !== undefined ? this.forEach(function (node) {
          node.innerHTML = html;
        }) : this[0].innerHTML;
      },
      text: function (text) {
        return text !== undefined ? this.forEach(function (node) {
          node[textProperty] = text;
        }) : this[0][textProperty];
      },
      data: function (key, value) {
        switch (value) {
        case undefined:
          return this.getAttribute('data-' + key);
        case null:
          return this.removeAttribute('data-' + key);
        default:
          return this.setAttribute('data-' + key, value);
        }
      }
    });
    module.exports = $;
  },
  'node_modules/spotify-events/node_modules/elements/events.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var Emitter = require('node_modules/prime/emitter.js');
    var $ = require('node_modules/spotify-events/node_modules/elements/base.js');
    var html = document.documentElement;
    var addEventListener = html.addEventListener ? function (node, event, handle, useCapture) {
      node.addEventListener(event, handle, useCapture || false);
      return handle;
    } : function (node, event, handle) {
      node.attachEvent('on' + event, handle);
      return handle;
    };
    var removeEventListener = html.removeEventListener ? function (node, event, handle, useCapture) {
      node.removeEventListener(event, handle, useCapture || false);
    } : function (node, event, handle) {
      node.detachEvent('on' + event, handle);
    };
    $.implement({
      on: function (event, handle, useCapture) {
        return this.forEach(function (node) {
          var self = $(node);
          var internalEvent = event + (useCapture ? ':capture' : '');
          Emitter.prototype.on.call(self, internalEvent, handle);
          var domListeners = self._domListeners || (self._domListeners = {});
          if (!domListeners[internalEvent])
            domListeners[internalEvent] = addEventListener(node, event, function (e) {
              Emitter.prototype.emit.call(self, internalEvent, e || window.event, Emitter.EMIT_SYNC);
            }, useCapture);
        });
      },
      off: function (event, handle, useCapture) {
        return this.forEach(function (node) {
          var self = $(node);
          var internalEvent = event + (useCapture ? ':capture' : '');
          var domListeners = self._domListeners, domEvent, listeners = self._listeners, events;
          if (domListeners && (domEvent = domListeners[internalEvent]) && listeners && (events = listeners[internalEvent])) {
            Emitter.prototype.off.call(self, internalEvent, handle);
            if (!self._listeners || !self._listeners[event]) {
              removeEventListener(node, event, domEvent);
              delete domListeners[event];
              for (var l in domListeners)
                return;
              delete self._domListeners;
            }
          }
        });
      },
      emit: function () {
        var args = arguments;
        return this.forEach(function (node) {
          Emitter.prototype.emit.apply($(node), args);
        });
      }
    });
    module.exports = $;
  },
  'node_modules/spotify-events/node_modules/elements/insertion.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var $ = require('node_modules/spotify-events/node_modules/elements/base.js');
    $.implement({
      appendChild: function (child) {
        this[0].appendChild($(child)[0]);
        return this;
      },
      insertBefore: function (child, ref) {
        this[0].insertBefore($(child)[0], $(ref)[0]);
        return this;
      },
      removeChild: function (child) {
        this[0].removeChild($(child)[0]);
        return this;
      },
      replaceChild: function (child, ref) {
        this[0].replaceChild($(child)[0], $(ref)[0]);
        return this;
      }
    });
    $.implement({
      before: function (element) {
        element = $(element)[0];
        var parent = element.parentNode;
        if (parent)
          this.forEach(function (node) {
            parent.insertBefore(node, element);
          });
        return this;
      },
      after: function (element) {
        element = $(element)[0];
        var parent = element.parentNode;
        if (parent)
          this.forEach(function (node) {
            parent.insertBefore(node, element.nextSibling);
          });
        return this;
      },
      bottom: function (element) {
        element = $(element)[0];
        return this.forEach(function (node) {
          element.appendChild(node);
        });
      },
      top: function (element) {
        element = $(element)[0];
        return this.forEach(function (node) {
          element.insertBefore(node, element.firstChild);
        });
      }
    });
    $.implement({
      insert: $.prototype.bottom,
      remove: function () {
        return this.forEach(function (node) {
          var parent = node.parentNode;
          if (parent)
            parent.removeChild(node);
        });
      },
      replace: function (element) {
        element = $(element)[0];
        element.parentNode.replaceChild(this[0], element);
        return this;
      }
    });
    module.exports = $;
  },
  'node_modules/spotify-events/node_modules/elements/node_modules/slick/parser.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var escapeRe = /([-.*+?^${}()|[\]\/\\])/g, unescapeRe = /\\/g;
    var escape = function (string) {
      return (string + '').replace(escapeRe, '\\$1');
    };
    var unescape = function (string) {
      return (string + '').replace(unescapeRe, '');
    };
    var slickRe = RegExp('^(?:\\s*(,)\\s*|\\s*(<combinator>+)\\s*|(\\s+)|(<unicode>+|\\*)|\\#(<unicode>+)|\\.(<unicode>+)|\\[\\s*(<unicode1>+)(?:\\s*([*^$!~|]?=)(?:\\s*(?:(["\']?)(.*?)\\9)))?\\s*\\](?!\\])|(:+)(<unicode>+)(?:\\((?:(?:(["\'])([^\\13]*)\\13)|((?:\\([^)]+\\)|[^()]*)+))\\))?)'.replace(/<combinator>/, '[' + escape('>+~`!@$%^&={}\\;</') + ']').replace(/<unicode>/g, '(?:[\\w\\u00a1-\\uFFFF-]|\\\\[^\\s0-9a-f])').replace(/<unicode1>/g, '(?:[:\\w\\u00a1-\\uFFFF-]|\\\\[^\\s0-9a-f])'));
    var Part = function Part(combinator) {
      this.combinator = combinator || ' ';
      this.tag = '*';
    };
    Part.prototype.toString = function () {
      if (!this.raw) {
        var xpr = '', k, part;
        xpr += this.tag || '*';
        if (this.id)
          xpr += '#' + this.id;
        if (this.classes)
          xpr += '.' + this.classList.join('.');
        if (this.attributes)
          for (k = 0; part = this.attributes[k++];) {
            xpr += '[' + part.name + (part.operator ? part.operator + '"' + part.value + '"' : '') + ']';
          }
        if (this.pseudos)
          for (k = 0; part = this.pseudos[k++];) {
            xpr += ':' + part.name;
            if (part.value)
              xpr += '(' + part.value + ')';
          }
        this.raw = xpr;
      }
      return this.raw;
    };
    var Expression = function Expression() {
      this.length = 0;
    };
    Expression.prototype.toString = function () {
      if (!this.raw) {
        var xpr = '';
        for (var j = 0, bit; bit = this[j++];) {
          if (j !== 1)
            xpr += ' ';
          if (bit.combinator !== ' ')
            xpr += bit.combinator + ' ';
          xpr += bit;
        }
        this.raw = xpr;
      }
      return this.raw;
    };
    var replacer = function (rawMatch, separator, combinator, combinatorChildren, tagName, id, className, attributeKey, attributeOperator, attributeQuote, attributeValue, pseudoMarker, pseudoClass, pseudoQuote, pseudoClassQuotedValue, pseudoClassValue) {
      var expression, current;
      if (separator || !this.length) {
        expression = this[this.length++] = new Expression();
        if (separator)
          return '';
      }
      if (!expression)
        expression = this[this.length - 1];
      if (combinator || combinatorChildren || !expression.length) {
        current = expression[expression.length++] = new Part(combinator);
      }
      if (!current)
        current = expression[expression.length - 1];
      if (tagName) {
        current.tag = unescape(tagName);
      } else if (id) {
        current.id = unescape(id);
      } else if (className) {
        var unescaped = unescape(className);
        var classes = current.classes || (current.classes = {});
        if (!classes[unescaped]) {
          classes[unescaped] = escape(className);
          var classList = current.classList || (current.classList = []);
          classList.push(unescaped);
          classList.sort();
        }
      } else if (pseudoClass) {
        pseudoClassValue = pseudoClassValue || pseudoClassQuotedValue;
        (current.pseudos || (current.pseudos = [])).push({
          type: pseudoMarker.length == 1 ? 'class' : 'element',
          name: unescape(pseudoClass),
          escapedName: escape(pseudoClass),
          value: pseudoClassValue ? unescape(pseudoClassValue) : null,
          escapedValue: pseudoClassValue ? escape(pseudoClassValue) : null
        });
      } else if (attributeKey) {
        attributeValue = attributeValue ? escape(attributeValue) : null;
        (current.attributes || (current.attributes = [])).push({
          operator: attributeOperator,
          name: unescape(attributeKey),
          escapedName: escape(attributeKey),
          value: attributeValue ? unescape(attributeValue) : null,
          escapedValue: attributeValue ? escape(attributeValue) : null
        });
      }
      return '';
    };
    var Expressions = function Expressions(expression) {
      this.length = 0;
      var self = this;
      var original = expression, replaced;
      while (expression) {
        replaced = expression.replace(slickRe, function () {
          return replacer.apply(self, arguments);
        });
        if (replaced === expression)
          throw new Error(original + ' is an invalid expression');
        expression = replaced;
      }
    };
    Expressions.prototype.toString = function () {
      if (!this.raw) {
        var expressions = [];
        for (var i = 0, expression; expression = this[i++];)
          expressions.push(expression);
        this.raw = expressions.join(', ');
      }
      return this.raw;
    };
    var cache = {};
    var parse = function (expression) {
      if (expression == null)
        return null;
      expression = ('' + expression).replace(/^\s+|\s+$/g, '');
      return cache[expression] || (cache[expression] = new Expressions(expression));
    };
    module.exports = parse;
  },
  'node_modules/spotify-events/node_modules/elements/node_modules/slick/finder.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var parse = require('node_modules/spotify-events/node_modules/elements/node_modules/slick/parser.js');
    var index = 0, counter = document.__counter = (parseInt(document.__counter || -1, 36) + 1).toString(36), key = 'uid:' + counter;
    var uniqueID = function (n, xml) {
      if (n === window)
        return 'window';
      if (n === document)
        return 'document';
      if (n === document.documentElement)
        return 'html';
      if (xml) {
        var uid = n.getAttribute(key);
        if (!uid) {
          uid = (index++).toString(36);
          n.setAttribute(key, uid);
        }
        return uid;
      } else {
        return n[key] || (n[key] = (index++).toString(36));
      }
    };
    var uniqueIDXML = function (n) {
      return uniqueID(n, true);
    };
    var isArray = Array.isArray || function (object) {
      return Object.prototype.toString.call(object) === '[object Array]';
    };
    var uniqueIndex = 0;
    var HAS = {
      GET_ELEMENT_BY_ID: function (test, id) {
        id = 'slick_' + uniqueIndex++;
        test.innerHTML = '<a id="' + id + '"></a>';
        return !!this.getElementById(id);
      },
      QUERY_SELECTOR: function (test) {
        test.innerHTML = '_<style>:nth-child(2){}</style>';
        test.innerHTML = '<a class="MiX"></a>';
        return test.querySelectorAll('.MiX').length === 1;
      },
      EXPANDOS: function (test, id) {
        id = 'slick_' + uniqueIndex++;
        test._custom_property_ = id;
        return test._custom_property_ === id;
      },
      MATCHES_SELECTOR: function (test) {
        test.className = 'MiX';
        var matches = test.matchesSelector || test.mozMatchesSelector || test.webkitMatchesSelector;
        if (matches)
          try {
            matches.call(test, ':slick');
          } catch (e) {
            return matches.call(test, '.MiX') ? matches : false;
          }
        return false;
      },
      GET_ELEMENTS_BY_CLASS_NAME: function (test) {
        test.innerHTML = '<a class="f"></a><a class="b"></a>';
        if (test.getElementsByClassName('b').length !== 1)
          return false;
        test.firstChild.className = 'b';
        if (test.getElementsByClassName('b').length !== 2)
          return false;
        test.innerHTML = '<a class="a"></a><a class="f b a"></a>';
        if (test.getElementsByClassName('a').length !== 2)
          return false;
        return true;
      },
      GET_ATTRIBUTE: function (test) {
        var shout = 'fus ro dah';
        test.innerHTML = '<a class="' + shout + '"></a>';
        return test.firstChild.getAttribute('class') === shout;
      }
    };
    var Finder = function Finder(document) {
      this.document = document;
      var root = this.root = document.documentElement;
      this.tested = {};
      this.uniqueID = this.has('EXPANDOS') ? uniqueID : uniqueIDXML;
      this.getAttribute = this.has('GET_ATTRIBUTE') ? function (node, name) {
        return node.getAttribute(name);
      } : function (node, name) {
        node = node.getAttributeNode(name);
        return node && node.specified ? node.value : null;
      };
      this.hasAttribute = root.hasAttribute ? function (node, attribute) {
        return node.hasAttribute(attribute);
      } : function (node, attribute) {
        node = node.getAttributeNode(attribute);
        return !!(node && node.specified);
      };
      this.contains = document.contains && root.contains ? function (context, node) {
        return context.contains(node);
      } : root.compareDocumentPosition ? function (context, node) {
        return context === node || !!(context.compareDocumentPosition(node) & 16);
      } : function (context, node) {
        do {
          if (node === context)
            return true;
        } while (node = node.parentNode);
        return false;
      };
      this.sorter = root.compareDocumentPosition ? function (a, b) {
        if (!a.compareDocumentPosition || !b.compareDocumentPosition)
          return 0;
        return a.compareDocumentPosition(b) & 4 ? -1 : a === b ? 0 : 1;
      } : 'sourceIndex' in root ? function (a, b) {
        if (!a.sourceIndex || !b.sourceIndex)
          return 0;
        return a.sourceIndex - b.sourceIndex;
      } : document.createRange ? function (a, b) {
        if (!a.ownerDocument || !b.ownerDocument)
          return 0;
        var aRange = a.ownerDocument.createRange(), bRange = b.ownerDocument.createRange();
        aRange.setStart(a, 0);
        aRange.setEnd(a, 0);
        bRange.setStart(b, 0);
        bRange.setEnd(b, 0);
        return aRange.compareBoundaryPoints(Range.START_TO_END, bRange);
      } : null;
      this.failed = {};
      var nativeMatches = this.has('MATCHES_SELECTOR');
      if (nativeMatches)
        this.matchesSelector = function (node, expression) {
          if (this.failed[expression])
            return null;
          try {
            return nativeMatches.call(node, expression);
          } catch (e) {
            if (slick.debug)
              console.warn('matchesSelector failed on ' + expression);
            this.failed[expression] = true;
            return null;
          }
        };
      if (this.has('QUERY_SELECTOR')) {
        this.querySelectorAll = function (node, expression) {
          if (this.failed[expression])
            return true;
          var result, _id, _expression, _combinator, _node;
          if (node !== this.document) {
            _combinator = expression[0].combinator;
            _id = node.getAttribute('id');
            _expression = expression;
            if (!_id) {
              _node = node;
              _id = '__slick__';
              _node.setAttribute('id', _id);
            }
            expression = '#' + _id + ' ' + _expression;
            if (_combinator.indexOf('~') > -1 || _combinator.indexOf('+') > -1) {
              node = node.parentNode;
              if (!node)
                result = true;
            }
          }
          if (!result)
            try {
              result = node.querySelectorAll(expression.toString());
            } catch (e) {
              if (slick.debug)
                console.warn('querySelectorAll failed on ' + (_expression || expression));
              result = this.failed[_expression || expression] = true;
            }
          if (_node)
            _node.removeAttribute('id');
          return result;
        };
      }
    };
    Finder.prototype.has = function (FEATURE) {
      var tested = this.tested, testedFEATURE = tested[FEATURE];
      if (testedFEATURE != null)
        return testedFEATURE;
      var root = this.root, document = this.document, testNode = document.createElement('div');
      testNode.setAttribute('style', 'display: none;');
      root.appendChild(testNode);
      var TEST = HAS[FEATURE], result = false;
      if (TEST)
        try {
          result = TEST.call(document, testNode);
        } catch (e) {
        }
      if (slick.debug && !result)
        console.warn('document has no ' + FEATURE);
      root.removeChild(testNode);
      return tested[FEATURE] = result;
    };
    var combinators = {
      ' ': function (node, part, push) {
        var item, items;
        var noId = !part.id, noTag = !part.tag, noClass = !part.classes;
        if (part.id && node.getElementById && this.has('GET_ELEMENT_BY_ID')) {
          item = node.getElementById(part.id);
          if (item && item.getAttribute('id') === part.id) {
            items = [item];
            noId = true;
            if (part.tag === '*')
              noTag = true;
          }
        }
        if (!items) {
          if (part.classes && node.getElementsByClassName && this.has('GET_ELEMENTS_BY_CLASS_NAME')) {
            items = node.getElementsByClassName(part.classList);
            noClass = true;
            if (part.tag === '*')
              noTag = true;
          } else {
            items = node.getElementsByTagName(part.tag);
            if (part.tag !== '*')
              noTag = true;
          }
          if (!items || !items.length)
            return false;
        }
        for (var i = 0; item = items[i++];)
          if (noTag && noId && noClass && !part.attributes && !part.pseudos || this.match(item, part, noTag, noId, noClass))
            push(item);
        return true;
      },
      '>': function (node, part, push) {
        if (node = node.firstChild)
          do {
            if (node.nodeType == 1 && this.match(node, part))
              push(node);
          } while (node = node.nextSibling);
      },
      '+': function (node, part, push) {
        while (node = node.nextSibling)
          if (node.nodeType == 1) {
            if (this.match(node, part))
              push(node);
            break;
          }
      },
      '^': function (node, part, push) {
        node = node.firstChild;
        if (node) {
          if (node.nodeType === 1) {
            if (this.match(node, part))
              push(node);
          } else {
            combinators['+'].call(this, node, part, push);
          }
        }
      },
      '~': function (node, part, push) {
        while (node = node.nextSibling) {
          if (node.nodeType === 1 && this.match(node, part))
            push(node);
        }
      },
      '++': function (node, part, push) {
        combinators['+'].call(this, node, part, push);
        combinators['!+'].call(this, node, part, push);
      },
      '~~': function (node, part, push) {
        combinators['~'].call(this, node, part, push);
        combinators['!~'].call(this, node, part, push);
      },
      '!': function (node, part, push) {
        while (node = node.parentNode)
          if (node !== this.document && this.match(node, part))
            push(node);
      },
      '!>': function (node, part, push) {
        node = node.parentNode;
        if (node !== this.document && this.match(node, part))
          push(node);
      },
      '!+': function (node, part, push) {
        while (node = node.previousSibling)
          if (node.nodeType == 1) {
            if (this.match(node, part))
              push(node);
            break;
          }
      },
      '!^': function (node, part, push) {
        node = node.lastChild;
        if (node) {
          if (node.nodeType == 1) {
            if (this.match(node, part))
              push(node);
          } else {
            combinators['!+'].call(this, node, part, push);
          }
        }
      },
      '!~': function (node, part, push) {
        while (node = node.previousSibling) {
          if (node.nodeType === 1 && this.match(node, part))
            push(node);
        }
      }
    };
    Finder.prototype.search = function (context, expression, found) {
      if (!context)
        context = this.document;
      else if (!context.nodeType && context.document)
        context = context.document;
      var expressions = parse(expression);
      if (!expressions || !expressions.length)
        throw new Error('invalid expression');
      if (!found)
        found = [];
      var uniques, push = isArray(found) ? function (node) {
          found[found.length] = node;
        } : function (node) {
          found[found.length++] = node;
        };
      if (expressions.length > 1) {
        uniques = {};
        var plush = push;
        push = function (node) {
          var uid = uniqueID(node);
          if (!uniques[uid]) {
            uniques[uid] = true;
            plush(node);
          }
        };
      }
      var node, nodes, part;
      main:
        for (var i = 0; expression = expressions[i++];) {
          if (!slick.noQSA && this.querySelectorAll) {
            nodes = this.querySelectorAll(context, expression);
            if (nodes !== true) {
              if (nodes && nodes.length)
                for (var j = 0; node = nodes[j++];)
                  if (node.nodeName > '@') {
                    push(node);
                  }
              continue main;
            }
          }
          if (expression.length === 1) {
            part = expression[0];
            combinators[part.combinator].call(this, context, part, push);
          } else {
            var cs = [context], c, f, u, p = function (node) {
                var uid = uniqueID(node);
                if (!u[uid]) {
                  u[uid] = true;
                  f[f.length] = node;
                }
              };
            for (var j = 0; part = expression[j++];) {
              f = [];
              u = {};
              for (var k = 0; c = cs[k++];)
                combinators[part.combinator].call(this, c, part, p);
              if (!f.length)
                continue main;
              cs = f;
            }
            if (i === 0)
              found = f;
            else
              for (var l = 0; l < f.length; l++)
                push(f[l]);
          }
        }
      if (uniques && found && found.length > 1)
        this.sort(found);
      return found;
    };
    Finder.prototype.sort = function (nodes) {
      return this.sorter ? Array.prototype.sort.call(nodes, this.sorter) : nodes;
    };
    var pseudos = {
      'empty': function () {
        return !(this && this.nodeType === 1) && !(this.innerText || this.textContent || '').length;
      },
      'not': function (expression) {
        return !slick.match(this, expression);
      },
      'contains': function (text) {
        return (this.innerText || this.textContent || '').indexOf(text) > -1;
      },
      'first-child': function () {
        var node = this;
        while (node = node.previousSibling)
          if (node.nodeType == 1)
            return false;
        return true;
      },
      'last-child': function () {
        var node = this;
        while (node = node.nextSibling)
          if (node.nodeType == 1)
            return false;
        return true;
      },
      'only-child': function () {
        var prev = this;
        while (prev = prev.previousSibling)
          if (prev.nodeType == 1)
            return false;
        var next = this;
        while (next = next.nextSibling)
          if (next.nodeType == 1)
            return false;
        return true;
      },
      'first-of-type': function () {
        var node = this, nodeName = node.nodeName;
        while (node = node.previousSibling)
          if (node.nodeName == nodeName)
            return false;
        return true;
      },
      'last-of-type': function () {
        var node = this, nodeName = node.nodeName;
        while (node = node.nextSibling)
          if (node.nodeName == nodeName)
            return false;
        return true;
      },
      'only-of-type': function () {
        var prev = this, nodeName = this.nodeName;
        while (prev = prev.previousSibling)
          if (prev.nodeName == nodeName)
            return false;
        var next = this;
        while (next = next.nextSibling)
          if (next.nodeName == nodeName)
            return false;
        return true;
      },
      'enabled': function () {
        return !this.disabled;
      },
      'disabled': function () {
        return this.disabled;
      },
      'checked': function () {
        return this.checked || this.selected;
      },
      'selected': function () {
        return this.selected;
      },
      'focus': function () {
        var doc = this.ownerDocument;
        return doc.activeElement === this && (this.href || this.type || slick.hasAttribute(this, 'tabindex'));
      },
      'root': function () {
        return this === this.ownerDocument.documentElement;
      }
    };
    Finder.prototype.match = function (node, bit, noTag, noId, noClass) {
      if (!slick.noQSA && this.matchesSelector) {
        var matches = this.matchesSelector(node, bit);
        if (matches !== null)
          return matches;
      }
      if (!noTag && bit.tag) {
        var nodeName = node.nodeName.toLowerCase();
        if (bit.tag === '*') {
          if (nodeName < '@')
            return false;
        } else if (nodeName != bit.tag) {
          return false;
        }
      }
      if (!noId && bit.id && node.getAttribute('id') !== bit.id)
        return false;
      var i, part;
      if (!noClass && bit.classes) {
        var className = this.getAttribute(node, 'class');
        if (!className)
          return false;
        for (part in bit.classes)
          if (!RegExp('(^|\\s)' + bit.classes[part] + '(\\s|$)').test(className))
            return false;
      }
      var name, value;
      if (bit.attributes)
        for (i = 0; part = bit.attributes[i++];) {
          var operator = part.operator, escaped = part.escapedValue;
          name = part.name;
          value = part.value;
          if (!operator) {
            if (!this.hasAttribute(node, name))
              return false;
          } else {
            var actual = this.getAttribute(node, name);
            if (actual == null)
              return false;
            switch (operator) {
            case '^=':
              if (!RegExp('^' + escaped).test(actual))
                return false;
              break;
            case '$=':
              if (!RegExp(escaped + '$').test(actual))
                return false;
              break;
            case '~=':
              if (!RegExp('(^|\\s)' + escaped + '(\\s|$)').test(actual))
                return false;
              break;
            case '|=':
              if (!RegExp('^' + escaped + '(-|$)').test(actual))
                return false;
              break;
            case '=':
              if (actual !== value)
                return false;
              break;
            case '*=':
              if (actual.indexOf(value) === -1)
                return false;
              break;
            default:
              return false;
            }
          }
        }
      if (bit.pseudos)
        for (i = 0; part = bit.pseudos[i++];) {
          name = part.name;
          value = part.value;
          if (pseudos[name])
            return pseudos[name].call(node, value);
          if (value != null) {
            if (this.getAttribute(node, name) !== value)
              return false;
          } else {
            if (!this.hasAttribute(node, name))
              return false;
          }
        }
      return true;
    };
    Finder.prototype.matches = function (node, expression) {
      var expressions = parse(expression);
      if (expressions.length === 1 && expressions[0].length === 1) {
        return this.match(node, expressions[0][0]);
      }
      if (!slick.noQSA && this.matchesSelector) {
        var matches = this.matchesSelector(node, expressions);
        if (matches !== null)
          return matches;
      }
      var nodes = this.search(this.document, expression, { length: 0 });
      for (var i = 0, res; res = nodes[i++];)
        if (node === res)
          return true;
      return false;
    };
    var finders = {};
    var finder = function (context) {
      var doc = context || document;
      if (doc.ownerDocument)
        doc = doc.ownerDocument;
      else if (doc.document)
        doc = doc.document;
      if (doc.nodeType !== 9)
        throw new TypeError('invalid document');
      var uid = uniqueID(doc);
      return finders[uid] || (finders[uid] = new Finder(doc));
    };
    var slick = function (expression, context) {
      return slick.search(expression, context);
    };
    slick.search = function (expression, context, found) {
      return finder(context).search(context, expression, found);
    };
    slick.find = function (expression, context) {
      return finder(context).search(context, expression)[0] || null;
    };
    slick.getAttribute = function (node, name) {
      return finder(node).getAttribute(node, name);
    };
    slick.hasAttribute = function (node, name) {
      return finder(node).hasAttribute(node, name);
    };
    slick.contains = function (context, node) {
      return finder(context).contains(context, node);
    };
    slick.matches = function (node, expression) {
      return finder(node).matches(node, expression);
    };
    slick.sort = function (nodes) {
      if (nodes && nodes.length > 1)
        finder(nodes[0]).sort(nodes);
      return nodes;
    };
    slick.parse = parse;
    module.exports = slick;
  },
  'node_modules/spotify-events/node_modules/elements/node_modules/slick/index.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    module.exports = 'document' in global ? require('node_modules/spotify-events/node_modules/elements/node_modules/slick/finder.js') : { parse: require('node_modules/spotify-events/node_modules/elements/node_modules/slick/parser.js') };
  },
  'node_modules/spotify-events/node_modules/elements/traversal.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var map = require('node_modules/mout/array/map.js');
    var slick = require('node_modules/spotify-events/node_modules/elements/node_modules/slick/index.js');
    var $ = require('node_modules/spotify-events/node_modules/elements/base.js');
    var gen = function (combinator, expression) {
      return map(slick.parse(expression || '*'), function (part) {
        return combinator + ' ' + part;
      }).join(', ');
    };
    var push_ = Array.prototype.push;
    $.implement({
      search: function (expression) {
        if (this.length === 1)
          return $(slick.search(expression, this[0], new $()));
        var buffer = [];
        for (var i = 0, node; node = this[i]; i++)
          push_.apply(buffer, slick.search(expression, node));
        buffer = $(buffer);
        return buffer && buffer.sort();
      },
      find: function (expression) {
        if (this.length === 1)
          return $(slick.find(expression, this[0]));
        for (var i = 0, node; node = this[i]; i++) {
          var found = slick.find(expression, node);
          if (found)
            return $(found);
        }
        return null;
      },
      sort: function () {
        return slick.sort(this);
      },
      matches: function (expression) {
        return slick.matches(this[0], expression);
      },
      contains: function (node) {
        return slick.contains(this[0], node);
      },
      nextSiblings: function (expression) {
        return this.search(gen('~', expression));
      },
      nextSibling: function (expression) {
        return this.find(gen('+', expression));
      },
      previousSiblings: function (expression) {
        return this.search(gen('!~', expression));
      },
      previousSibling: function (expression) {
        return this.find(gen('!+', expression));
      },
      children: function (expression) {
        return this.search(gen('>', expression));
      },
      firstChild: function (expression) {
        return this.find(gen('^', expression));
      },
      lastChild: function (expression) {
        return this.find(gen('!^', expression));
      },
      parent: function (expression) {
        var buffer = [];
        loop:
          for (var i = 0, node; node = this[i]; i++)
            while ((node = node.parentNode) && node !== document) {
              if (!expression || slick.matches(node, expression)) {
                buffer.push(node);
                break loop;
                break;
              }
            }
        return $(buffer);
      },
      parents: function (expression) {
        var buffer = [];
        for (var i = 0, node; node = this[i]; i++)
          while ((node = node.parentNode) && node !== document) {
            if (!expression || slick.matches(node, expression))
              buffer.push(node);
          }
        return $(buffer);
      }
    });
    module.exports = $;
  },
  'node_modules/spotify-events/node_modules/elements/delegation.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var Map = require('node_modules/prime/map.js');
    var $ = require('node_modules/spotify-events/node_modules/elements/events.js');
    require('node_modules/spotify-events/node_modules/elements/traversal.js');
    $.implement({
      delegate: function (event, selector, handle) {
        return this.forEach(function (node) {
          var self = $(node);
          var delegation = self._delegation || (self._delegation = {}), events = delegation[event] || (delegation[event] = {}), map = events[selector] || (events[selector] = new Map());
          if (map.get(handle))
            return;
          var action = function (e) {
            var target = $(e.target || e.srcElement), match = target.matches(selector) ? target : target.parent(selector);
            var res;
            if (match)
              res = handle.call(self, e, match);
            return res;
          };
          map.set(handle, action);
          self.on(event, action);
        });
      },
      undelegate: function (event, selector, handle) {
        return this.forEach(function (node) {
          var self = $(node), delegation, events, map;
          if (!(delegation = self._delegation) || !(events = delegation[event]) || !(map = events[selector]))
            return;
          var action = map.get(handle);
          if (action) {
            self.off(event, action);
            map.remove(action);
            if (!map.count())
              delete events[selector];
            var e1 = true, e2 = true, x;
            for (x in events) {
              e1 = false;
              break;
            }
            if (e1)
              delete delegation[event];
            for (x in delegation) {
              e2 = false;
              break;
            }
            if (e2)
              delete self._delegation;
          }
        });
      }
    });
    module.exports = $;
  },
  'node_modules/spotify-events/node_modules/elements/index.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var $ = require('node_modules/spotify-events/node_modules/elements/base.js');
    require('node_modules/spotify-events/node_modules/elements/attributes.js');
    require('node_modules/spotify-events/node_modules/elements/events.js');
    require('node_modules/spotify-events/node_modules/elements/insertion.js');
    require('node_modules/spotify-events/node_modules/elements/traversal.js');
    require('node_modules/spotify-events/node_modules/elements/delegation.js');
    module.exports = $;
  },
  'node_modules/spotify-events/add.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var $ = require('node_modules/spotify-events/node_modules/elements/index.js');
    var forIn = require('node_modules/mout/object/forIn.js');
    var live = require('node_modules/spotify-live/index.js');
    var center = require('node_modules/spotify-events/center.js');
    var getAddType = require('node_modules/spotify-events/util/type.js');
    var IS_FOLLOWING_PROPERTY = 'isFollowing';
    var IS_IN_COLLECTION_PROPERTY = 'isInCollection';
    var FOLLOWERSCOUNT_PROPERTY = 'followersCount';
    var FOLLOWINGCOUNT_PROPERTY = 'followingCount';
    var BUTTON_SELECTOR = '[data-button=add]';
    var JUSTCHANGED_CLASSNAME = 'just-changed';
    var ADDED_CLASSNAME = 'added';
    var dataPropertiesForAdd = [
      IS_FOLLOWING_PROPERTY,
      IS_IN_COLLECTION_PROPERTY,
      FOLLOWERSCOUNT_PROPERTY,
      FOLLOWINGCOUNT_PROPERTY
    ];
    var changeHandlers = {};
    var utils = {
      getAddedClass: function (node) {
        var addedClassNode = node.hasAttribute('data-class-added') ? node : node.parent('[data-class-added]');
        return addedClassNode ? addedClassNode.data('class-added') : ADDED_CLASSNAME;
      },
      getURIFromNode: function (node) {
        var stateNode = node.hasAttribute('data-uri') ? node : node.parent('[data-uri]');
        if (!stateNode)
          return null;
        return stateNode.data('uri');
      },
      getPropertyFromURI: function (uri) {
        switch (getAddType(uri)) {
        case 'follow':
          return IS_FOLLOWING_PROPERTY;
        case 'collection':
          return IS_IN_COLLECTION_PROPERTY;
        }
        return null;
      }
    };
    var eventHandlers = {
      click: function (event, node) {
        var stateNode = node.hasAttribute('data-uri') ? node : node.parent('[data-uri]');
        if (!stateNode)
          return;
        var uri = stateNode.data('uri');
        if (!uri)
          return;
        var property = utils.getPropertyFromURI(uri);
        if (property) {
          var data = {};
          var addedClass = utils.getAddedClass(node);
          var shouldBeAdded = !stateNode.hasClass(addedClass);
          data[property] = shouldBeAdded;
          if (shouldBeAdded) {
            node.addClass(JUSTCHANGED_CLASSNAME);
            node.on('mouseout', function mouseoutHandler(event) {
              if (event.target !== node[0])
                return;
              node.off('mouseout', mouseoutHandler);
              node.removeClass(JUSTCHANGED_CLASSNAME);
            });
          }
          live(uri).publish(data);
        }
      },
      changeHandler: function (key, value, uri) {
        if (key === IS_FOLLOWING_PROPERTY || key === IS_IN_COLLECTION_PROPERTY) {
          var numAffectedButtons = actions.setStateForURI(uri, value);
          if (numAffectedButtons === 0) {
            live(uri).off('update', changeHandlers[uri]);
            delete changeHandlers[uri];
          }
        }
        if (dataPropertiesForAdd.indexOf(key) > -1) {
          center.emit('add-data-change', {
            uri: uri,
            model: live(uri),
            key: key,
            value: value
          });
        }
      }
    };
    var actions = {
      setStateForURI: function (uri, isAdded) {
        var numAffectedButtons = 0;
        var nodes = $(document).search(BUTTON_SELECTOR);
        if (!nodes)
          return numAffectedButtons;
        for (var i = 0, l = nodes.length; i < l; i++) {
          var node = $(nodes[i]);
          var buttonURI = utils.getURIFromNode(node);
          if (uri === buttonURI) {
            numAffectedButtons++;
            actions.setStateForButtonNode(node, isAdded);
          }
        }
        return numAffectedButtons;
      },
      setStateForButtonNode: function (node, isAdded) {
        var stateNode = node.hasAttribute('data-uri') ? node : node.parent('[data-uri]');
        if (!stateNode)
          return;
        var addedClass = utils.getAddedClass(node);
        actions.setVisualState(isAdded, stateNode, node, addedClass);
      },
      setVisualState: function (isAdded, node, button, className) {
        if (isAdded) {
          if (!node.hasClass(className))
            node.addClass(className);
          var tooltipRemove = button.data('tooltip-remove');
          if (tooltipRemove) {
            button.setAttribute('data-tooltip', tooltipRemove);
          }
        } else {
          if (node.hasClass(className))
            node.removeClass(className);
          var tooltipAdd = button.data('tooltip-add');
          if (tooltipAdd) {
            button.setAttribute('data-tooltip', tooltipAdd);
          }
        }
      },
      addListenerForNode: function (node) {
        var uri = utils.getURIFromNode(node);
        var addedProperty = utils.getPropertyFromURI(uri);
        if (changeHandlers[uri]) {
          live(uri).get(addedProperty, function (error, isAdded) {
            if (error)
              throw error;
            actions.setStateForButtonNode(node, isAdded);
          });
          return;
        }
        changeHandlers[uri] = function (data) {
          forIn(data, function (value, key) {
            eventHandlers.changeHandler(key, value, uri);
          });
        };
        var model = live(uri);
        model.get(addedProperty, function (error, isAdded) {
          if (error)
            throw error;
          actions.setStateForButtonNode(node, isAdded);
          model.on('update', changeHandlers[uri]);
        });
      }
    };
    var handleScrollShow = function (data) {
      update(data.pageNode, data.nodes);
    };
    exports._classNames = {
      ADDED: ADDED_CLASSNAME,
      JUSTCHANGED: JUSTCHANGED_CLASSNAME
    };
    exports.attach = function attach() {
      $(document).delegate('click', BUTTON_SELECTOR, eventHandlers.click);
      center.on('scroll-show-before', handleScrollShow);
    };
    exports.detach = function detach() {
      $(document).undelegate('click', BUTTON_SELECTOR, eventHandlers.click);
      center.off('scroll-show-before', handleScrollShow);
    };
    var update = exports.update = function update(node, nodes) {
      if (node && $(node).matches(BUTTON_SELECTOR)) {
        actions.addListenerForNode($(node));
      } else {
        var nodes = ($(nodes) || $(node) || $(document)).search(BUTTON_SELECTOR);
        if (!nodes)
          return;
        for (var i = 0, l = nodes.length; i < l; i++) {
          actions.addListenerForNode($(nodes[i]));
        }
      }
    };
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
  'node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/index.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    exports.helpers = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/node_modules/js-common/index.js').helpers;
    exports.message = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/src/message.js');
    exports.request = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/src/request.js');
    exports.response = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/src/response.js');
    exports.playerstate = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/src/player_state.js');
  },
  'node_modules/spotify-cosmos-api/scripts/resolver.js': function (require, module, exports, global, __filename, __dirname) {
    var common = require('node_modules/spotify-cosmos-api/node_modules/cosmos-common-js/index.js');
    var Request = common.request.Request;
    var Action = common.request.Action;
    var Response = common.response.Response;
    function _isSuccessStatus(status) {
      return status >= 200 && status <= 299;
    }
    ;
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
          var error = new Error('Failed to parse response: ' + JSON.stringify(serverResponse));
          return callback(error);
        }
        if (_isSuccessStatus(response.getStatusCode())) {
          return callback(null, response);
        } else {
          var errorMessage = response.getHeader('error') || 'Request failed with status code ' + response.getStatusCode();
          var error = new Error(errorMessage);
          error.response = response;
          return callback(error, response);
        }
      }
      function onError(serverResponse) {
        return callback(serverResponse instanceof Error ? serverResponse : new Error('Request failed: ' + JSON.stringify(serverResponse)));
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
      callback = this._successCallback;
      callback = typeof callback === 'function' ? callback : function () {
      };
      defer(callback.bind(this, data));
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
    exports.Action = common.request.Action;
    exports.Request = common.request.Request;
    exports.Response = common.response.Response;
    exports.resolver = spResolver ? new Resolver(spResolver) : null;
  },
  'node_modules/spotify-live-models/util/cosmos.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var Emitter = require('node_modules/prime/emitter.js');
    var live = require('node_modules/spotify-live/index.js');
    var isNodeJs = process && process.title && process.title.match(/node$/);
    var cosmos = {};
    if (!isNodeJs) {
      cosmos = require('node_modules/spotify-cosmos-api/index.js');
    }
    var ASAP = live.ASAP;
    function DELETE(options, callback) {
      options.method = exports.cosmos.Action.DELETE;
      return request(options, callback);
    }
    function GET(options, callback) {
      options.method = exports.cosmos.Action.GET;
      return request(options, callback);
    }
    function SUB(options, callback) {
      options.method = exports.cosmos.Action.SUB;
      return request(options, callback);
    }
    function POST(options, callback) {
      options.method = exports.cosmos.Action.POST;
      return request(options, callback);
    }
    function PUT(options, callback) {
      options.method = exports.cosmos.Action.PUT;
      return request(options, callback);
    }
    function HEAD(options, callback) {
      options.method = exports.cosmos.Action.HEAD;
      return request(options, callback);
    }
    function request(options, callback) {
      var method = options.method;
      delete options.method;
      var subscription, canceled;
      sanitizeURL(options.url, function (error, url) {
        if (error)
          return callback && callback(error);
        if (canceled)
          return;
        var request = new exports.cosmos.Request(method || exports.cosmos.Action.GET, url, options.headers, options.body);
        subscription = exports.cosmos.resolver.resolve(request, function (error, response) {
          if (!callback)
            return;
          if (error)
            return callback(error);
          try {
            callback(null, {
              body: response.getJSONBody(),
              headers: response.getHeaders(),
              status: response.getStatusCode()
            });
          } catch (parseError) {
            callback(parseError, response);
          }
        });
      });
      return {
        cancel: function () {
          if (subscription && subscription.cancel) {
            subscription.cancel();
            subscription = null;
          } else if (!canceled) {
            canceled = true;
          }
          return null;
        }
      };
    }
    function sanitizeURL(url, callback) {
      if (url.indexOf('@') > -1) {
        live('spotify:client').query('currentUser(username)', function (error, data) {
          if (error)
            return callback(error);
          callback(null, url.replace('@', encodeURIComponent(data.currentUser.username)));
        }, ASAP);
      } else {
        callback(null, url);
      }
    }
    exports.request = request;
    exports.get = GET;
    exports.post = POST;
    exports.subscribe = SUB;
    exports.delete = DELETE;
    exports.put = PUT;
    exports.head = HEAD;
    exports.cosmos = cosmos;
    exports.sanitizeURL = sanitizeURL;
  },
  'node_modules/spotify-live-models/add/collection.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var prime = require('node_modules/prime/index.js');
    var defer = require('node_modules/prime/defer.js');
    var live = require('node_modules/spotify-live/index.js');
    var contains = require('node_modules/mout/array/contains.js');
    var forEach = require('node_modules/mout/array/forEach.js');
    var map = require('node_modules/mout/array/map.js');
    var bind = require('node_modules/mout/function/bind.js');
    var cosmos = require('node_modules/spotify-live-models/util/cosmos.js');
    var Collection = prime({
      constructor: function (endpoints) {
        this.endpoints = endpoints;
        this.onPublish = bind(this.onPublish, this);
        this.waitQueue = [];
        this.onWait = bind(this.onWait, this);
        this.fetch = bind(this.fetch, this);
      },
      onPublish: function (model, data) {
        if ('isInCollection' in data) {
          var endpoints = this.endpoints;
          var uri = model.uri;
          var state = !!data.isInCollection;
          var method = state ? 'post' : 'delete';
          cosmos[method]({
            url: endpoints.updateIsInCollection,
            body: [uri.substr(-22)]
          }, function (error, data) {
            if (error) {
              model.update({ isInCollection: !state });
            } else {
              cosmos.post({
                url: endpoints.broadcast,
                body: {
                  uri: uri,
                  isInCollection: state
                }
              });
              if (data && data.body.items) {
                forEach(data.body.items, function (item) {
                  cosmos.post({
                    url: endpoints.broadcast,
                    body: item
                  });
                });
              }
            }
          });
        }
      },
      onWait: function (model, properties) {
        if (contains(properties, 'isInCollection')) {
          this.fetch(model);
        }
      },
      fetch: function (model) {
        var endpoints = this.endpoints;
        if (!model.id)
          model.id = model.uri.substr(-22);
        var queue = this.waitQueue;
        if (queue.push(model) === 1)
          defer(function () {
            this.waitQueue = [];
            cosmos.post({
              url: endpoints.isInCollection,
              body: map(queue, 'id')
            }, function (error, result) {
              if (error)
                throw error;
              forEach(queue, function (model, i) {
                model.update({ isInCollection: result.body[i] });
              });
            });
          }, this);
      }
    });
    Collection.onBroadcast = function (error, response) {
      if (error)
        throw error;
      live(response.body.uri).update({ isInCollection: response.body.isInCollection });
    };
    module.exports = Collection;
  },
  'node_modules/spotify-live-models/add/track.js': function (require, module, exports, global, __filename, __dirname) {
    'use strict';
    var live = require('node_modules/spotify-live/index.js');
    var forEach = require('node_modules/mout/array/forEach.js');
    var cosmos = require('node_modules/spotify-live-models/util/cosmos.js');
    var Collection = require('node_modules/spotify-live-models/add/collection.js');
    var endpoints = {
      isInCollection: 'hm://collection-web/v1/@/contains/tracks',
      updateIsInCollection: 'hm://collection-web/v1/@/tracks',
      broadcast: 'sp://messages/v1/collectionstate',
      pubsub: 'hm://collection/collection/@/json'
    };
    var trackCollection = new Collection(endpoints);
    var isRegistered = false;
    var broadcastSubscription;
    var collectionSubscription;
    var onCollectionPublish = function (error, response) {
      if (error)
        throw error;
      var items = response.body.items;
      forEach(items, function (item) {
        if (item.type.toUpperCase() === 'TRACK') {
          var uri = 'spotify:track:' + item.identifier;
          live(uri).update({ isInCollection: !item.removed });
        }
      });
    };
    var regExp = exports.matches = /^spotify:track:[^:]+$/;
    exports.register = function () {
      if (isRegistered)
        return;
      live.subscribe(regExp, 'publish', trackCollection.onPublish);
      live.subscribe(regExp, 'wait', trackCollection.onWait);
      broadcastSubscription = cosmos.subscribe({ url: endpoints.broadcast }, Collection.onBroadcast);
      collectionSubscription = cosmos.subscribe({ url: endpoints.pubsub }, onCollectionPublish);
      isRegistered = true;
    };
    exports.unregister = function () {
      if (!isRegistered)
        return;
      live.unsubscribe(regExp, 'publish', trackCollection.onPublish);
      live.unsubscribe(regExp, 'wait', trackCollection.onWait);
      if (broadcastSubscription) {
        broadcastSubscription.cancel();
        broadcastSubscription = null;
      }
      if (collectionSubscription) {
        collectionSubscription.cancel();
        collectionSubscription = null;
      }
      isRegistered = false;
    };
    exports._endpoints = endpoints;
  },
  'scripts/player.js': function (require, module, exports, global, __filename, __dirname) {
    var AudioAd = require('node_modules/revgen-shared/scripts/audioad.js').AudioAd;
    var AdBreak = require('node_modules/revgen-shared/scripts/ad_break.js');
    var addEvents = require('node_modules/spotify-events/add.js');
    var live = require('node_modules/spotify-live/index.js');
    live.register(require('node_modules/spotify-live-models/add/track.js'));
    live.register(require('node_modules/spotify-live-models/client.js'));
    (function (models, events, suggest, Image, pu, widgets, ShuffleButton, RepeatButton, PlayPauseButton, nextBackButtons, VolumeControl, ProgressBar, tracking, previewPlayer, ContextApp, Logger, localeStrings) {
      var playerUtils = pu.playerUtils;
      var trackHistory = pu.trackHistory;
      var konco = pu.kc;
      var _ = localeStrings.get.bind(localeStrings);
      var logger = Logger.forTag('PlayerApp');
      var adBreak = new AdBreak();
      var currentBodyWidth = document.body.offsetWidth;
      var player = models.player;
      var track = models.Track;
      var id = playerUtils.getId;
      var playerUID = -1;
      var trackName = id('track-name');
      var addCollectionButton = document.getElementById('track-add');
      var queueButton = document.getElementById('queue');
      var widgetMore = document.getElementById('widget-more');
      var trackNameMarquee = new pu.Marquee(trackName, currentBodyWidth - 40);
      var eventManager = new events.EventManager();
      var artistWidget = new widgets.ArtistWidget(id('track-artist'), currentBodyWidth - 40, eventManager, logger);
      var playBtn = new PlayPauseButton('play-pause', logger, adBreak);
      var nextBtn = new nextBackButtons.NextButton('next', eventManager, logger, adBreak);
      var backBtn = new nextBackButtons.BackButton('previous', eventManager, logger, adBreak);
      var shuffleBtn = new ShuffleButton('shuffle', logger, adBreak);
      var repeatBtn = new RepeatButton('repeat', logger, adBreak);
      var progressBar = new ProgressBar('progress', eventManager, logger, adBreak);
      var imageWrapper = id('cover-art');
      var coverImage = null;
      var volumeControl = new VolumeControl('volume', logger);
      var currentTrack = null;
      var history = new trackHistory(3);
      var suggestionArea = id('suggestions');
      var suggestList = suggestionArea.querySelector('ul');
      var tracker = new tracking.Tracker();
      var volumeBarWrapper = document.getElementById('volume');
      var volumeShowTrigger = document.getElementById('volume-show');
      var volumeCloseTimer = null;
      var miniPlayer = null;
      var appLinkBlacklist = [
        'now-playing-recs',
        'discover',
        'spotify-web-player',
        'context-actions',
        'suggest'
      ];
      models.Loadable.define(models.Player, [
        '__length',
        '__rules',
        '__index',
        '__owner',
        '__uid'
      ], '_playapp');
      var getPlayerLink = function () {
        var ownerUri = player.__owner && player.__owner.toSpotifyURI() || '';
        var ownerApp = playerUtils.appNameFromUri(ownerUri);
        if (appLinkBlacklist.indexOf(ownerApp) > -1) {
          ownerUri = player.track.album && player.track.album.uri || '';
        }
        if (player.track && player.track.advertisement) {
          ownerUri = player.track.artists[0].uri || ownerUri;
        }
        if (adBreak.inProgress() && adBreak.getDetails() && adBreak.getDetails().clickUrl) {
          ownerUri = adBreak.getDetails().clickUrl;
        }
        return ownerUri;
      };
      var updateArtwork = function () {
        var adBreakImage = adBreak.inProgress() && adBreak.getDetails() ? adBreak.getDetails().imageUrl : null;
        if (coverImage) {
          coverImage.setImage(adBreakImage || player.track);
          coverImage.setLink(getPlayerLink());
        } else {
          var createImage = adBreakImage ? Image.fromSource : player.track ? Image.forTrack : Image.forAlbum;
          coverImage = createImage(adBreakImage || player.track || currentTrack.album, {
            animate: true,
            height: 210,
            width: 210,
            style: 'plain',
            quickActionMenu: false,
            link: getPlayerLink()
          });
          imageWrapper.appendChild(coverImage.node);
        }
      };
      var handleAdClick = function () {
        if (adBreak.inProgress()) {
          var adURI = currentTrack.advertisement ? currentTrack.artists[0].uri : adBreak.getDetails() ? adBreak.getDetails().clickUrl : null;
          if (currentTrack.advertisement && currentTrack.ad_metadata) {
            AudioAd.handleAdClick(currentTrack.ad_metadata, currentTrack.advertisement);
          } else {
            AudioAd.handleAdClick(adURI, currentTrack.advertisement);
          }
          return false;
        }
        return true;
      };
      var contextEndSuggestions = function (suggestion) {
        suggestList.innerHTML = '';
        var newSuggestions = document.createDocumentFragment();
        if (history.size() === 0) {
          return false;
        }
        suggest.getTrackSuggestions(history.show('uri'), 3, function (result) {
          var trackIDs = result[0].gids;
          for (var i = 0; i < 3; i++) {
            track.fromURI('spotify:track:' + trackIDs[i]).load('name', 'image').done(function (track) {
              buildSuggestion(track);
            });
          }
        }, function () {
          if (history.size() < 3) {
            history.get(0).album.load([
              'name',
              'uri',
              'image'
            ]).done(function (album) {
              buildSuggestion(album);
            });
          }
          history.forEach(buildSuggestion);
        });
        var buildSuggestion = function (suggestion) {
          var item = document.createElement('li');
          var isTrack = suggestion instanceof models.Track;
          var isAlbum = suggestion instanceof models.Album;
          var createImage = isTrack ? Image.forTrack : isAlbum ? Image.forAlbum : false;
          if (!createImage)
            return;
          var image = createImage(suggestion, {
            animate: true,
            height: 50,
            width: 50,
            quickActionMenu: false,
            style: 'plain'
          });
          item.appendChild(image.node);
          var itemText = document.createElement('p');
          var artistText = document.createElement('span');
          itemText.innerHTML = suggestion.name;
          suggestion.artists[0].load('name').done(function (artist) {
            artistText.innerHTML += artist.name.decodeForHtml();
            item.appendChild(itemText);
            item.appendChild(artistText);
            item.setAttribute('data-uri', suggestion.uri);
            playerUtils.addEventSimple(item, 'click', function (e) {
              e.preventDefault();
              models.application.openURI(this.getAttribute('data-uri').replace('spotify:', 'spotify:radio:'));
            });
            suggestList.appendChild(item);
          });
        };
        suggestionArea.appendChild(suggestList);
        logger.userImpression('context_end_suggestions');
        playerUtils.addClass(suggestionArea, 'active');
        window.setTimeout(function () {
          playerUtils.addClass(suggestList, 'active');
        }, 300);
      };
      var resetPlayer = function () {
        if (currentTrack === null) {
          return;
        }
        contextEndSuggestions();
        imageWrapper.innerHTML = '';
        coverImage = null;
        artistWidget.clear();
        trackName.innerHTML = '&nbsp;';
        currentTrack = null;
        progressBar.setPageTitle();
        playerUtils.addClass(document.body, 'noplayback');
        nextBtn.disableButton();
        backBtn.disableButton();
        playBtn.disableButton();
      };
      var handleAdBreakStartEnd = function () {
        nextBtn.update();
        backBtn.update();
        playBtn.updateStatus();
        if (adBreak.inProgress()) {
          progressBar.disable();
          shuffleBtn.disableButton();
          repeatBtn.disableButton();
          playerUtils.addClass(widgetMore, 'disabled');
          playerUtils.addClass(document.body, 'isannons');
        } else {
          handleTrackChange();
          updateArtwork();
        }
      };
      var handleAdBreakDetails = function () {
        updateArtwork();
        var d = adBreak.getDetails() || {};
        if (d.title) {
          id('track-name').innerHTML = '<a href="' + d.clickUrl + '" target="_blank">' + d.title + '</a>';
          trackNameMarquee.refresh();
        }
        if (d.description) {
          id('track-artist').innerHTML = '<a href="' + d.clickUrl + '" target="_blank">' + d.description + '</a>';
          artistWidget.marquee.refresh();
        }
      };
      var handleTrackChange = function (e) {
        if (!player.track || e && !e.target.track) {
          return false;
        }
        playerUtils.removeClass(document.body, 'noplayback');
        playerUtils.removeClass(suggestionArea, 'active');
        playerUtils.removeClass(suggestList, 'active');
        track.fromURI(player.track.uri).load([
          'name',
          'uri',
          'image',
          'duration',
          'artists',
          'starred',
          'album'
        ]).done(function (track) {
          if (!(adBreak.inProgress() && adBreak.getDetails())) {
            var trackNameLink = document.createElement('a');
            trackName.innerHTML = '';
            trackNameLink.href = track.uri.toSpotifyURL();
            trackNameLink.innerHTML = track.name.decodeForHtml();
            trackName.appendChild(trackNameLink);
            trackNameMarquee.refresh();
          }
          addCollectionButton.setAttribute('data-uri', track.uri);
          addEvents.update();
          if (!adBreak.inProgress()) {
            history.add(track);
            progressBar.enable();
            playerUtils.removeClass(document.body, 'isannons');
            playerUtils.removeClass(widgetMore, 'disabled');
          } else {
            progressBar.disable();
            playerUtils.addClass(widgetMore, 'disabled');
            playerUtils.addClass(document.body, 'isannons');
          }
          if (!currentTrack || currentTrack.image !== track.image) {
            updateArtwork();
          }
          currentTrack = track;
          if (adBreak.inProgress()) {
            updateArtwork();
          }
          if (coverImage) {
            coverImage.node.setAttribute('data-itemuri', currentTrack.uri);
          }
          eventManager.trigger(eventManager.Events.TRACK_CHANGED, track);
        });
      };
      var updatePlayer = function (e) {
        var nowPlayingTrack = player.track;
        if (playerUID !== player.__uid) {
          playerUID = player.__uid;
          handleTrackChange();
        }
        volumeCheck();
        if (nowPlayingTrack === null) {
          resetPlayer();
          return false;
        }
        if (miniPlayer) {
          postMiniPlayerState();
        }
      };
      var volumeCheck = function () {
        var nowPlayingTrack = player.track;
        if (nowPlayingTrack && (nowPlayingTrack.advertisement || nowPlayingTrack.uri.indexOf('spotify:ad') !== -1)) {
          if (player.volume == 0) {
            player.pause();
          } else {
            if (player.paused) {
              player.play();
            }
          }
        }
      };
      var starUnstar = function () {
        if (!currentTrack.starred) {
          currentTrack.star().done(function (track) {
            postMiniPlayerState();
          }).fail(function () {
          });
        } else {
          currentTrack.unstar().done(function () {
            postMiniPlayerState();
          });
        }
      };
      var handleWindowResize = function () {
        volumeControl.reload();
        progressBar.reload();
        trackNameMarquee.widthAdjust(currentBodyWidth - 40);
        artistWidget.resize(currentBodyWidth - 40);
      };
      var postMiniPlayerState = function () {
        messageMiniPlayer(player);
      };
      var messageMiniPlayer = function (obj) {
        if (miniPlayer) {
          miniPlayer.postMessage(JSON.stringify(obj), '*');
        }
      };
      var handleMiniPlayerMessage = function (msg) {
        switch (msg.miniplayer) {
        case 'staterequest':
          postMiniPlayerState();
          break;
        case 'playpause':
          playBtn.toggle();
          break;
        case 'next':
          nextBtn.playerNext();
          break;
        case 'back':
          backBtn.playerBack();
          break;
        case 'shuffle':
          shuffleBtn.toggle();
          break;
        case 'repeat':
          repeatBtn.toggle();
          break;
        case 'star':
          starUnstar();
          break;
        case 'seek':
          player.seek(msg.target);
          break;
        case 'volume':
          player.setVolume(msg.target);
          break;
        case 'openuri':
          models.application.openURI(msg.target);
          break;
        default:
          break;
        }
      };
      var setupVolumeShowHide = function () {
        volumeShowTrigger.addEventListener('mouseout', function (e) {
          e.stopPropagation();
          playerUtils.addClass(volumeBarWrapper, 'show');
          if (volumeCloseTimer !== null) {
            clearTimeout(volumeCloseTimer);
          }
          volumeCloseTimer = setTimeout(function () {
            playerUtils.removeClass(volumeBarWrapper, 'show');
          }, 1000);
        }, false);
        window.addEventListener('mouseout', function (e) {
          if (!e.toElement) {
            playerUtils.removeClass(volumeBarWrapper, 'show');
          }
        }, false);
      };
      var setupLangStrings = function () {
        document.querySelector('#suggestions p').textContent = _('start-radio-suggestion');
      };
      var init = function () {
        setupLangStrings();
        logger.userImpression('player_loaded');
        addEvents.attach();
        adBreak.addEventListener('startBreak', handleAdBreakStartEnd);
        adBreak.addEventListener('endBreak', handleAdBreakStartEnd);
        adBreak.addEventListener('receiveDetails', handleAdBreakDetails);
        adBreak.init(player);
        queueButton.addEventListener('click', function (e) {
          e.preventDefault();
          models.application.openURI('spotify:app:queue');
        }, false);
        player.load([
          'track',
          '__uid',
          '__owner',
          '__rules',
          'position',
          'playing'
        ]).done(function () {
          playerUtils.addEventSimple(trackName, 'click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            logger.userHit('track_link', { track_id: currentTrack.uri });
            if (e.target.href) {
              if (adBreak.inProgress()) {
                handleAdClick();
                return false;
              }
              models.application.openURI(getPlayerLink());
            }
          });
          playerUtils.addEventSimple(imageWrapper, 'click', function (e) {
            e.preventDefault();
            logger.userHit('album_link', { track_id: currentTrack.uri });
            handleAdClick();
          });
          playerUtils.addEventSimple(imageWrapper, 'contextmenu', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var openWith = models.fromURI(currentTrack.uri);
            models.client.showContextUI([openWith], {
              x: e.clientX,
              y: e.clientY
            });
          });
          updatePlayer();
          player.addEventListener('change', updatePlayer);
          player.addEventListener('change:volume', volumeCheck);
          artistWidget.init();
          trackNameMarquee.init();
          window.addEventListener('resize', function () {
            currentBodyWidth = document.body.offsetWidth;
            handleWindowResize();
          }, false);
          window.addEventListener('message', function (e) {
            if (e.source === miniPlayer) {
              handleMiniPlayerMessage(JSON.parse(e.data));
            }
          }, false);
          eventManager.subscribe(eventManager.Events.AD_CLICKED, handleAdClick);
          widgetMore.addEventListener('click', function (e) {
            e.preventDefault();
            if (!currentTrack || playerUtils.hasClass(this, 'disabled')) {
              return;
            }
            logger.userHit('context_menu_button', { track_id: currentTrack.uri });
            ContextApp.show('context-actions', [currentTrack.uri], e.target, 'spotify:temp-playlist:hellothere');
          }, false);
          setupVolumeShowHide();
          models.application.hideLoadingScreen();
          var windowFeatures = 'menubar=no,location=no,resizable=no,scrollbars=no,status=no,width=420,height=150';
          var weeegg = new konco();
          weeegg.onSuccess = function () {
            miniPlayer = window.open('vendor/mini/mini.html', 'Spotify', windowFeatures);
          };
          weeegg.init();
        });
        previewPlayer.init();
      };
      exports.init = init;
    }(require('node_modules/api/scripts/models.js'), require('scripts/player.events.js'), require('scripts/player.suggestions.js'), require('node_modules/views/scripts/image.js').Image, require('scripts/player-utils.js'), require('scripts/player.widgets.js'), require('scripts/player.shufflebutton.js').ShuffleButton, require('scripts/player.repeatbutton.js').RepeatButton, require('scripts/player.playpausebutton.js').PlayPauseButton, require('scripts/player.nextbackbuttons.js'), require('scripts/player.volumecontrol.js').VolumeControl, require('scripts/player.progressbar.js').ProgressBar, require('scripts/player.tracking.js'), require('scripts/preview.player.js'), require('node_modules/views/scripts/contextapp.js').ContextApp, require('node_modules/logging-utils/scripts/logger.js').Logger, require('@loc.loc/strings/main.lang')));
  },
  'scripts/main.js': function (require, module, exports, global, __filename, __dirname) {
    (function (player) {
      player.init();
    }(require('scripts/player.js')));
  }
}));  // QuickStart 0.9.1
