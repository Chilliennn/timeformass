import io
import json
import os
import re
import time
from datetime import datetime, timedelta
import fitz
import requests
from google import genai
from google.genai import types
from google.genai.errors import APIError
from PIL import Image
from engines.base_engine import BaseEngine


class AssumptionPjEngine(BaseEngine):
    target_url = "https://assumptionpj.org/bulletin-mass-intentions/"
    source_name = "Assumption Church PJ"
    model_name = "gemini-2.5-flash"

    def scrape(self):
        session = requests.Session()
        headers = {"User-Agent": self._user_agent()}

        try:
            pdf_url, pdf_response = self._fetch_latest_bulletin_pdf(session, headers)
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

            crop_rect = fitz.Rect(
                0, page_height * 0.15, page_width * 0.60, page_height * 0.90
            )

            pix = last_page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=crop_rect)
            image_data = pix.tobytes("png")
            vision_image = Image.open(io.BytesIO(image_data)).convert("RGB")
            doc.close()
        except Exception as exc:
            raise RuntimeError(f"[prepare_bulletin_image] {exc}") from exc

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
                    response_mime_type="application/json"
                ),
            )

            raw_text = getattr(response, "text", "") or ""
            schedules = self._parse_model_output(raw_text)
            schedules = self._normalize_schedules(schedules)
            schedules = self._inject_saturday_sunset_mass(schedules)

        except Exception as exc:
            raise RuntimeError(f"[vision_extract_schedule] {exc}") from exc

        return {
            "source": self.source_name,
            "bulletin_page_url": self.target_url,
            "bulletin_image_url": pdf_url,
            "start_date": None,
            "end_date": None,
            "schedules": schedules,
        }

    def _inject_saturday_sunset_mass(self, schedules):
        has_saturday_sunset = any(
            item.get("day_of_week") == 6 and item.get("start_time") == "18:00:00"
            for item in schedules
        )

        if not has_saturday_sunset:
            schedules.append(
                {
                    "day_of_week": 6,
                    "start_time": "18:00:00",
                    "end_time": "19:00:00",
                    "language": "English",
                    "notes": "Sunset Mass",
                }
            )

        return schedules


def _generate_content_with_retry(
    self, client, contents, config, max_retries=3, initial_delay=2
):
    models_to_try = ["gemini-2.5-flash", "gemini-2.5-pro"]
    for model_name in models_to_try:
        delay = initial_delay
        for attempt in range(max_retries):
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=contents,
                    config=config,
                )
                return response
            except APIError as e:
                if e.code == 503 or e.code == 429:
                    if attempt == max_retries - 1:
                        break
                    time.sleep(delay)
                    delay *= 2
                    continue
                raise e
            except Exception as e:
                raise e
    raise RuntimeError(
        "All configured Gemini models failed due to high demand capacity limits."
    )


def _fetch_latest_bulletin_pdf(self, session, headers):
    today = datetime.now()
    if today.weekday() == 6:
        current_sunday = today
    else:
        current_sunday = today - timedelta(days=(today.weekday() + 1))

    for weeks_back in range(3):
        target_sunday = current_sunday - timedelta(weeks=weeks_back)

        year_str = target_sunday.strftime("%Y")
        month_dir = target_sunday.strftime("%m")
        date_file_str = target_sunday.strftime("%d.%m-%Y")

        constructed_url = (
            f"https://assumptionpj.org/wp-content/uploads/{year_str}/{month_dir}/"
            f"ASSUMPTION-BULLETIN-{date_file_str}.pdf"
        )

        try:
            response = session.get(constructed_url, headers=headers, timeout=15)
            if response.status_code == 200 and response.content.startswith(b"%PDF"):
                return constructed_url, response
        except requests.RequestException:
            continue

    return None, None


