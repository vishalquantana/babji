# Email Filter Rules

## Context

Vishal requested the ability to set rules that automatically archive emails based on search criteria (e.g., all emails with "[JIRA]" in the subject). Currently Babji can only archive emails manually via `archive_emails`.

The `block_sender` action already creates Gmail native filters, proving the pattern works.

## Design

### Approach: Gmail Native Filters + Babji DB Tracking

- Create rules as native Gmail filters via `gmail.users.settings.filters.create()` — they execute server-side in Gmail with zero latency, 24/7.
- Track each filter in Babji's `email_filters` table so users can list and delete rules through chat.

### Database: `email_filters` table

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| tenant_id | uuid FK | Owner tenant |
| gmail_filter_id | text | Gmail's filter ID (for deletion via API) |
| description | text | Human-readable description |
| criteria | jsonb | Gmail filter criteria object |
| actions | jsonb | Gmail filter action object |
| created_at | timestamp | When created |

### Gmail Handler Changes

Add 3 new actions to `GmailHandler`:

**`create_email_filter`** — Creates a Gmail filter + saves to DB.
- Parameters: `from`, `to`, `subject`, `query`, `has_attachment` (criteria) + `action` (archive/trash/star/label/mark_read) + `label` (when action=label) + `description`
- Maps parameters to Gmail filter criteria/action objects
- Calls `gmail.users.settings.filters.create()`
- Inserts row into `email_filters` table
- Returns confirmation with filter details

**`list_email_filters`** — Lists filters from DB.
- No required parameters
- Queries `email_filters` table for the tenant
- Returns list with id, description, criteria summary, action summary

**`delete_email_filter`** — Deletes from Gmail + DB.
- Parameter: `filter_id` (Babji's UUID)
- Looks up `gmail_filter_id` from DB
- Calls `gmail.users.settings.filters.delete()`
- Removes row from DB
- Returns confirmation

### Constructor Change

`GmailHandler` constructor changes from `(accessToken)` to `(accessToken, db?, tenantId?)`. The db/tenantId are optional to maintain backward compatibility with existing actions. Filter actions require them and throw if missing.

### Action-to-Gmail Mapping

| Babji Action | Gmail Filter Action |
|-------------|-------------------|
| archive | `{ removeLabelIds: ["INBOX"] }` |
| trash | `{ addLabelIds: ["TRASH"] }` |
| star | `{ addLabelIds: ["STARRED"] }` |
| label | `{ addLabelIds: ["<label_name>"] }` |
| mark_read | `{ removeLabelIds: ["UNREAD"] }` |

### Skill Registry

3 new actions added to the `gmail` skill definition in `registry.ts`.

### Files Changed

1. `packages/db/src/schema.ts` — Add `emailFilters` table
2. `packages/skills/src/gmail/handler.ts` — Add 3 methods, update constructor
3. `packages/skills/src/registry.ts` — Register 3 new actions
4. `packages/gateway/src/message-handler.ts` — Pass db + tenantId to GmailHandler
5. `packages/skills/src/__tests__/gmail.test.ts` — Tests for new actions

### Example Conversation

```
User: "Auto-archive all emails with [JIRA] in the subject"
Babji → create_email_filter({ subject: "[JIRA]", action: "archive", description: "Auto-archive JIRA emails" })
Babji: "Done! I've created a rule to auto-archive all emails with [JIRA] in the subject."

User: "What email rules do I have?"
Babji → list_email_filters()
Babji: "You have 2 rules: 1) Auto-archive JIRA emails 2) Star emails from boss@company.com"

User: "Delete the JIRA rule"
Babji → delete_email_filter({ filter_id: "..." })
Babji: "Deleted the JIRA archive rule."
```
