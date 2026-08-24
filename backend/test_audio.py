"""音訊濾鏡的最小自我檢查:python -m backend.test_audio

只測會壞掉出事的兩件事:濾鏡順序(增益必須排最後,不然噪音跟著被放大)、
外來輸入有沒有被夾回合法範圍(丟給 ffmpeg 的字串是命令列參數)。
"""

from . import audio


def test_all_off_is_empty():
    assert audio.filter_chain(dict(audio.DEFAULTS)) == ""


def test_order_is_denoise_voice_normalize_gain():
    chain = audio.filter_chain(
        {"denoise": True, "voice": True, "normalize": True, "gain_db": 6}
    )
    parts = chain.split(",")
    assert [p.split("=")[0] for p in parts] == [
        "afftdn",
        "highpass",
        "lowpass",
        "loudnorm",
        "volume",
    ], chain


def test_gain_only():
    assert audio.filter_chain({"gain_db": -3}) == "volume=-3dB"


def test_clean_clamps_junk():
    out = audio.clean(
        {"denoise_db": 999, "target_lufs": 100, "gain_db": "很大聲", "denoise": "yes"}
    )
    assert out["denoise_db"] == 60, out
    assert out["target_lufs"] == -8, out
    assert out["gain_db"] == audio.DEFAULTS["gain_db"], out
    assert out["denoise"] is True, out


def test_unknown_keys_are_dropped():
    out = audio.clean({"rm": "-rf /", "gain_db": 3})
    assert "rm" not in out and out["gain_db"] == 3, out


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"OK  {name}")
    print("全部通過")
