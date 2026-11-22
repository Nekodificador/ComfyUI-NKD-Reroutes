# Guardar capturas para la documentación de un pack NKD — segunda pieza de
# servidor de NKD Reroutes (el pack sigue sin nodos). El navegador renderiza la
# imagen y la manda aquí, que la escribe dentro del pack:
#   kind "node"  -> <pack>/docs/img/<name>.png     (un nodo suelto, para su página)
#   kind "thumb" -> <pack>/example_workflows/<name>.jpg   (miniatura de la galería
#                   de plantillas de ComfyUI: un JPG con el nombre de su JSON)
# Sólo en packs NKD que existan, con nombres limpios y sin salir de su carpeta.
import os
import re
import base64
import logging

PACK_PREFIX = "ComfyUI-NKD-"
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.\-]{0,120}$")
MAX_BYTES = 8 * 1024 * 1024
KINDS = {"node": ("docs/img", ".png"), "thumb": ("example_workflows", ".jpg")}


def target_path(custom_nodes_dirs, pack, kind, name):
    """Ruta donde se escribe la captura, o None si la petición no es válida."""
    if kind not in KINDS or not isinstance(pack, str) or not isinstance(name, str):
        return None
    if not pack.startswith(PACK_PREFIX) or os.sep in pack or "/" in pack or ".." in pack:
        return None
    if not NAME_RE.match(name) or ".." in name:
        return None
    pack_dir = next((os.path.join(d, pack) for d in custom_nodes_dirs
                     if os.path.isdir(os.path.join(d, pack))), None)
    if not pack_dir:
        return None
    sub, ext = KINDS[kind]
    folder = os.path.abspath(os.path.join(pack_dir, *sub.split("/")))
    if kind == "thumb" and not os.path.isfile(os.path.join(folder, name + ".json")):
        return None   # la miniatura sólo tiene sentido junto a su workflow
    full = os.path.abspath(os.path.join(folder, name + ext))
    if not full.startswith(os.path.abspath(pack_dir) + os.sep):
        return None
    return full


def _register_routes() -> None:
    from aiohttp import web
    from server import PromptServer
    import folder_paths

    @PromptServer.instance.routes.post("/nkd/reroutes/save_doc_image")
    async def _save_doc_image(request):
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "bad json"}, status=400)
        path = target_path(folder_paths.get_folder_paths("custom_nodes"),
                           body.get("pack"), body.get("kind"), body.get("name"))
        if not path:
            return web.json_response({"error": "invalid pack/kind/name"}, status=400)
        try:
            data = base64.b64decode(body.get("data") or "", validate=True)
        except Exception:
            return web.json_response({"error": "bad image data"}, status=400)
        if not data or len(data) > MAX_BYTES:
            return web.json_response({"error": "empty or too large"}, status=400)
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(data)
        except OSError as exc:
            return web.json_response({"error": str(exc)[:200]}, status=500)
        return web.json_response({"ok": True, "file": os.path.basename(path), "bytes": len(data)})


try:
    _register_routes()
    logging.info("[NKD Reroutes] doc-shots route ready at /nkd/reroutes/save_doc_image")
except Exception as _exc:   # sin servidor (tests), o ya registrada
    logging.debug("[NKD Reroutes] doc-shots route NOT registered (%s: %s)",
                  type(_exc).__name__, _exc)
