from __future__ import annotations

from typing import Any, Optional

from pydantic import ValidationError

from ..logger import logger
from .models import CatalogItem

# Type fallback names for non-firm objects.
TYPE_NAMES = {
    'parking': 'Парковка', 'street': 'Улица', 'road': 'Дорога',
    'crossroad': 'Перекрёсток', 'station': 'Остановка',
}


def clean_photos(urls: Any, limit: int = 6) -> list[str]:
    """Keep up to `limit` unique HTTP(S) photo URLs (excluding SVG/icons)."""
    out: list[str] = []
    seen: set[str] = set()
    if not isinstance(urls, (list, tuple)):
        return out
    for u in urls:
        if not isinstance(u, str):
            continue
        s = u.strip()
        if not s or not (s.startswith('https://') or s.startswith('http://')):
            continue
        low = s.split('?', 1)[0].lower()
        if low.endswith('.svg') or '/icon' in low or 'yapic' in low:
            continue
        if s not in seen:
            seen.add(s)
            out.append(s)
            if len(out) >= limit:
                break
    return out


def _collect_photo_urls_from_obj(obj: Any, sink: list[str]) -> None:
    if isinstance(obj, str):
        sink.append(obj)
    elif isinstance(obj, list):
        for el in obj:
            _collect_photo_urls_from_obj(el, sink)
    elif isinstance(obj, dict):
        for k in ('main_photo_url', 'photo_url', 'image_url', 'url', 'src', 'orig'):
            v = obj.get(k)
            if isinstance(v, str):
                sink.append(v)
        pv = obj.get('preview_urls')
        if isinstance(pv, dict):
            picked = False
            for k in ('url', 'orig', 'large', '1024x', '640x480', '320x240'):
                v = pv.get(k)
                if isinstance(v, str):
                    sink.append(v)
                    picked = True
            if not picked:
                for v in pv.values():
                    if isinstance(v, str):
                        sink.append(v)
                        break
        for k in ('photos', 'items', 'images', 'gallery', 'media', 'urls'):
            v = obj.get(k)
            if isinstance(v, list):
                _collect_photo_urls_from_obj(v, sink)


def _extract_2gis_photos(item: dict[str, Any]) -> list[str]:
    raw: list[str] = []
    for k in ('main_photo_url', 'photo_url'):
        if isinstance(item.get(k), str):
            raw.append(item[k])
    ec = item.get('external_content')
    if isinstance(ec, list):
        for entry in ec:
            if not isinstance(entry, dict):
                continue
            etype = str(entry.get('type') or '').lower()
            if etype and 'photo' not in etype and 'image' not in etype and 'gallery' not in etype and not entry.get('main_photo_url'):
                continue
            _collect_photo_urls_from_obj(entry, raw)
    for k in ('photos', 'media', 'gallery'):
        if k in item:
            _collect_photo_urls_from_obj(item.get(k), raw)
    return clean_photos(raw)


def extract_record(catalog_doc: Any) -> Optional[dict[str, Any]]:
    """Extract a flat, presentation-ready record from a Catalog Item document.

    Shared by the HTML writer and the web dashboard. Returns `None` for
    malformed documents or entries without a name.
    """
    try:
        item = catalog_doc['result']['items'][0]
    except (KeyError, IndexError, TypeError):
        return None

    try:
        catalog_item = CatalogItem(**item)
    except ValidationError as e:
        logger.error('Ошибка извлечения записи: %s', e.errors()[0].get('loc') if e.errors() else e)
        return None

    # Name / description
    name, description = None, None
    if catalog_item.name_ex:
        name = catalog_item.name_ex.primary
        description = catalog_item.name_ex.extension
    elif catalog_item.name:
        name = catalog_item.name
    elif catalog_item.type in TYPE_NAMES:
        name = TYPE_NAMES[catalog_item.type]
    if not name:
        return None

    city = None
    for div in catalog_item.adm_div:
        if div.type == 'city':
            city = div.name

    rating = review_count = None
    if catalog_item.reviews:
        rating = catalog_item.reviews.general_rating
        review_count = catalog_item.reviews.general_review_count

    # Contacts: keep the first value of each type.
    contacts: dict[str, str] = {}
    for group in catalog_item.contact_groups:
        for contact in group.contacts:
            if contact.type in contacts:
                continue
            if contact.type == 'phone':
                contacts['phone'] = contact.text or contact.value
            elif contact.type == 'email':
                contacts['email'] = contact.value
            elif contact.url:
                contacts[contact.type] = contact.url.split('?')[0]

    extra = (catalog_doc.get('_fracs') or {}) if isinstance(catalog_doc, dict) else {}
    photos = clean_photos(_extract_2gis_photos(item) + list(extra.get('photos') or []))
    return {
        'name': name,
        'description': description,
        'rubrics': [r.name for r in catalog_item.rubrics],
        'address': catalog_item.address_name,
        'city': city,
        'rating': rating,
        'review_count': review_count,
        'contacts': contacts,
        'url': catalog_item.url,
        'owner': extra.get('owner') or {},
        'ymaps': extra.get('ymaps'),
        'photos': photos,
    }
