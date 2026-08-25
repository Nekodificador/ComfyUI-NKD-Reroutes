# Guardar una imagen como preview de un modelo/LoRA — la ÚNICA pieza de servidor
# de NKD Reroutes (el pack sigue sin nodos). Escribe un sidecar
# "<modelo>.preview.<ext>" junto al fichero del modelo, que es de donde el core
# lee las previews. La imagen fuente ya está en el servidor (output/temp/input),
# así que se copia; no se sube nada.
import os
import glob
import shutil
import logging

import folder_paths

ALLOWED_TYPES = ("output", "temp", "input")


def _resolve_source(image):
    """Ruta en disco de la imagen fuente {type, subfolder, filename}, con guardas
    contra path-traversal (tiene que quedar dentro de su directorio base)."""
    itype = image.get("type", "output")
    if itype not in ALLOWED_TYPES:
        return None
    base = folder_paths.get_directory_by_type(itype)
    filename = image.get("filename") or ""
    if not base or not filename:
        return None
    subfolder = image.get("subfolder") or ""
    absbase = os.path.abspath(base)
    full = os.path.abspath(os.path.join(base, subfolder, filename))
    if full != absbase and not full.startswith(absbase + os.sep):
        return None
    return full if os.path.isfile(full) else None


def _register_routes() -> None:
    from aiohttp import web
    from server import PromptServer

    routes = PromptServer.instance.routes

    @routes.post("/nkd/reroutes/save_preview")
    async def _save_preview(request):
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "bad json"}, status=400)

        folder = body.get("folder")
        filename = body.get("filename")        # nombre del modelo (con subcarpeta)
        image = body.get("image") or {}
        if not folder or not filename:
            return web.json_response({"error": "missing folder/filename"}, status=400)

        model_path = folder_paths.get_full_path(folder, filename)
        if not model_path or not os.path.isfile(model_path):
            return web.json_response({"error": "model not found"}, status=404)

        src = _resolve_source(image)
        if not src:
            return web.json_response({"error": "source image not found"}, status=404)

        stem = os.path.splitext(model_path)[0]
        ext = os.path.splitext(image.get("filename", ""))[1] or ".png"
        dst = stem + ".preview" + ext

        try:
            # Quitar previews anteriores para no dejar dos sidecar del mismo modelo.
            for old in glob.glob(glob.escape(stem) + ".preview.*"):
                try:
                    os.remove(old)
                except OSError:
                    pass
            shutil.copyfile(src, dst)
        except OSError as exc:
            return web.json_response({"error": str(exc)[:200]}, status=500)

        return web.json_response({"ok": True, "preview": os.path.basename(dst)})


try:
    _register_routes()
    logging.info("[NKD Reroutes] save-preview route ready at /nkd/reroutes/save_preview")
except Exception as _exc:   # sin servidor (tests), o ya registrada
    logging.warning("[NKD Reroutes] save-preview route NOT registered (%s: %s)",
                    type(_exc).__name__, _exc)
