import io
import re
from datetime import datetime, timedelta
from urllib.parse import urljoin

import requests
import pytesseract
from bs4 import BeautifulSoup
from PIL import Image, ImageOps

from engines.base_engine import BaseEngine


class StJohnEngine(BaseEngine):
	target_url = "https://www.stjohnkl.com.my/"
	fallback_page_url = "https://www.stjohnkl.com.my/e-bulletin"
	source_name = "Cathedral of St John the Evangelist"

	MONTH_PATTERN = re.compile(
		(r"\b(?P<month>JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|"
		 r"OCTOBER|NOVEMBER|DECEMBER)\b"),
		re.IGNORECASE,
	)
	YEAR_PATTERN = re.compile(r"\b(?P<year>20\d{2})\b")
	DATE_ROW_PATTERN = re.compile(
		r"(?P<day>\d{1,2})/(?P<month>\d{1,2})\s*(?P<weekday>Mon|Tues|Tue|Wed|Thur|Thu|Fri|Sat|Sun)?",
		re.IGNORECASE,
	)
	TIME_PATTERN = re.compile(
		r"(?P<time>\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))",
		re.IGNORECASE,
	)
	MASS_PATTERN = re.compile(r"\bmass\b", re.IGNORECASE)
	LANGUAGE_PATTERNS = (
		(re.compile(r"\bMANDARIN\b", re.IGNORECASE), "Mandarin"),
		(re.compile(r"\bCHINESE\b", re.IGNORECASE), "Chinese"),
		(re.compile(r"\bMYANMAR\b", re.IGNORECASE), "Myanmar"),
		(re.compile(r"\bENGLISH\b", re.IGNORECASE), "English"),
	)
	SUPPORT_PATTERNS = re.compile(r"\b(?:rosary|novena|adoration|meditation)\b", re.IGNORECASE)
	IGNORE_PATTERNS = re.compile(r"\b(?:cathedral|venue|parish office closed|date/day|time/event)\b", re.IGNORECASE)

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

		if not page_html or not poster_image_url or not page_url:
			raise RuntimeError("[find_poster_image] Unable to locate the St John schedule poster image.")

		try:
			image_response = requests.get(poster_image_url, timeout=60)
			image_response.raise_for_status()
			image_buffer = io.BytesIO(image_response.content)
			poster_image = self._prepare_image_for_ocr(Image.open(image_buffer))
			ocr_text = pytesseract.image_to_string(poster_image, config="--psm 6")
		except Exception as exc:
			raise RuntimeError(f"[ocr_image] {exc}") from exc

		try:
			schedules = self._parse_schedule_text(ocr_text)
		except Exception as exc:
			raise RuntimeError(f"[parse_schedule_text] {exc}") from exc

		return {
			"source": self.source_name,
			"bulletin_page_url": page_url,
			"bulletin_image_url": poster_image_url,
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

	def _parse_schedule_text(self, ocr_text):
		normalized_text = ocr_text.replace("\r", "\n").replace("\x0c", "\n")
		normalized_text = re.sub(r"[\u2010-\u2015]", "-", normalized_text)
		normalized_text = re.sub(r"\s+\|\s+", " | ", normalized_text)
		year = self._extract_year(normalized_text)
		bulletin_month = self._extract_month(normalized_text)

		rows = self._split_into_rows(normalized_text)
		schedules = []
		for row in rows:
			row_schedules = self._parse_row(row, year, bulletin_month)
			schedules.extend(row_schedules)

		return self._dedupe_schedules(schedules)

	def _split_into_rows(self, text):
		matches = list(self.DATE_ROW_PATTERN.finditer(text))
		if not matches:
			return []

		rows = []
		for index, match in enumerate(matches):
			start = match.start()
			end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
			rows.append(text[start:end].strip())
		return rows

	def _parse_row(self, row_text, year, bulletin_month):
		match = self.DATE_ROW_PATTERN.match(row_text)
		if not match:
			return []

		day = int(match.group("day"))
		month = int(match.group("month"))
		if bulletin_month and month != bulletin_month:
			month = bulletin_month

		try:
			date_value = datetime(year, month, day)
		except ValueError:
			return []

		body = row_text[match.end():].strip()
		if not body:
			return []

		body = body.replace("|", " | ")
		body = re.sub(r"\s+", " ", body).strip()
		time_matches = list(self.TIME_PATTERN.finditer(body))
		if not time_matches:
			return []

		default_language = self._infer_language(body)
		pending_notes = []
		rows = []

		for index, time_match in enumerate(time_matches):
			start_time_raw = time_match.group("time")
			start_time = self._normalize_time(start_time_raw)
			segment_end = time_matches[index + 1].start() if index + 1 < len(time_matches) else len(body)
			segment = body[time_match.end():segment_end].strip(" |,;:-")

			if self._contains_mass(segment):
				notes = self._compose_notes(pending_notes)
				language = self._infer_language(segment) or default_language
				rows.append(
					{
						"day_of_week": date_value.isoweekday(),
						"start_time": start_time,
						"end_time": self._plus_one_hour(start_time),
						"language": language,
						"notes": notes,
					}
				)
				pending_notes = []
				continue

			note_text = self._extract_support_note(segment, start_time_raw)
			if note_text:
				pending_notes.append(note_text)

		return rows

	def _contains_mass(self, segment):
		return bool(segment and self.MASS_PATTERN.search(segment))

	def _extract_support_note(self, segment, time_text):
		if not segment:
			return ""

		if not self.SUPPORT_PATTERNS.search(segment):
			return ""

		cleaned = re.sub(r"\bMass\b.*$", "", segment, flags=re.IGNORECASE).strip()
		cleaned = re.sub(r"\b(Cathedral|Venue)\b.*$", "", cleaned, flags=re.IGNORECASE).strip()
		cleaned = re.sub(r"\s+", " ", cleaned).strip(" -,:;")
		if not cleaned:
			return ""
		if time_text:
			return f"{cleaned} {time_text.strip()}"
		return cleaned

	def _compose_notes(self, pending_notes):
		unique_notes = []
		seen = set()
		for note in pending_notes:
			normalized_note = note.strip()
			if not normalized_note:
				continue
			key = normalized_note.lower()
			if key in seen:
				continue
			seen.add(key)
			unique_notes.append(normalized_note)
		return "; ".join(unique_notes)

	def _extract_year(self, text):
		match = self.YEAR_PATTERN.search(text)
		if match:
			return int(match.group("year"))
		return datetime.now().year

	def _extract_month(self, text):
		match = self.MONTH_PATTERN.search(text)
		if not match:
			return None

		month_name = match.group("month").upper()
		month_lookup = {
			"JANUARY": 1,
			"FEBRUARY": 2,
			"MARCH": 3,
			"APRIL": 4,
			"MAY": 5,
			"JUNE": 6,
			"JULY": 7,
			"AUGUST": 8,
			"SEPTEMBER": 9,
			"OCTOBER": 10,
			"NOVEMBER": 11,
			"DECEMBER": 12,
		}
		return month_lookup.get(month_name)

	def _infer_language(self, text):
		for pattern, label in self.LANGUAGE_PATTERNS:
			if pattern.search(text):
				return label
		return "English"

	def _normalize_time(self, time_str):
		cleaned = time_str.strip().lower().replace(".", ":")
		cleaned = re.sub(r"\s+", "", cleaned)
		match = re.match(r"^(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?(?P<suffix>am|pm)?$", cleaned)
		if not match:
			raise ValueError(f"Unable to parse time value: {time_str}")

		hour = int(match.group("hour"))
		minute = int(match.group("minute") or 0)
		suffix = match.group("suffix")

		if not suffix:
			return f"{hour:02d}:{minute:02d}:00"

		if hour > 12:
			return f"{hour:02d}:{minute:02d}:00"

		if suffix == "pm" and hour != 12:
			hour += 12
		elif suffix == "am" and hour == 12:
			hour = 0

		return f"{hour:02d}:{minute:02d}:00"

	def _plus_one_hour(self, time_string):
		parsed = datetime.strptime(time_string, "%H:%M:%S")
		return (parsed + timedelta(hours=1)).strftime("%H:%M:%S")

	def _dedupe_schedules(self, schedules):
		unique_schedules = []
		seen = set()

		for schedule in schedules:
			signature = (
				schedule.get("day_of_week"),
				schedule.get("start_time"),
				schedule.get("end_time"),
				schedule.get("language", "").strip().lower(),
				schedule.get("notes", "").strip().lower(),
			)
			if signature in seen:
				continue
			seen.add(signature)
			unique_schedules.append(schedule)

		return unique_schedules

	def _prepare_image_for_ocr(self, image):
		processed = ImageOps.grayscale(image)
		width, height = processed.size
		return processed.resize((width * 2, height * 2))

	def _user_agent(self):
		return (
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
			"AppleWebKit/537.36 (KHTML, like Gecko) "
			"Chrome/124.0.0.0 Safari/537.36"
		)