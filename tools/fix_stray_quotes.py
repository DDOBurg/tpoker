#!/usr/bin/env python3
"""一次性修复：JSON 字符串值内部的直双引号 -> 中文全角引号（成对）。

用法：uv run --no-project python tools/fix_stray_quotes.py data/p1-u13.json [...]
"""
import io
import json
import sys

BS = chr(92)


def fix(path):
    t = io.open(path, encoding="utf-8").read()
    out = []
    i = 0
    n = len(t)
    in_str = False
    alt = True
    fixed_n = 0
    while i < n:
        ch = t[i]
        if not in_str:
            out.append(ch)
            if ch == '"':
                in_str = True
            i += 1
            continue
        if ch == BS:
            out.append(ch)
            if i + 1 < n:
                out.append(t[i + 1])
            i += 2
            continue
        if ch == '"':
            j = i + 1
            while j < n and t[j] in " \t\r\n":
                j += 1
            nxt = t[j] if j < n else ""
            if nxt in (",", ":", "}", "]", ""):
                out.append('"')
                in_str = False
            else:
                out.append("\u201c" if alt else "\u201d")
                alt = not alt
                fixed_n += 1
            i += 1
            continue
        out.append(ch)
        i += 1
    s = "".join(out)
    json.loads(s)
    io.open(path, "w", encoding="utf-8", newline="\n").write(s)
    print(f"{path}: stray quotes fixed {fixed_n}, JSON OK")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        fix(p)
