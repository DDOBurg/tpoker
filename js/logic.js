/* TPoker 纯函数核心逻辑：判分 / 通过线 / 解锁 / 复习调度 / 到期判定。
 * 无任何 DOM/localStorage 依赖，可在 Node 与浏览器中运行（UMD）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.TPLogic = factory(); }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  function isArray(x) { return Object.prototype.toString.call(x) === '[object Array]'; }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function dateToStr(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayStr(now) {
    return dateToStr(now || new Date());
  }

  /* 本地自然日加减，输入输出均为 'YYYY-MM-DD'（按设备本地时区） */
  function addDays(dateStr, n) {
    var parts = dateStr.split('-');
    var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    d.setDate(d.getDate() + n);
    return dateToStr(d);
  }

  function tomorrow(today) { return addDays(today, 1); }

  /* 日期字符串比较（零填充 ISO 格式字典序即时间序） */
  function cmpDate(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

  function isDue(item, today) { return cmpDate(item.due, today) <= 0; }

  function dueItems(queue, today) {
    var out = [];
    for (var i = 0; i < queue.length; i++) {
      if (isDue(queue[i], today)) { out.push(queue[i]); }
    }
    out.sort(function (a, b) { return cmpDate(a.due, b.due); });
    return out;
  }

  /* 通过线：ceil(0.85 × 总题数)。用整数运算避免浮点误差 */
  function passLine(total) { return Math.ceil(85 * total / 100); }

  function isPassed(correct, total) { return correct >= passLine(total); }

  /* 判分：single 传选项索引（number），multi 传索引数组（须集合完全一致），range 传行动 key 字符串 */
  function grade(question, selection) {
    if (question.type === 'single') {
      return selection === question.answer;
    }
    if (question.type === 'range') {
      return selection === question.answer;
    }
    if (question.type === 'multi') {
      if (!isArray(selection) || !isArray(question.answer)) { return false; }
      if (selection.length !== question.answer.length) { return false; }
      var want = question.answer.slice().sort();
      var got = selection.slice().sort();
      for (var i = 0; i < want.length; i++) {
        if (want[i] !== got[i]) { return false; }
      }
      return true;
    }
    return false;
  }

  function defaultRng() { return Math.random(); }

  /* Fisher–Yates 洗牌，返回新数组，不修改原数组 */
  function shuffle(arr, rng) {
    var r = rng || defaultRng;
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* 测验组成：本单元全部题（随机序）+ 交错题（从已通过单元抽 min(3, 可用数) 题），
   * 交错题不重复于本单元题。返回 {questions, interleavedCount}
   */
  function buildQuizQuestions(unitQuestions, interleavePool, rng) {
    var main = shuffle(unitQuestions, rng);
    var n = Math.min(3, interleavePool.length);
    var inter = shuffle(interleavePool, rng).slice(0, n);
    var combined = main.concat(inter);
    var dedup = [];
    var seen = {};
    for (var i = 0; i < combined.length; i++) {
      if (!seen[combined[i].id]) { seen[combined[i].id] = true; dedup.push(combined[i]); }
    }
    return { questions: shuffle(dedup, rng), interleavedCount: dedup.length - main.length };
  }

  /* —— 复习队列（纯函数：返回新队列，不修改入参）—— */

  function findQueueIndex(queue, qid) {
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].qid === qid) { return i; }
    }
    return -1;
  }

  /* 错题入队：stage=1, due=明天。同一题去重（ER-8）：已有条目则更新 stage/due 而非新增 */
  function enqueueReview(queue, qid, unitId, today) {
    var next = queue.slice();
    var idx = findQueueIndex(next, qid);
    var entry = { qid: qid, unit: unitId, stage: 1, due: tomorrow(today) };
    if (idx >= 0) { next[idx] = entry; } else { next.push(entry); }
    return next;
  }

  /* 复习会话单题判分后的调度更新。
   * 答对：stage1→2(+3天)，stage2→3(+7天)，stage3→毕业移出队列；
   * 答错：stage 重置为 1，due=明天。
   * 返回 {queue, graduated}
   */
  function reviewAnswer(queue, qid, unitId, correct, today) {
    var idx = findQueueIndex(queue, qid);
    if (idx < 0) {
      if (!correct) { return { queue: enqueueReview(queue, qid, unitId, today), graduated: false }; }
      return { queue: queue.slice(), graduated: false };
    }
    var item = queue[idx];
    var next = queue.slice();
    if (!correct) {
      next[idx] = { qid: qid, unit: unitId, stage: 1, due: tomorrow(today) };
      return { queue: next, graduated: false };
    }
    if (item.stage >= 3) {
      next.splice(idx, 1);
      return { queue: next, graduated: true };
    }
    var newStage = item.stage + 1;
    var gap = newStage === 2 ? 3 : 7;
    next[idx] = { qid: qid, unit: unitId, stage: newStage, due: addDays(today, gap) };
    return { queue: next, graduated: false };
  }

  /* —— 单元状态派生 —— */

  /* 状态：mastered / passed / learning / new（无记录视为 new） */
  function unitStatus(progress) {
    if (!progress) { return 'new'; }
    if (progress.status === 'mastered') { return 'mastered'; }
    if (progress.status === 'passed') { return 'passed'; }
    if (progress.status === 'learning') { return 'learning'; }
    return 'new';
  }

  /* 颜色：未解锁/未开始 灰、学习中 蓝、待巩固(已通过) 黄、已掌握 绿 */
  function unitColor(status) {
    if (status === 'mastered') { return 'green'; }
    if (status === 'passed') { return 'yellow'; }
    if (status === 'learning') { return 'blue'; }
    return 'gray';
  }

  /* 解锁规则：order=1 默认解锁；order=n 在 order=n-1 已通过(passed/mastered)后解锁 */
  function isUnlocked(orderedUnits, progressMap, unitId) {
    var prevPassed = true;
    var found = false;
    for (var i = 0; i < orderedUnits.length; i++) {
      var u = orderedUnits[i];
      if (u.id === unitId) { found = true; break; }
      var st = unitStatus(progressMap[u.id]);
      if (st !== 'passed' && st !== 'mastered') { prevPassed = false; }
    }
    if (!found) { return false; }
    return prevPassed;
  }

  /* 单元回访到期：已通过、未完成回访、且到期日 ≤ 今天 */
  function revisitDue(progress, today) {
    if (!progress || progress.status !== 'passed') { return false; }
    if (progress.revisitDone) { return false; }
    return cmpDate(progress.revisitDue, today) <= 0;
  }

  return {
    isArray: isArray,
    pad2: pad2,
    dateToStr: dateToStr,
    todayStr: todayStr,
    addDays: addDays,
    tomorrow: tomorrow,
    cmpDate: cmpDate,
    isDue: isDue,
    dueItems: dueItems,
    passLine: passLine,
    isPassed: isPassed,
    grade: grade,
    shuffle: shuffle,
    buildQuizQuestions: buildQuizQuestions,
    findQueueIndex: findQueueIndex,
    enqueueReview: enqueueReview,
    reviewAnswer: reviewAnswer,
    unitStatus: unitStatus,
    unitColor: unitColor,
    isUnlocked: isUnlocked,
    revisitDue: revisitDue
  };
});
