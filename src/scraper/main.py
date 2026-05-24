import json
import sys

from engines.holy_rosary import HolyRosaryEngine


def main():
	trigger_id = sys.argv[1] if len(sys.argv) > 1 else None
	template_id = sys.argv[2] if len(sys.argv) > 2 else None

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
		print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
		raise SystemExit(1)
