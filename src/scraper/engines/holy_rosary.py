import io
import re
from datetime import datetime, timedelta
from urllib.parse import urljoin

import fitz
import requests
from bs4 import BeautifulSoup

from engines.base_engine import BaseEngine


class HolyRosaryEngine(BaseEngine):
	target_url = "https://www.hrckl.com/Bulletin"
	base_url = "https://www.hrckl.com/"

	DAY_PATTERNS = {
		"monday": 1,
		"tuesday": 2,
		"wednesday": 3,
		"thursday": 4,
		"friday": 5,
		"saturday": 6,
		"sunday": 7,
	}

	LANGUAGE_PATTERNS = (
		(re.compile(r"\bENGLISH\b", re.IGNORECASE), "English"),
		(re.compile(r"\bMANDARIN\b", re.IGNORECASE), "Mandarin"),
	)

	DAY_PATTERN = re.compile(
		r"\b(?P<day>Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b",
		re.IGNORECASE,
	)

	TIME_PATTERN = re.compile(
		r"(?P<start>\d{1,2}(?::\d{2}|\.\d{2})?\s*(?:AM|PM|A\.M\.|P\.M\.|am|pm))"
		r"(?:\s*(?:-|–|—|to)\s*(?P<end>\d{1,2}(?::\d{2}|\.\d{2})?\s*(?:AM|PM|A\.M\.|P\.M\.|am|pm)))?",
		re.IGNORECASE,
	)

	def scrape(self):
		session = requests.Session()
		headers = {"User-Agent": self._user_agent()}

		try:
			html_response = session.get(
				self.target_url,
				headers=headers,
				timeout=30,
			)
			html_response.raise_for_status()
		except Exception as exc:
			raise RuntimeError(f"[fetch_bulletin_html] {exc}") from exc

		try:
			soup = BeautifulSoup(html_response.text, "html.parser")
			bulletin_link = self._find_latest_bulletin_link(soup)
		except Exception as exc:
			raise RuntimeError(f"[find_latest_bulletin_link] {exc}") from exc

		try:
			if bulletin_link["download_mode"] == "direct":
				pdf_response = session.get(
					bulletin_link["pdf_url"],
					headers=headers,
					timeout=60,
				)
				pdf_response.raise_for_status()
			else:
				pdf_response = self._download_postback_pdf(
					session=session,
					headers=headers,
					page_soup=soup,
					event_target=bulletin_link["event_target"],
				)
		except Exception as exc:
			raise RuntimeError(f"[download_pdf] {exc}") from exc

		try:
			pdf_bytes = io.BytesIO(pdf_response.content)
			doc = fitz.open(stream=pdf_bytes, filetype="pdf")
			try:
				pdf_text = self._extract_mass_section_text(doc)
			finally:
				doc.close()
		except Exception as exc:
			raise RuntimeError(f"[parse_pdf_text] {exc}") from exc

		try:
			schedules = self._parse_schedule_text(pdf_text)
		except Exception as exc:
			raise RuntimeError(f"[extract_schedule_blocks] {exc}") from exc

		return {
			"source": "Holy Rosary Church",
			"bulletin_file_name": bulletin_link["file_name"],
			"bulletin_pdf_url": bulletin_link["pdf_url"],
			"schedules": schedules,
		}

	def _user_agent(self):
		return (
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
			"AppleWebKit/537.36 (KHTML, like Gecko) "
			"Chrome/124.0.0.0 Safari/537.36"
		)

	def _find_latest_bulletin_link(self, soup):
		bulletin_pattern = re.compile(r"Bulletin\s+(?P<date>\d{8})\.pdf", re.IGNORECASE)
		candidates = []

		for row in soup.find_all("tr"):
			row_text = " ".join(row.stripped_strings)
			match = bulletin_pattern.search(row_text)
			if not match:
				continue

			anchor = row.find("a", href=True)
			if not anchor:
				continue

			bulletin_date = datetime.strptime(match.group("date"), "%d%m%Y")
			file_name = match.group(0)
			href = anchor["href"]
			event_target = self._extract_postback_target(href)
			is_direct = bool(href and not href.lower().startswith("javascript:"))
			pdf_url = urljoin(self.base_url, href) if is_direct else None
			candidates.append(
				{
					"bulletin_date": bulletin_date,
					"file_name": file_name,
					"pdf_url": pdf_url,
					"event_target": event_target,
					"download_mode": "direct" if is_direct else "postback",
				}
			)

		if not candidates:
			raise ValueError("No bulletin PDF row matching 'Bulletin DDMMYYYY.pdf' was found.")

		candidates.sort(key=lambda item: item["bulletin_date"], reverse=True)
		return candidates[0]

	def _extract_postback_target(self, href):
		if not href:
			return None
		match = re.search(r"__doPostBack\('([^']+)'", href)
		return match.group(1) if match else None

	def _download_postback_pdf(self, session, headers, page_soup, event_target):
		if not event_target:
			raise ValueError("Missing __doPostBack event target for bulletin download row.")

		form = page_soup.find("form")
		if not form:
			raise ValueError("Unable to locate ASP.NET form for postback download.")

		payload = {
			"__EVENTTARGET": event_target,
			"__EVENTARGUMENT": "",
		}

		for input_el in form.find_all("input"):
			name = input_el.get("name")
			if not name or name in payload:
				continue
			payload[name] = input_el.get("value", "")

		response = session.post(
			self.target_url,
			headers=headers,
			data=payload,
			timeout=60,
		)
		response.raise_for_status()

		content_type = (response.headers.get("Content-Type") or "").lower()
		if "pdf" not in content_type and not response.content.startswith(b"%PDF"):
			raise ValueError(
				"Postback response did not return a PDF payload. "
				f"Content-Type={response.headers.get('Content-Type', '')}"
			)

		return response

	def _parse_schedule_text(self, pdf_text):
		normalized_text = pdf_text.replace("\r", "\n")
		lines = [line.strip() for line in normalized_text.splitlines() if line.strip()]

		sections = []
		current_language = None
		current_lines = []

		for line in lines:
			detected_language = self._detect_language(line)
			if detected_language:
				if current_lines:
					sections.append((current_language, "\n".join(current_lines)))
					current_lines = []
				current_language = detected_language
				continue

			current_lines.append(line)

		if current_lines:
			sections.append((current_language, "\n".join(current_lines)))

		schedules = []
		for section_language, section_text in sections:
			schedules.extend(self._parse_section(section_text, section_language))

		return schedules

	def _parse_section(self, section_text, default_language):
		compact_text = re.sub(r"\s+", " ", section_text).strip()
		day_matches = list(self.DAY_PATTERN.finditer(compact_text))
		if not day_matches:
			return []

		entries = []
		for index, day_match in enumerate(day_matches):
			start_index = day_match.start()
			end_index = day_matches[index + 1].start() if index + 1 < len(day_matches) else len(compact_text)
			chunk = compact_text[start_index:end_index].strip()

			time_matches = list(self.TIME_PATTERN.finditer(chunk))
			if not time_matches:
				continue

			start_raw = time_matches[0].group("start")
			end_raw = time_matches[0].group("end")
			if not end_raw and len(time_matches) > 1:
				end_raw = time_matches[1].group("start")

			start_time = self._normalize_time(start_raw)
			end_time = self._normalize_time(end_raw) if end_raw else self._plus_one_hour(start_time)

			day_name = day_match.group("day")
			notes = self._extract_notes(chunk, day_name, start_raw, end_raw)
			language = self._infer_language(chunk, default_language)

			entries.append(
				{
					"day_of_week": self._day_name_to_int(day_name),
					"start_time": start_time,
					"end_time": end_time,
					"language": language,
					"notes": notes,
				}
			)

		return entries

	def _extract_mass_section_text(self, doc):
		collected_blocks = []
		for page_index, page in enumerate(doc):
			page_width = page.rect.width
			page_midpoint = page.rect.x0 + (page_width / 2)
			for block in page.get_text("blocks", sort=True):
				x0, y0, x1, y1, text = block[:5]
				cleaned_text = (text or "").strip()
				if not cleaned_text:
					continue

				if not self._is_mass_section_block(cleaned_text, x0, x1, page_midpoint):
					continue

				collected_blocks.append((page_index, y0, cleaned_text))

		collected_blocks.sort(key=lambda item: (item[0], item[1]))
		return "\n".join(text for _, _, text in collected_blocks)

	def _is_mass_section_block(self, text, block_x0, block_x1, page_midpoint):
		if block_x0 >= page_midpoint:
			return False

		if self.DAY_PATTERN.search(text) or self.TIME_PATTERN.search(text):
			return True

		mass_heading_pattern = re.compile(r"Mass Times and Mass Intentions|Mass Times|Mass Intentions", re.IGNORECASE)
		return bool(mass_heading_pattern.search(text))

	def _detect_language(self, line):
		for pattern, label in self.LANGUAGE_PATTERNS:
			if pattern.search(line):
				return label
		return None

	def _infer_language(self, chunk, default_language):
		language = self._detect_language(chunk)
		if language:
			return language
		if default_language:
			return default_language
		return "English"

	def _day_name_to_int(self, day_name):
		return self.DAY_PATTERNS[day_name.lower()]

	def _normalize_time(self, time_str):
		cleaned = time_str.strip().upper().replace(".", ":")
		cleaned = re.sub(r"\s+", " ", cleaned)

		candidates = (
			"%I:%M %p",
			"%I %p",
			"%H:%M",
			"%H:%M:%S",
		)

		cleaned_for_parse = cleaned
		if re.match(r"^\d{1,2} \w{2}$", cleaned_for_parse):
			cleaned_for_parse = cleaned_for_parse.replace(" ", ":00 ", 1)

		for pattern in candidates:
			try:
				parsed = datetime.strptime(cleaned_for_parse, pattern)
				return parsed.strftime("%H:%M:%S")
			except ValueError:
				continue

		time_match = re.match(r"^(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?\s*(?P<suffix>AM|PM)$", cleaned_for_parse)
		if time_match:
			hour = int(time_match.group("hour"))
			minute = int(time_match.group("minute") or 0)
			suffix = time_match.group("suffix")
			if suffix == "PM" and hour != 12:
				hour += 12
			if suffix == "AM" and hour == 12:
				hour = 0
			return f"{hour:02d}:{minute:02d}:00"

		raise ValueError(f"Unable to parse time value: {time_str}")

	def _plus_one_hour(self, time_string):
		parsed = datetime.strptime(time_string, "%H:%M:%S")
		bumped = parsed + timedelta(hours=1)
		return bumped.strftime("%H:%M:%S")

	def _extract_notes(self, chunk, day_name, start_raw, end_raw):
		season = self._extract_liturgical_season(chunk)
		if not season:
			return ""
		return season

	def _extract_liturgical_season(self, chunk):
		season_patterns = (
			(re.compile(r"\b\d+(?:st|nd|rd|th)\s+Week\s+(?:in|of)\s+Ordinary\s+Time\b", re.IGNORECASE), None),
			(re.compile(r"\bOrdinary\s+Time\b", re.IGNORECASE), "Ordinary Time"),
			(re.compile(r"\b\d+(?:st|nd|rd|th)\s+Week\s+of\s+Easter\b", re.IGNORECASE), None),
			(re.compile(r"\bEastertide\b", re.IGNORECASE), "Eastertide"),
			(re.compile(r"\bEaster\s+Season\b", re.IGNORECASE), "Eastertide"),
			(re.compile(r"\bEaster\b", re.IGNORECASE), "Easter"),
			(re.compile(r"\bAdvent\b", re.IGNORECASE), "Advent"),
			(re.compile(r"\bLent\b", re.IGNORECASE), "Lent"),
			(re.compile(r"\bHoly\s+Week\b", re.IGNORECASE), "Holy Week"),
			(re.compile(r"\bTriduum\b", re.IGNORECASE), "Triduum"),
			(re.compile(r"\bChristmas\b", re.IGNORECASE), "Christmas"),
		)

		for pattern, canonical_label in season_patterns:
			match = pattern.search(chunk)
			if not match:
				continue
			return match.group(0).strip() if canonical_label is None else canonical_label

		return ""
