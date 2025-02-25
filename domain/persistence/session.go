package persistence

import "time"

type Session struct {
	ID          int64     `json:"id" db:"id"`
	SessionBase string    `json:"session_base" db:"session_base"`
	Title       string    `json:"title" db:"title"`
	CreateAt    time.Time `json:"create_at" db:"create_at"`
	IsLimited   uint8     `json:"is_limited" db:"is_limited"` // 0: false, 1: true
}
