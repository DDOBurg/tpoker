/* TPoker 持久化层：localStorage 存取 + JSON 导出/导入（exportVersion: 1）。
 * createStore(storage) 可注入任意 Storage 兼容对象（测试用内存版）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.TPStore = factory(); }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  var DEFAULT_KEY = 'tpoker.v1';
  var EXPORT_VERSION = 1;

  function createMemoryStorage() {
    var map = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
      setItem: function (k, v) { map[k] = String(v); },
      removeItem: function (k) { delete map[k]; },
      clear: function () { map = {}; }
    };
  }

  function defaultState() {
    return {
      exportVersion: EXPORT_VERSION,
      savedAt: null,
      units: {},   // unitId -> {status, passedAt, masteredAt, revisitDue, revisitDone}
      queue: [],   // [{qid, unit, stage(1|2|3), due:'YYYY-MM-DD'}]
      stats: { perUnit: {}, perKp: {}, perQuestion: {} },  // 每项 {a:答题数, c:答对数}
      attempts: [] // [{date, unit, kind, correct, total}]
    };
  }

  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

  function validateState(s) {
    if (!isObj(s)) { return false; }
    if (s.exportVersion !== EXPORT_VERSION) { return false; }
    if (!isObj(s.units)) { return false; }
    if (!Array.isArray(s.queue)) { return false; }
    if (!isObj(s.stats)) { return false; }
    if (!isObj(s.stats.perUnit) || !isObj(s.stats.perKp) || !isObj(s.stats.perQuestion)) { return false; }
    if (!Array.isArray(s.attempts)) { return false; }
    return true;
  }

  function createStore(storage, key) {
    storage = storage || createMemoryStorage();
    key = key || DEFAULT_KEY;
    var state = load();

    function load() {
      var raw = null;
      try { raw = storage.getItem(key); } catch (e) { raw = null; }
      if (!raw) { return defaultState(); }
      var parsed = null;
      try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
      if (!validateState(parsed)) { return defaultState(); }  // ER-4：损坏视为全新安装
      return parsed;
    }

    function save() {
      var d = new Date();
      function p(n) { return n < 10 ? '0' + n : '' + n; }
      state.savedAt = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
        + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
      storage.setItem(key, JSON.stringify(state));
    }

    function getState() {
      return JSON.parse(JSON.stringify(state));
    }

    /* 所有修改统一入口：fn 收到内部 state 引用，返回后落盘 */
    function mutate(fn) {
      fn(state);
      save();
    }

    function exportJSON() {
      return JSON.stringify(getState(), null, 2);
    }

    /* 导入：非法文件（损坏 JSON / 版本不符 / 缺字段）抛错且不污染现有数据（ER-5） */
    function importJSON(text) {
      var parsed;
      try { parsed = JSON.parse(text); }
      catch (e) { throw new Error('导入失败：不是合法的 JSON 文件'); }
      if (!validateState(parsed)) {
        throw new Error('导入失败：文件格式不符（需要 exportVersion: 1 的 TPoker 备份）');
      }
      state = parsed;
      save();
    }

    function reset() {
      state = defaultState();
      save();
    }

    return {
      getState: getState,
      mutate: mutate,
      save: save,
      exportJSON: exportJSON,
      importJSON: importJSON,
      reset: reset,
      EXPORT_VERSION: EXPORT_VERSION
    };
  }

  return { createStore: createStore, createMemoryStorage: createMemoryStorage, DEFAULT_KEY: DEFAULT_KEY, EXPORT_VERSION: EXPORT_VERSION };
});
