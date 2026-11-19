"""Entrypoint for the internal headless Chrome trial worker."""
from parser_2gis.web.server import create_app

app = create_app()
