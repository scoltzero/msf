package server

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestAssistantSessionTitleTruncatesByRune(t *testing.T) {
	app := newTestApp(t)
	adminToken := tokenForRole(t, app, "admin")
	adminID := mustUserIDFromTokenTest(t, app, adminToken)
	input := strings.Repeat("系统诊断", 30)
	if err := app.ensureAssistantSession("assistant-title-utf8", adminID, input); err != nil {
		t.Fatal(err)
	}
	var title string
	if err := app.DB.QueryRow(`select title from assistant_sessions where id=?`, "assistant-title-utf8").Scan(&title); err != nil {
		t.Fatal(err)
	}
	if !utf8.ValidString(title) {
		t.Fatalf("assistant title is not valid UTF-8: %q", title)
	}
	if got := len([]rune(title)); got != 80 {
		t.Fatalf("assistant title runes=%d want=80", got)
	}
}

func TestAssistantSessionTitleRepairFixesExistingInvalidUTF8(t *testing.T) {
	app := newTestApp(t)
	if _, err := app.DB.Exec(`insert into assistant_sessions(id,user_id,title,status,messages_json,created_at,updated_at) values(?,?,?,?,?,?,?)`, "bad-title", 1, []byte{0xe8, 0xbf, 0x90, 0xe8}, "idle", "[]", time.Now(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := app.repairAssistantSessionTitles(); err != nil {
		t.Fatal(err)
	}
	var title string
	if err := app.DB.QueryRow(`select title from assistant_sessions where id=?`, "bad-title").Scan(&title); err != nil {
		t.Fatal(err)
	}
	if !utf8.ValidString(title) {
		t.Fatalf("repaired title is still invalid: %q", title)
	}
}
