import datetime

from langchain_core.tools import tool


@tool()
def get_current_date():
    """
    本日の日付を返すツールです。
    返される情報は、本日の日時です。

    Returns
    -------
    str:
        本日の日付。提供形式は [yyyy-MM-dd] です。
    """
    return datetime.date.today()
