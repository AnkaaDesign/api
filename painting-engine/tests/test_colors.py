import numpy as np

from painting_engine.colors import delta_e76, lab_to_hex, lab_to_srgb, srgb_to_lab


def test_white_roundtrip():
    lab = srgb_to_lab(np.array([[255, 255, 255]], dtype=np.uint8))
    assert abs(lab[0, 0] - 100.0) < 0.1
    assert abs(lab[0, 1]) < 0.5 and abs(lab[0, 2]) < 0.5
    back = lab_to_srgb(lab)
    assert np.all(np.abs(back.astype(int) - 255) <= 1)


def test_known_red():
    lab = srgb_to_lab(np.array([[255, 0, 0]], dtype=np.uint8))[0]
    # sRGB red ~ L 53.2, a 80.1, b 67.2
    assert abs(lab[0] - 53.2) < 1.0
    assert abs(lab[1] - 80.1) < 1.5
    assert abs(lab[2] - 67.2) < 1.5


def test_delta_e_symmetry_and_zero():
    a = srgb_to_lab(np.array([[10, 200, 50]], dtype=np.uint8))
    b = srgb_to_lab(np.array([[200, 10, 50]], dtype=np.uint8))
    assert delta_e76(a, a)[0] == 0.0
    assert delta_e76(a, b)[0] == delta_e76(b, a)[0] > 10


def test_lab_to_hex():
    assert lab_to_hex(np.array([100.0, 0.0, 0.0])) == "#ffffff"
    assert lab_to_hex(np.array([0.0, 0.0, 0.0])) == "#000000"
