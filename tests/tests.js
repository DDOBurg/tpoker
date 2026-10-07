/* TPoker 逻辑单元测试（T2）：判分、通过线、解锁、复习调度状态机、到期判定、导出导入往返。
 * 与运行环境无关的共享断言集：Node（run-tests.js）与浏览器（test.html）均调用 TPTests.run(L, TPStore)。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.TPTests = factory(); }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  function assert(cond, msg) {
    if (!cond) { throw new Error('断言失败：' + msg); }
  }
  function eq(a, b, msg) {
    if (a !== b) { throw new Error('断言失败：' + msg + '（期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + '）'); }
  }

  function qSingle(id, answer) {
    return { id: id, type: 'single', options: ['开池', '弃牌'], answer: answer, kp: 'test-kp' };
  }
  function qMulti(id, answer) {
    return {
      id: id, type: 'multi',
      options: ['A♠2♠', 'K♥8♦', '5♥5♦', '9♦7♣', 'J♠4♠', 'A♣7♦', 'Q♣6♣', 'T♠6♠'],
      answer: answer, kp: 'test-kp'
    };
  }

  function run(L, TPStore, TPRanges) {
    var tests = [];
    function T(name, fn) { tests.push({ name: name, fn: fn }); }

    /* —— 通过线（整数实现 ceil(0.85n)） —— */
    T('通过线 passLine：15题→13，12题→11，25题→22', function () {
      eq(L.passLine(15), 13, 'passLine(15)');
      eq(L.passLine(12), 11, 'passLine(12)');
      eq(L.passLine(25), 22, 'passLine(25)');
      eq(L.passLine(1), 1, 'passLine(1)');
    });
    T('通过判定边界（ER-2）：13/15 通过，12/15 不通过', function () {
      eq(L.isPassed(13, 15), true, '13/15 应通过');
      eq(L.isPassed(12, 15), false, '12/15 不应通过');
      eq(L.isPassed(11, 12), true, '11/12 应通过');
      eq(L.isPassed(10, 12), false, '10/12 不应通过');
    });

    /* —— 判分 —— */
    T('单选判分：选对为对，选错为错', function () {
      eq(L.grade(qSingle('s1', 0), 0), true, '选开池');
      eq(L.grade(qSingle('s1', 0), 1), false, '选弃牌');
    });
    T('多选判分（FR-3.4）：集合完全一致才算对', function () {
      var q = qMulti('m1', [0, 2, 4]);
      eq(L.grade(q, [0, 2, 4]), true, '完全一致');
      eq(L.grade(q, [2, 0, 4]), true, '顺序不同视为同一集合');
      eq(L.grade(q, [0, 2]), false, '子集算错');
      eq(L.grade(q, [0, 2, 4, 6]), false, '超集算错');
      eq(L.grade(q, []), false, '空选算错');
      eq(L.grade(q, [0, 2, 5]), false, '错一项算错');
    });

    /* —— 洗牌与测验组成 —— */
    T('洗牌：不修改原数组、结果为重排、确定性 rng 可复现', function () {
      var orig = [1, 2, 3, 4, 5, 6, 7, 8];
      var rng = function () { return 0; };
      var a = L.shuffle(orig, rng);
      var b = L.shuffle(orig, rng);
      eq(orig.length, 8, '原数组长度不变');
      eq(orig[0], 1, '原数组未被修改');
      eq(JSON.stringify(a), JSON.stringify(b), '同一 rng 结果可复现');
      var sorted = a.slice().sort(function (x, y) { return x - y; });
      eq(JSON.stringify(sorted), JSON.stringify(orig), '结果为同一集合的重排');
    });
    T('测验组成（FR-3.1）：本单元全题 + min(3,可用) 交错题，无重复', function () {
      var unit = [];
      for (var i = 0; i < 15; i++) { unit.push(qSingle('u-q' + i, 0)); }
      var pool = [];
      for (var j = 0; j < 5; j++) { pool.push(qSingle('p-q' + j, 0)); }
      var res = L.buildQuizQuestions(unit, pool, function () { return 0.42; });
      eq(res.questions.length, 18, '15+3=18 题');
      eq(res.interleavedCount, 3, '交错 3 题');
      var ids = {};
      for (var k = 0; k < res.questions.length; k++) {
        assert(!ids[res.questions[k].id], '无重复题');
        ids[res.questions[k].id] = true;
      }
      var res2 = L.buildQuizQuestions(unit, pool.slice(0, 2), function () { return 0.42; });
      eq(res2.questions.length, 17, '交错不足 3 则全抽');
      var res3 = L.buildQuizQuestions(unit, [], function () { return 0.42; });
      eq(res3.questions.length, 15, '无已通过单元时只有本单元题');
      eq(res3.interleavedCount, 0, '交错计数为 0');
    });

    /* —— 日期工具 —— */
    T('日期加减跨月跨年正确', function () {
      eq(L.addDays('2026-08-30', 3), '2026-09-02', '跨月');
      eq(L.addDays('2026-01-31', 1), '2026-02-01', '跨月');
      eq(L.addDays('2025-12-31', 1), '2026-01-01', '跨年');
      eq(L.addDays('2026-08-15', 0), '2026-08-15', '加 0 天');
    });
    T('todayStr 输出 YYYY-MM-DD 格式', function () {
      var t = L.todayStr(new Date(2026, 7, 9, 15, 30, 45));
      eq(t, '2026-08-09', '本地日期格式化');
    });

    /* —— 复习队列状态机（FR-4 全分支） —— */
    T('错题入队：stage=1 due=明天', function () {
      var q = L.enqueueReview([], 'q1', 'p1-u05', '2026-08-10');
      eq(q.length, 1, '入队 1 条');
      eq(q[0].stage, 1, 'stage=1');
      eq(q[0].due, '2026-08-11', 'due=明天');
    });
    T('重复入队去重（ER-8）：更新而非新增', function () {
      var q = L.enqueueReview([], 'q1', 'p1-u05', '2026-08-10');
      q = L.reviewAnswer(q, 'q1', 'p1-u05', true, '2026-08-11').queue;  // stage1→2
      q = L.enqueueReview(q, 'q1', 'p1-u05', '2026-08-15');             // 再次答错入队
      eq(q.length, 1, '仍只有 1 条');
      eq(q[0].stage, 1, '重置为 stage=1');
      eq(q[0].due, '2026-08-16', 'due 更新为明天');
    });
    T('复习答对：stage1→2(+3天)，stage2→3(+7天)，stage3→毕业移出', function () {
      var q = L.enqueueReview([], 'q1', 'p1-u05', '2026-08-10');   // stage1 due 08-11
      var r1 = L.reviewAnswer(q, 'q1', 'p1-u05', true, '2026-08-11');
      eq(r1.queue[0].stage, 2, '升到 stage2');
      eq(r1.queue[0].due, '2026-08-14', '+3天');
      var r2 = L.reviewAnswer(r1.queue, 'q1', 'p1-u05', true, '2026-08-14');
      eq(r2.queue[0].stage, 3, '升到 stage3');
      eq(r2.queue[0].due, '2026-08-21', '+7天');
      var r3 = L.reviewAnswer(r2.queue, 'q1', 'p1-u05', true, '2026-08-21');
      eq(r3.queue.length, 0, '毕业移出队列');
      eq(r3.graduated, true, '标记毕业');
    });
    T('复习答错：任意 stage 重置 stage=1 due=明天', function () {
      var q = [{ qid: 'q1', unit: 'p1-u05', stage: 3, due: '2026-08-21' }];
      var r = L.reviewAnswer(q, 'q1', 'p1-u05', false, '2026-08-12');
      eq(r.queue[0].stage, 1, '重置 stage1');
      eq(r.queue[0].due, '2026-08-13', 'due 明天');
    });
    T('队列中不存在的题：答错入队，答对忽略', function () {
      var r1 = L.reviewAnswer([], 'qx', 'p1-u05', false, '2026-08-10');
      eq(r1.queue.length, 1, '答错自动入队');
      var r2 = L.reviewAnswer([], 'qx', 'p1-u05', true, '2026-08-10');
      eq(r2.queue.length, 0, '答对不产生条目');
    });

    /* —— 到期判定（FR-4.1 / ER-7） —— */
    T('到期判定：due ≤ 今天即到期，含过去日期（ER-7），按 due 排序', function () {
      var queue = [
        { qid: 'a', unit: 'u', stage: 1, due: '2026-08-10' },
        { qid: 'b', unit: 'u', stage: 1, due: '2026-08-05' },
        { qid: 'c', unit: 'u', stage: 1, due: '2026-08-20' }
      ];
      var due = L.dueItems(queue, '2026-08-10');
      eq(due.length, 2, '到期 2 题（未来不计）');
      eq(due[0].qid, 'b', '过去的先排（不崩溃）');
      eq(due[1].qid, 'a', '今天到期排第二');
      eq(L.isDue({ due: '2026-08-10' }, '2026-08-10'), true, '等于今天算到期');
      eq(L.isDue({ due: '2026-08-11' }, '2026-08-10'), false, '明天未到期');
    });

    /* —— 单元状态派生 —— */
    T('状态颜色映射：未解锁/学习中/待巩固/已掌握 四色', function () {
      eq(L.unitColor('new'), 'gray', '灰');
      eq(L.unitColor('learning'), 'blue', '蓝');
      eq(L.unitColor('passed'), 'yellow', '黄');
      eq(L.unitColor('mastered'), 'green', '绿');
    });
    T('解锁规则（FR-1.3）：order=1 默认解锁，前一单元通过后解锁下一单元', function () {
      var units = [{ id: 'u1', order: 1 }, { id: 'u2', order: 2 }, { id: 'u3', order: 3 }];
      eq(L.isUnlocked(units, {}, 'u1'), true, '首个默认解锁');
      eq(L.isUnlocked(units, {}, 'u2'), false, '前未通过则锁定');
      var prog = { u1: { status: 'passed' } };
      eq(L.isUnlocked(units, prog, 'u2'), true, 'u1 通过解锁 u2');
      eq(L.isUnlocked(units, prog, 'u3'), false, 'u2 未通过 u3 仍锁定');
      var prog2 = { u1: { status: 'mastered' }, u2: { status: 'passed' } };
      eq(L.isUnlocked(units, prog2, 'u3'), true, 'mastered 同样视为已通过');
    });
    T('回访到期（FR-4.4）：已通过+未完成+到期日≤今天', function () {
      var p = { status: 'passed', passedAt: '2026-08-07', revisitDue: '2026-08-10', revisitDone: false };
      eq(L.revisitDue(p, '2026-08-09'), false, '未到期');
      eq(L.revisitDue(p, '2026-08-10'), true, '第 3 天到期');
      eq(L.revisitDue(p, '2026-08-25'), true, '过期仍到期（ER-7）');
      eq(L.revisitDue({ status: 'passed', revisitDone: true, revisitDue: '2026-08-01' }, '2026-08-10'), false, '已完成不再到期');
      eq(L.revisitDue({ status: 'learning' }, '2026-08-10'), false, '未通过单元无回访');
      eq(L.revisitDue(null, '2026-08-10'), false, '无记录不回访');
    });

    /* —— 持久化与导出导入（FR-5.4 / FR-5.5 / ER-4 / ER-5） —— */
    T('导出→新存储导入 往返一致（含复习队列与统计）', function () {
      var st1 = TPStore.createStore(TPStore.createMemoryStorage());
      st1.mutate(function (s) {
        s.units['p1-u05'] = { status: 'passed', passedAt: '2026-08-09', revisitDue: '2026-08-12', revisitDone: false };
        s.queue.push({ qid: 'p1-u05-q03', unit: 'p1-u05', stage: 2, due: '2026-08-12' });
        s.stats.perKp['suited-vs-offsuit'] = { a: 10, c: 8 };
      });
      var text = st1.exportJSON();
      var parsed = JSON.parse(text);
      eq(parsed.exportVersion, 1, '导出含 exportVersion:1');
      var st2 = TPStore.createStore(TPStore.createMemoryStorage());
      st2.importJSON(text);
      var s2 = st2.getState();
      eq(s2.units['p1-u05'].status, 'passed', '单元状态恢复');
      eq(s2.queue.length, 1, '队列恢复');
      eq(s2.queue[0].stage, 2, 'stage 保留');
      eq(s2.stats.perKp['suited-vs-offsuit'].c, 8, '统计恢复');
    });
    T('非法导入报错且不污染现有数据（ER-5）：坏 JSON / 版本不符 / 缺字段', function () {
      var st = TPStore.createStore(TPStore.createMemoryStorage());
      st.mutate(function (s) { s.units['p1-u05'] = { status: 'learning' }; });
      var before = st.exportJSON();
      var badInputs = [
        '{not json',
        JSON.stringify({ exportVersion: 2, units: {}, queue: [], stats: { perUnit: {}, perKp: {}, perQuestion: {} }, attempts: [] }),
        JSON.stringify({ exportVersion: 1 }),
        JSON.stringify({ exportVersion: 1, units: {}, queue: 'x', stats: { perUnit: {}, perKp: {}, perQuestion: {} }, attempts: [] })
      ];
      for (var i = 0; i < badInputs.length; i++) {
        var threw = false;
        try { st.importJSON(badInputs[i]); } catch (e) { threw = true; }
        assert(threw, '第 ' + (i + 1) + ' 个非法输入应抛错');
      }
      eq(st.exportJSON(), before, '现有数据未被污染');
    });
    T('存储内容损坏时表现为全新安装（ER-4），不崩溃', function () {
      var storage = TPStore.createMemoryStorage();
      storage.setItem('tpoker.v1', '{broken!!!');
      var st = TPStore.createStore(storage);
      var s = st.getState();
      eq(s.exportVersion, 1, '默认状态版本');
      eq(Object.keys(s.units).length, 0, '无单元记录');
      eq(s.queue.length, 0, '队列空');
    });
    T('多存储互不干扰', function () {
      var a = TPStore.createStore(TPStore.createMemoryStorage());
      var b = TPStore.createStore(TPStore.createMemoryStorage());
      a.mutate(function (s) { s.units['x'] = { status: 'learning' }; });
      eq(Object.keys(b.getState().units).length, 0, 'b 不受 a 影响');
    });

    /* —— 范围表矩阵数学（TPRanges.math）与范围题判分（v2.0） —— */
    if (TPRanges) {
      var M = TPRanges.math;
      T('范围矩阵：对角线对子、上三角同花、下三角非同花', function () {
        eq(M.handAt(0, 0), 'AA', '对角线 AA');
        eq(M.handAt(0, 1), 'AKs', '上三角同花');
        eq(M.handAt(1, 0), 'AKo', '下三角非同花');
        eq(M.handAt(12, 12), '22', '右下角 22');
        eq(M.handAt(4, 10), 'T4s', 'T4s 同花');
        eq(M.handAt(10, 4), 'T4o', 'T4o 非同花');
      });
      T('parseHand：规范形转换（小写/无序容忍）与非法输入', function () {
        eq(M.parseHand('Aks'), 'AKs', '小写 s 归一');
        eq(M.parseHand('kao'), 'AKo', '无序字母归一高位在前');
        eq(M.parseHand('22'), '22', '对子');
        eq(M.parseHand('t9o'), 'T9o', 'T9o');
        eq(M.parseHand('ZZ'), null, '非法点数');
        eq(M.parseHand('AAs'), null, '对子带 s 非法');
        eq(M.parseHand('AK'), null, '非对子缺 s/o');
        eq(M.parseHand('AAo'), null, '对子带 o 非法');
      });
      T('combos：对子 6 / 同花 4 / 非同花 12，169 类合计 1326', function () {
        eq(M.combos('AA'), 6, '对子 6');
        eq(M.combos('AKs'), 4, '同花 4');
        eq(M.combos('AKo'), 12, '非同花 12');
        var total = 0;
        for (var r = 0; r < 13; r++) {
          for (var c = 0; c < 13; c++) { total += M.combos(M.handAt(r, c)); }
        }
        eq(total, 1326, '13 对子×6 + 78 同花×4 + 78 非同花×12 = 1326');
      });
      T('expand：169 格完整覆盖、default 兜底、组合数与占比汇总', function () {
        var spec = {
          actions: [
            { key: 'raise', label: '加注', hands: ['AA', 'AKs', 'AKo', 'J8s'] },
            { key: 'fold', label: '弃牌', 'default': true }
          ]
        };
        var d = M.expand(spec);
        eq(d.cells.length, 169, '169 格');
        eq(d.byAction.raise.combos, 26, '显式组合数 6+4+12+4');
        eq(d.byAction.raise.pct, 2, '26/1326≈2.0%');
        eq(d.byAction.fold.combos, 1300, 'fold 兜底 1326-26');
        eq(d['default'], 'fold', 'default 记录');
        var seen = {};
        for (var i = 0; i < d.cells.length; i++) {
          var cell = d.cells[i];
          assert(cell.action === 'raise' || cell.action === 'fold', '每格行动合法');
          assert(!seen[cell.hand], '格不重复：' + cell.hand);
          seen[cell.hand] = true;
        }
      });
      T('expand：多行动不重叠，显式 default 也列牌时视为有色行动', function () {
        var spec = {
          actions: [
            { key: 'call', label: '跟注', hands: ['QQ'] },
            { key: 'raise', label: '3bet', hands: ['AA', 'KK'] },
            { key: 'fold', label: '弃牌', 'default': true }
          ]
        };
        var d = M.expand(spec);
        eq(d.byAction.call.combos, 6, 'call 6');
        eq(d.byAction.raise.combos, 12, 'raise 12');
        eq(d.byAction.fold.combos, 1308, 'fold 兜底');
      });
      T('expand：非法牌型 / 跨行动重复 / 无 default 均抛错', function () {
        var bad1 = { actions: [{ key: 'a', label: 'a', hands: ['XX'] }, { key: 'b', label: 'b', 'default': true }] };
        var bad2 = { actions: [{ key: 'a', label: 'a', hands: ['AA'] }, { key: 'b', label: 'b', hands: ['AA'], 'default': true }] };
        var bad3 = { actions: [{ key: 'a', label: 'a', hands: ['AA'] }, { key: 'b', label: 'b' }] };
        var bad4 = { actions: [{ key: 'a', label: 'a', hands: ['AA'], 'default': true }, { key: 'b', label: 'b', 'default': true }] };
        var specs = [bad1, bad2, bad3, bad4];
        for (var i = 0; i < specs.length; i++) {
          var threw = false;
          try { M.expand(specs[i]); } catch (e) { threw = true; }
          assert(threw, '第 ' + (i + 1) + ' 个非法 RangeSpec 应抛错');
        }
      });
      T('范围题判分（v2.0）：行动 key 完全一致才算对', function () {
        var q = { id: 'r1', type: 'range', answer: 'raise', kp: 'rfi-range' };
        eq(L.grade(q, 'raise'), true, '选 raise 对');
        eq(L.grade(q, 'fold'), false, '选 fold 错');
        eq(L.grade(q, null), false, '未选择错');
        eq(L.grade(q, ['raise']), false, '数组形式不匹配');
      });
    }

    /* —— 执行 —— */
    var lines = [];
    var passed = 0;
    var failed = 0;
    for (var i = 0; i < tests.length; i++) {
      try {
        tests[i].fn();
        passed++;
        lines.push('PASS  ' + tests[i].name);
      } catch (e) {
        failed++;
        lines.push('FAIL  ' + tests[i].name + '  =>  ' + (e && e.message ? e.message : e));
      }
    }
    return { total: tests.length, passed: passed, failed: failed, lines: lines };
  }

  return { run: run };
});
