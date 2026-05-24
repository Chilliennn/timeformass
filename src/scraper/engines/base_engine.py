from abc import ABC, abstractmethod


class BaseEngine(ABC):
	target_url = ""

	def __init__(self, target_url=None):
		if target_url:
			self.target_url = target_url

	@abstractmethod
	def scrape(self):
		raise NotImplementedError
