"""
tests/fixtures.py — TEST ONLY. Saved config and attachment builders shared by the browser tests.
"""
import json

BANDS = [
    {"sp": 1, "lower": 0, "upper": 1}, {"sp": 2, "lower": 1, "upper": 3}, {"sp": 3, "lower": 3, "upper": 5},
    {"sp": 5, "lower": 5, "upper": 8}, {"sp": 8, "lower": 8, "upper": 12}, {"sp": 13, "lower": 12, "upper": 15},
    {"sp": 21, "lower": 15, "upper": 20}, {"sp": 34, "lower": 20, "upper": 40}, {"sp": 55, "lower": 40, "upper": 60},
    {"sp": 89, "lower": 60, "upper": 80}, {"sp": 144, "lower": 80, "upper": 100},
]


def saved_config(**over):
    """A saved scp-config.json for Squad Orion, as the Config screen shows it."""
    cfg = {
        "schemaVersion": 1,
        "jira": {"projectKey": "PCAP", "projectName": "Private Capital", "boardId": 41, "boardName": "PCAP Scrum board",
                 "team": "Squad Orion", "issueTypes": ["Story", "Bug"]},
        "fields": {
            "dev": {"id": "customfield_10412", "name": "Contributor", "type": "Multi-user picker", "custom": True},
            "ba": {"id": "customfield_10413", "name": "Backup Assignee", "type": "User picker", "custom": True},
            "sp": {"id": "customfield_10002", "name": "Story Points", "type": "Number", "custom": True},
            "team": {"id": "customfield_11200", "name": "Team", "type": "Select list", "custom": True},
        },
        "bands": BANDS,
        "split": {"ba": 40, "dev": 60},
        "workingWeek": [1, 2, 3, 4, 5],
        "ceremonyPct": 15,
        "thresholds": {"under": 80, "over": 100},
        "locations": [
            {"id": "lu", "name": "Luxembourg", "holidays": [{"date": "2027-06-23", "name": "National Day"}]},
            {"id": "ch", "name": "Chennai", "holidays": [{"date": "2027-01-14", "name": "Pongal"}]},
        ],
    }
    cfg.update(over)
    return cfg


def att(name, body, version=1, by="Shripathi R.", when="2026-11-19T17:55:00.000Z"):
    return {name: {"id": "att-" + name, "title": name, "version": version, "by": by, "when": when, "body": json.dumps(body)}}
