import os

import uvicorn

from backend import config

if __name__ == "__main__":
    print(f"咬字 啟動中: http://{config.HOST}:{config.PORT}")
    print("要關閉的話按 Ctrl+C,或直接關掉這個視窗。")
    try:
        uvicorn.run("backend.main:app", host=config.HOST, port=config.PORT)
    finally:
        # 背景執行緒(模型下載/辨識)不理會中斷訊號,這裡強制結束整個行程,
        # 避免 Ctrl+C 之後卡住。辨識中斷不會壞資料:下次啟動會標記成「中斷」
        # 讓使用者重跑,模型下載則會自動續傳。
        os._exit(0)
