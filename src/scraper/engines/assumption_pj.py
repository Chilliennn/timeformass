import io
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta
import fitz
import requests
from PIL import Image
from google import genai
from google.genai import types
from google.genai.errors import APIError
from engines.base_engine import BaseEngine

try:
    from curl_cffi import requests as cffi_requests
except Exception:
    cffi_requests = None

try:
    from playwright.sync_api import sync_playwright
except Exception:
    sync_playwright = None


class AssumptionPjEngine(BaseEngine):
    target_url = "https://assumptionpj.org/bulletin-mass-intentions/"
    source_name = "Assumption Church PJ"
    model_name = "gemini-2.5-flash"

    def _fetch_latest_bulletin_pdf(self):
        now = datetime.now()

        for i in range(8):
            check_date = now - timedelta(days=i)
            year = check_date.strftime("%Y")
            month = check_date.strftime("%m")
            date_str = check_date.strftime("%d.%m.%Y")

            url_variant = f"https://assumptionpj.org/wp-content/uploads/{year}/{month}/ASSUMPTION-BULLETIN-{date_str}.pdf"
            print(
                f"[{self.source_name}] Trying historical pattern match: {url_variant}",
                file=sys.stderr,
            )
            resp = self._fetch(url_variant, kind="pdf", referer=self.target_url, timeout=15)
            if resp is not None and self._acceptable(resp, "pdf"):
                return url_variant, resp

        print(
            f"[{self.source_name}] Falling back to broad DOM parsing: {self.target_url}",
            file=sys.stderr,
        )
        page_response = self._fetch(self.target_url, kind="html", timeout=30)
        page_html = None
        if page_response is not None and page_response.status_code == 200:
            page_html = page_response.text

        if not page_html or "One moment, please" in page_html:
            print(
                f"[{self.source_name}] Regular fetch returned challenge/empty page; switching to Playwright.",
                file=sys.stderr,
            )
            try:
                page_html = self._fetch_with_playwright(self.target_url, timeout=60)
            except Exception as e:
                print(
                    f"[{self.source_name}] Playwright fallback failed: {e}",
                    file=sys.stderr,
                )

        if not page_html:
            raise ValueError("Bulletin page returned no usable response.")

        cleaned_html = page_html.replace("\\", "")
        pdf_links = re.findall(
            r'https?://[^\s"\'<>]+?\.pdf', cleaned_html, re.IGNORECASE
        )

        if pdf_links:
            latest_pdf_url = pdf_links[0]
            print(
                f"[{self.source_name}] Extracted asset URL from page payload: {latest_pdf_url}",
                file=sys.stderr,
            )
            pdf_response = self._fetch(
                latest_pdf_url, kind="pdf", referer=self.target_url, timeout=60
            )
            if pdf_response is not None and self._acceptable(pdf_response, "pdf"):
                return latest_pdf_url, pdf_response

        target_err_str = now.strftime("%d.%m.%Y")
        raise ValueError(
            f"Could not reach or locate the bulletin PDF pattern for date {target_err_str}"
        )

    def _fetch_with_playwright(self, url, timeout=60):
        if sync_playwright is None:
            raise RuntimeError("playwright is not installed.")
        print(
            f"[{self.source_name}] [playwright] Launching browser for {url}",
            file=sys.stderr,
        )
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent=self._user_agent(),
                viewport={"width": 1280, "height": 800},
                locale="en-US",
            )
            page = context.new_page()
            page.set_default_timeout(timeout * 1000)
            page.goto(url, wait_until="networkidle", timeout=timeout * 1000)
            page.wait_for_load_state("networkidle")
            content = page.content()
            browser.close()
            return content

    def _headers(self, kind="html", referer=None):
        if kind == "pdf":
            return {
                "User-Agent": self._user_agent(),
                "Accept": "application/pdf,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate",
                "Connection": "keep-alive",
                "Referer": referer or self.target_url,
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "same-origin",
            }
        return {
            "User-Agent": self._user_agent(),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Referer": referer or "https://assumptionpj.org/",
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
                    print(
                        f"[{self.source_name}] curl_cffi unavailable: {e}",
                        file=sys.stderr,
                    )
            sessions.append(("requests", requests.Session()))
            self._sessions = sessions
            self._warmed = set()
        return self._sessions

    def _warm_up(self, name, session):
        if name in self._warmed:
            return
        self._warmed.add(name)
        try:
            session.get(
                "https://assumptionpj.org/",
                headers=self._headers("html"),
                timeout=20,
            )
        except Exception as e:
            print(
                f"[{self.source_name}] Warm-up via {name} failed: {e}",
                file=sys.stderr,
            )

    def _acceptable(self, resp, kind):
        if resp is None or resp.status_code != 200:
            return False
        ct = (resp.headers.get("Content-Type") or "").lower()
        if kind == "pdf":
            return "pdf" in ct or resp.content[:4] == b"%PDF"
        return True

    def _fetch(self, url, kind="html", referer=None, timeout=30):
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
                print(
                    f"[{self.source_name}] [{name}] request failed for {url}: {e}",
                    file=sys.stderr,
                )
                continue
            last = resp
            print(
                f"[{self.source_name}] [{name}] {url} -> {resp.status_code} | "
                f"{resp.headers.get('Content-Type')} | {len(resp.content)} bytes",
                file=sys.stderr,
            )
            if self._acceptable(resp, kind):
                return resp
        return last

    def scrape(self):
        try:
            pdf_url, pdf_response = self._fetch_latest_bulletin_pdf()
            if not pdf_response:
                raise ValueError(
                    "No reachable bulletin PDF found for the current or previous week."
                )
            pdf_bytes = io.BytesIO(pdf_response.content)
        except Exception as exc:
            raise RuntimeError(f"[download_pdf] {exc}") from exc

        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            total_pages = len(doc)
            if total_pages == 0:
                raise ValueError("Downloaded bulletin PDF file is completely empty.")

            last_page = doc[total_pages - 1]
            page_width = last_page.rect.width
            page_height = last_page.rect.height

            crop_rect = fitz.Rect(0, page_height * 0.15, page_width, page_height)
            last_page.set_cropbox(crop_rect)

            pix = last_page.get_pixmap(dpi=150)
            img_data = pix.tobytes("png")
            vision_image = Image.open(io.BytesIO(img_data)).convert("RGB")
        except Exception as exc:
            raise RuntimeError(f"[process_pdf_page] {exc}") from exc

        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "[gemini_api_key] GEMINI_API_KEY is missing from environment."
            )

        try:
            client = genai.Client(api_key=api_key)
            response = self._generate_content_with_retry(
                client=client,
                contents=[self._vision_prompt(), vision_image],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=self._json_schema(),
                    temperature=0.1,
                ),
            )
            raw_text = response.text.strip()
        except APIError as exc:
            raise RuntimeError(
                f"[gemini_api_call] GenAI invocation failed: {exc}"
            ) from exc
        except Exception as exc:
            raise RuntimeError(f"[gemini_api_call] {exc}") from exc

        try:
            payload = json.loads(raw_text)
        except Exception as exc:
            raise RuntimeError(
                f"[parse_json] Failed parsing response text as JSON. Raw data: {raw_text}"
            ) from exc

        schedules_list = payload.get("schedules") or []
        normalized_schedules = self._normalize_payload_items(schedules_list)

        has_saturday_6pm = any(
            s.get("day_of_week") == 6 and s.get("start_time") == "18:00:00"
            for s in normalized_schedules
        )
        if not has_saturday_6pm:
            normalized_schedules.append(
                {
                    "day_of_week": 6,
                    "start_time": "18:00:00",
                    "end_time": "19:00:00",
                    "language": "English",
                    "notes": "Sunset Mass",
                }
            )

        return {
            "source": self.source_name,
            "start_date": None,
            "end_date": None,
            "schedules": normalized_schedules,
        }

    def _vision_prompt(self):
        return (
            "Analyze this cropped image section of the parish bulletin. "
            "Extract every single scheduled mass service explicitly listed. "
            "For each mass item, output an entry containing day_of_week (integer 1-7, where 1=Monday, 7=Sunday), "
            "start_time (string, like '06:45 AM' or '6.30pm'), language (e.g. 'English', 'Mandarin'), "
            "and optional brief notes summarizing intentional annotations."
        )

    def _json_schema(self):
        return types.Schema(
            type=types.Type.OBJECT,
            properties={
                "schedules": types.Schema(
                    type=types.Type.ARRAY,
                    items=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "day_of_week": types.Schema(type=types.Type.STRING),
                            "start_time": types.Schema(type=types.Type.STRING),
                            "language": types.Schema(type=types.Type.STRING),
                            "notes": types.Schema(type=types.Type.STRING),
                        },
                        required=["day_of_week", "start_time"],
                    ),
                )
            },
            required=["schedules"],
        )

    def _normalize_payload_items(self, items):
        normalized = []
        for item in items:
            day_val = item.get("day_of_week")
            start_val = item.get("start_time")

            day_of_week = self._normalize_day(day_val)
            start_time = self._normalize_time(start_val)
            if not day_of_week or not start_time:
                continue

            end_time = self._normalize_time(item.get("end_time"))
            if not end_time:
                match = re.match(r"^(\d{2}):(\d{2})", start_time)
                if match:
                    h = (int(match.group(1)) + 1) % 24
                    end_time = f"{h:02d}:{match.group(2)}:00"
                else:
                    end_time = start_time

            language = str(item.get("language") or "English").strip()
            notes = str(item.get("notes") or "").strip()

            normalized.append(
                {
                    "day_of_week": day_of_week,
                    "start_time": start_time,
                    "end_time": end_time,
                    "language": language,
                    "notes": notes,
                }
            )
        return normalized

    def _normalize_day(self, value):
        if value is None:
            return None
        val_str = str(value).strip().lower()
        mapping = {
            "monday": 1,
            "mon": 1,
            "1": 1,
            "tuesday": 2,
            "tue": 2,
            "2": 2,
            "wednesday": 3,
            "wed": 3,
            "3": 3,
            "thursday": 4,
            "thu": 4,
            "4": 4,
            "friday": 5,
            "fri": 5,
            "5": 5,
            "saturday": 6,
            "sat": 6,
            "6": 6,
            "sunday": 7,
            "sun": 7,
            "7": 7,
        }
        return mapping.get(val_str, None)

    def _normalize_time(self, time_str):
        if time_str is None:
            return None
        text = str(time_str).strip().lower().replace(".", ":")
        text = re.sub(r"\s+", "", text)
        match = re.match(
            r"^(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?(?::(?P<second>\d{2}))?(?P<suffix>am|pm)?$",
            text,
        )
        if not match:
            return None
        hour = int(match.group("hour"))
        minute = int(match.group("minute") or 0)
        second = int(match.group("second") or 0)
        suffix = match.group("suffix")
        if suffix:
            if hour == 12:
                hour = 0
            if suffix == "pm":
                hour += 12
        if (
            hour < 0
            or hour > 23
            or minute < 0
            or minute > 59
            or second < 0
            or second > 59
        ):
            return None
        return f"{hour:02d}:{minute:02d}:{second:02d}"
