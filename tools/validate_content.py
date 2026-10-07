#!/usr/bin/env python3
"""TPoker 内容静态校验（T1）：实现 DR-1~DR-4 全部可自动化的约束。

校验对象：data/units_index.json 与其列出的全部单元文件。
默认模式校验"现有单元"并报告 178 题总进度（部分交付时全绿即 exit 0）；
加 --strict 时要求 12 单元 178 题全部齐备（DR-1 总量精确检查）。

exit 0 = 全部通过；exit 1 = 有错误，逐条列出。
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")

# DR-1 题量表：order -> (标题, 题目数)。v2.0：u03-u12 加交互式范围题，新增 u13-u16 进阶理论单元。
EXPECTED = {
    1: ("起手牌与位置", 12),
    2: ("底池赔率与隐含赔率", 15),
    3: ("UTG/MP 开池", 20),
    4: ("CO 开池", 16),
    5: ("BTN 开池 @100bb", 20),
    6: ("SB 策略", 16),
    7: ("BB 防守", 20),
    8: ("3-bet 价值范围", 16),
    9: ("3-bet 诈唬与阻挡牌", 20),
    10: ("面对 3-bet 的应对", 20),
    11: ("翻前尺度", 17),
    12: ("阶段综合测试", 33),
    13: ("最低防守频率与抓诈", 12),
    14: ("权益与权益实现", 12),
    15: ("SPR 与筹码深度", 12),
    16: ("阻挡牌与解除阻挡（进阶）", 12),
}
EXPECTED_TOTAL = 273

UNIT_ID_RE = re.compile(r"^p1-u(\d{2})$")
RULE_ID_RE = re.compile(r"^p1-u(\d{2})-R(\d+)$")
Q_ID_RE = re.compile(r"^p1-u(\d{2})-q(\d{2})$")
HAND_RE = re.compile(r"[AKQJT2-9][♠♥♦♣]")
HAND_CLASS_RE = re.compile(r"^([AKQJT2-9])([AKQJT2-9])([so])?$")
POSITION_RE = re.compile(r"(?<![A-Za-z])(UTG|MP|CO|BTN|SB|BB)(?![A-Za-z])")
KP_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
RN_RE = re.compile(r"R\d+")


def valid_hand_class(h):
    """169 类牌型记号：AA 对子（无后缀且两点相同）/ AKs 同花 / AKo 非同花。"""
    if not isinstance(h, str):
        return False
    m = HAND_CLASS_RE.match(h)
    if not m:
        return False
    r1, r2, suf = m.group(1), m.group(2), m.group(3)
    if suf is None:
        return r1 == r2
    return r1 != r2

errors = []
warnings = []

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


def check_unit_id(uid, where):
    m = UNIT_ID_RE.match(uid or "")
    if not m:
        err(f"{where}: id 格式错误：{uid!r}（应为 p1-uNN）")
        return None
    return int(m.group(1))


def validate_ranges(u, where):
    """v2.0：lesson.advanced/pitfalls/sources 与 ranges[] 结构校验。
    返回 {specId: set(action keys)} 供范围题校验；无 ranges 时返回 {}。"""
    lesson = u.get("lesson") or {}
    spec_keys = {}

    advanced = lesson.get("advanced")
    if advanced is not None:
        if not isinstance(advanced, list) or not (0 <= len(advanced) <= 4):
            err(f"{where}: lesson.advanced 须为 ≤4 条的数组")
        else:
            for i, a in enumerate(advanced):
                if not isinstance(a, dict) or not isinstance(a.get("title"), str) or not a["title"].strip() \
                        or not isinstance(a.get("text"), str) or not a["text"].strip():
                    err(f"{where}: lesson.advanced 第{i + 1}条须含非空 title/text")

    pitfalls = lesson.get("pitfalls")
    if pitfalls is not None:
        if not isinstance(pitfalls, list) or not (0 <= len(pitfalls) <= 4) \
                or not all(isinstance(t, str) and t.strip() for t in pitfalls):
            err(f"{where}: lesson.pitfalls 须为 ≤4 条非空字符串数组")

    sources = lesson.get("sources")
    if sources is not None:
        if not isinstance(sources, list) or not (0 <= len(sources) <= 6) \
                or not all(isinstance(s, dict) and isinstance(s.get("name"), str) and s["name"].strip() for s in sources):
            err(f"{where}: lesson.sources 须为 ≤6 条 {{name, url?, note?}} 数组")
        else:
            for s in sources:
                url = s.get("url")
                if url is not None and (not isinstance(url, str) or not url.startswith(("http://", "https://"))):
                    err(f"{where}: lesson.sources 的 url 须以 http(s):// 开头，实际 {url!r}")

    ranges = u.get("ranges")
    if ranges is None:
        return spec_keys
    if not isinstance(ranges, list) or not ranges:
        err(f"{where}: ranges 若非省略须为非空数组")
        return spec_keys

    seen_ids = set()
    for i, spec in enumerate(ranges):
        sw = f"{where} ranges[{i}]"
        if not isinstance(spec, dict):
            err(f"{sw}: 必须是对象")
            continue
        sid = spec.get("id")
        if not isinstance(sid, str) or not sid.strip():
            err(f"{sw}: id 非空约束失败")
            sid = None
        elif sid in seen_ids:
            err(f"{sw}: id 重复 {sid}")
        seen_ids.add(sid)
        if not isinstance(spec.get("title"), str) or not spec["title"].strip():
            err(f"{sw}: title 非空约束失败")

        if spec.get("type") == "table":
            cols = spec.get("columns")
            rows = spec.get("rows")
            if not isinstance(cols, list) or not cols or not all(isinstance(c, str) and c.strip() for c in cols):
                err(f"{sw}(table): columns 须为非空字符串数组")
            if not isinstance(rows, list) or not rows \
                    or not all(isinstance(r, list) and len(r) == len(cols or []) for r in rows):
                err(f"{sw}(table): rows 须为与 columns 等长的数组")
            continue

        spot = spec.get("spot")
        if not isinstance(spot, str) or not spot.strip():
            err(f"{sw}: spot（局面说明）非空约束失败")
        actions = spec.get("actions")
        if not isinstance(actions, list) or len(actions) < 2:
            err(f"{sw}: actions 至少 2 个")
            continue
        keys = set()
        defaults = 0
        claimed = set()
        for a in actions:
            if not isinstance(a, dict) or not isinstance(a.get("key"), str) or not a["key"].strip() \
                    or not isinstance(a.get("label"), str) or not a["label"].strip():
                err(f"{sw}: 行动须含非空 key/label")
                continue
            if a["key"] in keys:
                err(f"{sw}: 行动 key 重复 {a['key']}")
            keys.add(a["key"])
            if a.get("default"):
                defaults += 1
            hands = a.get("hands") or []
            if not isinstance(hands, list):
                err(f"{sw}/{a['key']}: hands 须为数组")
                continue
            for h in hands:
                if not valid_hand_class(h):
                    err(f"{sw}/{a['key']}: 非法牌型 {h!r}（应为 AA/AKs/AKo 这类 169 类记号）")
                elif h in claimed:
                    err(f"{sw}: 牌型 {h} 跨行动重复")
                claimed.add(h)
        if defaults != 1:
            err(f"{sw}: 必须且只能有一个 default 行动（实际 {defaults}）")
        if sid:
            spec_keys[sid] = keys
        if not spec.get("note"):
            warn(f"{sw}: 建议补充 note（读表要点）")
        if not spec.get("source"):
            warn(f"{sw}: 建议补充 source（参考来源）")
    return spec_keys


def validate_unit(u, fname):
    where = f"[{fname}]"
    uid = u.get("id")
    num = check_unit_id(uid, where)
    if num is not None and num != u.get("order"):
        err(f"{where}: id {uid} 与 order {u.get('order')} 不一致")

    if u.get("phase") != 1:
        err(f"{where}: phase 必须为 1，实际 {u.get('phase')!r}")

    order = u.get("order")
    if not isinstance(order, int) or not (1 <= order <= 16):
        err(f"{where}: order 必须为 1–16 的整数，实际 {order!r}")
    elif order in EXPECTED:
        want_title, want_n = EXPECTED[order]
        if u.get("title") != want_title:
            err(f"{where}: order={order} 标题应为《{want_title}》，实际 {u.get('title')!r}（DR-1）")
        qn = len(u.get("questions") or [])
        if qn != want_n:
            err(f"{where}: order={order} 题量应为 {want_n}（DR-1），实际 {qn}")

    title = u.get("title")
    if not isinstance(title, str) or not title.strip():
        err(f"{where}: title 非空约束失败")
    elif len(title) > 30:
        err(f"{where}: title 超过 30 字：{title!r}")

    lesson = u.get("lesson") or {}
    concept = lesson.get("concept")
    if not isinstance(concept, str) or not (50 <= len(concept) <= 300):
        err(f"{where}: lesson.concept 须为 50–300 字，实际 {len(concept) if isinstance(concept, str) else 'N/A'}")

    rules = lesson.get("rules")
    rule_ids = set()
    if not isinstance(rules, list) or not (3 <= len(rules) <= 6):
        err(f"{where}: lesson.rules 须 ≥3 且 ≤6 条，实际 {len(rules) if isinstance(rules, list) else 'N/A'}")
    else:
        for i, r in enumerate(rules):
            rid = r.get("id") if isinstance(r, dict) else None
            m = RULE_ID_RE.match(rid or "")
            if not m or m.group(1) != f"{num:02d}":
                err(f"{where}: 规则 {i+1} 的 id 格式错误：{rid!r}（应为 {uid}-R{n}）")
            elif rid in rule_ids:
                err(f"{where}: 规则 id 重复：{rid}")
            else:
                rule_ids.add(rid)
            if not isinstance(r.get("text"), str) or not r["text"].strip():
                err(f"{where}: 规则 {rid} 的 text 为空")

    example = lesson.get("example")
    if not isinstance(example, str) or not example.strip():
        err(f"{where}: lesson.example 非空约束失败")

    spec_keys = validate_ranges(u, where)

    questions = u.get("questions")
    if not isinstance(questions, list) or not questions:
        err(f"{where}: questions 必须为非空数组")
        return

    seen_q = set()
    covers = {}
    for i, q in enumerate(questions):
        qw = f"{where} 第{i+1}题"
        qid = q.get("id")
        m = Q_ID_RE.match(qid or "")
        if not m or m.group(1) != f"{num:02d}":
            err(f"{qw}: question.id 格式错误：{qid!r}（应为 {uid}-qNN）")
        if qid in seen_q:
            err(f"{qw}: 题号重复 {qid}")
        seen_q.add(qid)

        qtype = q.get("type")
        if qtype not in ("single", "multi", "range"):
            err(f"{qw}: type 必须为 single/multi/range，实际 {qtype!r}")

        scenario = q.get("scenario")
        if not isinstance(scenario, str) or not scenario.strip():
            err(f"{qw}: scenario 为空")
        else:
            if not POSITION_RE.search(scenario):
                err(f"{qw}: scenario 缺少位置信息（UTG/MP/CO/BTN/SB/BB）")
            if "bb" not in scenario:
                err(f"{qw}: scenario 缺少有效筹码深度（如 100bb）")
            # 具体手牌要求：u03–u12（翻前范围单元）为强制；u13–u16（理论单元）放宽为警告
            if qtype == "single" and not HAND_RE.search(scenario):
                msg = f"{qw}: 单选题 scenario 缺少具体手牌"
                if isinstance(order, int) and order >= 13:
                    warn(msg + "（理论题可接受）")
                else:
                    err(msg)

        options = q.get("options")
        answer = q.get("answer")
        if qtype == "range":
            spot = q.get("spot")
            if not isinstance(spot, str) or not spot.strip():
                err(f"{qw}: 范围题须含 spot（引用本单元 ranges[].id）")
            elif spot not in spec_keys:
                err(f"{qw}: spot {spot!r} 未对应本单元任何 ranges（或该 spec 校验失败）")
            hand = q.get("hand")
            if not isinstance(hand, str) or not valid_hand_class(hand):
                err(f"{qw}: 范围题 hand 须为 169 类记号（如 J8o），实际 {hand!r}")
            if not isinstance(answer, str):
                err(f"{qw}: 范围题 answer 必须是行动 key 字符串，实际 {answer!r}")
            elif isinstance(spot, str) and spot in spec_keys and answer not in spec_keys[spot]:
                err(f"{qw}: answer {answer!r} 不在范围表 {spot} 的行动中")
        if qtype in ("single", "multi") and (not isinstance(options, list) or not all(isinstance(o, str) and o.strip() for o in options)):
            err(f"{qw}: options 必须为非空字符串数组")
        elif qtype in ("single", "multi"):
            if qtype == "single" and not (2 <= len(options) <= 4):
                err(f"{qw}: 单选题选项数须 ≥2 且 ≤4，实际 {len(options)}")
            if qtype == "multi":
                if len(options) != 8:
                    err(f"{qw}: 多选题必须为 8 个候选项，实际 {len(options)}（DR-2）")
                # 范围多选：候选项为具体手牌，则要求每一项都是手牌；
                # 陈述多选（如尺度/策略正误，DR-2 未覆盖）：候选项为文字陈述，不做手牌要求
                if any(HAND_RE.search(o) for o in options) and not all(HAND_RE.search(o) for o in options):
                    err(f"{qw}: 范围多选题的候选项须逐项标注具体手牌")
            if qtype == "single":
                if not isinstance(answer, int) or not (0 <= answer < len(options)):
                    err(f"{qw}: 单选 answer 为选项索引且须在范围内，实际 {answer!r}")
            else:
                if not isinstance(answer, list) or not all(isinstance(a, int) for a in answer):
                    err(f"{qw}: 多选 answer 必须为索引数组")
                else:
                    if not (1 <= len(answer) < 8):
                        err(f"{qw}: 多选答案项数须 ≥1 且 <8，实际 {len(answer)}（DR-2）")
                    if len(set(answer)) != len(answer):
                        err(f"{qw}: 多选 answer 含重复索引")
                    if options and any(a < 0 or a >= len(options) for a in answer):
                        err(f"{qw}: 多选 answer 索引越界")

        expl = q.get("explanation")
        if not isinstance(expl, str) or not expl.strip():
            err(f"{qw}: explanation 为空")
        else:
            ref_nums = set()
            for rid in q.get("ruleRefs") or []:
                mm = RULE_ID_RE.match(rid or "")
                if mm:
                    ref_nums.add(mm.group(2))
            cited = {n for n in ref_nums if re.search(rf"\bR{n}\b", expl)}
            if not RN_RE.search(expl) or not cited:
                err(f"{qw}: explanation 未引用本单元规则编号（R{{n}} 须出现，DR-2）")

        refs = q.get("ruleRefs")
        if not isinstance(refs, list) or len(refs) < 1:
            err(f"{qw}: ruleRefs 须 ≥1 项")
        else:
            for rid in refs:
                if rid not in rule_ids:
                    err(f"{qw}: ruleRefs 引用了不存在的规则 {rid!r}")

        kp = q.get("kp")
        if not isinstance(kp, str) or not kp.strip():
            err(f"{qw}: kp 为空")
        elif not KP_RE.match(kp):
            err(f"{qw}: kp 须为英文小写短横线风格，实际 {kp!r}")

        # DR-3 C3：第 12 单元综合题须有 covers 字段标注覆盖单元
        if order == 12:
            cov = q.get("covers")
            if not isinstance(cov, str) or not UNIT_ID_RE.match(cov):
                err(f"{qw}: 第 12 单元综合题须用 covers 字段标注覆盖单元（如 p1-u03）")
            else:
                covers.setdefault(cov, 0)
                covers[cov] += 1


def main():
    strict = "--strict" in sys.argv
    idx_path = os.path.join(DATA_DIR, "units_index.json")
    if not os.path.exists(idx_path):
        err("缺少 data/units_index.json")
        report(strict)
        return 1 if errors else 0

    with open(idx_path, encoding="utf-8") as f:
        try:
            index = json.load(f)
        except json.JSONDecodeError as e:
            err(f"units_index.json 不是合法 JSON：{e}")
            report(strict)
            return 1

    if not isinstance(index, list) or not index:
        err("units_index.json 必须为非空数组")
        report(strict)
        return 1

    orders = []
    all_scenarios = {}
    total_q = 0
    seen_unit_ids = set()

    for entry in index:
        if not isinstance(entry, dict):
            err(f"index 条目不是对象：{entry!r}")
            continue
        uid = entry.get("id")
        where = f"[index:{uid}]"
        num = check_unit_id(uid, where)
        if uid in seen_unit_ids:
            err(f"{where}: index 中单元 id 重复")
        seen_unit_ids.add(uid)
        order = entry.get("order")
        if isinstance(order, int):
            orders.append(order)
            if num is not None and num != order:
                err(f"{where}: index 中 id 与 order 不一致")
        else:
            err(f"{where}: order 缺失或非整数")
        if not isinstance(entry.get("title"), str) or not entry["title"].strip():
            err(f"{where}: title 为空")
        if not isinstance(entry.get("file"), str) or not entry["file"].strip():
            err(f"{where}: file 字段缺失")
            continue
        fpath = os.path.join(DATA_DIR, entry["file"])
        if not os.path.exists(fpath):
            err(f"{where}: 数据文件不存在 {entry['file']}")
            continue
        with open(fpath, encoding="utf-8") as f:
            try:
                unit = json.load(f)
            except json.JSONDecodeError as e:
                err(f"{entry['file']}: 不是合法 JSON：{e}")
                continue
        if unit.get("id") != uid:
            err(f"{entry['file']}: 文件内 id {unit.get('id')!r} 与 index 的 {uid!r} 不一致")
        validate_unit(unit, entry["file"])
        total_q += len(unit.get("questions") or [])
        # DR-3 C4：跨单元查重。scenario + 手牌完全相同视为重复；
        # 多选题手牌在 options 中，因此 key = scenario + options 规范化
        for q in unit.get("questions") or []:
            parts = [re.sub(r"\s+", "", q.get("scenario", ""))]
            for o in q.get("options") or []:
                parts.append(re.sub(r"\s+", "", o))
            key = "|".join(parts)
            if key in all_scenarios:
                err(f"重复题目：{entry['file']} 的 {q.get('id')} 与 {all_scenarios[key]} 的 scenario+手牌 完全相同（DR-3 C4）")
            else:
                all_scenarios[key] = f"{entry['file']} 的 {q.get('id')}"

    # order 连续（在已交付单元中连续且无重复；缺号在 coverage 中提示）
    if len(set(orders)) != len(orders):
        err(f"index 中 order 重复：{sorted(orders)}")
    orders_sorted = sorted(orders)
    if orders_sorted and orders_sorted != list(range(orders_sorted[0], orders_sorted[0] + len(orders_sorted))):
        err(f"index 中 order 不连续：{orders_sorted}")

    # 第 12 单元覆盖检查（DR-3 C3）
    u12_file = next((e["file"] for e in index if isinstance(e, dict) and e.get("order") == 12 and e.get("file")), None)
    if u12_file:
        with open(os.path.join(DATA_DIR, u12_file), encoding="utf-8") as f:
            u12 = json.load(f)
        cov = {}
        for q in u12.get("questions") or []:
            c = q.get("covers")
            if isinstance(c, str):
                cov[c] = cov.get(c, 0) + 1
        for want_order in range(1, 17):
            if want_order == 12:
                continue
            want_id = f"p1-u{want_order:02d}"
            if cov.get(want_id, 0) < 2:
                err(f"第 12 单元综合测试未覆盖 {want_id} ≥2 题（实际 {cov.get(want_id, 0)} 题，DR-3 C3）")

    # DR-1 总进度
    missing = [o for o in EXPECTED if o not in orders]
    print(f"交付覆盖：单元 {len(orders)}/12，题目 {total_q}/{EXPECTED_TOTAL}")
    if missing:
        print(f"  未交付单元 order：{missing}（v1 本次仅交付 BTN 示例单元）")
    if strict:
        if total_q != EXPECTED_TOTAL or len(orders) != 16:
            err(f"--strict：DR-1 总量须恰为 {EXPECTED_TOTAL} 题、16 单元，实际 {total_q} 题、{len(orders)} 单元")

    report(strict)
    return 1 if errors else 0


def report(strict):
    print()
    for w in warnings:
        print(f"警告：{w}")
    if errors:
        print(f"校验失败，共 {len(errors)} 个错误：")
        for i, e in enumerate(errors, 1):
            print(f"  {i}. {e}")
    else:
        mode = "（--strict 模式）" if strict else "（现有单元模式，全部通过）"
        print(f"校验通过 {mode}：schema、ID 格式、题量表、引用完整性、无重复题、讲解规则引用、order 连续、第12单元覆盖检查 全部满足。")
    print()


if __name__ == "__main__":
    sys.exit(main())