def _vision_prompt(self):
    return (
        "Analyze the Church of the Assumption Petaling Jaya weekly bulletin mass schedule.\n\n"
        "IMAGE STRUCTURE:\n"
        "- Thick horizontal bars represent day boundaries and contain the Date and the Liturgical Celebration (e.g., 'Sunday, 31.05.2026, THE MOST HOLY TRINITY, Solemnity', 'Monday, 01.06.2026, ... St Justin, Martyrs, memorial').\n"
        "- Under each day, there are specific Mass times (e.g., '6.00pm', '8.30am', '11.30am', '8.00am', '6.30am').\n"
        "- To the right of each Mass time, there are intention rows ('RIP', 'T/G', 'S/I') with lists of parishioner names.\n\n"
        "EXTRACTION RULES:\n"
        "1. Extract exactly ONE schedule object for each unique Mass time block on each day. Do NOT create multiple duplicate objects for different intention types (RIP/TG/SI) at the same time.\n"
        "2. Map the day correctly to 'day_of_week' (integer 1-7, where Monday=1, Tuesday=2, Wednesday=3, Thursday=4, Friday=5, Saturday=6, Sunday=7). Verify the day against the text in the date header.\n"
        "3. Set 'start_time' in 'HH:MM:SS' 24-hour format (e.g., '18:00:00' for 6.00pm, '08:30:00' for 8.30am).\n"
        "4. Estimate 'end_time' as exactly 1 hour after 'start_time' (e.g., '09:30:00' for an 8:30am start).\n"
        "5. Default 'language' to 'English'.\n"
        "6. Set 'notes' to the clean Liturgical Celebration/Feast/Season name extracted from the horizontal header of that day (e.g., 'THE MOST HOLY TRINITY, Solemnity', 'St Justin, Martyrs, memorial', 'Public Holiday', etc.). Do NOT include the lists of parishioner names or intention category codes (RIP, TG, SI) in the notes.\n\n"
        "Return a raw, minified JSON array matching this schema: "
        '[{"day_of_week":int,"start_time":"HH:MM:SS","end_time":"HH:MM:SS","language":"string","notes":"string"}]. '
        "Do not include markdown blocks, backticks, or text comments."
    )


def _parse_model_output(self, raw_text):
    text = (raw_text or "").strip()
    if not text:
        raise ValueError("Vision model returned an empty response.")
    cleaned = text
    if cleaned.startswith("```"):
        cleaned = re.sub(
            r"^http://googleusercontent.com/immersive_entry_chip/0json)?\s*",
            "",
            cleaned,
            flags=re.IGNORECASE,
        )

    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\[[\s\S]*\]", cleaned)
        if not match:
            raise
        payload = json.loads(match.group(0))
    if isinstance(payload, dict):
        payload = payload.get("schedules", [])
    if not isinstance(payload, list):
        raise ValueError("Vision model output does not contain a schedules list.")
    return payload


def _normalize_schedules(self, schedules):
    normalized = []
    seen = set()
    for item in schedules:
        if not isinstance(item, dict):
            continue
        day_of_week = self._normalize_day(item.get("day_of_week"))
        if day_of_week is None:
            continue
        start_time = self._normalize_time(item.get("start_time"))
        if not start_time:
            continue
        end_time = self._normalize_time(item.get("end_time"))
        if not end_time:
            end_time = self._plus_one_hour(start_time)
        language = str(item.get("language") or "English").strip() or "English"
        notes = str(item.get("notes") or "").strip()
        signature = (
            day_of_week,
            start_time,
            end_time,
            language.lower(),
            notes.lower(),
        )
        if signature in seen:
            continue
        seen.add(signature)
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
    try:
        day = int(value)
    except (TypeError, ValueError):
        return None
    return day if 1 <= day <= 7 else None


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
    if hour < 0 or hour > 23 or minute < 0 or minute > 59 or second < 0 or second > 59:
        return None
    return f"{hour:02d}:{minute:02d}:{second:02d}"


def _plus_one_hour(self, time_string):
    parsed = datetime.strptime(time_string, "%H:%M:%S")
    return (parsed + timedelta(hours=1)).strftime("%H:%M:%S")


def _user_agent(self):
    return (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
