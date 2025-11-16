from langchain_core.load.serializable import Serializable
from pydantic import Field


class ResearchContent(Serializable):
    """セクションの内容を保持するモデル。

    Attributes:
        heading (str): 内容の見出し。
        content (str): 内容の詳細。
    """

    heading: str = Field(description="内容の見出し")
    content: str = Field(description="内容の詳細")

    @classmethod
    def is_lc_serializable(cls) -> bool:
        return True


class ResearchSection(Serializable):
    """リサーチレポート内の単一セクションを表すデータモデル。

    Attributes:
        heading (str): セクションの見出し。
        content (ResearchContent): セクションの内容。
        findings (list[str]): セクションで得られた主要な発見のリスト。
        sources (list[str]): セクションで使用された主な情報源のリスト。
    """

    heading: str = Field(description="セクションの見出し")
    content: ResearchContent = Field(description="セクションの内容")
    findings: list[str] = Field(description="このセクションで得られた主要な発見")
    sources: list[str] = Field(description="このセクションの主な情報源")

    @classmethod
    def is_lc_serializable(cls) -> bool:
        return True


class ResearchReport(Serializable):
    """リサーチの調査結果を表すモデル。

    Attributes:
        title (str): リサーチレポートのタイトル。
        research_date (str): リサーチが行われた日付。例: "調査日：2025-11-16"
        introduction (str): リサーチのイントロダクション。
        sections (list[ResearchSection]): リサーチレポートを分割したセクション一覧。
        summary (str): リサーチレポートの要約。
    """

    title: str = Field(description="リサーチレポートのタイトル")
    research_date: str = Field(description="リサーチが行われた日付。例: \"調査日：2025-11-16\"")
    introduction: str = Field(description="リサーチのイントロダクション")
    sections: list[ResearchSection] = Field(description="リサーチレポートを分割したセクション一覧")
    summary: str = Field(description="リサーチレポートの要約")

    @classmethod
    def is_lc_serializable(cls) -> bool:
        return True
