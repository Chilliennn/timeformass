import io
import os
import json
import re
import logging
import sys
from datetime import datetime, timedelta
import requests
from bs4 import BeautifulSoup
from PIL import Image
from google import genai
from google.genai import types
from engines.base_engine import BaseEngine

try:  # Optional: browser-grade TLS fingerprint to get past WAF / bot filters
    from curl_cffi import requests as cffi_requests
except Exception:  # pragma: no cover
    cffi_requests = None

logger = logging.getLogger("OfklEngine")
if not logger.handlers:
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter("[%(levelname)s] [OFKL] %(message)s"))
    logger.addHandler(handler)
logger.setLevel(logging.DEBUG)

BASE_URL = "https://olfkl.com"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
LANG_MAP = {
    "E": "English",
    "T": "Tamil",
    "M": "Mandarin",
    "C": "Mandarin",
    "BM": "Malay",
}


def _clean(text):
    """Strip NBSP / zero-width chars and collapse whitespace."""
    if text is None:
        return ""
    text = (
        str(text)
        .replace("\xa0", " ")
        .replace("\u200b", "")
        .replace("\u202f", " ")
        .replace("\u2009", " ")
    )
    return re.sub(r"\s+", " ", text).strip()


def _looks_like_image(data):
    if not data or len(data) < 1000:
        return False
    return (
        data[:3] == b"\xff\xd8\xff"
        or data[:8] == b"\x89PNG\r\n\x1a\n"
        or (data[:4] == b"RIFF" and data[8:12] == b"WEBP")
    )


