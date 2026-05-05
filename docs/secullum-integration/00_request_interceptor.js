// ============================================================================
// SECULLUM REQUEST INTERCEPTOR
// Inject into the browser console (or via mcp__Claude_in_Chrome__javascript_tool)
// after logging in, then navigate Secullum pages. Captured requests are stored
// at window.__SECULLUM_CAPTURE__ and console.log'd as compact JSON.
// ============================================================================

(function () {
  if (window.__SECULLUM_CAPTURE_INSTALLED__) {
    console.log('[secullum-cap] already installed');
    return 'already-installed';
  }
  window.__SECULLUM_CAPTURE_INSTALLED__ = true;
  window.__SECULLUM_CAPTURE__ = [];

  const _fetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url =
      typeof input === 'string' ? input : (input && input.url) || String(input);
    const method = (init && init.method) || (input && input.method) || 'GET';
    const reqBody = (init && init.body) || null;
    const reqHeaders =
      (init && init.headers) || (input && input.headers) || null;

    const t0 = performance.now();
    let resp,
      err = null,
      respText = null,
      respHeaders = null,
      status = null;
    try {
      resp = await _fetch(input, init);
      status = resp.status;
      respHeaders = {};
      try {
        resp.headers.forEach((v, k) => (respHeaders[k] = v));
      } catch (_) {}
      try {
        respText = await resp.clone().text();
      } catch (_) {}
    } catch (e) {
      err = String(e);
    }
    const entry = {
      ts: new Date().toISOString(),
      ms: Math.round(performance.now() - t0),
      type: 'fetch',
      method,
      url: String(url),
      reqHeaders,
      reqBody:
        typeof reqBody === 'string' ? reqBody.slice(0, 8000) : String(reqBody),
      status,
      respHeaders,
      respBody: respText ? respText.slice(0, 16000) : null,
      err,
    };
    window.__SECULLUM_CAPTURE__.push(entry);
    return resp;
  };

  const OXHR = window.XMLHttpRequest;
  function PXHR() {
    const x = new OXHR();
    let _m = 'GET',
      _u = '',
      _h = {},
      _b = null,
      _t0 = 0;
    const _open = x.open;
    x.open = function (m, u) {
      _m = m;
      _u = u;
      return _open.apply(x, arguments);
    };
    const _setReq = x.setRequestHeader;
    x.setRequestHeader = function (k, v) {
      _h[k] = v;
      return _setReq.apply(x, arguments);
    };
    const _send = x.send;
    x.send = function (b) {
      _b = b;
      _t0 = performance.now();
      x.addEventListener('loadend', function () {
        let respHeaders = {};
        try {
          (x.getAllResponseHeaders() || '')
            .split('\r\n')
            .filter(Boolean)
            .forEach((line) => {
              const i = line.indexOf(':');
              if (i > 0)
                respHeaders[line.slice(0, i).trim().toLowerCase()] = line
                  .slice(i + 1)
                  .trim();
            });
        } catch (_) {}
        const entry = {
          ts: new Date().toISOString(),
          ms: Math.round(performance.now() - _t0),
          type: 'xhr',
          method: _m,
          url: _u,
          reqHeaders: _h,
          reqBody:
            typeof _b === 'string' ? _b.slice(0, 8000) : _b ? String(_b) : null,
          status: x.status,
          respHeaders,
          respBody: (x.responseText || '').slice(0, 16000),
        };
        window.__SECULLUM_CAPTURE__.push(entry);
      });
      return _send.apply(x, arguments);
    };
    return x;
  }
  PXHR.prototype = OXHR.prototype;
  window.XMLHttpRequest = PXHR;

  console.log('[secullum-cap] installed; patched fetch + XHR');
  return 'installed';
})();
