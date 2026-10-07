/* TPoker 应用入口：路由 + 屏幕渲染（路径首页/学习屏/练习屏/范围速查/复盘统计屏）
 * + Service Worker 注册与更新提示。 */
(function () {
  'use strict';

  var APP_VERSION = '2.0.0';
  var DATA_VERSION = 'v2';

  var L = window.TPLogic;
  var R = window.TPRanges;
  var store = null;
  var index = [];      // units_index 条目
  var units = {};      // unitId -> 完整单元数据
  var byOrder = [];    // 按 order 排序的 index 条目
  var session = null;  // 当前答题会话（仅内存，FR-3.9 不持久化半会话）
  var rangePick = null; // 当前范围题已点选的格子 {hand, action}

  /* ---------- 基础工具 ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (html !== undefined && html !== null) { e.innerHTML = html; }
    return e;
  }

  function today() { return L.todayStr(); }

  function safeStorage() {
    try {
      var ls = window.localStorage;
      var k = '__tpoker_probe__';
      ls.setItem(k, '1');
      ls.removeItem(k);
      return ls;
    } catch (e) {
      return window.TPStore.createMemoryStorage();
    }
  }

  /* ---------- Service Worker：注册 / 更新提示 / 离线状态 ---------- */

  var swState = { reg: null, bannerShown: false, reloadOnce: false };

  function setupServiceWorker() {
    if (!('serviceWorker' in navigator)) { return; }
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (swState.reloadOnce) { return; }
      swState.reloadOnce = true;
      window.location.reload();
    });
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      swState.reg = reg;
      reg.addEventListener('updatefound', function () {
        var worker = reg.installing;
        if (!worker) { return; }
        worker.addEventListener('statechange', function () {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner();
          }
        });
      });
      checkUpdate();
    }).then(null, function () { /* file:// 或不支持时忽略 */ });
    window.addEventListener('online', function () { checkUpdate(); });
  }

  function checkUpdate() {
    if (swState.reg && navigator.onLine) {
      swState.reg.update().then(null, function () {});
    }
  }

  function showUpdateBanner() {
    if (swState.bannerShown) { return; }
    var app = $('app');
    if (!app) { return; }
    var bar = el('div', 'update-banner');
    bar.id = 'updateBanner';
    bar.appendChild(el('span', null, '新版本已就绪'));
    var btn = el('button', null, '点击更新');
    btn.addEventListener('click', function () {
      var w = swState.reg && swState.reg.waiting;
      if (w) { w.postMessage({ type: 'TP_SKIP_WAITING' }); }
      else { window.location.reload(); }
    });
    bar.appendChild(btn);
    app.insertBefore(bar, app.firstChild);
    swState.bannerShown = true;
  }

  function updateSwDot() {
    var dot = $('swDot');
    if (!dot) { return; }
    var on = navigator.serviceWorker && navigator.serviceWorker.controller;
    dot.textContent = on ? ' · 离线就绪 ●' : '';
  }

  /* ---------- 数据访问 ---------- */

  function state() { return store.getState(); }

  function progressOf(unitId) {
    var s = state();
    return s.units[unitId] || null;
  }

  function statusOf(unitId) { return L.unitStatus(progressOf(unitId)); }

  function unlocked(unitId) { return L.isUnlocked(byOrder, state().units, unitId); }

  function unitTitle(unitId) {
    var u = units[unitId];
    return u ? u.title : unitId;
  }

  function questionById(qid) {
    for (var i = 0; i < byOrder.length; i++) {
      var u = units[byOrder[i].id];
      if (!u) { continue; }
      for (var j = 0; j < u.questions.length; j++) {
        if (u.questions[j].id === qid) { return { q: u.questions[j], unitId: u.id }; }
      }
    }
    return null;
  }

  function qUnitMap() {
    var m = {};
    for (var i = 0; i < byOrder.length; i++) {
      var u = units[byOrder[i].id];
      if (!u) { continue; }
      for (var j = 0; j < u.questions.length; j++) { m[u.questions[j].id] = u.id; }
    }
    return m;
  }

  /* ---------- 范围表数据查找 ---------- */

  function findRangeSpec(unitId, spot) {
    var u = units[unitId];
    if (u && u.ranges) {
      for (var i = 0; i < u.ranges.length; i++) {
        if (u.ranges[i].id === spot) { return u.ranges[i]; }
      }
    }
    return null;
  }

  function findRangeSpecByQ(q) {
    for (var k in units) {
      if (Object.prototype.hasOwnProperty.call(units, k)) {
        var s = findRangeSpec(k, q.spot);
        if (s) { return s; }
      }
    }
    return null;
  }

  function actionLabel(spec, key) {
    if (spec && spec.actions) {
      for (var i = 0; i < spec.actions.length; i++) {
        if (spec.actions[i].key === key) { return spec.actions[i].label; }
      }
    }
    return key;
  }

  /* ---------- 统计写入 ---------- */

  function bump(bucket, key, correct) {
    if (!bucket[key]) { bucket[key] = { a: 0, c: 0 }; }
    bucket[key].a += 1;
    if (correct) { bucket[key].c += 1; }
  }

  function recordAnswer(st, item, correct) {
    bump(st.stats.perUnit, item.unitId, correct);
    bump(st.stats.perKp, item.q.kp, correct);
    bump(st.stats.perQuestion, item.q.id, correct);
  }

  function recordAttempt(st, unitId, kind, correct, total) {
    st.attempts.push({ date: today(), unit: unitId, kind: kind, correct: correct, total: total });
    if (st.attempts.length > 200) { st.attempts = st.attempts.slice(st.attempts.length - 200); }
  }

  /* ---------- 路由 ---------- */

  function go(hash) { location.hash = hash; }

  function route() {
    if (!store) { return; }
    var h = (location.hash || '#/').replace(/^#\//, '');
    var parts = h.split('/');
    var head = parts[0] || '';
    if (head === '') { renderHome(); return; }
    if (head === 'unit') { renderUnit(parts[1]); return; }
    if (head === 'quiz') { renderQuiz(parts[1], 'quiz'); return; }
    if (head === 'revisit') { renderQuiz(parts[1], 'revisit'); return; }
    if (head === 'review') { renderQuiz(null, 'review'); return; }
    if (head === 'ranges') { renderRanges(); return; }
    if (head === 'stats') { renderStats(); return; }
    renderHome();
  }

  function mount(node) {
    var app = $('app');
    app.innerHTML = '';
    app.appendChild(node);
    window.scrollTo(0, 0);
  }

  function pageShell(titleText, subtitle) {
    var wrap = el('div', 'page');
    var header = el('header', 'page-header');
    header.appendChild(el('a', 'back-link', '&larr; 首页'));
    header.lastChild.href = '#/';
    header.appendChild(el('h1', 'page-title', esc(titleText)));
    if (subtitle) { header.appendChild(el('p', 'page-sub', esc(subtitle))); }
    wrap.appendChild(header);
    return wrap;
  }

  /* ---------- 首页（路径图 + 今日待办 + 总进度） ---------- */

  var STATUS_LABEL = { gray: '未解锁', blue: '学习中', yellow: '待巩固', green: '已掌握' };

  function renderHome() {
    var s = state();
    var t = today();
    var wrap = el('div', 'page');

    var hero = el('div', 'hero');
    hero.appendChild(el('h1', 'app-title', 'TPoker 翻前训练'));
    hero.appendChild(el('p', 'app-sub', '阶段一 · 翻前基础（' + byOrder.length + ' 单元）'));
    wrap.appendChild(hero);

    /* 今日待办 */
    var todo = el('section', 'card');
    todo.appendChild(el('h2', 'card-title', '今日待办'));
    var hasTask = false;

    var nextUnit = null;
    for (var i = 0; i < byOrder.length; i++) {
      var id = byOrder[i].id;
      if (!unlocked(id)) { break; }
      var st = statusOf(id);
      if (st !== 'passed' && st !== 'mastered') { nextUnit = byOrder[i]; break; }
    }
    if (nextUnit) {
      hasTask = true;
      var st2 = statusOf(nextUnit.id);
      var learnBtn = el('a', 'btn btn-primary btn-block', (st2 === 'learning' ? '继续学习：' : '开始学习：') + esc(nextUnit.title));
      learnBtn.href = '#/unit/' + nextUnit.id;
      todo.appendChild(learnBtn);
    }

    var due = L.dueItems(s.queue, t);
    if (due.length > 0) {
      hasTask = true;
      var revBtn = el('a', 'btn btn-review btn-block', '复习到期错题：' + due.length + ' 题');
      revBtn.href = '#/review';
      todo.appendChild(revBtn);
    } else {
      todo.appendChild(el('p', 'todo-empty', '今日无复习任务'));
    }

    for (var r = 0; r < byOrder.length; r++) {
      var u = byOrder[r];
      var p = s.units[u.id];
      if (L.revisitDue(p, t)) {
        hasTask = true;
        var rvBtn = el('a', 'btn btn-warn btn-block', '回访测验：' + esc(u.title));
        rvBtn.href = '#/revisit/' + u.id;
        todo.appendChild(rvBtn);
      }
    }
    if (!hasTask) { todo.appendChild(el('p', 'todo-empty', '全部完成，保持手感！')); }
    wrap.appendChild(todo);

    /* 总进度 */
    var total = byOrder.length;
    var passedN = 0, masteredN = 0, ansAll = 0, corAll = 0;
    for (var k in s.stats.perUnit) {
      if (Object.prototype.hasOwnProperty.call(s.stats.perUnit, k)) {
        ansAll += s.stats.perUnit[k].a;
        corAll += s.stats.perUnit[k].c;
      }
    }
    for (var m = 0; m < byOrder.length; m++) {
      var mst = statusOf(byOrder[m].id);
      if (mst === 'passed' || mst === 'mastered') { passedN++; }
      if (mst === 'mastered') { masteredN++; }
    }
    var prog = el('section', 'card');
    prog.appendChild(el('h2', 'card-title', '总进度'));
    var acc = ansAll > 0 ? Math.round(corAll * 100 / ansAll) + '%' : '—';
    var grid = el('div', 'prog-grid');
    grid.appendChild(el('div', 'prog-item', '<b>' + passedN + '/' + total + '</b><span>已通过</span>'));
    grid.appendChild(el('div', 'prog-item', '<b>' + masteredN + '/' + total + '</b><span>已掌握</span>'));
    grid.appendChild(el('div', 'prog-item', '<b>' + acc + '</b><span>总正确率</span>'));
    prog.appendChild(grid);
    wrap.appendChild(prog);

    /* 学习路径 */
    var path = el('section', 'card');
    path.appendChild(el('h2', 'card-title', '学习路径'));
    var mapEl = el('div', 'path-map');
    for (var n = 0; n < byOrder.length; n++) {
      (function (entry) {
        var st3 = statusOf(entry.id);
        var isOpen = unlocked(entry.id);
        var color = isOpen ? L.unitColor(st3) : 'gray';
        var node = el('div', 'unit-node node-' + color);
        node.appendChild(el('div', 'unit-order', '第 ' + entry.order + ' 单元'));
        node.appendChild(el('div', 'unit-name', esc(entry.title)));
        node.appendChild(el('div', 'unit-status', STATUS_LABEL[color] + (isOpen ? '' : ' 🔒')));
        if (isOpen) {
          node.className += ' node-open';
          node.addEventListener('click', function () { go('/unit/' + entry.id); });
        }
        mapEl.appendChild(node);
      })(byOrder[n]);
    }
    path.appendChild(mapEl);
    wrap.appendChild(path);

    var nav = el('div', 'home-nav');
    var rangesLink = el('a', 'btn btn-ghost btn-block', '范围速查');
    rangesLink.href = '#/ranges';
    nav.appendChild(rangesLink);
    var statsLink = el('a', 'btn btn-ghost btn-block', '复盘统计 / 数据');
    statsLink.href = '#/stats';
    nav.appendChild(statsLink);
    wrap.appendChild(nav);

    wrap.appendChild(el('footer', 'app-footer', 'TPoker v' + APP_VERSION + ' · 数据 ' + DATA_VERSION + ' · 完全离线运行<span id="swDot" class="sw-dot"></span>'));
    mount(wrap);
    updateSwDot();
    checkUpdate();
  }

  /* ---------- 学习屏（学习卡 v2：概念/规则/范围表/示例/进阶/误区/来源） ---------- */

  function renderUnit(unitId) {
    var u = units[unitId];
    if (!u) { renderHome(); return; }
    if (!unlocked(unitId)) {
      var deny = pageShell('单元未解锁');
      deny.appendChild(el('p', 'notice', '请先通过前一个单元后，再进入本单元。'));
      mount(deny);
      return;
    }
    var st = statusOf(unitId);
    if (st === 'new') {
      store.mutate(function (s) {
        s.units[unitId] = { status: 'learning' };
      });
    }

    var wrap = pageShell(u.title, '第 ' + u.order + ' 单元 · 学习卡');

    var concept = el('section', 'card');
    concept.appendChild(el('h2', 'card-title', '核心概念'));
    concept.appendChild(el('p', 'lesson-text', esc(u.lesson.concept)));
    wrap.appendChild(concept);

    var rules = el('section', 'card');
    rules.appendChild(el('h2', 'card-title', '核心规则'));
    var ol = el('ol', 'rule-list');
    for (var i = 0; i < u.lesson.rules.length; i++) {
      var r = u.lesson.rules[i];
      var shortId = r.id.slice(r.id.lastIndexOf('-R') + 1);  // R1 / R2 ...
      ol.appendChild(el('li', 'rule-item', '<b>' + esc(shortId) + '</b> ' + esc(r.text)));
    }
    rules.appendChild(ol);
    wrap.appendChild(rules);

    if (u.ranges && u.ranges.length) {
      var rc = el('section', 'card');
      rc.appendChild(el('h2', 'card-title', '范围表'));
      u.ranges.forEach(function (spec) {
        try {
          R.render(rc, spec);
        } catch (e) {
          rc.appendChild(el('p', 'notice', '范围表数据错误：' + e.message));
        }
      });
      wrap.appendChild(rc);
    }

    var ex = el('section', 'card');
    ex.appendChild(el('h2', 'card-title', '示例'));
    ex.appendChild(el('p', 'lesson-text', esc(u.lesson.example)));
    wrap.appendChild(ex);

    if (u.lesson.advanced && u.lesson.advanced.length) {
      var adv = el('section', 'card');
      adv.appendChild(el('h2', 'card-title', '进阶理论'));
      u.lesson.advanced.forEach(function (a) {
        var box = el('div', 'adv-item');
        box.appendChild(el('b', null, a.title));
        box.appendChild(document.createTextNode(a.text));
        adv.appendChild(box);
      });
      wrap.appendChild(adv);
    }

    if (u.lesson.pitfalls && u.lesson.pitfalls.length) {
      var pit = el('section', 'card');
      pit.appendChild(el('h2', 'card-title', '常见误区'));
      u.lesson.pitfalls.forEach(function (t) { pit.appendChild(el('div', 'pitfall-item', t)); });
      wrap.appendChild(pit);
    }

    if (u.lesson.sources && u.lesson.sources.length) {
      var src = el('section', 'card');
      src.appendChild(el('h2', 'card-title', '参考来源'));
      var ul = el('ul', 'src-list');
      u.lesson.sources.forEach(function (s) {
        var li = el('li');
        var label = s.name + (s.note ? '（' + s.note + '）' : '');
        if (s.url) {
          var a = el('a', null, esc(label));
          a.href = s.url;
          a.target = '_blank';
          a.rel = 'noopener';
          li.appendChild(a);
        } else {
          li.textContent = label;
        }
        ul.appendChild(li);
      });
      src.appendChild(ul);
      wrap.appendChild(src);
    }

    var actions = el('div', 'actions');
    var startBtn = el('a', 'btn btn-primary btn-block', '开始测验（' + u.questions.length + ' 题）');
    startBtn.href = '#/quiz/' + unitId;
    actions.appendChild(startBtn);
    var passedHint = '';
    if (st === 'passed') { passedHint = '已通过 · ' + (progressOf(unitId).revisitDue || '') + ' 回访'; }
    if (st === 'mastered') { passedHint = '已掌握，可重复学习'; }
    if (passedHint) { actions.appendChild(el('p', 'todo-empty', passedHint)); }
    wrap.appendChild(actions);

    mount(wrap);
  }

  /* ---------- 练习屏（测验 / 回访 / 复习 三态复用） ---------- */

  var KIND_LABEL = { quiz: '单元测验', revisit: '回访测验', review: '复习' };

  function buildSession(kind, unitId) {
    var items = [];
    var t = today();
    if (kind === 'quiz') {
      var u = units[unitId];
      if (!u) { return null; }
      var pool = [];
      for (var i = 0; i < byOrder.length; i++) {
        var other = units[byOrder[i].id];
        if (!other || other.id === unitId) { continue; }
        var st = statusOf(other.id);
        if (st === 'passed' || st === 'mastered') {
          for (var j = 0; j < other.questions.length; j++) { pool.push(other.questions[j]); }
        }
      }
      var built = L.buildQuizQuestions(u.questions, pool);
      for (var k = 0; k < built.questions.length; k++) {
        var q = built.questions[k];
        items.push({ q: q, unitId: qmapOf(q.id) || unitId, stage: 0 });
      }
    } else if (kind === 'revisit') {
      var uu = units[unitId];
      if (!uu) { return null; }
      var qs = L.shuffle(uu.questions);
      for (var m = 0; m < qs.length; m++) { items.push({ q: qs[m], unitId: unitId, stage: 0 }); }
    } else if (kind === 'review') {
      var due = L.dueItems(state().queue, t);
      for (var n = 0; n < due.length; n++) {
        var found = questionById(due[n].qid);
        if (found) { items.push({ q: found.q, unitId: found.unitId, stage: due[n].stage }); }
      }
      if (items.length === 0) { return { empty: true, items: [], idx: 0, answers: [], kind: kind, unitId: unitId }; }
    }
    return { kind: kind, unitId: unitId, items: items, idx: 0, answers: [], empty: false };
  }

  function qmapOf(qid) {
    var m = qUnitMap();
    return m[qid];
  }

  function renderQuiz(unitId, kind) {
    if (kind !== 'review') {
      if (!units[unitId] || !unlocked(unitId)) {
        var deny = pageShell('无法进入');
        deny.appendChild(el('p', 'notice', '该测验不可用（单元不存在或未解锁）。'));
        mount(deny);
        return;
      }
      if (kind === 'revisit' && !L.revisitDue(progressOf(unitId), today())) {
        var deny2 = pageShell('回访未到期');
        deny2.appendChild(el('p', 'notice', '该单元回访测验尚未到期（通过后第 3 天可用）。'));
        mount(deny2);
        return;
      }
    }
    session = buildSession(kind, unitId);
    if (!session) { renderHome(); return; }
    if (session.empty) {
      var empty = pageShell(KIND_LABEL[kind]);
      empty.appendChild(el('p', 'notice', '暂无到期复习题。答错的题目会在明天回到这里。'));
      mount(empty);
      return;
    }
    renderQuestion();
  }

  function currentSelection() {
    var q = session.items[session.idx].q;
    if (q.type === 'range') {
      return rangePick ? rangePick.action : null;
    }
    if (q.type === 'single') {
      var radios = document.getElementsByName('opt');
      for (var i = 0; i < radios.length; i++) {
        if (radios[i].checked) { return parseInt(radios[i].value, 10); }
      }
      return null;
    }
    var boxes = document.getElementsByName('opt');
    var sel = [];
    for (var j = 0; j < boxes.length; j++) {
      if (boxes[j].checked) { sel.push(parseInt(boxes[j].value, 10)); }
    }
    return sel;
  }

  function answerText(q, sel) {
    if (q.type === 'range') { return actionLabel(findRangeSpecByQ(q), sel); }
    if (q.type === 'single') { return q.options[sel]; }
    var parts = [];
    var arr = L.isArray(sel) ? sel : [sel];
    for (var i = 0; i < arr.length; i++) { parts.push(q.options[arr[i]]); }
    return parts.join('、');
  }

  function renderQuestion() {
    var item = session.items[session.idx];
    var q = item.q;
    var total = session.items.length;
    var n = session.idx + 1;

    rangePick = null;

    var wrap = el('div', 'page');
    var header = el('header', 'page-header');
    header.appendChild(el('a', 'back-link', '&larr; 退出'));
    header.lastChild.href = '#/';
    header.appendChild(el('h1', 'page-title', KIND_LABEL[session.kind]));
    header.appendChild(el('p', 'page-sub', '第 ' + n + ' / ' + total + ' 题' + (session.kind === 'review' && item.stage ? ' · 复习第 ' + item.stage + ' 轮' : '')));
    wrap.appendChild(header);

    var card = el('section', 'card');
    card.appendChild(el('p', 'scenario', esc(q.scenario)));

    if (q.type === 'range') {
      var spec = findRangeSpec(item.unitId, q.spot);
      card.appendChild(el('div', 'range-hand', esc(q.hand || '')));
      var info = el('div', 'range-info', '在下方矩阵中点任意格子作答：所选格子的行动即你的答案');
      info.id = 'rangeInfo';
      card.appendChild(info);
      if (spec) {
        R.render(card, spec, {
          highlight: q.hand,
          onCell: (function (holder) {
            return function (hand, action) {
              rangePick = { hand: hand, action: action };
              var cells = holder.querySelectorAll('.range-cell');
              for (var ci = 0; ci < cells.length; ci++) {
                if (cells[ci].dataset.hand === hand) { cells[ci].classList.add('cell-picked'); }
                else { cells[ci].classList.remove('cell-picked'); }
              }
              $('rangeInfo').textContent = '已选择：' + hand + ' → ' + actionLabel(spec, action);
              updateSubmitState();
            };
          })(card)
        });
      } else {
        card.appendChild(el('p', 'notice', '本题范围数据缺失：' + q.spot));
      }
      card.appendChild(el('p', 'hint', '提示：白框 ✱ 标记的是你的手牌所在格。'));
    } else {
      var form = el('div', 'options');
      var inputType = q.type === 'single' ? 'radio' : 'checkbox';
      for (var i = 0; i < q.options.length; i++) {
        (function (idx) {
          var label = el('label', 'option');
          var input = document.createElement('input');
          input.type = inputType;
          input.name = 'opt';
          input.value = String(idx);
          input.addEventListener('change', function () { updateSubmitState(); });
          label.appendChild(input);
          label.appendChild(el('span', 'option-text', esc(q.options[idx])));
          form.appendChild(label);
        })(i);
      }
      card.appendChild(form);
      if (q.type === 'multi') { card.appendChild(el('p', 'hint', '多选题：所选集合与标准答案完全一致才算对')); }
    }
    wrap.appendChild(card);

    var feedback = el('div', '');
    feedback.id = 'feedback';
    wrap.appendChild(feedback);

    var actions = el('div', 'actions');
    var submitBtn = el('button', 'btn btn-primary btn-block', '提交答案');
    submitBtn.id = 'submitBtn';
    submitBtn.disabled = true;
    submitBtn.addEventListener('click', onSubmit);
    var nextBtn = el('button', 'btn btn-primary btn-block', n === total ? '查看成绩' : '下一题');
    nextBtn.id = 'nextBtn';
    nextBtn.style.display = 'none';
    nextBtn.addEventListener('click', onNext);
    actions.appendChild(submitBtn);
    actions.appendChild(nextBtn);
    wrap.appendChild(actions);

    mount(wrap);
  }

  function updateSubmitState() {
    var q = session.items[session.idx].q;
    if (q.type === 'range') { $('submitBtn').disabled = !rangePick; return; }
    var sel = currentSelection();
    var ok = sel !== null && (!L.isArray(sel) || sel.length > 0);
    $('submitBtn').disabled = !ok;
  }

  function onSubmit() {
    var item = session.items[session.idx];
    var q = item.q;
    var sel = currentSelection();
    if (sel === null || (L.isArray(sel) && sel.length === 0)) { return; }  // FR-3.5
    var ok = L.grade(q, sel);
    session.answers.push({ item: item, sel: sel, ok: ok });

    var fb = $('feedback');
    fb.innerHTML = '';
    fb.appendChild(el('div', 'verdict ' + (ok ? 'verdict-ok' : 'verdict-bad'), ok ? '✓ 回答正确' : '✗ 回答错误'));
    var ansLine;
    if (q.type === 'single') {
      ansLine = '标准答案：' + q.options[q.answer];
    } else if (q.type === 'range') {
      ansLine = '标准行动：' + actionLabel(findRangeSpecByQ(q), q.answer);
    } else {
      ansLine = '标准答案：' + answerText(q, q.answer);
    }
    fb.appendChild(el('p', 'answer-line', esc(ansLine)));
    if (!ok) {
      fb.appendChild(el('p', 'answer-line', esc('你的答案：' + answerText(q, sel))));
    }
    fb.appendChild(el('div', 'explanation', '<b>讲解：</b>' + esc(q.explanation)));

    $('submitBtn').style.display = 'none';
    $('nextBtn').style.display = '';
  }

  function onNext() {
    if (session.idx >= session.items.length - 1) { finishSession(); return; }
    session.idx += 1;
    renderQuestion();
  }

  function finishSession() {
    var correct = 0;
    for (var i = 0; i < session.answers.length; i++) {
      if (session.answers[i].ok) { correct++; }
    }
    var total = session.items.length;
    var passed = L.isPassed(correct, total);
    var t = today();
    var kind = session.kind;
    var graduated = 0;

    store.mutate(function (s) {
      for (var i = 0; i < session.answers.length; i++) {
        recordAnswer(s, session.answers[i].item, session.answers[i].ok);
      }
      if (kind === 'review') {
        for (var j = 0; j < session.answers.length; j++) {
          var a = session.answers[j];
          var res = L.reviewAnswer(s.queue, a.item.q.id, a.item.unitId, a.ok, t);
          s.queue = res.queue;
          if (res.graduated) { graduated++; }
        }
        recordAttempt(s, session.unitId || 'review', 'review', correct, total);
      } else {
        recordAttempt(s, session.unitId, kind, correct, total);
        var prev = s.units[session.unitId] || {};
        if (kind === 'quiz') {
          if (passed) {
            s.units[session.unitId] = { status: 'passed', passedAt: t, revisitDue: L.addDays(t, 3), revisitDone: false };
          } else if (prev.status !== 'passed' && prev.status !== 'mastered') {
            s.units[session.unitId] = { status: 'learning' };
          }
        } else if (kind === 'revisit') {
          if (passed) {
            s.units[session.unitId] = { status: 'mastered', passedAt: prev.passedAt || t, masteredAt: t, revisitDue: prev.revisitDue || t, revisitDone: true };
          } else {
            s.units[session.unitId] = { status: 'learning' };
          }
        }
        for (var k = 0; k < session.answers.length; k++) {
          var w = session.answers[k];
          if (!w.ok) { s.queue = L.enqueueReview(s.queue, w.item.q.id, w.item.unitId, t); }
        }
      }
    });

    renderResults(correct, total, passed, graduated);
  }

  function renderResults(correct, total, passed, graduated) {
    var kind = session.kind;
    var pct = Math.round(correct * 100 / total);
    var wrap = pageShell(KIND_LABEL[kind] + '成绩');

    var summary = el('section', 'card result-card');
    summary.appendChild(el('div', 'result-score', correct + ' / ' + total));
    summary.appendChild(el('div', 'result-pct', '正确率 ' + pct + '%'));
    if (kind === 'review') {
      summary.appendChild(el('div', 'verdict verdict-ok', '本次复习完成：答对 ' + correct + ' 题，毕业 ' + graduated + ' 题，其余已按调度更新'));
    } else {
      var line = L.passLine(total);
      summary.appendChild(el('div', 'result-line', '通过线：≥ ' + line + ' / ' + total));
      summary.appendChild(el('div', 'verdict ' + (passed ? 'verdict-ok' : 'verdict-bad'), passed ? '✓ 通过' : '✗ 未通过'));
      if (kind === 'quiz' && passed) {
        summary.appendChild(el('p', 'hint', '3 天后（' + L.addDays(today(), 3) + '）将安排回访测验，达标后标记为已掌握。'));
      }
      if (kind === 'quiz' && !passed) {
        summary.appendChild(el('p', 'hint', '未通过：可回到学习卡复习后无限重测。答错题目已进入复习队列（明天到期）。'));
      }
      if (kind === 'revisit' && passed) {
        summary.appendChild(el('p', 'hint', '回访通过，本单元已掌握！'));
      }
      if (kind === 'revisit' && !passed) {
        summary.appendChild(el('p', 'hint', '回访未通过：单元回到"学习中"，答错题目已入复习队列，重新通过测验可再次进入回访。'));
      }
    }
    wrap.appendChild(summary);

    var wrongList = [];
    for (var i = 0; i < session.answers.length; i++) {
      if (!session.answers[i].ok) { wrongList.push(session.answers[i]); }
    }
    if (wrongList.length > 0) {
      var wc = el('section', 'card');
      wc.appendChild(el('h2', 'card-title', '答错题目回看（' + wrongList.length + '）'));
      for (var j = 0; j < wrongList.length; j++) {
        (function (a) {
          var box = el('div', 'wrong-item');
          box.appendChild(el('p', 'scenario', esc(a.item.q.scenario)));
          box.appendChild(el('p', 'answer-line', esc('你的答案：' + answerText(a.item.q, a.sel))));
          var std = a.item.q.type === 'single'
            ? '标准答案：' + a.item.q.options[a.item.q.answer]
            : (a.item.q.type === 'range'
              ? '标准行动：' + actionLabel(findRangeSpecByQ(a.item.q), a.item.q.answer)
              : '标准答案：' + answerText(a.item.q, a.item.q.answer));
          box.appendChild(el('p', 'answer-line', esc(std)));
          box.appendChild(el('p', 'explanation', '<b>讲解：</b>' + esc(a.item.q.explanation)));
          wc.appendChild(box);
        })(wrongList[j]);
      }
      wrap.appendChild(wc);
    }

    var actions = el('div', 'actions');
    var homeBtn = el('a', 'btn btn-ghost btn-block', '返回首页');
    homeBtn.href = '#/';
    var statsBtn = el('a', 'btn btn-primary btn-block', '查看复盘统计');
    statsBtn.href = '#/stats';
    actions.appendChild(homeBtn);
    actions.appendChild(statsBtn);
    wrap.appendChild(actions);

    session = null;
    mount(wrap);
  }

  /* ---------- 范围速查页 ---------- */

  function renderRanges() {
    var wrap = pageShell('范围速查', '全部范围表一处浏览 · 点任意格子看组合数与占比');

    var count = 0;
    for (var i = 0; i < byOrder.length; i++) {
      var u = units[byOrder[i].id];
      if (!u || !u.ranges || !u.ranges.length) { continue; }
      count += u.ranges.length;
      var det = el('details', 'range-group');
      det.appendChild(el('summary', null, '第 ' + u.order + ' 单元 · ' + u.title + '（' + u.ranges.length + ' 张）'));
      u.ranges.forEach(function (spec) {
        var holder = el('div');
        try {
          if (spec.type === 'table') {
            R.render(holder, spec);
          } else {
            var info = el('div', 'range-info', '点格子查看详情');
            R.render(holder, spec, {
              onCell: function (hand, action) {
                var data = R.math.expand(spec);
                var act = data.byAction[action];
                info.textContent = hand + '：' + act.label + ' · ' +
                  R.math.combos(hand) + ' 种组合 · 占全部 ' +
                  (Math.round(R.math.combos(hand) * 1000 / R.math.TOTAL_COMBOS) / 10) + '%';
              }
            });
            holder.appendChild(info);
          }
        } catch (e) {
          holder.appendChild(el('p', 'notice', '范围表数据错误：' + e.message));
        }
        det.appendChild(holder);
      });
      wrap.appendChild(det);
    }

    if (count === 0) {
      wrap.appendChild(el('p', 'notice', '暂无可速查的范围表。'));
    }

    var actions = el('div', 'actions');
    var homeBtn = el('a', 'btn btn-ghost btn-block', '返回首页');
    homeBtn.href = '#/';
    actions.appendChild(homeBtn);
    wrap.appendChild(actions);

    mount(wrap);
  }

  /* ---------- 复盘统计屏 ---------- */

  function pctOf(entry) {
    if (!entry || entry.a === 0) { return null; }
    return Math.round(entry.c * 100 / entry.a);
  }

  function renderStats() {
    var s = state();
    var wrap = pageShell('复盘统计', '按单元 · 知识点热力图 · 错题本 · 数据备份');

    /* 按单元 */
    var uc = el('section', 'card');
    uc.appendChild(el('h2', 'card-title', '按单元'));
    var anyUnit = false;
    for (var i = 0; i < byOrder.length; i++) {
      var id = byOrder[i].id;
      var e = s.stats.perUnit[id];
      if (!e || e.a === 0) { continue; }
      anyUnit = true;
      var p = pctOf(e);
      var lastAtt = null;
      for (var a2 = s.attempts.length - 1; a2 >= 0; a2--) {
        if (s.attempts[a2].unit === id && s.attempts[a2].kind !== 'review') { lastAtt = s.attempts[a2]; break; }
      }
      var row = el('div', 'stat-row');
      row.appendChild(el('div', 'stat-name', esc(byOrder[i].title)));
      row.appendChild(el('div', 'stat-nums', '答题 ' + e.a + ' · 正确率 ' + p + '%' + (lastAtt ? '<br>最近测验 ' + lastAtt.correct + '/' + lastAtt.total + '（' + lastAtt.date + '）' : '')));
      uc.appendChild(row);
    }
    if (!anyUnit) { uc.appendChild(el('p', 'todo-empty', '还没有答题记录，先去完成一次测验吧。')); }
    wrap.appendChild(uc);

    /* kp 热力图 */
    var heat = el('section', 'card');
    heat.appendChild(el('h2', 'card-title', '知识点热力图'));
    var kps = [];
    for (var kp in s.stats.perKp) {
      if (Object.prototype.hasOwnProperty.call(s.stats.perKp, kp) && s.stats.perKp[kp].a > 0) {
        kps.push(kp);
      }
    }
    if (kps.length === 0) {
      heat.appendChild(el('p', 'todo-empty', '暂无知识点数据。'));
    } else {
      var hm = el('div', 'heat-map');
      for (var h = 0; h < kps.length; h++) {
        var kpName = kps[h];
        var pct = pctOf(s.stats.perKp[kpName]);
        var cls = pct < 60 ? 'heat-red' : (pct <= 85 ? 'heat-yellow' : 'heat-green');
        hm.appendChild(el('div', 'heat-cell ' + cls, esc(kpName) + '<b>' + pct + '%</b>'));
      }
      heat.appendChild(hm);
      heat.appendChild(el('p', 'hint', '红 <60% · 黄 60–85% · 绿 >85%'));
    }
    wrap.appendChild(heat);

    /* 错题本 */
    var book = el('section', 'card');
    book.appendChild(el('h2', 'card-title', '错题本（复习队列 ' + s.queue.length + ' 题）'));
    if (s.queue.length === 0) {
      book.appendChild(el('p', 'todo-empty', '复习队列为空，保持！'));
    } else {
      var t = today();
      for (var qi = 0; qi < s.queue.length; qi++) {
        (function (entry) {
          var found = questionById(entry.qid);
          var row = el('div', 'wrong-item');
          var dueTag = L.isDue(entry, t) ? ' · 已到期' : '';
          row.appendChild(el('p', 'scenario', esc('【' + unitTitle(entry.unit) + '】复习第 ' + entry.stage + ' 轮 · 到期 ' + entry.due + dueTag)));
          if (found) {
            row.appendChild(el('p', 'scenario', esc(found.q.scenario)));
            var std = found.q.type === 'single'
              ? '标准答案：' + found.q.options[found.q.answer]
              : (found.q.type === 'range'
                ? '标准行动：' + actionLabel(findRangeSpecByQ(found.q), found.q.answer)
                : '标准答案：' + answerText(found.q, found.q.answer));
            row.appendChild(el('p', 'answer-line', esc(std)));
            var det = el('div', 'explanation', '<b>讲解：</b>' + esc(found.q.explanation));
            det.style.display = 'none';
            var toggle = el('button', 'btn btn-ghost', '查看讲解');
            toggle.addEventListener('click', function () {
              det.style.display = det.style.display === 'none' ? '' : 'none';
            });
            row.appendChild(toggle);
            row.appendChild(det);
          }
          book.appendChild(row);
        })(s.queue[qi]);
      }
    }
    wrap.appendChild(book);

    /* 数据备份 */
    var dataCard = el('section', 'card');
    dataCard.appendChild(el('h2', 'card-title', '数据导出 / 导入'));
    var exportBtn = el('button', 'btn btn-primary btn-block', '导出备份 JSON');
    exportBtn.addEventListener('click', doExport);
    dataCard.appendChild(exportBtn);

    var importLabel = el('label', 'btn btn-ghost btn-block file-label', '导入备份 JSON');
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', doImport);
    importLabel.appendChild(fileInput);
    dataCard.appendChild(importLabel);
    var msg = el('p', 'import-msg', '');
    msg.id = 'importMsg';
    dataCard.appendChild(msg);
    var tip = el('p', 'hint', '入口更换后（如改用 GitHub Pages 地址）：先在旧入口导出备份，再到这里导入，进度即可迁移。');
    dataCard.appendChild(tip);
    wrap.appendChild(dataCard);

    wrap.appendChild(el('footer', 'app-footer', 'TPoker v' + APP_VERSION + ' · 数据 ' + DATA_VERSION));
    mount(wrap);
  }

  function doExport() {
    var blob = new Blob([store.exportJSON()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tpoker-backup-' + today() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function doImport(evt) {
    var file = evt.target.files && evt.target.files[0];
    var msg = $('importMsg');
    if (!file) { return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        store.importJSON(String(reader.result));
        msg.className = 'import-msg import-ok';
        msg.textContent = '导入成功，数据已恢复。';
        setTimeout(function () { renderStats(); }, 600);
      } catch (e) {
        msg.className = 'import-msg import-bad';
        msg.textContent = e.message || '导入失败：文件无效';
      }
    };
    reader.readAsText(file);
    evt.target.value = '';
  }

  /* ---------- 启动 ---------- */

  function showBootError(msg) {
    var app = $('app');
    app.innerHTML = '';
    var box = el('div', 'page');
    box.appendChild(el('h1', 'page-title', 'TPoker'));
    box.appendChild(el('p', 'notice', esc(msg)));
    box.appendChild(el('p', 'hint', '请使用 start.bat / start.sh 启动本地服务后访问（file:// 直接打开无法加载数据）。'));
    app.appendChild(box);
  }

  function loadData() {
    return fetch('data/units_index.json').then(function (r) {
      if (!r.ok) { throw new Error('单元清单加载失败：HTTP ' + r.status); }
      return r.json();
    }).then(function (idx) {
      index = idx;
      var jobs = index.map(function (entry) {
        return fetch('data/' + entry.file).then(function (r) {
          if (!r.ok) { throw new Error('单元数据加载失败：' + entry.file + ' HTTP ' + r.status); }
          return r.json();
        }).then(function (data) {
          units[data.id] = data;
        });
      });
      return Promise.all(jobs);
    }).then(function () {
      byOrder = index.slice().sort(function (a, b) { return a.order - b.order; });
    });
  }

  function boot() {
    setupServiceWorker();
    store = window.TPStore.createStore(safeStorage());
    loadData().then(function () {
      window.addEventListener('hashchange', route);
      route();
    }, function (e) {
      showBootError(e.message || '数据加载失败');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
