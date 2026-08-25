WEB_DIRECTORY = "./js"
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

# Única pieza de servidor del pack (sigue SIN nodos): la ruta para guardar una
# imagen como preview de un modelo. Si falla al cargar, el frontend sigue igual.
try:
    from . import nkd_save_preview  # noqa: F401
except Exception as _exc:  # pragma: no cover
    import logging
    logging.warning("[NKD Reroutes] save-preview backend no cargado: %s", _exc)

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
