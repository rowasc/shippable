// Receives a payload of code from the parent over postMessage, runs it, and
// posts the result back. Loaded by an iframe with sandbox="allow-scripts" (no
// allow-same-origin), so this script runs at a null origin with no DOM access
// to the host page.
(function () {
  function origin(v) {
    try {
      if (v === undefined) return "undefined";
      if (typeof v === "string") return v;
      if (typeof v === "function") return "[Function " + (v.name || "") + "]";
      return JSON.stringify(v);
    } catch (_e) {
      return String(v);
    }
  }
  var logs = [];
  function pushLog(kind) {
    return function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) parts.push(origin(arguments[i]));
      logs.push(kind + " " + parts.join(" "));
    };
  }
  console.log = pushLog("log");
  console.info = pushLog("log");
  console.warn = pushLog("warn");
  console.error = pushLog("err");

  window.addEventListener("message", function (ev) {
    var data = ev.data || {};
    if (!data.__runner) return;
    var token = data.__runner;
    var code = data.code;
    logs = [];
    (async function () {
      try {
        var fn = new Function("return (async () => { " + code + "\nreturn typeof __result !== 'undefined' ? __result : undefined; })();");
        var out = await fn();
        parent.postMessage(
          {
            __runner: token,
            ok: true,
            logs: logs,
            result: out === undefined ? undefined : origin(out),
          },
          "*",
        );
      } catch (e) {
        parent.postMessage(
          {
            __runner: token,
            ok: false,
            logs: logs,
            error: e && e.stack ? e.stack : String(e),
          },
          "*",
        );
      }
    })();
  });

  parent.postMessage({ __runner: "ready" }, "*");
})();
