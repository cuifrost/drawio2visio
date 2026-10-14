#!/usr/bin/env python3
"""按每图最长内容自适应尺寸，批量调用 scripts/convert.js 转 Visio。

尺寸规则（源自 templates/user-style-profile.json 的作图习惯）：
  宽度 W ≈ 汉字数×3.0 + 16 mm（全角计 1.0、半角计 0.55），下限 26mm、上限 80mm；
  高度：常规 10mm（0.394in）；矩阵页 8mm（0.315in，紧凑表格）。

用法:
  python3 scripts/batch_convert.py examples                    # 整目录
  python3 scripts/batch_convert.py examples/review-flow.drawio  # 指定文件
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MM_PER_IN = 25.4
sys.path.insert(0, str(ROOT))


def eff_len(text: str) -> float:
    """全角字符计 1.0，其余（ASCII/符号）计 0.55。"""
    return sum(1.0 if ord(ch) > 0x2E80 else 0.55 for ch in text)


def pick_sizes(stem: str, labels: list[str]) -> tuple[float, float]:
    eff = max((eff_len(t) for t in labels), default=0.0)
    w_in = min(max((3.0 * eff + 16.0) / MM_PER_IN, 26.0 / MM_PER_IN), 80.0 / MM_PER_IN)
    is_matrix = "矩阵" in stem
    h_in = 0.315 if is_matrix else 0.394
    if is_matrix:
        w_in = min(w_in, 1.2)
    return round(w_in, 3), h_in


def main(argv: list[str]) -> int:
    natural = "--natural" in argv
    argv = [a for a in argv if a != "--natural"]
    targets: list[Path] = []
    for a in argv:
        p = Path(a)
        if p.is_dir():
            targets.extend(sorted(p.glob("*.drawio")))
        elif p.suffix == ".drawio":
            targets.append(p)
        else:
            print(f"跳过（非 .drawio）: {a}")
    if not targets:
        print(__doc__)
        return 2

    ok = fail = 0
    # 尺寸唯一来源：生成器写出的 sizes.json（无则退回本地估算）
    for f in targets:
        sidecar = f.parent / "sizes.json"
        sizes = json.loads(sidecar.read_text(encoding="utf-8")) if sidecar.exists() else {}
        from src.parser import parse_drawio

        g = parse_drawio(str(f))
        labels = [n.text for n in g.nodes if n.text]
        if f.stem in sizes:
            w_in, h_in = sizes[f.stem]["w"], sizes[f.stem]["h"]
        else:
            w_in, h_in = pick_sizes(f.stem, labels)
        out = ROOT / "outputs" / f.stem
        cmd = ["node", str(ROOT / "scripts" / "convert.js"), str(f), "-o", str(out)]
        if natural:
            # 合并版：drawio 节点尺寸即 Visio 最终尺寸，按原尺寸出图
            cmd += ["--set", "forceSize=0"]
        else:
            cmd += ["--set", f"processWidth={w_in}", "--set", f"processHeight={h_in}"]
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
        if r.returncode == 0:
            ok += 1
            print(f"✓ {f.name}  →  {w_in}×{h_in} in")
        else:
            fail += 1
            print(f"✗ {f.name}\n{r.stderr.strip()[:400]}")
    print(f"完成: {ok} 成功 / {fail} 失败")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
