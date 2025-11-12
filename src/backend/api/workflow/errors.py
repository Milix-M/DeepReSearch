"""Workflowサービスで発生し得る例外クラス群。"""


class WorkflowError(Exception):
    """ワークフロー操作時に発生する例外の基底クラス。"""


class StateNotFoundError(WorkflowError):
    """指定したスレッドの状態が見つからない場合に送出する。"""


class HitlNotEnabledError(WorkflowError):
    """HITL モードが無効なスレッドに対して操作を行った場合に送出する。"""


class InterruptNotFoundError(WorkflowError):
    """保留中割り込みが存在しない場合に送出する。"""
