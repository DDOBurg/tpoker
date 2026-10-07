// TPoker T6 full question-bank walkthrough (Windows Script Host fallback, no Node required)
// Usage (from project root):  cscript //Nologo tests\t6-walkthrough.js
// Walks every question in data/, grading with the REAL js/logic.js grade():
//   1) the standard answer must grade CORRECT
//   2) single: every other option must grade WRONG
//   3) multi: every nonempty proper subset, the empty set, and every superset must grade WRONG
// Exit 0 only if all questions pass.
(function () {
  // ---- JSON.parse shim for the ES3 engine (dev harness only) ----
  if (typeof JSON === 'undefined') {
    JSON = {
      parse: function (text) {
        var ok = /^[\],:{}\s]*$/.test(text
          .replace(/\\["\\\/bfnrtu]/g, '@')
          .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, ']')
          .replace(/(?:^|:|,)(?:\s*\[)+/g, ''));
        if (!ok) { throw new Error('Invalid JSON'); }
        return eval('(' + text + ')');
      }
    };
  }

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
  function loadGlobal(rel) {
    var code = readAllUtf8(fso.BuildPath(root, rel.split('/').join('\\')));
    var fn = new Function(code);
    fn();
  }
  function loadJson(rel) {
    return JSON.parse(readAllUtf8(fso.BuildPath(root, rel.split('/').join('\\'))));
  }

  loadGlobal('js/logic.js');
  var L = (typeof TPLogic !== 'undefined') ? TPLogic : this.TPLogic;

  var index = loadJson('data/units_index.json');

  var total = 0, passed = 0;
  var failures = [];
  var lines = [];

  function sameSet(a, b) {
    if (a.length !== b.length) { return false; }
    var x = a.slice().sort(), y = b.slice().sort();
    for (var i = 0; i < x.length; i++) { if (x[i] !== y[i]) { return false; } }
    return true;
  }
  function contains(arr, v) {
    for (var i = 0; i < arr.length; i++) { if (arr[i] === v) { return true; } }
    return false;
  }

  for (var u = 0; u < index.length; u++) {
    var entry = index[u];
    var unit = loadJson('data/' + entry.file);
    var questions = unit.questions;
    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      total++;
      var problems = [];

      var stdOk = L.grade(q, q.answer);
      if (!stdOk) {
        problems.push('standard answer graded WRONG');
      }

      if (q.type === 'single') {
        for (var k = 0; k < q.options.length; k++) {
          if (k !== q.answer && L.grade(q, k)) {
            problems.push('option ' + k + ' (' + q.options[k] + ') graded correct but is not the answer');
          }
        }
      } else if (q.type === 'multi') {
        var ans = q.answer;
        var subsetCount = 0;
        (function enumerate(start, chosen) {
          if (chosen.length > 0 && chosen.length < ans.length) {
            if (!sameSet(chosen, ans)) {
              subsetCount++;
              if (L.grade(q, chosen)) {
                problems.push('subset [' + chosen.join(',') + '] graded correct');
              }
            }
          }
          if (chosen.length >= ans.length - 1) { return; }
          for (var m = start; m < ans.length; m++) {
            enumerate(m + 1, chosen.concat([ans[m]]));
          }
        })(0, []);
        if (L.grade(q, [])) { problems.push('empty selection graded correct'); }
        for (var e = 0; e < q.options.length; e++) {
          if (!contains(ans, e)) {
            if (L.grade(q, ans.concat([e]))) {
              problems.push('superset +' + e + ' graded correct');
            }
          }
        }
        if (subsetCount === 0) { problems.push('no proper subsets were tested'); }
      } else if (q.type === 'range') {
        var spec = null;
        var ranges = unit.ranges || [];
        for (var g = 0; g < ranges.length; g++) {
          if (ranges[g].id === q.spot) { spec = ranges[g]; break; }
        }
        if (!spec) {
          problems.push('range question references missing spec ' + q.spot);
        } else {
          var expect = null;
          var listed = false;
          for (var hi = 0; hi < spec.actions.length; hi++) {
            var hands = spec.actions[hi].hands || [];
            for (var hj = 0; hj < hands.length; hj++) {
              if (String(hands[hj]).toUpperCase() === String(q.hand).toUpperCase()) {
                listed = true;
                expect = spec.actions[hi].key;
              }
            }
          }
          if (listed) {
            if (expect !== q.answer) {
              problems.push('hand ' + q.hand + ' listed under ' + expect + ' but answer is ' + q.answer);
            }
          } else {
            var defKey = null;
            for (var hd = 0; hd < spec.actions.length; hd++) {
              if (spec.actions[hd]['default']) { defKey = spec.actions[hd].key; }
            }
            if (defKey !== q.answer) {
              problems.push('hand ' + q.hand + ' maps to default ' + defKey + ' but answer is ' + q.answer);
            }
          }
          for (var ak = 0; ak < spec.actions.length; ak++) {
            var key = spec.actions[ak].key;
            if (key !== q.answer && L.grade(q, key)) {
              problems.push('action ' + key + ' graded correct but answer is ' + q.answer);
            }
          }
        }
      } else {
        problems.push('unknown type ' + q.type);
      }

      if (problems.length === 0) {
        passed++;
        lines.push('PASS  ' + unit.id + ' ' + q.id + '  [' + q.type + ']');
      } else {
        for (var p = 0; p < problems.length; p++) {
          failures.push(unit.id + ' ' + q.id + ': ' + problems[p]);
        }
        lines.push('FAIL  ' + unit.id + ' ' + q.id + '  [' + q.type + ']  ' + problems.join(' | '));
      }
    }
  }

  var reportPath = fso.BuildPath(scriptDir, 't6-report.txt');
  var out = fso.OpenTextFile(reportPath, 2, true, -1);
  for (var r = 0; r < lines.length; r++) { out.WriteLine(lines[r]); }
  out.WriteLine('');
  out.WriteLine('T6 result: ' + passed + '/' + total + ' questions passed, ' + failures.length + ' problems');
  out.Close();

  WScript.Echo('T6: ' + passed + '/' + total + ' questions passed, ' + failures.length + ' problems. Full report: tests\\t6-report.txt');
  WScript.Quit(failures.length === 0 ? 0 : 1);
})();