class OfklEngine(BaseEngine):
    target_url = "https://olfkl.com/mass-schedule/"
    bulletin_page_url = "https://olfkl.com/weekly-bulletin/"
    source_name = "Church of Our Lady of Fatima (OFKL)"
    model_name = "gemini-2.5-flash"

    # ------------------------------------------------------------------ HTTP
    def _headers(self, kind="html", referer=None):
        # NOTE: no "br" in Accept-Encoding. Without the brotli package requests
        # cannot decode it, which silently yields garbled / truncated bodies.
        if kind == "image":
            return {
                "User-Agent": USER_AGENT,
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate",
                "Connection": "keep-alive",
                "Referer": referer or self.bulletin_page_url,
                "Sec-Fetch-Dest": "image",
                "Sec-Fetch-Mode": "no-cors",
                "Sec-Fetch-Site": "same-origin",
            }
        if kind == "json":
            return {
                "User-Agent": USER_AGENT,
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate",
                "Referer": BASE_URL + "/",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
            }
        return {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Referer": referer or (BASE_URL + "/"),
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-User": "?1",
        }

    def _get_sessions(self):
        if getattr(self, "_sessions", None) is None:
            sessions = []
            if cffi_requests is not None:
                try:
                    sessions.append(
                        ("curl_cffi", cffi_requests.Session(impersonate="chrome124"))
                    )
                except Exception as e:
                    logger.debug(f"curl_cffi unavailable: {e}")
            sessions.append(("requests", requests.Session()))
            self._sessions = sessions
            self._warmed = set()
        return self._sessions

    def _warm_up(self, name, session):
        """Visit the homepage once so cookies / WAF tokens are set."""
        if name in self._warmed:
            return
        self._warmed.add(name)
        try:
            session.get(BASE_URL + "/", headers=self._headers("html"), timeout=20)
        except Exception as e:
            logger.debug(f"Warm-up via {name} failed: {e}")

    def _acceptable(self, resp, kind):
        if resp is None or resp.status_code != 200:
            return False
        if kind == "image":
            return _looks_like_image(resp.content)
        if kind == "json":
            try:
                resp.json()
                return True
            except Exception:
                return False
        text = resp.text or ""
        return "elementor" in text.lower() or len(text) > 30000

    def _fetch(self, url, kind="html", referer=None, timeout=30):
        """GET with multiple backends; returns first acceptable response, else last."""
        last = None
        for name, session in self._get_sessions():
            self._warm_up(name, session)
            try:
                resp = session.get(
                    url,
                    headers=self._headers(kind, referer),
                    timeout=timeout,
                    allow_redirects=True,
                )
            except Exception as e:
                logger.warning(f"[{name}] request failed for {url}: {e}")
                continue
            last = resp
            logger.debug(
                f"[{name}] {url} -> {resp.status_code} | "
                f"{resp.headers.get('Content-Type')} | {len(resp.content)} bytes"
            )
            if self._acceptable(resp, kind):
                return resp
        return last

    # ---------------------------------------------------------------- scrape
    def scrape(self):
        vision_image = None
        resolved_bulletin_url = None

        logger.info("Starting scrape process...")
        candidate_urls = self._get_candidate_bulletin_urls()
        logger.info(
            f"Discovered {len(candidate_urls)} bulletin candidate URLs to test."
        )

        for idx, url in enumerate(candidate_urls, 1):
            logger.debug(
                f"Testing image candidate [{idx}/{len(candidate_urls)}]: {url}"
            )
            try:
                resp = self._fetch(
                    url, kind="image", referer=self.bulletin_page_url, timeout=20
                )
                if resp is not None and self._acceptable(resp, "image"):
                    vision_image = Image.open(io.BytesIO(resp.content)).convert("RGB")
                    resolved_bulletin_url = url
                    logger.info(f"Successfully fetched bulletin image from: {url}")
                    break
                else:
                    status = resp.status_code if resp is not None else "no response"
                    logger.debug(f"  Not a valid image (status={status}), skipping.")
            except Exception as e:
                logger.warning(f"Failed candidate request for {url}: {e}")

        api_key = os.environ.get("GEMINI_API_KEY")
        if vision_image and api_key:
            logger.info("Executing Gemini Vision API extraction...")
            try:
                client = genai.Client(api_key=api_key)
                response = self._generate_content_with_retry(
                    client=client,
                    contents=[self._vision_prompt(), vision_image],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json"
                    ),
                )
                raw_text = getattr(response, "text", "") or ""
                logger.debug(f"Raw Gemini Vision Output: {raw_text[:300]}...")
                extracted_data = self._parse_model_output(raw_text)
                logger.info(
                    f"Parsed {len(extracted_data)} schedule entries from Vision API."
                )

                schedules, calculated_start, calculated_end = (
                    self._normalize_schedules_with_dates(extracted_data)
                )
                if schedules:
                    logger.info(
                        f"Vision extraction successful with {len(schedules)} normalized events."
                    )
                    return {
                        "source": self.source_name,
                        "bulletin_page_url": self.target_url,
                        "bulletin_image_url": resolved_bulletin_url,
                        "start_date": calculated_start,
                        "end_date": calculated_end,
                        "schedules": schedules,
                    }
                logger.warning(
                    "Vision API extracted records, but normalization returned 0 entries."
                )
            except Exception as e:
                logger.error(f"Vision extraction pipeline failed: {e}", exc_info=True)
        elif not vision_image:
            logger.warning(
                "No bulletin image could be resolved. Falling back to direct HTML scrape."
            )
        elif not api_key:
            logger.warning(
                "GEMINI_API_KEY missing. Falling back to direct HTML scrape."
            )

        logger.info("Falling back to HTML scraping via target_url...")
        return self._scrape_from_page()

    # ------------------------------------------------------ image discovery
    def _extract_upload_urls(self, html):
        """Pull every wp-content/uploads image URL out of raw HTML (handles escaped JSON slashes)."""
        html = html.replace("\\/", "/")
        pattern = re.compile(
            r"https?://(?:www\.)?olfkl\.com/wp-content/uploads/[^\"'\s)<>,]+?\.(?:jpe?g|png|webp)",
            re.IGNORECASE,
        )
        urls = []
        for m in pattern.findall(html):
            if "bulletin" not in m.lower():
                continue
            m = re.sub(
                r"-\d{2,4}x\d{2,4}(?=\.[A-Za-z]+$)", "", m
            )  # drop WP thumbnail suffix
            urls.append(m)
        return urls

    def _bulletin_date_key(self, url):
        m = re.search(r"(\d{1,2})-([A-Za-z]{3})-(\d{2})", url)
        if m:
            try:
                return datetime.strptime(
                    f"{m.group(1)} {m.group(2)} {m.group(3)}", "%d %b %y"
                )
            except ValueError:
                pass
        return datetime.min

    def _get_candidate_bulletin_urls(self):
        discovered = []

        # Strategy A: scrape the weekly-bulletin page (img, srcset, lazy attrs, links, raw HTML)
        try:
            logger.debug(f"Fetching bulletin page: {self.bulletin_page_url}")
            resp = self._fetch(self.bulletin_page_url, kind="html", timeout=20)
            if resp is not None and resp.status_code == 200:
                logger.debug(f"Bulletin page status: 200 ({len(resp.text)} chars)")
                found = self._extract_upload_urls(resp.text)
                soup = BeautifulSoup(resp.text, "html.parser")
                for a in soup.find_all("a", href=True):
                    if (
                        re.search(r"\.(jpe?g|png|webp)(\?|$)", a["href"], re.I)
                        and "bulletin" in a["href"].lower()
                    ):
                        found.append(a["href"])
                for url in found:
                    if url.startswith("/"):
                        url = BASE_URL + url
                    discovered.append(url)
                    logger.debug(f"Found on-page candidate image: {url}")
            else:
                logger.warning(
                    f"Bulletin page status: {resp.status_code if resp is not None else 'no response'}"
                )
        except Exception as e:
            logger.warning(f"Failed to inspect weekly bulletin page: {e}")

        # Strategy B: WordPress REST media library (newest first)
        try:
            api = f"{BASE_URL}/wp-json/wp/v2/media?search=bulletin&per_page=20&orderby=date&order=desc&_fields=source_url,date"
            resp = self._fetch(api, kind="json", timeout=20)
            if resp is not None and self._acceptable(resp, "json"):
                for item in resp.json():
                    src = item.get("source_url") or ""
                    if src and re.search(r"\.(jpe?g|png|webp)$", src, re.I):
                        discovered.append(src)
                        logger.debug(f"REST media candidate: {src}")
        except Exception as e:
            logger.debug(f"REST media discovery failed: {e}")

        # Newest bulletins first (by date embedded in filename), preferring "-Eng"
        discovered = sorted(
            dict.fromkeys(discovered),
            key=lambda u: (self._bulletin_date_key(u), "-eng" in u.lower()),
            reverse=True,
        )

        # Strategy C: algorithmic guesses around recent Sundays
        today = datetime.now()
        current_sun = today - timedelta(days=(today.weekday() + 1) % 7)
        generated = []
        for sun in [
            current_sun,
            current_sun + timedelta(days=7),
            current_sun - timedelta(days=7),
        ]:
            day_num = str(sun.day)
            date_tag = f"{day_num}-{sun.strftime('%b')}-{sun.strftime('%y')}"
            # The upload folder may be the Sunday's month, the month before, or the month after
            folders = []
            for delta in (0, -7, 7, -14):
                d = sun + timedelta(days=delta)
                folder = f"{d.year}/{d.month:02d}"
                if folder not in folders:
                    folders.append(folder)
            for folder in folders:
                for name in (
                    f"OLF-BULLETIN-{date_tag}-Eng.jpg",
                    f"BULLETIN-{date_tag}-Eng.jpg",
                    f"OLF-BULLETIN-{date_tag}.jpg",
                    f"BULLETIN-{date_tag}.jpg",
                    f"OLF-BULLETIN-{date_tag}-Eng.png",
                ):
                    generated.append(f"{BASE_URL}/wp-content/uploads/{folder}/{name}")

        unique, seen = [], set()
        for c in discovered + generated:
            if c and c not in seen:
                seen.add(c)
                unique.append(c)
        return unique

    # ------------------------------------------------------- HTML fallback
    def _get_page_html(self):
        """Try the live page, then the WP REST API's rendered Elementor content."""
        resp = self._fetch(self.target_url, kind="html", timeout=30)
        html = resp.text if resp is not None and resp.status_code == 200 else ""
        if html and self._acceptable(resp, "html"):
            return html
        logger.warning(
            f"Direct page looks truncated/blocked ({len(html)} chars). Trying WP REST API..."
        )

        for api in (
            f"{BASE_URL}/wp-json/wp/v2/pages?slug=mass-schedule&_fields=content",
            f"{BASE_URL}/?rest_route=/wp/v2/pages&slug=mass-schedule&_fields=content",
        ):
            try:
                r = self._fetch(api, kind="json", timeout=30)
                if r is not None and self._acceptable(r, "json"):
                    data = r.json()
                    if data:
                        rendered = (data[0].get("content") or {}).get("rendered") or ""
                        if rendered:
                            logger.info(
                                f"Using REST-rendered page content ({len(rendered)} chars)."
                            )
                            return rendered
            except Exception as e:
                logger.debug(f"REST page fetch failed for {api}: {e}")

        if html:
            logger.warning("Falling back to whatever partial HTML was returned.")
        return html

    def _scrape_from_page(self):
        try:
            logger.debug(f"Requesting HTML from {self.target_url}")
            html = self._get_page_html()
            logger.debug(f"Target page response size: {len(html)} chars")
        except Exception as exc:
            logger.error(f"HTML request failed: {exc}")
            raise RuntimeError(
                f"[direct_page_scrape] Failed to fetch {self.target_url}: {exc}"
            ) from exc

        schedule_items = self._extract_page_schedules(html)
        logger.info(f"Extracted {len(schedule_items)} day blocks from HTML.")

        schedules = [
            service
            for day in schedule_items
            for service in self._normalize_page_services(day)
        ]
        logger.info(f"Total normalized services from HTML: {len(schedules)}")

        tracked_dates = [datetime.strptime(i["date"], "%Y-%m-%d") for i in schedules]
        return {
            "source": self.source_name,
            "bulletin_page_url": self.target_url,
            "bulletin_image_url": None,
            "start_date": (
                min(tracked_dates).strftime("%Y-%m-%d") if tracked_dates else None
            ),
            "end_date": (
                max(tracked_dates).strftime("%Y-%m-%d") if tracked_dates else None
            ),
            "schedules": schedules,
        }

    def _find_card(self, h2):
        """Walk up from a date heading to the smallest ancestor holding its list and no other date."""
        node = h2.parent
        while node is not None and getattr(node, "name", None) not in (
            None,
            "[document]",
            "body",
            "html",
        ):
            date_heads = [
                h
                for h in node.find_all("h2", class_="elementor-heading-title")
                if self._parse_page_date(_clean(h.get_text(" ", strip=True)))
            ]
            if len(date_heads) > 1:
                return None
            if node.select("ul li"):
                return node
            node = node.parent
        return None

    def _extract_page_schedules(self, html_content):
        if not html_content:
            return []
        soup = BeautifulSoup(html_content, "html.parser")

        main_content = (
            soup.select_one(".entry-content")
            or soup.select_one("div[data-elementor-type='wp-page']")
            or soup.select_one("[data-elementor-type]")
            or soup.body
            or soup
        )

        headings = main_content.find_all("h2", class_="elementor-heading-title")
        if not headings:
            headings = main_content.find_all("h2")
        logger.debug(f"Found {len(headings)} date headings.")

        schedule = []
        for h2 in headings:
            clean_heading_text = _clean(h2.get_text(" ", strip=True))
            parsed_date = self._parse_page_date(clean_heading_text)
            if not parsed_date:
                logger.debug(
                    f"Skipping h2 heading (not a valid date): '{clean_heading_text}'"
                )
                continue

            card = self._find_card(h2)
            if card is None:
                logger.debug(
                    f"No card container found for heading: {clean_heading_text}"
                )
                continue

            occasions = [
                _clean(h.get_text(" ", strip=True))
                for h in card.find_all("h6")
                if _clean(h.get_text(" ", strip=True))
            ]

            list_items = card.select(
                ".elementor-widget-text-editor ul li"
            ) or card.select("ul li")
            logger.debug(
                f"Date {parsed_date.strftime('%Y-%m-%d')} has {len(list_items)} raw list items."
            )

            services = []
            for li in list_items:
                raw_text = _clean(li.get_text(" ", strip=True))
                if not re.search(r"\bmass\b", raw_text, re.IGNORECASE):
                    logger.debug(f"  Discarding non-Mass service: '{raw_text}'")
                    continue
                service = self._parse_page_service(raw_text)
                if service:
                    services.append(service)
                else:
                    logger.warning(f"  Failed parsing service string: '{raw_text}'")

            if services:
                schedule.append(
                    {
                        "date": parsed_date.strftime("%Y-%m-%d"),
                        "occasion": " | ".join(occasions) or None,
                        "services": services,
                    }
                )
            else:
                logger.debug(
                    f"No valid Mass services found for date: {clean_heading_text}"
                )

        return schedule

    def _parse_page_date(self, date_text):
        clean_text = _clean(date_text)
        for fmt in ("%d %B %Y (%A)", "%d %B %Y", "%d %b %Y (%A)", "%d %b %Y"):
            try:
                return datetime.strptime(clean_text, fmt)
            except ValueError:
                continue
        m = re.match(r"^(\d{1,2}\s+[A-Za-z]+\s+\d{4})", clean_text)
        if m:
            for fmt in ("%d %B %Y", "%d %b %Y"):
                try:
                    return datetime.strptime(m.group(1), fmt)
                except ValueError:
                    continue
        return None

    def _parse_page_service(self, text):
        text = _clean(text)
        time_match = re.search(
            r"(\d{1,2})\s*[.:]\s*(\d{2})\s*(am|pm|noon)?", text, re.IGNORECASE
        )
        if not time_match:
            return None

        h, m, suffix = time_match.groups()
        suffix = (suffix or "").lower()
        if suffix == "noon":
            suffix = "pm"
        time_text = f"{int(h)}:{m} {suffix}".strip()
        remainder = text[time_match.end() :].strip()

        notes_match = re.search(r"\[([^\]]+)\]", remainder)
        language_match = re.search(r"\(([^)]+)\)", remainder)
        service_type = re.sub(r"\s*\([^)]*\)|\s*\[[^\]]*\]", "", remainder).strip(" -:")

        language = language_match.group(1).strip() if language_match else None
        if language:
            language = LANG_MAP.get(language.upper(), language)

        return {
            "time": time_text,
            "type": service_type or "Mass",
            "language": language,
            "notes": notes_match.group(1).strip() if notes_match else None,
        }

    def _normalize_page_services(self, day):
        normalized = []
        day_of_week = datetime.strptime(day["date"], "%Y-%m-%d").isoweekday()
        for service in day["services"]:
            start_time = self._normalize_time(service["time"])
            if not start_time:
                continue
            notes = service["notes"] or day["occasion"] or service["type"]
            normalized.append(
                {
                    "date": day["date"],
                    "day_of_week": day_of_week,
                    "start_time": start_time,
                    "end_time": self._plus_one_hour(start_time),
                    "language": service["language"] or "English",
                    "notes": notes,
                }
            )
        return normalized

    # --------------------------------------------------------------- vision
    def _vision_prompt(self):
        current_year = datetime.now().year
        return (
            f"Analyze this Church of Our Lady of Fatima (OLF) weekly parish bulletin.\n"
            f"Focus primarily on the 'MASS SCHEDULE' table (located on the left under 'DATE' and 'TIME') "
            f"as well as any special devotion box mentioning Mass (e.g. 13th Day Devotions).\n\n"
            f"EXTRACTION GUIDELINES:\n"
            f"1. DATE RESOLUTION: Table rows show dates like '3 Oct - Sat', '4 Oct - Sun', etc. Combine them with the current year ({current_year}) "
            f"to form full ISO dates (e.g. '{current_year}-10-03').\n"
            f"2. MASS ENTRIES ONLY: Only extract services that are an actual Mass. Skip standalone prayer services like 'Rosary', 'Novena', "
            f"'Holy Hour', 'Lauds', or 'Benediction' UNLESS directly integrated into a Mass.\n"
            f"3. TIME: Convert times accurately to 'HH:MM:SS' 24-hour format (e.g., '6.30am Mass (E)' -> '06:30:00', '6.00pm Mass (E)' -> '18:00:00'). "
            f"Pay special attention to morning schedules: 6:30 am and 8:30 am are distinct services.\n"
            f"4. LANGUAGE MAPPING:\n"
            f"   - (E) -> 'English'\n"
            f"   - (T) -> 'Tamil'\n"
            f"   - (M) -> 'Mandarin'\n"
            f"   - If unspecified, default to 'English'.\n"
            f"5. NOTES: Include the corresponding liturgical occasion from the DATE column (e.g. '27th SUNDAY IN ORDINARY TIME', "
            f"'Our Lady of the Rosary, memorial') or special intentions.\n\n"
            f"Output JSON strictly conforming to:\n"
            f"{{\n"
            f'  "extracted_schedules": [\n'
            f"    {{\n"
            f'      "date": "YYYY-MM-DD",\n'
            f'      "start_time": "HH:MM:SS",\n'
            f'      "language": "string",\n'
            f'      "notes": "string"\n'
            f"    }}\n"
            f"  ]\n"
            f"}}"
        )

    def _parse_model_output(self, raw_text):
        cleaned = re.sub(
            r"^```json\s*|\s*```$", "", raw_text.strip(), flags=re.IGNORECASE
        )
        try:
            data = json.loads(cleaned)
            if isinstance(data, list):
                return data
            return data.get("extracted_schedules", [])
        except Exception:
            match = re.search(r"\[.*\]", cleaned, re.DOTALL)
            return json.loads(match.group(0)) if match else []

    def _normalize_schedules_with_dates(self, raw_items):
        normalized = []
        tracked_dates = []

        for item in raw_items:
            raw_date_str = item.get("date")
            start = self._normalize_time(item.get("start_time"))
            if not raw_date_str or not start:
                continue
            try:
                parsed_date = datetime.strptime(raw_date_str, "%Y-%m-%d")
                tracked_dates.append(parsed_date)
                day_of_week = parsed_date.isoweekday()
            except ValueError:
                continue

            normalized.append(
                {
                    "date": raw_date_str,
                    "day_of_week": day_of_week,
                    "start_time": start,
                    "end_time": item.get("end_time") or self._plus_one_hour(start),
                    "language": item.get("language") or "English",
                    "notes": item.get("notes") or "Mass",
                }
            )

        start_date_str = (
            min(tracked_dates).strftime("%Y-%m-%d") if tracked_dates else None
        )
        end_date_str = (
            max(tracked_dates).strftime("%Y-%m-%d") if tracked_dates else None
        )
        return normalized, start_date_str, end_date_str

    def _normalize_time(self, t):
        if t is None:
            return None
        t = _clean(t).lower().replace(".", ":")
        match = re.search(r"(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?", t)
        if not match:
            return None
        h, m, suffix = int(match.group(1)), int(match.group(2)), match.group(3)
        if suffix == "pm" and h < 12:
            h += 12
        if suffix == "am" and h == 12:
            h = 0
        return f"{h:02d}:{m:02d}:00"

    def _plus_one_hour(self, t):
        h = (int(t[:2]) + 1) % 24
        return f"{h:02d}{t[2:]}"
