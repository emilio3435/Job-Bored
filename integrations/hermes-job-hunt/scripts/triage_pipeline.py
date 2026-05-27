#!/usr/bin/env python3
"""Triage stale 'New' rows in JHOS Pipeline Google Sheet."""

import json
import os
from datetime import datetime, timedelta
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

# Config
SHEET_ID = '1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ'
TAB = 'Pipeline'
TOKEN_PATH = os.path.expanduser('~/.hermes/google_token.json')
REPORT_PATH = os.path.expanduser('~/.hermes/job-hunt/evidence/t6.0-triage-report.md')
TODAY = datetime(2026, 5, 27)
STALE_CUTOFF = TODAY - timedelta(days=14)  # 2026-05-13

# Auth
with open(TOKEN_PATH) as f:
    token_data = json.load(f)
creds = Credentials.from_authorized_user_info(token_data, ['https://www.googleapis.com/auth/spreadsheets'])
if creds.expired and creds.refresh_token:
    creds.refresh(Request())
    with open(TOKEN_PATH, 'w') as f:
        json.dump(json.loads(creds.to_json()), f)

service = build('sheets', 'v4', credentials=creds)
sheets = service.spreadsheets()

# Read all rows
result = sheets.values().get(spreadsheetId=SHEET_ID, range=f'{TAB}!A:X').execute()
rows = result.get('values', [])
header = rows[0] if rows else []
print(f"Total rows (inc header): {len(rows)}")
print(f"Header: {header[:13]}")

def safe_get(row, idx, default=''):
    return row[idx] if idx < len(row) else default

def parse_date(s):
    for fmt in ['%Y-%m-%d', '%m/%d/%Y', '%m/%d/%y', '%Y/%m/%d', '%d/%m/%Y']:
        try:
            return datetime.strptime(s.strip(), fmt)
        except (ValueError, AttributeError):
            continue
    return None

def parse_score(s):
    try:
        return float(s)
    except (ValueError, TypeError):
        return None

# Filter to Status='New'
stale = []
low_score = []
keep = []

for i, row in enumerate(rows[1:], start=2):  # 1-indexed sheet rows, skip header
    status = safe_get(row, 12)
    if status.strip().lower() != 'new':
        continue
    
    date_str = safe_get(row, 0)
    title = safe_get(row, 1)
    company = safe_get(row, 2)
    location = safe_get(row, 3)
    link = safe_get(row, 4)
    fit_score_str = safe_get(row, 7)
    tags = safe_get(row, 9)
    match_score_str = safe_get(row, 20)
    
    date_found = parse_date(date_str)
    fit_score = parse_score(fit_score_str)
    match_score = parse_score(match_score_str)
    
    entry = {
        'row': i,
        'date_str': date_str,
        'date': date_found,
        'title': title,
        'company': company,
        'location': location,
        'link': link,
        'fit_score': fit_score,
        'fit_score_str': fit_score_str,
        'match_score': match_score,
        'match_score_str': match_score_str,
        'tags': tags,
    }
    
    if date_found and date_found < STALE_CUTOFF:
        entry['category'] = 'STALE'
        entry['action'] = 'Expired'
        stale.append(entry)
    elif fit_score is not None and fit_score <= 4:
        entry['category'] = 'LOW_SCORE'
        entry['action'] = 'Passed'
        low_score.append(entry)
    else:
        entry['category'] = 'KEEP'
        keep.append(entry)

total_new = len(stale) + len(low_score) + len(keep)
print(f"\nTotal 'New' rows: {total_new}")
print(f"  STALE (>14 days): {len(stale)}")
print(f"  LOW_SCORE (<=4): {len(low_score)}")
print(f"  KEEP: {len(keep)}")

# Build batch update
update_data = []
for entry in stale:
    update_data.append({'range': f'{TAB}!M{entry["row"]}', 'values': [['Expired']]})
for entry in low_score:
    update_data.append({'range': f'{TAB}!M{entry["row"]}', 'values': [['Passed']]})

if update_data:
    print(f"\nBatch updating {len(update_data)} cells...")
    resp = sheets.values().batchUpdate(
        spreadsheetId=SHEET_ID,
        body={'valueInputOption': 'RAW', 'data': update_data}
    ).execute()
    print(f"Updated {resp.get('totalUpdatedCells', 0)} cells")
else:
    print("\nNo updates needed.")

# Sort keep by fit_score descending
keep_sorted = sorted(keep, key=lambda x: (x['fit_score'] or 0, x['match_score'] or 0), reverse=True)

# Generate report
os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)

lines = []
lines.append("# JHOS Pipeline Triage Report")
lines.append(f"\n**Date:** {TODAY.strftime('%Y-%m-%d')}")
lines.append(f"**Cutoff for stale:** {STALE_CUTOFF.strftime('%Y-%m-%d')} (>14 days)")
lines.append(f"**Low score threshold:** ≤ 4.0")
lines.append("")
lines.append("## Summary")
lines.append("")
lines.append("| Category | Count | Action |")
lines.append("|----------|-------|--------|")
lines.append(f"| STALE | {len(stale)} | → Expired |")
lines.append(f"| LOW_SCORE | {len(low_score)} | → Passed |")
lines.append(f"| KEEP | {len(keep)} | No change |")
lines.append(f"| **Total New** | **{total_new}** | |")
lines.append("")

if stale:
    lines.append("## Expired (Stale >14 days)")
    lines.append("")
    lines.append("| Row | Date Found | Company | Title | Fit |")
    lines.append("|-----|-----------|---------|-------|-----|")
    for e in sorted(stale, key=lambda x: x['date'] or datetime.min):
        lines.append(f"| {e['row']} | {e['date_str']} | {e['company'][:30]} | {e['title'][:40]} | {e['fit_score_str']} |")
    lines.append("")

if low_score:
    lines.append("## Passed (Low Fit Score ≤ 4)")
    lines.append("")
    lines.append("| Row | Date Found | Company | Title | Fit | Match |")
    lines.append("|-----|-----------|---------|-------|-----|-------|")
    for e in sorted(low_score, key=lambda x: x['fit_score'] or 0):
        lines.append(f"| {e['row']} | {e['date_str']} | {e['company'][:30]} | {e['title'][:40]} | {e['fit_score_str']} | {e['match_score_str']} |")
    lines.append("")

lines.append("## Remaining 'New' Leads (sorted by Fit Score)")
lines.append("")
if keep_sorted:
    lines.append("| Row | Date Found | Company | Title | Fit | Match | Tags |")
    lines.append("|-----|-----------|---------|-------|-----|-------|------|")
    for e in keep_sorted[:30]:
        lines.append(f"| {e['row']} | {e['date_str']} | {e['company'][:30]} | {e['title'][:40]} | {e['fit_score_str']} | {e['match_score_str']} | {e['tags'][:25]} |")
    if len(keep_sorted) > 30:
        lines.append(f"\n*...and {len(keep_sorted) - 30} more rows kept as New*")
else:
    lines.append("*No rows remaining as New.*")

lines.append("")
lines.append("---")
lines.append(f"*Generated by JHOS Pipeline Triage, Phase 6.0*")

with open(REPORT_PATH, 'w') as f:
    f.write('\n'.join(lines))

print(f"\nReport written to: {REPORT_PATH}")
print("Done!")
