import io
import os
import json
import re
from datetime import datetime, timedelta
import requests
from PIL import Image
from google import genai
from google.genai import types
from engines.base_engine import BaseEngine


class OfklEngine(BaseEngine):
    target_url = "https://olfkl.com/mass-schedule/"
    source_name = "Church of Our Lady of Fatima (OFKL)"
    model_name = "gemini-2.5-flash"

    def scrape(self):
        bulletin_url, bulletin_sat = self._get_current_bulletin_url()

        try:
            image_response = requests.get(
                bulletin_url, headers={"User-Agent": self._user_agent()}, timeout=30
            )
            image_response.raise_for_status()
            image_buffer = io.BytesIO(image_response.content)
            vision_image = Image.open(image_buffer).convert("RGB")
        except Exception as exc:
            raise RuntimeError(
                f"[download_bulletin_image] Failed to fetch {bulletin_url}: {exc}"
            ) from exc

        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "[gemini_api_key] GEMINI_API_KEY is missing from environment."
            )

        try:
            client = genai.Client(api_key=api_key)

            prompt = self._vision_prompt(bulletin_sat)

            response = self._generate_content_with_retry(
                client=client,
                contents=[prompt, vision_image],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json"
                ),
            )

            raw_text = getattr(response, "text", "") or ""
            extracted_data = self._parse_model_output(raw_text)

            schedules, calculated_start, calculated_end = (
                self._normalize_schedules_with_dates(extracted_data)
            )
        except Exception as exc:
            raise RuntimeError(f"[vision_extract_schedule] {exc}") from exc

        return {
            "source": self.source_name,
            "bulletin_page_url": self.target_url,
            "bulletin_image_url": bulletin_url,
            "start_date": calculated_start,
            "end_date": calculated_end,
            "schedules": schedules,
        }

    def _get_current_bulletin_url(self):
        today = datetime.now()

        days_since_sat = (today.weekday() + 2) % 7
        bulletin_sat = today - timedelta(days=days_since_sat)
        bulletin_next_sat = bulletin_sat + timedelta(days=7)

        year = bulletin_sat.strftime("%Y")
        month_num = bulletin_sat.strftime("%m")

        start_day = str(bulletin_sat.day)
        start_month = bulletin_sat.strftime("%B")

        end_day = str(bulletin_next_sat.day)
        end_month = bulletin_next_sat.strftime("%B")

        url = (
            f"https://olfkl.com/wp-content/uploads/{year}/{month_num}/"
            f"OLF-BULLETIN-{start_day}-{start_month}-{end_day}-{end_month}.jpg"
        )
        return url, bulletin_sat

    def _vision_prompt(self, bulletin_sat: datetime) -> str:

        bulletin_end_sat = bulletin_sat + timedelta(days=7)

        date_range_hint = (
            f"{bulletin_sat.day} {bulletin_sat.strftime('%B %Y')} "
            f"to {bulletin_end_sat.day} {bulletin_end_sat.strftime('%B %Y')}"
        )

        date_map_lines = []
        for offset in range(8):
            d = bulletin_sat + timedelta(days=offset)
            date_map_lines.append(
                f"  {d.strftime('%a')} {d.day} {d.strftime('%B')} → {d.strftime('%Y-%m-%d')}"
            )
        date_map = "\n".join(date_map_lines)

        return (
            f"You are extracting the Mass Schedule from a Church of Our Lady of Fatima (OLF) "
            f"parish bulletin image.\n\n"
            f"BULLETIN DATE RANGE: {date_range_hint}\n\n"
            f"EXACT DATE REFERENCE MAP (use this to convert any partial date or day name "
            f"in the bulletin to a full YYYY-MM-DD value):\n"
            f"{date_map}\n\n"
            f"EXTRACTION RULES:\n"
            f"1. Scan the entire MASS SCHEDULE table. Every row that lists a Mass time "
            f"must produce one JSON entry.\n"
            f"2. Use the DATE REFERENCE MAP above to assign the correct YYYY-MM-DD to "
            f"every entry. Do not guess or infer the year from anything else.\n"
            f"3. SHARED-ROW DATES: When one row header covers multiple dates "
            f"(e.g. '3 June – Wed / 4 June – Thu'), emit a SEPARATE JSON entry for "
            f"EACH date listed, each carrying the same time and language.\n"
            f"4. TIME FORMAT: Return all times in 24-hour HH:MM:SS format "
            f"(e.g. 07:00:00, 18:00:00). The bulletin uses am/pm labels — convert them.\n"
            f"5. MASS ONLY — skip non-Mass devotional services (standalone Rosary, Novena, "
            f"Holy Hour, Lauds, Benediction). EXCEPTION: if a service description ends with "
            f"'followed by Mass' or 'with Mass', emit an entry for that Mass using the time "
            f"the Mass begins (not the time the preceding service begins).\n"
            f"6. LANGUAGE: Detect language from suffix codes: (E)=English, (T)=Tamil, "
            f"(M)=Mandarin, (B) or 'Bilingual'=Bilingual. Default to English if absent.\n"
            f"7. NOTES: Include any Feast, Solemnity, Memorial, or Holiday label visible "
            f"on the same row or date block (e.g. 'THE MOST HOLY TRINITY, Solemnity', "
            f"'Public Holiday', 'CORPUS CHRISTI, Solemnity').\n\n"
            f"Return ONLY valid JSON — no markdown fences, no extra keys — structured as:\n"
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

    def _parse_model_output(self, raw_text: str) -> list:
        cleaned = re.sub(
            r"^```(?:json)?\s*|\s*```$",
            "",
            raw_text.strip(),
            flags=re.IGNORECASE | re.MULTILINE,
        ).strip()

        try:
            data = json.loads(cleaned)
            if isinstance(data, dict):
                return data.get("extracted_schedules", [])
            if isinstance(data, list):
                return data
        except json.JSONDecodeError:
            pass

        match = re.search(r"\[.*?\]", cleaned, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass

        return []

    def _normalize_schedules_with_dates(self, raw_items: list) -> tuple:
        normalized = []
        tracked_dates = []

        for item in raw_items:
            raw_date_str = item.get("date", "").strip()
            raw_time_str = item.get("start_time", "").strip()

            start = self._normalize_time(raw_time_str)
            if not raw_date_str or not start:
                continue

            try:
                parsed_date = datetime.strptime(raw_date_str, "%Y-%m-%d")
            except ValueError:
                continue

            tracked_dates.append(parsed_date)
            day_of_week = parsed_date.isoweekday()

            normalized.append(
                {
                    "date": raw_date_str,
                    "day_of_week": day_of_week,
                    "start_time": start,
                    "end_time": self._plus_one_hour(start),
                    "language": (item.get("language") or "English").strip(),
                    "notes": (item.get("notes") or "Mass").strip(),
                }
            )

        start_date_str = (
            min(tracked_dates).strftime("%Y-%m-%d") if tracked_dates else None
        )
        end_date_str = (
            max(tracked_dates).strftime("%Y-%m-%d") if tracked_dates else None
        )

        return normalized, start_date_str, end_date_str

    def _normalize_time(self, t: str) -> str | None:
        if not t:
            return None

        t = str(t).strip().lower().replace(".", ":")

        match = re.search(r"(\d{1,2}):?(\d{2})?\s*(am|pm)?", t)
        if not match:
            return None

        h = int(match.group(1))
        m = int(match.group(2)) if match.group(2) else 0
        suffix = match.group(3)

        if suffix == "pm" and h < 12:
            h += 12
        elif suffix == "am" and h == 12:
            h = 0

        if not (0 <= h <= 23 and 0 <= m <= 59):
            return None

        return f"{h:02d}:{m:02d}:00"

    def _plus_one_hour(self, t: str) -> str:
        parts = t.split(":")
        h = (int(parts[0]) + 1) % 24
        return f"{h:02d}:{parts[1]}:{parts[2]}"

    def _user_agent(self) -> str:
        return (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        )
