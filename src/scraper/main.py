import json
import re
import sys
from datetime import datetime, timedelta


def _extract_stage(message):
	match = re.search(r"\[(?P<stage>[^\]]+)\]", message or "")
	return match.group("stage") if match else "unknown"


def _extract_date_range_from_bulletin_file_name(file_name):
	if not file_name:
		return None, None

	match = re.search(r"(?P<date>\d{8})", file_name)
	if not match:
		return None, None

	bulletin_date = datetime.strptime(match.group("date"), "%d%m%Y")
	start_date = bulletin_date.strftime("%Y-%m-%d")
	end_date = (bulletin_date + timedelta(days=6)).strftime("%Y-%m-%d")
	return start_date, end_date


def main():
	trigger_id = sys.argv[1] if len(sys.argv) > 1 else None
	template_id = sys.argv[2] if len(sys.argv) > 2 else None

	try:
		from engines.ofkl import OfklEngine
		from engines.assumption_pj import AssumptionPjEngine
		from engines.holy_rosary import HolyRosaryEngine
		from engines.st_john import StJohnEngine
	except Exception as error:
		raise RuntimeError(f"[bootstrap_python_import] {error}") from error

	engine_registry = {
		"ofkl": OfklEngine,
		"assumption_pj_btn": AssumptionPjEngine,
		"holy_rosary_btn": HolyRosaryEngine,
		"st_john_btn": StJohnEngine,
	}

	engine_class = engine_registry.get(trigger_id)
	if not engine_class:
		raise RuntimeError(f"[engine_registry] Unknown trigger id: {trigger_id}")

	engine = engine_class()
	result = engine.scrape()
	start_date = result.get("start_date")
	end_date = result.get("end_date")
	if not start_date or not end_date:
		start_date, end_date = _extract_date_range_from_bulletin_file_name(
			result.get("bulletin_file_name")
		)

	payload = {
		"trigger_id": trigger_id,
		"template_id": template_id,
		**result,
		"start_date": start_date,
		"end_date": end_date,
	}

	print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
	try:
		main()
	except Exception as error:
		message = str(error)
		print(
			json.dumps(
				{
					"success": False,
					"stage": _extract_stage(message),
					"error": message,
				},
				ensure_ascii=False,
			),
			file=sys.stderr,
		)
		raise SystemExit(1)
