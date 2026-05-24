import json
import re
import sys


def _extract_stage(message):
	match = re.search(r"\[(?P<stage>[^\]]+)\]", message or "")
	return match.group("stage") if match else "unknown"


def main():
	trigger_id = sys.argv[1] if len(sys.argv) > 1 else None
	template_id = sys.argv[2] if len(sys.argv) > 2 else None

	try:
		from engines.holy_rosary import HolyRosaryEngine
	except Exception as error:
		raise RuntimeError(f"[bootstrap_python_import] {error}") from error

	engine = HolyRosaryEngine()
	result = engine.scrape()

	payload = {
		"trigger_id": trigger_id,
		"template_id": template_id,
		**result,
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
