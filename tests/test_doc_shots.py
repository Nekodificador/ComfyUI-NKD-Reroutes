"""Guardas de la ruta de capturas para documentación (nkd_doc_shots.target_path)."""
import os
import sys
import tempfile
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("nkd_doc_shots", os.path.join(HERE, "..", "nkd_doc_shots.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
target_path = mod.target_path


def demo():
    with tempfile.TemporaryDirectory() as root:
        pack = os.path.join(root, "ComfyUI-NKD-Demo")
        os.makedirs(os.path.join(pack, "example_workflows"))
        open(os.path.join(pack, "example_workflows", "Intro.json"), "w").close()
        os.makedirs(os.path.join(root, "OtherPack"))
        roots = [root]

        # nodo suelto -> docs/img/<name>.png
        p = target_path(roots, "ComfyUI-NKD-Demo", "node", "NKDThing")
        assert p == os.path.abspath(os.path.join(pack, "docs", "img", "NKDThing.png")), p
        # miniatura -> example_workflows/<name>.jpg, sólo si existe su JSON
        p = target_path(roots, "ComfyUI-NKD-Demo", "thumb", "Intro")
        assert p == os.path.abspath(os.path.join(pack, "example_workflows", "Intro.jpg")), p
        assert target_path(roots, "ComfyUI-NKD-Demo", "thumb", "NoSuchWorkflow") is None

        # sólo packs NKD que existan
        assert target_path(roots, "OtherPack", "node", "x") is None
        assert target_path(roots, "ComfyUI-NKD-Missing", "node", "x") is None
        # nada de salir de la carpeta
        assert target_path(roots, "ComfyUI-NKD-Demo/../OtherPack", "node", "x") is None
        assert target_path(roots, "ComfyUI-NKD-Demo", "node", "../../evil") is None
        assert target_path(roots, "ComfyUI-NKD-Demo", "node", "a/b") is None
        assert target_path(roots, "ComfyUI-NKD-Demo", "node", "..") is None
        # tipo desconocido
        assert target_path(roots, "ComfyUI-NKD-Demo", "readme", "x") is None
    print("doc shots ok")


if __name__ == "__main__":
    demo()
    sys.exit(0)
