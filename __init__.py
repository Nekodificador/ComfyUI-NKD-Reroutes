WEB_DIRECTORY = "./js"
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

# Piezas de servidor del pack (sigue SIN nodos): guardar una imagen como preview
# de un modelo, y guardar capturas para la documentación de un pack NKD. Si
# alguna falla al cargar, el frontend sigue igual.
try:
    from . import nkd_save_preview  # noqa: F401
except Exception as _exc:  # pragma: no cover
    import logging
    logging.warning("[NKD Reroutes] save-preview backend no cargado: %s", _exc)
try:
    from . import nkd_doc_shots  # noqa: F401
except Exception as _exc:  # pragma: no cover
    import logging
    logging.warning("[NKD Reroutes] doc-shots backend no cargado: %s", _exc)

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
