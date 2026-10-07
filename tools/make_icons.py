#!/usr/bin/env python3
"""生成 TPoker PWA 图标（纯标准库实现，无 PIL 依赖）。

用 zlib/struct 手写 PNG 编码；图案为绿色毛毡底 + 白色字母 T。
产出：icon-192.png（透明圆角）、icon-512.png（透明圆角）、apple-touch-icon.png（180，不透明）。
"""
import struct
import zlib
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BG = (18, 101, 62, 255)          # 毛毡绿 #12653e
BG_DARK = (13, 74, 45, 255)      # 底部加深
WHITE = (244, 247, 245, 255)


def write_png(path, width, height, pixels):
    """pixels: [ [ (r,g,b,a), ... ] * width ] * height"""
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter type 0
        for r, g, b, a in row:
            raw.extend((r, g, b, a))
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", path, os.path.getsize(path), "bytes")


def in_rounded_rect(x, y, size, radius):
    """点 (x,y) 是否在以 (0,0)-(size,size) 为界、圆角 radius 的圆角矩形内（含边界）。"""
    r = radius
    if r <= 0:
        return 0 <= x <= size and 0 <= y <= size
    # 四条直边区域
    if r <= x <= size - r and 0 <= y <= size:
        return True
    if 0 <= x <= size and r <= y <= size - r:
        return True
    # 四角圆弧
    for cx, cy in ((r, r), (size - r, r), (r, size - r), (size - r, size - r)):
        if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
            return True
    return False


def in_letter_t(x, y, size):
    """白色字母 T：横杠 + 竖杠（均以比例定义，视觉上居中偏上）。"""
    s = size
    bar = (0.20 * s <= x <= 0.80 * s) and (0.24 * s <= y <= 0.40 * s)
    stem = (0.43 * s <= x <= 0.57 * s) and (0.24 * s <= y <= 0.78 * s)
    return bar or stem


def make_icon(size, opaque):
    radius = int(size * 0.18)
    pixels = []
    for y in range(size):
        row = []
        for x in range(size):
            if in_letter_t(x + 0.5, y + 0.5, size):
                row.append(WHITE)
            elif in_rounded_rect(x + 0.5, y + 0.5, size, radius):
                # 底部轻微加深，增加层次
                row.append(BG_DARK if y > size * 0.72 else BG)
            else:
                row.append(BG if opaque else (0, 0, 0, 0))
        pixels.append(row)
    return pixels


def main():
    write_png(os.path.join(ROOT, "icon-192.png"), 192, 192, make_icon(192, opaque=False))
    write_png(os.path.join(ROOT, "icon-512.png"), 512, 512, make_icon(512, opaque=False))
    write_png(os.path.join(ROOT, "apple-touch-icon.png"), 180, 180, make_icon(180, opaque=True))


if __name__ == "__main__":
    main()
