import time
from abc import ABC, abstractmethod


class BaseEngine(ABC):
    target_url = ""

    def __init__(self, target_url=None):
        if target_url:
            self.target_url = target_url

    def _user_agent(self):
        return (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )

    def _generate_content_with_retry(
        self, client, contents, config, max_retries=3, initial_delay=2
    ):
        models_to_try = [
            self.model_name,
            "gemini-2.5-flash-lite",
            "gemini-3-flash",
            "gemini-2.5-pro",
        ]

        for i, current_model in enumerate(models_to_try):
            delay = initial_delay
            for attempt in range(max_retries):
                try:
                    response = client.models.generate_content(
                        model=current_model, contents=contents, config=config
                    )
                    return response
                except Exception as exc:
                    is_503 = "503" in str(exc) or "UNAVAILABLE" in str(exc).upper()

                    if is_503 and attempt < max_retries - 1:
                        print(
                            f"[{self.source_name}] Model {current_model} busy (503). Retrying in {delay}s..."
                        )
                        time.sleep(delay)
                        delay *= 2
                    elif is_503 and current_model != models_to_try[-1]:
                        next_model = models_to_try[i + 1]
                        print(
                            f'[{self.source_name}] Max retries reached for {current_model}. Falling back to {next_model}..."\n'
                        )
                        break
                    else:
                        raise exc

        raise RuntimeError(
            f"[{self.source_name}] All generation model paths exhausted due to service unavailability."
        )


@abstractmethod
def scrape(self):
    raise NotImplementedError
