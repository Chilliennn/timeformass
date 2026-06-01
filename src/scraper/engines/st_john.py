import io
import json
import os
import re
from datetime import datetime, timedelta
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from PIL import Image
from google import genai
from google.genai import types

from engines.base_engine import BaseEngine


class StJohnEngine(BaseEngine):
	target_url = "https://www.stjohnkl.com.my/"
	fallback_page_url = "https://www.stjohnkl.com.my/e-bulletin"
	source_name = "Cathedral of St John the Evangelist"

	def scrape(self):
		page_html = None
		page_url = None
		poster_image_url = None

		for candidate_page_url in (self.target_url, self.fallback_page_url):
			try:
				page_html = self._fetch_html(candidate_page_url)
				page_url = candidate_page_url
				poster_image_url = self._find_poster_image_url(page_html, candidate_page_url)
				if poster_image_url:
					break
			except Exception:
				continue

		if not page_html or not page_url or not poster_image_url:
			raise RuntimeError("[find_poster_image] Unable to locate the St John schedule poster image.")

		try:
			image_response = requests.get(poster_image_url, timeout=60)
			image_response.raise_for_status()
			image_buffer = io.BytesIO(image_response.content)
			vision_image = Image.open(image_buffer).convert("RGB")
		except Exception as exc:
			raise RuntimeError(f"[download_or_prepare_image] {exc}") from exc

		api_key = os.environ.get("GEMINI_API_KEY")
		if not api_key:
			raise RuntimeError("[gemini_api_key] GEMINI_API_KEY is missing from environment.")

		try:
			client = genai.Client(api_key=api_key)
			model_name = "gemini-2.5-flash"
			prompt = self._vision_prompt()
			try:
				response = client.models.generate_content(
					model=model_name,
					contents=[prompt, vision_image],
					config=types.GenerateContentConfig(response_mime_type="application/json"),
				)
			except Exception as gen_exc:
				model_list_info = []
				try:
					for model in client.models.list():
						model_list_info.append(getattr(model, "name", str(model)))
				except Exception:
					model_list_info = []

				diagnostic = str(gen_exc)
				if model_list_info:
					diagnostic += f" | available_models={model_list_info}"

				raise RuntimeError(f"[vision_extract_schedule] generate_content failed: {diagnostic}") from gen_exc

			raw_text = getattr(response, "text", "") or ""
			extracted = self._parse_model_output(raw_text)
			schedules = self._normalize_schedules(extracted)
		except Exception as exc:
			raise RuntimeError(f"[vision_extract_schedule] {exc}") from exc

		return {
			"source": self.source_name,
			"bulletin_page_url": page_url,
			"bulletin_image_url": poster_image_url,
			"start_date": None,
			"end_date": None,
			"schedules": schedules,
		}

	def _fetch_html(self, url):
		response = requests.get(url, headers={"User-Agent": self._user_agent()}, timeout=30)
		response.raise_for_status()
		return BeautifulSoup(response.text, "html.parser")

	def _find_poster_image_url(self, soup, page_url):
		heading = soup.find(string=re.compile(r"Mass Schedule for the Week|Weekly Buletin|Weekly Bulletin", re.IGNORECASE))
		if heading:
			heading_parent = heading.parent
			for container in (heading_parent, heading_parent.parent if heading_parent else None):
				if not container:
					continue
				image_tag = container.find_next("img", src=True)
				if image_tag and image_tag.get("src"):
					return urljoin(page_url, image_tag["src"])

		for image_tag in soup.find_all("img", src=True):
			alt_text = " ".join(
				str(part) for part in (image_tag.get("alt"), image_tag.get("title"), image_tag.get("src")) if part
			)
			if re.search(r"mass schedule|weekly buletin|weekly bulletin|mass intentions", alt_text, re.IGNORECASE):
				return urljoin(page_url, image_tag["src"])

		fallback_image = soup.find("img", src=True)
		if fallback_image and fallback_image.get("src"):
			return urljoin(page_url, fallback_image["src"])

		return None

	def _vision_prompt(self):
		return (
			"You are a strict data extraction engine. Extract ONLY Catholic mass schedule rows from this poster image. "
			"Read all columns and preserve row-to-time associations even if the layout is complex. "
			"Return valid JSON only with this exact top-level shape: {\"schedules\": [ ... ]}. "
			"Each schedule item must contain: day_of_week (int 1-7, Sunday=7), start_time (HH:MM:SS 24-hour), "
			"end_time (HH:MM:SS 24-hour; if missing, set to one hour after start_time), language (string), notes (string). "
			"Do not include markdown, comments, explanations, or extra keys."
		)

	def _parse_model_output(self, raw_text):
		text = (raw_text or "").strip()
		if not text:
			raise ValueError("Vision model returned an empty response.")

		cleaned = text
		if cleaned.startswith("```"):
			cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
			cleaned = re.sub(r"\s*```$", "", cleaned)

		try:
			payload = json.loads(cleaned)
		except json.JSONDecodeError:
			match = re.search(r"\{[\s\S]*\}", cleaned)
			if not match:
				raise
			payload = json.loads(match.group(0))

		if isinstance(payload, dict):
			schedules = payload.get("schedules", [])
		elif isinstance(payload, list):
			schedules = payload
		else:
			schedules = []

		if not isinstance(schedules, list):
			raise ValueError("Vision model output does not contain a schedules list.")

		return schedules

	def _normalize_schedules(self, schedules):
		groups = {}

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
			notes_raw = str(item.get("notes") or "").strip()
			notes_norm = re.sub(r"^[\*\u2022\-\s]+", "", notes_raw)
			notes_norm = re.sub(r"\s+", " ", notes_norm).strip()

			key = (day_of_week, start_time, end_time, language.lower())
			if key not in groups:
				groups[key] = {
					"day_of_week": day_of_week,
					"start_time": start_time,
					"end_time": end_time,
					"language": language,
					"notes_set": set(),
				}

			if notes_norm:
				groups[key]["notes_set"].add(notes_norm)

		result = []
		for (day, start, end, _lang) in sorted(groups.keys(), key=lambda k: (k[0], k[1])):
			entry = groups[(day, start, end, _lang)]
			notes_combined = "".join(sorted(entry["notes_set"])) if entry["notes_set"] else ""
			if notes_combined:
				notes_combined = "; ".join(sorted(entry["notes_set"]))
			result.append(
				{
					"day_of_week": entry["day_of_week"],
					"start_time": entry["start_time"],
					"end_time": entry["end_time"],
					"language": entry["language"],
					"notes": notes_combined,
				}
			)

		return result

	def _normalize_day(self, value):
		try:
			day = int(value)
		except (TypeError, ValueError):
			return None
		return day if 1 <= day <= 7 else None

	def _normalize_time(self, value):
		if value is None:
			return None

		text = str(value).strip().lower().replace(".", ":")
		text = re.sub(r"\s+", "", text)
		match = re.match(r"^(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?(?::(?P<second>\d{2}))?(?P<suffix>am|pm)?$", text)
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