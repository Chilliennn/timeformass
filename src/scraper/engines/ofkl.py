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
        bulletin_url = self._get_current_bulletin_url()
        
        try:
            image_response = requests.get(bulletin_url, headers={"User-Agent": self._user_agent()}, timeout=30)
            image_response.raise_for_status()
            image_buffer = io.BytesIO(image_response.content)
            vision_image = Image.open(image_buffer).convert("RGB")
        except Exception as exc:
            raise RuntimeError(f"[download_bulletin_image] Failed to fetch {bulletin_url}: {exc}") from exc

        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("[gemini_api_key] GEMINI_API_KEY is missing from environment.")

        try:
            client = genai.Client(api_key=api_key)
            response = self._generate_content_with_retry(
                client=client,
                contents=[self._vision_prompt(), vision_image],
                config=types.GenerateContentConfig(response_mime_type="application/json")
            )
            
            raw_text = getattr(response, "text", "") or ""
            extracted = self._parse_model_output(raw_text)
            schedules = self._normalize_schedules(extracted)
        except Exception as exc:
            raise RuntimeError(f"[vision_extract_schedule] {exc}") from exc

        return {
            "source": self.source_name,
            "bulletin_page_url": self.target_url,
            "bulletin_image_url": bulletin_url,
            "start_date": None,
            "end_date": None,
            "schedules": schedules,
        }

    def _get_current_bulletin_url(self):
        today = datetime.now()
        idx = (today.weekday() + 1) % 7
        sun = today - timedelta(days=idx)
        sat = sun - timedelta(days=1)
        next_sat = sat + timedelta(days=7)

        year = sat.strftime("%Y")
        month_num = sat.strftime("%m")
        
        start_day = sat.strftime("%d").lstrip('0')
        start_month = sat.strftime("%B")
        
        end_day = next_sat.strftime("%d").lstrip('0')
        end_month = next_sat.strftime("%B")
        
        start_str = f"{start_day}-{start_month}"
        end_str = f"{end_day}-{end_month}"
        
        return f"https://olfkl.com/wp-content/uploads/{year}/{month_num}/OLF-BULLETIN-{start_str}-{end_str}.jpg"

    def _vision_prompt(self):
        return (
            "Analyze this Church of Our Lady of Fatima (OLF) bulletin Mass Schedule section.\n\n"
            "EXTRACTION RULES:\n"
            "1. Locate the 'MASS SCHEDULE' table.\n"
            "2. Extract schedules for each date. For multi-day blocks (e.g., 3 June - Wed / 4 June - Thu), "
            "create separate entries for each day.\n"
            "3. Map 'day_of_week' (1=Mon, 7=Sun).\n"
            "4. Convert 'TIME' to 'start_time' (HH:MM:SS 24-hour). Default 'end_time' to 1 hour later.\n"
            "5. Only extract entries that are 'Mass'. Ignore 'Rosary', 'Novena', 'Holy Hour', or 'Benediction' "
            "unless they are part of a Mass event (e.g., 'Benediction followed by Mass').\n"
            "6. Capture language: (E) = English, (T) = Tamil, (M) = Mandarin, (Bilingual) = Bilingual.\n"
            "7. Notes should contain the Feast/Solemnity name (e.g., 'THE MOST HOLY TRINITY').\n\n"
            "Return JSON: {\"schedules\": [{\"day_of_week\": int, \"start_time\": \"string\", \"end_time\": \"string\", \"language\": \"string\", \"notes\": \"string\"}]}"
        )

    def _parse_model_output(self, raw_text):
        cleaned = re.sub(r"^```json\s*|\s*```$", "", raw_text.strip(), flags=re.IGNORECASE)
        try:
            data = json.loads(cleaned)
            return data.get("schedules", [])
        except:
            match = re.search(r"\[.*\]", cleaned, re.DOTALL)
            return json.loads(match.group(0)) if match else []

    def _normalize_schedules(self, schedules):
        normalized = []
        for item in schedules:
            start = self._normalize_time(item.get("start_time"))
            if not start: continue
            normalized.append({
                "day_of_week": int(item.get("day_of_week")),
                "start_time": start,
                "end_time": item.get("end_time") or self._plus_one_hour(start),
                "language": item.get("language") or "English",
                "notes": item.get("notes") or "Mass"
            })
        return normalized

    def _normalize_time(self, t):
        t = str(t).lower().replace(".", ":")
        match = re.search(r"(\d{1,2}):(\d{2})\s*(am|pm)?", t)
        if not match: return None
        h, m, suffix = int(match.group(1)), int(match.group(2)), match.group(3)
        if suffix == "pm" and h < 12: h += 12
        if suffix == "am" and h == 12: h = 0
        return f"{h:02d}:{m:02d}:00"

    def _plus_one_hour(self, t):
        h = (int(t[:2]) + 1) % 24
        return f"{h:02d}{t[2:]}"

    def _user_agent(self):
        return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"