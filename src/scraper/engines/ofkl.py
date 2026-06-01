import re
from collections import OrderedDict
from datetime import datetime, timedelta

import requests
from bs4 import BeautifulSoup

from engines.base_engine import BaseEngine


class OfklEngine(BaseEngine):
	parish_id = "ofkl"
	target_url = "https://olfkl.com/mass-schedule/"
	source_name = "Church of Our Lady of Fatima (OFKL)"

	DATE_PATTERN = re.compile(
		r"(?P<day>\d{1,2})\s+(?P<month>January|February|March|April|May|June|July|August|September|October|November|December)\s+(?P<year>\d{4})\s*\((?P<weekday>Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\)",
		re.IGNORECASE,
	)
	TIME_PATTERN = re.compile(r"(?P<time>\d{1,2}(?::|\.)\d{2}\s*(?:AM|PM|am|pm))")
	LANGUAGE_MAP = {
		"english": "English",
		"tamil": "Tamil",
		"mandarin": "Mandarin",
		"malay": "Malay",
		"bm": "Malay",
		"chinese": "Chinese",
	}

	def scrape(self):
		try:
			page_html = self._fetch_html(self.target_url)
			date_groups = self._extract_date_groups(page_html)
		except Exception as exc:
			raise RuntimeError(f"[parse_schedule_page] {exc}") from exc

		schedules = []
		for group in date_groups:
			schedules.extend(group["schedules"])

		return {
			"source": self.source_name,
			"parish_id": self.parish_id,
			"bulletin_page_url": self.target_url,
			"bulletin_image_url": None,
			"start_date": None,
			"end_date": None,
			"date_groups": date_groups,
			"schedules": schedules,
		}

	def _fetch_html(self, url):
		response = requests.get(url, headers={"User-Agent": self._user_agent()}, timeout=30)
		response.raise_for_status()
		return BeautifulSoup(response.text, "html.parser")

	def _extract_date_groups(self, soup):
		container = soup.select_one("main") or soup.select_one("article") or soup.body or soup
		lines = [line.strip() for line in container.get_text("\n", strip=True).splitlines() if line.strip()]

		date_groups = OrderedDict()
		current_group = None

		for raw_line in lines:
			line = self._clean_line(raw_line)
			date_info = self._parse_date_heading(line)
			if date_info:
				date_key = date_info["date"].strftime("%Y-%m-%d")
				current_group = date_groups.setdefault(
					date_key,
					{
						"date": date_key,
						"day_of_week": date_info["date"].isoweekday(),
						"heading": line,
						"schedules": [],
						"_seen": set(),
					},
				)
				continue

			if not current_group:
				continue

			schedule = self._parse_schedule_line(line, current_group["day_of_week"])
			if not schedule:
				continue

			signature = (
				schedule["day_of_week"],
				schedule["start_time"],
				schedule["end_time"],
				schedule["language"].strip().lower(),
				schedule["notes"].strip().lower(),
			)
			if signature in current_group["_seen"]:
				continue

			current_group["_seen"].add(signature)
			current_group["schedules"].append(schedule)

		result = []
		for group in sorted(date_groups.values(), key=lambda item: item["date"]):
			group["schedules"].sort(key=lambda item: item["start_time"])
			group.pop("_seen", None)
			result.append(group)

		return result

	def _parse_date_heading(self, line):
		match = self.DATE_PATTERN.search(line)
		if not match:
			return None

		day_text = match.group("day")
		month_text = match.group("month")
		year_text = match.group("year")
		parsed_date = datetime.strptime(f"{day_text} {month_text} {year_text}", "%d %B %Y")
		return {
			"date": parsed_date,
			"weekday": match.group("weekday"),
		}

	def _parse_schedule_line(self, line, day_of_week):
		if not line:
			return None

		line_lower = line.lower()
		if "mass" not in line_lower:
			return None

		cleaned_line = self._strip_bullet_prefix(line)
		time_match = self.TIME_PATTERN.search(cleaned_line)
		if not time_match:
			return None

		start_time = self._normalize_time(time_match.group("time"))
		if not start_time:
			return None

		remainder = cleaned_line[time_match.end():].strip()
		remainder = re.sub(r"^[\-–—:]+\s*", "", remainder)
		notes, language = self._extract_activity_and_language(remainder)
		if not language:
			language = "English"

		if not notes:
			notes = "Mass"

		return {
			"day_of_week": day_of_week,
			"start_time": start_time,
			"end_time": self._plus_one_hour(start_time),
			"language": language,
			"notes": notes,
		}

	def _extract_activity_and_language(self, text):
		activity = self._strip_trailing_language(text)
		language = self._extract_language(text)
		activity = re.sub(r"\s+", " ", activity).strip()
		activity = activity.strip("-–—: ")
		return activity, language

	def _extract_language(self, text):
		match = re.search(r"\((?P<language>[^)]+)\)\s*$", text)
		if not match:
			return None

		candidate = re.sub(r"\s+", " ", match.group("language")).strip().lower()
		return self.LANGUAGE_MAP.get(candidate)

	def _strip_trailing_language(self, text):
		return re.sub(r"\s*\([^)]*\)\s*$", "", text).strip()

	def _strip_bullet_prefix(self, line):
		return re.sub(r"^[\s•\u2022\-]+", "", line).strip()

	def _clean_line(self, line):
		return re.sub(r"\s+", " ", line).strip()

	def _normalize_time(self, time_str):
		text = str(time_str).strip().lower().replace(".", ":")
		text = re.sub(r"\s+", "", text)
		match = re.match(r"^(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?(?P<suffix>am|pm)?$", text)
		if not match:
			return None

		hour = int(match.group("hour"))
		minute = int(match.group("minute") or 0)
		suffix = match.group("suffix")

		if suffix:
			if hour == 12:
				hour = 0
			if suffix == "pm":
				hour += 12

		if hour < 0 or hour > 23 or minute < 0 or minute > 59:
			return None

		return f"{hour:02d}:{minute:02d}:00"

	def _plus_one_hour(self, time_string):
		parsed = datetime.strptime(time_string, "%H:%M:%S")
		return (parsed + timedelta(hours=1)).strftime("%H:%M:%S")

	def _user_agent(self):
		return (
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
			"AppleWebKit/537.36 (KHTML, like Gecko) "
			"Chrome/124.0.0.0 Safari/537.36"
		)