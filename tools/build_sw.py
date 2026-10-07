#!/usr/bin/env python3
"""扫描项目静态文件，重写 sw.js 的 ASSETS 段（带 ASSETS-BEGIN/END 标记）。

用法：
  python tools/build_sw.py            # 仅按磁盘现状刷新 ASSETS 清单
  python tools/build_sw.py --bump     # 刷新清单并把 VERSION 的补丁位 +1
  python tools/build_sw.py --bump minor

配套流程：改内容 -> 本脚本 --bump -> 推送 -> 手机端联网打开自动提示更新。
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SW_PATH = os.path.join(ROOT, "sw.js")

STATIC_FILES = [
    "index.html",
    "css/app.css",
    "js/logic.js",
    "js/store.js",
    "js/ranges.js",
    "js/app.js",
    "manifest.webmanifest",
    "icon-192.png",
    "icon-512.png",
    "apple-touch-icon.png",
]

ASSETS_RE = re.compile(
    r"(/\* ASSETS-BEGIN[^\n]*\*/\n)const ASSETS = \[[^\]]*\];\n(/\* ASSETS-END \*/)",
    re.S,
)
VERSION_RE = re.compile(r"const VERSION = 'v(\d+)\.(\d+)\.(\d+)';")


def collect_assets():
    assets = ["./", "./index.html"]
    for name in STATIC_FILES:
        if name == "index.html":
            continue
        path = os.path.join(ROOT, name)
        if os.path.exists(path):
            assets.append("./" + name.replace(os.sep, "/"))
        else:
            print(f"[警告] 静态文件缺失：{name}", file=sys.stderr)
    data_dir = os.path.join(ROOT, "data")
    if os.path.isdir(data_dir):
        for fname in sorted(os.listdir(data_dir)):
            if fname.endswith(".json"):
                assets.append("./data/" + fname)
    return assets


def bump_version(text, level):
    m = VERSION_RE.search(text)
    if not m:
        print("[错误] sw.js 中未找到 VERSION 常量", file=sys.stderr)
        sys.exit(1)
    major, minor, patch = (int(g) for g in m.groups())
    if level == "major":
        major, minor, patch = major + 1, 0, 0
    elif level == "minor":
        minor, patch = minor + 1, 0
    else:
        patch += 1
    new = f"const VERSION = 'v{major}.{minor}.{patch}';"
    return VERSION_RE.sub(new, text, count=1), f"v{major}.{minor}.{patch}"


def main():
    level = None
    for arg in sys.argv[1:]:
        if arg == "--bump":
            level = "patch"
        elif arg in ("--bump major", "--bump minor", "--bump patch"):
            level = arg.split()[1]
        elif arg in ("major", "minor", "patch") and "--bump" in sys.argv:
            level = arg
    if "--bump" in sys.argv and level is None:
        level = "patch"

    with open(SW_PATH, encoding="utf-8") as f:
        text = f.read()

    if level:
        text, new_ver = bump_version(text, level)
        print(f"VERSION -> {new_ver}")

    assets = collect_assets()
    lines = ["const ASSETS = ["]
    lines += ["  '" + a + "'," for a in assets]
    lines.append("];")
    block = "\\1" + "\n".join(lines) + "\n\\2"

    new_text, n = ASSETS_RE.subn(block, text, count=1)
    if n != 1:
        print("[错误] 未找到 ASSETS-BEGIN/END 标记，sw.js 结构被改动？", file=sys.stderr)
        sys.exit(1)

    with open(SW_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(new_text)
    print(f"ASSETS 已更新：{len(assets)} 项")


if __name__ == "__main__":
    main()
