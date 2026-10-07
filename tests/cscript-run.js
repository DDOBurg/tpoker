// TPoker T2 logic unit tests - Windows Script Host runner (fallback when Node is unavailable)
// Usage (from project root):  cscript //Nologo tests\cscript-run.js
// cscript is an ES3 engine; this runner shims Array.isArray / Object.keys / JSON,
// then loads logic.js / store.js / tests.js (read as UTF-8 via ADODB.Stream) and
// runs the very same assertion set used by run-tests.js (Node) and test.html (browser).
(function () {
  // ---- ES5 shims (dev-machine testing only, not part of the app runtime) ----
  if (!Array.isArray) {
    Array.isArray = function (x) { return Object.prototype.toString.call(x) === '[object Array]'; };
  }
  if (!Object.keys) {
    Object.keys = function (o) {
      var r = [];
      for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) { r.push(k); } }
      return r;
    };
  }
  if (typeof JSON === 'undefined') {
    var escMap = { '\\': '\\\\', '"': '\\"', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
    JSON = {
      parse: function (text) {
        var ok = /^[\],:{}\s]*$/.test(text
          .replace(/\\["\\\/bfnrtu]/g, '@')
          .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, ']')
          .replace(/(?:^|:|,)(?:\s*\[)+/g, ''));
        if (!ok) { throw new Error('Invalid JSON'); }
        return eval('(' + text + ')');
      },
      stringify: function (v) {
        if (v === null) { return 'null'; }
        var t = typeof v;
        if (t === 'number') { return isFinite(v) ? String(v) : 'null'; }
        if (t === 'boolean') { return String(v); }
        if (t === 'string') {
          return '"' + v.replace(/[\\"\x00-\x1f]/g, function (c) {
            var m = escMap[c];
            return m ? m : '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4);
          }) + '"';
        }
        if (Object.prototype.toString.call(v) === '[object Array]') {
          var items = [];
          for (var i = 0; i < v.length; i++) { items.push(JSON.stringify(v[i])); }
          return '[' + items.join(',') + ']';
        }
        var parts = [];
        for (var k in v) {
          if (Object.prototype.hasOwnProperty.call(v, k)) { parts.push(JSON.stringify(k) + ':' + JSON.stringify(v[k])); }
        }
        return '{' + parts.join(',') + '}';
      }
    };
  }

  // ---- load project scripts (UTF-8) relative to this file ----
  var fso = new ActiveXObject('Scripting.FileSystemObject');
  var scriptDir = fso.GetParentFolderName(WScript.ScriptFullName);
  var root = fso.GetParentFolderName(scriptDir);

  function readAllUtf8(p) {
    var st = new ActiveXObject('ADODB.Stream');
    st.Type = 2;
    st.Charset = 'utf-8';
    st.Open();
    st.LoadFromFile(p);
    var text = st.ReadText(-1);
    st.Close();
    return text;
  }
  function load(rel) {
    var p = fso.BuildPath(root, rel.split('/').join('\\'));
    var code = readAllUtf8(p);
    var fn = new Function(code);
    fn();
  }

  load('js/logic.js');
  load('js/store.js');
  load('js/ranges.js');
  load('tests/tests.js');

  // ---- run ----
  var L = (typeof TPLogic !== 'undefined') ? TPLogic : this.TPLogic;
  var S = (typeof TPStore !== 'undefined') ? TPStore : this.TPStore;
  var R = (typeof TPRanges !== 'undefined') ? TPRanges : this.TPRanges;
  var T = (typeof TPTests !== 'undefined') ? TPTests : this.TPTests;
  var result = T.run(L, S, R);

  // ---- report: full details to tests/t2-report.txt (unicode), English summary on console ----
  var reportPath = fso.BuildPath(scriptDir, 't2-report.txt');
  var out = fso.OpenTextFile(reportPath, 2, true, -1);
  for (var i = 0; i < result.lines.length; i++) { out.WriteLine(result.lines[i]); }
  out.WriteLine('');
  out.WriteLine('T2 result: ' + result.passed + '/' + result.total + ' passed, ' + result.failed + ' failed');
  out.Close();

  WScript.Echo('T2: ' + result.passed + '/' + result.total + ' passed, ' + result.failed + ' failed. Full report: tests\\t2-report.txt');
  WScript.Quit(result.failed === 0 ? 0 : 1);
})();
