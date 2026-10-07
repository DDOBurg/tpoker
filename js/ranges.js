/* TPoker 范围表组件：169 类起手牌矩阵数学 + RangeSpec 渲染（矩阵 / 数值表）。
 * 纯 DOM 渲染，无外部依赖；矩阵数学挂在 TPRanges.math 下供 Node/cscript 单测。
 * 代码保持 ES3 兼容（for 循环、无保留字点号访问），与 cscript 测试运行器一致。
 * RangeSpec:
 *   { id, title, spot, note, source,
 *     type: 省略或 "matrix"（默认）| "table",
 *     actions: [{ key, label, color?, hands?: ["AA","AKs","AKo",...], "default"?: true }] }
 *   table 型用 columns: [...], rows: [[...], ...] 代替 actions。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.TPRanges = factory(); }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  var RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
  var N_CELLS = 13;
  var TOTAL_COMBOS = 1326;

  /* 默认配色（行动未指定 color 时使用；色盲友好 + 深色主题） */
  var ACTION_COLORS = {
    'raise': '#2f9e6e',
    'open': '#2f9e6e',
    'bet': '#2f9e6e',
    '3bet': '#c9802f',
    '4bet': '#c0492f',
    'allin': '#c0492f',
    'call': '#3a86c8',
    'limp': '#4aa3a3',
    'fold': '#39424a'
  };

  /* ---------- 矩阵数学 ---------- */

  /* 行列 → 牌型类：对角线对子，上三角同花，下三角非同花 */
  function handAt(row, col) {
    var r = RANKS[row], c = RANKS[col];
    if (row === col) { return r + c; }
    return row < col ? r + c + 's' : c + r + 'o';
  }

  var RANK_INDEX = {};
  (function () { for (var i = 0; i < RANKS.length; i++) { RANK_INDEX[RANKS[i]] = i; } })();

  /* 解析牌型类记号（AA / AKs / AKo / T9s），返回规范形；非法返回 null */
  function parseHand(token) {
    if (typeof token !== 'string') { return null; }
    var t = token.replace(/\s+/g, '').toUpperCase();
    var i, r1, r2, hi, lo;
    if (t.length === 2) {
      if (RANK_INDEX[t.charAt(0)] === undefined || t.charAt(0) !== t.charAt(1)) { return null; }
      return t;
    }
    if (t.length === 3 && (t.charAt(2) === 'S' || t.charAt(2) === 'O')) {
      r1 = t.charAt(0); r2 = t.charAt(1);
      if (RANK_INDEX[r1] === undefined || RANK_INDEX[r2] === undefined || r1 === r2) { return null; }
      hi = RANK_INDEX[r1] < RANK_INDEX[r2] ? r1 : r2;
      lo = RANK_INDEX[r1] < RANK_INDEX[r2] ? r2 : r1;
      return hi + lo + t.charAt(2).toLowerCase();
    }
    return null;
  }

  /* 组合数：对子 6，同花 4，非同花 12 */
  function combos(hand) {
    if (hand.length === 2) { return 6; }
    return hand.charAt(2) === 's' ? 4 : 12;
  }

  function expand(spec) {
    if (!spec || !Array.isArray(spec.actions) || spec.actions.length < 2) {
      throw new Error('RangeSpec 至少需 2 个行动');
    }
    var byKey = {};
    var defaults = [];
    var i, j, a, h;
    for (i = 0; i < spec.actions.length; i++) {
      a = spec.actions[i];
      if (!a || !a.key || !a.label) { throw new Error('行动缺少 key/label'); }
      if (byKey[a.key]) { throw new Error('行动 key 重复：' + a.key); }
      a.color = a.color || ACTION_COLORS[a.key] || '#6b7d72';
      a._hands = [];
      a._combos = 0;
      byKey[a.key] = a;
      if (a['default']) { defaults.push(a.key); }
      var list = a.hands || [];
      for (j = 0; j < list.length; j++) {
        h = parseHand(list[j]);
        if (!h) { throw new Error('非法牌型：' + list[j]); }
        a._hands.push(h);
        a._combos += combos(h);
      }
    }
    if (defaults.length !== 1) {
      throw new Error('RangeSpec 必须且只能有一个 default 行动（实际 ' + defaults.length + '）');
    }

    var assign = {};
    for (i = 0; i < spec.actions.length; i++) {
      a = spec.actions[i];
      for (j = 0; j < a._hands.length; j++) {
        h = a._hands[j];
        if (assign[h]) { throw new Error('牌型 ' + h + ' 同时属于 ' + assign[h] + ' 和 ' + a.key); }
        assign[h] = a.key;
      }
    }

    var cells = [];
    for (var r = 0; r < N_CELLS; r++) {
      for (var c = 0; c < N_CELLS; c++) {
        var hand = handAt(r, c);
        var key = assign[hand] || defaults[0];
        cells.push({ hand: hand, action: key });
      }
    }

    /* 汇总：default 行动的组合数 = 总量 - 其余行动 */
    var sum = 0;
    for (i = 0; i < spec.actions.length; i++) {
      if (!spec.actions[i]['default']) { sum += spec.actions[i]._combos; }
    }
    byKey[defaults[0]]._combos = TOTAL_COMBOS - sum;

    var byAction = {};
    for (i = 0; i < spec.actions.length; i++) {
      a = spec.actions[i];
      byAction[a.key] = {
        key: a.key, label: a.label, color: a.color, combos: a._combos,
        pct: Math.round(a._combos * 1000 / TOTAL_COMBOS) / 10,
        'default': !!a['default']
      };
    }

    return { cells: cells, byAction: byAction, 'default': defaults[0] };
  }

  /* ---------- 渲染 ---------- */

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text !== undefined && text !== null) { e.textContent = text; }
    return e;
  }

  /* 矩阵 + 图例 + 说明；opts: { onCell(hand,actionKey), highlight, picked } */
  function renderMatrix(container, spec, opts) {
    opts = opts || {};
    var data = expand(spec);

    var chart = el('div', 'range-chart');
    chart.appendChild(el('div', 'range-title', spec.title || ''));
    if (spec.spot) { chart.appendChild(el('div', 'range-spot', spec.spot)); }

    var grid = el('div', 'range-grid');
    var i, cell, act, node, isFold;
    for (i = 0; i < data.cells.length; i++) {
      cell = data.cells[i];
      act = data.byAction[cell.action];
      isFold = (cell.action === data['default']) && !byKeyHasHands(spec, cell.action);
      var cls = 'range-cell' + (isFold ? ' range-fold' : '');
      if (opts.onCell) {
        node = el('button', cls, cell.hand);
        node.type = 'button';
        (function (hand, action) {
          node.addEventListener('click', function () { opts.onCell(hand, action); });
        })(cell.hand, cell.action);
      } else {
        node = el('div', cls, cell.hand);
      }
      node.style.background = act.color;
      node.setAttribute('data-hand', cell.hand);
      node.setAttribute('data-action', cell.action);
      if (opts.highlight === cell.hand) { node.className += ' cell-hl'; node.title = '你的手牌'; }
      if (opts.picked === cell.hand) { node.className += ' cell-picked'; }
      grid.appendChild(node);
    }
    chart.appendChild(grid);

    var legend = el('div', 'range-legend');
    for (i = 0; i < spec.actions.length; i++) {
      var s = data.byAction[spec.actions[i].key];
      var chip = el('span', 'legend-chip');
      var sw = el('span', 'legend-swatch');
      sw.style.background = s.color;
      chip.appendChild(sw);
      chip.appendChild(document.createTextNode(s.label + ' ' + s.pct + '%'));
      legend.appendChild(chip);
    }
    chart.appendChild(legend);

    if (spec.note) { chart.appendChild(el('div', 'range-note', spec.note)); }
    if (spec.source) { chart.appendChild(el('div', 'range-src', spec.source)); }
    container.appendChild(chart);
    return data;
  }

  /* default 行动显式列出 hands 时视为非弃牌底色（例如 SB 的 limp 也列牌） */
  function byKeyHasHands(spec, key) {
    for (var i = 0; i < spec.actions.length; i++) {
      if (spec.actions[i].key === key) {
        return !!(spec.actions[i].hands && spec.actions[i].hands.length);
      }
    }
    return false;
  }

  /* 数值表：{ title, spot?, columns: [...], rows: [[...]...], note?, source? } */
  function renderTable(container, spec) {
    var chart = el('div', 'range-chart');
    chart.appendChild(el('div', 'range-title', spec.title || ''));
    if (spec.spot) { chart.appendChild(el('div', 'range-spot', spec.spot)); }
    var table = el('table', 'range-table');
    var thead = el('thead');
    var htr = el('tr');
    var i, j;
    var cols = spec.columns || [];
    for (i = 0; i < cols.length; i++) { htr.appendChild(el('th', null, cols[i])); }
    thead.appendChild(htr);
    table.appendChild(thead);
    var tbody = el('tbody');
    var rows = spec.rows || [];
    for (i = 0; i < rows.length; i++) {
      var tr = el('tr');
      var row = rows[i] || [];
      for (j = 0; j < row.length; j++) { tr.appendChild(el('td', null, row[j])); }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    chart.appendChild(table);
    if (spec.note) { chart.appendChild(el('div', 'range-note', spec.note)); }
    if (spec.source) { chart.appendChild(el('div', 'range-src', spec.source)); }
    container.appendChild(chart);
    return null;
  }

  function render(container, spec, opts) {
    if (spec && spec.type === 'table') { return renderTable(container, spec); }
    return renderMatrix(container, spec, opts);
  }

  return {
    render: render,
    renderMatrix: renderMatrix,
    renderTable: renderTable,
    math: {
      RANKS: RANKS, handAt: handAt, parseHand: parseHand, combos: combos,
      expand: expand, TOTAL_COMBOS: TOTAL_COMBOS, ACTION_COLORS: ACTION_COLORS
    }
  };
});
