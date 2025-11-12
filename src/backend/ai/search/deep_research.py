import datetime
from ..schedule.plan_reserch import GeneratedObjectSchema
from .prompt import DEEP_RESEARCH_SYSTEM_PROMPT


class DeepResearchAI:
    def __init__(self, llm):
        self.llm = llm

    def __call__(
        self,
        search_queries_per_section: int,
        search_iterations: int,
        search_plan: GeneratedObjectSchema,
    ):
        prompt = [
            (
                "system",
                DEEP_RESEARCH_SYSTEM_PROMPT.format(
                    SEARCH_QUERIES_PER_SECTION=search_queries_per_section,
                    SEARCH_API="DuckDuckGo",
                    SEARCH_ITERATIONS=search_iterations,
                    SEARCH_PLAN=search_plan,
                    CURRENT_DATE=datetime.date.today(),
                ),
            )
        ]
        response = self.llm.invoke(prompt)

        return response
