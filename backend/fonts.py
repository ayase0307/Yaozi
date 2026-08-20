"""列出系統已安裝的字型家族名稱,給字幕樣式選單用。

用家族名(不是檔名)才能同時餵給瀏覽器 CSS 與 libass 的 Fontname,
預覽看到的字才會跟燒出來的一樣。列舉一次要幾百毫秒,整個行程只做一次。
"""

import json
import subprocess
import sys

_PS = (
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
    "Add-Type -AssemblyName System.Drawing;"
    "(New-Object System.Drawing.Text.InstalledFontCollection).Families"
    " | ForEach-Object { $_.Name } | ConvertTo-Json -Compress"
)

# 列舉不到時至少給幾個 Windows 一定有的,選單不會開天窗
FALLBACK = ["Microsoft JhengHei", "Microsoft YaHei", "Arial", "Segoe UI"]

_cache: list[str] | None = None


def list_families() -> list[str]:
    global _cache
    if _cache is not None:
        return _cache
    names: list[str] = []
    if sys.platform == "win32":
        try:
            out = subprocess.run(
                ["powershell", "-NoProfile", "-Command", _PS],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=30,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            data = json.loads(out.stdout)
            names = [n for n in data if isinstance(n, str) and n.strip()]
        except (OSError, ValueError, subprocess.SubprocessError):
            names = []
    _cache = sorted(set(names or FALLBACK), key=str.casefold)
    return _cache
