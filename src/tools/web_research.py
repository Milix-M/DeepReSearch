from itertools import islice

from ddgs import DDGS
from langchain_core.tools import tool
from pydantic import BaseModel, Field


class WebResearchInput(BaseModel):
    query: str = Field(description="検索クエリ")
    section: str | None = Field(
        default=None, description="この検索が関連するレポートのセクション（オプション）"
    )
    iteration: int | None = Field(
        default=None, description="現在の検索反復回数（オプション）"
    )


@tool(args_schema=WebResearchInput)
def web_research(query):
    """
    DuckDuckGo検索を行うツールです。
    指定されたクエリでDuckDuckGoを使ってウェブ検索を行い、結果を返します。
    返される情報には、ページのタイトル、概要（スニペット）、そしてURLが含まれます。

    Parameters
    ----------
    query : str
        検索を行うためのクエリ文字列。

    Returns
    -------
    List[Dict[str, str]]:
        検索結果のリスト。各辞書オブジェクトには以下が含まれます。
        - title: タイトル
        - snippet: ページの概要
        - url: ページのURL

    この関数は、プログラミングに関連する質問など、特定の質問に最適な言語で検索を行うことを推奨します。
    また、検索結果だけでは十分でない場合は、実際のページ内容を取得するために追加のツールを使用することをお勧めします。
    """
    max_result_num = 10

    res = DDGS().text(query, region="jp-jp", safesearch="off", backend="lite")

    return [
        {
            "title": r.get("title", ""),
            "snippet": r.get("body", ""),
            "url": r.get("href", ""),
        }
        for r in islice(res, max_result_num)
    ]
