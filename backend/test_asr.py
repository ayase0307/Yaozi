"""辨識設定的最小自我檢查：python -m backend.test_asr"""

from . import asr


def test_vad_is_off_by_default():
    assert asr.DEFAULTS["vad"] is False
    assert asr.clean({})["vad"] is False


def test_explicit_vad_choice_is_preserved():
    assert asr.clean({"vad": True})["vad"] is True
    assert asr.clean({"vad": False})["vad"] is False


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"OK  {name}")
    print("全部通過")
