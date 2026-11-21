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
        "jira": {"projectKey": "NWD", "projectName": "Northwind Orders", "boardId": 41, "boardName": "NWD Scrum board",
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


def person_res(pid, name, role, loc):
    return {"id": pid, "name": name, "role": role, "location": loc, "availability": 100, "note": "",
            "source": "Tickets + team", "notInTeam": False}


def last_plan():
    """A saved Sprint 25 plan whose people are the team: their role and location carry over (US-12 AC-1)."""
    return {
        "schemaVersion": 1, "status": "open",
        "sprint": {"id": 2500, "name": "Sprint 25", "goal": "", "state": "active", "start": "2026-12-07", "end": "2026-12-31"},
        "loadedAt": "2026-11-20T08:00:00.000Z", "changesSince": None, "changes": None, "tickets": [],
        "resources": [person_res("lorenzo", "Lorenzo", "Dev", "lu"), person_res("marc", "Marc", "Dev", "lu"),
                      person_res("priya", "Priya", "Dev", "ch"), person_res("gabriela", "Gabriela", "BA", "lu"),
                      person_res("karthik", "Karthik", "BA", "ch")],
        "team": ["lorenzo", "marc", "priya", "gabriela", "karthik"], "removed": [],
        "leave": {}, "oneOffs": [], "cards": [],
    }
